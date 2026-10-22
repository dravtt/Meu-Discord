const { app } = require('electron');

/**
 * Checks for a new version before the main window opens, like the splash flow of desktop chat
 * apps: report progress to the splash, install right away if an update downloaded, otherwise
 * continue. Never blocks startup for more than `deadlineMs`.
 */
async function checkForUpdates(report, deadlineMs = 15000) {
  if (!app.isPackaged || process.env.NEXO_SKIP_UPDATE) return { updated: false };
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  return new Promise((resolve) => {
    const done = (result) => { clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => done({ updated: false, timedOut: true }), deadlineMs);
    autoUpdater.on('checking-for-update', () => report('Procurando atualizações…'));
    autoUpdater.on('update-not-available', () => done({ updated: false }));
    autoUpdater.on('download-progress', (p) => report(`Baixando atualização… ${Math.round(p.percent)}%`));
    autoUpdater.on('update-downloaded', () => {
      report('Instalando atualização…');
      clearTimeout(timer);
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 800);
    });
    autoUpdater.on('error', (err) => {
      console.error('Update check failed', err);
      done({ updated: false, error: err.message });
    });
    autoUpdater.checkForUpdates().catch((err) => done({ updated: false, error: err.message }));
  });
}

module.exports = { checkForUpdates };
