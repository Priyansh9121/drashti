import type { IpcMainInvokeEvent, Rectangle } from 'electron';
import {
  app,
  autoUpdater,
  BrowserWindow,
  net as electronNet,
  shell,
  crashReporter,
  dialog,
  globalShortcut,
  nativeTheme,
  powerMonitor,
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
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { AppInfo } from '../shared/app-info';
import { formatBytes, formatClock } from '../shared/format';
import type { ImportResult } from '../shared/import';
import { type LibraryChange, listedKirtan } from '../shared/library';
import { importOptionsSchema, importPathsSchema, runIdSchema } from '../shared/import-schema';
import { type EventChannel, type EventContract, IPC } from '../shared/ipc';
import { acceleratorFor, SINGLE_KEYS_TEXT } from '../shared/keymap';
import { copyMediaId, copyOfId, MEDIA_ID_PATTERN, MEDIA_SCHEME } from '../shared/media';
import { NOT_USED } from '../shared/media-removal';
import { mediaUpNow } from '../shared/node-media';
import { MediaRemoval } from './library/media-removal';
import { importableExtensions, SOUND_EXTENSIONS } from './import/scan';
import { addToFolderParts, makeFolderPlaylist } from './playlists/folder-playlist';
import { syncFolderAudios } from './music/folder-audios';
import { idSchema } from '../shared/model-schema';
import { z } from 'zod';
import type { OutputContext } from '../shared/screens';
import { missingFontsIn } from '../shared/screens';
import { type ScreenSwitch, SWITCH_NAMES, SWITCH_OFF_WORDS, switchFor } from '../shared/screen-switches';
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
  startingMode,
} from '../shared/mode';
import { groupLookIn, type Movement, NO_LOOK } from '../shared/looks';
import { hallPicture } from '../shared/stage-layouts';
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
import { anyTestSwitch, sw, swMs, swOn } from './switches';
import { CalendarRepo } from './db/calendar';
import { CalendarService } from './calendar/calendar-service';
import { QuoteRepo } from './db/quotes';
import { IdleService } from './idle/idle-service';
import { quoteIdSchema } from '../shared/idle';
import { calendarIdSchema } from '../shared/calendar';
import { AudioPlaylistRepo } from './db/audio-playlists';
import { LowerThirdRepo } from './db/lower-thirds';
import { MusicService } from './music/music-service';
import { startPerfMusic, startPerfSoundCue } from './music/perf-music';
import { musicPlaySchema } from '../shared/music';
import type { MediaMarkers } from '../shared/markers';
import { mediaMarkersSchema, NO_MARKERS } from '../shared/markers';
import { UpdateService } from './update/update-service';
import { defaultInstaller } from './update/installer';
import { UPDATE_BASE } from '../shared/updates';
import { lowerThirdInputSchema } from '../shared/lower-thirds';
import { midiSettingsSchema, NO_MIDI } from '../shared/midi';
import { seedLibrary, seedOptions } from './db/seed';
import { removeUntouchedPlaceholders } from './library/placeholders';
import { ShowEngine } from './engine/show-engine';
import { runEngineCommand } from './ipc/engine-ipc';
import {
  handle,
  handlerTimes,
  handleSync,
  hearHandled,
  lockAdminChannels,
  lockChannels,
  refusedNow,
  setGiveWay,
} from './ipc/handle';
import { readOrDefault } from './ipc/read-or-default';
import { MainWatch, PerfProfile, watchedMedia } from './perf-watch';
import { isPerfScenario, startScenario } from './perf-scenarios';
import { LaterWrites } from './db/later-writes';
import { ROLES_HELD } from '../shared/roles';
import { RolesService } from './roles/roles-service';
import { adminRefusals } from './roles/admin-lock';
import { ImportService } from './import/import-service';
import { spawnImportWorker } from './import/spawn-worker';
import { LinkService } from './links/link-service';
import { libraryProblem } from './library-problem';
import { parsePlain } from '../shared/plain-parse';
import { DEFAULT_LINK_MAX_HEIGHT, isLinkHeight } from '../shared/links';
import { spawnDownloadWorker } from './links/spawn-worker';
import { AudioOutput } from './audio/audio-output';
import { CrashJournal, childGoneWords, JOURNAL_FILE, journalNotice, watchdogJournal } from './crash-journal';
import { GPU_STOPPED_TWICE, GpuStops } from './gpu-stops';
import { crashFiles, KEEP_CRASH_FILES, keepNewestCrashFiles, startCrashReporter } from './crash-files';
import { type CrashFilesChoice, saveDiagnostics } from './diagnostics';
import { log, logFiles, startLogFile } from './log';
import { phaseLine } from './start-phases';
import { heapAfterCollection } from './heap-after-gc';
import { LiveStateWriter, startupRecovery, type StartupRecovery } from './recovery/live-state';
import { handleMediaRequest, MEDIA_SCHEME_PRIVILEGES } from './media/media-protocol';
import { saveStill } from './media/stills';
import { SharpenedCopies } from './media/sharpened';
import { installMenu, installNodeMenu } from './menu';
import { runPerformanceTest, seedPerfLibrary } from './perftest';
import { registerPlaylistIpc } from './playlists/playlist-ipc';
import { startupReads } from './ipc/startup-reads';
import { nodeWatch, SmartFolders } from './playlists/smart-folders';
import { RepeatSlides } from './playlists/repeat-slides';
import {
  framed,
  PLAIN,
  type PictureLook,
  pictureLookSchema,
  type PixelSize,
  sharpenStep,
} from '../shared/picture-look';
import { largestAudienceScreen, type LocalOutput } from './media/copy-screen';
import { TrimSaves } from './convert/trim-saves';
import { saveRequestSchema } from '../shared/trim';
import { isRepeatId } from '../shared/repeat';
import {
  applyPendingRestore,
  backupLibrary,
  LIBRARY_FILE,
  requestRestore,
  rollBackRestore,
  sameDisk,
} from './library/backup';
import { keepAccessAfterRestore } from './library/restore-access';
import type { BackupUi } from './library/backup-ui';
import { backUp, handBackupRunning, restore } from './library/backup-ui';
import { ScheduledBackups } from './backup/scheduled-backups';
import type { ScheduledBackupsView } from '../shared/backups';
import type { AnnouncementsView } from '../shared/announcements';
import { spawnBackupWorker } from './backup/spawn-backup-worker';
import { Revisions } from './library/revisions';
import { styleNewText, themeLook } from './library/themes';
import { defaultTransition, registerSlidesIpc } from './library/slides-ipc';
import { registerThemesIpc } from './library/themes-ipc';
import { registerWordsIpc } from './library/words-ipc';
import { registerKirtansIpc } from './library/kirtans-ipc';
import { runRelaunchSelfTest } from './relaunch-selftest';
import { createdGroupId, runWatchdogSelfTest, type SelfTestResult } from './selftest';
import { SIMPLE_MODE_LOCKED, simpleModeRefusals } from './simple-mode';
import { applyPriority, describePriorities, describePriority, readPriority, writePriority } from './priority';
import { whenFree, writeLockFree } from './db/write-lock';
import { writeOldLibrary } from './old-library-selftest';
import {
  createOutputWindow,
  listDisplays,
  setExtraDisplays,
  changeExtraDisplays,
  showDisplayNumber,
  watchDisplays,
} from './outputs/electron-outputs';
import {
  type ControlsPlace,
  controlsToPutBack,
  COULD_NOT_GO_BACK,
  coveringScreens,
  KeepScreens,
} from './outputs/keep-screens';
import { placeOperator } from './outputs/operator-guard';
import { DISPLAY_DROP_MS, OutputManager } from './outputs/output-manager';
import { ScreensService, type ScreensSetup } from './outputs/screens-service';
import { ScreenSwitchService } from './outputs/screen-switches';
import { SleepGuard } from './outputs/sleep-guard';
import { IpcTransport } from './transport/ipc-transport';
import { AUDIO_PARTITION, createAudioWindow } from './windows/audio-window';
import { createPicturesWindow } from './pictures/pictures-window';
import { createSharpenWindow } from './pictures/sharpen-window';
import { PdfPictures, pictureSize } from './pictures/pdf-pictures';
import { openGalleryWindow } from './windows/gallery-window';
import { AppearanceService } from './appearance/appearance-service';
import { ownSchema } from './appearance/appearance-file';
import { FOLLOW } from '../shared/appearance/appearances';
import { createOperatorWindow } from './windows/operator-window';
import { StopList } from './lifecycle';
import { hearRenderErrors } from './render-errors-ipc';
import { CHECK_EVERY_MS, OutputHeartbeat } from './outputs/heartbeat';
import {
  quitDetail,
  RendererWatchdog,
  shouldConfirmQuit,
  watchdogLine,
  whyText,
  type WatchdogEvent,
} from './watchdog';
import { allowHangStacks, applySessionSecurity, secureWebContents } from './windows/security';
import { StreamProfileRepo } from './db/stream-profiles';
import { StreamKeyStore } from './stream/key-store';
import { lookup as dnsLookup } from 'node:dns/promises';
import { EventsOut, NO_SECURE_STORAGE_EVENTS } from './events/events-service';
import {
  announcementEvents,
  backupEvents,
  engineEvents,
  type ScreenState,
  screenEvents,
  streamEvents,
} from './events/sources';
import { spawnEventsWorker } from './events/spawn-worker';
import { DropFolder } from './import/drop-folder';
import { DROP_SETTLE_MS } from '../shared/drop-folder';
import { applyStreamSessionSecurity, createProgramWindow, STREAM_PARTITION } from './stream/program-window';
import { LiveWindowService } from './live-window/live-window-service';
import { electronWindowSources } from './live-window/electron-sources';
import { standInWindowSources } from './live-window/stand-in-sources';
import { applyCaptureRules } from './live-window/capture-rules';
import { PipPlaces } from './pip/pip-places';
import { VideoInputsService } from './video-inputs/video-inputs-service';
import { electronCamera } from './video-inputs/electron-camera';
import { ZoomWindow } from './stream/zoom-window';
import { openPlaceholderMeeting, PLACEHOLDER_MEETING } from './live-window/placeholder';
import { StreamService } from './stream/stream-service';
import { onFat } from './stream/recording-drive';
import { Leftovers, leftoversFile } from './system/leftovers';
import { GuideFiles, guidesDir } from './guides';
import { GUIDES, guideIdSchema, type GuideRead } from '../shared/guides';
import { watchLoadFailures } from './outputs/load-failures';
import { findFfmpeg } from './stream/ffmpeg-path';
import { ffmpegSelfTest } from './stream/ffmpeg-selftest';
import { youtubeSelfTest } from './links/youtube-selftest';
import { findYoutubeTools, toolFolders, youtubeLaunch } from './links/youtube-tools';
import { spawnStreamWorker } from './stream/stream-worker';
import { ConvertService, readInfo } from './convert/convert-service';
import { diskFreeBytes } from './import/media-store';
import { startPerfStream } from './stream/perf-stream';
import { confirmedSchema } from '../shared/stream-schema';
import type { StreamStatus } from '../shared/stream';
import { FanoutTransport, type EngineTransport } from '../shared/engine/transport';
import type { EngineState, PropItem } from '../shared/engine/state';
import { DeviceRepo } from './db/devices';
import { NetworkService } from './network/network-service';
import { AnnouncementService } from './network/announcement-service';
import { AnnouncementRepo } from './db/announcements';
import { inProcessNetworkWorker, spawnNetworkWorker } from './network/network-worker';
import { startPerfDevices } from './network/perf-devices';
import { localName } from './network/local-name';
import { localInterfaceAddresses } from './network/addresses';
import { previewSource } from './network/preview-source';
import { rendererDir } from './windows/renderer';
import { pageAlive, sendToPage } from './windows/send';
import { quietTests, startQuietTests } from './windows/quiet';
import { readRole, startingRole, writeRole } from './role';
import { startNode } from './node-mode/node-app';
import { NodeRepo } from './db/nodes';
import { NodeService } from './nodes/node-service';
import { spawnLinkWorker } from './nodes/link-worker';
import { type IdentityLoad, loadIdentity, makeNewIdentity } from './nodes/identity';
import { RECENT_DAYS, WantedMedia } from './nodes/wanted-media';
import { startPerfNodes } from './nodes/perf-nodes';
import type { NodeOutputStatus, ScreenThumb } from '../shared/nodes';
import { hostname } from 'node:os';
import { cutText } from '../shared/text';
import { mainClockStyle } from './clock-style';

// Headless self-tests: run one, print the result, exit (see README). The performance test
// imports a few hundred placeholder files, so it gets a throwaway data folder of its own.
const selfTest = sw('DRASHTI_SELFTEST') === 'watchdog';
// A node's own watchdog self-test (Session 17): starts as a node, with the pairing in its data folder.
const nodeSelfTest = sw('DRASHTI_SELFTEST') === 'node-watchdog';
const perfTest = sw('DRASHTI_SELFTEST') === 'performance';
// Check the bundled FFmpeg (scripts/check-ffmpeg.mjs): print what works, and exit.
const ffmpegCheck = sw('DRASHTI_SELFTEST') === 'ffmpeg';
// The restart after a restore, for real (scripts/check-relaunch.mjs; see relaunch-selftest.ts).
const relaunchTest = sw('DRASHTI_SELFTEST') === 'restore-relaunch';
// Tests (and multiple installs) can point Drashti at its own data folder.
const userDataOverride = sw('DRASHTI_USER_DATA_DIR');
/** This computer's own data folder, before any override (the performance check reads its settings). */
const homeData = app.getPath('userData');
if (userDataOverride) app.setPath('userData', userDataOverride);
else if (perfTest) app.setPath('userData', mkdtempSync(join(tmpdir(), 'drashti-perf-')));
// The log goes to a rotating file in the data folder too (see log.ts), from the start.
startLogFile(join(app.getPath('userData'), 'logs'));
log.info(phaseLine('the main process running'));
log.info(
  `Drashti ${app.getVersion()} (Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, Node ${process.versions.node}) on ${process.platform} ${osRelease()} ${process.arch}`,
);
/** Drashti is quitting: windows and processes going now are no problem (the crash journal). */
let quitting = false;
// The crash journal (Sessions 31–36, ROB-6): what went wrong, kept in the data folder as it happens, so the
// next start can say it even when Drashti itself stopped (crash-journal.ts).
const crashJournal = new CrashJournal(join(app.getPath('userData'), JOURNAL_FILE), (line) => {
  log.warn(line);
});
/** An uncaught error, as the journal keeps it: its name and message (the log has its stack). */
const errorWords = (what: string, error: unknown) =>
  `${what}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception in the main process', error);
  crashJournal.add(errorWords('an error in the main process that nothing caught', error));
});
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection in the main process', reason);
  crashJournal.add(errorWords('a promise in the main process failed and nothing caught it', reason));
});
// What stops as Drashti quits, in one ordered list (lifecycle.ts, Session 23): run at will-quit, or
// before an exit that skips it (app.exit).
const stops = new StopList((name, error) => {
  log.error(`Quitting: ${name} did not stop cleanly`, error);
});
/** Exit at once (self-tests, restarting as Main): everything still stops, in order, first. */
const exitNow = (code: number) => {
  quitting = true;
  stops.run();
  app.exit(code);
};
// Tests on a computer someone is using: never active, never covering the screen (windows/quiet.ts).
startQuietTests();
// Crash files (Sessions 31–36, ROB-6): a crash of any of Drashti's processes leaves a dump in the data
// folder's Crashpad folder (tests may name another: DRASHTI_TEST_CRASH_DUMPS), never sent anywhere. The
// newest five are kept (crash-files.ts). Not when running translated: there the crash reporter stopped the
// main process as the watchdog restarted a window (startCrashReporter).
const crashFilesDir = sw('DRASHTI_TEST_CRASH_DUMPS') ?? join(app.getPath('userData'), 'Crashpad');
app.setPath('crashDumps', crashFilesDir);
const crashFilesKept = startCrashReporter(
  app.runningUnderARM64Translation,
  () => {
    crashReporter.start({ uploadToServer: false, compress: false });
  },
  (line) => {
    log.info(line);
  },
);
keepNewestCrashFiles(crashFilesDir, KEEP_CRASH_FILES, (line) => {
  log.warn(line);
});
// A GPU or utility process that stops, on Main or a node, goes into the journal too: never as Drashti
// quits, when its processes go as they should.
app.on('before-quit', () => {
  quitting = true;
});
app.on('child-process-gone', (_event, details) => {
  const words = quitting ? null : childGoneWords(details);
  if (words) crashJournal.add(words);
});

/** The GPU process's stops (Sessions 31–36, ROB-5): a second within 10 minutes is said. */
const gpuStops = new GpuStops();
/** Said to the operator (Main) once the GPU process has stopped twice within 10 minutes. */
let gpuStoppedTwice: ((text: string) => void) | null = null;
// The GPU process stopped (Sessions 31–36, ROB-5): Chromium starts another by itself, but the videos it was
// decoding fail. Every window that draws the show is told, and plays its failed videos again, from the
// engine's time. A second stop within 10 minutes is told to the operator, once.
app.on('child-process-gone', (_event, details) => {
  if (details.type !== 'GPU' || quitting) return;
  log.warn(
    `The GPU process stopped (${details.reason}); its features now: ${JSON.stringify(app.getGPUFeatureStatus())}`,
  );
  for (const w of BrowserWindow.getAllWindows())
    if (!w.isDestroyed()) sendToPage(w, IPC.output.gpuRestarted, { at: Date.now() });
  if (gpuStops.stopped(Date.now())) gpuStoppedTwice?.(GPU_STOPPED_TWICE);
});

/**
 * Before Save Diagnostics (Sessions 31–36, ROB-6): with crash files kept, whether they go too, unticked as
 * it opens, since a crash file can hold words from slides; null when the person cancels. With none kept,
 * nothing to ask.
 */
async function chooseCrashFiles(): Promise<CrashFilesChoice | null> {
  const files = crashFiles(crashFilesDir);
  if (files.length === 0) return { files, included: false, kept: crashFilesKept };
  const bytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const answer = await dialog.showMessageBox({
    type: 'question',
    message: 'Save diagnostics on the Desktop?',
    detail:
      'A file for the admin: the versions, the setup, counts, the crash journal and the log, never words from the library. Crash files are kept on this computer too: each holds what a part of Drashti had in memory when it crashed, which can include words from slides.',
    checkboxLabel: `Include crash files: ${String(files.length)} (${formatBytes(bytes)})`,
    checkboxChecked: false,
    buttons: ['Save', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  if (answer.response !== 0) return null;
  return { files, included: answer.checkboxChecked, kept: crashFilesKept };
}

/** What the notice says once Diagnostics is saved. */
const savedDiagnosticsText = (path: string, crash: CrashFilesChoice) =>
  crash.included && crash.files.length > 0
    ? `Diagnostics saved on the Desktop, with ${String(crash.files.length)} crash ${crash.files.length === 1 ? 'file' : 'files'}: ${basename(path)}`
    : `Diagnostics saved on the Desktop: ${basename(path)}`;
// Development only: outputs as normal windows, for machines with one screen,
// optionally with pretend extra displays to try several outputs. Always so in quiet test mode.
const windowedOutputs = sw('DRASHTI_WINDOWED_OUTPUTS') === '1' || quietTests;
if (windowedOutputs) setExtraDisplays(Number(sw('DRASHTI_EXTRA_DISPLAYS') ?? 0) || 0);
// Tests only (never a packaged Drashti): pretend displays that come and go (Sessions 31–36, ROB-4).
if (windowedOutputs && !app.isPackaged && sw('DRASHTI_TEST_DISPLAY_CHANGES') === '1')
  (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays = changeExtraDisplays;
// A Diagnostics menu for the manual watchdog check (see README).
const diagnostics = sw('DRASHTI_DIAGNOSTICS') === '1';
// Automated tests cannot answer the quit confirmation.
const noQuitConfirm = sw('DRASHTI_NO_QUIT_CONFIRM') === '1';
// Tests only: after Restore Library… just quit (the test starts Drashti again itself).
const noRelaunch = sw('DRASHTI_TEST_NO_RELAUNCH') === '1';
// Log every permission a page checks or asks for (diagnosing sound output choice).
const logPermissions = sw('DRASHTI_LOG_PERMISSIONS') === '1';
// Tests only: answer media requests late, as a slow disk would.
const mediaDelayMs = Math.min(5000, Math.max(0, Number(sw('DRASHTI_TEST_MEDIA_DELAY_MS') ?? 0) || 0));

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
let mainPriority = readPriority(userDataOverride ?? homeData, sw('DRASHTI_PRIORITY'));
/** The priority Drashti was started at (the performance check says it: CI's Windows runner starts programs below normal). */
const startedPriority = describePriority();
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
// The look of Drashti's own windows (Sessions 39–40): kept per computer, outside the library, and read before
// any window is made, so each opens on its appearance's colour and its page draws in it from the start.
/**
 * What a window gives to make an appearance of one's own (Session 40; a second colour too, Session 42): checked
 * here, every rule too.
 */
const ownFieldsSchema = ownSchema.omit({ id: true }).extend({
  second: z
    .string()
    .regex(/^#[0-9a-f]{6}$/u)
    .optional(),
});
const appearance = new AppearanceService({
  userData: app.getPath('userData'),
  startIn: sw('DRASHTI_TEST_APPEARANCE'),
  say: (line) => {
    log.info(line);
  },
});
handleSync(IPC.appearance.now, () => appearance.now());
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
const fakeDevices = sw('DRASHTI_TEST_FAKE_DEVICES') === '1';
if (fakeDevices) app.commandLine.appendSwitch('use-fake-device-for-media-stream');
// Tests only: behave as if the system's secure storage for keys were missing.
const noSafeStorage = sw('DRASHTI_TEST_NO_SAFE_STORAGE') === '1';
// Tests only: the local network listens on this computer alone (no firewall questions), and can be
// told to treat this computer as outside the local network, to see such requests refused.
const networkLocalOnly = sw('DRASHTI_TEST_NETWORK_LOCAL') === '1';
const networkRefuseLoopback = sw('DRASHTI_TEST_NETWORK_REFUSE_LOOPBACK') === '1';
// Tests only: an announcement's minute is this many ms, so one can run out while a test watches.
const announceMinuteMs = Math.min(
  60_000,
  Math.max(100, Number(sw('DRASHTI_TEST_ANNOUNCE_MINUTE_MS') ?? 60_000) || 60_000),
);
// Tests only: the schedules (backups; the arti's and macros' too, until Session 44) read this computer's
// clock moved on by this much (ms), and a test can move it with globalThis.drashtiArtiClock(wallMs).
// The engine's clock is never moved.
const artiTestClock = sw('DRASHTI_TEST_ARTI_CLOCK') === '1' && !app.isPackaged;
let artiClockOffset = artiTestClock ? Number(sw('DRASHTI_TEST_ARTI_OFFSET_MS') ?? 0) || 0 : 0;
/** The schedules' clock: this computer's, moved by a test only. */
const scheduleNow = () => Date.now() + artiClockOffset;
// Tests only (never a packaged Drashti): updates come from this server instead of GitHub Releases, and
// install by writing what they would run into a file; a download goes at this rate; and a test can say
// the stream is on air (globalThis.drashtiTestOnAir), for updates and link downloads (the drop folder and
// smart playlists use it too, and Session 50's conversions, which wait while it is).
const testUpdateBase = app.isPackaged ? undefined : sw('DRASHTI_UPDATE_URL');
const updateBase = testUpdateBase ?? UPDATE_BASE;
const testInstallLog = app.isPackaged ? undefined : sw('DRASHTI_TEST_UPDATE_INSTALL');
const testUpdateRate = app.isPackaged ? null : Number(sw('DRASHTI_TEST_UPDATE_RATE') ?? 0) || null;
let testOnAir = false;
// Tests only (never a packaged Drashti): Import from a Link asks this local stand-in instead of Dropbox,
// saves into this folder by default, and (the guard, which every e2e run sets) refuses any request to
// anywhere but 127.0.0.1.
const testLinkOrigin = app.isPackaged ? null : (sw('DRASHTI_TEST_LINK_ORIGIN') ?? null);
const testLinkGuard = !app.isPackaged && sw('DRASHTI_TEST_LINK_GUARD') === '1';
const testDownloadsDir = app.isPackaged ? null : (sw('DRASHTI_TEST_DOWNLOADS_DIR') ?? null);
if (!app.isPackaged && sw('DRASHTI_TEST_ON_AIR_HOOK') === '1')
  (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir = (on) => {
    testOnAir = on;
  };
// Tests only: scheduled backups copy at this rate (bytes a second), so a test can watch one wait.
const testBackupRate = app.isPackaged ? null : Number(sw('DRASHTI_TEST_BACKUP_RATE') ?? 0) || null;
// The performance check only: so many devices connected while it measures, and (to compare) the
// network's server in the main process instead of its own.
const perfDevices = Math.min(50, Math.max(0, Number(sw('DRASHTI_PERF_DEVICES') ?? 0) || 0));
const perfNetworkInMain = sw('DRASHTI_PERF_NETWORK_IN_MAIN') === '1';
// The performance check only: an audio playlist playing meanwhile (Session 14); or, to tell what costs
// what (Session 15), one long sound on the audio layer instead, and slide changes with no import.
const perfMusic = sw('DRASHTI_PERF_MUSIC') === '1';
const perfSoundCue = sw('DRASHTI_PERF_SOUND_CUE') === '1';
// ...and the sound first starting during the measured part, 1.5 s in, rather than before it.
const perfSoundLate = sw('DRASHTI_PERF_MUSIC_LATE') === '1';
const perfNoImport = sw('DRASHTI_PERF_NO_IMPORT') === '1';
// The performance check only: an operator's edits (words, a playlist, a theme) during the import (Session 16).
const perfEdits = sw('DRASHTI_PERF_EDITS') === '1';
// The performance check only: how many files it imports (400 unless asked), for a slower or quicker
// import than this computer's own, to try the rules (Session 17).
const perfSongs = Math.min(5000, Math.max(0, Math.round(Number(sw('DRASHTI_PERF_SONGS') ?? 0) || 0)));
// The performance check only: a heavy case for the screens (Session 15: speed on modest hardware).
const askedScenario = sw('DRASHTI_PERF_SCENARIO');
const perfScenario = perfTest && isPerfScenario(askedScenario) ? askedScenario : undefined;
// The performance check only: a CPU profile of the main process and a Chromium trace, kept in this folder.
const perfProfileDir = perfTest ? sw('DRASHTI_PERF_PROFILE') : undefined;
// The performance check only: so many output nodes following the show (and copying a file) meanwhile.
const perfNodes = Math.min(50, Math.max(0, Number(sw('DRASHTI_PERF_NODES') ?? 0) || 0));
// Tests only (never a packaged Drashti): the version this copy says it runs, to see Main and a node
// on different versions refuse each other; a node's clock as if it were this far off; and the port
// Main listens for nodes on.
const testVersion = app.isPackaged ? undefined : sw('DRASHTI_TEST_VERSION');
const appVersion = () => testVersion ?? app.getVersion();
const nodeClockSkewMs = app.isPackaged ? 0 : Number(sw('DRASHTI_TEST_CLOCK_SKEW_MS') ?? 0) || 0;
const nodePortOverride = Number(sw('DRASHTI_NODE_PORT') ?? 0) || null;
// Tests only (never a packaged Drashti): a test can make an output draw an element that throws, to see a
// render error caught, logged and the output reloaded (Session 23; globalThis.drashtiTestRenderError).
const testRenderErrors = !app.isPackaged && sw('DRASHTI_TEST_RENDER_ERRORS') === '1';
const testClockHold = !app.isPackaged && sw('DRASHTI_TEST_CLOCK_HOLD') === '1';
// Tests only: the computer's name as Main and its nodes show it (screenshots never show a runner's own).
const testComputerName = app.isPackaged ? undefined : sw('DRASHTI_TEST_COMPUTER_NAME');
// Tests only: copies to nodes at this rate (bytes a second), so a copy can be watched while it goes.
const testCopyRate = app.isPackaged ? null : Number(sw('DRASHTI_TEST_COPY_RATE') ?? 0) || null;
// Tests only: each window's memory in the log this often (Session 17: the outputs' memory measured with
// nothing attached, tests/soak/devtools.spec.ts).
const testMemoryEveryMs = app.isPackaged
  ? 0
  : Math.max(0, Number(sw('DRASHTI_TEST_MEMORY_EVERY_MS') ?? 0) || 0);

// Library media reaches the sandboxed windows only through drashti-media:// (see media/media-protocol.ts).
// Schemes must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { ...MEDIA_SCHEME_PRIVILEGES } }]);

/** What the show does with an output's watchdog events (set once the outputs exist: Session 23). */
let outputWatchdogEvent: ((e: WatchdogEvent) => void) | null = null;
/** The watchdog's recent events, for diagnostics. */
const watchdogHistory: { at: string; window: string; kind: string; reason: string | null }[] = [];
/** The watchdog's problems into the crash journal: a hung window's restart adds Drashti's wait to its hang (Session 38). */
const journalWatchdog = watchdogJournal(crashJournal);
const watchdog = new RendererWatchdog(
  (e) => {
    watchdogHistory.push({
      at: new Date().toISOString(),
      window: e.window,
      kind: e.kind,
      // With how a crashed window's process ended (Session 39), as the log says it.
      reason: whyText(e).slice(2, -1) || null,
    });
    if (watchdogHistory.length > 200) watchdogHistory.splice(0, watchdogHistory.length - 200);
    // A hung window's restart says how long the main process waited for its dump (Session 38), in the log and so
    // in Save Diagnostics, as "output "Hall 1" restarted (Drashti waited 240 ms while it saved the crash file)".
    const text = watchdogLine(e);
    if (e.kind === 'crashed' || e.kind === 'hung' || e.kind === 'gave-up' || e.kind === 'render-error')
      log.warn(text);
    else log.info(text);
    if (!quitting) journalWatchdog(e);
    outputWatchdogEvent?.(e);
  },
  undefined,
  crashFilesKept,
);
// Screens never sleep or dim while an output is showing, or the stream is on air or recording (Session 31).
const sleepGuard = new SleepGuard(powerSaveBlocker, (held) => {
  log.info(
    held ? 'Display sleep is blocked while outputs show or the stream is on' : 'Display sleep allowed again',
  );
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
/** Chromium's processes that stopped (a GPU's, a utility's, a renderer's), each kept for the Soak (Sessions 31–36). */
const processesGone: { type: string; reason: string; exitCode: number; name: string | null; at: string }[] =
  [];
// On Main and on a node alike: the Soak counts both.
app.on('child-process-gone', (_event, details) => {
  processesGone.push({
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    name: details.name ?? details.serviceName ?? null,
    at: new Date().toISOString(),
  });
  log.warn(
    `A ${details.type} process stopped (${details.reason}, code ${String(details.exitCode)}); Chromium restarts it by itself.`,
  );
});
// Readable from the main process in end-to-end tests.
(globalThis as { drashtiDiagnostics?: unknown }).drashtiDiagnostics = {
  watchdog,
  sleepGuard,
  loopDelay,
  handlerTimes,
  gc,
  processesGone,
  heapAfterCollection,
};
let quitConfirmed = false;
/** The quit goes ahead (confirmed): nothing may open a window now, or the quit stops (Session 23). */
let quitStarted = false;

let operatorWindow: BrowserWindow | null = null;
let audioWindow: BrowserWindow | null = null;
let db: Db | null = null;
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
      // The placeholder presentations an earlier Drashti put in every new library go at this Drashti's first start,
      // each only when unchanged and in no playlist (Session 50, library/placeholders.ts), before anything is
      // seeded. Never in the way of opening the library: if the look fails, they stay, and it is tried again
      // at the next start.
      try {
        for (const line of removeUntouchedPlaceholders(opened)) log.info(line);
      } catch (error) {
        log.warn('Could not look at the placeholder presentations; they stay for now', error);
      }
      // A new library's example sabha templates and built-in themes; the placeholder presentations only for the
      // tests (Session 50: DRASHTI_TEST_SEED_PLACEHOLDERS, which a packaged Drashti ignores).
      const seeded = seedLibrary(opened, seedOptions(sw));
      if (seeded.placeholders) log.info('Added the placeholder presentations');
      if (seeded.templates) log.info('Added the example sabha templates');
      if (seeded.themes) log.info('Added the built-in themes');
      // YouTube is the third screen (Session 26): its card in Screens is there from the start.
      if (new ScreenRepo(opened).ensureStreamGroup().made) log.info('Made the stream’s screen group');
    } catch (error) {
      opened.close();
      throw error;
    }
    log.info(`Library opened (schema ${LATEST_VERSION})`);
    log.info(phaseLine('library open'));
    return { db: opened };
  } catch (error) {
    log.error('Could not open the library', error);
    return { error };
  }
}

function cannotOpenLibrary(error: unknown, before = ''): void {
  // What it means and what to do; the error itself is in the log ("Could not open the library").
  dialog.showErrorBox(
    'Drashti cannot open its library',
    `${before}${libraryProblem(error)}\n\nFile: ${libraryFile()}`,
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
      message:
        'The library was not restored: copying the backup stopped part way. The library is as it was: restore again, and if it stops again, choose Help, then Save Diagnostics…, and tell the admin.',
    };
  }
}

const fromOperator = (event: IpcMainInvokeEvent) => event.sender.id === operatorWindow?.webContents.id;
const idListSchema = z.array(idSchema).min(1).max(10_000);
/** What the import's file dialog offers: everything Drashti imports (one list, the scanner's). */
const IMPORTABLE_EXTENSIONS = importableExtensions();
const notAllowed = { ok: false as const, message: 'Only the operator window can change the screens.' };

/**
 * The performance check, while streaming and recording when DRASHTI_PERF_STREAM names an
 * address on this computer (tests/perf/performance.spec.ts starts FFmpeg listening there).
 */
type PerfRun = Parameters<typeof runPerformanceTest>[0] & {
  stream: StreamService;
  network: NetworkService;
  nodes: NodeService;
  /** `sharpened`: every picture's sharpened copy made (Session 26f). */
  library: { db: Db; mediaDir: string; sharpened: () => Promise<void> };
  operatorContents: () => Electron.WebContents | null;
  music: MusicService;
  engine: ShowEngine;
  ffmpegPath: () => string | null;
  /** Every screen group in the live Look to move this way (a scenario; Session 27). */
  setMovement: (movement: Movement) => void;
  /** The window for Zoom (DRASHTI_PERF_ZOOM, Session 48). */
  zoom: { open(): void };
  /** live-window (Session 48): the placeholder meeting up as the background; false without the stand-in. */
  showPlaceholderWindow: () => Promise<boolean>;
  /** The stream's page while it is open. */
  program: () => Pick<Electron.BrowserWindow, 'webContents'> | null;
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
    sharpened: ctx.library.sharpened,
    setMovement: ctx.setMovement,
    showPlaceholderWindow: ctx.showPlaceholderWindow,
    program: ctx.program,
    withoutWindow: sw('DRASHTI_PERF_NO_WINDOW') === '1',
    streamSlides: () => {
      ctx.stream.setLayout('slides');
    },
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
    sw('DRASHTI_PERF_DEVICE_PAGES') === '1'
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
  const url = sw('DRASHTI_PERF_STREAM');
  const operator = ctx.operatorContents();
  if (!url || !operator) return runPerformanceTest(ctx);
  const folder = mkdtempSync(join(tmpdir(), 'drashti-perf-recording-'));
  const perf = await startPerfStream(
    ctx.stream,
    operator,
    url,
    folder,
    sw('DRASHTI_PERF_STREAM_ALSO') ?? null,
    sw('DRASHTI_PERF_ZOOM') === '1' ? ctx.zoom : null,
  );
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
/** What the start found that the person at the computer should read (Session 23: a role file that could not be read). */
const startNotes: string[] = [];

function boot(): void {
  // Menus, dialogs and title bars as the appearance's base, or the computer's own (Follow the computer).
  appearance.start(nativeTheme);
  // What went wrong while Drashti last ran, said once (Sessions 31–36, ROB-6).
  const journalNote = journalNotice(crashJournal.takeUnshown(), (at) => formatClock(Date.parse(at), null));
  if (journalNote) startNotes.push(journalNote);
  const userData = app.getPath('userData');
  const selfTesting = sw('DRASHTI_SELFTEST') !== undefined;
  const starting = startingRole(userData, sw('DRASHTI_ROLE'), {
    log: (line) => {
      log.warn(line);
    },
  });
  if (starting.note) startNotes.push(starting.note);
  let role = nodeSelfTest ? 'node' : selfTesting ? 'main' : starting.role;
  if (role === null) {
    if (sw('DRASHTI_TEST_NO_WIZARD') === '1') role = 'main';
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
  allowHangStacks(session.defaultSession);
  const node = startNode({
    appearance,
    userData: app.getPath('userData'),
    startNotes,
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
    diagnostics: {
      app: appInfo,
      watchdogHistory: () => watchdogHistory,
      crashJournal: () => crashJournal.entries(),
      chooseCrashFiles,
      savedText: savedDiagnosticsText,
      logFiles,
      desktop: () => app.getPath('desktop'),
    },
    restartAsMain: () => {
      writeRole(app.getPath('userData'), 'main');
      log.info('Restarting as Main');
      if (!noRelaunch) app.relaunch();
      exitNow(0);
    },
    atQuit: (name, stop) => {
      stops.add(name, stop);
    },
  });
  // Its outputs' watchdog events (Sessions 31–36): one given up on is Stopped, and Main hears of it.
  outputWatchdogEvent = node.watchdogEvent;
  // Tests only (never a packaged Drashti): mark an output as given up on, as a crash loop would.
  if (!app.isPackaged && sw('DRASHTI_TEST_GIVE_UP') === '1')
    (globalThis as { drashtiTestGiveUp?: (screenId: string) => void }).drashtiTestGiveUp = node.giveUp;
  /** The node's watchdog self-test, its result in a box (the menu) or printed (headless). */
  const showResult = (result: SelfTestResult) => {
    const lines = result.checks.map(
      (c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` (${c.detail})` : ''}`,
    );
    void dialog.showMessageBox({
      type: result.passed ? 'info' : 'error',
      message: result.passed ? 'Watchdog self-test passed' : 'Watchdog self-test FAILED',
      detail: lines.join('\n'),
    });
  };
  const nodeMenu = () => {
    installNodeMenu({
      priority: priorityItem(() => nodeMenu()),
      saveDiagnostics: node.saveDiagnostics,
      diagnostics: diagnostics
        ? {
            runSelfTest: () => {
              void node.runSelfTest().then(showResult);
            },
            crashWindow: node.crashWindow,
            crashOutputs: node.crashOutputs,
          }
        : null,
    });
  };
  nodeMenu();
  if (nodeSelfTest)
    void node.runSelfTest().then((result) => {
      process.stdout.write(`DRASHTI_SELFTEST_RESULT ${JSON.stringify(result)}\n`);
      node.holdUpdate();
      exitNow(result.passed ? 0 : 1);
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
      override: sw('DRASHTI_FFMPEG'),
    });
    // And YouTube's two programs (Session 25c): yt-dlp and Deno run, and Deno is sandboxed.
    const tools = findYoutubeTools({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      platform: process.platform,
      arch: process.arch,
    });
    void (async () => {
      const ffmpeg = await ffmpegSelfTest(path, process.platform);
      const youtube = await youtubeSelfTest(tools, process.platform);
      const result = {
        ...ffmpeg,
        ffmpegPassed: ffmpeg.passed,
        youtube,
        passed: ffmpeg.passed && youtube.passed,
      };
      process.stdout.write(`DRASHTI_SELFTEST_RESULT ${JSON.stringify(result)}\n`);
      exitNow(result.passed ? 0 : 1);
    })();
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
    // A screen's picture (Session 48): a screen's page that just asked for the window up as the background,
    // or the window for Zoom (the stream's picture).
    mayCapture: (contents) =>
      contents !== null &&
      ((zoomWindow?.isZoomPage(contents) ?? false) || (liveWindows?.mayCapture(contents.mainFrame) ?? false)),
    // A camera for a video input (Session 50), video alone: the operator window's page (its LIVE picture, Media's
    // small live pictures) and every output of this computer (audience, stage, key and fill), each known by its
    // window and its address (windows/security.ts cameraAllowed). Nothing else in this session ever gets one; the
    // stream's page has its own session, which already may.
    cameraPage: (contents) => {
      if (contents === null) return null;
      if (contents.id === operatorWindow?.webContents.id) return 'operator';
      return manager.screenIdFor(contents.id) !== undefined ? 'output' : null;
    },
    // On a Mac, no camera until System Settings' Camera says granted: macOS never asks before the page has said
    // why (Media's askAccess asks). Chromium's fake camera (tests) counts as granted.
    cameraGranted: () => process.platform !== 'darwin' || inputs.access() === 'granted',
  });
  // A screen's picture (getDisplayMedia, Session 48): only what the main process decides for that page.
  applyCaptureRules(session.defaultSession, {
    grant: (frame) => zoomWindow?.grantFor(frame) ?? liveWindows?.grantFor(frame) ?? null,
    log: permissionLog,
  });
  const audioSession = session.fromPartition(AUDIO_PARTITION);
  applySessionSecurity(audioSession, {
    isAudioPlayer: (contents) => contents !== null && contents.id === audioWindow?.webContents.id,
    log: permissionLog,
  });
  // The stream's page has a session of its own: the only one allowed a sound input, and a camera as the stream's own
  // (Session 50: Drashti's screen pages and the operator window may open a video input too, video only).
  const streamSession = session.fromPartition(STREAM_PARTITION);
  applyStreamSessionSecurity(streamSession, {
    isProgram: (contents) => stream?.isProgram(contents) ?? false,
    log: permissionLog,
    logCapture: (line) => {
      log.info(line);
    },
    // Another app's window as the background (Session 48): the stream draws it too, where the hall's does.
    // Only a page that asked is given it (and only the screens' pages may ask: IPC.liveWindow.ask).
    liveWindow: (frame) => liveWindows?.grantFor(frame) ?? null,
  });
  // A hung window's JavaScript stack, for the log (Sessions 31–36, ROB-1): every session's own pages.
  for (const pages of [session.defaultSession, audioSession, streamSession]) allowHangStacks(pages);

  // Tests only (never a packaged Drashti): write a library as an older Drashti kept it, then stop.
  const oldLibrary = sw('DRASHTI_SELFTEST_LIBRARY');
  if (sw('DRASHTI_SELFTEST') === 'old-library' && oldLibrary && !app.isPackaged) {
    try {
      writeOldLibrary(libraryFile(), oldLibrary, listDisplays());
      exitNow(0);
    } catch (error) {
      log.error('Could not write the old library', error);
      exitNow(1);
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
  for (const note of startNotes) startNotice = startNotice ? `${startNotice}\n\n${note}` : note;
  let opened = openLibrary();
  // The library from before a restore, kept aside: who may connect is taken from it (once the restored
  // library has opened as it should).
  let keptAccess = restored.restored
    ? join(app.getPath('userData'), 'Backups', restored.keptIn, LIBRARY_FILE)
    : null;
  if ('error' in opened && restored.restored) {
    keptAccess = null;
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
  if (keptAccess) {
    // Today's phones, poster link and node tokens, not the backup's (Sessions 31–36, SEC-6).
    const access = keepAccessAfterRestore(opened.db, keptAccess);
    if (access.ok)
      log.info(
        `Restore: kept today’s phones (${String(access.phones)}) and nodes (${String(access.nodes)}); ${String(access.refused)} removed since the backup stay refused`,
      );
    else {
      log.warn(
        `Restore: who was paired could not be read; ${String(access.refused)} phones and nodes refused`,
      );
      startNotice = `${startNotice ?? ''}\n\nWho was paired before the restore could not be read, so every phone and the node must be paired again (Phones in the header; Screens, then Pair a node).`;
    }
  }
  db = opened.db;
  const libraryDb: Db = db;
  // The performance check's own throwaway library (never one DRASHTI_USER_DATA_DIR names) gets the placeholder
  // presentations it measures with, before the operator window opens (Session 50: a new library has none, and a
  // packaged Drashti ignores the tests' switch).
  if (perfTest && !userDataOverride && seedPerfLibrary(libraryDb))
    log.info('The performance check added its placeholder presentations');
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
  /** The library's presentations, and passages. */
  const presentationsAndPassages: SlideSource = {
    order: (id, arrangementId) => (isPassageId(id) ? shastra.order(id) : slides.order(id, arrangementId)),
  };
  // Repeat Slides (Session 26d): a Repeat Slides playlist plays as one presentation of its steps.
  const repeatSlides = new RepeatSlides({
    playlist: (id) => playlists.repeatPlaylist(id),
    items: (id) => playlists.playItems(id),
    slides: presentationsAndPassages,
  });
  /** What the engine plays: the library's presentations, passages, and Repeat Slides playlists. */
  const playable: SlideSource = {
    order: (id, arrangementId) =>
      isRepeatId(id) ? repeatSlides.order(id) : presentationsAndPassages.order(id, arrangementId),
  };
  /** A presentation, passage or Repeat Slides playlist as a document of slides, or null. */
  const playableDoc = (id: string) =>
    isRepeatId(id) ? repeatSlides.doc(id) : isPassageId(id) ? shastra.doc(id) : presentations.get(id);
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
  // Last as Drashti quits, in this order (lifecycle.ts): every service has stopped using the library.
  stops.addLast('later writes', () => {
    later.flush();
  });
  stops.addLast('library', () => {
    db?.close();
    db = null;
  });
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
  /** A picture's look (Session 26e; the media repo, made further down). */
  let pictureLook: (mediaId: string) => PictureLook | null = () => null;
  /** A video's or sound's start and end points and markers (the media repo, made further down). */
  let mediaMarkers: (mediaId: string) => MediaMarkers | null = () => null;
  /** A media item's kind while it is there to play (Session 50, the box's; the media repo, made further down). */
  let mediaKind: (mediaId: string) => 'image' | 'video' | 'audio' | null = () => null;
  /** Picture in picture's remembered place (Session 50): where a new box goes, kept in the library. */
  const pipPlaces = new PipPlaces({ settings, write: laterSetting });
  /** Audio playlists (made further down): the media library changing may change them. */
  let musicService: MusicService | null = null;
  /** Brings folder playlists' sounds into Audio (Session 44); set once the music is ready. */
  let syncAudios = (): void => undefined;
  /** Today's calendar entry (made further down): told when an import loads a calendar. */
  let calendarService: CalendarService | null = null;
  /** The idle rotation (made further down): told when media change (a picture may have gone). */
  let idleService: IdleService | null = null;
  /** This computer's video inputs (Session 50; made just below, with the engine). */
  let videoInputs: VideoInputsService | null = null;
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
      repeatName: (playlistId) => playlists.repeatPlaylist(playlistId)?.name ?? null,
      pictureLook: (mediaId) => pictureLook(mediaId),
      // The picture-in-picture box (Session 50): what it holds, from the main process's own lists.
      mediaKind: (mediaId) => mediaKind(mediaId),
      windows: (id) => liveWindows?.offeredWindow(id) ?? null,
      pipPlace: () => pipPlaces.place(),
      // A video input by its id, from this computer's list (Session 50): showInput and the picture-in-picture box
      // find it only there.
      videoInput: (inputId) => videoInputs?.get(inputId) ?? null,
      // A timer shown alone (Session 50) in the words of the library's default theme.
      timerLook: () => themeLook(themes.themeOrDefault(null), 1920, 1080).style,
    },
  );
  // Quitting: a slide moving on by itself, or an audio playlist's next track, never fires once the library
  // has closed (seen on CI Windows: "The database connection is not open" from an auto-advance at quit).
  stops.add('engine timers', () => {
    engine.dispose();
  });

  // ---- video inputs (Session 50) ----------------------------------------------------
  // This computer's cameras and capture inputs, named in Media; read before restart recovery puts one back.
  const inputs = new VideoInputsService({
    userData: app.getPath('userData'),
    camera: electronCamera(process.platform, {
      fake: fakeDevices,
      // Tests only (never a packaged Drashti): how the camera's system setting stands.
      access: sw('DRASHTI_TEST_CAMERA_ACCESS'),
      log: (line) => {
        log.info(line);
      },
    }),
    background: () => engine.current.layers.background,
    // The camera in the picture-in-picture box (Session 50): followed and kept listed as the background's is, and
    // checked after a restart as the background's is (Session 51).
    box: () => engine.current.layers.pip,
    clearBackground: () => {
      engine.dispatch({ type: 'clearLayer', layer: 'background' });
    },
    takeOffBox: () => {
      engine.dispatch({ type: 'clearLayer', layer: 'pip' });
    },
    refresh: (input) => {
      engine.refreshInput(input);
    },
    changed: (view) => {
      sendToPage(operatorWindow, IPC.videoInputs.changed, view);
    },
    statusChanged: (status) => {
      sendToPage(operatorWindow, IPC.videoInputs.statusChanged, status);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  videoInputs = inputs;
  engine.onChange(() => {
    inputs.follow();
  });
  stops.add('video inputs', () => {
    inputs.close();
  });
  const stageLayoutRepo = new StageLayoutRepo(db);
  const maskRepo = new MaskRepo(db);
  const looks = new LookService({
    repo: lookRepo,
    stageLayout: (id) => stageLayoutRepo.get(id),
    mask: (id) => maskRepo.get(id),
    engine,
    changed: (view) => {
      sendToPage(operatorWindow, IPC.looks.changed, view);
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
  mediaKind = (mediaId) => media.kindAndName(mediaId)?.kind ?? null;
  /** The largest audience screen's picture as drawn, in pixels (set once the outputs are). */
  let audienceScreenSize: (() => PixelSize | null) | null = null;
  // ---- pictures' sharpened copies (Session 26f): made once each, drawn by every screen ----------
  const sharpened = new SharpenedCopies({
    mediaDir,
    wanted: () => media.sharpenWants(),
    // The largest audience screen's picture as drawn (Session 26g): copies are made at that size.
    screen: () => audienceScreenSize?.() ?? null,
    open: (gone) => {
      const win = createSharpenWindow(gone);
      return {
        id: win.webContents.id,
        destroy: () => {
          if (!win.isDestroyed()) win.destroy();
        },
      };
    },
    // A copy is ready (or went): the screens, the thumbnails and the nodes' lists follow.
    changed: () => {
      looksChanged();
      wantedMedia?.invalidate();
      nodeService?.libraryChanged();
    },
    log: (message) => {
      log.info(message);
    },
  });
  stops.add('sharpened copies', () => {
    sharpened.close();
  });
  handle(IPC.sharpen.next, (e) => sharpened.next(e.sender.id));
  handle(IPC.sharpen.made, (e, key, bytes) => sharpened.made(e.sender.id, key, bytes));
  /** A look as the screens and thumbnails get it: with its sharpened copy, once that is ready. */
  const shownLook = (mediaId: string, look: PictureLook | null): PictureLook | null => {
    const step = look ? sharpenStep(look.sharpness) : 0;
    if (!look || step === 0) return look;
    const ready = sharpened.readyStep(media.file(mediaId)?.sha256 ?? null);
    return ready === step ? { ...look, copy: step } : look;
  };
  const shownLooks = (): Record<string, PictureLook> =>
    Object.fromEntries(
      Object.entries(media.looks()).flatMap(([id, look]) => {
        const shown = shownLook(id, look);
        return shown ? [[id, shown]] : [];
      }),
    );
  pictureLook = (mediaId) => shownLook(mediaId, media.look(mediaId));
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
    const parsed = parsePlain(
      mediaMarkersSchema,
      raw,
      'Those markers cannot be kept: check each one’s name and time, then save again.',
    );
    if (!parsed.success) return { ok: false as const, message: parsed.message };
    if (!media.setMarkers(mediaId, parsed.data))
      return { ok: false as const, message: 'Markers are for a video or a sound in the library.' };
    engine.refreshMarkers(mediaId);
    log.info(`Markers: set on a media item (${String(parsed.data.markers.length)} marker(s))`);
    return { ok: true as const, markers: media.markersOf(mediaId) ?? NO_MARKERS };
  });
  // ---- A picture's look (Session 26e): kept with the picture, the same wherever it shows ----
  const looksChanged = () => {
    engine.refreshPictures();
    sendToOperator(IPC.media.looksChanged, shownLooks());
  };
  handle(IPC.media.look, (_e, mediaId) =>
    typeof mediaId === 'string' && MEDIA_ID_PATTERN.test(mediaId) ? media.look(mediaId) : null,
  );
  handle(IPC.media.looks, () => shownLooks());
  handle(IPC.media.setLook, (e, mediaId, raw) => {
    if (!fromOperator(e) || typeof mediaId !== 'string' || !MEDIA_ID_PATTERN.test(mediaId))
      return { ok: false as const, message: 'Only the operator window can change a picture.' };
    const look = raw === null ? null : pictureLookSchema.safeParse(raw);
    if (look && !look.success) return { ok: false as const, message: 'That look cannot be kept.' };
    if (!media.setLook(mediaId, look ? framed(look.data) : null))
      return { ok: false as const, message: 'Only a picture in the library has a look.' };
    looksChanged();
    // Its sharpened copy made (again), or gone with its sharpness (Session 26f).
    void sharpened.refresh();
    log.info('Pictures: a picture’s look was kept');
    return { ok: true as const };
  });
  // Keep this zoom: the live zoom kept as the picture's own (its enhancements stay as they were).
  handle(IPC.media.keepLiveZoom, (e) => {
    const z = engine.current.liveZoom;
    if (!fromOperator(e) || !z)
      return { ok: false as const, message: 'No picture is zoomed on the screens.' };
    const kept = media.look(z.mediaId) ?? PLAIN;
    if (!media.setLook(z.mediaId, framed({ ...kept, zoom: z.zoom, x: z.x, y: z.y })))
      return { ok: false as const, message: 'Only a picture in the library keeps a zoom.' };
    looksChanged();
    engine.clearLiveZoom();
    log.info('Pictures: a live zoom was kept as the picture’s');
    return { ok: true as const };
  });
  mediaInfo = (mediaId) => {
    const found = media.kindAndName(mediaId);
    return found ? { name: found.name, missing: false, unplayable: null } : null;
  };
  // The guides inside Drashti (Sessions 31–36): beside an installed Drashti, docs/ in the repository.
  const guideFiles = new GuideFiles(
    guidesDir({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() }),
  );
  const serveMedia = async (request: Request) => {
    const started = performance.now();
    if (mediaDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, mediaDelayMs));
    const response = await handleMediaRequest(request, {
      mediaDir,
      // Deleted from the library (Session 26a): a missing file, except while it is up (it stays until changed).
      lookup: (id) => {
        const found = media.file(id);
        return found?.deleted && !mediaUpNow(engine.current).has(id) ? { ...found, missing: true } : found;
      },
      sharpened: (sha256, step) => sharpened.relativePath(sha256, step),
      // A picture one of the guides shows (only those, from the guides' own folder).
      guidePicture: (name) => {
        const file = guideFiles.picture(name);
        return file ? { dir: guideFiles.dir, file } : null;
      },
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
  /** Each output's name, as the watchdog and the log call it. */
  const outputNames = new Map<string, string>();
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
      clockStyle: mainClockStyle(),
      // A stage layout's audience picture box (Session 50): the first audience group's picture.
      hall: hallPicture(screenRepo.groups()),
    };
  };
  // ---- hung, stale and given-up outputs (Session 23; outputs/heartbeat.ts, watchdog.ts) ----------
  // Each output's 2-second report is its heartbeat: one that stops, or stops painting the show, is
  // crashed into the watchdog's reload. One the watchdog gave up on is shown as Stopped.
  const heartbeat = new OutputHeartbeat({
    now: Date.now,
    engineRev: () => engine.rev,
    // Showing, or stopped and tried again since (a retry that hangs is noticed too); never a page
    // that has crashed and waits for the watchdog.
    judged: () =>
      manager
        .status()
        .filter((st) => st.state === 'showing' || st.state === 'stopped')
        .map((st) => st.screenId)
        .filter((id) => {
          const w = outputWindows.get(id);
          return (
            w !== undefined &&
            !w.isDestroyed() &&
            !w.webContents.isCrashed() &&
            w.isVisible() &&
            !w.isMinimized()
          );
        }),
    stuck: (screenId, reason) => {
      const w = outputWindows.get(screenId);
      if (!w || w.isDestroyed()) return;
      const name = outputNames.get(screenId) ?? 'an output';
      log.warn(`Output ${name} is stuck (${reason}): restarting it`);
      watchdog.stuck(w.webContents, name, reason);
    },
  });
  const heartbeatTimer = setInterval(() => {
    heartbeat.check();
  }, CHECK_EVERY_MS);
  stops.add('output heartbeat', () => {
    clearInterval(heartbeatTimer);
  });
  engine.onChange(() => {
    heartbeat.changed(engine.rev);
  });
  const screenOfOutput = (name: string) => [...outputNames].find(([, n]) => n === name)?.[0];
  /** Stopped outputs whose page has loaded again since: their next report ends Stopped. */
  const loadedSinceStopped = new Set<string>();
  const stopOutput = (screenId: string) => {
    loadedSinceStopped.delete(screenId);
    manager.setStopped(screenId, true);
  };
  // The GPU process stopped twice within 10 minutes (Sessions 31–36, ROB-5): the operator is told, once.
  gpuStoppedTwice = (text) => {
    sendToOperator(IPC.app.notice, { text });
  };
  outputWatchdogEvent = (e) => {
    const screenId = screenOfOutput(e.window);
    if (screenId === undefined) return;
    // A page loaded again gets its grace before it is judged.
    if (e.kind === 'reloaded' || e.kind === 'retried') heartbeat.opened(screenId);
    // Given up on: Stopped (the status line and Screens say so) until it draws again.
    if (e.kind === 'gave-up') stopOutput(screenId);
  };
  // Tests only (never a packaged Drashti): mark an output as given up on, as a crash loop would,
  // to see Stopped and Try again (Session 23; Playwright cannot follow a renderer that crashes).
  if (!app.isPackaged && sw('DRASHTI_TEST_GIVE_UP') === '1')
    (globalThis as { drashtiTestGiveUp?: (screenId: string) => void }).drashtiTestGiveUp = stopOutput;
  let eventsScreensWas: ScreenState[] | null = [];
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
      outputNames.set(config.id, `output "${config.name}"`);
      watchdog.watch(window.webContents, `output "${config.name}"`);
      watchLoadFailures(window, {
        name: `output "${config.name}"`,
        screen: config.id,
        watchdog,
        log: (message) => {
          log.warn(message);
        },
      });
      heartbeat.opened(config.id);
      // However it loads again (the watchdog, the dashboard's Reload, a test), it gets its grace.
      window.webContents.on('did-start-loading', () => {
        heartbeat.opened(config.id);
        loadedSinceStopped.add(config.id);
      });
      window.on('closed', () => {
        if (outputWindows.get(config.id) === window) {
          outputWindows.delete(config.id);
          heartbeat.closed(config.id);
        }
      });
      // A window that changes size (a windowed output; a display's resolution): copies follow (Session 26g),
      // once it has stopped changing (a window dragged larger sends a resize for every step).
      let resized: NodeJS.Timeout | null = null;
      window.on('resize', () => {
        if (resized) clearTimeout(resized);
        resized = setTimeout(() => {
          resized = null;
          void sharpened.screensChanged();
        }, 500);
      });
      return h;
    },
    onHeld: (screenId) => {
      log.info(
        `The display of ${outputNames.get(screenId) ?? 'an output'} went away: its output is kept hidden for up to ${String(DISPLAY_DROP_MS / 1000)} s`,
      );
    },
    onPutBack: (screenId) => {
      log.info(
        `The display of ${outputNames.get(screenId) ?? 'an output'} is back: the same page shown on it again, not loaded again`,
      );
      // Out of sight, it drew nothing: it is judged again only after the grace.
      heartbeat.opened(screenId);
    },
    // Audience or Stage (Session 50), by the screen's group.
    switchOf: (s) => switchFor(screenRepo.groupRole(s.groupId) ?? 'audience'),
    onChange: () => {
      // A hall screen stopped, or back (events out: Session 28).
      const screensNow = manager.status().map((st): ScreenState => ({
        screenId: st.screenId,
        state: st.state,
        name: screenRepo.screen(st.screenId)?.name ?? '',
      }));
      eventsOut.emit(screenEvents(eventsScreensWas, screensNow));
      eventsScreensWas = screensNow;
      if (pageAlive(operatorWindow)) sendToPage(operatorWindow, IPC.screens.changed, screens.snapshot());
      for (const [screenId, win] of outputWindows) {
        const context = contextFor(screenId);
        if (context) sendToPage(win, IPC.output.context, context);
      }
      guardOperator();
      // Keep these screens? (Session 50): whether an output covers the controls, said again when that changed.
      keepScreens.refresh();
      // A stopped output (Session 23) is still on its display and tried again: the display stays awake.
      sleepGuard.update(
        manager.status().filter((st) => st.state === 'showing' || st.state === 'stopped').length,
      );
      // Nodes follow their screens' settings (groups, canvases, names) as they change.
      nodeService?.screensChanged();
      // Sharpened copies follow the screens' size (Session 26g).
      void sharpened.screensChanged();
    },
  });
  // The audience screens on this computer, each its canvas as drawn in its window, in pixels: the largest.
  // A node's screens count too (Session 26h), at the size of the node's display each is given to.
  audienceScreenSize = () => {
    const local: LocalOutput[] = [];
    for (const [screenId, win] of outputWindows) {
      const s = screenRepo.screen(screenId);
      if (!s || win.isDestroyed()) continue;
      const bounds = win.getContentBounds();
      const factor = electronScreen.getDisplayMatching(win.getBounds()).scaleFactor;
      local.push({ screen: s, window: { width: bounds.width * factor, height: bounds.height * factor } });
    }
    // One switched off (Session 50) keeps its display's size: pictures' copies are not made again as it goes off
    // and again as it comes back.
    for (const st of manager.status()) {
      if (st.state !== 'switched-off' || st.displayId === null) continue;
      const s = screenRepo.screen(st.screenId);
      const d = listDisplays().find((x) => x.id === st.displayId);
      if (s && d) local.push({ screen: s, window: { width: d.pixelWidth, height: d.pixelHeight } });
    }
    return largestAudienceScreen({
      local,
      screens: screenRepo.allScreens(),
      roleOf: (groupId) => screenRepo.groupRole(groupId),
      nodes: nodeService?.displays() ?? [],
    });
  };
  stops.add('outputs', () => {
    manager.closeAll();
  });
  /** The display the operator window is on. Windowed (development) outputs never cover it. */
  const operatorDisplayId = (): number | null =>
    windowedOutputs || !operatorWindow || operatorWindow.isDestroyed()
      ? null
      : electronScreen.getDisplayMatching(operatorWindow.getBounds()).id;
  let stream: StreamService | null = null;
  // Show a Window… and the window for Zoom (Session 48): made with the stream, below.
  let liveWindows: LiveWindowService | null = null;
  let zoomWindow: ZoomWindow | null = null;
  const screens = new ScreensService(screenRepo, manager, listDisplays, operatorDisplayId, looks, {
    displays: () => nodeService?.displays() ?? [],
    screenStatus: () => nodeService?.screenStatus() ?? [],
  });
  // ---- Audience and Stage (Session 50; outputs/screen-switches.ts): this computer's screens off and on --------
  // Never saved: both are on at every start.
  const screenSwitches = new ScreenSwitchService({
    outputs: manager,
    simple: () => simpleNow(),
    screens: () => ({ groups: screenRepo.groups(), status: manager.status() }),
    state: () => engine.current,
    log: (message) => {
      log.info(message);
    },
  });

  // ---- Keep these screens? (Session 50) ----------------------------------------------------------------
  // After a change that puts an output on a display, 15 s to keep it, or it goes back by itself; the output over
  // the controls asks too. Tests that are not about it never ask (DRASHTI_TEST_KEEP_SCREENS=0, the tests' own
  // default); a test may give a shorter wait.
  // Where the controls were when the change began (section 3's review): the guard may move them off an output put on
  // their display to a free one, but the question belongs on that output, and going back puts them where they were.
  // Taken with the screens at a change's start (a change while one waits keeps the first); forgotten as it ends.
  let controlsBefore: ControlsPlace<Rectangle> | null = null;
  const controlsDisplayId = () => (controlsBefore ? controlsBefore.displayId : operatorDisplayId());
  const coveringNow = () => coveringScreens(manager.status(), controlsDisplayId());
  const keepScreens = new KeepScreens<ScreensSetup>({
    capture: () => {
      const here =
        operatorWindow && !operatorWindow.isDestroyed() && !windowedOutputs ? operatorWindow : null;
      controlsBefore = { displayId: operatorDisplayId(), bounds: here ? here.getBounds() : null };
      return screens.setup();
    },
    restore: (setup, quitting) => {
      // The setup's test slide ends with the change it showed (the screens put back show the show again).
      if (!quitting) testCardUntil = 0;
      const result = screens.putBack(setup, quitting);
      if (!quitting) {
        // As Screens' own changes do: the stream's languages, and a stage display in a browser.
        streaming.contextChanged();
        net.hint('screens');
        // The controls back where they were, if the change moved them (and that display is still there).
        const back = controlsToPutBack(
          controlsBefore,
          electronScreen.getAllDisplays().map((d) => d.id),
          operatorDisplayId(),
        );
        if (back && operatorWindow && !operatorWindow.isDestroyed()) {
          log.info('Keep these screens?: the controls are put back on the display they were on.');
          operatorWindow.setBounds(back);
          guardOperator();
        }
      }
      return result;
    },
    placed: () => screens.placed(),
    coversControls: () => coveringNow().length > 0,
    snapshot: () => screens.snapshot(),
    changed: (pending) => {
      sendToPage(operatorWindow, IPC.screens.pendingChanged, pending);
      const covering = new Set(pending?.coversControls ? coveringNow() : []);
      for (const [screenId, win] of outputWindows)
        sendToPage(win, IPC.output.keepQuestion, covering.has(screenId) ? pending : null);
    },
    ended: (how) => {
      controlsBefore = null;
      if (how === 'kept') return;
      sendToPage(operatorWindow, IPC.app.notice, {
        text:
          how === 'went-back'
            ? 'The screens went back to how they were before the change.'
            : how === 'went-back-by-itself'
              ? 'Nothing was pressed, so the screens went back to how they were before the change.'
              : COULD_NOT_GO_BACK,
      });
    },
    asks: sw('DRASHTI_TEST_KEEP_SCREENS') !== '0',
    waitMs: swMs('DRASHTI_TEST_KEEP_SCREENS_MS') ?? undefined,
    now: Date.now,
    log: (message) => {
      log.info(message);
    },
  });
  // Quitting before an answer goes back (saved only): the next start never opens a change nobody kept.
  stops.add('keep these screens', () => {
    keepScreens.quitting();
  });
  /** Keep these screens? as an output shows it: only one over the controls, while a change waits. */
  const keepQuestionFor = (screenId: string) => {
    const pending = keepScreens.current();
    return pending?.coversControls && coveringNow().includes(screenId) ? pending : null;
  };

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
        // A stopped output (Session 23) is still a window over its display.
        .flatMap((st) =>
          (st.state === 'showing' || st.state === 'stopped') && st.displayId !== null ? [st.displayId] : [],
        ),
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
  // Translated (an Intel build on an Apple-silicon Mac, x64 on Windows on ARM): said once, as the screens
  // then draw without warming their GPU up (windows/renderer.ts) and the native build is the one to run.
  if (app.runningUnderARM64Translation)
    log.info(
      'Running translated (Rosetta or x64 emulation): the screens draw without a GPU warm-up; the native build is the one to run here',
    );
  // ---- events out (Session 28) ----------------------------------------------------
  // Nothing goes until an admin adds an address and ticks a kind; no process runs till then.
  const eventsOut = new EventsOut({
    store: new StreamKeyStore(
      join(app.getPath('userData'), 'events-out.json'),
      safeStorage,
      noSafeStorage,
      NO_SECURE_STORAGE_EVENTS,
    ),
    spawn: spawnEventsWorker,
    // Tests: events go only to this computer (the guard every e2e run sets).
    onlyThisComputer: testLinkGuard,
    resolve: (host) => dnsLookup(host, { all: true, verbatim: true }),
    now: Date.now,
    changed: (view) => {
      sendToOperator(IPC.events.changed, view);
    },
    notice: (text) => {
      sendToOperator(IPC.app.notice, { text });
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  eventsOut.load();
  stops.add('events out', () => {
    eventsOut.close();
  });
  // Engine listeners get the state after a change only: the one before is kept here.
  let eventsEngineWas: EngineState | null = engine.current;
  engine.onChange((state) => {
    eventsOut.emit(engineEvents(eventsEngineWas, state));
    eventsEngineWas = state;
  });
  if (testMemoryEveryMs > 0)
    setInterval(
      () => {
        if (db === null) return;
        const names = new Map<string, string>();
        for (const g of screens.snapshot().groups) for (const sc of g.screens) names.set(sc.id, sc.name);
        const labels = new Map<number, string>();
        for (const [screenId, w] of outputWindows)
          if (!w.isDestroyed())
            labels.set(w.webContents.getOSProcessId(), `Output "${names.get(screenId) ?? screenId}"`);
        if (operatorWindow && !operatorWindow.isDestroyed())
          labels.set(operatorWindow.webContents.getOSProcessId(), 'Operator window');
        if (audioWindow && !audioWindow.isDestroyed())
          labels.set(audioWindow.webContents.getOSProcessId(), 'Audio player');
        const memory: Record<string, { ws: number; priv?: number }> = {};
        for (const m of app.getAppMetrics()) {
          const name =
            labels.get(m.pid) ??
            (m.type === 'Browser' ? 'Main process' : m.type === 'GPU' ? 'GPU' : `Other ${m.type}`);
          const was = memory[name] ?? { ws: 0 };
          const priv = m.memory.privateBytes;
          memory[name] = {
            ws: Math.round(((was.ws * 1024 + m.memory.workingSetSize) / 1024) * 10) / 10,
            ...(priv === undefined
              ? {}
              : { priv: Math.round((((was.priv ?? 0) * 1024 + priv) / 1024) * 10) / 10 }),
          };
        }
        log.info(`Memory (test): ${JSON.stringify(memory)}`);
      },
      Math.max(5000, testMemoryEveryMs),
    );
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
  // What the last run left, read once before this run saves anything (Session 20): whether it quit
  // cleanly (which also decides the starting mode) and, if not, its show. A restored library starts
  // with nothing live (the saved state belongs to the library before it).
  const startup: StartupRecovery = restored.restored
    ? { cleanQuit: true, recentStop: false, putBack: null, tooOld: null }
    : startupRecovery(recoveryFiles, { startLookId: lookRepo.firstId() });
  const saved = startup.putBack;
  if (saved) {
    const put = engine.restore(saved);
    // A video input put back (Session 50; in the picture-in-picture box too, Session 51): the first screen to draw it
    // says whether it is on this computer.
    inputs.restored();
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
      lowerThird: put.lowerThird,
      pip: put.pip,
      stageMessage: put.stageMessage,
      timers: put.timers,
      window: put.window,
      pipWindow: put.pipWindow,
      input: put.input,
      inputGone: put.inputGone,
      pipInputGone: put.pipInputGone ?? null,
    };
    // Ids and counts only in the log (the notice itself names the presentation, and a window: its name can
    // be anything, an inbox's say, Session 48; the picture-in-picture box's too, and a video input, Session 50).
    const {
      slide: slideBack,
      window: windowName,
      pipWindow: boxWindowName,
      input: inputName,
      inputGone: inputNotListed,
      pipInputGone: boxInputNotListed,
      ...alsoBack
    } = put;
    log.warn(
      `Recovery after an unexpected stop: ${JSON.stringify({
        slide:
          saved.slide && slideBack
            ? { presentationId: saved.slide.presentationId, slideIndex: saved.slide.slideIndex }
            : null,
        slideGone: recovery.slideGone,
        playlistItem: saved.playlist?.itemId ?? null,
        ...alsoBack,
        windowNotPutBack: windowName !== null,
        boxWindowNotPutBack: boxWindowName !== null,
        inputPutBack: inputName !== null,
        inputNotListed: inputNotListed !== null,
        boxInputNotListed: boxInputNotListed !== undefined,
      })}`,
    );
  }
  const old = startup.tooOld;
  if (old) {
    // Stopped unexpectedly too long ago (RECOVERY_MAX_AGE_MS): the notice names what was live, and
    // nothing goes on the screens.
    const slideGone = old.slide !== null && !presentations.get(old.slide.presentationId);
    recovery = {
      savedAt: old.savedAt,
      putBack: false,
      look: old.lookId && old.lookId !== lookRepo.firstId() ? (lookRepo.get(old.lookId)?.name ?? null) : null,
      slide:
        old.slide && !slideGone
          ? {
              presentationName: presentations.get(old.slide.presentationId)?.name ?? '',
              slideNumber: old.slide.slideIndex + 1,
            }
          : null,
      slideGone,
      background:
        old.background !== null && old.background.kind !== 'window' && old.background.kind !== 'input',
      window: old.background?.kind === 'window' ? old.background.name : null,
      // The picture-in-picture box (Session 50): a window in it named apart, as the background's is.
      pip: old.pip !== null && old.pip.source.kind !== 'window',
      pipWindow: old.pip?.source.kind === 'window' ? old.pip.source.name : null,
      input: old.background?.kind === 'input' ? old.background.name : null,
      blackout: old.blackout,
      logo: old.logo !== null,
      audio: old.audio !== null,
      props: old.props.length,
      messages: old.messages.length,
      ticker: old.ticker?.items.length ?? 0,
      masks: old.masks !== null,
      stageMessage: old.stageMessage !== null,
      timers: old.timers.length,
    };
    log.warn(
      `Not putting back the show of a run that stopped unexpectedly: saved ${old.savedAt}, too long before this start (${JSON.stringify(
        {
          slide: old.slide
            ? { presentationId: old.slide.presentationId, slideIndex: old.slide.slideIndex }
            : null,
          slideGone,
          blackout: old.blackout,
        },
      )})`,
    );
  }
  // This run takes the saved file over from now on, so a later start knows how this run ended.
  liveWriter.start(engine.current);
  log.info(phaseLine(`engine ready, revision ${String(engine.rev)}${saved ? ', the show put back' : ''}`));

  // ---- deleting media (Session 26a) -------------------------------------------------
  const mediaRemoval = new MediaRemoval(db, {
    idlePictures: () => idleService?.settings().pictures ?? [],
    onScreens: () => mediaUpNow(engine.current),
  });
  // Deleted before this start, so it can no longer be undone: its files go now, but never one that
  // recovery has just put back on the screens (that one goes at the next start).
  void mediaRemoval
    .purge(mediaDir, mediaUpNow(engine.current))
    .then((gone) => {
      if (gone > 0) log.info(`Media: removed the files of ${String(gone)} media item(s) deleted before`);
    })
    .catch((error: unknown) => {
      log.warn('Media: could not remove the files of deleted media', error);
    })
    // The pictures' sharpened copies (Session 26f): any missing made, any no picture wants removed.
    .finally(() => {
      void sharpened.refresh();
    });
  /** After media is deleted or brought back: everything that shows media reads again. */
  const mediaRemovalChanged = () => {
    slides.invalidate();
    engine.refreshNext();
    libraryChanged(true);
    sendToOperator(IPC.playlists.changed, { at: Date.now() });
    network?.hint('playlists');
    listChanged('props');
    listChanged('themes');
  };
  const mediaIdsSchema = idListSchema.refine((ids) => ids.every((id) => MEDIA_ID_PATTERN.test(id)));
  handle(IPC.media.usage, (_e, ids) => {
    const parsed = mediaIdsSchema.safeParse(ids);
    return parsed.success ? mediaRemoval.usage(parsed.data) : NOT_USED;
  });
  handle(IPC.media.remove, (e, ids) => {
    const parsed = mediaIdsSchema.safeParse(ids);
    if (!fromOperator(e) || !parsed.success) return { ok: false as const, message: 'Nothing was deleted.' };
    const removed = mediaRemoval.remove(parsed.data);
    if (removed.length === 0) return { ok: false as const, message: 'That media is not in the library.' };
    log.info(`Media: deleted ${String(removed.length)} media item(s)`);
    mediaRemovalChanged();
    return { ok: true as const, ids: removed };
  });
  handle(IPC.media.restore, (e, ids) => {
    const parsed = mediaIdsSchema.safeParse(ids);
    if (!fromOperator(e) || !parsed.success)
      return { ok: false as const, message: 'Nothing was brought back.' };
    const back = mediaRemoval.restore(parsed.data);
    log.info(`Media: brought back ${String(back.length)} deleted media item(s)`);
    mediaRemovalChanged();
    return back.length > 0
      ? { ok: true as const, ids: back }
      : { ok: false as const, message: 'It can no longer be brought back: its file has gone.' };
  });
  // Only a quit on purpose is clean (not a crash): the very last step, after the library has closed.
  stops.addLast('clean-quit mark', () => {
    liveWriter.markClean();
  });

  // ---- imports ----------------------------------------------------------------
  // The window's page, not just the window: at quit the page goes first (Session 20).
  const sendToOperator = <C extends EventChannel>(channel: C, payload: EventContract[C]) => {
    sendToPage(operatorWindow, channel, payload);
  };

  // ---- streaming -------------------------------------------------------------
  let eventsStreamWas: StreamStatus | null = null;
  const streamKeys = new StreamKeyStore(
    join(app.getPath('userData'), 'stream-keys.json'),
    safeStorage,
    noSafeStorage,
  );
  stream = new StreamService({
    clockStyle: mainClockStyle,
    profiles: new StreamProfileRepo(db, (id) => streamKeys.has(id)),
    keys: streamKeys,
    settings,
    screens: screenRepo,
    createProgram: (size) =>
      createProgramWindow(size, (line) => {
        log.info(`Stream page: ${line}`);
      }),
    sendToOperator,
    platform: process.platform,
    mediaAccess: (kind) =>
      process.platform === 'darwin' || process.platform === 'win32'
        ? systemPreferences.getMediaAccessStatus(kind)
        : 'granted',
    askMediaAccess: (kind) =>
      process.platform === 'darwin' ? systemPreferences.askForMediaAccess(kind) : Promise.resolve(true),
    fakeDevices,
    // Tests: a stream goes only to this computer (the guard every e2e run sets; Session 28).
    onlyThisComputer: testLinkGuard,
    // Tests: No sound after this many ms of quiet, not 20 s (Session 31).
    noSoundMs: swMs('DRASHTI_TEST_NO_SOUND_MS') ?? undefined,
    // Tests: a recording's part holds this many bytes, not 3.5 GB (Session 31).
    recordPartBytes: Number(sw('DRASHTI_TEST_RECORD_PART_BYTES') ?? 0) || undefined,
    recordingDrive: (folder) => onFat(folder),
    titleMarks: (marks) => {
      if (operatorWindow && !operatorWindow.isDestroyed())
        operatorWindow.setTitle(marks ? `Drashti — ${marks}` : 'Drashti');
    },
    statusChanged: (status) => {
      eventsOut.emit(streamEvents(eventsStreamWas, status));
      eventsStreamWas = status;
      // On air or recording (or getting there): the computer stays awake for the stream too (Session 31).
      sleepGuard.setStreaming(status.live.state !== 'off' || status.recording.state !== 'off');
    },
    ffmpegPath: () =>
      findFfmpeg({
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        platform: process.platform,
        arch: process.arch,
        override: sw('DRASHTI_FFMPEG'),
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
    programChanged: () => {
      zoomWindow?.programChanged();
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  const streaming = stream;
  stops.add('stream', () => {
    streaming.close();
  });

  // ---- another app's window as the background (Session 48) -------------------
  // Tests only (never a packaged Drashti): windows the test opens, titled "Placeholder…", stand in for other
  // apps' (no test may need Screen Recording, or see the computer's own windows).
  const windowStandIn = app.isPackaged ? undefined : sw('DRASHTI_TEST_WINDOW_STANDIN');
  const shownWindows = new LiveWindowService({
    sources: windowStandIn
      ? standInWindowSources(windowStandIn, (line) => {
          log.info(line);
        })
      : electronWindowSources(process.platform),
    showWindow: (window) => engine.showWindow(window),
    background: () => engine.current.layers.background,
    // A window in the picture-in-picture box (Session 50) is up too: the screens' pages may ask for it.
    pip: () => engine.current.layers.pip,
    changed: (status) => {
      sendToOperator(IPC.liveWindow.changed, status);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    now: Date.now,
  });
  liveWindows = shownWindows;
  engine.onChange(() => {
    shownWindows.follow();
  });
  stops.add('shown window', () => {
    shownWindows.close();
  });

  // ---- the window for Zoom (Session 48) -------------------------------------------
  const zoom = new ZoomWindow({
    program: () => streaming.programFrame(),
    holdProgram: (on) => {
      streaming.hold('window for Zoom', on);
    },
    workAreas: () => {
      const controls =
        operatorWindow && !operatorWindow.isDestroyed()
          ? electronScreen.getDisplayMatching(operatorWindow.getBounds())
          : electronScreen.getPrimaryDisplay();
      return { all: electronScreen.getAllDisplays().map((d) => d.workArea), controls: controls.workArea };
    },
    placeFile: join(app.getPath('userData'), 'zoom-window.json'),
    log: (line) => {
      log.info(line);
    },
  });
  zoomWindow = zoom;
  stops.add('window for Zoom', () => {
    zoom.close();
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
    const resumed = streaming.resumeAfterStop({ cleanQuit: startup.cleanQuit });
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
      sendToPage(audioWindow, IPC.audio.chosen, { device });
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
  stops.add('roles', () => {
    roles.dispose();
  });
  lockAdminChannels(
    () => roles.needsAdmin(),
    adminRefusals(
      () => audioOutput.status,
      () => roles.view(),
    ),
  );
  /** A menu item that needs the admin PIN: run now, or once the operator window has the PIN typed. */
  let pendingAdmin: { run: () => void; until: number } | null = null;
  const requireAdmin = (what: string, run: () => void) => {
    if (!roles.needsAdmin()) {
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
  // The mode is kept in the library's settings as it changes. Since Session 20 a start after a clean
  // quit begins in Pro Mode, with roles on too since Session 46 (as the operator, admin locked, with no
  // PIN asked; until then in Simple Mode, Pro Mode taking a PIN); after an unexpected stop Drashti comes
  // back in the mode it was in, so the operator carries on (admin locked). The same answer as restart
  // recovery's: did the last run stop unexpectedly, less than RECOVERY_MAX_AGE_MS ago? A stop longer
  // ago starts like a clean quit (Session 21).
  const savedMode = settings.get('operatorMode');
  const wasIn: OperatorMode = isOperatorMode(savedMode) ? savedMode : 'pro';
  // Roles held locked (the PIN file could not be read; Sessions 31–36): Simple Mode, even after a crash in Pro.
  let mode: OperatorMode = roles.held() ? 'simple' : startingMode({ recentStop: startup.recentStop, wasIn });
  if (roles.held()) startNotice = startNotice ? `${startNotice}\n\n${ROLES_HELD}` : ROLES_HELD;
  if (mode !== wasIn) settings.set('operatorMode', mode);
  if (mode === 'simple')
    log.info(
      roles.held()
        ? 'Roles are held locked: starting in Simple Mode'
        : 'Starting in Simple Mode, as before the unexpected stop',
    );
  else {
    if (wasIn === 'simple')
      log.info(
        startup.cleanQuit
          ? 'Starting in Pro Mode after a clean quit'
          : 'Starting in Pro Mode: the unexpected stop was 3 hours or more ago',
      );
    if (roles.on()) log.info('Roles are on: starting in Pro Mode as the operator, admin locked');
  }
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
      // Quitting: the library has closed (Session 23: a change during an import came 2 s later).
      if (db === null) return;
      lastChanged = Date.now();
      sendToOperator(IPC.library.changed, { at: lastChanged, what: 'presentations' });
      network?.hint('presentations');
      // A picture in the idle rotation may have gone (or come back).
      idleService?.refresh();
      // What the nodes should copy may have changed.
      wantedMedia?.invalidate();
      nodeService?.libraryChanged();
      // A sharpened picture's file may have come back, or gone (Session 26f).
      void sharpened.refresh();
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
  stops.add('library change notices', () => {
    if (changedTimer) clearTimeout(changedTimer);
    changedTimer = null;
  });
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
  // ---- the guides inside Drashti (Sessions 31–36) -------------------------------------------------
  // Read from the files beside the app, for the operator window only. Simple Mode is given the operator's
  // and the presenter's guides: the admin's holds how to reset a forgotten PIN.
  handle(IPC.guides.list, (e) =>
    fromOperator(e)
      ? GUIDES.filter((g) => mode === 'pro' || g.simple).map((g) => ({ id: g.id, tab: g.tab }))
      : [],
  );
  // Tests (DRASHTI_TEST_GUIDES_DELAY_MS): a slow read, so a test sees Loading wait its half second.
  const guidesDelayMs = swMs('DRASHTI_TEST_GUIDES_DELAY_MS');
  handle(IPC.guides.read, async (e, raw): Promise<GuideRead> => {
    if (!fromOperator(e)) return { ok: false, message: 'Only Drashti’s own window can read the guides.' };
    if (guidesDelayMs !== null) await new Promise((resolve) => setTimeout(resolve, guidesDelayMs));
    const id = guideIdSchema.safeParse(raw);
    const guide = id.success ? GUIDES.find((g) => g.id === id.data) : undefined;
    if (!guide) return { ok: false, message: 'There is no such guide.' };
    if (mode === 'simple' && !guide.simple)
      return {
        ok: false,
        message: 'That guide is read in Pro Mode: View, then Switch to Pro Mode…, or ask the admin.',
      };
    const text = guideFiles.read(guide.id);
    return text === null
      ? { ok: false, message: 'This guide is missing from Drashti’s folder: install Drashti again.' }
      : { ok: true, text, sizes: guideFiles.sizesFor(text) };
  });
  // ---- programs a crash left running (Session 31, ROB-3) ----------------------------------------
  // Each program Drashti starts that could outlive it is written down (src/main/system/leftovers.ts): one
  // the last run left running (the very one: id, start time and program) is stopped now, before anything
  // that could start it again or clear the files it was writing.
  const leftovers = new Leftovers({
    file: leftoversFile(userDataDir),
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  leftovers.stopLeft();
  // Tests only (never a packaged Drashti): imports judge media by their headers alone, as before Session 50,
  // and nothing is converted by itself, so a test can try Convert as an operator does.
  const noConvertAtImport = !app.isPackaged && sw('DRASHTI_TEST_NO_CONVERT_AT_IMPORT') === '1';
  const imports = new ImportService({
    spawn: spawnImportWorker,
    children: {
      started: (pid, kind) => void leftovers.started(pid, kind),
      ended: (pid) => {
        leftovers.forget(pid);
      },
    },
    worker: {
      dbFile: libraryFile(),
      mediaDir,
      userDataDir,
      schemaVersion: LATEST_VERSION,
      // Tests only (never a packaged Drashti): as if no Keynote or PowerPoint were installed, or with a
      // stand-in that saves PowerPoint files as PDF (Session 26a).
      converters: app.isPackaged
        ? true
        : sw('DRASHTI_TEST_NO_CONVERTER') === '1'
          ? false
          : sw('DRASHTI_TEST_DECK_CONVERTER') === '1'
            ? 'stand-in'
            : true,
      // Every video and sound read with the bundled FFmpeg at import (Session 50): what Drashti's player
      // cannot play is converted by itself once the import ends (onFinished, below).
      ffmpeg: noConvertAtImport
        ? null
        : findFfmpeg({
            packaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            appPath: app.getAppPath(),
            platform: process.platform,
            arch: process.arch,
            override: sw('DRASHTI_FFMPEG'),
          }),
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
    onFinished: (run) => {
      // An import can change what comes next (a replaced presentation, a filled playlist).
      engine.refreshNext();
      libraryChanged(true);
      // It may have loaded a Shastra text (or loaded one again).
      listChanged('shastra');
      // Or a calendar.
      calendarService?.refresh();
      // What it found Drashti's player cannot play is converted by itself (Session 50): one file at a time,
      // a moment after the import, never while the stream is on air or recording.
      if (run) conversions.convertImported(importRepo.report(run.id));
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
  stops.add('imports', () => {
    imports.stop();
  });
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
    children: {
      started: (pid, partFile) => void leftovers.started(pid, 'conversion', { partFile }),
      ended: (pid) => {
        leftovers.forget(pid);
      },
    },
    ffmpegPath: () =>
      findFfmpeg({
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        platform: process.platform,
        arch: process.arch,
        override: sw('DRASHTI_FFMPEG'),
      }),
    // A test can say the stream is on air (DRASHTI_TEST_ON_AIR_HOOK; Session 50: conversions at import wait).
    busy: () =>
      streaming.inUse() || testOnAir
        ? 'Waits while the stream is on air or recording, then carries on by itself.'
        : null,
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
  stops.add('conversions', () => {
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
  // ---- Save as MP4… (Session 26e): a video's part copied as it is, run as converting is ----
  const saveFfmpeg = () =>
    findFfmpeg({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      platform: process.platform,
      arch: process.arch,
      override: sw('DRASHTI_FFMPEG'),
    });
  const saves = new TrimSaves({
    video: (mediaId) => {
      const row = media.kindAndFile(mediaId);
      const named = media.kindAndName(mediaId);
      return row?.kind === 'video' && !row.missing && named
        ? { path: join(mediaDir, row.path), name: named.name }
        : null;
    },
    ffmpegPath: () => saveFfmpeg(),
    readInfo: async (file) => {
      const ffmpeg = saveFfmpeg();
      return ffmpeg ? readInfo(ffmpeg, file) : { durationMs: null, video: null, audio: null };
    },
    pickDest: async (defaultName) => {
      if (!operatorWindow) return null;
      const last = settings.get('trim.folder');
      const folder =
        typeof last === 'string' && isAbsolute(last) ? last : (testDownloadsDir ?? app.getPath('videos'));
      const picked = await dialog.showSaveDialog(operatorWindow, {
        title: 'Save as MP4',
        defaultPath: join(folder, defaultName),
        buttonLabel: 'Save',
        filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
      });
      if (picked.canceled || !picked.filePath) return null;
      const path = picked.filePath.toLowerCase().endsWith('.mp4')
        ? picked.filePath
        : `${picked.filePath}.mp4`;
      settings.set('trim.folder', dirname(path));
      return path;
    },
    saveCopy: (source, dest, info, copy) => conversions.saveCopy(source, dest, info, copy),
    cancelFile: (id) => conversions.cancelFile(id),
    importFile: async (path) => (await imports.start([path], {})).ok,
    changed: (jobs) => {
      sendToOperator(IPC.media.savesChanged, jobs);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    readRate: !app.isPackaged && sw('DRASHTI_TEST_SAVE_READRATE') === '1',
  });
  const notSaving = { ok: false as const, message: 'Only the operator window can save a video’s part.' };
  handle(IPC.media.keyframe, async (e, mediaId, startMs) => {
    const id = idSchema.safeParse(mediaId);
    const at = z
      .number()
      .int()
      .min(0)
      .max(24 * 3600 * 1000)
      .safeParse(startMs);
    if (!fromOperator(e) || !id.success || !at.success) return notSaving;
    return saves.keyframe(id.data, at.data);
  });
  handle(IPC.media.saveTrim, async (e, request) => {
    const r = saveRequestSchema.safeParse(request);
    if (!fromOperator(e)) return notSaving;
    if (!r.success) return { ok: false as const, message: 'Its end must come after its start.' };
    return saves.save(r.data);
  });
  handle(IPC.media.saves, () => saves.list());
  handle(IPC.media.stopSave, (e, jobId) =>
    fromOperator(e) && typeof jobId === 'string' ? saves.stop(jobId) : false,
  );
  handle(IPC.media.showSave, (e, jobId) => {
    const path = saves.list().find((j) => j.id === jobId)?.path ?? null;
    if (fromOperator(e) && path) shell.showItemInFolder(path);
    return null;
  });

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
  handle(IPC.app.recovery, async () => {
    // A video input put back after the restart (Session 50): the notice waits for the first screen to say whether
    // it is on this computer (8 s at most), and names it when it was not (it has come off the screens).
    const gone = await inputs.settled();
    if (gone !== null && recovery) recovery = { ...recovery, input: null, inputGone: gone };
    // One put back in the picture-in-picture box (Session 51): the same, the box taken off.
    const boxGone = await inputs.boxSettled();
    if (boxGone !== null && recovery) recovery = { ...recovery, pip: false, pipInputGone: boxGone };
    return recovery;
  });
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
  // The reads a window needs as it opens (Session 39): a failure fails the request, so the window says what
  // it could not read with Try again, and the log names it once. Tests only (never packaged):
  // DRASHTI_TEST_UNREADABLE holds the reads it names failing until globalThis.drashtiTestReadable(name).
  const windowReads = startupReads(sw('DRASHTI_TEST_UNREADABLE'), (line) => {
    log.warn(line);
  });
  if (sw('DRASHTI_TEST_UNREADABLE') !== undefined)
    (globalThis as { drashtiTestReadable?: (name: string) => void }).drashtiTestReadable = (name) => {
      windowReads.readable(name);
    };
  handle(IPC.engine.subscribe, (event) =>
    windowReads.read('engine', () => {
      transport.add(event.sender);
      return engine.snapshot();
    }),
  );
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
      if (rows) presentations.setContent(styleNewText(rows, themes.themeOrDefault(null)));
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
    mediaExists: (mediaId) => {
      const found = media.file(mediaId);
      return found !== null && found.deleted !== true;
    },
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
    search.search(typeof query === 'string' ? cutText(query, 200) : ''),
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
  // ---- audio playlists (Session 14): music on the audio layer, independent of the slides ------------
  const audioPlaylists = new AudioPlaylistRepo(db);
  // Music deleted, or tracks taken out, before this start can no longer be undone (Session 26a).
  audioPlaylists.purge();
  const music = new MusicService({
    repo: audioPlaylists,
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
  // A folder's sounds in Audio too (Session 44, music/folder-audios.ts): "<folder> - Audios", in step with its
  // playlist after every change to playlists, and once now for the ones an earlier version made.
  const folderAudios = {
    playlists,
    audio: audioPlaylists,
    settings: {
      get: (key: string) => settings.get(key),
      set: (key: string, value: unknown) => {
        settings.set(key, value);
      },
    },
  };
  syncAudios = () => {
    try {
      if (syncFolderAudios(folderAudios)) sendToOperator(IPC.music.changed, music.view());
    } catch (error) {
      log.warn(`Audio: a folder's sounds could not be brought into Audio (${String(error)})`);
    }
  };
  syncAudios();
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
  handle(IPC.music.restore, (e, id) => (fromOperator(e) ? music.restore(id) : notMusicOperator));
  handle(IPC.music.restoreTrack, (e, id, at) =>
    fromOperator(e) ? music.restoreTrack(id, at) : notMusicOperator,
  );
  handle(IPC.music.play, (e, playlistId, trackIndex) => {
    const parsed = musicPlaySchema.safeParse({ playlistId, index: trackIndex ?? 0 });
    if (!fromOperator(e) || !parsed.success) return notMusicOperator;
    return music.play(parsed.data.playlistId, parsed.data.index);
  });
  // ---- scheduled backups (Session 14): into a folder an admin picks, at their times ----------------
  let eventsBackupsWas: ScheduledBackupsView | null = null;
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
      eventsOut.emit(backupEvents(eventsBackupsWas, view));
      eventsBackupsWas = view;
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    ...(testBackupRate ? { bytesPerSecond: testBackupRate } : {}),
  });
  eventsBackupsWas ??= scheduledBackups.view();
  stops.add('scheduled backups', () => {
    scheduledBackups.dispose();
  });
  const notBackupsOperator = { ok: false as const, message: 'Only the operator window can change backups.' };
  handle(IPC.backups.view, () => scheduledBackups.view());
  handle(IPC.backups.save, (e, schedule) =>
    fromOperator(e) ? scheduledBackups.save(schedule) : notBackupsOperator,
  );
  handle(IPC.backups.runNow, (e) => (fromOperator(e) ? scheduledBackups.runNow() : notBackupsOperator));
  handle(IPC.backups.dismiss, () => scheduledBackups.dismiss());
  // Events out (Session 28): an admin's (the admin lock), Pro Mode's (Simple Mode's lock), the operator window's.
  const notEventsOperator = {
    ok: false as const,
    message: 'Only the operator window can change events out.',
  };
  handle(IPC.events.view, () => eventsOut.view());
  handle(IPC.events.add, (e, url, allowInternet) =>
    fromOperator(e) ? eventsOut.add(url, allowInternet) : notEventsOperator,
  );
  handle(IPC.events.update, (e, id, patch) =>
    fromOperator(e) ? eventsOut.update(id, patch) : notEventsOperator,
  );
  handle(IPC.events.remove, (e, id) => (fromOperator(e) ? eventsOut.remove(id) : notEventsOperator));
  handle(IPC.events.rotate, (e, id) => (fromOperator(e) ? eventsOut.rotate(id) : notEventsOperator));
  handle(IPC.events.test, (e, id) => (fromOperator(e) ? eventsOut.test(id) : notEventsOperator));
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
    // Packaged, an update's files come from GitHub only (Session 30).
    packaged: app.isPackaged,
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
  // The very last step: the installer may close Drashti as it starts, so everything else is done first.
  stops.addLast('updates (an install at quit)', () => {
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
  // ---- Import from a Link (Session 25b): saved in a folder an admin chooses, then the normal import ----
  const links = new LinkService({
    children: {
      started: (pid, group) => void leftovers.started(pid, 'yt-dlp', { group }),
      ended: (pid) => {
        leftovers.forget(pid);
      },
    },
    // A Dropbox folder as one playlist (Session 26c, src/main/playlists/folder-playlist.ts).
    folderPlaylist: ({ name, runId, files }) => {
      const made = makeFolderPlaylist(playlists, name, importRepo.report(runId)?.items ?? [], files);
      if (made) {
        sendToOperator(IPC.playlists.changed, { at: Date.now() });
        syncAudios();
      }
      return made;
    },
    addToFolderPlaylist: ({ playlistId, runId, files }) => {
      const added = addToFolderParts(playlists, playlistId, importRepo.report(runId)?.items ?? [], files);
      if (added > 0) {
        engine.refreshNext();
        sendToOperator(IPC.playlists.changed, { at: Date.now() });
        syncAudios();
      }
      return added;
    },
    spawn: spawnDownloadWorker,
    onAir: () => streaming.inUse() || testOnAir,
    freeBytes: diskFreeBytes,
    defaultFolder: join(testDownloadsDir ?? app.getPath('videos'), 'Drashti downloads'),
    lastFolder: {
      get: () => {
        const folder = settings.get('links.folder');
        return typeof folder === 'string' && isAbsolute(folder) ? folder : null;
      },
      set: (folder) => {
        settings.set('links.folder', folder);
      },
    },
    pickFolder: async (current) => {
      if (!operatorWindow) return null;
      const picked = await dialog.showOpenDialog(operatorWindow, {
        title: 'Save Downloads In',
        message: 'Choose where the downloaded files are saved. Drashti never moves or deletes them.',
        defaultPath: current,
        buttonLabel: 'Choose',
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
      });
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
    importFiles: async (paths) => {
      const result = await imports.start(paths, {});
      return result.ok ? { ok: true, runId: result.run.id } : { ok: false, message: result.message };
    },
    changed: (view) => {
      sendToOperator(IPC.links.changed, view);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    record: join(userDataDir, 'link-downloads.json'),
    workDir: join(userDataDir, 'Link downloads'),
    // The admin's highest video quality (Session 25c), kept with the library's settings.
    maxHeight: {
      get: () => {
        const height = settings.get('links.maxHeight');
        return isLinkHeight(height) ? height : DEFAULT_LINK_MAX_HEIGHT;
      },
      set: (height) => {
        settings.set('links.maxHeight', height);
      },
    },
    // A Dropbox video taller than that: Drashti's own conversion makes a copy that tall first (it waits
    // while on air).
    fitVideo: (path, outDir, maxHeight, report) =>
      conversions.fitHeight(path, outDir, {
        maxHeight,
        waiting: (note) => {
          report(note === null ? null : 'the stream is on air or recording', null);
        },
        progress: (fraction) => {
          report(null, fraction);
        },
      }),
    // YouTube (Session 25c): Drashti's own yt-dlp and Deno; in tests only ever the fake (never the real one).
    youtubeLaunch: (work) =>
      youtubeLaunch(
        {
          packaged: app.isPackaged,
          platform: process.platform,
          testing: anyTestSwitch(),
          fake: app.isPackaged ? null : (sw('DRASHTI_TEST_FAKE_YT_DLP') ?? null),
          fakeConfig: app.isPackaged ? null : (sw('DRASHTI_TEST_FAKE_YT_DLP_CONFIG') ?? null),
          execPath: process.execPath,
          tools: findYoutubeTools({
            packaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            appPath: app.getAppPath(),
            platform: process.platform,
            arch: process.arch,
          }),
          ffmpeg: findFfmpeg({
            packaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            appPath: app.getAppPath(),
            platform: process.platform,
            arch: process.arch,
            override: sw('DRASHTI_FFMPEG'),
          }),
        },
        toolFolders(work),
      ),
    route: { testOrigin: testLinkOrigin, guard: testLinkGuard || testLinkOrigin !== null },
  });
  stops.add('links', () => {
    links.close();
  });
  const notLinksOperator = {
    ok: false as const,
    message: 'Only the operator window can import from a link.',
  };
  handle(IPC.links.view, () => links.view());
  handle(IPC.links.look, (e, kind, link) =>
    fromOperator(e) && (kind === 'dropbox' || kind === 'youtube') && typeof link === 'string'
      ? links.look(kind, link)
      : notLinksOperator,
  );
  handle(IPC.links.pickFolder, (e) => (fromOperator(e) ? links.pickFolder() : notLinksOperator));
  handle(IPC.links.download, (e, choice) => (fromOperator(e) ? links.download(choice) : notLinksOperator));
  handle(IPC.links.stop, (e) => (fromOperator(e) ? links.stop() : notLinksOperator));
  handle(IPC.links.reset, (e) => (fromOperator(e) ? links.reset() : notLinksOperator));
  handle(IPC.links.addWaiting, (e) => (fromOperator(e) ? links.addWaiting() : notLinksOperator));
  handle(IPC.links.setMaxHeight, (e, height) =>
    fromOperator(e) ? links.setMaxHeight(height) : notLinksOperator,
  );
  handle(IPC.links.showSaved, (e, runId) => {
    const saved = links.savedPath(typeof runId === 'string' ? runId : null);
    if (fromOperator(e) && saved) shell.showItemInFolder(saved);
    return null;
  });
  if (artiTestClock)
    (globalThis as { drashtiArtiClock?: (wallMs: number) => void }).drashtiArtiClock = (wallMs) => {
      artiClockOffset = wallMs - Date.now();
      scheduledBackups.check();
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
  stops.add('calendars', () => {
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
  stops.add('idle rotation', () => {
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
  // ---- Lower Thirds (Session 44, shared/lower-thirds.ts): the library's, shown and hidden as engine commands --
  const lowerThirds = new LowerThirdRepo(db);
  // Those deleted before this start can no longer be undone.
  lowerThirds.purge();
  const lowerThirdsChanged = () => {
    sendToOperator(IPC.lowerThirds.changed, lowerThirds.list());
  };
  const notLowerThirdOperator = {
    ok: false as const,
    message: 'Only the operator window can change lower thirds.',
  };
  const lowerThirdIds = z.array(idSchema).max(500);
  handle(IPC.lowerThirds.list, () => lowerThirds.list());
  handle(IPC.lowerThirds.save, (e, id, raw) => {
    if (!fromOperator(e)) return notLowerThirdOperator;
    const which = idSchema.nullable().safeParse(id);
    const input = lowerThirdInputSchema.safeParse(raw);
    if (!which.success || !input.success)
      return { ok: false as const, message: 'That lower third cannot be kept: it needs words on a line.' };
    const saved =
      which.data === null
        ? lowerThirds.create(input.data)
        : lowerThirds.update(which.data, input.data)
          ? which.data
          : null;
    if (saved === null) return { ok: false as const, message: 'That lower third no longer exists.' };
    lowerThirdsChanged();
    // One on the screens takes its new words and look at once, without playing its in again.
    const shown = lowerThirds.get(saved);
    if (shown && engine.current.layers.lowerThird?.id === saved)
      engine.dispatch({ type: 'showLowerThird', lowerThird: shown });
    log.info(`Lower thirds: ${which.data === null ? 'made' : 'changed'} one`);
    return { ok: true as const, id: saved };
  });
  handle(IPC.lowerThirds.remove, (e, raw) => {
    if (!fromOperator(e)) return notLowerThirdOperator;
    const ids = lowerThirdIds.safeParse(raw);
    if (!ids.success) return { ok: false as const, message: 'Those lower thirds cannot be deleted.' };
    const removed = lowerThirds.remove(ids.data);
    if (removed.length > 0) lowerThirdsChanged();
    return { ok: true as const, ids: removed };
  });
  handle(IPC.lowerThirds.restore, (e, raw) => {
    if (!fromOperator(e)) return notLowerThirdOperator;
    const ids = lowerThirdIds.safeParse(raw);
    if (!ids.success) return { ok: false as const, message: 'Those lower thirds cannot be brought back.' };
    const back = lowerThirds.restore(ids.data);
    if (back.length > 0) lowerThirdsChanged();
    return { ok: true as const, ids: back };
  });
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
  let eventsAnnouncementsWas: AnnouncementsView | null = null;
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
      eventsOut.emit(announcementEvents(eventsAnnouncementsWas, view));
      eventsAnnouncementsWas = view;
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  eventsAnnouncementsWas = announcements.view();
  // What recovery put back carries on until its time; the rest that was showing has ended.
  announcements.resume();
  stops.add('announcements', () => {
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
        override: sw('DRASHTI_FFMPEG'),
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
      presentation: (presentationId) => playableDoc(presentationId),
      // The presenter's remote (Session 18): the library a page at a time (no files), and searched.
      library: (offset, limit) => {
        const all = presentations.list();
        return {
          total: all.length,
          presentations: all.slice(offset, offset + limit).map((p) => ({
            id: p.id,
            name: p.name,
            libraryName: p.libraryName,
            slideCount: p.slideCount,
            category: listedKirtan(p.kirtan)?.category ?? null,
          })),
        };
      },
      search: (query) => search.search(query),
      shastraTexts: () =>
        shastra.list().map((t) => ({ name: t.name, abbreviation: t.abbreviation, itemCount: t.itemCount })),
      passage: (reference) => shastra.resolve(reference),
      messages: () => messageTemplates.list(),
      logo: () => {
        const id = settings.get('logoPropId');
        const prop = typeof id === 'string' ? props.list().find((p) => p.id === id) : undefined;
        return prop ? asPropItem(prop) : null;
      },
      mediaSource: (mediaId) =>
        previewSource(mediaId, {
          mediaDir,
          kindAndFile: (id) => media.kindAndFile(id),
          sharpened: (id, step) => {
            const found = media.file(id);
            return found && !found.missing ? sharpened.relativePath(found.sha256, step) : null;
          },
        }),
      stage: () => {
        const groupId = screenRepo.firstGroup('stage');
        return { groupId, languages: groupId ? looks.liveLanguages(groupId) : null };
      },
      hall: () => ({ groupId: screenRepo.firstGroup('audience') }),
      // Audience and Stage (Session 50): a Remote says which are off.
      switches: () => manager.switches(),
      looks: () => lookRepo.list().map((l) => ({ id: l.id, name: l.name })),
      clockStyle: mainClockStyle,
    },
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
  stops.add('network', () => net.close());

  // ---- output nodes (Session 13) ----------------------------------------------------------------
  const nodeRepo = new NodeRepo(db);
  const wanted = new WantedMedia(
    db,
    () => {
      const idle = settings.get('idleRotation') as { pictures?: unknown } | undefined;
      return Array.isArray(idle?.pictures)
        ? idle.pictures.filter((p): p is string => typeof p === 'string')
        : [];
    },
    Date.now,
    // A picture's sharpened copy (Session 26f), once it is ready: one more file for the node, copied as
    // media is, right after the picture's own.
    {
      want: (mediaId) => {
        const look = media.look(mediaId);
        const step = look ? sharpenStep(look.sharpness) : 0;
        const found = step > 0 ? media.file(mediaId) : null;
        const file = found && !found.missing ? sharpened.fileOf(found.sha256, step) : null;
        return file
          ? { id: copyMediaId(mediaId, step), sha256: file.hash, bytes: file.bytes, ext: file.ext }
          : null;
      },
      source: (copyId) => {
        const copy = copyOfId(copyId);
        const found = copy ? media.file(copy.mediaId) : null;
        if (!copy || !found || found.missing) return null;
        const relative = sharpened.relativePath(found.sha256, copy.step);
        const file = sharpened.fileOf(found.sha256, copy.step);
        return relative && file
          ? { path: join(mediaDir, relative), sha256: file.hash, bytes: file.bytes, ext: file.ext }
          : null;
      },
    },
  );
  wantedMedia = wanted;
  const mainName = () =>
    testComputerName ?? localName()?.replace(/\.local$/u, '') ?? hostname().replace(/\.local$/u, '');
  /** Main's identity for its nodes, read (or made) once, when a node is paired or being paired. */
  let identityLoad: IdentityLoad | null = null;
  /** How each of Main's own outputs draws (they report every few seconds), for the dashboard. */
  const localReports = new Map<
    string,
    { droppedFrames: number; paintedRev: number; missingFonts: string[] }
  >();
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
      if (!identityLoad) {
        identityLoad = loadIdentity(userDataDir, mainName(), {
          log: (line) => {
            log.warn(line);
          },
        });
        // Could not be read (Session 23): the operator is told now, and Screens > Nodes says it too.
        if (!identityLoad.ok) {
          const text = identityLoad.problem;
          if (startNoticeTaken) sendToOperator(IPC.app.notice, { text });
          else startNotice = startNotice ? `${startNotice}\n\n${text}` : text;
        }
      }
      if (!identityLoad.ok) return { problem: identityLoad.problem };
      const kept = identityLoad.identity;
      return {
        cert: kept.certPem,
        key: kept.keyPem,
        fingerprint: kept.fingerprint,
        id: kept.id,
        name: mainName(),
      };
    },
    newIdentity: () => {
      identityLoad = { ok: true, identity: makeNewIdentity(userDataDir, mainName()) };
    },
    version: appVersion(),
    clockStyle: mainClockStyle,
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
      // A node's displays or screens changed: copies follow the screens' size, a node's included (Session 26h).
      void sharpened.screensChanged();
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
                ...((localReports.get(st.screenId)?.missingFonts.length ?? 0) > 0
                  ? { missingFonts: localReports.get(st.screenId)?.missingFonts }
                  : {}),
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
  stops.add('nodes', () => nodes.close());
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
  handle(IPC.nodes.newIdentity, (e) => (fromOperator(e) ? nodes.newIdentity() : notNodesOperator));
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
      // Stopped (given up on, Session 23): Try again, with the watchdog's count starting afresh.
      if (manager.status().some((st) => st.screenId === sid.data && st.state === 'stopped')) {
        log.info('Trying a stopped output again, as the operator asked');
        watchdog.retryNow(win.webContents, 'Try again');
      } else {
        log.info('Reloading an output from the screens dashboard');
        win.webContents.reload();
      }
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
        if (win && sc)
          sendToPage(win, IPC.output.identify, {
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
  /** Each output page's first painted frame already said (its time, on this computer's clock). */
  const firstPaints = new Map<string, number>();
  handle(IPC.output.report, (e, raw) => {
    const screenId = manager.screenIdFor(e.sender.id);
    const r = raw as {
      droppedFrames?: unknown;
      paintedRev?: unknown;
      warming?: unknown;
      missingFonts?: unknown;
      firstPaint?: { rev?: unknown; wallAt?: unknown } | null;
    } | null;
    // Its page's first painted frame, once per page: the start's last phase line (Sessions 31–36, PERF-1).
    const first = r?.firstPaint;
    if (
      screenId &&
      typeof first?.rev === 'number' &&
      typeof first.wallAt === 'number' &&
      firstPaints.get(screenId) !== first.wallAt
    ) {
      firstPaints.set(screenId, first.wallAt);
      log.info(
        phaseLine(
          `${outputNames.get(screenId) ?? 'an output'} first painted revision ${String(first.rev)}`,
          first.wallAt,
        ),
      );
    }
    if (screenId && typeof r?.droppedFrames === 'number' && typeof r.paintedRev === 'number') {
      const missingFonts = missingFontsIn(r.missingFonts);
      const before = localReports.get(screenId)?.missingFonts.join('|') ?? '';
      localReports.set(screenId, { droppedFrames: r.droppedFrames, paintedRev: r.paintedRev, missingFonts });
      // A font found missing (or there now): the dashboard says so.
      if (missingFonts.join('|') !== before) nodes.localOutputsChanged();
      heartbeat.report(screenId, r.paintedRev, r.warming === true);
      // Reporting from a page loaded since it was given up on: it draws again.
      if (loadedSinceStopped.has(screenId)) manager.setStopped(screenId, false);
    }
    return null;
  });
  // Render errors in any window (Session 23): logged; an output draws black and is reloaded once.
  hearRenderErrors({
    log: (line) => {
      log.warn(line);
    },
    watchdog,
    windowOf: (sender) => {
      const screenId = manager.screenIdFor(sender.id);
      const output = screenId ? outputWindows.get(screenId) : undefined;
      if (screenId && output && !output.isDestroyed())
        return { name: outputNames.get(screenId) ?? 'an output', output: output.webContents };
      if (operatorWindow && !operatorWindow.isDestroyed() && sender.id === operatorWindow.webContents.id)
        return { name: 'operator', output: null };
      if (streaming.isProgram(sender)) return { name: 'the stream’s page', output: null };
      return { name: 'a window', output: null };
    },
  });
  // Tests only (never a packaged Drashti): every output's clock held at one moment of the engine's time, or
  // let go (null), so two screens can be compared pixel for pixel part-way through a transition (Session 26d),
  // the stream's picture too (Session 27). Says how many pages it reached.
  if (testClockHold)
    (globalThis as { drashtiTestHoldClock?: (at: number | null) => number }).drashtiTestHoldClock = (at) => {
      let reached = 0;
      for (const win of outputWindows.values())
        if (pageAlive(win)) {
          sendToPage(win, IPC.output.testClock, { at });
          reached++;
        }
      const program = streaming.programContents();
      if (program && !program.isDestroyed()) {
        program.send(IPC.output.testClock, { at });
        reached++;
      }
      return reached;
    };
  if (testRenderErrors)
    (globalThis as { drashtiTestRenderError?: (screenId?: string) => number }).drashtiTestRenderError = (
      screenId,
    ) => {
      let sent = 0;
      for (const [id, win] of outputWindows)
        if (screenId === undefined || id === screenId) {
          sendToPage(win, IPC.output.testThrow, {});
          sent++;
        }
      return sent;
    };
  handle(IPC.screens.assignNodeDisplay, (e, groupId, nodeId, displayId) =>
    fromOperator(e)
      ? keepScreens.change(() => screens.assignNodeDisplay(groupId, nodeId, displayId))
      : notAllowed,
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
  const playlistsChanged = () => {
    // A live item's order may have changed, and what comes next may be different.
    engine.reorderLive();
    engine.refreshNext();
    sendToOperator(IPC.playlists.changed, { at: Date.now() });
    net.hint('playlists');
    syncAudios();
  };
  // ---- Smart playlists (Session 26c): a playlist that follows a folder on the computer ----
  /** A test switch (never a packaged Drashti): a positive number of milliseconds, or null. */
  const smartFolders = new SmartFolders({
    db: libraryDb,
    playlists,
    importFiles: async (paths, options) => {
      const result = await imports.start(paths, options);
      return result.ok ? { ok: true, runId: result.run.id } : { ok: false, message: result.message };
    },
    report: (runId) => importRepo.report(runId),
    changed: playlistsChanged,
    views: (views) => {
      sendToOperator(IPC.playlists.smartChanged, views);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    now: () => Date.now(),
    scanMs: swMs('DRASHTI_TEST_SMART_SCAN_MS') ?? 10_000,
    settleMs: swMs('DRASHTI_TEST_SMART_SETTLE_MS') ?? 3000,
    watch: nodeWatch,
    // Session 28: what joins waits while the stream is on air or recording, as conversions and backups do.
    onAir: () => streaming.inUse() || testOnAir,
  });
  void smartFolders.start();
  stops.add('smart playlists', () => {
    smartFolders.stop();
  });
  // ---- the drop folder (Session 28) ------------------------------------------------
  const dropFolder = new DropFolder({
    db: libraryDb,
    settings,
    dataDir: userDataDir,
    importFiles: async (paths, options) => {
      const result = await imports.start(paths, options);
      return result.ok ? { ok: true, runId: result.run.id } : { ok: false, message: result.message };
    },
    report: (runId) => importRepo.report(runId),
    onAir: () => streaming.inUse() || testOnAir,
    simpleMode: () => mode === 'simple',
    notice: (text) => {
      sendToOperator(IPC.app.notice, { text });
    },
    mediaChanged: () => {
      libraryChanged(true);
    },
    changed: (view) => {
      sendToOperator(IPC.drop.changed, view);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    now: () => Date.now(),
    scanMs: 10_000,
    settleMs: DROP_SETTLE_MS,
    watch: nodeWatch,
  });
  void dropFolder.start();
  stops.add('drop folder', () => {
    dropFolder.stop();
  });
  // After the computer sleeps, the folder may have changed with no word of it.
  powerMonitor.on('resume', () => {
    dropFolder.rescan();
  });
  const notDropOperator = {
    ok: false as const,
    message: 'Only the operator window can change the drop folder.',
  };
  handle(IPC.drop.view, () => dropFolder.view());
  handle(IPC.drop.pickFolder, async (e) => {
    if (!fromOperator(e) || !operatorWindow) return notDropOperator;
    const picked = await dialog.showOpenDialog(operatorWindow, {
      title: 'Drop Folder',
      message: 'Choose a folder: pictures and videos put in it are imported by themselves.',
      buttonLabel: 'Use This Folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    const folder = picked.canceled ? null : (picked.filePaths[0] ?? null);
    return folder === null ? null : dropFolder.setFolder(folder);
  });
  handle(IPC.drop.setOn, (e, on) =>
    fromOperator(e) && typeof on === 'boolean' ? dropFolder.setOn(on) : notDropOperator,
  );
  handle(IPC.drop.importAnyway, (e, name) =>
    fromOperator(e) ? dropFolder.importAnyway(name) : notDropOperator,
  );
  registerPlaylistIpc({
    repo: playlists,
    fromOperator,
    reads: windowReads,
    firstSlide: (presentationId) => slides.order(presentationId)?.slides[0]?.slide ?? null,
    changed: playlistsChanged,
    smart: {
      pickFolder: async () => {
        if (!operatorWindow) return null;
        const picked = await dialog.showOpenDialog(operatorWindow, {
          title: 'Smart Playlist from a Folder',
          message:
            'Choose a folder: what Drashti imports there, and in its folders, joins the playlist by itself.',
          buttonLabel: 'Follow This Folder',
          properties: ['openDirectory'],
        });
        return picked.canceled ? null : (picked.filePaths[0] ?? null);
      },
      create: (folder) => smartFolders.create(folder),
      views: () => smartFolders.views(),
      removeMissing: (playlistId) => smartFolders.removeMissing(playlistId),
      itemsRestored: (itemIds) => {
        smartFolders.itemsRestored(itemIds);
      },
      refresh: () => smartFolders.refresh(),
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
    return windowReads.read('presentation', () => playableDoc(parsed.data));
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
    // Sounds only: the Audio panel's Import (Session 44).
    const sounds = kind === 'sounds';
    const picked = await dialog.showOpenDialog(operatorWindow, {
      title: folder ? 'Import a folder' : sounds ? 'Import sounds' : 'Import files',
      buttonLabel: 'Import',
      properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'],
      ...(folder
        ? {}
        : {
            filters: [
              sounds
                ? { name: 'Sounds (MP3, M4A, WAV and more)', extensions: SOUND_EXTENSIONS }
                : {
                    name: 'Presentations, PDFs, PowerPoint, Keynote, pictures, videos, sounds and lyrics (text or Word)',
                    extensions: IMPORTABLE_EXTENSIONS,
                  },
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
  // Use this display and On (Session 50): a change that puts an output on a display asks Keep these screens?
  handle(IPC.screens.assignDisplay, (e, groupId, displayId, options) =>
    fromOperator(e)
      ? keepScreens.change(() => screens.assignDisplay(groupId, displayId, options))
      : notAllowed,
  );
  handle(IPC.screens.updateScreen, (e, id, patch, options) =>
    fromOperator(e) ? keepScreens.change(() => screens.updateScreen(id, patch, options)) : notAllowed,
  );
  handle(IPC.screens.uncoverOperator, (e) => {
    if (!fromOperator(e)) return notAllowed;
    uncover();
    return { ok: true as const, snapshot: screens.snapshot() };
  });
  // The stopped-screen notice's Try again (Session 26h): only a screen on this computer that the watchdog
  // gave up on, with its count starting afresh, as Screens' own Try again does. In Simple Mode too, and for
  // a volunteer: it changes nothing but brings a hall screen back.
  handle(IPC.screens.tryAgain, (e, screenId) => {
    if (!fromOperator(e)) return notAllowed;
    const sid = idSchema.safeParse(screenId);
    // A node's screen (Sessions 31–36): the node's own watchdog tries it again.
    const onNode = sid.success ? screenRepo.screen(sid.data)?.nodeId : null;
    if (sid.success && onNode) {
      const nodeStopped = nodes
        .screenStatus()
        .some((st) => st.screenId === sid.data && st.state === 'stopped');
      if (!nodeStopped) return { ok: false as const, message: 'That screen is not stopped now.' };
      log.info('Trying a stopped screen on a node again, as the operator asked');
      const sent = nodes.tryAgain(onNode, sid.data);
      return sent.ok ? { ok: true as const } : { ok: false as const, message: sent.message };
    }
    const win = sid.success ? outputWindows.get(sid.data) : undefined;
    const stopped =
      sid.success && manager.status().some((st) => st.screenId === sid.data && st.state === 'stopped');
    if (!win || win.isDestroyed() || !stopped)
      return { ok: false as const, message: 'That screen is not stopped now.' };
    log.info('Trying a stopped output again, as the operator asked from its notice');
    watchdog.retryNow(win.webContents, 'Try again');
    return { ok: true as const };
  });
  handle(IPC.screens.removeScreen, (e, id) => (fromOperator(e) ? screens.removeScreen(id) : notAllowed));
  // Audience and Stage (Session 50): an operator's (not an admin's), in Simple Mode only on.
  handle(IPC.screenSwitches.get, () => screenSwitches.get());
  handle(IPC.screenSwitches.turn, (e, which, on) =>
    fromOperator(e)
      ? screenSwitches.turn(which, on)
      : { ok: false as const, message: 'Only the operator window can turn the screens off or on.' },
  );
  screenSwitches.onChanged((switches) => {
    sendToOperator(IPC.screenSwitches.changed, switches);
    // The View menu's ticks, and a Remote's word on which are off.
    rebuildMenu();
    net.hint('screens');
  });
  // Keep these screens? (Session 50): answered in the operator window, by whoever made the change (in Simple Mode
  // too), or on the output over the controls (Enter keeps, Esc goes back).
  handle(IPC.screens.pending, (e) => (fromOperator(e) ? keepScreens.current() : null));
  handle(IPC.screens.keep, (e) => (fromOperator(e) ? keepScreens.keep() : notAllowed));
  handle(IPC.screens.goBack, (e) => (fromOperator(e) ? keepScreens.goBack() : notAllowed));
  handle(IPC.output.keepAnswer, (e, keep) => {
    const screenId = manager.screenIdFor(e.sender.id);
    // Only the output the question is on answers it, and only with a yes or a no.
    if (screenId === undefined || typeof keep !== 'boolean' || keepQuestionFor(screenId) === null)
      return null;
    log.info(`Keep these screens?: answered on the output over the controls (${keep ? 'Enter' : 'Esc'})`);
    // Once its answer has gone back to it: going back closes that very output.
    setImmediate(() => {
      if (keep) keepScreens.keep();
      else keepScreens.goBack();
    });
    return null;
  });
  handle(IPC.screens.identify, (e) => {
    if (!fromOperator(e)) return null;
    for (const [screenId, win] of outputWindows) {
      const s = screenRepo.screen(screenId);
      if (s) {
        sendToPage(win, IPC.output.identify, {
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
  handle(IPC.stream.setInputs, (e, camera, sound) =>
    fromOperator(e) ? streaming.setInputs(camera, sound) : notOperator,
  );
  handle(IPC.stream.removeProfile, (e, id) => (fromOperator(e) ? streaming.removeProfile(id) : notOperator));
  handle(IPC.stream.useProfile, (e, id) => (fromOperator(e) ? streaming.useProfile(id) : notOperator));
  handle(IPC.stream.setKey, (e, id, key, place) =>
    fromOperator(e) ? streaming.setKey(id, key, place) : notOperator,
  );
  handle(IPC.stream.removeKey, (e, id, place) =>
    fromOperator(e) ? streaming.removeKey(id, place) : notOperator,
  );
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
  // Open in Simple Mode and to every role, as a stopped hall screen's Try again is (Session 31).
  handle(IPC.stream.tryAgain, (e) => (fromOperator(e) ? streaming.tryAgainPage() : notOperator));
  handle(IPC.stream.pageContext, (e) => (streaming.isProgram(e.sender) ? streaming.context() : null));
  handle(IPC.stream.pageInputs, (e, inputs) => {
    streaming.reportInputs(e.sender, inputs);
    return null;
  });

  // ---- Show a Window… (Session 48) ------------------------------------------------
  const notOperatorWindow = 'Only the operator window can show another app’s window.';
  handle(IPC.liveWindow.list, (e) =>
    fromOperator(e)
      ? shownWindows.list()
      : { ok: false as const, reason: 'unlisted' as const, message: notOperatorWindow },
  );
  handle(IPC.liveWindow.show, (e, id) =>
    fromOperator(e) && typeof id === 'string'
      ? shownWindows.show(id)
      : { ok: false as const, message: notOperatorWindow },
  );
  handle(IPC.liveWindow.access, (e) => {
    if (fromOperator(e)) void shownWindows.askAccess();
    return null;
  });
  handle(IPC.liveWindow.status, () => shownWindows.current());

  // ---- picture in picture's remembered place (Session 50) --------------------------------------
  handle(IPC.pip.place, () => pipPlaces.place());
  // Locked in Simple Mode (simple-mode.ts); moving the box up remembers its place by itself (below).
  handle(IPC.pip.savePlace, (e, place) =>
    fromOperator(e)
      ? pipPlaces.save(place)
      : { ok: false as const, message: 'Only the operator window can change where the box goes.' },
  );
  engine.onChange((state) => {
    pipPlaces.follow(state);
  });
  handle(IPC.zoom.open, (e) => {
    if (fromOperator(e) && mode === 'pro') zoom.open();
    return null;
  });
  handle(IPC.zoom.program, (e) => (zoom.isZoomPage(e.sender) ? zoom.program() : null));
  // The screens' pages only: an output, the stream's page, and the operator window's pictures of them.
  const screenPage = (e: IpcMainInvokeEvent) =>
    fromOperator(e) || manager.screenIdFor(e.sender.id) !== undefined || streaming.isProgram(e.sender);
  handle(IPC.liveWindow.ask, (e, sourceId) =>
    screenPage(e) && typeof sourceId === 'string' ? shownWindows.ask(e.senderFrame, sourceId) : false,
  );
  handle(IPC.liveWindow.ended, (e, sourceId) => {
    if (screenPage(e) && typeof sourceId === 'string') shownWindows.ended(sourceId);
    return null;
  });

  // ---- video inputs (Session 50) ----------------------------------------------------------
  // Naming them: the operator window, Pro Mode (Simple Mode locks these channels; with roles on, an admin's).
  const notOperatorInputs = {
    ok: false as const,
    message: 'Only the operator window can change the video inputs.',
  };
  // The list: the operator window's Media, and every screen's page, which opens only an input listed here.
  handle(IPC.videoInputs.list, (e) => (screenPage(e) ? inputs.view() : { inputs: [] }));
  handle(IPC.videoInputs.add, (e, fields) => (fromOperator(e) ? inputs.add(fields) : notOperatorInputs));
  handle(IPC.videoInputs.update, (e, id, fields) =>
    fromOperator(e) ? inputs.update(id, fields) : notOperatorInputs,
  );
  handle(IPC.videoInputs.remove, (e, id) => (fromOperator(e) ? inputs.remove(id) : notOperatorInputs));
  // Whether Drashti may use the cameras; a Mac asks only from the operator window, in Pro Mode, after it said why.
  handle(IPC.videoInputs.access, () => inputs.access());
  handle(IPC.videoInputs.askAccess, (e) =>
    fromOperator(e) && mode === 'pro' ? inputs.askAccess() : inputs.access(),
  );
  handle(IPC.videoInputs.openSettings, async (e) => {
    if (fromOperator(e)) await inputs.openSettings();
    return null;
  });
  // How the input up now stands: said by the screens' pages drawing it (an output, the stream's page, the
  // operator window's LIVE picture); a page that closes is forgotten.
  const reportingPages = new Set<number>();
  handle(IPC.videoInputs.report, (e, report) => {
    if (!screenPage(e)) return null;
    const page = e.sender;
    const id = page.id;
    if (!reportingPages.has(id)) {
      reportingPages.add(id);
      page.once('destroyed', () => {
        reportingPages.delete(id);
        inputs.pageGone(id);
      });
    }
    inputs.report(id, report);
    return null;
  });
  handle(IPC.videoInputs.status, () => inputs.status());

  // ---- the setup wizard ----------------------------------------------------------
  // Tests start with it closed, unless a test is about it; the self-tests never open it (a dialog
  // would take the show's keys).
  const wizardOff = sw('DRASHTI_TEST_NO_WIZARD') === '1' || sw('DRASHTI_SELFTEST') !== undefined;
  handle(IPC.setup.state, () => ({
    // The wizard by itself on a first start: never for a volunteer either (Session 46: with roles on,
    // Drashti starts in Pro Mode as the operator, and the wizard's Finish is an admin's).
    firstRun:
      mode === 'pro' && !wizardOff && !roles.needsAdmin() && settings.get('setupWizard') === undefined,
    // The first start's welcome (Session 26g): once per library, before anything was set up; never for
    // a volunteer (roles on and the admin PIN not typed), never in Simple Mode or on a node.
    welcome:
      mode === 'pro' &&
      !wizardOff &&
      !roles.needsAdmin() &&
      settings.get('welcome') === undefined &&
      settings.get('setupWizard') === undefined,
    operatorDisplayId: operatorDisplayId(),
    // Session 44: the display the controls are on, windowed outputs or not, and whether to offer "Show on".
    controlsDisplayId:
      operatorWindow && !operatorWindow.isDestroyed()
        ? electronScreen.getDisplayMatching(operatorWindow.getBounds()).id
        : null,
    offer: mode === 'pro' && (!wizardOff || sw('DRASHTI_TEST_SCREEN_OFFER') === '1'),
  }));
  handle(IPC.setup.setSeen, (e) => {
    if (fromOperator(e)) settings.set('setupWizard', new Date().toISOString());
    return null;
  });
  handle(IPC.setup.welcomeSeen, (e) => {
    if (fromOperator(e)) {
      settings.set('welcome', new Date().toISOString());
      log.info('Setup: the first start’s welcome was answered');
    }
    return null;
  });
  // Simple Mode's first steps (Sessions 31–36): three, once per library, through channels Simple Mode allows
  // (the welcome's is locked there). Like the wizard, tests start without them unless a test is about them.
  handle(
    IPC.app.simpleFirstRun,
    (e) => fromOperator(e) && mode === 'simple' && !wizardOff && settings.get('simpleFirstRun') === undefined,
  );
  handle(IPC.app.simpleFirstRunSeen, (e) => {
    if (fromOperator(e) && settings.get('simpleFirstRun') === undefined) {
      settings.set('simpleFirstRun', new Date().toISOString());
      log.info('Simple Mode: its first steps were seen');
    }
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
    if (!fromOperator(e) || !parsed.success) return { ok: false };
    return { ok: sendToPage(audioWindow, IPC.audio.testTone, { deviceId: parsed.data?.id ?? '' }) };
  });
  handle(IPC.setup.finish, (e, rawPlan, options): SetupResult => {
    if (!fromOperator(e)) return { ok: false, message: 'Only the operator window can change the screens.' };
    const plan = setupPlanSchema.safeParse(rawPlan);
    if (!plan.success) return { ok: false, message: 'That setup cannot be applied.' };
    const { outputs, sound, themeId } = plan.data;
    if (themeId !== null && !themes.get(themeId))
      return { ok: false, message: 'That theme is no longer there.' };
    // The screens first: covering the operator's display asks before anything changes.
    if (outputs) {
      // Keep these screens? (Session 50): Go back puts back the screens only; the sound and theme stay as chosen.
      const applied = keepScreens.change(() => screens.applySetup(outputs, options));
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
      if (context) sendToPage(win, IPC.output.context, context);
    }
    log.info(
      `Setup finished: ${outputs ? `${outputs.length} display(s) set` : 'screens kept'}; sound ${sound === 'skip' ? 'kept' : 'chosen'}; theme ${themeId === null ? 'kept' : 'chosen'}`,
    );
    const snapshot = screens.snapshot();
    return { ok: true, snapshot, tested: snapshot.status.filter((st) => st.state === 'showing').length };
  });

  handle(IPC.output.getContext, (event) => {
    const screenId = manager.screenIdFor(event.sender.id);
    // Keep these screens? on an output over the controls that opened, or loaded again, as a change waits: sent
    // before the answer, so after the page listens for it (output-store.ts listens first).
    const question = screenId ? keepQuestionFor(screenId) : null;
    if (question && screenId) sendToPage(outputWindows.get(screenId), IPC.output.keepQuestion, question);
    return screenId ? contextFor(screenId) : null;
  });

  // ---- windows --------------------------------------------------------------
  const showingCount = () => manager.status().filter((st) => st.state === 'showing').length;
  /** Ask before anything that would black out the screens or end the stream. Returns true when it is fine to quit. */
  const confirmQuit = (): boolean => {
    if (!shouldConfirmQuit(showingCount(), quitConfirmed, noQuitConfirm, streaming.inUse())) return true;
    const parent = operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : undefined;
    const options = {
      type: 'warning' as const,
      buttons: ['Keep showing', 'Quit Drashti'],
      defaultId: 0,
      cancelId: 0,
      message: 'Quit Drashti?',
      detail: quitDetail(showingCount(), streaming.wanted()),
    };
    const choice = parent ? dialog.showMessageBoxSync(parent, options) : dialog.showMessageBoxSync(options);
    quitConfirmed = choice === 1;
    return quitConfirmed;
  };

  operatorWindow = createOperatorWindow(appearance.background());
  appearance.track(operatorWindow);
  operatorWindow.once('show', () => {
    log.info(phaseLine('operator window shown'));
  });
  watchdog.watch(operatorWindow.webContents, 'operator');
  // The audio player once the operator window has loaded (or after 5 s whatever happens). Created
  // first, Chromium 152 can hand the operator window the audio player's list of sound outputs.
  let audioStarted = false;
  const startAudioPlayer = () => {
    if (audioStarted || quitStarted) return;
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
    if (!confirmQuit()) {
      event.preventDefault();
      return;
    }
    // The quit goes ahead: no window may open now (the stream's page, the audio player), or the quit
    // stops (Session 23). Said in the log, with how long Drashti's own stops took (will-quit), so a slow
    // quit says whether Drashti or what came after was slow.
    if (!quitStarted) log.info('Quitting');
    quitStarted = true;
    streaming.quitting();
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
      // A library with none (Session 50): the self-test's own placeholder slides, in, and out again after.
      addPresentation: (doc) => {
        const id = presentations.insert({ libraryId: presentations.ensureLibrary('Default'), ...doc });
        libraryChanged(true);
        return id;
      },
      removePresentation: (id) => {
        for (const removed of presentations.remove([id])) slides.invalidate(removed);
        engine.refreshNext();
        libraryChanged(true);
      },
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

  /**
   * View › Audience or Stage, turning one off while its screens show something (Session 50): asked first, as the
   * window's switches and keys ask in the window. Never a box that holds the main process up: the show runs on.
   */
  const askSwitchOff = async (which: ScreenSwitch): Promise<boolean> => {
    const box = {
      type: 'question' as const,
      buttons: ['Cancel', 'Turn off'],
      defaultId: 0,
      cancelId: 0,
      message: `Turn ${SWITCH_NAMES[which]} off?`,
      detail: `${SWITCH_OFF_WORDS[which]} The show carries on.`,
    };
    const parent = operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : undefined;
    const answer = parent ? await dialog.showMessageBox(parent, box) : await dialog.showMessageBox(box);
    return answer.response === 1;
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
  // ---- View > Show Shastra, Templates and Kirtan Details (Session 26a) -----------------------------
  // Hidden, not deleted: their code, data and the remote's library stay; an admin brings them back.
  const extrasShown = () => settings.get('showExtras') === true;
  const setExtras = (on: boolean) => {
    settings.set('showExtras', on);
    log.info(`View: Shastra, Templates and Kirtan Details ${on ? 'shown' : 'hidden'}`);
    sendToOperator(IPC.library.extrasChanged, { on });
    rebuildMenu();
  };
  handle(IPC.library.extras, () => extrasShown());
  // ---- View > Show Safe Areas (Sessions 31–36): the slide editor's guides, anyone's to turn on ---------
  const safeAreasShown = () => settings.get('showSafeAreas') === true;
  handle(IPC.app.safeAreas, () => safeAreasShown());
  // ---- Single-letter keys (Session 37, WCAG 2.1.4): B, ., L and ? act unless an admin turned them off ----
  // Kept with the library's settings, as the switch in Help › Keyboard Shortcuts… sets them. Off, they do
  // nothing in the window in either mode (no menu item answers a single key); Black-out and the Logo work
  // from their buttons, a MIDI pad and the phone remote as before.
  // The operator window shows nothing until it knows this (Session 37), so it is always answered (Session 38):
  // a setting that cannot be read (a refused read of the library) answers on, the default, and the log says
  // why, once. Tests only (never a packaged Drashti): DRASHTI_TEST_SINGLE_KEYS_UNREADABLE makes the read fail.
  const singleKeysUnreadable = swOn('DRASHTI_TEST_SINGLE_KEYS_UNREADABLE');
  const singleKeysOn = readOrDefault(
    () => {
      if (singleKeysUnreadable) throw new Error('A test made this read of the library fail');
      return settings.get('singleLetterKeys') !== false;
    },
    true,
    (error) => {
      log.warn(
        `Keys: the single-letter keys setting could not be read, so they are on, as they are by default (${String(error)})`,
      );
    },
  );
  handle(IPC.app.singleKeys, () => singleKeysOn());
  // ---- Appearance (Sessions 39–40): anyone's to choose in Pro Mode (Simple Mode refuses it), per computer ----
  handle(IPC.appearance.view, () => appearance.view());
  handle(IPC.appearance.choose, (e, choice) => {
    if (!fromOperator(e) || typeof choice !== 'string')
      return { ok: false as const, message: 'Only the operator window can change the appearance.' };
    return appearance.choose(choice)
      ? { ok: true as const }
      : { ok: false as const, message: 'That appearance is no longer here: choose another.' };
  });
  // One's own (Session 40): made from a name, a base and an accent, every rule checked here again.
  handle(IPC.appearance.make, (e, fields) => {
    const parsed = ownFieldsSchema.safeParse(fields);
    if (!fromOperator(e) || !parsed.success)
      return { ok: false as const, message: 'Only the operator window can make an appearance.' };
    return appearance.make(parsed.data);
  });
  handle(IPC.appearance.remove, (e, id) => {
    if (!fromOperator(e) || typeof id !== 'string')
      return { ok: false as const, message: 'Only the operator window can delete an appearance.' };
    return appearance.remove(id)
      ? { ok: true as const }
      : { ok: false as const, message: 'Only an appearance of your own can be deleted.' };
  });
  // Interface motion (Session 40): Calm, Lively or Off, this computer's, as the appearance is.
  handle(IPC.appearance.setMotion, (e, motion) => {
    if (!fromOperator(e) || typeof motion !== 'string')
      return { ok: false as const, message: 'Only the operator window can change the interface motion.' };
    return appearance.setMotion(motion)
      ? { ok: true as const }
      : { ok: false as const, message: 'Choose Calm, Lively or Off.' };
  });
  // The menu's ticks follow the appearance shown (Follow the computer's changes too).
  appearance.onChanged(() => {
    rebuildMenu();
  });
  handle(IPC.app.setSingleKeys, (e, on) => {
    if (!fromOperator(e) || typeof on !== 'boolean')
      return { ok: false as const, message: 'Only the operator window can change the keys.' };
    settings.set('singleLetterKeys', on);
    log.info(`Keys: the single-letter keys (${SINGLE_KEYS_TEXT}) ${on ? 'on' : 'off'}`);
    sendToOperator(IPC.app.singleKeysChanged, { on });
    return { ok: true as const, on };
  });
  handle(IPC.library.setExtras, (e, on) => {
    if (!fromOperator(e) || typeof on !== 'boolean')
      return { ok: false as const, message: 'Only the operator window can change what it shows.' };
    setExtras(on);
    return { ok: true as const, on };
  });
  const menuActions = (): Parameters<typeof installMenu>[0] => ({
    mode,
    switchMode,
    setUpScreens: () => {
      if (mode === 'pro')
        requireAdmin('change the screens', () => {
          sendToOperator(IPC.setup.open, { at: Date.now() });
        });
    },
    // An operator's: no PIN asked (Session 48).
    zoomWindow: () => {
      if (mode === 'pro') zoom.open();
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
    importFromLink: () => {
      if (mode === 'pro')
        requireAdmin('import from a link', () => {
          sendToOperator(IPC.links.open, { at: Date.now() });
        });
    },
    rolesAndPins: () => {
      if (mode === 'pro') sendToOperator(IPC.roles.open, { at: Date.now() });
    },
    scheduledBackups: () => {
      if (mode === 'pro') sendToOperator(IPC.backups.open, { at: Date.now() });
    },
    eventsOut: () => {
      if (mode === 'pro')
        requireAdmin('set up events out', () => {
          sendToOperator(IPC.events.open, { at: Date.now() });
        });
    },
    dropFolder: () => {
      if (mode === 'pro')
        requireAdmin('set up the drop folder', () => {
          sendToOperator(IPC.drop.open, { at: Date.now() });
        });
    },
    checkForUpdates: () => {
      if (mode === 'pro') sendToOperator(IPC.updates.open, { at: Date.now() });
    },
    keyboardShortcuts: () => {
      if (mode === 'pro') sendToOperator(IPC.app.showKeys, { at: Date.now() });
    },
    guides: () => {
      sendToOperator(IPC.app.showGuides, { at: Date.now() });
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
    extras: {
      shown: extrasShown(),
      toggle: () => {
        // The tick follows the setting, not the click, until an admin has said so.
        rebuildMenu();
        if (mode === 'pro')
          requireAdmin('show or hide Shastra, Templates and Kirtan Details', () => {
            setExtras(!extrasShown());
          });
      },
    },
    safeAreas: {
      shown: safeAreasShown(),
      toggle: () => {
        const on = !safeAreasShown();
        settings.set('showSafeAreas', on);
        sendToOperator(IPC.app.safeAreasChanged, { on });
        rebuildMenu();
      },
    },
    // View › Appearance (Sessions 39–40): Pro Mode only, anyone's; the choice is this computer's.
    appearance: {
      choices: [
        { id: FOLLOW, label: 'Follow the Computer' },
        ...appearance.list().map((a) => ({ id: a.id, label: a.name })),
      ],
      chosen: appearance.choice,
      choose: (id) => {
        if (mode === 'pro') appearance.choose(id);
      },
      open: () => {
        if (mode === 'pro') sendToOperator(IPC.appearance.open, { at: Date.now() });
      },
    },
    // View › Audience and Stage (Session 50): Pro Mode's, an operator's. The tick follows the switch, not the
    // click, until it changes (a question answered Cancel leaves it as it was).
    screenSwitches: {
      on: screenSwitches.get(),
      toggle: (which) => {
        rebuildMenu();
        if (mode === 'pro') void screenSwitches.toggle(which, askSwitchOff);
      },
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
      void (async () => {
        try {
          const crash = await chooseCrashFiles();
          if (!crash) return;
          const file = saveDiagnostics(app.getPath('desktop'), {
            app: appInfo(),
            displays: listDisplays(),
            screens: screens.snapshot(),
            sound: audioOutput.status,
            db: libraryDb,
            watchdog: watchdogHistory,
            crashJournal: crashJournal.entries(),
            crashFiles: crash,
            logFiles: logFiles(),
            now: new Date(),
          });
          log.info(`Diagnostics saved to the Desktop${crash.included ? ', with the crash files' : ''}`);
          sendToOperator(IPC.app.notice, { text: savedDiagnosticsText(file, crash) });
        } catch (error) {
          log.error('Could not save diagnostics', error);
          sendToOperator(IPC.app.notice, {
            text: 'Could not save diagnostics: see the log in the data folder.',
          });
        }
      })();
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
            appearance.track(openGalleryWindow(appearance.background()));
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
  /** The self-tests end on purpose: a clean quit (the stop list's last step), so the next start does not put their slides back. */
  const exitSelfTest = (code: number) => {
    // A self-test's end is not the quit an update waits for.
    updates.holdForNextQuit();
    exitNow(code);
  };
  if (perfTest) {
    operatorWindow.webContents.once('did-finish-load', () => {
      void runPerformanceTestWithScenario({
        operator: () => (operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : null),
        outputs: () => [...outputWindows.values()].filter((w) => !w.isDestroyed()),
        // Three outputs for that scenario (windowed, with two extra displays, on a runner).
        // Two for live-window (Session 48: a window on two outputs and the stream).
        ensureOutput: () =>
          ensureTestOutput(
            'Performance test',
            perfScenario === 'three-outputs' ? 3 : perfScenario === 'live-window' ? 2 : 1,
          ),
        workerRunning: () =>
          app.getAppMetrics().some((m) => m.type === 'Utility' && m.name === 'Drashti import'),
        diagnostics: { loopDelay, handlerTimes, gc },
        stream: streaming,
        network: net,
        nodes,
        library: {
          db: libraryDb,
          mediaDir,
          sharpened: async () => {
            await sharpened.refresh();
            await sharpened.idle();
          },
        },
        operatorContents: () =>
          operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow.webContents : null,
        music,
        engine,
        setMovement: (movement) => {
          const lookId = engine.current.look.id;
          for (const g of screens.snapshot().groups) looks.setGroup(lookId, g.id, { movement });
        },
        zoom: {
          open: () => {
            zoom.open();
          },
        },
        // live-window (Session 48): the placeholder meeting, offered by the stand-in, chosen and shown.
        showPlaceholderWindow: async () => {
          if (!windowStandIn) return false;
          await openPlaceholderMeeting();
          const list = await shownWindows.list();
          const offered = list.ok ? list.windows.find((w) => w.name === PLACEHOLDER_MEETING) : undefined;
          return offered ? shownWindows.show(offered.id).ok : false;
        },
        program: () => {
          const contents = streaming.programContents();
          return contents ? { webContents: contents } : null;
        },
        ffmpegPath: () =>
          findFfmpeg({
            packaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            appPath: app.getAppPath(),
            platform: process.platform,
            arch: process.arch,
            override: sw('DRASHTI_FFMPEG'),
          }),
        cpu: () => app.getAppMetrics().reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0),
        priority: {
          started: startedPriority,
          others: () =>
            describePriorities(
              app
                .getAppMetrics()
                .filter((m) => m.type !== 'Browser')
                .map((m) => m.pid),
            ),
        },
        ...(perfWatch ? { watch: perfWatch } : {}),
        ...(perfProfileDir ? { profile: new PerfProfile(perfProfileDir) } : {}),
        ...(perfNoImport ? { noImportMs: 20_000 } : {}),
        ...(perfEdits ? { edits: true, wayStats: () => ({ ...(importer?.wayStats ?? {}) }) } : {}),
        ...(perfSongs > 0 ? { songs: perfSongs } : {}),
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
  const relaunchWorkDir = sw('DRASHTI_SELFTEST_DIR');
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
        add: (name) => {
          presentations.insert({
            libraryId: presentations.ensureLibrary('Default'),
            name,
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

  // Made before any service, so stopped after them all (lifecycle.ts).
  stops.add('shortcuts', () => {
    globalShortcut.unregisterAll();
  });
  stops.add('sleep guard', () => {
    sleepGuard.release();
  });
  app.on('will-quit', () => {
    const started = performance.now();
    stops.run();
    log.info(`Quit: Drashti's own stops took ${String(Math.round(performance.now() - started))} ms`);
  });
}
