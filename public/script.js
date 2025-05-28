// Connessione Socket.IO
const socket = io();

// Listener per monitorare connessione/disconnessione
socket.on('connect', () => {
  console.log('🟢 Socket.IO connesso:', socket.id);
});

socket.on('disconnect', (reason) => {
  console.error('🔴 Socket.IO disconnesso! Motivo:', reason);
  
  // Pulisci tutti i timeout attivi quando si perde la connessione
  if (activeDownloadTimeouts.size > 0) {
    console.log(`🧹 Cancellazione di ${activeDownloadTimeouts.size} timeout attivi per disconnessione...`);
    activeDownloadTimeouts.forEach(({ timeoutId, resetFileElement }, fileName) => {
      clearTimeout(timeoutId);
      resetFileElement(); // Ripristina l'elemento visivo
      console.log(`✅ Timeout cancellato per: ${fileName}`);
    });
    activeDownloadTimeouts.clear();
  }
  
  if (isConnected) {
    alert('⚠️ Connessione persa con il server!');
    updateStatusConnected('error', 'Connessione persa');
  }
});

socket.on('connect_error', (error) => {
  console.error('❌ Errore connessione Socket.IO:', error);
});

socket.on('reconnect', (attemptNumber) => {
  console.log('🔄 Socket.IO riconnesso dopo', attemptNumber, 'tentativi');
});

socket.on('reconnect_error', (error) => {
  console.error('❌ Errore riconnessione Socket.IO:', error);
});

// Stato
let currentCode = '';
let isConnected = false;
let autoCheckInterval = null;

// Mappa per tenere traccia dei timeout attivi per ogni download
const activeDownloadTimeouts = new Map();

// Stato navigazione cartelle
let currentFolderId = null; // ID cartella corrente (null = root)
let folderBreadcrumb = []; // Array dei nomi delle cartelle nel percorso
let allFiles = []; // Array completo di tutti i file e cartelle ricevuti

// Funzioni per gestire lo stato dei menu di modifica
function updateMenusConnectionState(connected) {
  // Trova tutti i pulsanti menu e gli elementi menu
  const menuButtons = document.querySelectorAll('.file-menu-button');
  const menuItems = document.querySelectorAll('.file-menu-item');
  
  menuButtons.forEach(button => {
    if (connected) {
      button.classList.remove('connection-lost');
    } else {
      button.classList.add('connection-lost');
    }
  });
  
  menuItems.forEach(item => {
    // Disabilita solo le opzioni di modifica (rinomina e elimina)
    const isModifyAction = item.textContent.includes('Rinomina') || item.textContent.includes('Elimina');
    if (isModifyAction) {
      if (connected) {
        item.classList.remove('disabled');
        // Ripristina gli event handler originali
        item.style.pointerEvents = '';
      } else {
        item.classList.add('disabled');
        // Rimuovi temporaneamente la possibilità di cliccare
        item.style.pointerEvents = 'none';
      }
    }
  });
}

function disableModificationFeatures() {
  console.log('🔒 Disabilitazione funzioni di modifica per perdita di connessione...');
  updateMenusConnectionState(false);
}

function enableModificationFeatures() {
  console.log('🔓 Riabilitazione funzioni di modifica per connessione ripristinata...');
  updateMenusConnectionState(true);
}

// Setup all'load
window.addEventListener('load', () => {
  document.getElementById('genCodeBtn').onclick    = fetchNewCode;
  document.getElementById('disconnectBtn').onclick = disconnectWeb;
  document.getElementById('downloadAppBtn').onclick = showDownloadOptions;
  
  // Setup upload functionality
  setupUploadHandlers();
  
  fetchNewCode();
});

// Funzione per scaricare direttamente l'APK dell'app
function showDownloadOptions() {
  console.log('📱 Avvio download APK App Cloud...');
  
  // Crea un link temporaneo per il download dall'ultima release su GitHub
  const link = document.createElement('a');
  link.href = 'https://github.com/sasasa23rf/server_e_sito-app-cloud/releases/download/v1.0.0/app-release.apk';
  link.download = 'app-release.apk';
  link.style.display = 'none';
  
  // Aggiungi al DOM, clicca e rimuovi
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  console.log('✅ Download APK avviato');
}

// 1) Ottiene il codice dal server
function fetchNewCode() {
  updateStatus('waiting', '📡 Genero nuovo codice…');
  
  // Ferma il controllo automatico precedente se presente
  if (autoCheckInterval) {
    clearInterval(autoCheckInterval);
    autoCheckInterval = null;
  }
  
  fetch('/new-code')
    .then(resp => {
      if (!resp.ok) throw new Error(`Status ${resp.status}`);
      return resp.json();
    })    .then(({ code }) => {
      currentCode = code;
      
      // Mostra il QR code invece del codice testuale
      const canvas = document.getElementById('qrCodeCanvas');
      const textElement = document.getElementById('generatedCode');
      
      try {
        // Genera il QR code usando QRious
        const qr = new QRious({
          element: canvas,
          value: code,
          size: 200,
          level: 'M'
        });
        
        console.log('✅ QR code generato con successo');
        // Mostra il QR code e nascondi il testo
        canvas.style.display = 'block';
        textElement.style.display = 'none';
        
      } catch (error) {
        console.error('❌ Errore generazione QR code:', error);
        // Fallback: mostra il codice testuale
        textElement.textContent = code;
        textElement.style.display = 'block';
        canvas.style.display = 'none';
      }
      
      updateStatus('waiting', '⏳ In attesa che il telefono scansioni il QR code...');
      
      // Inizia il controllo automatico
      startAutoCheck();
    })
    .catch(err => {
      console.error('❌ Errore fetch/new-code:', err);
      updateStatus('waiting', '❌ Impossibile generare codice');
    });
}

// Inizia il controllo automatico per rilevare connessioni
function startAutoCheck() {
  if (autoCheckInterval) return; // Evita duplicati
  
  // Funzione per registrare la web quando il socket è pronto
  const registerWhenReady = () => {
    if (socket && socket.connected) {
      console.log(`🔌 Socket pronto, registro web con codice: ${currentCode}`);
      socket.emit('register_web', currentCode);
    } else {
      console.log('🔌 Socket non ancora pronto, riprovo tra 100ms...');
      setTimeout(registerWhenReady, 100);
    }
  };
  
  // Avvia la registrazione
  registerWhenReady();
    autoCheckInterval = setInterval(() => {
    if (!isConnected && currentCode) {
      updateStatus('waiting', '⏳ In attesa che il telefono scansioni il QR code...');
    }
  }, 1000);
}

// 2) Registra la web e mostra l’explorer (ora chiamata automaticamente)
function connectWeb() {
  if (!currentCode) {
    alert('Prima genera un codice!');
    return;
  }
  socket.emit('register_web', currentCode);
  document.getElementById('codeSection').style.display      = 'none';
  document.getElementById('connectedSection').style.display = 'block';
  updateStatusConnected('connected', '✅ Telefono connesso! In attesa dei file...');
}

// 3) Riceve i metadati dal mobile
socket.on('file_list', files => {
  console.log(`📥 Ricevuti ${files.length} file dal mobile`);
  
  // Salva tutti i file ricevuti per la navigazione
  allFiles = files;
  // Se non è ancora connesso, passa automaticamente alla schermata file
  if (!isConnected) {
    isConnected = true;
    
    // Abilita le funzioni di modifica quando si stabilisce la connessione
    enableModificationFeatures();
    
    // Ferma il controllo automatico
    if (autoCheckInterval) {
      clearInterval(autoCheckInterval);
      autoCheckInterval = null;
    }
    
    // Passa alla schermata connessa
    document.getElementById('codeSection').style.display = 'none';
    document.getElementById('connectedSection').style.display = 'block';
    
    // Aggiungi classe 'connected' al body per cambiare il layout
    document.body.classList.add('connected');
  }
    renderFileExplorer();
  if (files.length > 0) {
    updateStatusConnected('connected', '📱 Connesso al tuo telefono - non chiudere l\'app!');
  } else {
    updateStatusConnected('connected', '✅ Telefono connesso! Nessun file presente.');
  }
});

// 4) Disconnetti SOLO UI, non usare eventi riservati
function disconnectWeb() {
  console.log('🧹 Inizio pulizia completa del sistema...');
  
  // 0. Invia notifica di disconnessione al mobile prima di pulire tutto
  if (currentCode && socket && socket.connected) {
    console.log(`📤 Notifico al mobile la disconnessione del web per codice: ${currentCode}`);
    socket.emit('disconnect_web', { code: currentCode });
  }
  
  // 1. Ferma il controllo automatico precedente se presente
  if (autoCheckInterval) {
    clearInterval(autoCheckInterval);
    autoCheckInterval = null;
  }  // 2. Reset completo dello stato di connessione
  isConnected = false;
  currentCode = '';
  
  // 2.1. Disabilita funzioni di modifica quando si perde la connessione
  disableModificationFeatures();
  
  // 2.2. Pulizia timeout attivi per download in corso
  if (activeDownloadTimeouts.size > 0) {
    console.log(`🧹 Cancellazione di ${activeDownloadTimeouts.size} timeout attivi...`);
    activeDownloadTimeouts.forEach(({ timeoutId, resetFileElement }, fileName) => {
      clearTimeout(timeoutId);
      resetFileElement(); // Ripristina l'elemento visivo
      console.log(`✅ Timeout cancellato per: ${fileName}`);
    });
    activeDownloadTimeouts.clear();
  }
  
  // 2.2. Reset dello stato di navigazione cartelle
  currentFolderId = null;
  folderBreadcrumb = [];
  allFiles = [];
  
  // 3. Pulizia completa dell'interfaccia utente
  const explorer = document.getElementById('fileExplorer');
  explorer.innerHTML = '<h3>📂 I Tuoi File</h3><p>Nessun file caricato</p>';
    // 4. Reset di tutti gli elementi UI a stato normale
  const buttons = document.querySelectorAll('button');
  buttons.forEach(btn => {
    btn.disabled = false;
  });
  
  // Reset dello stato visivo dei file
  const fileElements = document.querySelectorAll('.folder.is-file');
  fileElements.forEach(element => {
    element.style.backgroundColor = '';
    element.style.opacity = '1';
  });
  
  // 5. Pulizia status messages
  const statusConnected = document.getElementById('statusConnected');
  if (statusConnected) {
    statusConnected.className = 'status waiting';
    statusConnected.textContent = '';
  }
    // 6. Nascondi sezione connessa e mostra sezione codice
  document.getElementById('connectedSection').style.display = 'none';
  document.getElementById('codeSection').style.display = 'block';
  
  // 6.1. Rimuovi classe 'connected' dal body per ricentrare il contenitore
  document.body.classList.remove('connected');
    // 7. Reset completo del codice mostrato
  document.getElementById('generatedCode').textContent = '—';
  document.getElementById('generatedCode').style.display = 'none';
  document.getElementById('qrCodeCanvas').style.display = 'none';
    // 8. Disconnect socket e riconnetti per pulizia completa
  if (socket) {
    console.log('🔌 Disconnetto e riconnetto socket per pulizia cache...');
    socket.disconnect();
    
    // Aspetta che il socket sia completamente riconnesso prima di generare il codice
    const waitForReconnection = () => {
      if (socket.connected) {
        console.log('🔌 Socket riconnesso, genero nuovo codice...');
        updateStatus('waiting', '📡 Genero nuovo codice pulito...');
        fetchNewCode();
      } else {
        console.log('🔌 Socket non ancora riconnesso, riprovo tra 100ms...');
        setTimeout(waitForReconnection, 100);
      }
    };
    
    // Riconnetti e aspetta che sia pronto
    setTimeout(() => {
      socket.connect();
      // Aspetta che la connessione sia stabilita
      setTimeout(waitForReconnection, 150);
    }, 100);
  } else {
    // Se non c'è socket, genera direttamente il codice
    updateStatus('waiting', '📡 Genero nuovo codice pulito...');
    setTimeout(fetchNewCode, 100);
  }
  
  console.log('✅ Pulizia completa sistema terminata');
}

// ——— Helpers ———

// Aggiorna la scritta nella sezione “codeSection”
function updateStatus(type, text) {
  const st = document.getElementById('status');
  st.className   = `status ${type}`;
  st.textContent = text;
}

// Aggiorna la scritta nella sezione “connectedSection”
function updateStatusConnected(type, text) {
  const st = document.getElementById('statusConnected');
  st.className   = `status ${type}`;
  st.textContent = text;
}

// Costruisce dinamicamente la lista dei file e cartelle
function renderFileExplorer() {
  const explorer = document.getElementById('fileExplorer');
  
  // Header con navigazione breadcrumb
  let headerHtml = '<h3>📂 I Tuoi File</h3>';
  
  // Breadcrumb navigation se non siamo nella root
  if (folderBreadcrumb.length > 0) {
    headerHtml += '<div class="breadcrumb-nav">';
    headerHtml += '<button onclick="goBack()">← Indietro</button>';
    headerHtml += '<span class="breadcrumb-path">📍 Percorso: Root';
    folderBreadcrumb.forEach(folderName => {
      headerHtml += ` > ${folderName}`;
    });
    headerHtml += '</span></div>';
  }
  
  explorer.innerHTML = headerHtml;
  
  // Ottieni gli elementi nella cartella corrente
  const currentItems = getCurrentFolderItems();
  
  if (currentItems.length === 0) {
    explorer.innerHTML += '<p style="color: #666; font-style: italic;">Nessun elemento presente in questa cartella</p>';
    return;
  }
  
  // Separa cartelle e file per mostrarli ordinati
  const folders = currentItems.filter(item => item.isFolder);
  const files = currentItems.filter(item => !item.isFolder);
    // Prima mostra le cartelle
  folders.forEach(folder => {
    const div = document.createElement('div');
    div.className = 'folder is-folder';
    div.style.cursor = 'pointer';      div.innerHTML = `
      <div class="folder-icon">
        <span style="font-size: 20px;">📁</span>
      </div>
      <div style="flex: 1; text-align: left;">
        <div style="font-weight: 500;">${folder.name}</div>
        <div style="font-size: 12px; color: #666;">Cartella • ${formatDate(folder.dateAdded)}</div>
      </div>
      <div class="file-menu-container" style="position: relative;">
        <button class="file-menu-button" onclick="event.stopPropagation(); toggleFileMenu('${folder.id}')" style="background: none; border: none; font-size: 16px; cursor: pointer; padding: 5px; color: #666;">⋮</button>        <div id="menu-${folder.id}" class="file-menu" style="display: none;">
          <div class="file-menu-item" onclick="event.stopPropagation(); if(!isConnected || !currentCode) { alert('⚠️ Impossibile rinominare: telefono non connesso!\\n\\nLe modifiche non verrebbero salvate sul dispositivo.'); return; } renameFolder('${folder.id}', '${folder.name}')">✏️ Rinomina</div>
          <div class="file-menu-item" onclick="event.stopPropagation(); if(!isConnected || !currentCode) { alert('⚠️ Impossibile eliminare: telefono non connesso!\\n\\nLe modifiche non verrebbero salvate sul dispositivo.'); return; } deleteFolder('${folder.id}', '${folder.name}')">🗑️ Elimina</div>
        </div>
      </div>
    `;
    
    // Aggiungi event listener per entrare nella cartella
    div.onclick = () => enterFolder(folder);
    
    explorer.appendChild(div);
  });
  // Poi mostra i file
  files.forEach(file => {
    const div = document.createElement('div');
    div.className = 'folder is-file';
    div.style.cursor = 'pointer'; // Aggiungi cursor pointer per mostrare la manina
    
    // Calcola dimensione in formato leggibile
    const fileSize = file.size ? formatFileSize(file.size) : 'N/A';
    
    // Ottieni l'icona specifica per il file
    const fileIcon = getFileIcon(file.name);
    const extension = file.name.split('.').pop()?.toLowerCase() || '';      div.innerHTML = `
      <div class="file-icon" style="background-color: ${fileIcon.bgColor}; border: 1px solid ${fileIcon.color}20;">
        ${fileIcon.emoji === 'PDF' ? 
          `<span style="color: ${fileIcon.color}; font-size: 12px; font-weight: bold;">${fileIcon.emoji}</span>` :
          `<span style="color: ${fileIcon.color}; font-size: 18px;">${fileIcon.emoji}</span>`
        }
        <div class="file-extension">${extension.toUpperCase()}</div>
      </div>
      <div style="flex: 1; text-align: left;">
        <div>${file.name}</div>
        <div style="font-size: 12px; color: #666;">${fileSize} • ${formatDate(file.dateAdded)}</div>
      </div>
      <div style="padding: 5px 10px; margin: 0; font-size: 12px; color: #666;">
        📥 Clicca per scaricare
      </div>
      <div class="file-menu-container" style="position: relative;">
        <button class="file-menu-button" onclick="event.stopPropagation(); toggleFileMenu('${file.id}')" style="background: none; border: none; font-size: 16px; cursor: pointer; padding: 5px; color: #666;">⋮</button>        <div id="menu-${file.id}" class="file-menu" style="display: none;">
          <div class="file-menu-item" onclick="event.stopPropagation(); if(!isConnected || !currentCode) { alert('⚠️ Impossibile rinominare: telefono non connesso!\\n\\nLe modifiche non verrebbero salvate sul dispositivo.'); return; } renameFile('${file.id}', '${file.name}')">✏️ Rinomina</div>
          <div class="file-menu-item" onclick="event.stopPropagation(); if(!isConnected || !currentCode) { alert('⚠️ Impossibile eliminare: telefono non connesso!\\n\\nLe modifiche non verrebbero salvate sul dispositivo.'); return; } deleteFile('${file.id}', '${file.name}')">🗑️ Elimina</div>
        </div>
      </div>
    `;
      // Aggiungi event listener per avviare il download direttamente
    div.onclick = () => downloadFile(file.id, file.name);
    
    explorer.appendChild(div);
  });
  
  // Applica lo stato corrente di connessione ai menu appena creati
  updateMenusConnectionState(isConnected);
}

// Ottiene gli elementi (file e cartelle) nella cartella corrente
function getCurrentFolderItems() {
  const items = allFiles.filter(item => item.parentFolderId === currentFolderId);
  
  // Separa cartelle e file
  const folders = items.filter(item => item.isFolder);
  const files = items.filter(item => !item.isFolder);
  
  // Ordina cartelle alfabeticamente (case-insensitive)
  folders.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  
  // Ordina file alfabeticamente (case-insensitive)
  files.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  
  // Ritorna prima le cartelle, poi i file
  return [...folders, ...files];
}

// Entra in una cartella
function enterFolder(folder) {
  if (folder.isFolder) {
    currentFolderId = folder.id;
    folderBreadcrumb.push(folder.name);
    renderFileExplorer();
    console.log(`📁 Entrato nella cartella: ${folder.name}`);
  }
}

// Torna alla cartella padre
function goBack() {
  if (folderBreadcrumb.length > 0) {
    folderBreadcrumb.pop();
    
    // Trova l'ID della cartella padre
    if (folderBreadcrumb.length === 0) {
      currentFolderId = null; // Root
    } else {
      // Ricostruisci il percorso per trovare l'ID della cartella padre
      let parentId = null;
      for (let i = 0; i < folderBreadcrumb.length; i++) {
        const folderName = folderBreadcrumb[i];
        const folder = allFiles.find(f => 
          f.isFolder && 
          f.name === folderName && 
          f.parentFolderId === parentId
        );
        if (folder) {
          parentId = folder.id;
        }
      }
      currentFolderId = parentId;
    }
    
    renderFileExplorer();
    console.log(`📁 Tornato indietro, cartella corrente: ${currentFolderId || 'Root'}`);
  }
}

// Funzione per ottenere l'icona basata sull'estensione del file
function getFileIcon(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return { emoji: '📄', color: '#6c757d', bgColor: '#f8f9fa' };
  }
  
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  
  // Mapping delle estensioni alle icone
  const iconMap = {
    // Immagini
    'jpg': { emoji: '🖼️', color: '#e91e63', bgColor: '#fce4ec' },
    'jpeg': { emoji: '🖼️', color: '#e91e63', bgColor: '#fce4ec' },
    'png': { emoji: '🖼️', color: '#e91e63', bgColor: '#fce4ec' },
    'gif': { emoji: '🖼️', color: '#e91e63', bgColor: '#fce4ec' },
    'bmp': { emoji: '🖼️', color: '#e91e63', bgColor: '#fce4ec' },
    'webp': { emoji: '🖼️', color: '#e91e63', bgColor: '#fce4ec' },
    'svg': { emoji: '🖼️', color: '#e91e63', bgColor: '#fce4ec' },
      // Documenti PDF
    'pdf': { emoji: 'PDF', color: '#ffffff', bgColor: '#f44336' },
    
    // Documenti Word
    'doc': { emoji: '📝', color: '#2196f3', bgColor: '#e3f2fd' },
    'docx': { emoji: '📝', color: '#2196f3', bgColor: '#e3f2fd' },
    
    // Fogli di calcolo
    'xls': { emoji: '📊', color: '#4caf50', bgColor: '#e8f5e8' },
    'xlsx': { emoji: '📊', color: '#4caf50', bgColor: '#e8f5e8' },
    
    // Presentazioni
    'ppt': { emoji: '📊', color: '#ff9800', bgColor: '#fff3e0' },
    'pptx': { emoji: '📊', color: '#ff9800', bgColor: '#fff3e0' },
    
    // File di testo
    'txt': { emoji: '📝', color: '#795548', bgColor: '#efebe9' },
    'rtf': { emoji: '📝', color: '#795548', bgColor: '#efebe9' },
    
    // Audio
    'mp3': { emoji: '🎵', color: '#ff5722', bgColor: '#fbe9e7' },
    'wav': { emoji: '🎵', color: '#ff5722', bgColor: '#fbe9e7' },
    'aac': { emoji: '🎵', color: '#ff5722', bgColor: '#fbe9e7' },
    'flac': { emoji: '🎵', color: '#ff5722', bgColor: '#fbe9e7' },
    'ogg': { emoji: '🎵', color: '#ff5722', bgColor: '#fbe9e7' },
    
    // Video
    'mp4': { emoji: '🎬', color: '#9c27b0', bgColor: '#f3e5f5' },
    'avi': { emoji: '🎬', color: '#9c27b0', bgColor: '#f3e5f5' },
    'mov': { emoji: '🎬', color: '#9c27b0', bgColor: '#f3e5f5' },
    'wmv': { emoji: '🎬', color: '#9c27b0', bgColor: '#f3e5f5' },
    'mkv': { emoji: '🎬', color: '#9c27b0', bgColor: '#f3e5f5' },
    'webm': { emoji: '🎬', color: '#9c27b0', bgColor: '#f3e5f5' },
    
    // Archivi
    'zip': { emoji: '📦', color: '#607d8b', bgColor: '#eceff1' },
    'rar': { emoji: '📦', color: '#607d8b', bgColor: '#eceff1' },
    '7z': { emoji: '📦', color: '#607d8b', bgColor: '#eceff1' },
    'tar': { emoji: '📦', color: '#607d8b', bgColor: '#eceff1' },
    'gz': { emoji: '📦', color: '#607d8b', bgColor: '#eceff1' },
    
    // Codice
    'js': { emoji: '💻', color: '#ffc107', bgColor: '#fffde7' },
    'html': { emoji: '🌐', color: '#ff5722', bgColor: '#fbe9e7' },
    'css': { emoji: '🎨', color: '#2196f3', bgColor: '#e3f2fd' },
    'json': { emoji: '📋', color: '#4caf50', bgColor: '#e8f5e8' },
    'xml': { emoji: '📋', color: '#ff9800', bgColor: '#fff3e0' },
    
    // Eseguibili
    'exe': { emoji: '⚙️', color: '#9e9e9e', bgColor: '#fafafa' },
    'msi': { emoji: '⚙️', color: '#9e9e9e', bgColor: '#fafafa' },
    'deb': { emoji: '⚙️', color: '#9e9e9e', bgColor: '#fafafa' },
    'dmg': { emoji: '⚙️', color: '#9e9e9e', bgColor: '#fafafa' }
  };
  
  // Restituisci l'icona specifica o quella di default
  return iconMap[extension] || { emoji: '📄', color: '#6c757d', bgColor: '#f8f9fa' };
}

// Funzione helper per formattare le dimensioni
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Funzione helper per formattare le date
function formatDate(dateString) {
  if (!dateString) return 'Data sconosciuta';
  const date = new Date(dateString);
  return date.toLocaleDateString('it-IT');
}

// Funzione per richiedere il download di un file
function downloadFile(fileId, fileName) {
  if (!isConnected) {
    alert('⚠️ Non connesso al telefono');
    return;
  }
  
  if (!currentCode) {
    alert('Errore: Nessun codice attivo');
    return;
  }
  
  console.log(`📥 Richiesta download per: ${fileName} (ID: ${fileId})`);
  
  // Trova l'elemento file per mostrare feedback visivo
  const fileElements = document.querySelectorAll('.folder.is-file');
  let targetFileElement = null;
  
  fileElements.forEach(element => {
    if (element.innerHTML.includes(fileName)) {
      targetFileElement = element;
    }
  });
  
  // Mostra feedback visivo di caricamento
  if (targetFileElement) {
    const originalStyle = targetFileElement.style.backgroundColor;
    targetFileElement.style.backgroundColor = '#f0f8ff';
    targetFileElement.style.opacity = '0.7';
    
    const statusDiv = targetFileElement.querySelector('div:last-child');
    const originalText = statusDiv.innerHTML;
    statusDiv.innerHTML = '⏳ Download in corso...';
    statusDiv.style.color = '#007bff';
    
    // Ripristina lo stato originale dopo il timeout
    const resetFileElement = () => {
      if (targetFileElement && statusDiv.innerHTML === '⏳ Download in corso...') {
        targetFileElement.style.backgroundColor = originalStyle;
        targetFileElement.style.opacity = '1';
        statusDiv.innerHTML = originalText;
        statusDiv.style.color = '#666';
      }
    };
      // Timeout per la richiesta (60 secondi) - salva il riferimento
    const timeoutId = setTimeout(() => {
      resetFileElement();
      activeDownloadTimeouts.delete(fileName); // Rimuovi dalla mappa
      alert('⏰ Timeout: Il telefono non ha risposto alla richiesta');
    }, 60000);
    
    // Salva il timeout nella mappa per poterlo cancellare in seguito
    activeDownloadTimeouts.set(fileName, {
      timeoutId,
      resetFileElement
    });
  }
  
  // Invia richiesta al server
  socket.emit('request_file_download', {
    code: currentCode,
    fileId: fileId,
    fileName: fileName
  });
}

// ——— Upload Functions ———

function setupUploadHandlers() {
  const fileInput = document.getElementById('fileInput');
  const createFolderBtn = document.getElementById('createFolderBtn');
  const dropZone = document.getElementById('dropZone');
  
  // Click sul pulsante per creare una nuova cartella
  createFolderBtn.onclick = () => createNewFolder();
  
  // Click sulla drop zone per aprire file dialog
  dropZone.onclick = () => fileInput.click();
  
  // Quando l'utente seleziona file
  fileInput.onchange = (event) => {
    const files = Array.from(event.target.files);
    if (files.length > 0) {
      handleSelectedFiles(files);
    }
  };
  
  // Drag and drop handlers
  dropZone.ondragover = (event) => {
    event.preventDefault();
    dropZone.classList.add('drag-over');
  };
  
  dropZone.ondragleave = () => {
    dropZone.classList.remove('drag-over');
  };
  
  dropZone.ondrop = (event) => {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      handleSelectedFiles(files);
    }
  };
}

function handleSelectedFiles(files) {
  if (!currentCode || !isConnected) {
    alert('❌ Errore: Non sei connesso al telefono');
    return;
  }
  
  console.log(`📤 Selezionati ${files.length} file per upload`);
  
  // Mostra la coda di upload
  const uploadQueue = document.getElementById('uploadQueue');
  const uploadList = document.getElementById('uploadList');
  uploadQueue.style.display = 'block';
  uploadList.innerHTML = '';
  
  // Processa ogni file
  files.forEach((file, index) => {
    uploadFileToMobile(file, index);
  });
}

function uploadFileToMobile(file, index) {
  const uploadId = `upload_${Date.now()}_${index}`;
  
  console.log(`📤 Inizio upload file: ${file.name} (${file.size} bytes)`);
  
  // Crea elemento nella lista upload
  const uploadItem = createUploadItem(uploadId, file);
  document.getElementById('uploadList').appendChild(uploadItem);
  
  // Determina se usare chunking per file grandi (>5MB)
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  
  if (file.size > MAX_FILE_SIZE) {
    console.log(`📦 File grande (${formatFileSize(file.size)}), uso chunking`);
    uploadLargeFileInChunks(file, uploadId);
  } else {
    console.log(`📄 File piccolo (${formatFileSize(file.size)}), invio diretto`);
    uploadSmallFileDirect(file, uploadId);
  }
}

function uploadSmallFileDirect(file, uploadId) {
  // Leggi il file come Data URL (base64)
  const reader = new FileReader();
  reader.onload = () => {
    // Il result è una data URL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
    const dataUrl = reader.result;
    
    // Estrai solo la parte base64 (dopo la virgola)
    const base64Data = dataUrl.split(',')[1];
    
    console.log(`📤 File ${file.name} convertito in base64: ${base64Data.length} caratteri`);
    
    // Determina MIME type
    const mimeType = file.type || 'application/octet-stream';
    
    updateUploadProgress(uploadId, 50, 'uploading');
    
    console.log(`📤 Invio evento upload_file_to_mobile per: ${file.name}`);
    console.log(`🔍 Debug - Code: ${currentCode}, uploadId: ${uploadId}`);
      // Invia al server per inoltrare al mobile
    socket.emit('upload_file_to_mobile', {
      code: currentCode,
      fileName: file.name,
      fileData: base64Data,
      fileSize: file.size,
      mimeType: mimeType,
      uploadId: uploadId,
      parentFolderId: currentFolderId // Aggiungi la cartella corrente
    });
    
    console.log(`📤 Evento upload_file_to_mobile inviato per: ${file.name}`);
    
    // Verifica connessione dopo l'invio
    setTimeout(() => {
      console.log(`🔍 Socket connesso dopo upload: ${socket.connected}`);
      console.log(`🔍 Socket ID: ${socket.id}`);
      if (!socket.connected) {
        console.error('❌ CONNESSIONE PERSA dopo upload!');
        updateUploadProgress(uploadId, 0, 'error');
        alert('❌ Connessione persa durante l\'upload');
      }
    }, 1000);
  };
  
  reader.onerror = () => {
    console.error(`❌ Errore lettura file: ${file.name}`);
    updateUploadProgress(uploadId, 0, 'error');
  };
  
  reader.readAsDataURL(file);
}

function uploadLargeFileInChunks(file, uploadId) {
  console.log(`📦 Convertendo file completo in base64 per ${file.name}`);
  
  // Prima converti tutto il file in base64
  const reader = new FileReader();
  reader.onload = () => {
    const base64Data = reader.result.split(',')[1]; // Rimuove "data:...;base64,"
    
    console.log(`📦 File convertito in base64: ${base64Data.length} caratteri`);
    
    // Ora dividi la stringa base64 in chunks
    const base64ChunkSize = Math.ceil(1024 * 1024 * 4 / 3); // ~1MB binario = ~1.33MB base64
    const totalChunks = Math.ceil(base64Data.length / base64ChunkSize);
    let currentChunk = 0;
    
    console.log(`📦 Dividendo base64 in ${totalChunks} chunks di ~${formatFileSize(base64ChunkSize * 3 / 4)}`);
      // Notifica inizio chunking
    socket.emit('upload_chunked_start', {
      code: currentCode,
      fileName: file.name,
      fileSize: file.size,
      totalChunks: totalChunks,
      mimeType: file.type || 'application/octet-stream',
      uploadId: uploadId,
      parentFolderId: currentFolderId // Aggiungi la cartella corrente
    });
    
    function sendNextChunk() {
      if (currentChunk >= totalChunks) {
        console.log(`✅ Tutti i chunks inviati per ${file.name}`);
        socket.emit('upload_chunked_complete', {
          code: currentCode,
          fileName: file.name,
          uploadId: uploadId
        });
        return;
      }
      
      const start = currentChunk * base64ChunkSize;
      const end = Math.min(start + base64ChunkSize, base64Data.length);
      const chunkData = base64Data.substring(start, end);
      
      console.log(`📦 Invio chunk ${currentChunk + 1}/${totalChunks} (${chunkData.length} caratteri base64)`);
      
      socket.emit('upload_chunked_data', {
        code: currentCode,
        fileName: file.name,
        chunkIndex: currentChunk,
        totalChunks: totalChunks,
        chunkData: chunkData,
        uploadId: uploadId
      });
      
      // Aggiorna progresso
      const progress = Math.round(((currentChunk + 1) / totalChunks) * 100);
      updateUploadProgress(uploadId, progress, 'uploading');
      
      currentChunk++;
      
      // Invia il prossimo chunk con un piccolo delay per non sovraccaricare
      setTimeout(sendNextChunk, 100);
    }
    
    sendNextChunk();
  };
  
  reader.onerror = () => {
    console.error(`❌ Errore lettura file completo: ${file.name}`);
    updateUploadProgress(uploadId, 0, 'error');
  };
  
  reader.readAsDataURL(file);
}

function createUploadItem(uploadId, file) {
  const div = document.createElement('div');
  div.className = 'upload-item';
  div.id = uploadId;
  
  div.innerHTML = `
    <div class="upload-item-info">
      <div class="upload-item-name">${file.name}</div>
      <div class="upload-item-size">${formatFileSize(file.size)}</div>
    </div>
    <div class="upload-progress">
      <div class="upload-progress-bar" style="width: 0%"></div>
    </div>
    <div class="upload-status uploading">Caricamento...</div>
  `;
  
  return div;
}

function updateUploadProgress(uploadId, progress, status) {
  const uploadItem = document.getElementById(uploadId);
  if (!uploadItem) return;
  
  const progressBar = uploadItem.querySelector('.upload-progress-bar');
  const statusElement = uploadItem.querySelector('.upload-status');
  
  progressBar.style.width = `${progress}%`;
  
  statusElement.className = `upload-status ${status}`;
  switch (status) {
    case 'uploading':
      statusElement.textContent = 'Caricamento...';
      break;
    case 'completed':
      statusElement.textContent = 'Completato ✅';
      // Rimuovi automaticamente dopo 2 secondi quando completato
      setTimeout(() => {
        removeUploadItem(uploadId);
      }, 2000);
      break;
    case 'error':
      statusElement.textContent = 'Errore ❌';
      // Rimuovi automaticamente dopo 5 secondi anche in caso di errore
      setTimeout(() => {
        removeUploadItem(uploadId);
      }, 5000);
      break;
  }
}

function removeUploadItem(uploadId) {
  const uploadItem = document.getElementById(uploadId);
  if (uploadItem) {
    // Animazione di fade out
    uploadItem.style.transition = 'opacity 0.3s ease';
    uploadItem.style.opacity = '0';
    
    setTimeout(() => {
      uploadItem.remove();
      
      // Controlla se ci sono ancora upload in corso
      const uploadList = document.getElementById('uploadList');
      const uploadQueue = document.getElementById('uploadQueue');
      
      if (uploadList && uploadList.children.length === 0) {
        // Non ci sono più upload, nascondi la sezione
        uploadQueue.style.display = 'none';
        console.log('📋 Tutti gli upload completati, nascondo la sezione upload');
      }
    }, 300);
  }
}

// ——— Folder Creation Function ———

function createNewFolder() {
  if (!currentCode || !isConnected) {
    alert('❌ Errore: Non sei connesso al telefono');
    return;
  }
  
  // Chiedi il nome della cartella all'utente
  const folderName = prompt('📁 Inserisci il nome della nuova cartella:');
  
  if (!folderName || folderName.trim() === '') {
    console.log('📁 Creazione cartella annullata');
    return;
  }
  
  const trimmedName = folderName.trim();
  
  // Verifica che non esista già una cartella con lo stesso nome nella cartella corrente
  const currentItems = getCurrentFolderItems();
  const existingFolder = currentItems.find(item => 
    item.isFolder && item.name.toLowerCase() === trimmedName.toLowerCase()
  );
  
  if (existingFolder) {
    alert(`❌ Esiste già una cartella con il nome "${trimmedName}" in questa posizione`);
    return;
  }
  
  console.log(`📁 Creazione cartella "${trimmedName}" nella cartella: ${currentFolderId || 'Root'}`);
  
  // Invia richiesta di creazione cartella al server
  socket.emit('create_folder_from_web', {
    code: currentCode,
    folderName: trimmedName,
    parentFolderId: currentFolderId
  });
  
  // Mostra feedback temporaneo
  updateStatusConnected('connected', `📁 Creazione cartella "${trimmedName}" in corso...`);
}

// ——— File Menu and Delete Functions ———

// Funzione per mostrare/nascondere il menu a 3 puntini
function toggleFileMenu(fileId) {
  // Chiudi tutti gli altri menu aperti
  document.querySelectorAll('.file-menu').forEach(menu => {
    if (menu.id !== `menu-${fileId}` && menu.style.display === 'block') {
      menu.style.display = 'none';
    }
  });
  
  // Mostra/nascondi il menu corrente
  const menu = document.getElementById(`menu-${fileId}`);
  if (menu) {
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
  }
}

// Funzione per eliminare un file
function deleteFile(fileId, fileName) {
  if (!isConnected || !currentCode) {
    alert('⚠️ Impossibile eliminare: telefono non connesso!\n\nLe modifiche non verrebbero salvate sul dispositivo.');
    return;
  }
  
  // Chiudi il menu
  const menu = document.getElementById(`menu-${fileId}`);
  if (menu) {
    menu.style.display = 'none';
  }
  
  // Chiedi conferma all'utente
  if (!confirm(`Sei sicuro di voler eliminare il file "${fileName}"?`)) {
    return;
  }
  
  console.log(`🗑️ Richiesta eliminazione file: ${fileName} (ID: ${fileId})`);
  
  // Mostra feedback all'utente
  updateStatusConnected('connected', `🗑️ Eliminazione "${fileName}" in corso...`);
  
  // Invia richiesta al server
  socket.emit('delete_file_from_web', {
    code: currentCode,
    fileId: fileId,
    fileName: fileName
  });
}

// Funzione per eliminare una cartella
function deleteFolder(folderId, folderName) {
  if (!isConnected || !currentCode) {
    alert('⚠️ Impossibile eliminare: telefono non connesso!\n\nLe modifiche non verrebbero salvate sul dispositivo.');
    return;
  }
  
  // Chiudi il menu
  const menu = document.getElementById(`menu-${folderId}`);
  if (menu) {
    menu.style.display = 'none';
  }
  
  // Chiedi conferma all'utente
  if (!confirm(`Sei sicuro di voler eliminare la cartella "${folderName}" e tutto il suo contenuto?`)) {
    return;
  }
  
  console.log(`🗑️ Richiesta eliminazione cartella: ${folderName} (ID: ${folderId})`);
  
  // Mostra feedback all'utente
  updateStatusConnected('connected', `🗑️ Eliminazione cartella "${folderName}" in corso...`);
  
  // Invia richiesta al server
  socket.emit('delete_folder_from_web', {
    code: currentCode,
    folderId: folderId,
    folderName: folderName
  });
}

// Funzione per rinominare un file
function renameFile(fileId, fileName) {
  if (!isConnected || !currentCode) {
    alert('⚠️ Impossibile rinominare: telefono non connesso!\n\nLe modifiche non verrebbero salvate sul dispositivo.');
    return;
  }
  
  // Chiudi il menu
  const menu = document.getElementById(`menu-${fileId}`);
  if (menu) {
    menu.style.display = 'none';
  }
  
  // Chiedi il nuovo nome all'utente
  const newFileName = prompt(`Inserisci il nuovo nome per il file "${fileName}":`, fileName);
  
  if (!newFileName || newFileName.trim() === '' || newFileName.trim() === fileName) {
    return; // Utente ha annullato o non ha cambiato il nome
  }
  
  console.log(`✏️ Richiesta rinomina file: ${fileName} -> ${newFileName.trim()} (ID: ${fileId})`);
  
  // Mostra feedback all'utente
  updateStatusConnected('connected', `✏️ Rinomina "${fileName}" in corso...`);
  
  // Invia richiesta al server
  socket.emit('rename_file_from_web', {
    code: currentCode,
    fileId: fileId,
    fileName: fileName,
    newFileName: newFileName.trim()
  });
}

// Funzione per rinominare una cartella
function renameFolder(folderId, folderName) {
  if (!isConnected || !currentCode) {
    alert('⚠️ Impossibile rinominare: telefono non connesso!\n\nLe modifiche non verrebbero salvate sul dispositivo.');
    return;
  }
  
  // Chiudi il menu
  const menu = document.getElementById(`menu-${folderId}`);
  if (menu) {
    menu.style.display = 'none';
  }
  
  // Chiedi il nuovo nome all'utente
  const newFolderName = prompt(`Inserisci il nuovo nome per la cartella "${folderName}":`, folderName);
  
  if (!newFolderName || newFolderName.trim() === '' || newFolderName.trim() === folderName) {
    return; // Utente ha annullato o non ha cambiato il nome
  }
  
  console.log(`✏️ Richiesta rinomina cartella: ${folderName} -> ${newFolderName.trim()} (ID: ${folderId})`);
  
  // Mostra feedback all'utente
  updateStatusConnected('connected', `✏️ Rinomina cartella "${folderName}" in corso...`);
  
  // Invia richiesta al server
  socket.emit('rename_folder_from_web', {
    code: currentCode,
    folderId: folderId,
    folderName: folderName,
    newFolderName: newFolderName.trim()
  });
}

// Funzione per chiudere tutti i menu quando si clicca fuori
document.addEventListener('click', (event) => {
  // Se non è un clic su un pulsante di menu o su un menu, chiudi tutti i menu
  if (!event.target.closest('.file-menu-button') && !event.target.closest('.file-menu')) {
    document.querySelectorAll('.file-menu').forEach(menu => {
      menu.style.display = 'none';
    });
  }
});

// Listener per l'inizio del trasferimento di file grandi
socket.on('file_transfer_start', ({ fileName, fileSize, totalChunks }) => {
  console.log(`📁 Inizio trasferimento file ${fileName} (${fileSize} bytes, ${totalChunks} chunks)`);
  
  // Trova l'elemento file e aggiorna con barra di progresso
  const fileElements = document.querySelectorAll('.folder.is-file');
  fileElements.forEach(element => {
    if (element.innerHTML.includes(fileName)) {
      element.style.backgroundColor = '#f0f8ff';
      element.style.opacity = '0.7';
      
      const statusDiv = element.querySelector('div:last-child');
      if (statusDiv) {
        statusDiv.innerHTML = `
          <div style="display: flex; align-items: center; gap: 5px; font-size: 10px;">
            <span>📥 0%</span>
            <div style="width: 40px; height: 4px; background: #ddd; border-radius: 2px;">
              <div id="progress-${fileName.replace(/[^a-zA-Z0-9]/g, '')}" style="width: 0%; height: 100%; background: #4caf50; border-radius: 2px; transition: width 0.3s ease;"></div>
            </div>
          </div>
        `;
        statusDiv.style.color = '#007bff';
      }
      
      // Disabilita temporaneamente il click
      element.onclick = null;
    }
  });
});

// Listener per il progresso del trasferimento
socket.on('file_progress', ({ fileName, progress }) => {
  console.log(`📁 Progresso download ${fileName}: ${progress}%`);
  
  const progressId = `progress-${fileName.replace(/[^a-zA-Z0-9]/g, '')}`;
  const progressBar = document.getElementById(progressId);
  
  if (progressBar) {
    progressBar.style.width = `${progress}%`;
    
    // Naviga nella gerarchia DOM per trovare lo span con la percentuale
    // progressBar -> div parent (contenitore barra) -> div parent (flex container) -> span (primo figlio)
    const flexContainer = progressBar.parentElement.parentElement;
    if (flexContainer) {
      const span = flexContainer.querySelector('span');
      if (span) {
        span.textContent = `📥 ${progress}%`;
      }
    }
  }
});

// Listener per ricevere il file dal mobile
socket.on('file_data', ({ fileName, fileData, mimeType }) => {
  console.log(`📁 Ricevuto file: ${fileName}`);
  console.log(`📁 Dimensione dati base64: ${fileData ? fileData.length : 'undefined'} caratteri`);
  console.log(`📁 MIME type: ${mimeType}`);
  
  // 🔥 CANCELLA IL TIMEOUT SE ESISTE
  if (activeDownloadTimeouts.has(fileName)) {
    const { timeoutId } = activeDownloadTimeouts.get(fileName);
    clearTimeout(timeoutId);
    activeDownloadTimeouts.delete(fileName);
    console.log(`✅ Timeout cancellato per download di: ${fileName}`);
  }
  
  try {
    // Verifica che i dati siano presenti
    if (!fileData) {
      throw new Error('Dati file mancanti');
    }
    
    // Verifica che sia una stringa base64 valida
    if (typeof fileData !== 'string') {
      throw new Error('Dati file non sono una stringa');
    }
      // Rimuovi eventuali caratteri non validi per base64
    let cleanBase64 = fileData.replace(/[^A-Za-z0-9+/=]/g, '');
    
    // Aggiungi padding se necessario
    while (cleanBase64.length % 4 !== 0) {
      cleanBase64 += '=';
    }
    
    console.log(`📁 Dimensione dati puliti: ${cleanBase64.length} caratteri`);
    console.log(`📁 Primi 50 caratteri: ${cleanBase64.substring(0, 50)}`);
    console.log(`📁 Ultimi 50 caratteri: ${cleanBase64.substring(cleanBase64.length - 50)}`);
    
    // Converte base64 in blob
    const byteCharacters = atob(cleanBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType || 'application/octet-stream' });
    
    console.log(`📁 Blob creato con dimensione: ${blob.size} bytes`);
    
    // Pulisci il nome del file per il download
    const cleanFileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
    console.log(`📁 Nome file pulito: ${cleanFileName}`);
    
    // Crea URL temporaneo e avvia download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cleanFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);    // Ripristina lo stato visivo dei file e mostra stato di successo
    const fileElements = document.querySelectorAll('.folder.is-file');
    fileElements.forEach(element => {
      if (element.innerHTML.includes(fileName)) {
        element.style.backgroundColor = '';
        element.style.opacity = '1';
        
        const statusDiv = element.querySelector('div:last-child');
        if (statusDiv && (statusDiv.innerHTML === '⏳ Download in corso...' || statusDiv.innerHTML.includes('📥'))) {          // Mostra messaggio di successo per 3 secondi, poi nascondi
          statusDiv.innerHTML = '✅ Scaricato';
          statusDiv.style.color = '#4caf50';
          
          setTimeout(() => {
            statusDiv.style.display = 'none';
          }, 3000);
        }
        
        // Riabilita il click per il download
        element.onclick = () => {
          const fileData = allFiles.find(f => f.name === fileName);
          if (fileData) {
            // Ripristina la scritta download quando l'utente clicca di nuovo
            const statusDiv = element.querySelector('div:last-child');
            if (statusDiv) {
              statusDiv.style.display = 'block';
              statusDiv.innerHTML = '📥 Clicca per scaricare';
              statusDiv.style.color = '#666';
            }
            downloadFile(fileData.id, fileData.name);
          }
        };
      }
    });
    
    updateStatusConnected('connected', `✅ Download completato: ${cleanFileName}`);
  } catch (error) {
    console.error('❌ Errore nel download:', error);
    console.error('❌ Dettagli errore:', {
      fileName,
      fileDataLength: fileData ? fileData.length : 'undefined',
      fileDataType: typeof fileData,
      mimeType
    });    alert(`❌ Errore nel download di ${fileName}: ${error.message}`);
    
    // Ripristina lo stato visivo dei file in caso di errore
    const fileElements = document.querySelectorAll('.folder.is-file');
    fileElements.forEach(element => {
      if (element.innerHTML.includes(fileName)) {
        element.style.backgroundColor = '';
        element.style.opacity = '1';
        
        const statusDiv = element.querySelector('div:last-child');
        if (statusDiv && (statusDiv.innerHTML === '⏳ Download in corso...' || statusDiv.innerHTML.includes('📥'))) {
          statusDiv.innerHTML = '📥 Clicca per scaricare';
          statusDiv.style.color = '#666';
        }
        
        // Riabilita il click per il download
        element.onclick = () => {
          const fileData = allFiles.find(f => f.name === fileName);
          if (fileData) {
            downloadFile(fileData.id, fileData.name);
          }
        };
      }
    });
  }
});

// Listener per la disconnessione manuale del mobile
socket.on('mobile_disconnected', ({ code }) => {
  console.log(`📱 Il mobile si è disconnesso dal codice: ${code}`);
  
  // Se il codice corrisponde a quello attuale, disconnetti automaticamente la web
  if (currentCode === code && isConnected) {
    console.log(`🔌 Disconnessione automatica della web per codice: ${code}`);
    disconnectWeb();
  }
});

// Listener per errori di download
socket.on('download_error', ({ fileName, error }) => {
  console.error(`❌ Errore download ${fileName}: ${error}`);
  alert(`❌ Impossibile scaricare ${fileName}\nMotivo: ${error}`);
  
  // 🔥 CANCELLA IL TIMEOUT SE ESISTE
  if (activeDownloadTimeouts.has(fileName)) {
    const { timeoutId } = activeDownloadTimeouts.get(fileName);
    clearTimeout(timeoutId);
    activeDownloadTimeouts.delete(fileName);
    console.log(`✅ Timeout cancellato per errore download di: ${fileName}`);
  }
  
  // Ripristina lo stato visivo dei file in caso di errore
  const fileElements = document.querySelectorAll('.folder.is-file');
  fileElements.forEach(element => {
    if (element.innerHTML.includes(fileName)) {
      element.style.backgroundColor = '';
      element.style.opacity = '1';
      
      const statusDiv = element.querySelector('div:last-child');
      if (statusDiv && (statusDiv.innerHTML === '⏳ Download in corso...' || statusDiv.innerHTML.includes('📥'))) {
        statusDiv.innerHTML = '📥 Clicca per scaricare';
        statusDiv.style.color = '#666';
      }
      
      // Riabilita il click per il download
      element.onclick = () => {
        const fileData = allFiles.find(f => f.name === fileName);
        if (fileData) {
          downloadFile(fileData.id, fileData.name);
        }
      };
    }
  });
});

// ——— Upload Response Listeners ———

// Listener per successo upload
socket.on('upload_success', ({ uploadId, fileName }) => {
  console.log(`✅ Upload completato con successo: ${fileName}`);
  updateUploadProgress(uploadId, 100, 'completed');
  updateStatusConnected('connected', `✅ File "${fileName}" caricato sul telefono!`);
});

// Listener per errore upload
socket.on('upload_error', ({ uploadId, fileName, error }) => {
  console.error(`❌ Errore upload ${fileName}: ${error}`);
  updateUploadProgress(uploadId, 0, 'error');
  alert(`❌ Impossibile caricare ${fileName}\nMotivo: ${error}`);
});

// ——— Folder Creation Response Listeners ———

// Listener per successo creazione cartella
socket.on('folder_created_success', ({ folderName, parentFolderId }) => {
  console.log(`✅ Cartella "${folderName}" creata con successo`);
  updateStatusConnected('connected', `✅ Cartella "${folderName}" creata con successo!`);
  
  // La lista file verrà aggiornata automaticamente quando il mobile invierà la nuova lista
});

// Listener per errore creazione cartella
socket.on('folder_creation_error', ({ folderName, error }) => {
  console.error(`❌ Errore creazione cartella "${folderName}": ${error}`);
  alert(`❌ Impossibile creare la cartella "${folderName}"\nMotivo: ${error}`);
  updateStatusConnected('connected', `❌ Errore nella creazione della cartella "${folderName}"`);
});

// ——— File Deletion Response Listeners ———

// Listener per successo eliminazione file
socket.on('file_deleted_success', ({ fileName }) => {
  console.log(`✅ File "${fileName}" eliminato con successo`);
  updateStatusConnected('connected', `✅ File "${fileName}" eliminato con successo!`);
  
  // La lista file verrà aggiornata automaticamente quando il mobile invierà la nuova lista
});

// Listener per errore eliminazione file
socket.on('file_deletion_error', ({ fileName, error }) => {
  console.error(`❌ Errore eliminazione file "${fileName}": ${error}`);
  alert(`❌ Impossibile eliminare il file "${fileName}"\nMotivo: ${error}`);
  updateStatusConnected('connected', `❌ Errore nell'eliminazione del file "${fileName}"`);
});

// ——— Folder Deletion Response Listeners ———

// Listener per successo eliminazione cartella
socket.on('folder_deleted_success', ({ folderName }) => {
  console.log(`✅ Cartella "${folderName}" eliminata con successo`);
  updateStatusConnected('connected', `✅ Cartella "${folderName}" eliminata con successo!`);
  
  // La lista file verrà aggiornata automaticamente quando il mobile invierà la nuova lista
});

// Listener per errore eliminazione cartella
socket.on('folder_deletion_error', ({ folderName, error }) => {
  console.error(`❌ Errore eliminazione cartella "${folderName}": ${error}`);
  alert(`❌ Impossibile eliminare la cartella "${folderName}"\nMotivo: ${error}`);
  updateStatusConnected('connected', `❌ Errore nell'eliminazione della cartella "${folderName}"`);
});

// ——— Rename Response Listeners ———

// Listener per successo rinomina file
socket.on('file_rename_success', ({ fileName, newFileName }) => {
  console.log(`✅ File rinominato con successo: ${fileName} -> ${newFileName}`);
  updateStatusConnected('connected', `✅ File "${fileName}" rinominato in "${newFileName}" con successo!`);
  
  // Il mobile invierà automaticamente la lista aggiornata, quindi non serve fare altro qui
});

// Listener per errore rinomina file
socket.on('file_rename_error', ({ fileName, error }) => {
  console.error(`❌ Errore rinomina file ${fileName}:`, error);
  updateStatusConnected('connected', `❌ Errore durante la rinomina di "${fileName}": ${error}`);
  
  // Mostra alert per rendere l'errore più visibile all'utente
  alert(`⚠️ Impossibile rinominare "${fileName}"\n\nMotivo: ${error}`);
});

// Listener per successo rinomina cartella
socket.on('folder_rename_success', ({ folderName, newFolderName }) => {
  console.log(`✅ Cartella rinominata con successo: ${folderName} -> ${newFolderName}`);
  updateStatusConnected('connected', `✅ Cartella "${folderName}" rinominata in "${newFolderName}" con successo!`);
  
  // Il mobile invierà automaticamente la lista aggiornata, quindi non serve fare altro qui
});

// Listener per errore rinomina cartella
socket.on('folder_rename_error', ({ folderName, error }) => {
  console.error(`❌ Errore rinomina cartella ${folderName}:`, error);
  updateStatusConnected('connected', `❌ Errore durante la rinomina di "${folderName}": ${error}`);
  
  // Mostra alert per rendere l'errore più visibile all'utente
  alert(`⚠️ Impossibile rinominare la cartella "${folderName}"\n\nMotivo: ${error}`);
});
