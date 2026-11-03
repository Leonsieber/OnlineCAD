// Takes real screenshots of the app for the website: `npm run build`, then
// `SHOT=0 npx electron website/tools/capture.cjs` (then SHOT=1, SHOT=2). Writes PNGs into website/assets/.
const { app, BrowserWindow, protocol, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'website', 'assets');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Each shot: a theme, then page steps (clicks by button text), then a file name. */
const SHOTS = [
  { file: 'app-bracket.png', theme: 'carbon', steps: ['Templates', 'Mounting bracket'] },
  { file: 'app-sketch.png', theme: 'carbon', steps: ['Templates', 'Mounting bracket', '@sketch'] },
  { file: 'app-light.png', theme: 'light', steps: ['Templates', 'Mounting bracket', '@realistic'] },
];

app.whenReady().then(async () => {
  const handler = async (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    try {
      return new Response(await fs.readFile(file), { headers: { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' } });
    } catch {
      return new Response(await fs.readFile(path.join(DIST, 'index.html')), { headers: { 'Content-Type': 'text/html' } });
    }
  };
  // Custom schemes are registered per session, and each shot has its own session.
  for (let i = 0; i < SHOTS.length; i++) session.fromPartition(`shot${i}`).protocol.handle('app', handler);
  await fs.mkdir(OUT, { recursive: true });
  // One shot per run (SHOT=0, 1, 2…): a second window in the same process fails to load app://.
  const only = Number(process.env.SHOT ?? 0);
  for (const [i, shot] of SHOTS.entries()) {
    if (i !== only) continue;
    // A fresh storage partition per shot, so one shot's service worker and settings don't leak into the next.
    const win = new BrowserWindow({ width: 1600, height: 1000, show: false, webPreferences: { partition: `shot${i}` } });
    await win.loadURL('app://onlinecad/');
    await win.webContents.executeJavaScript(`localStorage.setItem('onlinecad.theme', ${JSON.stringify(shot.theme)}); localStorage.setItem('onlinecad.prefs', JSON.stringify({ theme: ${JSON.stringify(shot.theme)}, display: 'shadedEdges', projection: 'perspective', grid: true, snap: 1, interaction: 'tinkercad' })); location.reload();`);
    await wait(2500);
    for (const step of shot.steps) {
      await win.webContents.executeJavaScript(`(async () => {
        const step = ${JSON.stringify(step)};
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const click = (text) => [...document.querySelectorAll('button')].find((b) => b.innerText.trim().split('\\n')[0] === text || b.innerText.trim().startsWith(text))?.click();
        if (step === '@sketch') {
          // Open the Sketch tab so the ribbon shows the sketch and solid tools.
          [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent === 'Sketch')?.click();
        } else if (step === '@realistic') {
          [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent === 'View')?.click();
          await wait(300);
          click('Realistic');
        } else click(step);
        await wait(step === 'Mounting bracket' ? 9000 : 800);
      })()`);
    }
    const img = await win.webContents.capturePage();
    await fs.writeFile(path.join(OUT, shot.file), img.toPNG());
    console.log('wrote', shot.file);
    win.destroy();
  }
  app.quit();
});
