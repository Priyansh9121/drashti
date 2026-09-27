import { app, type BrowserWindow, session } from 'electron';
import { type AppInfo } from '../shared/app-info';
import { IPC } from '../shared/ipc';
import { ShowEngine } from './engine/show-engine';
import { MemorySlideSource } from './engine/slide-source';
import { runEngineCommand } from './ipc/engine-ipc';
import { handle } from './ipc/handle';
import { log } from './log';
import { IpcTransport } from './transport/ipc-transport';
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

function start(): void {
  applySessionSecurity(session.defaultSession);

  const transport = new IpcTransport((error, target) => {
    log.warn(`Could not send an engine message to window ${target.id}`, error);
  });
  const slides = new MemorySlideSource();
  const engine = new ShowEngine(slides, transport);

  handle(IPC.app.getInfo, () => appInfo());
  handle(IPC.engine.subscribe, (event) => {
    transport.add(event.sender);
    return engine.snapshot();
  });
  handle(IPC.engine.snapshot, () => engine.snapshot());
  handle(IPC.engine.command, (event, command) =>
    runEngineCommand(engine, command, event.sender.id === operatorWindow?.webContents.id),
  );

  operatorWindow = createOperatorWindow();
  operatorWindow.on('closed', () => {
    operatorWindow = null;
  });
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

  void app.whenReady().then(start);

  // Closing the operator window ends the show on every platform.
  app.on('window-all-closed', () => {
    app.quit();
  });
}
