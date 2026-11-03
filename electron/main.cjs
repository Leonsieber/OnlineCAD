// OnlineCAD desktop app (Electron). It serves the built web app from dist/ over a private app://
// scheme, which behaves like a normal https origin, so the geometry worker and its WebAssembly
// load exactly as they do in the browser. Projects are kept in the app's own storage.
const { app, BrowserWindow, Menu, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

async function serve(request) {
  const { pathname } = new URL(request.url);
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.normalize(path.join(DIST, rel));
  // Never serve anything outside the app folder.
  if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
  try {
    const body = await fs.readFile(file);
    return new Response(body, { headers: { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' } });
  } catch {
    // Unknown paths (like ?share links) get the app itself.
    const body = await fs.readFile(path.join(DIST, 'index.html'));
    return new Response(body, { headers: { 'Content-Type': 'text/html' } });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0f13',
    title: 'OnlineCAD',
    icon: path.join(DIST, 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Links to other sites (docs, sign-in providers) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  void win.loadURL('app://onlinecad/');
  if (process.env.ONLINECAD_SMOKE) smokeTest(win);
}

/** ONLINECAD_SMOKE=1: check that the app renders and the WebAssembly is served, then quit. */
function smokeTest(win) {
  win.webContents.once('did-finish-load', async () => {
    // Open a new project and wait for the empty-state card, which only shows once the geometry
    // worker and its WebAssembly are running.
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(1500);
      const home = document.body.innerText.includes('Projects');
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'New')?.click();
      let kernel = false;
      for (let i = 0; i < 60 && !kernel; i++) {
        await wait(500);
        kernel = document.body.innerText.includes('Start modelling');
      }
      return JSON.stringify({ home, kernel, title: document.title });
    })()`);
    console.log('SMOKE', result);
    app.quit();
  });
}

app.whenReady().then(() => {
  protocol.handle('app', serve);
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
