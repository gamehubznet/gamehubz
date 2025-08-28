const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const GameHUBZUpdater = require('./updater');

let mainWindow;
let updater;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#11100F',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  
  mainWindow.loadFile(path.join(__dirname, '', 'index.html'));
  
  // Créer le menu avec option de mise à jour
  createApplicationMenu();
}

function createApplicationMenu() {
  const template = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Quitter',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload', label: 'Actualiser' },
        { role: 'forceReload', label: 'Actualiser (forcé)' },
        { role: 'toggleDevTools', label: 'Outils de développement' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Zoom avant' },
        { role: 'zoomOut', label: 'Zoom arrière' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' }
      ]
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'À propos de GameHUBZ',
          click: () => {
            const version = require('../package.json').version;
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'À propos de GameHUBZ',
              message: 'GameHUBZ',
              detail: `Version : ${version}\nGestionnaire de bibliothèque de jeux unifié\n\n© 2024 GameHUBZ`,
              buttons: ['OK']
            });
          }
        },
        {
          label: 'Vérifier les mises à jour',
          click: () => {
            if (updater) {
              updater.checkForUpdates(true);
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC pour les mises à jour depuis le renderer
ipcMain.handle('check-for-updates', async () => {
  if (updater) {
    return await updater.checkForUpdates(true);
  }
});

ipcMain.handle('get-app-version', () => {
  return require('../package.json').version;
});

app.whenReady().then(() => {
  createWindow();
  
  // Initialiser le système de mise à jour
  updater = new GameHUBZUpdater();
  
  // Activer la vérification automatique (toutes les 24h)
  updater.enableAutoCheck(24);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
