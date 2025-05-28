// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',       // in dev lasciare '*' o specifica il tuo dominio
    methods: ['GET','POST']
  },
  maxHttpBufferSize: 10e6, // 10MB per messaggi grandi
  pingTimeout: 60000,      // 60 secondi timeout ping
  pingInterval: 25000      // 25 secondi intervallo ping
});

// Mappa in memoria: code → { web: socketId, mobile: socketId }
// In produzione valuta Redis o un altro store centralizzato
const rooms = {};

// 1) Endpoint per generare un nuovo codice
app.get('/new-code', (req, res) => {
  const code = nanoid(16).toUpperCase();
  console.log(`🔑 Generato nuovo codice: ${code}`);   // ← log qui
  rooms[code] = rooms[code] || {};
  res.json({ code });
});

// 2) Serve la tua cartella web statica (index.html, styles.css, script.js)
app.use(express.static('public'));

// 3) Socket.IO
io.on('connection', socket => {
  console.log('🟢 Nuova connessione:', socket.id);
  
  // Log di debug per tutti gli eventi ricevuti
  socket.onAny((eventName, ...args) => {
    if (eventName !== 'ping' && eventName !== 'pong') {
      console.log(`📨 Evento ricevuto: ${eventName} da ${socket.id}`);
    }
  });
  // La web page si registra qui
  socket.on('register_web', code => {
    console.log(`Web registra stanza ${code}`);
    socket.join(code);
    rooms[code] = rooms[code] || {};
    rooms[code].web = socket.id;
    
    // Se il mobile è già connesso, chiedi di re-inviare i file
    if (rooms[code].mobile) {
      console.log(`📱 Mobile già connesso, richiedo file per ${code}`);
      io.to(rooms[code].mobile).emit('request_file_list', code);
    }
  });

  // La mobile app si registra qui
  socket.on('register_mobile', code => {
    console.log(`Mobile registra stanza ${code}`);
    socket.join(code);
    rooms[code] = rooms[code] || {};
    rooms[code].mobile = socket.id;
    
    // Se la web è già connessa, invia immediatamente i file
    if (rooms[code].web) {
      console.log(`💻 Web già connessa, il mobile dovrebbe inviare i file per ${code}`);
    }
  });
  // La mobile invia lista file/metadati
  socket.on('file_list', ({ code, files }) => {
    console.log(`Ricevuti ${files.length} file per stanza ${code}`);
    // Rilancia alla stanza (quindi alla web) il payload
    io.to(code).emit('file_list', files);
  });

  // Richiesta download file dalla web al mobile
  socket.on('request_file_download', ({ code, fileId, fileName }) => {
    console.log(`📥 Web richiede download di ${fileName} (ID: ${fileId}) per stanza ${code}`);
    if (rooms[code] && rooms[code].mobile) {
      // Inoltra la richiesta al mobile
      io.to(rooms[code].mobile).emit('download_file_request', { fileId, fileName, code });
    } else {
      // Mobile non connesso, informa la web
      io.to(socket.id).emit('download_error', { 
        fileName, 
        error: 'Mobile non connesso' 
      });
    }
  });  // Il mobile invia il file alla web (metodo originale per file piccoli)
  socket.on('file_data', ({ code, fileName, fileData, mimeType }) => {
    console.log(`📁 Mobile invia file ${fileName} per stanza ${code}`);
    if (rooms[code] && rooms[code].web) {
      // Inoltra il file alla web
      io.to(rooms[code].web).emit('file_data', { fileName, fileData, mimeType });
    }
  });

  // ——— Upload da Web a Mobile ———
  // Web carica file sul mobile
  socket.on('upload_file_to_mobile', ({ code, fileName, fileData, fileSize, mimeType, uploadId, parentFolderId }) => {
    console.log(`📤 Web carica file ${fileName} (${fileSize} bytes) per stanza ${code}`);
    console.log(`📁 Cartella di destinazione: ${parentFolderId || 'Root'}`);
    console.log(`🔍 Debug - Stanza ${code} esiste: ${!!rooms[code]}`);
    console.log(`🔍 Debug - Mobile connesso: ${!!(rooms[code] && rooms[code].mobile)}`);
    console.log(`🔍 Debug - Mobile ID: ${rooms[code] ? rooms[code].mobile : 'N/A'}`);
    
    if (rooms[code] && rooms[code].mobile) {
      console.log(`✅ Inoltrando file ${fileName} al mobile ${rooms[code].mobile}`);
      // Inoltra il file al mobile
      io.to(rooms[code].mobile).emit('receive_file_from_web', {
        fileName,
        fileData,
        fileSize,
        mimeType,
        uploadId,
        code,
        parentFolderId // Includi la cartella di destinazione
      });
    } else {
      console.log(`❌ Mobile non connesso per stanza ${code}`);
      // Mobile non connesso, informa la web dell'errore
      io.to(socket.id).emit('upload_error', {
        uploadId,
        fileName,
        error: 'Mobile non connesso'
      });
    }
  });
  // Mobile conferma ricezione file dalla web
  socket.on('file_received_from_web', ({ uploadId, fileName, code, success, error }) => {
    console.log(`📱 Mobile conferma ricezione file ${fileName}: ${success ? 'successo' : 'errore'}`);
    
    if (rooms[code] && rooms[code].web) {
      if (success) {
        io.to(rooms[code].web).emit('upload_success', { uploadId, fileName });
      } else {
        io.to(rooms[code].web).emit('upload_error', { uploadId, fileName, error });
      }
    }
  });
  // ——— Upload Chunked (File Grandi) ———
  socket.on('upload_chunked_start', ({ code, fileName, fileSize, totalChunks, mimeType, uploadId, parentFolderId }) => {
    console.log(`📦 Inizio upload chunked: ${fileName} (${fileSize} bytes, ${totalChunks} chunks)`);
    console.log(`📁 Cartella di destinazione: ${parentFolderId || 'Root'}`);
    
    if (rooms[code] && rooms[code].mobile) {
      // Inizializza buffer per chunks
      rooms[code].uploadBuffer = {
        fileName,
        fileSize,
        totalChunks,
        mimeType,
        uploadId,
        parentFolderId, // Aggiungi la cartella di destinazione
        chunks: new Array(totalChunks),
        receivedChunks: 0
      };
      
      console.log(`✅ Buffer inizializzato per upload chunked: ${fileName}`);
    } else {
      console.log(`❌ Mobile non connesso per upload chunked stanza ${code}`);
      io.to(socket.id).emit('upload_error', {
        uploadId,
        fileName,
        error: 'Mobile non connesso'
      });
    }
  });

  socket.on('upload_chunked_data', ({ code, fileName, chunkIndex, totalChunks, chunkData, uploadId }) => {
    console.log(`📦 Ricevuto chunk ${chunkIndex + 1}/${totalChunks} per upload ${fileName}`);
    
    if (rooms[code] && rooms[code].uploadBuffer && rooms[code].mobile) {
      const buffer = rooms[code].uploadBuffer;
      
      // Salva il chunk
      buffer.chunks[chunkIndex] = chunkData;
      buffer.receivedChunks++;
      
      console.log(`📦 Chunk salvato: ${buffer.receivedChunks}/${buffer.totalChunks} ricevuti`);
    }
  });

  socket.on('upload_chunked_complete', ({ code, fileName, uploadId }) => {
    console.log(`📦 Upload chunked completato: ${fileName}`);
    
    if (rooms[code] && rooms[code].uploadBuffer && rooms[code].mobile) {
      const buffer = rooms[code].uploadBuffer;
      
      // Verifica che tutti i chunk siano presenti
      const missingChunks = [];
      for (let i = 0; i < buffer.totalChunks; i++) {
        if (!buffer.chunks[i]) {
          missingChunks.push(i);
        }
      }
      
      if (missingChunks.length > 0) {
        console.error(`❌ Chunk mancanti per upload ${fileName}: ${missingChunks.join(', ')}`);
        io.to(rooms[code].web).emit('upload_error', {
          uploadId,
          fileName,
          error: `Chunk mancanti: ${missingChunks.join(', ')}`
        });
        delete rooms[code].uploadBuffer;
        return;
      }      // Combina tutti i chunks base64
      const completeFileData = buffer.chunks.join('');
      console.log(`✅ File ricombinato: ${completeFileData.length} caratteri base64`);
      
      // Testa la validità del base64
      try {
        const testDecoded = Buffer.from(completeFileData, 'base64');
        console.log(`✅ Base64 valido - ${testDecoded.length} bytes decodificati`);
        console.log(`🔍 Dimensione attesa: ${buffer.fileSize}, dimensione ottenuta: ${testDecoded.length}`);
        
        // Verifica che la dimensione sia esattamente corretta
        if (testDecoded.length !== buffer.fileSize) {
          throw new Error(`Dimensione file non corrisponde: atteso ${buffer.fileSize}, ottenuto ${testDecoded.length}`);
        }
        
        console.log(`✅ Dimensione file corretta: ${testDecoded.length} bytes`);
      } catch (validationError) {
        console.error(`❌ Errore validazione base64 per upload ${fileName}:`, validationError.message);
        io.to(rooms[code].web).emit('upload_error', {
          uploadId,
          fileName,
          error: `Errore validazione: ${validationError.message}`
        });
        delete rooms[code].uploadBuffer;
        return;
      }
        // Invia al mobile
      io.to(rooms[code].mobile).emit('receive_file_from_web', {
        fileName: buffer.fileName,
        fileData: completeFileData,
        fileSize: buffer.fileSize,
        mimeType: buffer.mimeType,
        uploadId: buffer.uploadId,
        code: code,
        parentFolderId: buffer.parentFolderId // Includi la cartella di destinazione
      });
      
      // Pulisci il buffer
      delete rooms[code].uploadBuffer;
    }
  });

  // Gestione file grandi con chunking
  socket.on('file_transfer_start', ({ code, fileName, fileSize, totalChunks, mimeType }) => {
    console.log(`📁 Inizio trasferimento file ${fileName} (${fileSize} bytes, ${totalChunks} chunks) per stanza ${code}`);
    if (rooms[code] && rooms[code].web) {
      // Inizializza il buffer per i chunk
      rooms[code].fileBuffer = {
        fileName,
        fileSize,
        totalChunks,
        mimeType,
        chunks: new Array(totalChunks),
        receivedChunks: 0
      };
      // Notifica la web dell'inizio del trasferimento
      io.to(rooms[code].web).emit('file_transfer_start', { fileName, fileSize, totalChunks });
    }
  });

  socket.on('file_chunk', ({ code, fileName, chunkIndex, totalChunks, chunkData }) => {
    console.log(`📁 Ricevuto chunk ${chunkIndex + 1}/${totalChunks} per file ${fileName} in stanza ${code}`);
    if (rooms[code] && rooms[code].web && rooms[code].fileBuffer) {
      const buffer = rooms[code].fileBuffer;
      
      // Salva il chunk
      buffer.chunks[chunkIndex] = chunkData;
      buffer.receivedChunks++;
      
      // Notifica il progresso alla web
      io.to(rooms[code].web).emit('file_progress', {
        fileName,
        progress: Math.round((buffer.receivedChunks / buffer.totalChunks) * 100)
      });
    }
  });
  socket.on('file_transfer_complete', ({ code, fileName }) => {
    console.log(`📁 Completato trasferimento file ${fileName} per stanza ${code}`);
    if (rooms[code] && rooms[code].web && rooms[code].fileBuffer) {
      const buffer = rooms[code].fileBuffer;
      
      // Verifica che tutti i chunk siano presenti
      const missingChunks = [];
      for (let i = 0; i < buffer.totalChunks; i++) {
        if (!buffer.chunks[i]) {
          missingChunks.push(i);
        }
      }
      
      if (missingChunks.length > 0) {
        console.error(`❌ Chunk mancanti per ${fileName}: ${missingChunks.join(', ')}`);
        io.to(rooms[code].web).emit('download_error', {
          fileName: buffer.fileName,
          error: `Chunk mancanti: ${missingChunks.join(', ')}`
        });
        delete rooms[code].fileBuffer;
        return;
      }        // Ricomponi il file dai chunk semplicemente concatenandoli
      let completeFileData = '';
      for (let i = 0; i < buffer.chunks.length; i++) {
        completeFileData += buffer.chunks[i];
      }
      
      console.log(`📁 File ricomposto: ${completeFileData.length} caratteri totali`);
      
      // Verifica che la stringa sia base64 valida
      try {
        console.log(`📁 Lunghezza stringa base64: ${completeFileData.length}`);
        
        // Verifica che la lunghezza sia corretta per base64
        if (completeFileData.length % 4 !== 0) {
          throw new Error(`Lunghezza base64 non divisibile per 4: ${completeFileData.length}`);
        }
        
        console.log(`📁 Base64 finale pronto per invio: ${completeFileData.length} caratteri`);
        
        // Test della validità base64
        const testDecoded = Buffer.from(completeFileData, 'base64');
        console.log(`✅ File ${fileName} validato correttamente - ${testDecoded.length} bytes`);
        
        // Verifica che la dimensione sia corretta
        if (testDecoded.length !== buffer.fileSize) {
          throw new Error(`Dimensione file non corrisponde: atteso ${buffer.fileSize}, ottenuto ${testDecoded.length}`);
        }
          // Invia il file completo alla web
        io.to(rooms[code].web).emit('file_data', {
          fileName: buffer.fileName,
          fileData: completeFileData,
          mimeType: buffer.mimeType
        });
      } catch (validationError) {
        console.error(`❌ Errore validazione file ${fileName}:`, validationError.message);
        io.to(rooms[code].web).emit('download_error', {
          fileName: buffer.fileName,
          error: `Errore validazione: ${validationError.message}`
        });
      }
        // Pulisci il buffer
      delete rooms[code].fileBuffer;
    }  });

  // ——— Folder Creation Handlers ———
  // Web richiede creazione cartella al mobile
  socket.on('create_folder_from_web', ({ code, folderName, parentFolderId }) => {
    console.log(`📁 Web richiede creazione cartella "${folderName}" nella cartella ${parentFolderId || 'Root'} per stanza ${code}`);
    
    if (rooms[code] && rooms[code].mobile) {
      // Inoltra la richiesta al mobile
      io.to(rooms[code].mobile).emit('create_folder_from_web', {
        folderName,
        parentFolderId,
        code
      });
    } else {
      // Mobile non connesso, informa la web dell'errore
      io.to(socket.id).emit('folder_creation_error', {
        folderName,
        error: 'Mobile non connesso'
      });
    }
  });

  // Mobile conferma creazione cartella dalla web
  socket.on('folder_created_from_web', ({ folderName, parentFolderId, code, success, error }) => {
    console.log(`📱 Mobile conferma creazione cartella "${folderName}": ${success ? 'successo' : 'errore'}`);
    
    if (rooms[code] && rooms[code].web) {
      if (success) {
        io.to(rooms[code].web).emit('folder_created_success', { folderName, parentFolderId });
      } else {
        io.to(rooms[code].web).emit('folder_creation_error', { folderName, error });
      }
    }
  });

  // ——— Rename Functions ———
  // Web richiede rinomina file al mobile
  socket.on('rename_file_from_web', ({ code, fileId, fileName, newFileName }) => {
    console.log(`✏️ Web richiede rinomina file ${fileName} -> ${newFileName} (ID: ${fileId}) per stanza ${code}`);
    
    if (rooms[code] && rooms[code].mobile) {
      // Inoltra la richiesta al mobile
      io.to(rooms[code].mobile).emit('rename_file_from_web', {
        fileId,
        fileName,
        newFileName,
        code
      });
    } else {
      // Mobile non connesso, informa la web dell'errore
      io.to(socket.id).emit('file_rename_error', {
        fileName,
        error: 'Mobile non connesso'
      });
    }
  });

  // Mobile conferma rinomina file dalla web
  socket.on('file_renamed_from_web', ({ fileName, newFileName, code, success, error }) => {
    console.log(`📱 Mobile conferma rinomina file ${fileName} -> ${newFileName}: ${success ? 'successo' : 'errore'}`);
    
    if (rooms[code] && rooms[code].web) {
      if (success) {
        io.to(rooms[code].web).emit('file_rename_success', { fileName, newFileName });
      } else {
        io.to(rooms[code].web).emit('file_rename_error', { fileName, error });
      }
    }
  });

  // Web richiede rinomina cartella al mobile
  socket.on('rename_folder_from_web', ({ code, folderId, folderName, newFolderName }) => {
    console.log(`✏️ Web richiede rinomina cartella ${folderName} -> ${newFolderName} (ID: ${folderId}) per stanza ${code}`);
    
    if (rooms[code] && rooms[code].mobile) {
      // Inoltra la richiesta al mobile
      io.to(rooms[code].mobile).emit('rename_folder_from_web', {
        folderId,
        folderName,
        newFolderName,
        code
      });
    } else {
      // Mobile non connesso, informa la web dell'errore
      io.to(socket.id).emit('folder_rename_error', {
        folderName,
        error: 'Mobile non connesso'
      });
    }
  });

  // Mobile conferma rinomina cartella dalla web
  socket.on('folder_renamed_from_web', ({ folderName, newFolderName, code, success, error }) => {
    console.log(`📱 Mobile conferma rinomina cartella ${folderName} -> ${newFolderName}: ${success ? 'successo' : 'errore'}`);
    
    if (rooms[code] && rooms[code].web) {
      if (success) {
        io.to(rooms[code].web).emit('folder_rename_success', { folderName, newFolderName });
      } else {
        io.to(rooms[code].web).emit('folder_rename_error', { folderName, error });
      }
    }
  });

  // ——— File Deletion Handlers ———
  // Web richiede eliminazione file al mobile
  socket.on('delete_file_from_web', ({ code, fileId, fileName }) => {
    console.log(`🗑️ Web richiede eliminazione file ${fileName} (ID: ${fileId}) per stanza ${code}`);
    
    if (rooms[code] && rooms[code].mobile) {
      // Inoltra la richiesta al mobile
      io.to(rooms[code].mobile).emit('delete_file_from_web', {
        fileId,
        fileName,
        code
      });
    } else {
      // Mobile non connesso, informa la web dell'errore
      io.to(socket.id).emit('file_deletion_error', {
        fileName,
        error: 'Mobile non connesso'
      });
    }
  });

  // Mobile conferma eliminazione file dalla web
  socket.on('file_deleted_from_web', ({ fileName, code, success, error }) => {
    console.log(`📱 Mobile conferma eliminazione file ${fileName}: ${success ? 'successo' : 'errore'}`);
    
    if (rooms[code] && rooms[code].web) {
      if (success) {
        io.to(rooms[code].web).emit('file_deleted_success', { fileName });
      } else {
        io.to(rooms[code].web).emit('file_deletion_error', { fileName, error });
      }
    }
  });

  // ——— Folder Deletion Handlers ———
  // Web richiede eliminazione cartella al mobile
  socket.on('delete_folder_from_web', ({ code, folderId, folderName }) => {
    console.log(`🗑️ Web richiede eliminazione cartella ${folderName} (ID: ${folderId}) per stanza ${code}`);
    
    if (rooms[code] && rooms[code].mobile) {
      // Inoltra la richiesta al mobile
      io.to(rooms[code].mobile).emit('delete_folder_from_web', {
        folderId,
        folderName,
        code
      });
    } else {
      // Mobile non connesso, informa la web dell'errore
      io.to(socket.id).emit('folder_deletion_error', {
        folderName,
        error: 'Mobile non connesso'
      });
    }
  });

  // Mobile conferma eliminazione cartella dalla web
  socket.on('folder_deleted_from_web', ({ folderName, code, success, error }) => {
    console.log(`📱 Mobile conferma eliminazione cartella ${folderName}: ${success ? 'successo' : 'errore'}`);
    
    if (rooms[code] && rooms[code].web) {
      if (success) {
        io.to(rooms[code].web).emit('folder_deleted_success', { folderName });
      } else {
        io.to(rooms[code].web).emit('folder_deletion_error', { folderName, error });
      }
    }
  });

  // Disconnessione manuale del mobile
  socket.on('disconnect_mobile', ({ code }) => {
    console.log(`📱 Mobile si disconnette manualmente dalla stanza ${code}`);
    if (rooms[code]) {
      // Rimuovi il mobile dalla stanza
      if (rooms[code].mobile === socket.id) {
        delete rooms[code].mobile;
      }
      
      // Notifica la web della disconnessione del mobile
      if (rooms[code].web) {
        console.log(`📤 Notifico alla web la disconnessione del mobile per ${code}`);
        io.to(rooms[code].web).emit('mobile_disconnected', { code });
      }
      
      // Pulisci eventuali buffer di trasferimento
      if (rooms[code].fileBuffer) {
        delete rooms[code].fileBuffer;
      }
    }
  });

  // Disconnessione manuale del web
  socket.on('disconnect_web', ({ code }) => {
    console.log(`💻 Web si disconnette manualmente dalla stanza ${code}`);
    if (rooms[code]) {
      // Rimuovi il web dalla stanza
      if (rooms[code].web === socket.id) {
        delete rooms[code].web;
      }
      
      // Notifica il mobile della disconnessione del web
      if (rooms[code].mobile) {
        console.log(`📤 Notifico al mobile la disconnessione del web per ${code}`);
        io.to(rooms[code].mobile).emit('web_disconnected', { code });
      }
      
      // Pulisci eventuali buffer di trasferimento
      if (rooms[code].fileBuffer) {
        delete rooms[code].fileBuffer;
      }
    }
  });

  // Pulizia alla disconnessione
  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (rooms[room]) {
        if (rooms[room].web === socket.id) delete rooms[room].web;
        if (rooms[room].mobile === socket.id) delete rooms[room].mobile;
        // Se stanza vuota, puoi anche fare delete rooms[room];
      }
    }
    console.log('🔴 Disconnessione:', socket.id);
  });
});

// 4) Avvia il server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server in ascolto sulla porta ${PORT}`);
});
