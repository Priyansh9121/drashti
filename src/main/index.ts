import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import {
  app,
  crashReporter,
  dialog,
  globalShortcut,
  powerSaveBlocker,
  protocol,
  safeStorage,
  screen as electronScreen,
  session,
  systemPreferences,
} from 'electron';
import { mkdirSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { release as osRelease, tmpdir } from 'node:os';
import { monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import { basename, isAbsolute, join } from 'node:path';
import type { AppInfo } from '../shared/app-info';
import type { ImportResult } from '../shared/import';
import type { LibraryChange } from '../shared/library';
import { importOptionsSchema, importPathsSchema, runIdSchema } from '../shared/import-schema';
import { type EventChannel, type EventContract, IPC } from '../shared/ipc';
import { acceleratorFor } from '../shared/keymap';
import { MEDIA_ID_PATTERN, MEDIA_SCHEME } from '../shared/media';
import { idSchema } from '../shared/model-schema';
import { z } from 'zod';
import type { OutputContext } from '../shared/screens';
import type { MessageResult } from '../shared/messages';
import type { PropResult } from '../shared/props';
import { propFieldsSchema } from '../shared/props';
import { messageTemplateSchema } from '../shared/messages';
import type { TimerResult } from '../shared/timers';
import { timerFieldsSchema } from '../shared/timers';
import type { RecoveryNotice } from '../shared/recovery';
import { audioDeviceSchema } from '../shared/audio';
import type { SetupResult } from '../shared/setup';
import { setupPlanSchema, TEST_CARD_MS } from '../shared/setup';
import type { ModeResult, OperatorMode } from '../shared/mode';
import { isLeaveWord, isOperatorMode } from '../shared/mode';
import type { Db } from './db/database';
import { LATEST_VERSION, openDatabase } from './db/database';
import { ImportRepo } from './db/imports';
import { MediaRepo } from './db/media';
import { PlaylistRepo } from './db/playlists';
import { SearchIndex } from './db/search';
import { TimerRepo } from './db/timers';
import { ThemeRepo } from './db/themes';
import { PropRepo } from './db/props';
import { MessageRepo } from './db/messages';
import { SettingsRepo } from './db/settings';
import { DbSlideSource, PresentationRepo } from './db/presentations';
import { ScreenRepo } from './db/screens';
import { seedPlaceholders, seedTemplates } from './db/seed';
import { ShowEngine } from './engine/show-engine';
import { runEngineCommand } from './ipc/engine-ipc';
import { handle, handlerTimes, lockChannels, refusedNow } from './ipc/handle';
import { ImportService } from './import/import-service';
import { spawnImportWorker } from './import/spawn-worker';
import { AudioOutput } from './audio/audio-output';
import { saveDiagnostics } from './diagnostics';
import { log, logFiles, startLogFile } from './log';
import { LiveStateWriter, toRestore } from './recovery/live-state';
import { handleMediaRequest, MEDIA_SCHEME_PRIVILEGES } from './media/media-protocol';
import { saveStill } from './media/stills';
import { installMenu } from './menu';
import { runPerformanceTest } from './perftest';
import { registerPlaylistIpc } from './playlists/playlist-ipc';
import { applyPendingRestore, backupLibrary, requestRestore, rollBackRestore } from './library/backup';
import type { BackupUi } from './library/backup-ui';
import { backUp, restore } from './library/backup-ui';
import { Revisions } from './library/revisions';
import { applyTheme, themeLook } from './library/themes';
import { defaultTransition, registerSlidesIpc } from './library/slides-ipc';
import { registerThemesIpc } from './library/themes-ipc';
import { registerWordsIpc } from './library/words-ipc';
import { registerKirtansIpc } from './library/kirtans-ipc';
import { runRelaunchSelfTest } from './relaunch-selftest';
import { createdGroupId, runWatchdogSelfTest } from './selftest';
import { simpleModeRefusals } from './simple-mode';
import {
  createOutputWindow,
  listDisplays,
  setExtraDisplays,
  showDisplayNumber,
  watchDisplays,
} from './outputs/electron-outputs';
import { placeOperator } from './outputs/operator-guard';
import { OutputManager } from './outputs/output-manager';
import { ScreensService } from './outputs/screens-service';
import { SleepGuard } from './outputs/sleep-guard';
import { IpcTransport } from './transport/ipc-transport';
import { AUDIO_PARTITION, createAudioWindow } from './windows/audio-window';
import { openGalleryWindow } from './windows/gallery-window';
import { createOperatorWindow } from './windows/operator-window';
import { RendererWatchdog, shouldConfirmQuit } from './watchdog';
import { applySessionSecurity, secureWebContents } from './windows/security';
import { StreamProfileRepo } from './db/stream-profiles';
import { StreamKeyStore } from './stream/key-store';
import { applyStreamSessionSecurity, createProgramWindow, STREAM_PARTITION } from './stream/program-window';
import { StreamService } from './stream/stream-service';
import { findFfmpeg } from './stream/ffmpeg-path';
import { ffmpegSelfTest } from './stream/ffmpeg-selftest';
import { spawnStreamWorker } from './stream/stream-worker';
import { ConvertService } from './convert/convert-service';
import { diskFreeBytes } from './import/media-store';
import { startPerfStream } from './stream/perf-stream';
import { confirmedSchema } from '../shared/stream-schema';
import { FanoutTransport, type EngineTransport } from '../shared/engine/transport';
import type { PropItem } from '../shared/engine/state';
import { DeviceRepo } from './db/devices';
import { NetworkService } from './network/network-service';
import { AnnouncementService } from './network/announcement-service';
import { AnnouncementRepo } from './db/announcements';
import { inProcessNetworkWorker, spawnNetworkWorker } from './network/network-worker';
import { startPerfDevices } from './network/perf-devices';
import { localName } from './network/local-name';
import { isInside } from './media/media-protocol';
import { rendererDir } from './windows/renderer';
import { quietTests, startQuietTests } from './windows/quiet';

// Headless self-tests: run one, print the result, exit (see README). The performance test
// imports a few hundred placeholder files, so it gets a throwaway data folder of its own.
const selfTest = process.env['DRASHTI_SELFTEST'] === 'watchdog';
const perfTest = process.env['DRASHTI_SELFTEST'] === 'performance';
// Check the bundled FFmpeg (scripts/check-ffmpeg.mjs): print what works, and exit.
const ffmpegCheck = process.env['DRASHTI_SELFTEST'] === 'ffmpeg';
// The restart after a restore, for real (scripts/check-relaunch.mjs; see relaunch-selftest.ts).
const relaunchTest = process.env['DRASHTI_SELFTEST'] === 'restore-relaunch';
// Tests (and multiple installs) can point Drashti at its own data folder.
const userDataOverride = process.env['DRASHTI_USER_DATA_DIR'];
if (userDataOverride) app.setPath('userData', userDataOverride);
else if (perfTest) app.setPath('userData', mkdtempSync(join(tmpdir(), 'drashti-perf-')));
// The log goes to a rotating file in the data folder too (see log.ts), from the start.
startLogFile(join(app.getPath('userData'), 'logs'));
log.info(
  `Drashti ${app.getVersion()} (Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, Node ${process.versions.node}) on ${process.platform} ${osRelease()} ${process.arch}`,
);
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception in the main process', error);
});
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection in the main process', reason);
});
// Tests on a computer someone is using: never active, never covering the screen (windows/quiet.ts).
startQuietTests();
// Tests only: keep crash dumps in this folder (never sent anywhere), to read with Electron's symbols.
const crashDumps = process.env['DRASHTI_TEST_CRASH_DUMPS'];
if (crashDumps) {
  app.setPath('crashDumps', crashDumps);
  crashReporter.start({ uploadToServer: false, compress: false });
}
// Development only: outputs as normal windows, for machines with one screen,
// optionally with pretend extra displays to try several outputs. Always so in quiet test mode.
const windowedOutputs = process.env['DRASHTI_WINDOWED_OUTPUTS'] === '1' || quietTests;
if (windowedOutputs) setExtraDisplays(Number(process.env['DRASHTI_EXTRA_DISPLAYS'] ?? 0) || 0);
// A Diagnostics menu for the manual watchdog check (see README).
const diagnostics = process.env['DRASHTI_DIAGNOSTICS'] === '1';
// Automated tests cannot answer the quit confirmation.
const noQuitConfirm = process.env['DRASHTI_NO_QUIT_CONFIRM'] === '1';
// Tests only: after Restore Library… just quit (the test starts Drashti again itself).
const noRelaunch = process.env['DRASHTI_TEST_NO_RELAUNCH'] === '1';
// Log every permission a page checks or asks for (diagnosing sound output choice).
const logPermissions = process.env['DRASHTI_LOG_PERMISSIONS'] === '1';
// Tests only: answer media requests late, as a slow disk would.
const mediaDelayMs = Math.min(
  5000,
  Math.max(0, Number(process.env['DRASHTI_TEST_MEDIA_DELAY_MS'] ?? 0) || 0),
);

// Tests only: Chromium's fake camera and microphone (a moving test pattern and a beep) stand in for real ones.
// Only the device switch: the stream's page still captures its own real picture.
const fakeDevices = process.env['DRASHTI_TEST_FAKE_DEVICES'] === '1';
if (fakeDevices) app.commandLine.appendSwitch('use-fake-device-for-media-stream');
// Tests only: behave as if the system's secure storage for keys were missing.
const noSafeStorage = process.env['DRASHTI_TEST_NO_SAFE_STORAGE'] === '1';
// Tests only: the local network listens on this computer alone (no firewall questions), and can be
// told to treat this computer as outside the local network, to see such requests refused.
const networkLocalOnly = process.env['DRASHTI_TEST_NETWORK_LOCAL'] === '1';
const networkRefuseLoopback = process.env['DRASHTI_TEST_NETWORK_REFUSE_LOOPBACK'] === '1';
// Tests only: an announcement's minute is this many ms, so one can run out while a test watches.
const announceMinuteMs = Math.min(
  60_000,
  Math.max(100, Number(process.env['DRASHTI_TEST_ANNOUNCE_MINUTE_MS'] ?? 60_000) || 60_000),
);
// The performance check only: so many devices connected while it measures, and (to compare) the
// network's server in the main process instead of its own.
const perfDevices = Math.min(50, Math.max(0, Number(process.env['DRASHTI_PERF_DEVICES'] ?? 0) || 0));
const perfNetworkInMain = process.env['DRASHTI_PERF_NETWORK_IN_MAIN'] === '1';

// Library media reaches the sandboxed windows only through drashti-media:// (see media/media-protocol.ts).
// Schemes must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { ...MEDIA_SCHEME_PRIVILEGES } }]);

/** The watchdog's recent events, for diagnostics. */
const watchdogHistory: { at: string; window: string; kind: string; reason: string | null }[] = [];
const watchdog = new RendererWatchdog((e) => {
  watchdogHistory.push({
    at: new Date().toISOString(),
    window: e.window,
    kind: e.kind,
    reason: e.reason ?? null,
  });
  if (watchdogHistory.length > 200) watchdogHistory.splice(0, watchdogHistory.length - 200);
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

function openLibrary(): { db: Db } | { error: unknown } {
  try {
    const opened = openDatabase(libraryFile());
    try {
      if (seedPlaceholders(opened)) log.info('Added the placeholder presentations');
      if (seedTemplates(opened)) log.info('Added the example sabha templates');
    } catch (error) {
      opened.close();
      throw error;
    }
    log.info(`Library opened (schema ${LATEST_VERSION})`);
    return { db: opened };
  } catch (error) {
    log.error('Could not open the library', error);
    return { error };
  }
}

function cannotOpenLibrary(error: unknown, before = ''): void {
  dialog.showErrorBox(
    'Drashti cannot open its library',
    `${before}${error instanceof Error ? error.message : String(error)}\n\nFile: ${libraryFile()}`,
  );
}

/** Carry out a restore asked for before the restart, if there is one (ids and counts only in the log). */
function pendingRestore(): ReturnType<typeof applyPendingRestore> {
  try {
    const outcome = applyPendingRestore(app.getPath('userData'), {
      schema: LATEST_VERSION,
      app: app.getVersion(),
      now: new Date(),
    });
    if (outcome.restored)
      log.info(`Library restored from a backup (${outcome.media ? 'with' : 'without'} media)`);
    else if (outcome.code) log.warn(`A restore was asked for and not done (${outcome.code})`);
    return outcome;
  } catch (error) {
    // The code only: the error's message can hold a path.
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'error';
    log.error(`The restore stopped unexpectedly (${code})`);
    return {
      restored: false,
      code: 'copy-failed',
      message: 'The library was not restored: something went wrong (see the log). The library is as it was.',
    };
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

/**
 * The performance check, while streaming and recording when DRASHTI_PERF_STREAM names an
 * address on this computer (tests/perf/performance.spec.ts starts FFmpeg listening there).
 */
type PerfRun = Parameters<typeof runPerformanceTest>[0] & {
  stream: StreamService;
  network: NetworkService;
  operatorContents: () => Electron.WebContents | null;
};

/** The performance check with DRASHTI_PERF_DEVICES paired devices following the feed meanwhile. */
async function runPerformanceTestWithDevices(ctx: PerfRun): ReturnType<typeof runPerformanceTest> {
  if (perfDevices === 0) return runPerformanceTestWithStream(ctx);
  // DRASHTI_PERF_DEVICE_PAGES=1: each device also fetches the largest page files every second.
  const pages =
    process.env['DRASHTI_PERF_DEVICE_PAGES'] === '1'
      ? readdirSync(join(rendererDir(), 'assets'))
          .map((name) => ({ name, bytes: statSync(join(rendererDir(), 'assets', name)).size }))
          .sort((a, b) => b.bytes - a.bytes)
          .slice(0, 3)
          .map((f) => `/assets/${f.name}`)
      : [];
  const devices = await startPerfDevices(ctx.network, perfDevices, perfNetworkInMain, pages);
  try {
    const result = await runPerformanceTestWithStream(ctx);
    await devices.stop();
    return { ...result, summary: `${result.summary}; ${devices.summary()}` };
  } catch (error) {
    await devices.stop();
    throw error;
  }
}

async function runPerformanceTestWithStream(ctx: PerfRun): ReturnType<typeof runPerformanceTest> {
  const url = process.env['DRASHTI_PERF_STREAM'];
  const operator = ctx.operatorContents();
  if (!url || !operator) return runPerformanceTest(ctx);
  const folder = mkdtempSync(join(tmpdir(), 'drashti-perf-recording-'));
  const perf = await startPerfStream(ctx.stream, operator, url, folder);
  try {
    const result = await runPerformanceTest(ctx);
    return { ...result, summary: `${result.summary}; ${perf.summary()}` };
  } finally {
    await perf.stop();
  }
}

function start(): void {
  if (ffmpegCheck) {
    const path = findFfmpeg({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      platform: process.platform,
      arch: process.arch,
      override: process.env['DRASHTI_FFMPEG'],
    });
    void ffmpegSelfTest(path, process.platform).then((result) => {
      process.stdout.write(`DRASHTI_SELFTEST_RESULT ${JSON.stringify(result)}\n`);
      app.exit(result.passed ? 0 : 1);
    });
    return;
  }
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
  // The stream's page has a session of its own: the only one allowed a camera and a sound input.
  const streamSession = session.fromPartition(STREAM_PARTITION);
  applyStreamSessionSecurity(streamSession, {
    isProgram: (contents) => stream?.isProgram(contents) ?? false,
    log: permissionLog,
  });

  // A restore asked for before a restart is done first, before the library opens.
  const restored = pendingRestore();
  /** The operator window has read the start notice: later news goes as an ordinary notice. */
  let startNoticeTaken = false;
  let startNotice = restored.restored
    ? `Library restored from “${restored.from}”. The library from before is kept in Drashti’s data folder, in Backups/${restored.keptIn}.`
    : restored.message;
  let opened = openLibrary();
  if ('error' in opened && restored.restored) {
    // The restored library will not open: put back the one from before the restore, and say so.
    log.error('The restored library cannot be opened; putting back the library from before the restore');
    const back = rollBackRestore(app.getPath('userData'), restored.keptIn, { now: new Date() });
    if (!back.ok) {
      cannotOpenLibrary(opened.error, `${back.message}\n\n`);
      app.quit();
      return;
    }
    log.info('The library from before the restore is back');
    opened = openLibrary();
    startNotice = `The backup “${restored.from}” could not be opened after the restore, so Drashti put back the library from before it. The backup itself is unchanged; the copy that failed is in Drashti’s data folder, in Backups/${back.failedIn}.`;
  }
  if ('error' in opened) {
    cannotOpenLibrary(opened.error);
    app.quit();
    return;
  }
  db = opened.db;
  const libraryDb: Db = db;
  const presentations = new PresentationRepo(db);
  const slides = new DbSlideSource(presentations);
  const screenRepo = new ScreenRepo(db);
  const importRepo = new ImportRepo(db);
  const playlists = new PlaylistRepo(db);
  const themes = new ThemeRepo(db);
  themes.defaultId();
  // The search index is kept as presentations are written; a library indexed by an older version is redone once.
  const search = new SearchIndex(db);
  const indexStart = performance.now();
  if (search.rebuildIfStale())
    log.info(`Search index built in ${Math.round(performance.now() - indexStart)} ms`);
  // Removed presentations can be restored for 30 days.
  const purged = presentations.purgeRemoved(new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString());
  if (purged > 0) log.info(`Purged ${purged} presentation(s) removed more than 30 days ago`);
  const purgedLists = playlists.purgeRemoved(new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString());
  if (purgedLists > 0) log.info(`Purged ${purgedLists} playlist(s) or item(s) removed more than 30 days ago`);

  const transport = new IpcTransport((error, target) => {
    log.warn(`Could not send an engine message to window ${target.id}`, error);
  });
  // Settings kept in the library (the sound output, the mode, the logo, the default transition).
  const settings = new SettingsRepo(db);
  // The local network gets every engine message too (once it is on); it is made further down.
  let network: NetworkService | null = null;
  const networkTransport: EngineTransport = {
    broadcast: (message) => {
      network?.broadcast(message);
    },
  };
  const engine = new ShowEngine(
    slides,
    new FanoutTransport([transport, networkTransport]),
    Date.now,
    { items: (id) => playlists.playItems(id) },
    {
      defaultTransition: () => defaultTransition(settings),
    },
  );
  const timers = new TimerRepo(db);
  engine.setTimers(timers.list());

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
  streamSession.protocol.handle(MEDIA_SCHEME, serveMedia);

  // ---- outputs ----------------------------------------------------------
  const outputWindows = new Map<string, BrowserWindow>();
  /** Until when the setup wizard's test slide shows on every output (ms since the epoch). */
  let testCardUntil = 0;
  const contextFor = (screenId: string): OutputContext | null => {
    const s = screenRepo.screen(screenId);
    if (!s) return null;
    const displayId = manager.status().find((st) => st.screenId === screenId)?.displayId;
    const d = listDisplays().find((x) => x.id === displayId);
    return {
      screenId: s.id,
      screenName: s.name,
      groupName: screenRepo.groupName(s.groupId) ?? '',
      role: screenRepo.groupRole(s.groupId) ?? 'audience',
      languages: screenRepo.groupLanguages(s.groupId),
      testCardUntil: testCardUntil > Date.now() ? testCardUntil : null,
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
  let stream: StreamService | null = null;
  const screens = new ScreensService(
    screenRepo,
    manager,
    listDisplays,
    operatorDisplayId,
    () => stream?.inUse() ?? false,
  );

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

  // ---- restart recovery --------------------------------------------------------
  // What is live is saved as it changes; after an unexpected stop it goes back on the screens.
  const recoveryFiles = {
    state: join(userDataDir, 'live-state.json'),
    cleanMark: join(userDataDir, 'live-state.clean'),
  };
  const liveWriter = new LiveStateWriter(recoveryFiles, {
    log: (message) => {
      log.warn(message);
    },
  });
  engine.onChange((state) => {
    liveWriter.update(state);
  });
  let recovery: RecoveryNotice | null = null;
  // A restored library starts with nothing live (the saved state belongs to the library before it).
  const saved = restored.restored ? null : toRestore(recoveryFiles);
  if (saved) {
    const put = engine.restore(saved);
    const name = put.slide && saved.slide ? presentations.get(saved.slide.presentationId)?.name : undefined;
    recovery = {
      savedAt: saved.savedAt,
      slide:
        saved.slide && put.slide
          ? { presentationName: name ?? '', slideNumber: saved.slide.slideIndex + 1 }
          : null,
      slideGone: saved.slide !== null && !put.slide,
      background: put.background,
      blackout: put.blackout,
      logo: put.logo,
      audio: put.audio,
      props: put.props,
      messages: put.messages,
      ticker: put.ticker,
      stageMessage: put.stageMessage,
      timers: put.timers,
    };
    // Ids and counts only in the log (the notice itself names the presentation).
    const { slide: slideBack, ...alsoBack } = put;
    log.warn(
      `Recovery after an unexpected stop: ${JSON.stringify({
        slide:
          saved.slide && slideBack
            ? { presentationId: saved.slide.presentationId, slideIndex: saved.slide.slideIndex }
            : null,
        slideGone: recovery.slideGone,
        playlistItem: saved.playlist?.itemId ?? null,
        ...alsoBack,
      })}`,
    );
  }
  // Only a quit on purpose is clean (not a crash, and not the self-test's exit).
  app.on('will-quit', () => {
    liveWriter.markClean();
  });

  // ---- imports ----------------------------------------------------------------
  const sendToOperator = <C extends EventChannel>(channel: C, payload: EventContract[C]) => {
    if (operatorWindow && !operatorWindow.isDestroyed()) operatorWindow.webContents.send(channel, payload);
  };

  // ---- streaming -------------------------------------------------------------
  const streamKeys = new StreamKeyStore(
    join(app.getPath('userData'), 'stream-keys.json'),
    safeStorage,
    noSafeStorage,
  );
  stream = new StreamService({
    profiles: new StreamProfileRepo(db, (id) => streamKeys.has(id)),
    keys: streamKeys,
    settings,
    screens: screenRepo,
    createProgram: createProgramWindow,
    sendToOperator,
    platform: process.platform,
    mediaAccess: (kind) =>
      process.platform === 'darwin' || process.platform === 'win32'
        ? systemPreferences.getMediaAccessStatus(kind)
        : 'granted',
    askMediaAccess: (kind) =>
      process.platform === 'darwin' ? systemPreferences.askForMediaAccess(kind) : Promise.resolve(true),
    fakeDevices,
    titleMarks: (marks) => {
      if (operatorWindow && !operatorWindow.isDestroyed())
        operatorWindow.setTitle(marks ? `Drashti — ${marks}` : 'Drashti');
    },
    ffmpegPath: () =>
      findFfmpeg({
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        platform: process.platform,
        arch: process.arch,
        override: process.env['DRASHTI_FFMPEG'],
      }),
    spawnWorker: () =>
      spawnStreamWorker((line) => {
        log.info(`[stream worker] ${line}`);
      }),
    stateFile: join(app.getPath('userData'), 'stream-state.json'),
    notice: (text) => {
      sendToOperator(IPC.app.notice, { text });
    },
    now: Date.now,
    screensChanged: () => {
      sendToOperator(IPC.screens.changed, screens.snapshot());
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  const streaming = stream;
  app.on('will-quit', () => {
    streaming.close();
  });
  // After an unexpected stop while on air or recording: go again (within 5 minutes) or offer to,
  // once the operator window is up (so the operator sees it happen).
  const resumeStream = () => {
    const resumed = streaming.resumeAfterStop();
    if (!resumed) return;
    if (startNoticeTaken) sendToOperator(IPC.app.notice, { text: resumed });
    else startNotice = startNotice ? `${startNotice}\n\n${resumed}` : resumed;
  };
  // ---- sound ----------------------------------------------------------------
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

  // ---- Simple Mode ----------------------------------------------------------------
  // Remembered in the library's settings, so Drashti (and restart recovery) comes back in it.
  const savedMode = settings.get('operatorMode');
  let mode: OperatorMode = isOperatorMode(savedMode) ? savedMode : 'pro';
  if (mode === 'simple') log.info('Starting in Simple Mode');
  // While it is on, every request that would change the library, screens or sound is refused here.
  lockChannels(
    () => mode === 'simple',
    simpleModeRefusals(() => audioOutput.status),
  );
  let rebuildMenu: () => void = () => undefined;
  const setMode = (next: OperatorMode) => {
    if (next === mode) return;
    mode = next;
    settings.set('operatorMode', next);
    log.info(next === 'simple' ? 'Switched to Simple Mode' : 'Switched to Pro Mode');
    rebuildMenu();
    sendToOperator(IPC.app.modeChanged, { mode: next });
  };
  handle(IPC.app.getMode, () => mode);
  handle(IPC.app.setMode, (e, wanted, word): ModeResult => {
    if (!fromOperator(e) || !isOperatorMode(wanted))
      return { ok: false, message: 'Only the operator window can switch the mode.' };
    // Leaving Simple Mode takes the word, typed on purpose.
    if (mode === 'simple' && wanted === 'pro' && !(typeof word === 'string' && isLeaveWord(word)))
      return { ok: false, message: 'Type pro to switch to Pro Mode.' };
    setMode(wanted);
    return { ok: true, mode };
  });
  const switchMode = () => {
    if (mode === 'pro') setMode('simple');
    else sendToOperator(IPC.app.askLeaveSimple, { at: Date.now() });
  };

  // The operator's library list refreshes at most every 2 s during an import, and at once afterwards.
  let changedTimer: NodeJS.Timeout | null = null;
  let lastChanged = 0;
  const libraryChanged = (now = false) => {
    const send = () => {
      changedTimer = null;
      lastChanged = Date.now();
      sendToOperator(IPC.library.changed, { at: lastChanged, what: 'presentations' });
      network?.hint('presentations');
    };
    if (now) {
      if (changedTimer) clearTimeout(changedTimer);
      send();
    } else {
      changedTimer ??= setTimeout(send, Math.max(0, lastChanged + 2000 - Date.now()));
    }
  };
  /** Props, message templates or themes changed: the operator's lists of them reload at once. */
  const listChanged = (what: Exclude<LibraryChange, 'presentations'>) => {
    sendToOperator(IPC.library.changed, { at: Date.now(), what });
    if (what === 'props' || what === 'messages') network?.hint(what);
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
      // An import can change what comes next (a replaced presentation, a filled playlist).
      engine.refreshNext();
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

  // ---- converting media Drashti cannot play -----------------------------------------
  const conversions = new ConvertService({
    db: libraryDb,
    mediaDir,
    ffmpegPath: () =>
      findFfmpeg({
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        platform: process.platform,
        arch: process.arch,
        override: process.env['DRASHTI_FFMPEG'],
      }),
    busy: () =>
      streaming.inUse() ? 'Waits while the stream is on air or recording, then carries on by itself.' : null,
    freeBytes: diskFreeBytes,
    changed: (jobs) => {
      sendToOperator(IPC.media.conversionsChanged, jobs);
    },
    libraryChanged: (changedPresentations) => {
      // What is on the screens keeps playing the original; slides read from now on use the copy.
      for (const id of changedPresentations) slides.invalidate(id);
      engine.refreshNext();
      libraryChanged(true);
      sendToOperator(IPC.playlists.changed, { at: Date.now() });
      network?.hint('playlists');
      listChanged('props');
      listChanged('themes');
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  app.on('will-quit', () => {
    conversions.close();
  });
  handle(IPC.media.convert, (e, ids) =>
    fromOperator(e)
      ? conversions.convert(ids)
      : { ok: false as const, message: 'Only the operator window can convert.' },
  );
  handle(IPC.media.cancelConversion, (e, id) =>
    fromOperator(e)
      ? conversions.cancel(id)
      : { ok: false as const, message: 'Only the operator window can convert.' },
  );
  handle(IPC.media.conversions, () => conversions.list());
  handle(IPC.media.undoConversion, (e, id) =>
    fromOperator(e)
      ? conversions.undo(id)
      : { ok: false as const, message: 'Only the operator window can convert.' },
  );

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
  handle(IPC.app.recovery, () => recovery);
  handle(IPC.app.startNotice, (e) => {
    if (!fromOperator(e)) return null;
    const text = startNotice;
    startNotice = null;
    startNoticeTaken = true;
    return text;
  });
  handle(IPC.app.dismissRecovery, (e) => {
    if (fromOperator(e)) recovery = null;
    return null;
  });
  handle(IPC.engine.subscribe, (event) => {
    transport.add(event.sender);
    return engine.snapshot();
  });
  handle(IPC.engine.snapshot, () => engine.snapshot());
  handle(IPC.engine.command, (event, command) => runEngineCommand(engine, command, fromOperator(event)));
  handle(IPC.library.listPresentations, () => presentations.list());
  handle(IPC.library.listMedia, () => media.list());
  // The words editor and themes: edited words and applied themes go back into the slides; Undo
  // writes the kept copy back.
  const revisions = new Revisions();
  const contentChanged = (ids: string[]) => {
    for (const id of ids) {
      slides.invalidate(id);
      engine.refreshLive(id);
    }
    libraryChanged(true);
  };
  registerWordsIpc({
    presentations,
    revisions,
    fromOperator,
    lookFor: (themeId, size) => themeLook(themes.themeOrDefault(themeId), size.width, size.height),
    changed: contentChanged,
    styleNew: (id) => {
      const rows = presentations.content(id);
      if (rows) presentations.setContent(applyTheme(rows, themes.themeOrDefault(null)));
    },
  });
  registerSlidesIpc({
    db,
    presentations,
    revisions,
    settings,
    fromOperator,
    lookFor: (themeId, size) => themeLook(themes.themeOrDefault(themeId), size.width, size.height),
    changed: contentChanged,
  });
  registerKirtansIpc({
    presentations,
    revisions,
    fromOperator,
    lookFor: (themeId, size) => themeLook(themes.themeOrDefault(themeId), size.width, size.height),
    changed: contentChanged,
    mediaExists: (mediaId) => media.file(mediaId) !== null,
    settings,
  });
  registerThemesIpc({
    themes,
    presentations,
    revisions,
    fromOperator,
    changed: contentChanged,
    themesChanged: () => {
      listChanged('themes');
    },
  });
  // Props: kept here; showing one goes through the engine.
  const props = new PropRepo(db);
  handle(IPC.props.list, () => props.list());
  handle(IPC.props.save, (e, propId, fields): PropResult => {
    if (!fromOperator(e)) return { ok: false, message: 'Only the operator window can change props.' };
    const f = propFieldsSchema.safeParse(fields);
    if (!f.success) return { ok: false, message: 'A prop needs a name and something to show.' };
    const id = propId === null ? props.create(f.data) : idSchema.safeParse(propId).data;
    if (id === undefined || (propId !== null && !props.update(id, f.data)))
      return { ok: false, message: 'That prop no longer exists.' };
    listChanged('props');
    return { ok: true, id };
  });
  handle(IPC.props.remove, (e, propId): PropResult => {
    if (!fromOperator(e)) return { ok: false, message: 'Only the operator window can change props.' };
    const id = idSchema.safeParse(propId);
    if (!id.success || !props.remove(id.data)) return { ok: false, message: 'That prop no longer exists.' };
    // A prop that is up comes down with it, and the logo with it when it was the logo.
    engine.dispatch({ type: 'hideProp', propId: id.data });
    if (settings.get('logoPropId') === id.data) settings.set('logoPropId', null);
    if (engine.current.logo?.id === id.data) engine.dispatch({ type: 'hideLogo' });
    listChanged('props');
    return { ok: true, id: id.data };
  });
  // The prop the admin marked as the logo, for Simple Mode's Logo button.
  handle(IPC.props.getLogo, () => {
    const id = settings.get('logoPropId');
    return typeof id === 'string' && props.list().some((p) => p.id === id) ? id : null;
  });
  handle(IPC.props.setLogo, (e, propId): PropResult => {
    if (!fromOperator(e)) return { ok: false, message: 'Only the operator window can choose the logo.' };
    if (propId === null) {
      settings.set('logoPropId', null);
      listChanged('props');
      return { ok: true, id: '' };
    }
    const id = idSchema.safeParse(propId);
    if (!id.success || !props.list().some((p) => p.id === id.data))
      return { ok: false, message: 'That prop no longer exists.' };
    settings.set('logoPropId', id.data);
    listChanged('props');
    return { ok: true, id: id.data };
  });
  handle(IPC.library.search, (_e, query) =>
    search.search(typeof query === 'string' ? query.slice(0, 200) : ''),
  );
  handle(IPC.library.legacyPresentations, () => search.legacyPresentations());
  // Message templates: kept here; showing one goes through the engine.
  const messageTemplates = new MessageRepo(db);
  const badMessage: MessageResult = {
    ok: false,
    message: 'A message needs a name and some words (up to 300).',
  };
  const messageChange = (e: IpcMainInvokeEvent, run: () => MessageResult): MessageResult => {
    if (!fromOperator(e)) return { ok: false, message: 'Only the operator window can change messages.' };
    const result = run();
    if (result.ok) listChanged('messages');
    return result;
  };
  handle(IPC.messages.list, () => messageTemplates.list());
  handle(IPC.messages.create, (e, template) =>
    messageChange(e, () => {
      const t = messageTemplateSchema.safeParse(template);
      return t.success ? { ok: true, id: messageTemplates.create(t.data) } : badMessage;
    }),
  );
  handle(IPC.messages.update, (e, templateId, template) =>
    messageChange(e, () => {
      const id = idSchema.safeParse(templateId);
      const t = messageTemplateSchema.safeParse(template);
      if (!id.success || !t.success) return badMessage;
      return messageTemplates.update(id.data, t.data)
        ? { ok: true, id: id.data }
        : { ok: false, message: 'That message no longer exists.' };
    }),
  );
  handle(IPC.messages.remove, (e, templateId) =>
    messageChange(e, () => {
      const id = idSchema.safeParse(templateId);
      return id.success && messageTemplates.remove(id.data)
        ? { ok: true, id: id.data }
        : { ok: false, message: 'That message no longer exists.' };
    }),
  );
  // ---- the local network ----------------------------------------------------------
  // Phones and tablets on the mandir's Wi-Fi, once paired (README "The local network"). Off until
  // the operator turns it on (Pro Mode only); the server runs in a worker of its own.
  const asPropItem = (p: {
    id: string;
    name: string;
    elements: PropItem['elements'];
    width?: number;
    height?: number;
  }): PropItem => ({
    id: p.id,
    name: p.name,
    elements: p.elements,
    width: p.width,
    height: p.height,
  });
  // Announcements from phones: the queue the operator approves from (Pro Mode only).
  const announcements = new AnnouncementService({
    repo: new AnnouncementRepo(db),
    engine: {
      state: () => engine.current,
      dispatch: (command) => engine.dispatch(command),
      showTicker: (item) => engine.showTicker(item),
      takeDown: (id) => engine.takeDown(id),
    },
    templates: {
      list: () => messageTemplates.list(),
      create: (template) => messageTemplates.create(template),
      changed: () => {
        listChanged('messages');
      },
    },
    now: Date.now,
    minuteMs: announceMinuteMs,
    changed: (view) => {
      sendToOperator(IPC.announcements.changed, view);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  // What recovery put back carries on until its time; the rest that was showing has ended.
  announcements.resume();
  app.on('will-quit', () => {
    announcements.close();
  });
  const net = new NetworkService({
    devices: new DeviceRepo(db),
    settings,
    spawn: () =>
      perfNetworkInMain
        ? inProcessNetworkWorker()
        : spawnNetworkWorker((line) => {
            log.info(`[network worker] ${line}`);
          }),
    serverOptions: (port) => ({
      port,
      bind: networkLocalOnly || perfTest ? '127.0.0.1' : '0.0.0.0',
      webDir: rendererDir(),
      ffmpeg: findFfmpeg({
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        platform: process.platform,
        arch: process.arch,
        override: process.env['DRASHTI_FFMPEG'],
      }),
      previewDir: join(app.getPath('userData'), 'Network', 'previews'),
      localName: localName(),
      refuseLoopback: networkRefuseLoopback,
    }),
    localName: () => localName(),
    engine: {
      dispatch: (command) => engine.dispatch(command),
      snapshot: () => engine.snapshot(),
      state: () => engine.current,
    },
    reads: {
      playlists: () => playlists.tree(),
      items: (playlistId) => playlists.itemsOf(playlistId),
      presentation: (presentationId) => presentations.get(presentationId),
      messages: () => messageTemplates.list(),
      logo: () => {
        const id = settings.get('logoPropId');
        const prop = typeof id === 'string' ? props.list().find((p) => p.id === id) : undefined;
        return prop ? asPropItem(prop) : null;
      },
      mediaSource: (mediaId) => {
        if (!MEDIA_ID_PATTERN.test(mediaId)) return null;
        const row = media.kindAndFile(mediaId);
        if (!row || row.missing || row.kind === 'audio' || row.path === '') return null;
        const path = join(mediaDir, row.path);
        return isInside(mediaDir, path) ? { path, kind: row.kind } : null;
      },
      stageLanguages: () => screenRepo.stageLanguages(),
      clockStyle: () => ({
        locale: app.getLocale(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    },
    announcements: {
      submit: (device, address, input) => announcements.submit(device, address, input),
      statusFor: (device, args) => announcements.statusFor(device, args),
    },
    refused: (channel) => refusedNow(channel),
    changed: (status) => {
      sendToOperator(IPC.network.changed, status);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    now: Date.now,
  });
  network = net;
  net.resume();
  app.on('will-quit', () => {
    void net.close();
  });
  const notNetworkOperator = {
    ok: false as const,
    message: 'Only the operator window can change the network.',
  };
  handle(IPC.network.status, () => net.status());
  handle(IPC.network.setOn, (e, on) => (fromOperator(e) ? net.setOn(on) : notNetworkOperator));
  handle(IPC.network.setPort, (e, port) => (fromOperator(e) ? net.setPort(port) : notNetworkOperator));
  handle(IPC.network.startPairing, (e, kind, name) =>
    fromOperator(e) ? net.startPairing(kind, name) : notNetworkOperator,
  );
  handle(IPC.network.cancelPairing, (e) => (fromOperator(e) ? net.cancelPairing() : notNetworkOperator));
  handle(IPC.network.renameDevice, (e, id, name) =>
    fromOperator(e) ? net.renameDevice(id, name) : notNetworkOperator,
  );
  handle(IPC.network.revokeDevice, (e, id) => (fromOperator(e) ? net.revokeDevice(id) : notNetworkOperator));
  handle(IPC.network.makePoster, (e) => (fromOperator(e) ? net.makePoster() : notNetworkOperator));
  const notQueueOperator = {
    ok: false as const,
    message: 'Only the operator window can decide on announcements.',
  };
  handle(IPC.announcements.list, () => announcements.view());
  handle(IPC.announcements.edit, (e, edit) =>
    fromOperator(e) ? announcements.edit(edit) : notQueueOperator,
  );
  handle(IPC.announcements.approve, (e, approval) =>
    fromOperator(e) ? announcements.approve(approval) : notQueueOperator,
  );
  handle(IPC.announcements.reject, (e, which) =>
    fromOperator(e) ? announcements.reject(which) : notQueueOperator,
  );
  handle(IPC.announcements.takeOff, (e, which) =>
    fromOperator(e) ? announcements.takeOff(which) : notQueueOperator,
  );

  // Timers: made and edited here, started and paused through the engine.
  const timerChange = (e: IpcMainInvokeEvent, run: () => TimerResult): TimerResult => {
    if (!fromOperator(e)) return { ok: false, message: 'Only the operator window can change timers.' };
    const result = run();
    if (result.ok) engine.setTimers(timers.list());
    return result;
  };
  const badTimer: TimerResult = {
    ok: false,
    message: 'A timer needs a name, and a length or a time of day (HH:MM).',
  };
  handle(IPC.timers.create, (e, fields) =>
    timerChange(e, () => {
      const f = timerFieldsSchema.safeParse(fields);
      return f.success ? { ok: true, id: timers.create(f.data) } : badTimer;
    }),
  );
  handle(IPC.timers.update, (e, timerId, fields) =>
    timerChange(e, () => {
      const id = idSchema.safeParse(timerId);
      const f = timerFieldsSchema.safeParse(fields);
      if (!id.success || !f.success) return badTimer;
      return timers.update(id.data, f.data)
        ? { ok: true, id: id.data }
        : { ok: false, message: 'That timer no longer exists.' };
    }),
  );
  handle(IPC.timers.remove, (e, timerId) =>
    timerChange(e, () => {
      const id = idSchema.safeParse(timerId);
      return id.success && timers.remove(id.data)
        ? { ok: true, id: id.data }
        : { ok: false, message: 'That timer no longer exists.' };
    }),
  );
  registerPlaylistIpc({
    repo: playlists,
    fromOperator,
    changed: () => {
      // A live item's order may have changed, and what comes next may be different.
      engine.reorderLive();
      engine.refreshNext();
      sendToOperator(IPC.playlists.changed, { at: Date.now() });
      net.hint('playlists');
    },
  });
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
  handle(IPC.library.setArrangement, (e, presentationId, arrangementId) => {
    const pid = idSchema.safeParse(presentationId);
    const aid = idSchema.nullable().safeParse(arrangementId);
    if (!fromOperator(e) || !pid.success || !aid.success)
      return { ok: false as const, message: 'Only the operator window can choose an arrangement.' };
    if (!presentations.setSelectedArrangement(pid.data, aid.data))
      return { ok: false as const, message: 'That arrangement is not part of this presentation.' };
    slides.invalidate(pid.data);
    // If it is live, Next follows the new order from the slide on screen.
    engine.reorderLive(pid.data);
    engine.refreshNext();
    return { ok: true as const };
  });
  handle(IPC.library.removePresentations, (e, ids) => {
    const parsed = idListSchema.safeParse(ids);
    if (!fromOperator(e) || !parsed.success) return { ok: false as const, message: 'Nothing was removed.' };
    const removed = presentations.remove(parsed.data);
    for (const id of removed) slides.invalidate(id);
    engine.refreshNext();
    log.info(`Removed ${removed.length} presentation(s)`);
    libraryChanged(true);
    return { ok: true as const, ids: removed };
  });
  handle(IPC.library.restorePresentations, (e, ids) => {
    const parsed = idListSchema.safeParse(ids);
    if (!fromOperator(e) || !parsed.success) return { ok: false as const, message: 'Nothing was restored.' };
    const restored = presentations.restore(parsed.data);
    for (const id of restored) slides.invalidate(id);
    engine.refreshNext();
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
  handle(IPC.screens.setGroupRole, (e, id, role) => {
    if (!fromOperator(e)) return notAllowed;
    const result = screens.setGroupRole(id, role);
    // A stage display in a browser shows the stage group's languages.
    net.hint('screens');
    return result;
  });
  handle(IPC.screens.setGroupLanguages, (e, id, languages) => {
    if (!fromOperator(e)) return notAllowed;
    const result = screens.setGroupLanguages(id, languages);
    // The stream group's languages are the stream's lower third's and slides'; a stage display's too.
    streaming.contextChanged();
    net.hint('screens');
    return result;
  });
  handle(IPC.screens.renameGroup, (e, id, name) =>
    fromOperator(e) ? screens.renameGroup(id, name) : notAllowed,
  );
  handle(IPC.screens.deleteGroup, (e, id) => {
    if (!fromOperator(e)) return notAllowed;
    const result = screens.deleteGroup(id);
    streaming.contextChanged();
    return result;
  });
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
  // ---- streaming (operator window; the stream's page for its own calls) ---------------
  const notOperator = { ok: false as const, message: 'Only the operator window can change the stream.' };
  handle(IPC.stream.status, () => streaming.status());
  handle(IPC.stream.setLayout, (e, layout) => (fromOperator(e) ? streaming.setLayout(layout) : notOperator));
  handle(IPC.stream.watchPreview, (e, on) => {
    if (fromOperator(e)) streaming.watchPreview(e.sender, on === true);
    return null;
  });
  handle(IPC.stream.profiles, (e) => {
    // The operator turned to the stream: its group (and languages) appear in Screens.
    if (fromOperator(e) && mode === 'pro') streaming.ensureStreamGroup();
    return streaming.profilesView();
  });
  handle(IPC.stream.saveProfile, (e, id, input) =>
    fromOperator(e) ? streaming.saveProfile(id, input) : notOperator,
  );
  handle(IPC.stream.removeProfile, (e, id) => (fromOperator(e) ? streaming.removeProfile(id) : notOperator));
  handle(IPC.stream.useProfile, (e, id) => (fromOperator(e) ? streaming.useProfile(id) : notOperator));
  handle(IPC.stream.setKey, (e, id, key) => (fromOperator(e) ? streaming.setKey(id, key) : notOperator));
  handle(IPC.stream.removeKey, (e, id) => (fromOperator(e) ? streaming.removeKey(id) : notOperator));
  handle(IPC.stream.goLive, (e, confirm) =>
    fromOperator(e) && confirmedSchema.safeParse(confirm).success
      ? streaming.goLive()
      : { ok: false as const, message: 'Going live needs the operator to confirm it.' },
  );
  handle(IPC.stream.end, (e, confirm) =>
    fromOperator(e) && confirmedSchema.safeParse(confirm).success
      ? streaming.end()
      : { ok: false as const, message: 'Ending the stream needs the operator to confirm it.' },
  );
  handle(IPC.stream.startRecording, (e) => (fromOperator(e) ? streaming.startRecording() : notOperator));
  handle(IPC.stream.stopRecording, (e) => (fromOperator(e) ? streaming.stopRecording() : notOperator));
  handle(IPC.stream.pickFolder, (e) =>
    fromOperator(e) ? streaming.pickFolder(operatorWindow) : notOperator,
  );
  handle(IPC.stream.dismissResume, (e) => {
    if (fromOperator(e)) streaming.dismissResume();
    return null;
  });
  handle(IPC.stream.pageContext, (e) => (streaming.isProgram(e.sender) ? streaming.context() : null));
  handle(IPC.stream.pageInputs, (e, inputs) => {
    streaming.reportInputs(e.sender, inputs);
    return null;
  });

  // ---- the setup wizard ----------------------------------------------------------
  // Tests start with it closed, unless a test is about it; the self-tests never open it (a dialog
  // would take the show's keys).
  const wizardOff =
    process.env['DRASHTI_TEST_NO_WIZARD'] === '1' || process.env['DRASHTI_SELFTEST'] !== undefined;
  handle(IPC.setup.state, () => ({
    firstRun: mode === 'pro' && !wizardOff && settings.get('setupWizard') === undefined,
    operatorDisplayId: operatorDisplayId(),
  }));
  handle(IPC.setup.setSeen, (e) => {
    if (fromOperator(e)) settings.set('setupWizard', new Date().toISOString());
    return null;
  });
  handle(IPC.setup.identifyDisplays, (e) => {
    if (!fromOperator(e)) return { shown: 0 };
    const here = operatorDisplayId();
    const shown = listDisplays()
      .map((d, i) => ({ d, n: i + 1 }))
      .filter(({ d }) => d.id !== here);
    for (const { d, n } of shown) showDisplayNumber(d, n, { windowed: windowedOutputs, forMs: 5000 });
    log.info(`Setup: showed the numbers of ${shown.length} display(s)`);
    return { shown: shown.length };
  });
  handle(IPC.setup.testTone, (e, device) => {
    const parsed = audioDeviceSchema.nullable().safeParse(device ?? null);
    if (!fromOperator(e) || !parsed.success || !audioWindow || audioWindow.isDestroyed())
      return { ok: false };
    audioWindow.webContents.send(IPC.audio.testTone, { deviceId: parsed.data?.id ?? '' });
    return { ok: true };
  });
  handle(IPC.setup.finish, (e, rawPlan, options): SetupResult => {
    if (!fromOperator(e)) return { ok: false, message: 'Only the operator window can set up the screens.' };
    const plan = setupPlanSchema.safeParse(rawPlan);
    if (!plan.success) return { ok: false, message: 'That setup cannot be applied.' };
    const { outputs, sound, themeId } = plan.data;
    if (themeId !== null && !themes.get(themeId))
      return { ok: false, message: 'That theme is no longer there.' };
    // The screens first: covering the operator's display asks before anything changes.
    if (outputs) {
      const applied = screens.applySetup(outputs, options);
      if (!applied.ok) return applied;
    }
    if (sound !== 'skip') audioOutput.choose(sound);
    if (themeId !== null) {
      themes.setDefault(themeId);
      listChanged('themes');
    }
    settings.set('setupWizard', new Date().toISOString());
    // A test slide on every screen, in its own languages, for a few seconds; the show is untouched.
    testCardUntil = Date.now() + TEST_CARD_MS;
    for (const [screenId, win] of outputWindows) {
      const context = contextFor(screenId);
      if (context && !win.isDestroyed()) win.webContents.send(IPC.output.context, context);
    }
    log.info(
      `Setup finished: ${outputs ? `${outputs.length} display(s) set` : 'screens kept'}; sound ${sound === 'skip' ? 'kept' : 'chosen'}; theme ${themeId === null ? 'kept' : 'chosen'}`,
    );
    const snapshot = screens.snapshot();
    return { ok: true, snapshot, tested: snapshot.status.filter((st) => st.state === 'showing').length };
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
  operatorWindow.webContents.once('did-finish-load', resumeStream);
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
      ensureOutput: () => ensureTestOutput('Watchdog self-test'),
    });

  /** For the self-tests: an output on the first display, if none is showing; returns an undo function. */
  const ensureTestOutput = async (name: string) => {
    if (showingCount() > 0) return () => undefined;
    const created = screens.createGroup(name);
    const groupId = createdGroupId(created, name);
    const display = listDisplays()[0];
    if (groupId && display) screens.assignDisplay(groupId, display.id, { coverOperator: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    return () => {
      if (groupId) screens.deleteGroup(groupId);
    };
  };

  const backupUi: BackupUi = {
    parent: () => (operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : null),
    db: libraryDb,
    userData: userDataDir,
    mediaDir,
    version: app.getVersion(),
    schema: LATEST_VERSION,
    notice: (text) => {
      sendToOperator(IPC.app.notice, { text });
    },
    progress: (progress) => {
      sendToOperator(IPC.app.progress, { progress });
      if (operatorWindow && !operatorWindow.isDestroyed())
        operatorWindow.setProgressBar(progress ? progress.fraction : -1);
    },
    restart: () => {
      // A clean quit, so the next start (with the restored library) puts nothing back on the
      // screens; and the operator has already agreed to the screens going black.
      liveWriter.markClean();
      quitConfirmed = true;
      if (!noRelaunch) app.relaunch();
      app.quit();
    },
    log: {
      info: (message) => {
        log.info(message);
      },
      warn: (message) => {
        log.warn(message);
      },
    },
  };

  rebuildMenu = () => {
    installMenu(menuActions());
  };
  const menuActions = (): Parameters<typeof installMenu>[0] => ({
    mode,
    switchMode,
    setUpScreens: () => {
      if (mode === 'pro') sendToOperator(IPC.setup.open, { at: Date.now() });
    },
    backUpLibrary: () => {
      if (mode === 'pro') void backUp(backupUi);
    },
    restoreLibrary: () => {
      if (mode === 'pro') void restore(backupUi);
    },
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
    redo: {
      run: () => {
        // As Undo: redo typing in a text field; the slide editor redoes its last undone step otherwise.
        operatorWindow?.webContents.redo();
        sendToOperator(IPC.app.redo, { at: Date.now() });
      },
    },
    uncoverControls: { accelerator: uncoverAccelerator, run: uncover },
    saveDiagnostics: () => {
      try {
        const file = saveDiagnostics(app.getPath('desktop'), {
          app: appInfo(),
          displays: listDisplays(),
          screens: screens.snapshot(),
          sound: audioOutput.status,
          db: libraryDb,
          watchdog: watchdogHistory,
          logFiles: logFiles(),
          now: new Date(),
        });
        log.info('Diagnostics saved to the Desktop');
        sendToOperator(IPC.app.notice, { text: `Diagnostics saved on the Desktop: ${basename(file)}` });
      } catch (error) {
        log.error('Could not save diagnostics', error);
        sendToOperator(IPC.app.notice, {
          text: 'Could not save diagnostics: see the log in the data folder.',
        });
      }
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
          openGallery: () => {
            openGalleryWindow();
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
  rebuildMenu();
  /** The self-tests end on purpose: a clean quit, so the next start does not put their slides back. */
  const exitSelfTest = (code: number) => {
    liveWriter.markClean();
    app.exit(code);
  };
  if (perfTest) {
    operatorWindow.webContents.once('did-finish-load', () => {
      void runPerformanceTestWithDevices({
        operator: () => (operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : null),
        outputs: () => [...outputWindows.values()].filter((w) => !w.isDestroyed()),
        ensureOutput: () => ensureTestOutput('Performance test'),
        workerRunning: () =>
          app.getAppMetrics().some((m) => m.type === 'Utility' && m.name === 'Drashti import'),
        diagnostics: { loopDelay, handlerTimes, gc },
        stream: streaming,
        network: net,
        operatorContents: () =>
          operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow.webContents : null,
      }).then(
        (result) => {
          process.stdout.write(`DRASHTI_PERFTEST_RESULT ${JSON.stringify(result)}\n`);
          exitSelfTest(result.passed ? 0 : 1);
        },
        (error: unknown) => {
          const result = {
            passed: false,
            checks: [{ name: 'the test ran', ok: false, detail: String(error) }],
            summary: '',
          };
          process.stdout.write(`DRASHTI_PERFTEST_RESULT ${JSON.stringify(result)}\n`);
          exitSelfTest(1);
        },
      );
    });
  }
  const relaunchWorkDir = process.env['DRASHTI_SELFTEST_DIR'];
  if (relaunchTest && relaunchWorkDir) {
    operatorWindow.webContents.once('did-finish-load', () => {
      void runRelaunchSelfTest({
        userData: userDataDir,
        workDir: relaunchWorkDir,
        restored,
        names: () => presentations.list().map((p) => p.name),
        backUp: async (into) =>
          (
            await backupLibrary(libraryDb, into, {
              mediaDir: null,
              app: app.getVersion(),
              schema: LATEST_VERSION,
              now: new Date(),
            })
          ).folder,
        change: () => {
          presentations.insert({
            libraryId: presentations.ensureLibrary('Default'),
            name: 'Placeholder added after the backup',
            groups: [{ name: '', slides: [{ elements: [] }] }],
          });
        },
        requestRestore: (from) => {
          requestRestore(userDataDir, from);
        },
        restart: backupUi.restart,
        exit: exitSelfTest,
      }).catch((error: unknown) => {
        log.error('The restore-relaunch self-test stopped', error);
        exitSelfTest(1);
      });
    });
  }
  if (selfTest) {
    operatorWindow.webContents.once('did-finish-load', () => {
      void runSelfTest().then(
        (result) => {
          process.stdout.write(`DRASHTI_SELFTEST_RESULT ${JSON.stringify(result)}\n`);
          exitSelfTest(result.passed ? 0 : 1);
        },
        (error: unknown) => {
          const result = {
            passed: false,
            checks: [{ name: 'self-test ran', ok: false, detail: String(error) }],
          };
          process.stdout.write(`DRASHTI_SELFTEST_RESULT ${JSON.stringify(result)}\n`);
          exitSelfTest(1);
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
