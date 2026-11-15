// CAM3D · Tectónica Studio · versión de escritorio (Windows y Mac)
const { app, BrowserWindow, protocol, net, shell, session, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

const ROOT = path.join(__dirname, 'www');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 600,
    backgroundColor: '#060b16', show: false, autoHideMenuBar: true, title: 'CAM3D',
    icon: path.join(ROOT, 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  win.loadURL('app://cam3d/index.html');
  return win;
}

function smoke(win) {
  // Prueba automática de arranque (solo en la compilación)
  const errs = [];
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 3) errs.push(msg); });
  win.webContents.on('did-fail-load', (e, code, desc, url) => errs.push('fail-load ' + desc + ' ' + url));
  win.webContents.once('did-finish-load', async () => {
    await new Promise(r => setTimeout(r, 7000));
    let res = {};
    try {
      res = await win.webContents.executeJavaScript(`(async () => ({
        app: !!window.CAM3D,
        desktop: !!window.CAM3D_DESKTOP,
        intro: !!document.getElementById('ienter'),
        three: await import('three').then(m => !!m.WebGLRenderer).catch(e => String(e)),
        csg: await import('three-bvh-csg').then(m => !!m.Evaluator).catch(e => String(e)),
        idb: await new Promise(r => { const q = indexedDB.open('cam3d_prueba'); q.onsuccess = () => r(true); q.onerror = () => r(false); })
      }))()`);
    } catch (e) { res.err = String(e); }
    console.log('CAM3D_SMOKE ' + JSON.stringify({ res, errs }));
    const ok = res.app && res.desktop && res.three === true && res.csg === true && res.idb === true;
    app.exit(ok ? 0 : 1);
  });
  setTimeout(() => { console.log('CAM3D_SMOKE tiempo agotado ' + JSON.stringify(errs)); app.exit(2); }, 60000);
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT)) return new Response('Acceso denegado', { status: 403 });
    return net.fetch(pathToFileURL(f).toString());
  });
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }])
    : null);
  const win = createWindow();
  if (process.env.CAM3D_SMOKE) smoke(win);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin' || process.env.CAM3D_SMOKE) app.quit(); });
