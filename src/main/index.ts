import { app, type BrowserWindow, dialog, session } from 'electron';
import { join } from 'node:path';
import type { AppInfo } from '../shared/app-info';
import { IPC } from '../shared/ipc';
import { idSchema } from '../shared/model-schema';
import { type Db, openDatabase } from './db/database';
import { DbSlideSource, PresentationRepo } from './db/presentations';
import { seedPlaceholders } from './db/seed';
import { ShowEngine } from './engine/show-engine';
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
let db: Db | null = null;

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

function openLibrary(): Db | null {
  const file = join(app.getPath('userData'), 'drashti.sqlite');
  try {
    const opened = openDatabase(file);
    if (seedPlaceholders(opened)) log.info('Added the placeholder presentations');
    log.info(`Library: ${file}`);
    return opened;
  } catch (error) {
    log.error(`Could not open the library at ${file}`, error);
    dialog.showErrorBox(
      'Drashti cannot open its library',
      `${error instanceof Error ? error.message : String(error)}\n\nFile: ${file}`,
    );
    return null;
  }
}

function start(): void {
  applySessionSecurity(session.defaultSession);

  db = openLibrary();
  if (!db) {
    app.quit();
    return;
  }
  const presentations = new PresentationRepo(db);
  const slides = new DbSlideSource(presentations);

  const transport = new IpcTransport((error, target) => {
    log.warn(`Could not send an engine message to window ${target.id}`, error);
  });
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
  handle(IPC.library.listPresentations, () => presentations.list());
  handle(IPC.library.getPresentation, (_event, id) => {
    const parsed = idSchema.safeParse(id);
    return parsed.success ? presentations.get(parsed.data) : null;
  });

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

  app.on('will-quit', () => {
    db?.close();
    db = null;
  });
}
