import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import {
  app,
  dialog,
  globalShortcut,
  powerSaveBlocker,
  protocol,
  screen as electronScreen,
  session,
} from 'electron';
import { mkdirSync } from 'node:fs';
import { monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import { isAbsolute, join } from 'node:path';
import type { AppInfo } from '../shared/app-info';
import type { ImportResult } from '../shared/import';
import { importOptionsSchema, importPathsSchema, runIdSchema } from '../shared/import-schema';
import { type EventChannel, type EventContract, IPC } from '../shared/ipc';
import { acceleratorFor } from '../shared/keymap';
import { MEDIA_ID_PATTERN, MEDIA_SCHEME } from '../shared/media';
import { idSchema } from '../shared/model-schema';
import { z } from 'zod';
import type { OutputContext } from '../shared/screens';
import type { Db } from './db/database';
import { LATEST_VERSION, openDatabase } from './db/database';
import { ImportRepo } from './db/imports';
import { MediaRepo } from './db/media';
import { SettingsRepo } from './db/settings';
import { DbSlideSource, PresentationRepo } from './db/presentations';
import { ScreenRepo } from './db/screens';
import { seedPlaceholders } from './db/seed';
import { ShowEngine } from './engine/show-engine';
import { runEngineCommand } from './ipc/engine-ipc';
import { handle, handlerTimes } from './ipc/handle';
import { ImportService } from './import/import-service';
import { spawnImportWorker } from './import/spawn-worker';
import { AudioOutput } from './audio/audio-output';
import { log } from './log';
import { handleMediaRequest, MEDIA_SCHEME_PRIVILEGES } from './media/media-protocol';
import { saveStill } from './media/stills';
import { installMenu } from './menu';
import { createdGroupId, runWatchdogSelfTest } from './selftest';
import {
  createOutputWindow,
  listDisplays,
  setExtraDisplays,
  watchDisplays,
} from './outputs/electron-outputs';
import { placeOperator } from './outputs/operator-guard';
import { OutputManager } from './outputs/output-manager';
import { ScreensService } from './outputs/screens-service';
import { SleepGuard } from './outputs/sleep-guard';
import { IpcTransport } from './transport/ipc-transport';
import { AUDIO_PARTITION, createAudioWindow } from './windows/audio-window';
import { createOperatorWindow } from './windows/operator-window';
import { RendererWatchdog, shouldConfirmQuit } from './watchdog';
import { applySessionSecurity, secureWebContents } from './windows/security';

// Tests (and multiple installs) can point Drashti at its own data folder.
const userDataOverride = process.env['DRASHTI_USER_DATA_DIR'];
if (userDataOverride) app.setPath('userData', userDataOverride);
// Development only: outputs as normal windows, for machines with one screen,
// optionally with pretend extra displays to try several outputs.
const windowedOutputs = process.env['DRASHTI_WINDOWED_OUTPUTS'] === '1';
if (windowedOutputs) setExtraDisplays(Number(process.env['DRASHTI_EXTRA_DISPLAYS'] ?? 0) || 0);
// A Diagnostics menu for the manual watchdog check (see README).
const diagnostics = process.env['DRASHTI_DIAGNOSTICS'] === '1';
// Automated tests cannot answer the quit confirmation.
const noQuitConfirm = process.env['DRASHTI_NO_QUIT_CONFIRM'] === '1';
// Headless watchdog self-test: run it, print the result, exit (see README).
const selfTest = process.env['DRASHTI_SELFTEST'] === 'watchdog';
// Log every permission a page checks or asks for (diagnosing sound output choice).
const logPermissions = process.env['DRASHTI_LOG_PERMISSIONS'] === '1';
// Tests only: answer media requests late, as a slow disk would.
const mediaDelayMs = Math.min(
  5000,
  Math.max(0, Number(process.env['DRASHTI_TEST_MEDIA_DELAY_MS'] ?? 0) || 0),
);

// Library media reaches the sandboxed windows only through drashti-media:// (see media/media-protocol.ts).
// Schemes must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { ...MEDIA_SCHEME_PRIVILEGES } }]);

const watchdog = new RendererWatchdog((e) => {
  const text = `Watchdog: ${e.window} ${e.kind}${e.reason ? ` (${e.reason})` : ''}`;
  if (e.kind === 'crashed' || e.kind === 'hung' || e.kind === 'gave-up') log.warn(text);
  else log.info(text);
});
// Screens never sleep or dim while an output is showing.
const sleepGuard = new SleepGuard(powerSaveBlocker, (held) => {
  log.info(held ? 'Display sleep is blocked while outputs show' : 'Display sleep allowed again');
});
// How long the main process's event loop stalls: everything the show does passes through it.
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();
// The longest garbage-collection pause in the main process.
const gc = { max: 0 };
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) gc.max = Math.max(gc.max, entry.duration);
}).observe({ entryTypes: ['gc'] });
// Readable from the main process in end-to-end tests.
(globalThis as { drashtiDiagnostics?: unknown }).drashtiDiagnostics = {
  watchdog,
  sleepGuard,
  loopDelay,
  handlerTimes,
  gc,
};
let quitConfirmed = false;

let operatorWindow: BrowserWindow | null = null;
let audioWindow: BrowserWindow | null = null;
let db: Db | null = null;
let outputs: OutputManager | null = null;
let importer: ImportService | null = null;

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

const libraryFile = () => join(app.getPath('userData'), 'drashti.sqlite');

function openLibrary(): Db | null {
  const file = libraryFile();
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
const idListSchema = z.array(idSchema).min(1).max(10_000);
/** What the Import files dialog offers (lyrics, the two presentation formats, media). */
const IMPORTABLE_EXTENSIONS = [
  'txt',
  'pro6',
  'pro6x',
  'pro6pl',
  'pro6plx',
  'pro6template',
  'pro',
  'probundle',
  'proplaylist',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'heic',
  'webp',
  'mp4',
  'm4v',
  'mov',
  'mp3',
  'wav',
  'm4a',
  'aiff',
];
const notAllowed = { ok: false as const, message: 'Only the operator window can change the screens.' };

function start(): void {
  const permissionLog = logPermissions
    ? (line: string) => {
        log.info(line);
      }
    : undefined;
  applySessionSecurity(session.defaultSession, { log: permissionLog });
  const audioSession = session.fromPartition(AUDIO_PARTITION);
  applySessionSecurity(audioSession, {
    isAudioPlayer: (contents) => contents !== null && contents.id === audioWindow?.webContents.id,
    log: permissionLog,
  });

  db = openLibrary();
  if (!db) {
    app.quit();
    return;
  }
  const presentations = new PresentationRepo(db);
  const slides = new DbSlideSource(presentations);
  const screenRepo = new ScreenRepo(db);
  const importRepo = new ImportRepo(db);
  // Removed presentations can be restored for 30 days.
  const purged = presentations.purgeRemoved(new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString());
  if (purged > 0) log.info(`Purged ${purged} presentation(s) removed more than 30 days ago`);

  const transport = new IpcTransport((error, target) => {
    log.warn(`Could not send an engine message to window ${target.id}`, error);
  });
  const engine = new ShowEngine(slides, transport);

  // ---- media ----------------------------------------------------------------
  const userDataDir = app.getPath('userData');
  const mediaDir = join(userDataDir, 'Media');
  mkdirSync(mediaDir, { recursive: true });
  const media = new MediaRepo(db);
  const serveMedia = async (request: Request) => {
    if (mediaDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, mediaDelayMs));
    return handleMediaRequest(request, {
      mediaDir,
      lookup: (id) => media.file(id),
      warn: (message) => {
        log.warn(message);
      },
    });
  };
  // Every window's session: the default one, and the audio player's own.
  protocol.handle(MEDIA_SCHEME, serveMedia);
  audioSession.protocol.handle(MEDIA_SCHEME, serveMedia);

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
      guardOperator();
      sleepGuard.update(manager.status().filter((st) => st.state === 'showing').length);
    },
  });
  outputs = manager;
  /** The display the operator window is on. Windowed (development) outputs never cover it. */
  const operatorDisplayId = (): number | null =>
    windowedOutputs || !operatorWindow || operatorWindow.isDestroyed()
      ? null
      : electronScreen.getDisplayMatching(operatorWindow.getBounds()).id;
  const screens = new ScreensService(screenRepo, manager, listDisplays, operatorDisplayId);

  // ---- keeping the operator's controls reachable ----------------------------
  const uncoverAccelerator = acceleratorFor('uncoverControls');
  let uncoverRegistered = false;
  const uncover = () => {
    const result = screens.uncoverOperator();
    const names = result.turnedOff ?? [];
    log.info(`Uncover the controls: turned off ${names.length > 0 ? names.join(', ') : 'nothing'}`);
    if (operatorWindow && !operatorWindow.isDestroyed()) {
      operatorWindow.show();
      operatorWindow.focus();
    }
  };
  /** Register the uncover shortcut system-wide only while an output covers the operator window. */
  const setUncoverShortcut = (covered: boolean) => {
    if (!uncoverAccelerator || covered === uncoverRegistered) return;
    if (covered) {
      uncoverRegistered = globalShortcut.register(uncoverAccelerator, uncover);
      if (!uncoverRegistered) log.warn(`Could not register ${uncoverAccelerator}; another app is using it.`);
    } else {
      globalShortcut.unregister(uncoverAccelerator);
      uncoverRegistered = false;
    }
  };
  /** Move the operator window off an output onto a free display, if there is one. */
  const guardOperator = () => {
    if (windowedOutputs || !operatorWindow || operatorWindow.isDestroyed()) return;
    const showing = new Set(
      manager
        .status()
        .flatMap((st) => (st.state === 'showing' && st.displayId !== null ? [st.displayId] : [])),
    );
    const target = placeOperator(operatorWindow.getBounds(), listDisplays(), showing);
    if (target) {
      log.info('The operator window was under an output; moving it to a free display.');
      operatorWindow.setBounds(target);
    }
    const here = operatorDisplayId();
    setUncoverShortcut(here !== null && showing.has(here));
  };

  // ---- imports ----------------------------------------------------------------
  const sendToOperator = <C extends EventChannel>(channel: C, payload: EventContract[C]) => {
    if (operatorWindow && !operatorWindow.isDestroyed()) operatorWindow.webContents.send(channel, payload);
  };
  // ---- sound ----------------------------------------------------------------
  const settings = new SettingsRepo(db);
  const audioOutput = new AudioOutput({
    load: () => settings.get('audioOutput'),
    save: (device) => {
      settings.set('audioOutput', device);
    },
    chosen: (device) => {
      if (audioWindow && !audioWindow.isDestroyed())
        audioWindow.webContents.send(IPC.audio.chosen, { device });
    },
    status: (status) => {
      sendToOperator(IPC.audio.status, status);
    },
    log: (message) => {
      log.info(message);
    },
  });
  const fromAudioPlayer = (event: IpcMainInvokeEvent) => event.sender.id === audioWindow?.webContents.id;

  // The operator's library list refreshes at most every 2 s during an import, and at once afterwards.
  let changedTimer: NodeJS.Timeout | null = null;
  let lastChanged = 0;
  const libraryChanged = (now = false) => {
    const send = () => {
      changedTimer = null;
      lastChanged = Date.now();
      sendToOperator(IPC.library.changed, { at: lastChanged });
    };
    if (now) {
      if (changedTimer) clearTimeout(changedTimer);
      send();
    } else {
      changedTimer ??= setTimeout(send, Math.max(0, lastChanged + 2000 - Date.now()));
    }
  };
  const imports = new ImportService({
    spawn: spawnImportWorker,
    worker: { dbFile: libraryFile(), mediaDir, userDataDir, schemaVersion: LATEST_VERSION },
    onProgress: (progress) => {
      sendToOperator(IPC.library.importProgress, progress);
    },
    onWrote: ({ presentationId, replaced }) => {
      if (replaced) slides.invalidate(presentationId);
      libraryChanged();
    },
    onFinished: () => {
      libraryChanged(true);
    },
    failRun: (runId, paths, message) => {
      importRepo.failRun(runId, paths, message);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  importer = imports;
  const importPaths = async (rawPaths: unknown, rawOptions: unknown): Promise<ImportResult> => {
    const paths = importPathsSchema.safeParse(rawPaths);
    const options = importOptionsSchema.safeParse(rawOptions ?? {});
    if (!paths.success) return { ok: false, message: 'Choose one or more files or folders to import.' };
    if (!options.success) return { ok: false, message: 'Those import options are not valid.' };
    if (!paths.data.every((p) => isAbsolute(p)))
      return { ok: false, message: 'Import needs full file paths.' };
    return imports.start(paths.data, options.data);
  };

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
  handle(IPC.library.importPaths, (e, paths, options) =>
    fromOperator(e)
      ? importPaths(paths, options)
      : { ok: false as const, message: 'Only the operator window can import.' },
  );
  handle(IPC.library.cancelImport, (e, runId) => {
    const parsed = runIdSchema.safeParse(runId);
    return fromOperator(e) && parsed.success ? imports.cancel(parsed.data) : false;
  });
  handle(IPC.library.listImportRuns, () => importRepo.listRuns());
  handle(IPC.library.pickImportPaths, async (e, kind) => {
    if (!fromOperator(e) || !operatorWindow) return [];
    const folder = kind === 'folder';
    const picked = await dialog.showOpenDialog(operatorWindow, {
      title: folder ? 'Import a folder' : 'Import files',
      buttonLabel: 'Import',
      properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'],
      ...(folder
        ? {}
        : {
            filters: [
              { name: 'Lyrics, presentations and media', extensions: IMPORTABLE_EXTENSIONS },
              { name: 'All files', extensions: ['*'] },
            ],
          }),
    });
    return picked.canceled ? [] : picked.filePaths;
  });
  handle(IPC.library.relinkMedia, async (e, ids) => {
    const parsed = idListSchema.optional().safeParse(ids);
    if (!fromOperator(e) || !operatorWindow || !parsed.success) {
      return { ok: false as const, message: 'Only the operator window can relink media.' };
    }
    const picked = await dialog.showOpenDialog(operatorWindow, {
      title: 'Find missing media',
      buttonLabel: 'Look here',
      properties: ['openDirectory'],
    });
    const folder = picked.filePaths[0];
    if (picked.canceled || !folder) return { ok: false as const, message: 'No folder was chosen.' };
    return imports.relink(folder, parsed.data);
  });
  handle(IPC.library.removePresentations, (e, ids) => {
    const parsed = idListSchema.safeParse(ids);
    if (!fromOperator(e) || !parsed.success) return { ok: false as const, message: 'Nothing was removed.' };
    const removed = presentations.remove(parsed.data);
    for (const id of removed) slides.invalidate(id);
    log.info(`Removed ${removed.length} presentation(s)`);
    libraryChanged(true);
    return { ok: true as const, ids: removed };
  });
  handle(IPC.library.restorePresentations, (e, ids) => {
    const parsed = idListSchema.safeParse(ids);
    if (!fromOperator(e) || !parsed.success) return { ok: false as const, message: 'Nothing was restored.' };
    const restored = presentations.restore(parsed.data);
    for (const id of restored) slides.invalidate(id);
    log.info(`Restored ${restored.length} presentation(s)`);
    libraryChanged(true);
    return { ok: true as const, ids: restored };
  });
  handle(IPC.library.getImportReport, (_e, runId) => {
    const parsed = runIdSchema.safeParse(runId);
    return parsed.success ? importRepo.report(parsed.data) : null;
  });
  handle(IPC.media.saveStill, async (e, mediaId, jpeg) => {
    if (!fromOperator(e) || typeof mediaId !== 'string' || !MEDIA_ID_PATTERN.test(mediaId)) {
      return { ok: false as const, message: 'Only the operator window can keep still frames.' };
    }
    const file = media.file(mediaId);
    if (!file?.sha256 || file.missing) return { ok: false as const, message: 'That media item has no file.' };
    return saveStill(mediaDir, file.sha256, jpeg);
  });
  handle(IPC.audio.getOutput, () => audioOutput.status);
  handle(IPC.audio.setOutput, (e, device) =>
    fromOperator(e) ? audioOutput.choose(device) : audioOutput.status,
  );
  handle(IPC.audio.reportDevices, (e, devices, state) => {
    if (fromAudioPlayer(e)) audioOutput.report(devices, state);
    return null;
  });
  handle(IPC.screens.get, () => screens.snapshot());
  handle(IPC.screens.createGroup, (e, name) => (fromOperator(e) ? screens.createGroup(name) : notAllowed));
  handle(IPC.screens.renameGroup, (e, id, name) =>
    fromOperator(e) ? screens.renameGroup(id, name) : notAllowed,
  );
  handle(IPC.screens.deleteGroup, (e, id) => (fromOperator(e) ? screens.deleteGroup(id) : notAllowed));
  handle(IPC.screens.assignDisplay, (e, groupId, displayId, options) =>
    fromOperator(e) ? screens.assignDisplay(groupId, displayId, options) : notAllowed,
  );
  handle(IPC.screens.updateScreen, (e, id, patch, options) =>
    fromOperator(e) ? screens.updateScreen(id, patch, options) : notAllowed,
  );
  handle(IPC.screens.uncoverOperator, (e) => {
    if (!fromOperator(e)) return notAllowed;
    uncover();
    return { ok: true as const, snapshot: screens.snapshot() };
  });
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
  // The audio player once the operator window has loaded (or after 5 s whatever happens). Created
  // first, Chromium 152 can hand the operator window the audio player's list of sound outputs.
  let audioStarted = false;
  const startAudioPlayer = () => {
    if (audioStarted) return;
    audioStarted = true;
    audioWindow = createAudioWindow();
    watchdog.watch(audioWindow.webContents, 'audio player');
  };
  operatorWindow.webContents.once('did-finish-load', startAudioPlayer);
  setTimeout(startAudioPlayer, 5000);
  let moveTimer: NodeJS.Timeout | null = null;
  operatorWindow.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(guardOperator, 250);
  });
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
      audioPlayer: () => (audioWindow && !audioWindow.isDestroyed() ? audioWindow : null),
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
        if (groupId && display) screens.assignDisplay(groupId, display.id, { coverOperator: true });
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
    undo: {
      accelerator: acceleratorFor('undo'),
      run: () => {
        // Undo typing in a text field (as the standard Edit menu would); the page ignores the
        // message then, and otherwise undoes the last removal.
        operatorWindow?.webContents.undo();
        sendToOperator(IPC.app.undo, { at: Date.now() });
      },
    },
    uncoverControls: { accelerator: uncoverAccelerator, run: uncover },
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
    globalShortcut.unregisterAll();
    sleepGuard.release();
    importer?.stop();
    outputs?.closeAll();
    db?.close();
    db = null;
  });
}
