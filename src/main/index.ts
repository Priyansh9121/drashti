import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import {
  app,
  autoUpdater,
  net as electronNet,
  shell,
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
import {
  isLeaveWord,
  isOperatorMode,
  SIMPLE_MODE_REFUSAL,
  SIMPLE_MODE_REFUSED_COMMANDS,
} from '../shared/mode';
import { groupLookIn, NO_LOOK } from '../shared/looks';
import { DEFAULT_THEME } from '../shared/themes';
import type { SlideSource } from './engine/slide-source';
import type { Db } from './db/database';
import { LATEST_VERSION, LIBRARY_BUSY_TIMEOUT_MS, openDatabase } from './db/database';
import { ImportRepo } from './db/imports';
import { MediaRepo } from './db/media';
import { PlaylistRepo } from './db/playlists';
import { SearchIndex } from './db/search';
import { TimerRepo } from './db/timers';
import { ThemeRepo } from './db/themes';
import { ShastraRepo } from './db/shastra';
import { ShastraService } from './shastra/shastra-service';
import { isPassageId, passageIdSchema, referenceInputSchema, shastraSearchSchema } from '../shared/shastra';
import { FIT_EVERYWHERE, type FitTargets, fitTargets } from '../shared/shastra-slides';
import { PropRepo } from './db/props';
import { MessageRepo } from './db/messages';
import { SettingsRepo } from './db/settings';
import { DbSlideSource, PresentationRepo } from './db/presentations';
import { ScreenRepo } from './db/screens';
import { LookRepo } from './db/looks';
import { LookService } from './looks/look-service';
import { StageLayoutRepo } from './db/stage-layouts';
import { StageLayoutService } from './stage/stage-layout-service';
import { MaskRepo } from './db/masks';
import { MaskService } from './masks/mask-service';
import { MacroRepo } from './db/macros';
import { ArtiRepo } from './db/arti';
import { ArtiService } from './arti/arti-service';
import { CalendarRepo } from './db/calendar';
import { CalendarService } from './calendar/calendar-service';
import { QuoteRepo } from './db/quotes';
import { IdleService } from './idle/idle-service';
import { quoteIdSchema } from '../shared/idle';
import { calendarIdSchema } from '../shared/calendar';
import { type ArtiAnswer, artiKeySchema } from '../shared/arti';
import { MacroService } from './macros/macro-service';
import { MacroScheduler } from './macros/macro-scheduler';
import { AudioPlaylistRepo } from './db/audio-playlists';
import { MusicService } from './music/music-service';
import { startPerfMusic, startPerfSoundCue } from './music/perf-music';
import { musicPlaySchema } from '../shared/music';
import type { MediaMarkers } from '../shared/markers';
import { mediaMarkersSchema, NO_MARKERS } from '../shared/markers';
import { UpdateService } from './update/update-service';
import { defaultInstaller } from './update/installer';
import { UPDATE_BASE } from '../shared/updates';
import { midiSettingsSchema, NO_MIDI } from '../shared/midi';
import { seedPlaceholders, seedTemplates } from './db/seed';
import { ShowEngine } from './engine/show-engine';
import { runEngineCommand } from './ipc/engine-ipc';
import {
  handle,
  handlerTimes,
  hearHandled,
  lockAdminChannels,
  lockChannels,
  refusedNow,
  setGiveWay,
} from './ipc/handle';
import { MainWatch, PerfProfile, watchedMedia } from './perf-watch';
import { isPerfScenario, startScenario } from './perf-scenarios';
import { LaterWrites } from './db/later-writes';
import { RolesService } from './roles/roles-service';
import { adminRefusals } from './roles/admin-lock';
import { ImportService } from './import/import-service';
import { spawnImportWorker } from './import/spawn-worker';
import { AudioOutput } from './audio/audio-output';
import { saveDiagnostics } from './diagnostics';
import { log, logFiles, startLogFile } from './log';
import { LiveStateWriter, toRestore } from './recovery/live-state';
import { handleMediaRequest, MEDIA_SCHEME_PRIVILEGES } from './media/media-protocol';
import { saveStill } from './media/stills';
import { installMenu, installNodeMenu } from './menu';
import { runPerformanceTest } from './perftest';
import { registerPlaylistIpc } from './playlists/playlist-ipc';
import {
  applyPendingRestore,
  backupLibrary,
  requestRestore,
  rollBackRestore,
  sameDisk,
} from './library/backup';
import type { BackupUi } from './library/backup-ui';
import { backUp, handBackupRunning, restore } from './library/backup-ui';
import { ScheduledBackups } from './backup/scheduled-backups';
import { spawnBackupWorker } from './backup/spawn-backup-worker';
import { Revisions } from './library/revisions';
import { applyTheme, themeLook } from './library/themes';
import { defaultTransition, registerSlidesIpc } from './library/slides-ipc';
import { registerThemesIpc } from './library/themes-ipc';
import { registerWordsIpc } from './library/words-ipc';
import { registerKirtansIpc } from './library/kirtans-ipc';
import { runRelaunchSelfTest } from './relaunch-selftest';
import { createdGroupId, runWatchdogSelfTest } from './selftest';
import { SIMPLE_MODE_LOCKED, simpleModeRefusals } from './simple-mode';
import { applyPriority, describePriority, readPriority, writePriority } from './priority';
import { whenFree, writeLockFree } from './db/write-lock';
import { writeOldLibrary } from './old-library-selftest';
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
import { createPicturesWindow } from './pictures/pictures-window';
import { PdfPictures, pictureSize } from './pictures/pdf-pictures';
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
import { localInterfaceAddresses } from './network/addresses';
import { isInside } from './media/media-protocol';
import { rendererDir } from './windows/renderer';
import { quietTests, startQuietTests } from './windows/quiet';
import { knownRole, readRole, writeRole } from './role';
import { startNode } from './node-mode/node-app';
import { NodeRepo } from './db/nodes';
import { NodeService } from './nodes/node-service';
import { spawnLinkWorker } from './nodes/link-worker';
import { loadOrMakeIdentity } from './nodes/identity';
import { RECENT_DAYS, WantedMedia } from './nodes/wanted-media';
import { startPerfNodes } from './nodes/perf-nodes';
import type { NodeOutputStatus, ScreenThumb } from '../shared/nodes';
import { hostname } from 'node:os';

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
/** This computer's own data folder, before any override (the performance check reads its settings). */
const homeData = app.getPath('userData');
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

// Drashti's sound is the show's, not the computer's media (Session 15): the system's media controls
// (Windows' media overlay, macOS's Now Playing) and the keyboard's or a headset's media keys never see
// it, so nobody pauses the sabha's sound by pressing one. Keeping those controls up to date also took
// the main process 60 to 180 ms each time a sound started on Windows (the performance check's trace).
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

// The show's own process first (Session 15): on a two-core PC with no graphics chip, the windows decoding
// video at the same priority kept the main process (every slide change, and the screens' media) waiting
// for up to 2 s at a time. It uses little of the processor, so it never holds the screens up by going
// first. Windows lets a program raise itself this far; macOS lets only the administrator. An admin can set
// it back to normal on a computer where that suits the screens better (File > Run Ahead of Other Programs;
// Session 16): the performance check, in a throwaway folder, still reads this computer's choice.
let mainPriority = readPriority(userDataOverride ?? homeData, process.env['DRASHTI_PRIORITY']);
/** Set it (again), and say what it is now: Chromium's start can change it after the first time. */
const holdPriority = (when: string) => {
  const before = describePriority();
  if (applyPriority(mainPriority))
    log.info(`Main process priority ${when}: ${before} -> ${describePriority()}`);
};
holdPriority('at start');
void app.whenReady().then(() => {
  holdPriority('once ready');
});
/** File > Run Ahead of Other Programs (Windows; an admin's choice for this computer, kept and applied at once). */
const priorityItem = (after: (text: string) => void) =>
  process.platform === 'win32'
    ? {
        ahead: mainPriority === 'above-normal',
        toggle: () => {
          const next = mainPriority === 'normal' ? 'above-normal' : 'normal';
          writePriority(app.getPath('userData'), next);
          mainPriority = next;
          applyPriority(next);
          log.info(`Main process priority set to ${describePriority()} (File > Run Ahead of Other Programs)`);
          after(
            next === 'normal'
              ? 'Drashti now runs at normal priority, level with other programs, on this computer.'
              : 'Drashti now runs ahead of other programs on this computer (as it starts).',
          );
        },
      }
    : null;

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
// Tests only: the schedules (the arti, and since Session 14 backups and macros) read this computer's
// clock moved on by this much (ms), and a test can move it with globalThis.drashtiArtiClock(wallMs).
// The engine's clock is never moved.
const artiTestClock = process.env['DRASHTI_TEST_ARTI_CLOCK'] === '1' && !app.isPackaged;
let artiClockOffset = artiTestClock ? Number(process.env['DRASHTI_TEST_ARTI_OFFSET_MS'] ?? 0) || 0 : 0;
/** The schedules' clock: this computer's, moved by a test only. */
const scheduleNow = () => Date.now() + artiClockOffset;
// Tests only (never a packaged Drashti): updates come from this server instead of GitHub Releases, and
// install by writing what they would run into a file; a download goes at this rate; and a test can say
// the stream is on air (globalThis.drashtiTestOnAir), for updates only.
const testUpdateBase = app.isPackaged ? undefined : process.env['DRASHTI_UPDATE_URL'];
const updateBase = testUpdateBase ?? UPDATE_BASE;
const testInstallLog = app.isPackaged ? undefined : process.env['DRASHTI_TEST_UPDATE_INSTALL'];
const testUpdateRate = app.isPackaged ? null : Number(process.env['DRASHTI_TEST_UPDATE_RATE'] ?? 0) || null;
let testOnAir = false;
if (!app.isPackaged && process.env['DRASHTI_TEST_ON_AIR_HOOK'] === '1')
  (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir = (on) => {
    testOnAir = on;
  };
// Tests only: scheduled backups copy at this rate (bytes a second), so a test can watch one wait.
const testBackupRate = app.isPackaged ? null : Number(process.env['DRASHTI_TEST_BACKUP_RATE'] ?? 0) || null;
// The performance check only: so many devices connected while it measures, and (to compare) the
// network's server in the main process instead of its own.
const perfDevices = Math.min(50, Math.max(0, Number(process.env['DRASHTI_PERF_DEVICES'] ?? 0) || 0));
const perfNetworkInMain = process.env['DRASHTI_PERF_NETWORK_IN_MAIN'] === '1';
// The performance check only: an audio playlist playing meanwhile (Session 14); or, to tell what costs
// what (Session 15), one long sound on the audio layer instead, and slide changes with no import.
const perfMusic = process.env['DRASHTI_PERF_MUSIC'] === '1';
const perfSoundCue = process.env['DRASHTI_PERF_SOUND_CUE'] === '1';
// ...and the sound first starting during the measured part, 1.5 s in, rather than before it.
const perfSoundLate = process.env['DRASHTI_PERF_MUSIC_LATE'] === '1';
const perfNoImport = process.env['DRASHTI_PERF_NO_IMPORT'] === '1';
// The performance check only: an operator's edits (words, a playlist, a theme) during the import (Session 16).
const perfEdits = process.env['DRASHTI_PERF_EDITS'] === '1';
// The performance check only: a heavy case for the screens (Session 15: speed on modest hardware).
const perfScenario =
  perfTest && isPerfScenario(process.env['DRASHTI_PERF_SCENARIO'])
    ? process.env['DRASHTI_PERF_SCENARIO']
    : undefined;
// The performance check only: a CPU profile of the main process and a Chromium trace, kept in this folder.
const perfProfileDir = perfTest ? process.env['DRASHTI_PERF_PROFILE'] : undefined;
// The performance check only: so many output nodes following the show (and copying a file) meanwhile.
const perfNodes = Math.min(50, Math.max(0, Number(process.env['DRASHTI_PERF_NODES'] ?? 0) || 0));
// Tests only (never a packaged Drashti): the version this copy says it runs, to see Main and a node
// on different versions refuse each other; a node's clock as if it were this far off; and the port
// Main listens for nodes on.
const testVersion = app.isPackaged ? undefined : process.env['DRASHTI_TEST_VERSION'];
const appVersion = () => testVersion ?? app.getVersion();
const nodeClockSkewMs = app.isPackaged ? 0 : Number(process.env['DRASHTI_TEST_CLOCK_SKEW_MS'] ?? 0) || 0;
const nodePortOverride = Number(process.env['DRASHTI_NODE_PORT'] ?? 0) || null;
// Tests only: the computer's name as Main and its nodes show it (screenshots never show a runner's own).
const testComputerName = app.isPackaged ? undefined : process.env['DRASHTI_TEST_COMPUTER_NAME'];
// Tests only: copies to nodes at this rate (bytes a second), so a copy can be watched while it goes.
const testCopyRate = app.isPackaged ? null : Number(process.env['DRASHTI_TEST_COPY_RATE'] ?? 0) || null;

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
// The performance check's watch on the main process (Session 15): every gap in its event loop over
// 100 ms, beside what went on (the audio layer, media requests, slow requests, the import).
const perfWatch = perfTest ? new MainWatch() : null;
perfWatch?.start();
if (perfWatch)
  hearHandled((channel, ms) => {
    if (ms >= 5 || channel === IPC.media.reportLength) perfWatch.note(`answered ${channel}`, ms);
  });
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
/** The show's own bookkeeping writes, made when the library is free (Session 15); flushed at quit. */
let laterWrites: LaterWrites | null = null;
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
  // PDF, PowerPoint and Keynote files, as pictures (Session 15).
  'pdf',
  'pptx',
  'ppt',
  'key',
];
const notAllowed = { ok: false as const, message: 'Only the operator window can change the screens.' };

/**
 * The performance check, while streaming and recording when DRASHTI_PERF_STREAM names an
 * address on this computer (tests/perf/performance.spec.ts starts FFmpeg listening there).
 */
type PerfRun = Parameters<typeof runPerformanceTest>[0] & {
  stream: StreamService;
  network: NetworkService;
  nodes: NodeService;
  library: { db: Db; mediaDir: string };
  operatorContents: () => Electron.WebContents | null;
  music: MusicService;
  engine: ShowEngine;
  ffmpegPath: () => string | null;
};

/** The performance check with a heavy case for the screens (DRASHTI_PERF_SCENARIO; Session 15). */
function runPerformanceTestWithScenario(ctx: PerfRun): ReturnType<typeof runPerformanceTest> {
  if (!perfScenario) return runPerformanceTestWithNodes(ctx);
  const scenario = startScenario(perfScenario, {
    db: ctx.library.db,
    mediaDir: ctx.library.mediaDir,
    ffmpeg: ctx.ffmpegPath(),
    engine: ctx.engine,
    outputs: ctx.outputs,
  });
  return runPerformanceTestWithNodes({ ...ctx, scenario });
}

/** The performance check with DRASHTI_PERF_NODES output nodes following the show meanwhile. */
async function runPerformanceTestWithNodes(ctx: PerfRun): ReturnType<typeof runPerformanceTest> {
  if (perfNodes === 0) return runPerformanceTestWithDevices(ctx);
  const nodes = await startPerfNodes(
    ctx.nodes,
    ctx.library.db,
    ctx.library.mediaDir,
    perfNodes,
    appVersion(),
  );
  try {
    const result = await runPerformanceTestWithDevices(ctx);
    await nodes.stop();
    return { ...result, summary: `${result.summary}; ${nodes.summary()}` };
  } catch (error) {
    await nodes.stop();
    throw error;
  }
}

/** The performance check with DRASHTI_PERF_DEVICES paired devices following the feed meanwhile. */
async function runPerformanceTestWithDevices(ctx: PerfRun): ReturnType<typeof runPerformanceTest> {
  if (perfDevices === 0) return runPerformanceTestWithMusic(ctx);
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
    const result = await runPerformanceTestWithMusic(ctx);
    await devices.stop();
    return { ...result, summary: `${result.summary}; ${devices.summary()}` };
  } catch (error) {
    await devices.stop();
    throw error;
  }
}

/** The performance check with an audio playlist (DRASHTI_PERF_MUSIC=1) or a sound cue playing meanwhile. */
async function runPerformanceTestWithMusic(ctx: PerfRun): ReturnType<typeof runPerformanceTest> {
  if (!perfMusic && !perfSoundCue) return runPerformanceTestWithStream(ctx);
  const music = perfSoundCue
    ? startPerfSoundCue(ctx.library.db, ctx.library.mediaDir, ctx.engine)
    : startPerfMusic(ctx.library.db, ctx.library.mediaDir, ctx.music);
  if (!perfSoundLate) music.play();
  const result = await runPerformanceTestWithStream(
    perfSoundLate
      ? { ...ctx, during: { afterMs: 1500, what: 'the sound starts', run: () => music.play() } }
      : ctx,
  );
  music.stop();
  return { ...result, summary: `${result.summary}; ${music.summary()}` };
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

/**
 * Main or Node (Session 13): the role kept in the data folder, or asked on
 * the very first start (a computer with a library is a Main). Self-tests and
 * end-to-end tests start as Main unless DRASHTI_ROLE says otherwise.
 */
function boot(): void {
  const userData = app.getPath('userData');
  const selfTesting = process.env['DRASHTI_SELFTEST'] !== undefined;
  let role = selfTesting ? 'main' : knownRole(userData, process.env['DRASHTI_ROLE']);
  if (role === null) {
    if (process.env['DRASHTI_TEST_NO_WIZARD'] === '1') role = 'main';
    else {
      const choice = dialog.showMessageBoxSync({
        type: 'question',
        buttons: ['Main: run the show here', 'Node: show screens for another computer'],
        defaultId: 0,
        cancelId: 0,
        message: 'How will this computer be used?',
        detail:
          'Main runs the show: the library, the playlists and the controls. A Node follows a Main on the local network and shows its screens on this computer’s displays. You can change this later: on Main in the File menu, on a node in its window.',
      });
      role = choice === 1 ? 'node' : 'main';
    }
  }
  if (!selfTesting && readRole(userData) !== role) writeRole(userData, role);
  log.info(`Starting as ${role === 'node' ? 'a node' : 'Main'}`);
  if (role === 'node') startNodeMode();
  else start();
}

/** Drashti as a node: no library, no show controls, no sound (node-mode/node-app.ts). */
function startNodeMode(): void {
  applySessionSecurity(session.defaultSession, {
    log: logPermissions
      ? (line: string) => {
          log.info(line);
        }
      : undefined,
    isOperator: () => false,
  });
  const nodeMenu = () => {
    installNodeMenu(priorityItem(() => nodeMenu()));
  };
  nodeMenu();
  startNode({
    userData: app.getPath('userData'),
    version: appVersion(),
    updateBase,
    installer: defaultInstaller({
      platform: process.platform,
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      testLog: testInstallLog,
      updater: autoUpdater,
    }),
    updateRate: testUpdateRate,
    windowed: windowedOutputs,
    watchdog,
    sleepGuard,
    clockSkewMs: nodeClockSkewMs,
    computerName: testComputerName ?? hostname(),
    restartAsMain: () => {
      writeRole(app.getPath('userData'), 'main');
      log.info('Restarting as Main');
      if (!noRelaunch) app.relaunch();
      app.exit(0);
    },
  });
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
  applySessionSecurity(session.defaultSession, {
    log: permissionLog,
    // MIDI controllers: the operator window's page only (never SysEx).
    isOperator: (contents) => contents !== null && contents.id === operatorWindow?.webContents.id,
  });
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

  // Tests only (never a packaged Drashti): write a library as an older Drashti kept it, then stop.
  const oldLibrary = process.env['DRASHTI_SELFTEST_LIBRARY'];
  if (process.env['DRASHTI_SELFTEST'] === 'old-library' && oldLibrary && !app.isPackaged) {
    try {
      writeOldLibrary(libraryFile(), oldLibrary, listDisplays());
      app.exit(0);
    } catch (error) {
      log.error('Could not write the old library', error);
      app.exit(1);
    }
    return;
  }
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
  // Shastra passages play like presentations, made from their texts (Session 12).
  const shastraRepo = new ShastraRepo(db);
  /** Where passages must fit: the live Look, the screen groups and the stream (set once they are made). */
  let passageTargets: () => FitTargets = () => FIT_EVERYWHERE;
  let mediaInfo: (id: string) => { name: string; missing: boolean; unplayable: string | null } | null = () =>
    null;
  const shastra = new ShastraService({
    repo: shastraRepo,
    theme: (id) => (id ? themes.get(id) : null) ?? themes.get(themes.defaultId()) ?? DEFAULT_THEME,
    targets: () => passageTargets(),
    media: (id) => mediaInfo(id),
  });
  /** What the engine plays: the library's presentations, and passages. */
  const playable: SlideSource = {
    order: (id, arrangementId) => (isPassageId(id) ? shastra.order(id) : slides.order(id, arrangementId)),
  };
  // The search index is kept as presentations are written; a library indexed by an older version is redone once.
  const search = new SearchIndex(db);
  const indexStart = performance.now();
  if (search.rebuildIfStale())
    log.info(`Search index built in ${Math.round(performance.now() - indexStart)} ms`);
  // The Shastra texts' index too, when it was folded another way (Session 13's spellings).
  const shastraIndexStart = performance.now();
  if (shastraRepo.reindexIfStale())
    log.info(`Shastra search index folded again in ${Math.round(performance.now() - shastraIndexStart)} ms`);
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
  // Bookkeeping the show writes by itself (a file's length, the music played last, a playlist opened,
  // devices and nodes last seen, the mode) never waits for an import's write lock (Session 15).
  const later = new LaterWrites(db, {
    busyTimeoutMs: LIBRARY_BUSY_TIMEOUT_MS,
    warn: (message) => {
      log.warn(message);
    },
  });
  laterWrites = later;
  const laterSetting = (key: string, value: unknown) => {
    later.write(`setting:${key}`, () => {
      settings.set(key, value);
    });
  };
  // The local network gets every engine message too (once it is on); it is made further down.
  let network: NetworkService | null = null;
  const networkTransport: EngineTransport = {
    broadcast: (message) => {
      network?.broadcast(message);
    },
  };
  // Output nodes get every engine message too (while any is paired); made further down.
  let nodeService: NodeService | null = null;
  /** What each node should copy (made with the media, further down). */
  let wantedMedia: WantedMedia | null = null;
  const nodesTransport: EngineTransport = {
    broadcast: (message) => {
      nodeService?.broadcast(message);
    },
  };
  // Looks: the engine reads them through the service, made just below (it needs the engine).
  const lookRepo = new LookRepo(db);
  let lookService: LookService | null = null;
  /** Simple Mode is on (set once the mode is read, further down). */
  let simpleNow = () => false;
  /** A media file's length, once learned from playing it (the media repo, made further down). */
  let mediaLength: (mediaId: string) => number | null = () => null;
  /** A video's or sound's start and end points and markers (the media repo, made further down). */
  let mediaMarkers: (mediaId: string) => MediaMarkers | null = () => null;
  /** Macros (made further down, once props, messages and media are): a slide's macro cue runs through it. */
  let macroService: MacroService | null = null;
  /** Macros' own times (made with the macros): told when the macros change. */
  let macroScheduler: MacroScheduler | null = null;
  /** Audio playlists (made further down): the media library changing may change them. */
  let musicService: MusicService | null = null;
  /** The arti schedules (made further down, once macros are): told when presentations change. */
  let artiService: ArtiService | null = null;
  /** Today's calendar entry (made further down): told when an import loads a calendar. */
  let calendarService: CalendarService | null = null;
  /** The idle rotation (made further down): told when media change (a picture may have gone). */
  let idleService: IdleService | null = null;
  const engine = new ShowEngine(
    playable,
    new FanoutTransport([transport, networkTransport, nodesTransport]),
    Date.now,
    { items: (id) => playlists.playItems(id) },
    {
      defaultTransition: () => defaultTransition(settings),
      looks: {
        look: (id) => lookService?.look(id) ?? null,
        start: () => lookService?.start() ?? NO_LOOK,
      },
      // Simple Mode keeps the live Look: switching it is refused from the window, a phone or the API.
      refuse: (command) =>
        simpleNow() && SIMPLE_MODE_REFUSED_COMMANDS.includes(command.type) ? SIMPLE_MODE_REFUSAL : null,
      mediaLength: (mediaId) => mediaLength(mediaId),
      mediaMarkers: (mediaId) => mediaMarkers(mediaId),
      macroCommands: (macroId) =>
        macroService?.commands(macroId) ?? { ok: false, message: 'Macros are not ready yet.' },
    },
  );
  const stageLayoutRepo = new StageLayoutRepo(db);
  const maskRepo = new MaskRepo(db);
  const looks = new LookService({
    repo: lookRepo,
    stageLayout: (id) => stageLayoutRepo.get(id),
    mask: (id) => maskRepo.get(id),
    engine,
    changed: (view) => {
      if (operatorWindow && !operatorWindow.isDestroyed())
        operatorWindow.webContents.send(IPC.looks.changed, view);
      network?.hint('looks');
    },
    log: (message) => {
      log.info(message);
    },
  });
  lookService = looks;
  // The first Look goes live (recovery below may bring back another).
  engine.refreshLook();
  const timers = new TimerRepo(db);
  engine.setTimers(timers.list());

  // ---- media ----------------------------------------------------------------
  const userDataDir = app.getPath('userData');
  const mediaDir = join(userDataDir, 'Media');
  mkdirSync(mediaDir, { recursive: true });
  const media = new MediaRepo(db);
  mediaLength = (mediaId) => media.lengthOf(mediaId);
  mediaMarkers = (mediaId) => media.markersOf(mediaId);
  // Playback markers (Session 14): kept with the file; what plays it follows at once.
  handle(IPC.media.markers, (_e, mediaId) =>
    typeof mediaId === 'string' && MEDIA_ID_PATTERN.test(mediaId)
      ? (media.markersOf(mediaId) ?? NO_MARKERS)
      : NO_MARKERS,
  );
  handle(IPC.media.setMarkers, (e, mediaId, raw) => {
    if (!fromOperator(e) || typeof mediaId !== 'string' || !MEDIA_ID_PATTERN.test(mediaId))
      return { ok: false as const, message: 'Only the operator window can set markers.' };
    const parsed = mediaMarkersSchema.safeParse(raw);
    if (!parsed.success)
      return {
        ok: false as const,
        message: parsed.error.issues[0]?.message ?? 'Those markers cannot be kept.',
      };
    if (!media.setMarkers(mediaId, parsed.data))
      return { ok: false as const, message: 'Markers are for a video or a sound in the library.' };
    engine.refreshMarkers(mediaId);
    log.info(`Markers: set on a media item (${String(parsed.data.markers.length)} marker(s))`);
    return { ok: true as const, markers: media.markersOf(mediaId) ?? NO_MARKERS };
  });
  mediaInfo = (mediaId) => {
    const found = media.kindAndName(mediaId);
    return found ? { name: found.name, missing: false, unplayable: null } : null;
  };
  const serveMedia = async (request: Request) => {
    const started = performance.now();
    if (mediaDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, mediaDelayMs));
    const response = await handleMediaRequest(request, {
      mediaDir,
      lookup: (id) => media.file(id),
      warn: (message) => {
        log.warn(message);
      },
    });
    return perfWatch ? watchedMedia(perfWatch, request, started, response) : response;
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
      groupId: s.groupId,
      groupName: screenRepo.groupName(s.groupId) ?? '',
      role: screenRepo.groupRole(s.groupId) ?? 'audience',
      feed: s.feed,
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
      // Nodes follow their screens' settings (groups, canvases, names) as they change.
      nodeService?.screensChanged();
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
    looks,
    {
      displays: () => nodeService?.displays() ?? [],
      screenStatus: () => nodeService?.screenStatus() ?? [],
    },
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
  if (perfWatch) {
    // The performance check's timeline: what the audio layer plays (the music's tracks, a sound cue).
    let heardAudio = '';
    engine.onChange((state) => {
      const a = state.layers.audio;
      const now = a
        ? `${(a.mediaId ?? '-').slice(0, 8)} from ${String(a.startedAt)}${a.music ? ` (track ${String(a.music.index + 1)})` : ''}${a.pausedAtMs === undefined ? '' : ' paused'}`
        : 'clear';
      if (now !== heardAudio) perfWatch.note(`audio layer ${now}`);
      heardAudio = now;
    });
  }
  let recovery: RecoveryNotice | null = null;
  // A restored library starts with nothing live (the saved state belongs to the library before it).
  const saved = restored.restored ? null : toRestore(recoveryFiles, lookRepo.firstId());
  if (saved) {
    const put = engine.restore(saved);
    const name = put.slide && saved.slide ? presentations.get(saved.slide.presentationId)?.name : undefined;
    recovery = {
      savedAt: saved.savedAt,
      look: put.look,
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
      masks: put.masks,
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
      // The stream's group was made: the live Look covers it.
      looks.groupsChanged();
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
  // A passage fits where the live Look shows it: audience and key and fill groups, and the stream's
  // lower third while it is on air or recording in its Camera layout.
  passageTargets = () => {
    const look = engine.snapshot().state.look;
    const context = streaming.context();
    const camera = context.layout === 'camera' && streaming.inUse();
    return fitTargets(
      look,
      screenRepo.groupIds(),
      camera ? { languages: groupLookIn(look, context.groupId).languages } : null,
    );
  };
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

  // ---- roles (Session 14): an admin PIN and an operator PIN, off until an admin sets them ---------
  // Kept in the data folder (never the library or a backup); every admin request is checked here.
  const roles = new RolesService({
    file: join(userDataDir, 'roles.json'),
    now: Date.now,
    changed: (view) => {
      sendToOperator(IPC.roles.changed, view);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  app.on('will-quit', () => {
    roles.dispose();
  });
  lockAdminChannels(
    () => roles.needsAdmin(),
    adminRefusals(
      () => audioOutput.status,
      () => roles.view(),
    ),
    () => {
      roles.touchAdmin();
    },
  );
  /** A menu item that needs the admin PIN: run now, or once the operator window has the PIN typed. */
  let pendingAdmin: { run: () => void; until: number } | null = null;
  const requireAdmin = (what: string, run: () => void) => {
    if (!roles.needsAdmin()) {
      roles.touchAdmin();
      run();
      return;
    }
    pendingAdmin = { run, until: Date.now() + 120_000 };
    sendToOperator(IPC.roles.askAdmin, { what });
  };
  handle(IPC.roles.view, () => roles.view());
  handle(IPC.roles.needsAdmin, () => roles.needsAdmin());
  handle(IPC.roles.unlock, async (e, pin) => {
    if (!fromOperator(e))
      return {
        ok: false as const,
        message: 'Only the operator window can unlock admin.',
        view: roles.view(),
      };
    const result = await roles.unlock(pin);
    // A menu item waiting for the PIN goes ahead now.
    const waiting = pendingAdmin;
    pendingAdmin = null;
    if (result.ok && waiting && Date.now() < waiting.until) setTimeout(waiting.run, 0);
    return result;
  });
  handle(IPC.roles.lock, (e) => (fromOperator(e) ? roles.lock() : roles.view()));
  const notRolesOperator = () => ({
    ok: false as const,
    message: 'Only the operator window can change the PINs.',
    view: roles.view(),
  });
  handle(IPC.roles.setPins, (e, pins) => (fromOperator(e) ? roles.setPins(pins) : notRolesOperator()));
  handle(IPC.roles.changePin, (e, change) =>
    fromOperator(e) ? roles.changePin(change) : notRolesOperator(),
  );
  handle(IPC.roles.turnOff, (e) => (fromOperator(e) ? roles.turnOff() : notRolesOperator()));
  handle(IPC.roles.cancelAsk, (e) => {
    if (fromOperator(e)) pendingAdmin = null;
    return null;
  });

  // ---- Simple Mode ----------------------------------------------------------------
  // Remembered in the library's settings, so Drashti (and restart recovery) comes back in it.
  const savedMode = settings.get('operatorMode');
  let mode: OperatorMode = isOperatorMode(savedMode) ? savedMode : 'pro';
  // With roles on, a clean start begins in Simple Mode (Pro Mode takes a PIN); after an unexpected
  // stop the show comes back in the mode it was in, so the operator carries on (admin locked).
  if (roles.on() && mode === 'pro' && saved === null) {
    mode = 'simple';
    settings.set('operatorMode', mode);
    log.info('Roles are on: starting in Simple Mode');
  }
  if (mode === 'simple') log.info('Starting in Simple Mode');
  simpleNow = () => mode === 'simple';
  // While it is on, every request that would change the library, screens or sound is refused here.
  lockChannels(
    () => mode === 'simple',
    simpleModeRefusals(() => audioOutput.status),
  );
  let rebuildMenu: () => void = () => undefined;
  const setMode = (next: OperatorMode) => {
    if (next === mode) return;
    mode = next;
    laterSetting('operatorMode', next);
    // A volunteer's mode: admin locks at once.
    if (next === 'simple') roles.lock();
    log.info(next === 'simple' ? 'Switched to Simple Mode' : 'Switched to Pro Mode');
    rebuildMenu();
    sendToOperator(IPC.app.modeChanged, { mode: next });
  };
  handle(IPC.app.getMode, () => mode);
  handle(IPC.app.setMode, async (e, wanted, word): Promise<ModeResult> => {
    if (!fromOperator(e) || !isOperatorMode(wanted))
      return { ok: false, message: 'Only the operator window can switch the mode.' };
    if (mode === 'simple' && wanted === 'pro') {
      // With roles on, leaving Simple Mode takes a PIN (the admin PIN unlocks admin too)...
      if (roles.on()) {
        const entered = await roles.enter(typeof word === 'string' ? word : '');
        if (!entered.ok) return { ok: false, message: entered.message };
      } else if (!(typeof word === 'string' && isLeaveWord(word)))
        // ...otherwise the word, typed on purpose.
        return { ok: false, message: 'Type pro to switch to Pro Mode.' };
    }
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
      // An arti's presentation may have been renamed or removed.
      artiService?.refresh();
      // A picture in the idle rotation may have gone (or come back).
      idleService?.refresh();
      // What the nodes should copy may have changed.
      wantedMedia?.invalidate();
      nodeService?.libraryChanged();
      // A sound in an audio playlist may have been converted, found or lost.
      if (musicService) sendToOperator(IPC.music.changed, musicService.view());
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
    if (what === 'props' || what === 'messages' || what === 'shastra') network?.hint(what);
    if (what === 'props') {
      wantedMedia?.invalidate();
      nodeService?.libraryChanged();
    }
  };
  // ---- PDF, PowerPoint and Keynote as pictures (Session 15) --------------------------------------
  // The import worker asks; a hidden window of its own draws each page with pdf.js.
  const pdfPictures = new PdfPictures({
    open: createPicturesWindow,
    size: () => pictureSize(screenRepo.allScreens(), screenRepo.firstGroup('audience')),
    assetDirs: (kind) => {
      const folder = kind === 'wasmUrl' ? 'wasm' : kind === 'cMapUrl' ? 'cmaps' : 'standard_fonts';
      // The built app's copy; from the source, the package's own.
      return [
        join(rendererDir(), 'pdfjs', folder),
        join(app.getAppPath(), 'node_modules', 'pdfjs-dist', folder),
      ];
    },
    log: (message) => {
      log.info(message);
    },
  });
  handle(IPC.pictures.job, (e) => pdfPictures.job(e.sender));
  handle(IPC.pictures.page, (e, page) => pdfPictures.page(e.sender, page));
  handle(IPC.pictures.done, (e, done) => {
    pdfPictures.done(e.sender, done);
    return null;
  });
  handle(IPC.pictures.asset, (e, kind, name) => pdfPictures.asset(e.sender, kind, name));
  const imports = new ImportService({
    spawn: spawnImportWorker,
    worker: {
      dbFile: libraryFile(),
      mediaDir,
      userDataDir,
      schemaVersion: LATEST_VERSION,
      // Tests only (never a packaged Drashti): as if no Keynote or PowerPoint were installed.
      converters: app.isPackaged || process.env['DRASHTI_TEST_NO_CONVERTER'] !== '1',
    },
    drawPdf: (pdf, outDir, signal) => pdfPictures.draw(pdf, outDir, signal),
    onProgress: (progress) => {
      sendToOperator(IPC.library.importProgress, progress);
    },
    onWrote: ({ presentationId, replaced }) => {
      perfWatch?.note('import wrote a presentation');
      if (replaced) slides.invalidate(presentationId);
      libraryChanged();
    },
    onFinished: () => {
      // An import can change what comes next (a replaced presentation, a filled playlist).
      engine.refreshNext();
      libraryChanged(true);
      // It may have loaded a Shastra text (or loaded one again).
      listChanged('shastra');
      // Or a calendar.
      calendarService?.refresh();
    },
    failRun: (runId, paths, message) => {
      importRepo.failRun(runId, paths, message);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    // Keynote or PowerPoint put a message in front of the operator: the keys come back here.
    refocus: () => {
      if (!operatorWindow || operatorWindow.isDestroyed()) return;
      app.focus({ steal: true });
      operatorWindow.focus();
    },
  });
  importer = imports;
  // An operator's edit during an import (Session 16): every request that changes something (the
  // ones Simple Mode refuses) waits, without holding up the main process, for the import to give
  // way between files, then writes with nothing in its way. Starting or stopping an import does not.
  const edits = new Set<string>(SIMPLE_MODE_LOCKED);
  for (const c of [IPC.library.importPaths, IPC.library.pickImportPaths, IPC.library.relinkMedia])
    edits.delete(c);
  setGiveWay((channel) => {
    if (imports.activeRunId === null || !edits.has(channel)) return null;
    // Usually the lock is free (the import holds it only while it writes a group): go at once.
    if (writeLockFree(libraryDb, LIBRARY_BUSY_TIMEOUT_MS)) {
      imports.wayStats.free++;
      return null;
    }
    // Taken: ask the import to give way, and go the moment the lock is free (its group's own commit
    // may come first), never waiting for it here.
    const way = imports.giveWay();
    return whenFree(() => writeLockFree(libraryDb, LIBRARY_BUSY_TIMEOUT_MS), way.ready).then((how) => {
      if (how === 'free') imports.wayStats.freedMeanwhile++;
      return way.done;
    });
  });

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
  // ---- macros (shared/macros.ts): run as one change; Simple Mode runs none ------------------
  const propItem = (id: string): PropItem | null => {
    const p = props.list().find((x) => x.id === id);
    return p ? asPropItem(p) : null;
  };
  const markedLogo = (): PropItem | null => {
    const id = settings.get('logoPropId');
    return typeof id === 'string' ? propItem(id) : null;
  };
  const macros = new MacroService({
    repo: new MacroRepo(db),
    engine: {
      state: () => engine.current,
      runMacro: (commands) => engine.runMacro(commands),
    },
    reads: {
      prop: propItem,
      template: (id) => messageTemplates.list().find((t) => t.id === id) ?? null,
      media: (id) => media.kindAndName(id),
      logo: markedLogo,
    },
    simple: () => mode === 'simple',
    changed: (list) => {
      sendToOperator(IPC.macros.changed, list);
      network?.hint('macros');
      // A macro's times may have changed.
      macroScheduler?.refresh();
    },
    log: (message) => {
      log.info(message);
    },
  });
  macroService = macros;
  // Macros that run by themselves at their times (Session 14): a ten-second countdown with Cancel,
  // in either mode (the one exception to Simple Mode running no macros), never late.
  macroScheduler = new MacroScheduler({
    macros: () => macros.list(),
    run: (id) => macros.run(id, 'its schedule', { scheduled: true }),
    now: scheduleNow,
    engineNow: Date.now,
    changed: (view) => {
      sendToOperator(IPC.macros.countdownChanged, view);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  const scheduler = macroScheduler;
  app.on('will-quit', () => {
    scheduler.dispose();
  });
  handle(IPC.macros.countdown, () => scheduler.view());
  handle(IPC.macros.cancelScheduled, (e, key) =>
    fromOperator(e) ? scheduler.cancel(key) : scheduler.view(),
  );
  // ---- audio playlists (Session 14): music on the audio layer, independent of the slides ------------
  const music = new MusicService({
    repo: new AudioPlaylistRepo(db),
    settings: { get: (key) => settings.get(key), set: laterSetting },
    engine: { state: () => engine.current, dispatch: (command) => engine.dispatch(command) },
    changed: (view) => {
      sendToOperator(IPC.music.changed, view);
    },
    log: (message) => {
      log.info(message);
    },
  });
  musicService = music;
  const notMusicOperator = { ok: false as const, message: 'Only the operator window can change music.' };
  handle(IPC.music.view, () => music.view());
  handle(IPC.music.create, (e, name) => (fromOperator(e) ? music.create(name) : notMusicOperator));
  handle(IPC.music.rename, (e, id, name) => (fromOperator(e) ? music.rename(id, name) : notMusicOperator));
  handle(IPC.music.remove, (e, id) => (fromOperator(e) ? music.remove(id) : notMusicOperator));
  handle(IPC.music.setOptions, (e, id, options) =>
    fromOperator(e) ? music.setOptions(id, options) : notMusicOperator,
  );
  handle(IPC.music.addTracks, (e, id, mediaIds, at) =>
    fromOperator(e) ? music.addTracks(id, mediaIds, at) : notMusicOperator,
  );
  handle(IPC.music.moveTrack, (e, id, to) => (fromOperator(e) ? music.moveTrack(id, to) : notMusicOperator));
  handle(IPC.music.removeTrack, (e, id) => (fromOperator(e) ? music.removeTrack(id) : notMusicOperator));
  handle(IPC.music.play, (e, playlistId, trackIndex) => {
    const parsed = musicPlaySchema.safeParse({ playlistId, index: trackIndex ?? 0 });
    if (!fromOperator(e) || !parsed.success) return notMusicOperator;
    return music.play(parsed.data.playlistId, parsed.data.index);
  });
  // ---- the arti at its time ---------------------------------------------------------------
  const arti = new ArtiService({
    repo: new ArtiRepo(db),
    engine: {
      state: () => engine.current,
      dispatch: (command) => engine.dispatch(command),
      onChange: (listener) => engine.onChange(listener),
    },
    now: scheduleNow,
    engineNow: Date.now,
    changed: (view) => {
      sendToOperator(IPC.arti.changed, view);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  artiService = arti;
  app.on('will-quit', () => {
    arti.dispose();
  });
  // ---- scheduled backups (Session 14): into a folder an admin picks, at their times ----------------
  const scheduledBackups = new ScheduledBackups({
    settings,
    now: scheduleNow,
    engineNow: Date.now,
    onAir: () => streaming.inUse(),
    busy: handBackupRunning,
    spawn: spawnBackupWorker,
    dbFile: libraryFile(),
    mediaDir,
    userData: userDataDir,
    app: app.getVersion(),
    schema: LATEST_VERSION,
    sameDisk,
    changed: (view) => {
      sendToOperator(IPC.backups.changed, view);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    ...(testBackupRate ? { bytesPerSecond: testBackupRate } : {}),
  });
  app.on('will-quit', () => {
    scheduledBackups.dispose();
  });
  const notBackupsOperator = { ok: false as const, message: 'Only the operator window can change backups.' };
  handle(IPC.backups.view, () => scheduledBackups.view());
  handle(IPC.backups.save, (e, schedule) =>
    fromOperator(e) ? scheduledBackups.save(schedule) : notBackupsOperator,
  );
  handle(IPC.backups.runNow, (e) => (fromOperator(e) ? scheduledBackups.runNow() : notBackupsOperator));
  handle(IPC.backups.dismiss, () => scheduledBackups.dismiss());
  handle(IPC.backups.pickFolder, async (e) => {
    if (!fromOperator(e) || !operatorWindow) return notBackupsOperator;
    const picked = await dialog.showOpenDialog(operatorWindow, {
      title: 'Back Up Into',
      message: 'Choose where scheduled backups go: a USB drive or another disk is best.',
      buttonLabel: 'Choose',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    });
    return { ok: true as const, folder: picked.canceled ? null : (picked.filePaths[0] ?? null) };
  });
  // ---- updates (Session 14): an admin checks, downloads and says to install when Drashti quits ----
  const updates = new UpdateService({
    current: appVersion(),
    platform: process.platform,
    arch: process.arch,
    base: updateBase,
    dir: join(userDataDir, 'Updates'),
    fetch: (url, init) => electronNet.fetch(url, init),
    installer: defaultInstaller({
      platform: process.platform,
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      testLog: testInstallLog,
      updater: autoUpdater,
    }),
    onAir: () => streaming.inUse() || testOnAir,
    autoCheck: {
      get: () => settings.get('updates.autoCheck') === true,
      set: (on) => {
        settings.set('updates.autoCheck', on);
      },
    },
    now: Date.now,
    changed: (view) => {
      sendToOperator(IPC.updates.changed, view);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    ...(testUpdateRate ? { bytesPerSecond: testUpdateRate } : {}),
  });
  app.on('will-quit', () => {
    updates.quit();
  });
  const notUpdatesOperator = { ok: false as const, message: 'Only the operator window can update Drashti.' };
  handle(IPC.updates.view, () => updates.view());
  handle(IPC.updates.check, (e) => (fromOperator(e) ? updates.check() : notUpdatesOperator));
  handle(IPC.updates.download, (e) => (fromOperator(e) ? updates.download() : notUpdatesOperator));
  handle(IPC.updates.cancel, (e) => (fromOperator(e) ? updates.cancel() : notUpdatesOperator));
  handle(IPC.updates.setInstallOnQuit, (e, on) =>
    fromOperator(e) && typeof on === 'boolean' ? updates.setInstallOnQuit(on) : notUpdatesOperator,
  );
  handle(IPC.updates.setAutoCheck, (e, on) =>
    fromOperator(e) && typeof on === 'boolean' ? updates.setAutoCheck(on) : notUpdatesOperator,
  );
  handle(IPC.updates.showFile, (e) => {
    const file = updates.downloadedFile();
    if (fromOperator(e) && file) shell.showItemInFolder(file);
    return null;
  });
  if (artiTestClock)
    (globalThis as { drashtiArtiClock?: (wallMs: number) => void }).drashtiArtiClock = (wallMs) => {
      artiClockOffset = wallMs - Date.now();
      arti.check();
      scheduledBackups.check();
      scheduler.check();
    };
  // ---- Samvat and tithi: today's entry from the loaded calendars -------------------------
  const calendars = new CalendarService({
    repo: new CalendarRepo(db),
    engine: { setCalendar: (day) => engine.setCalendar(day) },
    now: Date.now,
    changed: (view) => {
      sendToOperator(IPC.calendar.changed, view);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  calendarService = calendars;
  app.on('will-quit', () => {
    calendars.dispose();
  });
  handle(IPC.calendar.view, () => calendars.view());
  handle(IPC.calendar.remove, (e, id) => {
    const which = calendarIdSchema.safeParse(id);
    return fromOperator(e) && which.success
      ? calendars.remove(which.data)
      : { ok: false as const, message: 'Only the operator window can remove a calendar.' };
  });
  // ---- the idle rotation: its pictures, timing and quotes into the engine ------------------
  const idleRotation = new IdleService({
    quotes: new QuoteRepo(db),
    settings,
    picture: (id) => {
      const m = media.kindAndName(id);
      return m?.kind === 'image' ? { name: m.name } : null;
    },
    engine: { setIdle: (content) => engine.setIdle(content), setQuote: (quote) => engine.setQuote(quote) },
    now: Date.now,
    changed: (view) => {
      sendToOperator(IPC.idle.changed, view);
    },
  });
  idleService = idleRotation;
  app.on('will-quit', () => {
    idleRotation.dispose();
  });
  const notIdleOperator = {
    ok: false as const,
    message: 'Only the operator window can change the idle rotation.',
  };
  handle(IPC.idle.view, () => idleRotation.view());
  handle(IPC.idle.saveSettings, (e, value) =>
    fromOperator(e) ? idleRotation.saveSettings(value) : notIdleOperator,
  );
  handle(IPC.idle.saveQuote, (e, id, quote) => {
    const which = quoteIdSchema.nullable().safeParse(id);
    return fromOperator(e) && which.success ? idleRotation.saveQuote(which.data, quote) : notIdleOperator;
  });
  handle(IPC.idle.removeQuote, (e, id) => {
    const which = quoteIdSchema.safeParse(id);
    return fromOperator(e) && which.success ? idleRotation.removeQuote(which.data) : notIdleOperator;
  });
  const notArtiOperator = {
    ok: false as const,
    message: 'Only the operator window can change arti schedules.',
  };
  const artiGone = { ok: false as const, message: 'That arti prompt has gone.' };
  handle(IPC.arti.view, () => arti.view());
  handle(IPC.arti.save, (e, id, fields) => {
    if (!fromOperator(e)) return notArtiOperator;
    const which = idSchema.nullable().safeParse(id);
    return which.success ? arti.save(which.data, fields) : notArtiOperator;
  });
  handle(IPC.arti.setEnabled, (e, id, enabled) => {
    const which = idSchema.safeParse(id);
    return fromOperator(e) && which.success && typeof enabled === 'boolean'
      ? arti.setEnabled(which.data, enabled)
      : notArtiOperator;
  });
  handle(IPC.arti.remove, (e, id) => {
    const which = idSchema.safeParse(id);
    return fromOperator(e) && which.success ? arti.remove(which.data) : notArtiOperator;
  });
  // Answering the prompt: the operator window, in either mode.
  const answer = (e: IpcMainInvokeEvent, key: unknown, run: (key: string) => ArtiAnswer) => {
    const parsed = artiKeySchema.safeParse(key);
    return fromOperator(e) && parsed.success ? run(parsed.data) : artiGone;
  };
  handle(IPC.arti.putUp, (e, key) => answer(e, key, (k) => arti.putUp(k)));
  handle(IPC.arti.notNow, (e, key) => answer(e, key, (k) => arti.notNow(k)));
  handle(IPC.arti.cancel, (e, key) => answer(e, key, (k) => arti.cancel(k)));
  const notMacroOperator = {
    ok: false as const,
    message: 'Only the operator window can change or run macros.',
  };
  handle(IPC.macros.list, () => macros.list());
  handle(IPC.macros.save, (e, id, macro) => (fromOperator(e) ? macros.save(id, macro) : notMacroOperator));
  handle(IPC.macros.remove, (e, id) => (fromOperator(e) ? macros.remove(id) : notMacroOperator));
  handle(IPC.macros.run, (e, id) => (fromOperator(e) ? macros.run(id) : notMacroOperator));
  // The MIDI controller's settings: which device, and what its notes and controllers do.
  handle(IPC.midi.get, () => {
    const parsed = midiSettingsSchema.safeParse(settings.get('midi'));
    return parsed.success ? parsed.data : NO_MIDI;
  });
  handle(IPC.midi.set, (e, raw) => {
    if (!fromOperator(e)) return { ok: false as const, message: 'Only the operator window can set up MIDI.' };
    const parsed = midiSettingsSchema.safeParse(raw);
    if (!parsed.success) return { ok: false as const, message: 'Those MIDI settings cannot be kept.' };
    settings.set('midi', parsed.data);
    return { ok: true as const, settings: parsed.data };
  });

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
    write: (key, run) => {
      later.write(key, run);
    },
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
      presentation: (presentationId) =>
        isPassageId(presentationId) ? shastra.doc(presentationId) : presentations.get(presentationId),
      shastraTexts: () =>
        shastra.list().map((t) => ({ name: t.name, abbreviation: t.abbreviation, itemCount: t.itemCount })),
      passage: (reference) => shastra.resolve(reference),
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
      stage: () => {
        const groupId = screenRepo.firstGroup('stage');
        return { groupId, languages: groupId ? looks.liveLanguages(groupId) : null };
      },
      looks: () => lookRepo.list().map((l) => ({ id: l.id, name: l.name })),
      macros: () => macros.list().map((m) => ({ id: m.id, name: m.name, color: m.color })),
      clockStyle: () => ({
        locale: app.getLocale(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    },
    runMacro: (id, who) => macros.run(id, who),
    playMusic: (who) => {
      const played = music.play(null);
      if (played.ok) log.info(`Music: ${who} played it`);
      return played.ok ? { ok: true as const } : { ok: false as const, message: played.message };
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

  // ---- output nodes (Session 13) ----------------------------------------------------------------
  const nodeRepo = new NodeRepo(db);
  const wanted = new WantedMedia(db, () => {
    const idle = settings.get('idleRotation') as { pictures?: unknown } | undefined;
    return Array.isArray(idle?.pictures)
      ? idle.pictures.filter((p): p is string => typeof p === 'string')
      : [];
  });
  wantedMedia = wanted;
  const mainName = () =>
    testComputerName ?? localName()?.replace(/\.local$/u, '') ?? hostname().replace(/\.local$/u, '');
  let identityCache: ReturnType<typeof loadOrMakeIdentity> | null = null;
  /** How each of Main's own outputs draws (they report every few seconds), for the dashboard. */
  const localReports = new Map<string, { droppedFrames: number; paintedRev: number }>();
  const nodes = new NodeService({
    nodes: nodeRepo,
    write: (key, run) => {
      later.write(key, run);
    },
    screens: screenRepo,
    settings,
    spawn: () =>
      spawnLinkWorker((line) => {
        log.info(`[node link worker] ${line}`);
      }),
    identity: () => {
      identityCache ??= loadOrMakeIdentity(userDataDir, mainName());
      return {
        cert: identityCache.certPem,
        key: identityCache.keyPem,
        fingerprint: identityCache.fingerprint,
        id: identityCache.id,
        name: mainName(),
      };
    },
    version: appVersion(),
    // Listening on this computer only (tests, the performance check), this computer is the only address.
    addresses: () =>
      networkLocalOnly || perfTest
        ? ['127.0.0.1']
        : [
            ...localInterfaceAddresses().filter((a) => !a.includes(':')),
            ...(localName() ? [localName() ?? ''] : []),
          ],
    bind: networkLocalOnly || perfTest ? '127.0.0.1' : '0.0.0.0',
    engine: {
      snapshot: () => engine.snapshot(),
      state: () => engine.current,
      rev: () => engine.rev,
      session: engine.session,
    },
    wanted: (state, everything) => wanted.list(state, everything),
    mediaFile: (mediaId) => wanted.source(mediaId, mediaDir),
    onAir: () => streaming.inUse(),
    changed: (status) => {
      sendToOperator(IPC.nodes.changed, status);
    },
    screensChanged: () => {
      sendToOperator(IPC.screens.changed, screens.snapshot());
    },
    thumbs: (thumbs) => {
      sendToOperator(IPC.nodes.thumbs, thumbs);
    },
    localOutputs: () =>
      manager.status().flatMap((st): NodeOutputStatus[] =>
        st.state === 'showing' || st.state === 'missing-display' || st.state === 'disabled'
          ? [
              {
                screenId: st.screenId,
                state: st.state,
                displayId: st.displayId,
                droppedFrames: localReports.get(st.screenId)?.droppedFrames ?? 0,
                paintedRev: localReports.get(st.screenId)?.paintedRev ?? -1,
              },
            ]
          : [],
      ),
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    now: Date.now,
    portOverride: nodePortOverride,
    copyRateOverride: testCopyRate,
  });
  nodeService = nodes;
  nodes.resume();
  app.on('will-quit', () => {
    void nodes.close();
  });
  // Pictures of Main's own outputs for the dashboard, every few seconds while it is open.
  let localThumbs: NodeJS.Timeout | null = null;
  const captureLocal = () => {
    for (const [screenId, win] of outputWindows) {
      if (win.isDestroyed()) continue;
      void win.webContents
        .capturePage()
        .then((image) => {
          if (image.isEmpty()) return;
          const jpeg = image.resize({ width: 320, quality: 'good' }).toJPEG(60).toString('base64');
          const thumb: ScreenThumb = {
            screenId,
            nodeId: null,
            url: `data:image/jpeg;base64,${jpeg}`,
            at: Date.now(),
          };
          sendToOperator(IPC.nodes.thumbs, [thumb]);
        })
        .catch(() => undefined);
    }
  };
  const notNodesOperator = { ok: false as const, message: 'Only the operator window can change the nodes.' };
  handle(IPC.nodes.status, () => nodes.status());
  handle(IPC.nodes.startPairing, (e) => (fromOperator(e) ? nodes.startPairing() : notNodesOperator));
  handle(IPC.nodes.cancelPairing, (e) => (fromOperator(e) ? nodes.cancelPairing() : notNodesOperator));
  handle(IPC.nodes.rename, (e, id, name) => (fromOperator(e) ? nodes.rename(id, name) : notNodesOperator));
  handle(IPC.nodes.remove, (e, id) => (fromOperator(e) ? nodes.remove(id) : notNodesOperator));
  handle(IPC.nodes.everything, (e, id, on) =>
    fromOperator(e) ? nodes.setEverything(id, on) : notNodesOperator,
  );
  handle(IPC.nodes.reload, (e, nodeId, screenId) => {
    if (!fromOperator(e)) return notNodesOperator;
    const sid = idSchema.safeParse(screenId);
    if (!sid.success) return { ok: false as const, message: 'That screen no longer exists.' };
    if (nodeId === null) {
      const win = outputWindows.get(sid.data);
      if (!win || win.isDestroyed()) return { ok: false as const, message: 'That screen is not showing.' };
      log.info('Reloading an output from the screens dashboard');
      win.webContents.reload();
      return { ok: true as const, status: nodes.status() };
    }
    const nid = idSchema.safeParse(nodeId);
    return nid.success
      ? nodes.reload(nid.data, sid.data)
      : { ok: false as const, message: 'That node is no longer paired.' };
  });
  handle(IPC.nodes.identify, (e, nodeId, displayId) => {
    if (!fromOperator(e)) return null;
    const display = typeof displayId === 'number' && Number.isFinite(displayId) ? displayId : null;
    if (nodeId === null) {
      // Main's own: the output on that display says its name, or the display its number.
      const shownOn = listDisplays()
        .map((d, i) => ({ d, n: i + 1 }))
        .filter(({ d }) => display === null || d.id === display);
      for (const { d, n } of shownOn) {
        const st = manager.status().find((x) => x.displayId === d.id && x.state === 'showing');
        const win = st ? outputWindows.get(st.screenId) : undefined;
        const sc = st ? screenRepo.screen(st.screenId) : null;
        if (win && sc && !win.isDestroyed())
          win.webContents.send(IPC.output.identify, {
            name: `${n}: ${sc.name}`,
            groupName: screenRepo.groupName(sc.groupId) ?? '',
          });
        else if (operatorDisplayId() !== d.id)
          showDisplayNumber(d, n, { windowed: windowedOutputs, forMs: 5000 });
      }
      return null;
    }
    const nid = idSchema.safeParse(nodeId);
    if (nid.success) nodes.identify(nid.data, display);
    return null;
  });
  handle(IPC.nodes.watch, (e, on) => {
    if (!fromOperator(e)) return null;
    const watching = on === true;
    nodes.watch(watching);
    if (localThumbs) clearInterval(localThumbs);
    localThumbs = null;
    if (watching) {
      captureLocal();
      localThumbs = setInterval(captureLocal, 3000);
    }
    return null;
  });
  handle(IPC.output.report, (e, raw) => {
    const screenId = manager.screenIdFor(e.sender.id);
    const r = raw as { droppedFrames?: unknown; paintedRev?: unknown } | null;
    if (screenId && typeof r?.droppedFrames === 'number' && typeof r.paintedRev === 'number')
      localReports.set(screenId, { droppedFrames: r.droppedFrames, paintedRev: r.paintedRev });
    return null;
  });
  handle(IPC.screens.assignNodeDisplay, (e, groupId, nodeId, displayId) =>
    fromOperator(e) ? screens.assignNodeDisplay(groupId, nodeId, displayId) : notAllowed,
  );
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
    opened: (playlistId) => {
      // Opened on Main, a playlist from an earlier week counts as this week's: nodes copy its media.
      const since = new Date(Date.now() - RECENT_DAYS * 24 * 3600 * 1000).toISOString();
      later.write(`opened:${playlistId}`, () => {
        if (playlists.markOpened(playlistId, since)) {
          wanted.invalidate();
          nodes.libraryChanged();
        }
      });
    },
  });
  handle(IPC.library.getPresentation, (_event, id) => {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return null;
    return isPassageId(parsed.data) ? shastra.doc(parsed.data) : presentations.get(parsed.data);
  });
  // ---- Shastra texts (Session 12) ----------------------------------------------------
  const textIdSchema = idSchema;
  handle(IPC.shastra.list, () => shastra.list());
  handle(IPC.shastra.tree, (_e, textId) => {
    const parsed = textIdSchema.safeParse(textId);
    return parsed.success ? shastra.tree(parsed.data) : null;
  });
  handle(IPC.shastra.resolve, (_e, reference) => {
    const parsed = referenceInputSchema.safeParse(reference);
    return parsed.success
      ? shastra.resolve(parsed.data)
      : { ok: false as const, message: 'Type a reference, for example “SD 14”.' };
  });
  handle(IPC.shastra.search, (_e, query) => {
    const parsed = shastraSearchSchema.safeParse(query);
    return parsed.success ? shastra.search(parsed.data) : [];
  });
  handle(IPC.shastra.passage, (_e, id) => {
    const parsed = passageIdSchema.safeParse(id);
    return parsed.success ? shastra.info(parsed.data) : null;
  });
  handle(IPC.shastra.itemPassage, (_e, itemId) => {
    const parsed = idSchema.safeParse(itemId);
    return parsed.success ? shastra.itemPassage(parsed.data) : null;
  });
  handle(IPC.shastra.setTheme, (e, textId, themeId) => {
    if (!fromOperator(e))
      return { ok: false as const, message: 'Only the operator window can change a text.' };
    const t = textIdSchema.safeParse(textId);
    const th = idSchema.nullable().safeParse(themeId);
    if (!t.success || !th.success) return { ok: false as const, message: 'That is not a text or a theme.' };
    if (th.data !== null && !themes.get(th.data))
      return { ok: false as const, message: 'That theme is not in the library.' };
    if (!shastra.setTheme(t.data, th.data))
      return { ok: false as const, message: 'That text is not loaded.' };
    listChanged('shastra');
    // A live passage of this text is drawn again with its new theme as it next changes slide.
    engine.refreshNext();
    return { ok: true as const, texts: shastra.list() };
  });
  handle(IPC.shastra.remove, (e, textId) => {
    if (!fromOperator(e))
      return { ok: false as const, message: 'Only the operator window can remove a text.' };
    const t = textIdSchema.safeParse(textId);
    if (!t.success || !shastra.remove(t.data))
      return { ok: false as const, message: 'That text is not loaded.' };
    listChanged('shastra');
    engine.refreshNext();
    return { ok: true as const, texts: shastra.list() };
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
  // A window playing a video or sound says how long it is: kept, and the layer playing it says so.
  const lengthSchema = z
    .number()
    .positive()
    .max(24 * 3600 * 1000);
  handle(IPC.media.reportLength, (e, mediaId, durationMs) => {
    const player = manager.screenIdFor(e.sender.id) !== undefined || fromAudioPlayer(e);
    const ms = lengthSchema.safeParse(durationMs);
    if (!player || typeof mediaId !== 'string' || !MEDIA_ID_PATTERN.test(mediaId) || !ms.success) return null;
    const rounded = Math.round(ms.data);
    later.write(`length:${mediaId}`, () => {
      media.setLength(mediaId, rounded);
    });
    engine.learnLength(mediaId, rounded);
    return null;
  });
  handle(IPC.audio.reportDevices, (e, devices, state) => {
    if (fromAudioPlayer(e)) audioOutput.report(devices, state);
    return null;
  });
  // ---- stage layouts (a stage group gets one through the live Look) ----------------------------------
  const stageLayouts = new StageLayoutService({
    repo: stageLayoutRepo,
    forgetInLooks: (id) => {
      lookRepo.forgetStageLayout(id);
    },
    changed: (layouts) => {
      sendToOperator(IPC.stageLayouts.changed, layouts);
      looks.layoutsChanged();
    },
    log: (message) => {
      log.info(message);
    },
  });
  const notLayoutOperator = {
    ok: false as const,
    message: 'Only the operator window can change stage layouts.',
  };
  handle(IPC.stageLayouts.list, () => stageLayouts.list());
  handle(IPC.stageLayouts.save, (e, id, layout) =>
    fromOperator(e) ? stageLayouts.save(id, layout) : notLayoutOperator,
  );
  handle(IPC.stageLayouts.remove, (e, id) => (fromOperator(e) ? stageLayouts.remove(id) : notLayoutOperator));

  // ---- the mask library (a group's own in a Look; one up on the Masks layer) ---------------------
  const masks = new MaskService({
    repo: maskRepo,
    forgetInLooks: (id) => {
      lookRepo.forgetMask(id);
    },
    layer: {
      shown: () => engine.current.layers.masks,
      show: (mask) => {
        engine.dispatch({ type: 'setMask', mask });
      },
      clear: () => {
        engine.dispatch({ type: 'clearLayer', layer: 'masks' });
      },
    },
    changed: (list) => {
      sendToOperator(IPC.masks.changed, list);
      looks.masksChanged();
    },
    log: (message) => {
      log.info(message);
    },
  });
  const notMaskOperator = { ok: false as const, message: 'Only the operator window can change masks.' };
  handle(IPC.masks.list, () => masks.list());
  handle(IPC.masks.save, (e, id, mask) => (fromOperator(e) ? masks.save(id, mask) : notMaskOperator));
  handle(IPC.masks.remove, (e, id) => (fromOperator(e) ? masks.remove(id) : notMaskOperator));

  // ---- Looks (switching the live one is the engine's setLook) ---------------------------------
  const notLookOperator = { ok: false as const, message: 'Only the operator window can change the Looks.' };
  handle(IPC.looks.list, () => looks.view());
  handle(IPC.looks.create, (e, name, copyOf) =>
    fromOperator(e) ? looks.create(name, copyOf) : notLookOperator,
  );
  handle(IPC.looks.rename, (e, id, name) => (fromOperator(e) ? looks.rename(id, name) : notLookOperator));
  handle(IPC.looks.remove, (e, id) => (fromOperator(e) ? looks.remove(id) : notLookOperator));
  handle(IPC.looks.move, (e, id, to) => (fromOperator(e) ? looks.move(id, to) : notLookOperator));
  handle(IPC.looks.setGroup, (e, lookId, groupId, patch) =>
    fromOperator(e) ? looks.setGroup(lookId, groupId, patch) : notLookOperator,
  );
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
    // A stage display in a browser follows the first stage group: it may be another now.
    net.hint('screens');
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
      net.hint('screens');
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
  operatorWindow.webContents.once('did-finish-load', () => {
    holdPriority('with the operator window open');
  });
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
  const ensureTestOutput = async (name: string, count = 1) => {
    if (showingCount() > 0) return () => undefined;
    const created = screens.createGroup(name);
    const groupId = createdGroupId(created, name);
    for (const display of listDisplays().slice(0, count))
      if (groupId) screens.assignDisplay(groupId, display.id, { coverOperator: true });
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
      // Drashti starts again at once: an update waits for a quit of its own.
      updates.holdForNextQuit();
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

  /** File > Use This Computer as a Node…: asks, then restarts as a node (an admin, Pro Mode). */
  const useAsNode = () => {
    const box = {
      type: 'question' as const,
      buttons: ['Cancel', 'Use as a node'],
      defaultId: 0,
      cancelId: 0,
      message: 'Use this computer as a node?',
      detail:
        'Drashti restarts as a node: it then shows screens for another computer that runs Drashti as Main, and has no library or controls of its own. The screens go black while it restarts. The library stays on this computer, untouched; switching back (in the node’s window) brings it back.',
    };
    const parent = operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : undefined;
    const choice = parent ? dialog.showMessageBoxSync(parent, box) : dialog.showMessageBoxSync(box);
    if (choice !== 1) return;
    writeRole(userDataDir, 'node');
    log.info('Restarting as a node');
    updates.holdForNextQuit();
    liveWriter.markClean();
    quitConfirmed = true;
    if (!noRelaunch) app.relaunch();
    app.quit();
  };
  rebuildMenu = () => {
    installMenu(menuActions());
  };
  const menuActions = (): Parameters<typeof installMenu>[0] => ({
    mode,
    switchMode,
    setUpScreens: () => {
      if (mode === 'pro')
        requireAdmin('set up the screens', () => {
          sendToOperator(IPC.setup.open, { at: Date.now() });
        });
    },
    backUpLibrary: () => {
      if (mode === 'pro')
        requireAdmin('back up the library', () => {
          void backUp(backupUi);
        });
    },
    restoreLibrary: () => {
      if (mode === 'pro')
        requireAdmin('restore the library', () => {
          void restore(backupUi);
        });
    },
    rolesAndPins: () => {
      if (mode === 'pro') sendToOperator(IPC.roles.open, { at: Date.now() });
    },
    scheduledBackups: () => {
      if (mode === 'pro') sendToOperator(IPC.backups.open, { at: Date.now() });
    },
    checkForUpdates: () => {
      if (mode === 'pro') sendToOperator(IPC.updates.open, { at: Date.now() });
    },
    priority: (() => {
      const item = priorityItem((text) => {
        rebuildMenu();
        sendToOperator(IPC.app.notice, { text });
      });
      return (
        item && {
          ahead: item.ahead,
          toggle: () => {
            // The tick follows the setting, not the click, until an admin has said so.
            rebuildMenu();
            if (mode === 'pro') requireAdmin('change how Drashti runs beside other programs', item.toggle);
          },
        }
      );
    })(),
    useAsNode: () => {
      if (mode === 'pro') requireAdmin('use this computer as a node', useAsNode);
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
      void runPerformanceTestWithScenario({
        operator: () => (operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : null),
        outputs: () => [...outputWindows.values()].filter((w) => !w.isDestroyed()),
        // Three outputs for that scenario (windowed, with two extra displays, on a runner).
        ensureOutput: () => ensureTestOutput('Performance test', perfScenario === 'three-outputs' ? 3 : 1),
        workerRunning: () =>
          app.getAppMetrics().some((m) => m.type === 'Utility' && m.name === 'Drashti import'),
        diagnostics: { loopDelay, handlerTimes, gc },
        stream: streaming,
        network: net,
        nodes,
        library: { db: libraryDb, mediaDir },
        operatorContents: () =>
          operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow.webContents : null,
        music,
        engine,
        ffmpegPath: () =>
          findFfmpeg({
            packaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            appPath: app.getAppPath(),
            platform: process.platform,
            arch: process.arch,
            override: process.env['DRASHTI_FFMPEG'],
          }),
        cpu: () => app.getAppMetrics().reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0),
        ...(perfWatch ? { watch: perfWatch } : {}),
        ...(perfProfileDir ? { profile: new PerfProfile(perfProfileDir) } : {}),
        ...(perfNoImport ? { noImportMs: 20_000 } : {}),
        ...(perfEdits ? { edits: true, wayStats: () => ({ ...(importer?.wayStats ?? {}) }) } : {}),
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
    // A display change noticed as Drashti quits comes after the library has closed: nothing to do.
    if (db === null) return;
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

  // Each service tidies up as Drashti quits (well over Node's default of 10 listeners).
  app.setMaxListeners(50);
  void app.whenReady().then(boot);

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    sleepGuard.release();
    importer?.stop();
    outputs?.closeAll();
    laterWrites?.flush();
    db?.close();
    db = null;
  });
}
