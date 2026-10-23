const {
  app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, nativeImage, session, desktopCapturer, dialog,
} = require('electron');
const path = require('node:path');
const settings = require('./settings');
const { checkForUpdates } = require('./updater');
const { runningGame } = require('./games');

const ASSETS = path.join(__dirname, '..', 'assets');
const PROTOCOL = 'nexo';

let splash = null;
let mainWindow = null;
let tray = null;
let quitting = false;
let pendingInvite = null;

if (!settings.get('hardwareAcceleration')) app.disableHardwareAcceleration();

// One instance only; a second launch (or a nexo:// link) focuses the running one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    handleDeepLink(argv.find((a) => a.startsWith(`${PROTOCOL}://`)));
    showMain();
  });
}

if (process.defaultApp) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient(PROTOCOL);
app.on('open-url', (e, url) => { e.preventDefault(); handleDeepLink(url); });

/** nexo://convite/CODE opens the invite in the app. */
function handleDeepLink(url) {
  const match = url && /^nexo:\/\/convite\/([\w-]+)/.exec(url);
  if (!match) return;
  // The web app watches the hash for invite links.
  if (mainWindow) mainWindow.webContents.executeJavaScript(`location.hash = '#/convite/${match[1]}'`).catch(() => {});
  else pendingInvite = match[1];
}

const serverUrl = () => settings.get('serverUrl').replace(/\/+$/, '');
const serverOrigin = () => new URL(serverUrl()).origin;

/** IPC is accepted only from our own top-level page, never from iframes or other origins. */
function fromApp(event) {
  const frame = event.senderFrame;
  if (!mainWindow || !frame || event.sender !== mainWindow.webContents || frame !== mainWindow.webContents.mainFrame) return false;
  try { return new URL(frame.url).origin === serverOrigin(); } catch { return false; }
}

function createSplash() {
  splash = new BrowserWindow({
    width: 300, height: 340, frame: false, resizable: false, show: false, backgroundColor: '#0f1115',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'splash', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  splash.loadFile(path.join(__dirname, 'splash', 'index.html'));
  splash.once('ready-to-show', () => splash.show());
  splash.on('closed', () => { splash = null; });
}

function splashStatus(text, failed = false) {
  splash?.webContents.send('splash:status', { text, failed });
}

async function serverReachable() {
  try {
    const res = await fetch(`${serverUrl()}/api/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function boot() {
  splashStatus('Procurando atualizações…');
  const update = await checkForUpdates(splashStatus);
  if (update.updated) return; // the app restarts into the new version
  splashStatus('Conectando…');
  if (!(await serverReachable())) {
    splashStatus(`Sem conexão com ${serverUrl()}`, true);
    return;
  }
  splashStatus('Carregando…');
  createMainWindow();
}

function createMainWindow() {
  const bounds = settings.get('windowBounds');
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 940,
    minHeight: 500,
    show: false,
    backgroundColor: '#1c212a',
    title: 'Voka',
    icon: path.join(ASSETS, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  mainWindow.loadURL(serverUrl());

  mainWindow.once('ready-to-show', () => {
    if (settings.get('isMaximized')) mainWindow.maximize();
    if (!settings.get('startMinimized') && !process.argv.includes('--minimized')) mainWindow.show();
    splash?.close();
    if (pendingInvite) handleDeepLink(`${PROTOCOL}://convite/${pendingInvite}`);
    pendingInvite = null;
  });

  // Links to other sites open in the default browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== serverOrigin()) { e.preventDefault(); shell.openExternal(url); }
  });

  const saveBounds = () => {
    if (!mainWindow || mainWindow.isMinimized()) return;
    settings.set('isMaximized', mainWindow.isMaximized());
    if (!mainWindow.isMaximized()) settings.set('windowBounds', mainWindow.getBounds());
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // Closing hides to the tray, like other chat apps; quitting goes through the tray menu.
  mainWindow.on('close', (e) => {
    if (!quitting && settings.get('minimizeToTray') && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('focus', () => mainWindow.flashFrame(false));
}

function showMain() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'tray.png')));
  tray.setToolTip('Voka');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Abrir o Voka', click: showMain },
    { type: 'separator' },
    { label: 'Minimizar para a bandeja ao fechar', type: 'checkbox', checked: settings.get('minimizeToTray'), click: (i) => settings.set('minimizeToTray', i.checked) },
    { label: 'Iniciar com o sistema', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--minimized'] }) },
    { label: `Servidor: ${serverUrl()}`, enabled: false },
    { label: 'Trocar servidor…', click: changeServer },
    { type: 'separator' },
    { label: 'Sair do Voka', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', showMain);
  tray.on('right-click', () => tray.setContextMenu(menu()));
}

async function changeServer() {
  const choice = await dialog.showMessageBox({
    type: 'question',
    message: 'Endereço do servidor do Voka',
    detail: `Atual: ${serverUrl()}\n\nPara trocar, inicie o app com a variável NEXO_URL ou edite o arquivo:\n${path.join(app.getPath('userData'), 'settings.json')}`,
    buttons: ['Abrir pasta de configurações', 'Fechar'],
  });
  if (choice.response === 0) shell.openPath(app.getPath('userData'));
}

/* ---------- IPC from the web app ---------- */

ipcMain.on('nexo:notify', (event, { title, body, channelId }) => {
  if (!fromApp(event) || !Notification.isSupported()) return;
  const n = new Notification({ title: title.slice(0, 120), body: body.slice(0, 300), icon: path.join(ASSETS, 'icon.png') });
  n.on('click', () => { showMain(); mainWindow?.webContents.send('nexo:notification-click', channelId); });
  n.show();
  if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
});

ipcMain.on('nexo:badge', (event, count) => {
  if (!fromApp(event)) return;
  const n = Math.max(0, Math.min(999, Number(count) || 0));
  app.setBadgeCount(n);
  if (process.platform === 'win32' && mainWindow) {
    mainWindow.setOverlayIcon(n > 0 ? nativeImage.createFromPath(path.join(ASSETS, 'badge.png')) : null, n > 0 ? `${n} menções` : '');
  }
  tray?.setToolTip(n > 0 ? `Voka — ${n} menções` : 'Voka');
});

ipcMain.handle('nexo:running-game', (event) => (fromApp(event) ? runningGame() : null));

const EDITABLE = new Set(['minimizeToTray', 'startMinimized', 'hardwareAcceleration']);
ipcMain.handle('nexo:get-settings', (event) => {
  if (!fromApp(event)) return null;
  return Object.fromEntries([...EDITABLE].map((k) => [k, settings.get(k)]));
});
ipcMain.handle('nexo:set-setting', (event, key, value) => {
  if (!fromApp(event) || !EDITABLE.has(key) || typeof value !== 'boolean') return false;
  settings.set(key, value);
  return true;
});

/* Screen sharing: the web app shows its own picker with these thumbnails, then asks to share one. */
let pickedSource = null;
ipcMain.handle('nexo:screen-sources', async (event) => {
  if (!fromApp(event)) return [];
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 400, height: 225 }, fetchWindowIcons: true });
  const screens = sources.filter((s) => s.id.startsWith('screen:'));
  return sources
    .filter((s) => !s.thumbnail.isEmpty())
    .map((s) => ({
      id: s.id,
      name: s.id.startsWith('screen:') ? (screens.length > 1 ? `Tela ${screens.indexOf(s) + 1}` : 'Tela inteira') : s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined,
    }));
});
ipcMain.handle('nexo:screen-pick', (event, id, audio) => {
  if (!fromApp(event)) return false;
  pickedSource = { id: String(id), audio: !!audio, at: Date.now() };
  return true;
});

ipcMain.on('splash:retry', (event) => {
  if (splash && event.sender === splash.webContents) boot();
});

/* ---------- startup ---------- */

app.whenReady().then(() => {
  // Only our server may use camera, microphone, screen and notifications.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const allowed = ['media', 'notifications', 'clipboard-sanitized-write', 'display-capture'];
    let sameOrigin = false;
    try { sameOrigin = new URL(details.requestingUrl).origin === serverOrigin(); } catch {}
    callback(sameOrigin && allowed.includes(permission));
  });
  // Screen sharing: share what the user picked in Voka's own picker (or the main screen as a fallback).
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const pick = pickedSource && Date.now() - pickedSource.at < 30000 ? pickedSource : null;
    pickedSource = null;
    desktopCapturer.getSources({ types: ['screen', 'window'] })
      .then((sources) => {
        const video = (pick && sources.find((s) => s.id === pick.id)) || sources.find((s) => s.id.startsWith('screen:')) || sources[0];
        const audio = process.platform === 'win32' && (pick ? pick.audio : true) ? 'loopback' : undefined;
        callback(video ? { video, audio } : {});
      })
      .catch(() => callback({}));
  });

  createTray();
  createSplash();
  splash.webContents.once('did-finish-load', boot);
  handleDeepLink(process.argv.find((a) => a.startsWith(`${PROTOCOL}://`)));
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && (quitting || !tray)) app.quit();
});
app.on('activate', showMain);
