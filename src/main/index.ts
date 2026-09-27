import { app, type BrowserWindow, ipcMain, session } from 'electron';
import { type AppInfo } from '../shared/app-info';
import { IPC } from '../shared/ipc';
import { createOperatorWindow } from './windows/operator-window';
import { applySessionSecurity, secureWebContents } from './windows/security';

// Tests (and multiple installs) can point Drashti at its own data folder.
const userDataOverride = process.env['DRASHTI_USER_DATA_DIR'];
if (userDataOverride) app.setPath('userData', userDataOverride);

let operatorWindow: BrowserWindow | null = null;

function appInfo(): AppInfo {
  return {
    name: 'Drashti',
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!operatorWindow) return;
    if (operatorWindow.isMinimized()) operatorWindow.restore();
    operatorWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => {
    secureWebContents(contents);
  });

  void app.whenReady().then(() => {
    applySessionSecurity(session.defaultSession);
    ipcMain.handle(IPC.app.getInfo, () => appInfo());
    operatorWindow = createOperatorWindow();
    operatorWindow.on('closed', () => {
      operatorWindow = null;
    });
  });

  // Closing the operator window ends the show on every platform.
  app.on('window-all-closed', () => {
    app.quit();
  });
}
