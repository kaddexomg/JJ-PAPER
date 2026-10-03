// JJ Paper Desktop — Main Process (Electron 22 / Windows 7, 10, 11)
const { app, BrowserWindow, Menu, globalShortcut, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Optimización para Windows 7 / GPUs integradas antiguas
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');

let mainWindow = null;

// Cargar configuración local de la app
let appConfig = {
  startUrl: 'http://localhost:3300',
  fallbackUrl: 'https://jj-paper.pages.dev',
  kioskMode: false,
  zoomFactor: 1.0
};

const configPath = path.join(__dirname, 'desktop-config.json');
try {
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    appConfig = Object.assign(appConfig, JSON.parse(raw));
  }
} catch (e) {
  console.warn('[CONFIG] Error cargando desktop-config.json:', e.message);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: 'JJ Paper C.A. — Sistema Administrativo & POS',
    icon: path.join(__dirname, '..', 'assets', 'img', 'icon-512.png'),
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false
    }
  });

  // Ocultar barra de menú por defecto para aspecto 100% de app instalada
  mainWindow.setMenuBarVisibility(false);

  // Cargar URL inicial (primero intenta el servidor local / LAN, luego Cloudflare Pages)
  const targetUrl = appConfig.startUrl || 'http://localhost:3300';
  mainWindow.loadURL(targetUrl).catch(() => {
    console.warn('[NAV] No se pudo conectar a', targetUrl, 'intentando fallback a', appConfig.fallbackUrl);
    if (appConfig.fallbackUrl) {
      mainWindow.loadURL(appConfig.fallbackUrl);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Manejar apertura de enlaces externos (abrir en navegador del sistema, no en la app)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      if (url.includes('wa.me') || url.includes('api.whatsapp.com') || url.includes('mail.google.com')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // Atajos globales de conveniencia para caja/POS
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow) mainWindow.webContents.toggleDevTools();
  });

  globalShortcut.register('CommandOrControl+R', () => {
    if (mainWindow) mainWindow.reload();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
