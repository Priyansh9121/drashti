import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { app, dialog, session } from 'electron';
import { join } from 'node:path';
import type { AppInfo } from '../shared/app-info';
import { IPC } from '../shared/ipc';
import { idSchema } from '../shared/model-schema';
import type { OutputContext } from '../shared/screens';
import type { Db } from './db/database';
import { openDatabase } from './db/database';
import { DbSlideSource, PresentationRepo } from './db/presentations';
import { ScreenRepo } from './db/screens';
import { seedPlaceholders } from './db/seed';
import { ShowEngine } from './engine/show-engine';
import { runEngineCommand } from './ipc/engine-ipc';
import { handle } from './ipc/handle';
import { log } from './log';
import { installMenu } from './menu';
import { createdGroupId, runWatchdogSelfTest } from './selftest';
import { createOutputWindow, listDisplays, watchDisplays } from './outputs/electron-outputs';
import { OutputManager } from './outputs/output-manager';
import { ScreensService } from './outputs/screens-service';
import { IpcTransport } from './transport/ipc-transport';
import { createOperatorWindow } from './windows/operator-window';
import { RendererWatchdog, shouldConfirmQuit } from './watchdog';
import { applySessionSecurity, secureWebContents } from './windows/security';

// Tests (and multiple installs) can point Drashti at its own data folder.
const userDataOverride = process.env['DRASHTI_USER_DATA_DIR'];
if (userDataOverride) app.setPath('userData', userDataOverride);
// Development only: outputs as normal windows, for machines with one screen.
const windowedOutputs = process.env['DRASHTI_WINDOWED_OUTPUTS'] === '1';
// A Diagnostics menu for the manual watchdog check (see README).
const diagnostics = process.env['DRASHTI_DIAGNOSTICS'] === '1';
// Automated tests cannot answer the quit confirmation.
const noQuitConfirm = process.env['DRASHTI_NO_QUIT_CONFIRM'] === '1';
// Headless watchdog self-test: run it, print the result, exit (see README).
const selfTest = process.env['DRASHTI_SELFTEST'] === 'watchdog';

const watchdog = new RendererWatchdog((e) => {
  const text = `Watchdog: ${e.window} ${e.kind}${e.reason ? ` (${e.reason})` : ''}`;
  if (e.kind === 'crashed' || e.kind === 'hung' || e.kind === 'gave-up') log.warn(text);
  else log.info(text);
});
// Readable from the main process in end-to-end tests.
(globalThis as { drashtiDiagnostics?: unknown }).drashtiDiagnostics = { watchdog };
let quitConfirmed = false;

let operatorWindow: BrowserWindow | null = null;
let db: Db | null = null;
let outputs: OutputManager | null = null;

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

const fromOperator = (event: IpcMainInvokeEvent) => event.sender.id === operatorWindow?.webContents.id;
const notAllowed = { ok: false as const, message: 'Only the operator window can change the screens.' };

function start(): void {
  applySessionSecurity(session.defaultSession);

  db = openLibrary();
  if (!db) {
    app.quit();
    return;
  }
  const presentations = new PresentationRepo(db);
  const slides = new DbSlideSource(presentations);
  const screenRepo = new ScreenRepo(db);

  const transport = new IpcTransport((error, target) => {
    log.warn(`Could not send an engine message to window ${target.id}`, error);
  });
  const engine = new ShowEngine(slides, transport);

  // ---- outputs ----------------------------------------------------------
  const outputWindows = new Map<string, BrowserWindow>();
  const contextFor = (screenId: string): OutputContext | null => {
    const s = screenRepo.screen(screenId);
    if (!s) return null;
    const displayId = manager.status().find((st) => st.screenId === screenId)?.displayId;
    const d = listDisplays().find((x) => x.id === displayId);
    return {
      screenId: s.id,
      screenName: s.name,
      groupName: screenRepo.groupName(s.groupId) ?? '',
      canvasWidth: s.canvasWidth,
      canvasHeight: s.canvasHeight,
      scaling: s.scaling,
      display: d
        ? {
            pixelWidth: d.pixelWidth,
            pixelHeight: d.pixelHeight,
            refreshHz: d.refreshHz,
            scaleFactor: d.scaleFactor,
          }
        : null,
    };
  };
  const manager = new OutputManager({
    listDisplays,
    screens: () => screenRepo.screens(),
    saveDisplayKey: (id, key) => {
      screenRepo.setDisplayKey(id, key);
    },
    openWindow: (config, display) => {
      log.info(
        `Opening output "${config.name}" on ${display.label || display.id} (${display.pixelWidth}x${display.pixelHeight} @ ${display.refreshHz} Hz)`,
      );
      const { window, handle: h } = createOutputWindow(config, display, { windowed: windowedOutputs });
      outputWindows.set(config.id, window);
      watchdog.watch(window.webContents, `output "${config.name}"`);
      window.on('closed', () => {
        if (outputWindows.get(config.id) === window) outputWindows.delete(config.id);
      });
      return h;
    },
    onChange: () => {
      if (operatorWindow && !operatorWindow.isDestroyed()) {
        operatorWindow.webContents.send(IPC.screens.changed, screens.snapshot());
      }
      for (const [screenId, win] of outputWindows) {
        const context = contextFor(screenId);
        if (context && !win.isDestroyed()) win.webContents.send(IPC.output.context, context);
      }
    },
  });
  outputs = manager;
  const screens = new ScreensService(screenRepo, manager, listDisplays);

  // ---- IPC ----------------------------------------------------------------
  handle(IPC.app.getInfo, () => appInfo());
  handle(IPC.engine.subscribe, (event) => {
    transport.add(event.sender);
    return engine.snapshot();
  });
  handle(IPC.engine.snapshot, () => engine.snapshot());
  handle(IPC.engine.command, (event, command) => runEngineCommand(engine, command, fromOperator(event)));
  handle(IPC.library.listPresentations, () => presentations.list());
  handle(IPC.library.getPresentation, (_event, id) => {
    const parsed = idSchema.safeParse(id);
    return parsed.success ? presentations.get(parsed.data) : null;
  });
  handle(IPC.screens.get, () => screens.snapshot());
  handle(IPC.screens.createGroup, (e, name) => (fromOperator(e) ? screens.createGroup(name) : notAllowed));
  handle(IPC.screens.renameGroup, (e, id, name) =>
    fromOperator(e) ? screens.renameGroup(id, name) : notAllowed,
  );
  handle(IPC.screens.deleteGroup, (e, id) => (fromOperator(e) ? screens.deleteGroup(id) : notAllowed));
  handle(IPC.screens.assignDisplay, (e, groupId, displayId) =>
    fromOperator(e) ? screens.assignDisplay(groupId, displayId) : notAllowed,
  );
  handle(IPC.screens.updateScreen, (e, id, patch) =>
    fromOperator(e) ? screens.updateScreen(id, patch) : notAllowed,
  );
  handle(IPC.screens.removeScreen, (e, id) => (fromOperator(e) ? screens.removeScreen(id) : notAllowed));
  handle(IPC.screens.identify, (e) => {
    if (!fromOperator(e)) return null;
    for (const [screenId, win] of outputWindows) {
      const s = screenRepo.screen(screenId);
      if (s && !win.isDestroyed()) {
        win.webContents.send(IPC.output.identify, {
          name: s.name,
          groupName: screenRepo.groupName(s.groupId) ?? '',
        });
      }
    }
    return null;
  });
  handle(IPC.output.getContext, (event) => {
    const screenId = manager.screenIdFor(event.sender.id);
    return screenId ? contextFor(screenId) : null;
  });

  // ---- windows --------------------------------------------------------------
  const showingCount = () => manager.status().filter((st) => st.state === 'showing').length;
  /** Ask before anything that would black out the screens. Returns true when it is fine to quit. */
  const confirmQuit = (): boolean => {
    if (!shouldConfirmQuit(showingCount(), quitConfirmed, noQuitConfirm)) return true;
    const parent = operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : undefined;
    const options = {
      type: 'warning' as const,
      buttons: ['Keep showing', 'Quit Drashti'],
      defaultId: 0,
      cancelId: 0,
      message: 'Quit Drashti?',
      detail: `${showingCount()} screen(s) are showing. If Drashti quits, they go black.`,
    };
    const choice = parent ? dialog.showMessageBoxSync(parent, options) : dialog.showMessageBoxSync(options);
    quitConfirmed = choice === 1;
    return quitConfirmed;
  };

  operatorWindow = createOperatorWindow();
  watchdog.watch(operatorWindow.webContents, 'operator');
  operatorWindow.on('close', (event) => {
    if (!confirmQuit()) event.preventDefault();
  });
  operatorWindow.on('closed', () => {
    operatorWindow = null;
    // Output windows would otherwise keep the app alive.
    app.quit();
  });
  app.on('before-quit', (event) => {
    if (!confirmQuit()) event.preventDefault();
  });

  const runSelfTest = () =>
    runWatchdogSelfTest({
      operator: () => (operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : null),
      outputs: () => [...outputWindows.values()].filter((w) => !w.isDestroyed()),
      watchdog,
      dispatch: (command) => engine.dispatch(command),
      engineRev: () => engine.rev,
      firstPresentationId: () => presentations.list()[0]?.id ?? null,
      ensureOutput: async () => {
        if (showingCount() > 0) return () => undefined;
        const created = screens.createGroup('Watchdog self-test');
        const groupId = createdGroupId(created, 'Watchdog self-test');
        const display = listDisplays()[0];
        if (groupId && display) screens.assignDisplay(groupId, display.id);
        await new Promise((resolve) => setTimeout(resolve, 300));
        return () => {
          if (groupId) screens.deleteGroup(groupId);
        };
      },
    });

  installMenu({
    reloadOperator: () => {
      operatorWindow?.webContents.reload();
    },
    diagnostics: diagnostics
      ? {
          crashOperator: () => {
            operatorWindow?.webContents.forcefullyCrashRenderer();
          },
          crashOutputs: () => {
            for (const w of outputWindows.values())
              if (!w.isDestroyed()) w.webContents.forcefullyCrashRenderer();
          },
          runSelfTest: () => {
            void runSelfTest().then((result) => {
              const lines = result.checks.map(
                (c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` (${c.detail})` : ''}`,
              );
              const box = {
                type: result.passed ? ('info' as const) : ('error' as const),
                message: result.passed ? 'Watchdog self-test passed' : 'Watchdog self-test FAILED',
                detail: lines.join('\n'),
              };
              const parent = operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : undefined;
              if (parent) void dialog.showMessageBox(parent, box);
              else void dialog.showMessageBox(box);
            });
          },
        }
      : null,
  });
  if (selfTest) {
    operatorWindow.webContents.once('did-finish-load', () => {
      void runSelfTest().then(
        (result) => {
          process.stdout.write(`DRASHTI_SELFTEST_RESULT ${JSON.stringify(result)}\n`);
          app.exit(result.passed ? 0 : 1);
        },
        (error: unknown) => {
          const result = {
            passed: false,
            checks: [{ name: 'self-test ran', ok: false, detail: String(error) }],
          };
          process.stdout.write(`DRASHTI_SELFTEST_RESULT ${JSON.stringify(result)}\n`);
          app.exit(1);
        },
      );
    });
  }
  app.on('child-process-gone', (_event, details) => {
    log.warn(`A ${details.type} process stopped (${details.reason}); Chromium restarts it by itself.`);
  });

  // Restore the saved screen assignments, and follow display changes.
  manager.reconcile();
  watchDisplays(() => {
    manager.reconcile();
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

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('will-quit', () => {
    outputs?.closeAll();
    db?.close();
    db = null;
  });
}
