import { IPC_CHANNELS, DEFAULT_SERVER_ARGS, ProgressStatus } from './constants';
import { app, dialog, ipcMain, shell } from 'electron';
import log from 'electron-log/main';
import { findAvailablePort } from './utils';
import dotenv from 'dotenv';
import { AppWindow } from './main-process/appWindow';
import { PathHandlers } from './handlers/pathHandlers';
import { AppInfoHandlers } from './handlers/appInfoHandlers';
import { ComfyDesktopApp } from './main-process/comfyDesktopApp';
import { LevelOption } from 'electron-log';
import SentryLogging from './services/sentry';
import { DesktopConfig } from './store/desktopConfig';

dotenv.config();
log.initialize();
log.transports.file.level = (process.env.LOG_LEVEL as LevelOption) ?? 'info';

// Register the quit handlers regardless of single instance lock and before squirrel startup events.
// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  log.info('Window all closed');
  if (process.platform !== 'darwin') {
    log.info('Quitting ComfyUI because window all closed');
    app.quit();
  }
});

/**
 * Sentry needs to be initialized at the top level.
 */
SentryLogging.init();

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  log.info('App already running. Exiting...');
  app.quit();
} else {
  app.on('ready', () => {
    log.debug('App ready');

    startApp().catch((reason) => {
      log.error('Unhandled exception in app startup', reason);
      app.exit(2020);
    });
  });
}

async function startApp() {
  try {
    const store = await DesktopConfig.load(shell);
    if (!store) throw new Error('Unknown error loading app config on startup.');
  } catch (error) {
    log.error('Unhandled exception during config load', error);
    dialog.showErrorBox('User Data', `Unknown error whilst writing to user data folder:\n\n${error}`);
    app.exit(20);
    return;
  }

  try {
    const appWindow = new AppWindow();
    appWindow.onClose(() => {
      log.info('App window closed. Quitting application.');
      app.quit();
    });

    // Register basic handlers that are necessary during app's installation.
    new PathHandlers().registerHandlers();
    new AppInfoHandlers().registerHandlers();
    ipcMain.handle(IPC_CHANNELS.OPEN_DIALOG, (event, options: Electron.OpenDialogOptions) => {
      log.debug('Open dialog');
      return dialog.showOpenDialogSync({
        ...options,
      });
    });
    try {
      const comfyDesktopApp = await ComfyDesktopApp.create(appWindow);
      await comfyDesktopApp.initialize();
      SentryLogging.comfyDesktopApp = comfyDesktopApp;

      const useExternalServer = process.env.USE_EXTERNAL_SERVER === 'true';
      const cpuOnly: Record<string, string> = process.env.COMFYUI_CPU_ONLY === 'true' ? { cpu: '' } : {};
      const extraServerArgs: Record<string, string> = {
        ...comfyDesktopApp.comfySettings.get('Comfy.Server.LaunchArgs'),
        ...cpuOnly,
      };
      const host = process.env.COMFY_HOST ?? extraServerArgs.listen ?? DEFAULT_SERVER_ARGS.host;
      const targetPort = Number(process.env.COMFY_PORT ?? extraServerArgs.port ?? DEFAULT_SERVER_ARGS.port);
      const port = useExternalServer ? targetPort : await findAvailablePort(host, targetPort, targetPort + 1000);

      // Remove listen and port from extraServerArgs so core launch args are used instead.
      delete extraServerArgs.listen;
      delete extraServerArgs.port;

      if (!useExternalServer) {
        await comfyDesktopApp.startComfyServer({ host, port, extraServerArgs });
      }
      appWindow.sendServerStartProgress(ProgressStatus.READY);
      await appWindow.loadComfyUI({ host, port, extraServerArgs });
    } catch (error) {
      log.error('Unhandled exception during app startup', error);
      appWindow.sendServerStartProgress(ProgressStatus.ERROR);
      appWindow.send(IPC_CHANNELS.LOG_MESSAGE, error);
    }
  } catch (error) {
    log.error('Fatal error occurred during app pre-startup.', error);
    app.exit(2024);
  }
}
