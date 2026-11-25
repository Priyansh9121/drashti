import { editPlan } from './convert/edit-plan';
import { editedClipSource } from './convert/clip-edited-source';
import { withSceneMarkers } from './convert/scene-marker-save';
import { VideoEditsRepo } from './db/video-edits';
import { prepareVideoEdits } from './engine/video-edit-ready';
import { prepareVideoProxies } from './convert/proxy-showing';
import { registerEditVideoIpc } from './convert/edit-video-ipc';

import { registerVideoCopies } from './convert/video-copies-ipc';
import { VideoAnalysisService } from './convert/video-analysis';
import { EditService } from './convert/edit-service';
import { registerEditedFile } from './convert/edit-files';
import { videoEditTimes } from '../shared/video-edit-time';
import { soundForEditedVideo } from '../shared/video-edit-sound';
import { type PlaybackSettings, playbackSettingsSchema, toneOf } from '../shared/playback-settings';
import { shapeOverride } from '../shared/video-shape';
import { fileProblem } from './plain-errors';
import { importM3u, M3uError, writeM3u, type M3uExportRow } from './playlists/m3u';
import { playlistPlayOptionsSchema } from '../shared/playlist-playback';
import type { M3uResult, M3uNotTaken } from '../shared/m3u';
import { itemsMadeBy } from '../shared/import-items';
import { isInside } from './media/contained';
import type { IpcMainInvokeEvent, Rectangle } from 'electron';
import {
  app,
  autoUpdater,
  BrowserWindow,
  clipboard,
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
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, promises as fsPromises } from 'node:fs';
import { release as osRelease, tmpdir } from 'node:os';
import { monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { AppInfo } from '../shared/app-info';
import type { SpeechLanguage } from '../shared/speech';
import { formatBytes, formatClock } from '../shared/format';
import type { ImportOptions, ImportResult } from '../shared/import';
import { loadedBooks } from '../shared/import';
import { type LibraryChange, listedKirtan, type NewFromWordsResult } from '../shared/library';
import { importOptionsSchema, importPathsSchema, runIdSchema } from '../shared/import-schema';
import { type EventChannel, type EventContract, IPC } from '../shared/ipc';
import { acceleratorFor, SINGLE_KEYS_TEXT } from '../shared/keymap';
import {
  blurMediaId,
  blurOfId,
  copyMediaId,
  copyOfId,
  displayMediaId,
  displayOfId,
  IMAGE_FILE_FILTER,
  MEDIA_ID_PATTERN,
  MEDIA_SCHEME,
} from '../shared/media';
import { NOT_USED } from '../shared/media-removal';
import { mediaUpNow } from '../shared/node-media';
import { MediaRemoval, sweepQuiet, trashedTrimsNotice, TrimCleanup } from './library/media-removal';
import { hashOffMain } from './library/hash-off-main';
import { FileActions } from './library/file-actions';
import {
  extOf,
  importableExtensions,
  mediaKindOf,
  simpleImportExtensions,
  SOUND_EXTENSIONS,
} from './import/scan';
import { addToFolderParts, freeName, makeFolderPlaylist } from './playlists/folder-playlist';
import { syncFolderAudios } from './music/folder-audios';
import { idSchema } from '../shared/model-schema';
import { z } from 'zod';
import type { OutputContext, ScreensSaid } from '../shared/screens';
import { missingFontsIn } from '../shared/screens';
import { drawnGeometry } from '../shared/screen-geometry';
import { NO_STAGE_SCREEN, type ScreenSwitch, switchFor } from '../shared/screen-switches';
import type { MessageResult } from '../shared/messages';
import { keptTemplateSchema, messageTemplateSchema } from '../shared/messages';
import type { TimerResult } from '../shared/timers';
import { timerFieldsSchema } from '../shared/timers';
import { startCountdownFields, startTimeGone } from '../shared/audience-timer';
import { START_COUNTDOWN_NAME, startTimeSchema } from '../shared/timer-look';
import type { RecoveryNotice } from '../shared/recovery';
import { audioDeviceSchema } from '../shared/audio';
import type { SetupResult } from '../shared/setup';
import { setupPlanSchema } from '../shared/setup';
import type { ModeResult, OperatorMode } from '../shared/mode';
import { isOperatorMode, simpleModeRefuses, simplePhoneRefusalText, simpleRefusalText } from '../shared/mode';
import { ModeKeeper } from './mode-keeper';
import { SimpleFeaturesKeeper } from './simple-features';
import type { SimpleFeature } from '../shared/simple-features';
import { SimplePlaylist, simplePlaylistName } from './simple-playlist';
import type { SimplePhoneScope } from './simple-mode-phones';
import { groupLookIn, type Movement, NO_LOOK } from '../shared/looks';
import { hallPicture, type StageLayout } from '../shared/stage-layouts';
import { DEFAULT_THEME } from '../shared/themes';
import type { SlideSource } from './engine/slide-source';
import type { Db } from './db/database';
import { LATEST_VERSION, leaveCopyingToImports, LIBRARY_BUSY_TIMEOUT_MS, openDatabase } from './db/database';
import { ImportRepo } from './db/imports';
import { carryInputName } from './db/input-renames';
import { MediaRepo } from './db/media';
import { PlaylistRepo } from './db/playlists';
import { SearchIndex } from './db/search';
import { TimerRepo } from './db/timers';
import { ThemeRepo } from './db/themes';
import { ShastraRepo } from './db/shastra';
import { ShastraService } from './shastra/shastra-service';
import { isPassageId, passageIdSchema, referenceInputSchema, shastraSearchSchema } from '../shared/shastra';
import { FIT_EVERYWHERE, type FitTargets, fitTargets } from '../shared/shastra-slides';
import { MessageRepo } from './db/messages';
import { SettingsRepo } from './db/settings';
import { DbSlideSource, PresentationRepo } from './db/presentations';
import { ScreenRepo } from './db/screens';
import { LookRepo } from './db/looks';
import { LookService } from './looks/look-service';
import { StageLayoutRepo } from './db/stage-layouts';
import { StageLayoutService } from './stage/stage-layout-service';
import { anyTestSwitch, packaged, sw, swMs, swOn } from './switches';
import {
  CHROMIUM_FAKE_DEVICES,
  CHROMIUM_FAKE_SOUND_FILE,
  fakeMediaSelfTest,
  fakeSoundFeatures,
  fakeSoundSwitch,
} from './fake-sound';
import { CalendarRepo } from './db/calendar';
import { CalendarService } from './calendar/calendar-service';
import { QuoteRepo } from './db/quotes';
import { oldIdleRotation, QuoteOfTheDay } from './idle/idle-service';
import { registerWallpapers } from './wallpapers/wallpaper-ipc';
import type { WallpaperService } from './wallpapers/wallpaper-service';
import { calendarIdSchema } from '../shared/calendar';
import { AudioPlaylistRepo } from './db/audio-playlists';
import { LowerThirdRepo } from './db/lower-thirds';
import { handleStudio, LowerThirdsStudio } from './lower-thirds/studio-window';
import { hallScreenOf, livePictureOf, StudioLive } from './lower-thirds/studio-live';
import { handleSlideEditor, SlideEditorWindow } from './library/slide-editor-window';
import { MusicService } from './music/music-service';
import { startPerfMusic, startPerfSoundCue } from './music/perf-music';
import { musicPlaySchema } from '../shared/music';
import type { MediaMarkers } from '../shared/markers';
import { mediaMarkersInputSchema, NO_MARKERS } from '../shared/markers';
import { evenGainDb, type SoundLevelsResult } from '../shared/sound';
import { UpdateService } from './update/update-service';
import { defaultInstaller } from './update/installer';
import { UPDATE_BASE } from '../shared/updates';
import { lowerThirdInputSchema } from '../shared/lower-thirds';
import {
  type MidiLearnable,
  type MidiSeen,
  midiSeenSchema,
  midiSettingsNow,
  midiSettingsSchema,
} from '../shared/midi';
import { seedLibrary, seedOptions } from './db/seed';
import { removeUntouchedPlaceholders } from './library/placeholders';
import { ShowEngine } from './engine/show-engine';
import { runEngineCommand } from './ipc/engine-ipc';
import {
  handle,
  handlerTimes,
  handleSync,
  hearHandled,
  lockChannels,
  refusalFor,
  setGiveWay,
  tellRequests,
} from './ipc/handle';
import { readOrDefault } from './ipc/read-or-default';
import { MainWatch, PerfProfile, watchedMedia } from './perf-watch';
import { LockWatch } from './perf-lock';
import { isPerfScenario, scenarioFor } from './perf-scenarios';
import { LaterWrites } from './db/later-writes';
import { SoundRepo } from './db/sound';
import { SoundLevelsKeeper } from './sound/levels';
import { SoundPass } from './sound/sound-pass';
import { automaticImportNotices, loadsOperatorPageAgain } from './import/automatic-notices';
import { ImportService } from './import/import-service';
import { spawnImportWorker } from './import/spawn-worker';
import { clearDeckLeftovers, OfficeCopies, officeCopiesFile } from './import/deck/leftovers';
import { deckAppsOf, readDeckAnimations, writeDeckAnimations } from './import/deck/deck-setting';
import { LinkService } from './links/link-service';
import { libraryProblem } from './library-problem';
import { parsePlain } from '../shared/plain-parse';
import { DEFAULT_LINK_MAX_HEIGHT, isLinkHeight } from '../shared/links';
import { spawnDownloadWorker } from './links/spawn-worker';
import { AudioOutput } from './audio/audio-output';
import { CrashJournal, childGoneWords, JOURNAL_FILE, journalNotice, watchdogJournal } from './crash-journal';
import { GPU_STOPPED_TWICE, GpuStops } from './gpu-stops';
import { crashFiles, KEEP_CRASH_FILES, keepNewestCrashFiles, startCrashReporter } from './crash-files';
import { type CrashFilesChoice, type GraphicsInfo, libraryNames, writeDiagnosticsFile } from './diagnostics';
import { log, logDays, logFilesOf, onLogDaysChanged, setLogHeader, startLogCopy, startLogFile } from './log';
import { CommandLog, requestLogged } from './log-commands';
import { type DiagnosticsWho, installId } from './log-who';
import { type LogPeriod, periodDays, periodText } from '../shared/log-period';
import { computerName } from './access/identity';
import {
  cannotPlayNotice,
  cannotStartInTimeNotice,
  NO_FIRST_FRAME,
  NO_START_IN_TIME,
  noPictureNotice,
} from '../shared/no-picture';
import {
  CannotPlay,
  type CannotPlayWhere,
  errorKindWords,
  NodeCannotPlay,
  whereWords,
} from './media/cannot-play';
import { phaseLine, windowStartLine } from './start-phases';
import { parseStartMarks } from '../shared/start-marks';
import { heapAfterCollection } from './heap-after-gc';
import { LiveStateWriter, startupRecovery, type StartupRecovery } from './recovery/live-state';
import {
  handleMediaRequest,
  MEDIA_SCHEME_PRIVILEGES,
  mediaRequestOf,
  openingCopyPath,
} from './media/media-protocol';
import { openingPhotoPlace, openingPhotoThere } from './opening/opening-photo';
import { OpeningService } from './opening/opening-service';
import { OpeningKeys } from './opening/opening-start';
import { MediaDetailsService } from './media/media-details';
import { PlayHistory } from './media/play-history';
import { editedPlayHistory } from './media/edit-play-history';
import { editedSoundSettings } from './media/edit-sound-settings';
import { takeSnapshot } from './media/snapshot';
import { playingSchema } from '../shared/engine/playing';
import { saveStill } from './media/stills';
import { SharpenedCopies } from './media/sharpened';
import { DisplayCopies } from './media/display-copies';
import { DisplayBlobFiles } from './pictures/display-blob-file';
import { handleDisplaySourceRequest } from './media/display-worker-source';
import { DEFAULT_DISPLAY_SIZE } from '../shared/picture-display';
import { BlurredCopies, ffmpegBlurRun } from './media/blurred';
import { pictureCannotSeeThrough } from './media/see-through';
import { savedName, savePicture, savesAsJpeg } from './media/save-picture';
import { installLockedMenu, installMenu, installNodeMenu } from './menu';
import { choiceGuard, REPEAT_CHOICE_MS } from './shown-keys';
import { runPerformanceTest, seedPerfLibrary } from './perftest';
import { type PlaylistChanges, registerPlaylistIpc } from './playlists/playlist-ipc';
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
import { audienceScreenSizes, type LocalOutput } from './media/copy-screen';
import { TrimSaves } from './convert/trim-saves';
import { rowTrimRequestSchema, saveRequestSchema, trimSavedNotice } from '../shared/trim';
import { TrimmedVideos } from './db/trimmed';
import { PlaylistTrims } from './convert/playlist-trims';
import { TRIM_RECORDS_FILE, TrimRecords } from './convert/trim-records';
import { queueTrimCopy, readTrimInfo } from './convert/trim-copy';
import { exportMediaFile } from './convert/export-file';
import { frameAtOrBefore } from './convert/frame-at';
import { isRepeatId, repeatPresentationId } from '../shared/repeat';
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
import { registerWordsIpc } from './library/words-ipc';
import { READING_PAGE } from './ocr/read-words';
import { registerReadWordsIpc } from './ocr/read-words-ipc';
import { startReader } from './ocr/reader-process';
import { builtOcrFiles } from './ocr/ocr-files';
import { ocrSelfTest } from './ocr/ocr-selftest';
import { READ_WORDS_PICTURES } from '../shared/read-words';
import { KirtanBundleExporter } from './import/kirtan-bundle-export-service';
import { registerKirtanBundleIpc } from './library/kirtan-bundle-ipc';
import { registerKirtansIpc } from './library/kirtans-ipc';
import { runRelaunchSelfTest } from './relaunch-selftest';
import { createdGroupId, runWatchdogSelfTest, type SelfTestResult } from './selftest';
import {
  SIMPLE_MODE_BOUNDED,
  SIMPLE_MODE_LOCKED,
  type SimpleScope,
  aPlaylistsPresentation,
  simpleModeBounds,
  simpleModeRefusals,
} from './simple-mode';
import { applyPriority, describePriorities, describePriority, readPriority, writePriority } from './priority';
import { whenFree, writeLockFree } from './db/write-lock';
import { writeOldLibrary } from './old-library-selftest';
import {
  createOutputWindow,
  createStagePreviewWindow,
  EXTRA_DISPLAY_ID,
  electronDisplays,
  listDisplays,
  pretendDisplaysChanged,
  setDisplayIdentities,
  setExtraDisplays,
  changeExtraDisplays,
  showDisplayNumber,
  watchDisplays,
} from './outputs/electron-outputs';
import { DisplayIds, standInReader, systemReader } from './outputs/display-ids';
import { AutoScreens, NotUsedDisplays } from './outputs/auto-screens';
import {
  type ControlsPlace,
  controlsToPutBack,
  COULD_NOT_GO_BACK,
  coveringScreens,
  KeepScreens,
} from './outputs/keep-screens';
import { placeOperator } from './outputs/operator-guard';
import { DISPLAY_DROP_MS, OutputManager } from './outputs/output-manager';
import { ScreensService } from './outputs/screens-service';
import type { ScreensSetup } from './outputs/screens-setup';
import { afterStop, WaitingFile } from './outputs/screens-setup';
import { ScreenSwitchService, SwitchQuestion, switchOffBox } from './outputs/screen-switches';
import { revealPreview } from './outputs/stage-preview';
import { keepStage, STAGE_SETTING, stageStartsOn } from './outputs/stage-switch-setting';
import { coverBox } from './network/desktop-consent';
import type { DesktopLibrary } from './network/desktop-answers';
import { cameraNamesIn } from '../shared/network-desktop';
import { SleepGuard } from './outputs/sleep-guard';
import { IpcTransport } from './transport/ipc-transport';
import { AUDIO_PARTITION, createAudioWindow } from './windows/audio-window';
import { createPicturesWindow } from './pictures/pictures-window';
import { createSharpenWindow, pictureWorkerPriority } from './pictures/sharpen-window';
import { PdfPictures, pictureSize } from './pictures/pdf-pictures';
import { sourceReader } from './documents/source-reader';
import { SourceReaderQueue } from './documents/source-reader-queue';
import { pptxReader } from './documents/pptx-reader-service';
import { spawnPptxReaderWorker } from './documents/spawn-pptx-reader-worker';
import { sourceWrite } from './documents/source-write';
import { SourceQuitGate } from './documents/source-quit-gate';
import { PdfPrintGeometry } from './documents/pdf-geometry-service';
import { systemFontFamilies } from './documents/system-fonts';
import { PdfCopySession } from './library/pdf-copy-session';
import { capturedPixelOrder } from './library/pixel-order';
import { PdfEditor } from './library/pdf-editor';
import { createPdfCopyWindow } from './library/pdf-copy-window';
import { openGalleryWindow } from './windows/gallery-window';
import { AppearanceService } from './appearance/appearance-service';
import { ownSchema } from './appearance/appearance-file';
import { familyOf, FOLLOW } from '../shared/appearance/appearances';
import { createOperatorWindow } from './windows/operator-window';
import { StopList, stopTimes } from './lifecycle';
import { hearRenderErrors } from './render-errors-ipc';
import { CHECK_EVERY_MS, OPEN_GRACE_MS, OutputHeartbeat, REPORT_STALE_MS } from './outputs/heartbeat';
import {
  quitDetail,
  RendererWatchdog,
  shouldConfirmQuit,
  watchdogLine,
  whyText,
  type WatchdogEvent,
  type WatchTarget,
} from './watchdog';
import { filesUp, KeepsFailing, keptFailingNotice, stillUpOn } from './keeps-failing';
import { allowHangStacks, applySessionSecurity, secureWebContents } from './windows/security';
import { StreamProfileRepo } from './db/stream-profiles';
import { StreamKeyStore } from './stream/key-store';
import { YOUTUBE_WORDS } from '../shared/youtube';
import { electronGoogleTransport } from './youtube/electron-google-transport';
import { GOOGLE_ENDPOINTS, standInEndpoints } from './youtube/google-transport';
import { YouTubeService } from './youtube/youtube-service';
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
import { OPENING_MS, OPENING_START_HOLD_MS } from '../shared/opening';
import { applyStreamSessionSecurity, createProgramWindow, STREAM_PARTITION } from './stream/program-window';
import { createStreamSoundWindow } from './stream/stream-sound-window';
import { StreamPageWarmUp } from './stream/stream-warm';
import { LiveWindowService } from './live-window/live-window-service';
import { LiveLinkService } from './live-link/live-link-service';
import { localPlaylist, localProgress, startRelay } from './live-link/relay-process';
import { fetchPlaylist } from './live-link/fetch-playlist';
import { lookYoutube } from './live-link/youtube-look';
import { electronWindowSources } from './live-window/electron-sources';
import { standInWindowSources } from './live-window/stand-in-sources';
import { applyCaptureRules } from './live-window/capture-rules';
import { PipPlaces } from './pip/pip-places';
import { VideoInputsService } from './video-inputs/video-inputs-service';
import { electronCamera } from './video-inputs/electron-camera';
import { ZoomWindow } from './stream/zoom-window';
import { videoOutSender } from './video-out/sender';
import { spawnVideoOutWorker, videoOutChannel } from './video-out/spawn';
import { VideoOutService } from './video-out/video-out-service';
import { startAccessList } from './access/access-list-main';
import { openPlaceholderMeeting, PLACEHOLDER_MEETING } from './live-window/placeholder';
import { StreamService } from './stream/stream-service';
import { onFat } from './stream/recording-drive';
import { Leftovers, leftoversFile } from './system/leftovers';
import { runPowerShell } from './system/powershell';
import { type ReadyDeps, readyReport } from './ready/ready-facts';
import type { ReadyOutput } from '../shared/ready';
import {
  QUICK_BAR_MAX,
  type QuickBarResult,
  type QuickPin,
  quickPinsSchema,
  readQuickBar,
} from '../shared/quick-bar';
import { QR_TEXT_MAX, qrSlideName, qrSlidePresentation, qrWords } from './library/qr-slide';
import { pageSlidePresentation } from './library/page-slide';
import type { MadeSlidePlace, MakeSlideResult, SlidePlace } from '../shared/page-part';
import { QrService } from './library/qr-service';
import { runQrJob } from './library/qr-worker-run';
import { nfc } from '../shared/nfc';
import { GuideFiles, guidesDir } from './guides';
import { ManualPrinter, readManual } from './manual-service';
import { RunningOrderPrinter, runningOrderLines } from './running-order';
import { printWaits } from '../shared/print-waits';
import { WordsPrinter } from './words-print';
import { isReportId, readReportDraft } from '../shared/report';
import { type HeldPicture, ReportService } from './report/report-service';
import { ErrorReports } from './error-reports/service';
import { ErrorReportRuntime } from './error-reports/runtime';
import { automaticIdentity } from './error-reports/identity';
import { manageErrorReports } from './error-reports/admin';
import { sendErrorReport } from './error-reports/transport';
import { electronTransport as errorReportTransport } from './access/electron-transport';
import { AccessStore as ErrorReportAccessStore } from './access/store';
import { runDiagnosticsText, runReportIntake, runReportJob } from './report/report-worker-run';
import { GUIDES, guideIdSchema, type GuideRead } from '../shared/guides';
import { watchLoadFailures } from './outputs/load-failures';
import {
  followOutputs,
  WarmUpChoices,
  warmUpEndLine,
  warmUpEndOf,
  warmUpFact,
  warmsUp,
} from './outputs/warm-up-choice';
import { findFfmpeg } from './stream/ffmpeg-path';
import { ffmpegSelfTest } from './stream/ffmpeg-selftest';
import { youtubeSelfTest } from './links/youtube-selftest';
import { findYoutubeTools, toolFolders, youtubeLaunch } from './links/youtube-tools';
import { spawnStreamWorker } from './stream/stream-worker';
import { AFTER_START_MS, ConvertService, readInfo } from './convert/convert-service';
import { HevcAnswer, hevcKindsScript, playsHevcScript } from './convert/plays-hevc';
import { askInOwnPage, type HevcPage } from './convert/hevc-page';
import { transitionsEndAt } from '../shared/engine/transitions-running';
import { diskFreeBytes, UPLOADS_DIR } from './import/media-store';
import { startPerfStream } from './stream/perf-stream';
import { confirmedSchema } from '../shared/stream-schema';
import type { StreamStatus } from '../shared/stream';
import type { FrameGrid } from '../shared/video-cue';
import { FanoutTransport, type EngineTransport } from '../shared/engine/transport';
import { stateWithoutCaptions, withoutCaptions } from '../shared/engine/captions-filter';
import { CaptionsService } from './speech/captions-service';
import { CaptionCoordinator } from './speech/caption-coordinator';
import { ownModelCaptionAi } from './speech/caption-routes';
import { registerCaptionPrototypeIpc } from './speech/caption-prototype-ipc';
import { createWhisperEngine } from './speech/whisper-engine';
import { createStandInEngine } from './speech/stand-in-engine';
import { findWhisper, whisperProblem } from './speech/engine-place';
import { downloadModel, MODEL_SOURCES, modelFile, modelReady } from './speech/models';
import { knownLanguageModels } from './speech/language-models';
import { packFileFor, packLanguageModelStore } from './speech/pack-language-models';
import { createWhisperRoute } from './speech/whisper-route';
import { createIndicRoute } from './speech/indic-route';
import { handleModelPacks } from './model-packs/ipc';
import { findTranslateHelper } from './translation/helper-place';
import { handleTranslation } from './translation/ipc';
import { TranslationEngine } from './translation/translation-engine';
import { StandInTranslator } from '../shared/prepared-translations';
import { ModelPackStore } from './model-packs/store';
import { whisperSelfTest } from './speech/whisper-selftest';
import { findIndic, indicProblem } from './speech/indic-place';
import { indicSelfTest } from './speech/indic-selftest';
import windowsRuntimeLibraries from '../shared/whisper-windows-runtime.json';
import { CaptionSettingsRepo } from './db/captions';
import { CaptionWordsRepo } from './db/caption-words';
import { CAPTION_HINTS_ON } from '../shared/caption-words';
import { CaptionWordsService } from './speech/caption-words-service';
import { VideoCaptionsRepo } from './db/video-captions';
import { CaptionFileReader } from './video-captions/reader';
import { registerVideoCaptionIpc } from './video-captions/ipc';
import {
  isCaptionModel,
  isLanguageModelLanguage,
  parseCaptionSettings,
  parseCaptionTiming,
} from '../shared/captions';
import { type EngineState, nothingUp, rowVideoLive } from '../shared/engine/state';
import { saveWaitsFor } from '../shared/save-waits';
import { DeviceRepo } from './db/devices';
import { NetworkService } from './network/network-service';
import { OscService } from './osc/service';
import { captureWithShowAbort } from './network/slide-picture';
import { PhoneFiles } from './network/phone-files';
import { AnnouncementService } from './network/announcement-service';
import { AnnouncementRepo } from './db/announcements';
import { inProcessNetworkWorker, spawnNetworkWorker } from './network/network-worker';
import { startPerfDevices } from './network/perf-devices';
import { localName } from './network/local-name';
import { localInterfaceAddresses } from './network/addresses';
import { previewSource } from './network/preview-source';
import { sharedSoundFile } from './network/shared-sound';
import { devServerUrl, rendererDir } from './windows/renderer';
import { pageAlive, sendToPage } from './windows/send';
import { quietTests, startQuietTests } from './windows/quiet';
import { readRole, startingRole, writeRole } from './role';
import { removeOldRoles } from './old-roles';
import { startNode } from './node-mode/node-app';
import { NodeRepo } from './db/nodes';
import { NodeService } from './nodes/node-service';
import { PointAhead } from './point-ahead';
import { roomToLoadAhead } from '../shared/point-ahead';
import { spawnLinkWorker } from './nodes/link-worker';
import { type IdentityLoad, loadIdentity, makeNewIdentity } from './nodes/identity';
import { RECENT_DAYS, WantedMedia } from './nodes/wanted-media';
import { startPerfNodes } from './nodes/perf-nodes';
import type { NodeOutputStatus, ScreenThumb } from '../shared/nodes';
import { hostname } from 'node:os';
import { cutText } from '../shared/text';
import { mainClockStyle } from './clock-style';
import { STOPPED_REFUSAL } from '../shared/access';
import { type BehindTheLock, prepareTheLock } from './access/behind-the-lock';
import { followAccess, showCounter, streamCounter } from './access/effects';
import { accessState, isLetIn, onAccessChange, simpleAccess } from './access/gate';

// Headless self-tests: run one, print the result, exit (see README). The performance test
// imports a few hundred placeholder files, so it gets a throwaway data folder of its own.
const selfTest = sw('DRASHTI_SELFTEST') === 'watchdog';
// A node's own watchdog self-test (Session 17): starts as a node, with the pairing in its data folder.
const nodeSelfTest = sw('DRASHTI_SELFTEST') === 'node-watchdog';
const perfTest = sw('DRASHTI_SELFTEST') === 'performance';
// Check the bundled programs (scripts/check-ffmpeg.mjs): print what works, and exit.
const ffmpegCheck = sw('DRASHTI_SELFTEST') === 'ffmpeg';
// The restart after a restore, for real (scripts/check-relaunch.mjs; see relaunch-selftest.ts).
const relaunchTest = sw('DRASHTI_SELFTEST') === 'restore-relaunch';
/**
 * Any self-test (Session 54, E review): it puts back no show after a crash, runs no schedule, imports nothing from the
 * drop folder and shows no announcement: a computer not let in shows only the self-test's own placeholder content.
 */
const selfTestRun = sw('DRASHTI_SELFTEST') !== undefined;
// Tests (and multiple installs) can point Drashti at its own data folder.
const userDataOverride = sw('DRASHTI_USER_DATA_DIR');
/** This computer's own data folder, before any override (the performance check reads its settings). */
const homeData = app.getPath('userData');
if (userDataOverride) app.setPath('userData', userDataOverride);
else if (perfTest) app.setPath('userData', mkdtempSync(join(tmpdir(), 'drashti-perf-')));
// The log goes to a rotating file in the data folder too (see log.ts), from the start.
startLogFile(join(app.getPath('userData'), 'logs'));
// This install's own id (alpha.21, logs for 100+ installs (b)), kept in the data folder; each new log file names it,
// with the version, the system and this computer, at its head.
const install = installId(app.getPath('userData'));
setLogHeader(
  () =>
    `Drashti ${app.getVersion()} on ${process.platform} ${osRelease()} ${process.arch}, computer “${computerName()}”, install ${install.id}${install.kept ? '' : ' (not kept: the data folder could not be written)'}`,
);
/**
 * Every show command, operator request and notice in the log (alpha.21, logs (a)): names, ids and numbers, never
 * words; written a turn after each was answered.
 */
const commandLog = new CommandLog({
  libraryNames: () => (db ? libraryNames(db) : []),
  write: (line) => {
    log.info(line);
  },
  now: () => Date.now(),
  setTimer: (ms, run) => {
    const t = setTimeout(run, ms);
    return () => {
      clearTimeout(t);
    };
  },
});
tellRequests({
  logged: requestLogged,
  tell: (channel, outcome, error) => {
    commandLog.request(channel, outcome, error);
  },
});
/** The log files of a period's days, oldest first (Save Diagnostics and Report a Problem, alpha.21 logs (c)). */
const periodLogFiles = (period: LogPeriod, now: number) => logFilesOf(periodDays(period, now));
// Tests only (never a packaged Drashti): every line into the test's own folder as well, kept when it fails (alpha.21).
const testLogCopy = packaged() ? undefined : sw('DRASHTI_TEST_LOG_COPY');
if (testLogCopy) startLogCopy(testLogCopy);
log.info(phaseLine('the main process running'));
log.info(
  `Drashti ${app.getVersion()} (Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, Node ${process.versions.node}) on ${process.platform} ${osRelease()} ${process.arch}`,
);
/** Drashti is quitting: windows and processes going now are no problem (the crash journal). */
let quitting = false;
/** Source-only barrier, assigned when Main creates its document readers. */
let documentQuit: SourceQuitGate | null = null;
// The crash journal (Sessions 31–36, ROB-6): what went wrong, kept in the data folder as it happens, so the
// next start can say it even when Drashti itself stopped (crash-journal.ts).
const crashJournal = new CrashJournal(join(app.getPath('userData'), JOURNAL_FILE), (line) => {
  log.warn(line);
});
/** An uncaught error, as the journal keeps it: its name and message (the log has its stack). */
const errorWords = (what: string, error: unknown) =>
  `${what}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
let automaticErrorRuntime: ErrorReportRuntime | null = null;
// The log and the crash journal first; an automatic report (off unless the owner turned it on) only after them.
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception in the main process', error);
  crashJournal.add(errorWords('an error in the main process that nothing caught', error));
  automaticErrorRuntime?.crash();
});
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection in the main process', reason);
  crashJournal.add(errorWords('a promise in the main process failed and nothing caught it', reason));
  automaticErrorRuntime?.crash();
});
// What stops as Drashti quits, in one ordered list (lifecycle.ts, Session 23): run at will-quit, or
// before an exit that skips it (app.exit).
const stops = new StopList((name, error) => {
  log.error(`Quitting: ${name} did not stop cleanly`, error);
});
/** Exit at once (self-tests, restarting as Main): everything still stops, in order, first. */
const exitNow = (code: number) => {
  quitting = true;
  const finish = () => {
    stops.run();
    app.exit(code);
  };
  const sourceQuit = documentQuit;
  if (!sourceQuit) {
    finish();
    return;
  }
  void sourceQuit.drain().then((result) => {
    if (result.confirmed) finish();
    else log.error(`Source preparation did not confirm exit (${result.reason}); the library remains open.`);
  });
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
  if (words) {
    crashJournal.add(words);
    // An intentionally killed utility is already in the local journal; it is not an automatic crash report.
    if (details.reason !== 'killed') automaticErrorRuntime?.crash();
  }
});

/** The GPU process's stops (Sessions 31–36, ROB-5): a second within 10 minutes is said. */
const gpuStops = new GpuStops();
/**
 * A video whose element failed on a page that draws the show (Q60-31): taken off after a short wait, unless a GPU
 * process stopped then (its videos load again by themselves). main/media/cannot-play.ts.
 */
/** A paired computer's screen that could not play a video (Q60-44): told once for each node and showing. */
const nodeCannotPlay = new NodeCannotPlay();
const cannotPlay = new CannotPlay({
  now: () => Date.now(),
  later: (ms, run) => {
    setTimeout(run, ms);
  },
});
/** Said to the operator (Main) once the GPU process has stopped twice within 10 minutes. */
let gpuStoppedTwice: ((text: string) => void) | null = null;
// The GPU process stopped (Sessions 31–36, ROB-5): Chromium starts another by itself, but the videos it was
// decoding fail. Every window that draws the show is told, and plays its failed videos again, from the
// engine's time. A second stop within 10 minutes is told to the operator, once.
app.on('child-process-gone', (_event, details) => {
  if (details.type !== 'GPU' || quitting) return;
  cannotPlay.gpuGone();
  log.warn(
    `The GPU process stopped (${details.reason}); its features now: ${JSON.stringify(app.getGPUFeatureStatus())}`,
  );
  for (const w of BrowserWindow.getAllWindows())
    if (!w.isDestroyed()) sendToPage(w, IPC.output.gpuRestarted, { at: Date.now() });
  if (gpuStops.stopped(Date.now())) gpuStoppedTwice?.(GPU_STOPPED_TWICE);
});

/** Tests only (never a packaged Drashti): Chromium's gpu_compositing as if it said this (warm-up.spec.ts). */
const testCompositing = sw('DRASHTI_TEST_GPU_COMPOSITING');
/**
 * Whether each output warms its graphics chip up (Session 57, outputs/warm-up-choice.ts): not where Chromium draws
 * without one. Its status means nothing until its GPU process has said how it draws, so it is read from then.
 */
/** Chromium's feature status now (a test switch's in the tests): how it draws, once its GPU process has said. */
const gpuStatus = (): unknown =>
  testCompositing === undefined ? app.getGPUFeatureStatus() : { gpu_compositing: testCompositing };
const warmUps = new WarmUpChoices({
  status: gpuStatus,
  log: (line) => {
    log.info(line);
  },
});
/**
 * Tests only (never a packaged Drashti; warm-up.spec.ts): with DRASHTI_TEST_GPU_SAID=late, Chromium's word reaches
 * the outputs only when a test calls drashtiTestGpuSaid, every page's warm-up kept drawn till then
 * (windows/renderer.ts), so an output is told after its warm-up began, as on a slow computer. On Main's next turn, as
 * a test's call can arrive in the middle of Main's own work.
 */
const gpuSaidLate = !packaged() && sw('DRASHTI_TEST_GPU_SAID') === 'late';
app.on('gpu-info-update', () => {
  if (gpuSaidLate) return;
  warmUps.gpuSaid();
  // A live appearance's touch waits for this word (Session 60).
  appearance.chipMayHaveChanged();
});
if (gpuSaidLate)
  (globalThis as { drashtiTestGpuSaid?: () => void }).drashtiTestGpuSaid = () => {
    setImmediate(() => {
      warmUps.gpuSaid();
      appearance.chipMayHaveChanged();
    });
  };

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

/**
 * The graphics for Save Diagnostics (Session 60, the owner's Q60-37): how each feature draws, and Chromium's GPU
 * details if it gives them within 3 s (Save Diagnostics is asked for by hand, never mid-drawing; a slow answer is said).
 */
async function readGraphics(): Promise<GraphicsInfo> {
  const featureStatus = app.getGPUFeatureStatus() as unknown as Record<string, string>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const info = await Promise.race([
      app.getGPUInfo('complete'),
      new Promise<never>((_, refuse) => {
        timer = setTimeout(() => {
          refuse(new Error('not answered within 3 s'));
        }, 3000);
      }),
    ]);
    return { featureStatus, info };
  } catch (error) {
    return { featureStatus, info: null, problem: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
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
if (windowedOutputs && !packaged() && sw('DRASHTI_TEST_DISPLAY_CHANGES') === '1')
  (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays = changeExtraDisplays;
/**
 * Screens that set themselves (Session 55, outputs/auto-screens.ts): a display plugged in is used at once. Always in
 * a packaged Drashti but in a self-test (which sets no screen of the library's by itself); tests not about it start
 * without it (DRASHTI_TEST_AUTO_SCREENS: '0', launchApp's own), and then no display's own identity is read either
 * (no child process at every test's start).
 */
const autoScreensOn = !selfTestRun && (packaged() || sw('DRASHTI_TEST_AUTO_SCREENS') !== '0');
/** Tests only: among the pretend displays alone ('pretend'), so a second real display here never changes a test. */
const autoPretendOnly = !packaged() && sw('DRASHTI_TEST_AUTO_SCREENS') === 'pretend';
/**
 * Tests only (never a packaged Drashti), with windowed outputs: a display that counts as the one the controls are on
 * (a pretend one), so a quiet test sees what covering the controls asks (Session 55: only that asks Keep these
 * screens?) and that the controls' display is never taken.
 */
const testControlsDisplay = ((): number | null => {
  const raw = windowedOutputs && !packaged() ? sw('DRASHTI_TEST_CONTROLS_DISPLAY') : undefined;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isSafeInteger(n) ? n : null;
})();
/**
 * Tests only (never a packaged Drashti): the pretend displays' own identities, by their place ("A,B": the first is
 * A's, the second B's), and a display the computer mirrors onto; a test changes them while Drashti runs
 * (drashtiTestDisplaySerials), as a projector moved to another port.
 */
let testSerials: string[] | null = !packaged()
  ? (sw('DRASHTI_TEST_DISPLAY_SERIALS')?.split(',') ?? null)
  : null;
const testMirroredOnto = !packaged() ? (sw('DRASHTI_TEST_MIRRORED_ONTO') ?? '') : '';
if (windowedOutputs && testSerials !== null)
  (globalThis as { drashtiTestDisplaySerials?: (serials: string[]) => void }).drashtiTestDisplaySerials = (
    serials,
  ) => {
    testSerials = serials;
    pretendDisplaysChanged();
  };
// A Diagnostics menu for the manual watchdog check (see README).
const diagnostics = sw('DRASHTI_DIAGNOSTICS') === '1';
// Automated tests cannot answer the quit confirmation.
const noQuitConfirm = sw('DRASHTI_NO_QUIT_CONFIRM') === '1';
// Tests only: after Restore Library… just quit (the test starts Drashti again itself).
const noRelaunch = sw('DRASHTI_TEST_NO_RELAUNCH') === '1';
// Log every permission a page checks or asks for (diagnosing sound output choice).
const logPermissions = sw('DRASHTI_LOG_PERMISSIONS') === '1';
// Tests only: answer media requests late, as a slow disk would (up to a minute: the opening's photo past its limit).
const mediaDelayMs = Math.min(60_000, Math.max(0, Number(sw('DRASHTI_TEST_MEDIA_DELAY_MS') ?? 0) || 0));
/**
 * A test switch (Q60-51): every media file sent at this many bytes a second, a quarter of it four times a second, as
 * from a slow disk or a busy computer: a video's first frame then comes late while it still loads. 0: as fast as it can.
 */
const mediaPaceBps = Math.max(0, Number(sw('DRASHTI_TEST_MEDIA_PACE_BPS') ?? 0) || 0);

/**
 * Bytes Main has sent of each library file as the pages load it, by its id (Q60-51): a video whose file is still coming
 * in is loading, even where its page can tell nothing else (on CI's Mac a slow file showed no buffered time, no frame,
 * no readiness step and no 'progress' event: x47-1120-205802-554). One number a file, for as long as Drashti runs.
 * Counted as the file is read for the page (media-protocol.ts `sent`), or as the test pace sends it (paced): never by
 * wrapping the response, which changed how the bytes reached the player (x47-1120-215255-57755).
 */
const mediaServed = new Map<string, number>();
const mediaSent = (mediaId: string, bytes: number): void => {
  mediaServed.set(mediaId, (mediaServed.get(mediaId) ?? 0) + bytes);
};

/** A response's body sent at mediaPaceBps (the test switch above), counted as it goes for a library file; as it is with none. */
async function paced(response: Response, mediaId: string | null): Promise<Response> {
  if (mediaPaceBps <= 0 || !response.body) return response;
  const bytes = new Uint8Array(await response.arrayBuffer());
  const slice = Math.max(1024, Math.floor(mediaPaceBps / 4));
  let at = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      const chunk = bytes.subarray(at, at + slice);
      controller.enqueue(chunk);
      if (mediaId !== null) mediaSent(mediaId, chunk.byteLength);
      at += slice;
      // A test switch's pace, never in a real show.
      await new Promise((resolve) => setTimeout(resolve, 250));
    },
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// Drashti's sound is the show's, not the computer's media (Session 15): the system's media controls
// (Windows' media overlay, macOS's Now Playing) and the keyboard's or a headset's media keys never see
// it, so nobody pauses the sabha's sound by pressing one. Keeping those controls up to date also took
// the main process 60 to 180 ms each time a sound started on Windows (the performance check's trace).
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');
// Sound-only elements select no video track, avoiding unused software picture decoding (S5). The stream's own sound
// players keep a second of sound decoded ahead (a21-s5b, renderer/src/program/sound-ahead.ts): a page's pictures
// decode on its one media thread too, and held it longer than the 0.2 s a player keeps at first.
app.commandLine.appendSwitch(
  'enable-blink-features',
  [app.commandLine.getSwitchValue('enable-blink-features'), 'AudioVideoTracks', 'MediaLatencyHint']
    .filter(Boolean)
    .join(','),
);

// The show's own process first (Session 15): on a two-core PC with no graphics chip, the windows decoding
// video at the same priority kept the main process (every slide change, and the screens' media) waiting
// for up to 2 s at a time. It uses little of the processor, so it never holds the screens up by going
// first. Windows lets a program raise itself this far; macOS lets only the administrator. It can be set
// back to normal on a computer where that suits the screens better (File > Run Ahead of Other Programs;
// Session 16): the performance check, in a throwaway folder, still reads this computer's choice.
let mainPriority = readPriority(userDataOverride ?? homeData, sw('DRASHTI_PRIORITY'));
/** File › Decks With Their Animations on This Computer (Session 54, C review): kept for this computer. */
let deckAnimations = readDeckAnimations(userDataOverride ?? homeData, process.platform);
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
  // Whether Chromium draws with a graphics chip, once its GPU process has said (Session 60: a live look waits for it).
  chip: () => (warmUps.hasSaid ? (warmUps.drawsWithoutChip() ? 'no' : 'yes') : 'unknown'),
  startIn: sw('DRASHTI_TEST_APPEARANCE'),
  // Tests only (never a packaged Drashti): how many logical cores this computer has, for the moving looks' pause.
  ...(!packaged() && /^[0-9]{1,3}$/u.test(sw('DRASHTI_TEST_CORES') ?? '')
    ? { cores: Number(sw('DRASHTI_TEST_CORES')) }
    : {}),
  say: (line) => {
    log.info(line);
  },
});
handleSync(IPC.appearance.now, () => appearance.now());
/** File > Run Ahead of Other Programs (Windows; a choice for this computer, kept and applied at once). */
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
if (fakeDevices) app.commandLine.appendSwitch(CHROMIUM_FAKE_DEVICES);
// Tests only (alpha.23, cap-realc): the fake microphone plays a generated WAV file once instead of its beep, so caption
// AI's own recogniser (Route C) hears generated sound through the stream's own sound graph (src/main/fake-sound.ts).
const fakeSound = fakeSoundSwitch({
  fakeDevices,
  file: sw('DRASHTI_TEST_FAKE_SOUND_FILE'),
  platform: process.platform,
});
if (fakeSound) app.commandLine.appendSwitch(CHROMIUM_FAKE_SOUND_FILE, fakeSound);
// macOS: the audio service reads that file only out of its sandbox (tests only, as above).
const fakeSoundSandbox = fakeSoundFeatures({
  sound: fakeSound,
  platform: process.platform,
  disabled: app.commandLine.getSwitchValue('disable-features'),
});
if (fakeSoundSandbox) app.commandLine.appendSwitch('disable-features', fakeSoundSandbox);
// Tests only: behave as if the system's secure storage for keys were missing.
const noSafeStorage = sw('DRASHTI_TEST_NO_SAFE_STORAGE') === '1';
// Tests only: the local network listens on this computer alone (no firewall questions), and can be
// told to treat this computer as outside the local network, to see such requests refused.
const networkLocalOnly = sw('DRASHTI_TEST_NETWORK_LOCAL') === '1';
const networkRefuseLoopback = sw('DRASHTI_TEST_NETWORK_REFUSE_LOOPBACK') === '1';
// Tests only (never a packaged Drashti): the address and name this computer is shown at in the Phones panel, and in
// its pairing and poster links, in place of its own ("192.168.1.20 placeholder-mac": http://192.168.1.20:<port> and
// http://placeholder-mac.local:<port>), so the guides' pictures never show a real computer's (Session 55). What the
// server answers to is unchanged.
const networkShown = ((): { addresses: string[]; localName: string } | null => {
  const [address, name] = (packaged() ? '' : (sw('DRASHTI_TEST_NETWORK_SHOWN') ?? '')).trim().split(/\s+/u);
  return address && name
    ? { addresses: [address], localName: `${name.replace(/\.local$/u, '')}.local` }
    : null;
})();
// Tests only: an announcement's minute is this many ms, so one can run out while a test watches.
const announceMinuteMs = Math.min(
  60_000,
  Math.max(100, Number(sw('DRASHTI_TEST_ANNOUNCE_MINUTE_MS') ?? 60_000) || 60_000),
);
// Tests only: the schedules (backups; the arti's and macros' too, until Session 44) read this computer's
// clock moved on by this much (ms), and a test can move it with globalThis.drashtiArtiClock(wallMs).
// The engine's clock is never moved.
const artiTestClock = sw('DRASHTI_TEST_ARTI_CLOCK') === '1' && !packaged();
let artiClockOffset = artiTestClock ? Number(sw('DRASHTI_TEST_ARTI_OFFSET_MS') ?? 0) || 0 : 0;
/** The schedules' clock: this computer's, moved by a test only. */
const scheduleNow = () => Date.now() + artiClockOffset;
// Tests only (never a packaged Drashti): updates come from this server instead of GitHub Releases, and
// install by writing what they would run into a file; a download goes at this rate; and a test can say
// the stream is on air (globalThis.drashtiTestOnAir), for updates and link downloads (the drop folder and
// smart playlists use it too, and Session 50's conversions, which wait while it is).
const testUpdateBase = packaged() ? undefined : sw('DRASHTI_UPDATE_URL');
const updateBase = testUpdateBase ?? UPDATE_BASE;
const testInstallLog = packaged() ? undefined : sw('DRASHTI_TEST_UPDATE_INSTALL');
const testUpdateRate = packaged() ? null : Number(sw('DRASHTI_TEST_UPDATE_RATE') ?? 0) || null;
let testOnAir = false;
let testTrimActivityChanged: (() => void) | undefined;
// Tests only (never a packaged Drashti): Import from a Link asks this local stand-in instead of Dropbox,
// saves into this folder by default, and (the guard, which every e2e run sets) refuses any request to
// anywhere but 127.0.0.1.
const testLinkOrigin = packaged() ? null : (sw('DRASHTI_TEST_LINK_ORIGIN') ?? null);
const testLinkGuard = !packaged() && sw('DRASHTI_TEST_LINK_GUARD') === '1';
const testDownloadsDir = packaged() ? null : (sw('DRASHTI_TEST_DOWNLOADS_DIR') ?? null);
if (!packaged() && sw('DRASHTI_TEST_ON_AIR_HOOK') === '1')
  (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir = (on) => {
    testOnAir = on;
    testTrimActivityChanged?.();
  };
// Tests only: scheduled backups copy at this rate (bytes a second), so a test can watch one wait.
const testBackupRate = packaged() ? null : Number(sw('DRASHTI_TEST_BACKUP_RATE') ?? 0) || null;
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
const testVersion = packaged() ? undefined : sw('DRASHTI_TEST_VERSION');
const appVersion = () => testVersion ?? app.getVersion();
/** How long after a running transition's end a new picture's display copy starts (alpha.21, Q60-59 A). */
const TRANSITION_WAKE_MARGIN_MS = 250;
/** The longest an import waits for the screens' transitions to end (Q60-60 A). */
const IMPORT_QUIET_MAX_MS = 15_000;
/** The import's wait for no running transition, set once the engine and the outputs exist (Q60-60 A). */
let importQuiet: (() => Promise<void>) | null = null;
/** QA22-L8-1 (the owner: "Keep wait, say why"): the screens' transitions' end, and the copies' hold, for the import. */
let importTransitionsEnd: (() => number | null) | null = null;
let importDisplayHeld: ((waiting: boolean) => void) | null = null;
const nodeClockSkewMs = packaged() ? 0 : Number(sw('DRASHTI_TEST_CLOCK_SKEW_MS') ?? 0) || 0;
const nodePortOverride = Number(sw('DRASHTI_NODE_PORT') ?? 0) || null;
// Tests only (never a packaged Drashti): a test can make an output draw an element that throws, to see a
// render error caught, logged and the output reloaded (Session 23; globalThis.drashtiTestRenderError).
const testRenderErrors = !packaged() && sw('DRASHTI_TEST_RENDER_ERRORS') === '1';
const testClockHold = !packaged() && sw('DRASHTI_TEST_CLOCK_HOLD') === '1';
// Tests only: the computer's name as Main and its nodes show it (screenshots never show a runner's own).
const testComputerName = packaged() ? undefined : sw('DRASHTI_TEST_COMPUTER_NAME');
// Tests only: copies to nodes at this rate (bytes a second), so a copy can be watched while it goes.
const testCopyRate = packaged() ? null : Number(sw('DRASHTI_TEST_COPY_RATE') ?? 0) || null;
// Tests only: each window's memory in the log this often (Session 17: the outputs' memory measured with
// nothing attached, tests/soak/devtools.spec.ts).
const testMemoryEveryMs = packaged() ? 0 : Math.max(0, Number(sw('DRASHTI_TEST_MEMORY_EVERY_MS') ?? 0) || 0);

// Library media reaches the sandboxed windows only through drashti-media:// (see media/media-protocol.ts).
// Schemes must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { ...MEDIA_SCHEME_PRIVILEGES } }]);

/** What the show does with an output's watchdog events (set once the outputs exist: Session 23). */
let outputWatchdogEvent: ((e: WatchdogEvent) => void) | null = null;
/** The watchdog's name for the sound player, the hidden window that plays every sound (audio-window.ts). */
const SOUND_PLAYER = 'audio player';
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
    if (!quitting) {
      journalWatchdog(e);
      if (e.kind === 'crashed') automaticErrorRuntime?.crash();
    }
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
/** The slide editor's window (Session 55, Part 17a), once made: the menu's Undo and Redo and the timers ask it. */
let slideEditor: SlideEditorWindow | null = null;
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
    if (outcome.restored) {
      log.info(`Library restored from a backup (${outcome.media ? 'with' : 'without'} media)`);
      if (outcome.originalsNotKept)
        log.warn(
          `Restore: ${String(outcome.originalsNotKept)} original document(s) of the library from before were missing or damaged, so its kept copy lacks them`,
        );
    } else if (outcome.code) log.warn(`A restore was asked for and not done (${outcome.code})`);
    return outcome;
  } catch (error) {
    // The code only: the error's message can hold a path.
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'error';
    log.error(`The restore stopped unexpectedly (${code})`);
    return {
      restored: false,
      code: 'copy-failed',
      message:
        'The library was not restored: copying the backup stopped part way. The library is as it was: restore again; if it stops again, choose Help › Report a Problem… (or Save Diagnostics when it can’t be sent).',
    };
  }
}

const fromOperator = (event: IpcMainInvokeEvent) => event.sender.id === operatorWindow?.webContents.id;
/**
 * Words on the clipboard, by the main process (alpha.20): Drashti's permission rules refuse a page its own clipboard
 * (windows/security.ts), so the operator window's Copy buttons ask here (Media information's words, Events out's new
 * secret). Words only, at most 64 KB, from the operator window; never logged. False when they could not be copied.
 */
const copyWords = async (event: IpcMainInvokeEvent, text: unknown): Promise<boolean> => {
  if (!fromOperator(event) || typeof text !== 'string' || text.length > 64 * 1024) return false;
  return clipboard.writeText(text).then(
    () => true,
    () => false,
  );
};
const idListSchema = z.array(idSchema).min(1).max(10_000);
/** A slide's row the operator's pointer is on (C3, Session 58), or null. */
const pointAtSchema = z
  .object({
    presentationId: idSchema,
    slideIndex: z.number().int().min(0).max(100_000),
    arrangementId: idSchema.nullable(),
  })
  .nullable();
/** What the import's file dialog offers: everything Drashti imports (one list, the scanner's). */
const IMPORTABLE_EXTENSIONS = importableExtensions();
/** What Simple Mode's Add files… offers (Session 55, Part 18): sounds, videos, pictures, PDFs and decks. */
const SIMPLE_IMPORT_EXTENSIONS = simpleImportExtensions();
/** Simple Mode's import: only what its one playlist plays, and a changed file kept beside the old, never replacing it. */
const SIMPLE_IMPORT: ImportOptions = { onConflict: 'keep-both', simple: true };
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

/**
 * The performance check with a heavy case for the screens (DRASHTI_PERF_SCENARIO; Session 15). Session 57: a fault
 * while the case sets up fails the check at once, with its message (scenarioFor).
 */
async function runPerformanceTestWithScenario(ctx: PerfRun): ReturnType<typeof runPerformanceTest> {
  if (!perfScenario) return runPerformanceTestWithNodes(ctx);
  const scenario = await scenarioFor(perfScenario, {
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
    operator: ctx.operator,
    // The animations scenario's second hall screen and stage screen (Session 57, DK-6 and DK-2): pretend displays,
    // only under the motion probe's test switch, never in an installed Drashti.
    ...(!packaged() && sw('DRASHTI_TEST_MOTION_PROBE') === '1'
      ? { pretendDisplays: changeExtraDisplays }
      : {}),
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
  // Roles and PINs are gone (Session 54, E5): an older Drashti's roles.json and what went with it are removed
  // before anything else, never read.
  removeOldRoles(userData, (level, message) => {
    if (level === 'warn') log.warn(message);
    else log.info(message);
  });
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
  else void startMain(selfTesting);
}

/**
 * Main, behind the lock (Session 54, access by Gmail: access/behind-the-lock.ts): nothing of Drashti opens (its library,
 * the screens, the stream, the phones, the nodes) until the list says this computer is let in; then it starts as it
 * always has. A self-test starts at once, its controls locked, and never asks the list.
 */
let behind: BehindTheLock | null = null;
/** Not let in, nor a self-test: nothing may act. */
const accessShut = (): boolean => behind?.shut() ?? false;

async function startMain(selfTest: boolean): Promise<void> {
  let lock: BehindTheLock;
  try {
    lock = await prepareTheLock({
      version: appVersion(),
      selfTest,
      ...(testComputerName === undefined ? {} : { computerName: testComputerName }),
      background: () => appearance.background(),
      fromOperator,
      operatorWindow: () => operatorWindow,
      open: start,
      // The performance check (Session 54, E review): only on a computer let in, by the access in its own data folder.
      ...(perfTest
        ? {
            performance: {
              home: homeData,
              notLetIn: (why: string) => {
                log.warn(`Access: the performance check does not run: ${why}`);
                const result = {
                  passed: false,
                  checks: [{ name: 'this computer is let in', ok: false, detail: why }],
                  summary: '',
                };
                process.stdout.write(`DRASHTI_PERFTEST_RESULT ${JSON.stringify(result)}\n`);
                exitNow(1);
              },
            },
          }
        : {}),
    });
  } catch (error) {
    // Never open without the lock: said plainly, and Drashti quits.
    log.error('Access: the lock could not be made ready', error);
    crashJournal.add(errorWords('the access check could not start', error));
    dialog.showErrorBox(
      'Drashti could not start',
      'Drashti could not check this computer’s access, so it does not open. Quit, then start Drashti again.',
    );
    app.quit();
    return;
  }
  behind = lock;
  stops.add('access', () => {
    lock.service.dispose();
  });
  lock.begin();
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
  const nodeReportRetry = packaged() ? undefined : swMs('DRASHTI_TEST_REPORT_RETRY_MS');
  const node = startNode({
    appearance,
    userData: app.getPath('userData'),
    startNotes,
    version: appVersion(),
    updateBase,
    installer: defaultInstaller({
      platform: process.platform,
      isPackaged: packaged(),
      execPath: process.execPath,
      testLog: testInstallLog,
      updater: autoUpdater,
    }),
    updateRate: testUpdateRate,
    windowed: windowedOutputs,
    watchdog,
    sleepGuard,
    warmUps,
    clockSkewMs: nodeClockSkewMs,
    computerName: testComputerName ?? hostname(),
    diagnostics: {
      app: appInfo,
      watchdogHistory: () => watchdogHistory,
      crashJournal: () => crashJournal.entries(),
      chooseCrashFiles,
      savedText: savedDiagnosticsText,
      // The log of a period (alpha.21, logs (c)), the days kept, this install (logs (b)), and the file made off the
      // node's own thread by a report worker.
      logFilesOf: periodLogFiles,
      logDays,
      installId: install.id,
      computer: computerName,
      makeText: (job) => runDiagnosticsText(job),
      desktop: () => app.getPath('desktop'),
    },
    // Help › Report a Problem… on a node (x49): handed to its Main.
    reports: {
      crashFiles: () => crashFiles(crashFilesDir),
      makeFiles: (job) => runReportJob(job),
      guides: new GuideFiles(
        guidesDir({ packaged: packaged(), resourcesPath: process.resourcesPath, appPath: app.getAppPath() }),
      ),
      ...(nodeReportRetry ? { retryMs: [nodeReportRetry] } : {}),
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
  // Tests only (never a packaged Drashti): mark an output as given up on, as a crash loop would, on the node's next
  // turn as the watchdog's own word comes (a test's call can arrive in the middle of the node's own work).
  if (!packaged() && sw('DRASHTI_TEST_GIVE_UP') === '1')
    (globalThis as { drashtiTestGiveUp?: (screenId: string) => void }).drashtiTestGiveUp = (screenId) => {
      setImmediate(() => {
        node.giveUp(screenId);
      });
    };
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
      logDays,
      reportProblem: node.reportProblem,
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
  // Help › Save Diagnostics › One Day, built again when the days kept change (alpha.21, logs (c)), a turn later.
  onLogDaysChanged(() => {
    setImmediate(nodeMenu);
  });
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
      packaged: packaged(),
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      platform: process.platform,
      arch: process.arch,
      override: sw('DRASHTI_FFMPEG'),
    });
    // And YouTube's two programs (Session 25c): yt-dlp and Deno run, and Deno is sandboxed.
    const tools = findYoutubeTools({
      packaged: packaged(),
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      platform: process.platform,
      arch: process.arch,
    });
    void (async () => {
      const ffmpeg = await ffmpegSelfTest(path, process.platform);
      const youtube = await youtubeSelfTest(tools, process.platform);
      const whisper = packaged()
        ? await whisperSelfTest(
            findWhisper({
              packaged: true,
              resourcesPath: process.resourcesPath,
              appPath: app.getAppPath(),
              platform: process.platform,
              arch: process.arch,
            }),
            process.platform,
          )
        : null;
      // Route C (alpha.22): its helper starts beside its own ONNX Runtime, without any model, pack or sound.
      const indic = packaged()
        ? await indicSelfTest({
            path: findIndic({
              packaged: true,
              resourcesPath: process.resourcesPath,
              appPath: app.getAppPath(),
              platform: process.platform,
              arch: process.arch,
            }),
            platform: process.platform,
            windowsRuntime: Object.keys(windowsRuntimeLibraries),
          })
        : null;
      // The tests' seams (alpha.23, cap-realc): a packaged Drashti turns on none of Chromium's fake media switches,
      // whatever its environment asks (scripts/check-ffmpeg.mjs --packaged starts it asking for the fake microphone).
      const fakeMedia = packaged()
        ? fakeMediaSelfTest(
            (name) => app.commandLine.hasSwitch(name),
            app.commandLine.getSwitchValue('disable-features'),
          )
        : null;
      // Book OCR (alpha.21): its reader and model are in this copy of Drashti, and it reads with them.
      const ocr = await ocrSelfTest({
        files: builtOcrFiles(__dirname),
        tempDir: () => fsPromises.mkdtemp(join(tmpdir(), 'drashti-ocr-selftest-')),
        startReader: (pages, said) =>
          startReader(join(__dirname, 'ocr-worker.js'), builtOcrFiles(__dirname), pages, said),
      });
      const result = {
        ...ffmpeg,
        ffmpegPassed: ffmpeg.passed,
        youtube,
        whisper,
        indic,
        fakeMedia,
        ocr,
        passed:
          ffmpeg.passed &&
          youtube.passed &&
          (whisper?.passed ?? true) &&
          (indic?.passed ?? true) &&
          (fakeMedia?.passed ?? true) &&
          ocr.passed,
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
    isSound: (contents) => stream?.isStreamSound(contents) ?? false,
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
  if (sw('DRASHTI_SELFTEST') === 'old-library' && oldLibrary && !packaged()) {
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
  /**
   * The operator window's page has read its start notice since it last began to load (x53): news reaches it at once.
   * While it is down or loading again (a video that brought it down just taken off), news waits in the start notice.
   */
  let operatorAsked = false;
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
  // The library restored at this start is the one in use (not put back for the one before it, below).
  let restoredInUse = restored.restored;
  if ('error' in opened && restored.restored) {
    keptAccess = null;
    restoredInUse = false;
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
  // A deck's slides still marked as preparing when Drashti stopped in the middle of its import (Session 56): they
  // show their pictures, without their animations, and Next no longer waits for them.
  const unprepared = presentations.clearPreparing();
  if (unprepared > 0)
    log.warn(
      `Start: ${String(unprepared)} slide(s) of a deck’s import cut short are its pictures, without animations`,
    );
  const screenRepo = new ScreenRepo(db);
  const importRepo = new ImportRepo(db);
  // A playlist item naming a video input (Session 51) finds this computer's input of that name: the inputs are read
  // further down, before anything is played.
  const playlists = new PlaylistRepo(db, (name) => videoInputs?.named(name) ?? null);
  // A playlist item's own order of slides (Session 55, Part 4b) is read from its playlist as it plays ("item:<id>").
  const slides = new DbSlideSource(presentations, (itemId) => playlists.ownOrder(itemId));
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
    log.info(`Books' search index folded again in ${Math.round(performance.now() - shastraIndexStart)} ms`);
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
  /** The cameras the operator window last saw, by name (Session 54: a phone naming a video input); null until said. */
  let seenCameras: string[] | null = null;
  // Live captions never reach a phone, a tablet or the API (Session 55, Part 10): every message goes without them.
  const networkTransport: EngineTransport = {
    broadcast: (message) => {
      network?.broadcast(withoutCaptions(message));
    },
  };
  // Output nodes get every engine message too (while any is paired); made further down.
  let nodeService: NodeService | null = null;
  /** What each node should copy (made with the media, further down). */
  let wantedMedia: WantedMedia | null = null;
  // Nor an output node (Session 55, Part 10): captions show only on this computer's own screens and stream.
  const nodesTransport: EngineTransport = {
    broadcast: (message) => {
      nodeService?.broadcast(withoutCaptions(message));
    },
  };
  // Each screen group's settings (Session 55, Part 12: Looks gone from the window): the engine reads them through the
  // service, made just below (it needs the engine).
  const lookRepo = new LookRepo(db);
  let lookService: LookService | null = null;
  /** Simple Mode is on (set once the mode is read, further down). */
  let simpleNow = () => false;
  // Which of Pro Mode's tools Simple Mode has (alpha.22, Edit › Simple Mode Features…): made with the mode, below.
  let simpleChosen = (): readonly SimpleFeature[] => [];
  /** A media file's length, once learned from playing it (the media repo, made further down). */
  let mediaLength: (mediaId: string) => number | null = () => null;
  /** A picture's look (Session 26e; the media repo, made further down). */
  let pictureLook: (mediaId: string) => PictureLook | null = () => null;
  /** Whether a picture's file is known to draw no see-through pixel (X11; the media repo, made further down). */
  let pictureOpaque: (mediaId: string) => boolean = () => false;
  /** A video's or sound's start and end points and markers (the media repo, made further down). */
  let mediaMarkers: (mediaId: string, itemId?: string) => MediaMarkers | null = () => null;
  /** A media item's kind while it is there to play (Session 50, the box's; the media repo, made further down). */
  let mediaKind: (mediaId: string) => 'image' | 'video' | 'audio' | null = () => null;
  // How each file sounds (Session 55, Part 7: even loudness, main/sound/): from the library, each kept here until it is
  // measured again or switched, as the engine asks at every change about the files sounding.
  const soundRepo = new SoundRepo(db);
  const soundKnown = new Map<string, { gain: number; silent: boolean } | null>();
  const soundOf = (mediaId: string): { gain: number; silent: boolean } | null => {
    const recipe = editedPlaying.renditionOf(mediaId)?.recipe ?? null;
    mediaId = editedPlaying.sourceId(mediaId);
    if (!soundKnown.has(mediaId)) {
      const s = soundRepo.soundOf(mediaId);
      soundKnown.set(mediaId, s ? { gain: s.gain, silent: s.silent } : null);
    }
    return soundForEditedVideo(soundKnown.get(mediaId) ?? null, recipe);
  };
  /** Music steps aside under a video with sound (Session 55, Part 7, K): Audio's switch, kept with the library; on by default. */
  let stepsAside = settings.get('music.stepsAside') !== false;
  /** The operator's Audio and Video levels (X33), kept with the library, and their mutes, off at every start. */
  const soundLevels = new SoundLevelsKeeper({ settings, write: laterSetting });
  /** Picture in picture's remembered place (Session 50): where a new box goes, kept in the library. */
  const pipPlaces = new PipPlaces({ settings, write: laterSetting });
  /** Audio playlists (made further down): the media library changing may change them. */
  let musicService: MusicService | null = null;
  /** The wallpapers (Session 55, Part 6; made further down): the media library changing may change them. */
  let wallpaperService: WallpaperService | null = null;
  /** Brings folder playlists' sounds into Audio (Session 44); set once the music is ready. */
  let syncAudios = (): void => undefined;
  /** Today's calendar entry (made further down): told when an import loads a calendar. */
  let calendarService: CalendarService | null = null;
  /** This computer's video inputs (Session 50; made just below, with the engine). */
  let videoInputs: VideoInputsService | null = null;
  /** Their list changed (Session 51): playlist items and what comes next may name one that is or is not here now. */
  let inputsChanged = (): void => undefined;
  /**
   * One renamed (Session 52): the library's items and slides that named it take its new name, then what it returns
   * tells the rest of Drashti (set further down).
   */
  let inputRenamed: (from: string, to: string) => () => void = () => () => undefined;
  const videoCaptionsRepo = new VideoCaptionsRepo(db);
  let videoCaptionBand = new CaptionSettingsRepo(db).get();
  // Sound and picture… (alpha.20): each file's own playback settings, read once from the library and kept until changed.
  let proxySourceOf: (id: string) => string = (id) => id;
  let proxyReadyFor: (id: string) => { mediaId: string | null; message: string | null } = (id) => ({
    mediaId: id,
    message: null,
  });
  const videoEdits = new VideoEditsRepo(db, (id) => proxySourceOf(id));
  // Every playback metadata consumer follows the repo's shared identity callback (S4 supplies proxy parents).
  const editedPlaying = {
    sourceId: (id: string) => videoEdits.sourceId(id),
    renditionOf: (id: string) => videoEdits.renditionOf(id),
  };
  const playbackRepo = new MediaRepo(db);
  const ownPlayback = new Map<string, PlaybackSettings>();
  const playbackOfFile = (mediaId: string): PlaybackSettings => {
    mediaId = editedPlaying.sourceId(mediaId);
    let kept = ownPlayback.get(mediaId);
    if (!kept) {
      kept = playbackRepo.playbackOf(mediaId);
      ownPlayback.set(mediaId, kept);
    }
    return kept;
  };
  // The stream page's frame grid, told while a cue waits (S5, a21-s5): a manual Go is placed on its frames.
  let streamFrames: (FrameGrid & { told: number }) | null = null;
  const engine = new ShowEngine(
    playable,
    new FanoutTransport([transport, networkTransport, nodesTransport]),
    Date.now,
    {
      items: (id) => playlists.playItems(id),
      repeatAll: (id) => playlists.playOptions(id).repeatAll,
      crossfadeMs: (id) => playlists.playOptions(id).crossfadeMs ?? 0,
    },
    {
      defaultTransition: () => defaultTransition(settings),
      looks: { start: () => lookService?.start() ?? NO_LOOK },
      // Simple Mode refuses Pro Mode's commands, from the window, a phone or the API alike.
      refuse: (command, state) =>
        accessShut()
          ? STOPPED_REFUSAL
          : simpleNow() && simpleModeRefuses(command, state, simpleChosen())
            ? simpleRefusalText(simpleAccess())
            : null,
      videoCueParticipants: () => {
        const ids: string[] = [];
        if (operatorWindow && !operatorWindow.isDestroyed())
          ids.push(`picture:${operatorWindow.webContents.id}`);
        if (audioWindow && !audioWindow.isDestroyed()) ids.push(`sound:${audioWindow.webContents.id}`);
        const groups = screenRepo.groups();
        const audience = new Set(
          screenRepo
            .screens()
            .filter((s) => groups.find((g) => g.id === s.groupId)?.role !== 'stage')
            .map((s) => s.id),
        );
        for (const entry of manager.windows())
          if (audience.has(entry.screenId) && !entry.window.isDestroyed())
            ids.push(`picture:${entry.window.webContentsId}`);
        const remote = new Set(
          nodeService
            ?.screenStatus()
            .filter((s) => s.state === 'showing')
            .map((s) => s.screenId) ?? [],
        );
        for (const screen of screenRepo.screens())
          if (screen.nodeId && screen.enabled && audience.has(screen.id) && remote.has(screen.id))
            ids.push(`node:${screen.nodeId}:${screen.id}`);
        const program = streaming.programContents();
        if (program && !program.isDestroyed()) ids.push(`picture:${program.id}`);
        const sound = streaming.soundContents();
        if (sound && !sound.isDestroyed()) ids.push(`sound:${sound.id}`);
        return ids;
      },
      videoGoFrames: () => {
        const program = streaming.programContents();
        // Only a grid the stream's page told in the last 3 s (it tells four times a second while a cue waits).
        if (!streamFrames || !program || program.isDestroyed() || Date.now() - streamFrames.told > 3000)
          return null;
        return { at: streamFrames.at, periodMs: streamFrames.periodMs };
      },

      sourceMediaId: (id) => editedPlaying.sourceId(id),
      prepareVideoEdits: (previous, next, historic) => {
        const edited = prepareVideoEdits(previous, next, (id) => videoEdits.read(id), historic, {
          sourceId: (id) => editedPlaying.sourceId(id),
          renditionOf: (id) => editedPlaying.renditionOf(id),
          lengthOf: (id) => mediaLength(id),
          available: (id) => {
            const row = playbackRepo.kindAndFile(id);
            return !!row && !row.missing && existsSync(join(mediaDir, row.path));
          },
        });
        return edited.state ? prepareVideoProxies(previous, edited.state, proxyReadyFor, historic) : edited;
      },
      mediaLength: (mediaId) => mediaLength(mediaId),
      mediaMarkers: (mediaId, itemId) => mediaMarkers(mediaId, itemId),
      videoCaptionsOf: (mediaId) => {
        const sourceId = editedPlaying.sourceId(mediaId);
        const original = videoCaptionsRepo.chosen(sourceId);
        const rendition = editedPlaying.renditionOf(mediaId);
        const length = mediaLength(sourceId);
        const track =
          original && rendition
            ? length === null
              ? null
              : videoEditTimes(rendition.recipe, length).captions(original)
            : original;
        // Sound and picture… (alpha.20): the captions' own delay against the picture.
        const delayMs = playbackOfFile(mediaId).captionDelayMs;
        return track
          ? {
              track,
              size: videoCaptionBand.size,
              place: videoCaptionBand.place,
              ...(delayMs === 0 ? {} : { delayMs }),
            }
          : null;
      },
      repeatName: (playlistId) => playlists.repeatPlaylist(playlistId)?.name ?? null,
      pictureLook: (mediaId) => pictureLook(mediaId),
      pictureOpaque: (mediaId) => pictureOpaque(mediaId),
      // The picture-in-picture box (Session 50): what it holds, from the main process's own lists.
      mediaKind: (mediaId) => mediaKind(mediaId),
      windows: (id) => liveWindows?.offeredWindow(id) ?? null,
      pipPlace: () => pipPlaces.place(),
      // A video input by its id, from this computer's list (Session 50): showInput and the picture-in-picture box
      // find it only there.
      videoInput: (inputId) => videoInputs?.get(inputId) ?? null,
      // The input a slide's background cue names (Session 51), by its name, from the same list.
      inputNamed: (name) => videoInputs?.named(name) ?? null,
      // A timer shown alone (Session 50) in the words of the library's default theme.
      timerLook: () => themeLook(themes.themeOrDefault(null), 1920, 1080).style,
      // How the files sounding play (Session 55, Part 7): each one's even loudness, and the music stepping aside.
      soundOf: (mediaId) => soundOf(mediaId),
      stepsAside: () => stepsAside,
      // The operator's Audio and Video levels and mutes (X33).
      levels: () => soundLevels.levels(),
      // Sound and picture… (alpha.20): each file's own tone and its sound's delay.
      playbackOf: (mediaId) => {
        const own = playbackOfFile(mediaId);
        return { tone: toneOf(own), soundDelayMs: own.soundDelayMs };
      },
      // Sound and picture…'s Shape (alpha.20, x55): each video's own shape on the screens.
      videoShape: (mediaId) => shapeOverride(playbackOfFile(mediaId).shape),
    },
  );
  // Quitting: a slide moving on by itself, or an audio playlist's next track, never fires once the library
  // has closed (seen on CI Windows: "The database connection is not open" from an auto-advance at quit).
  stops.add('engine timers', () => {
    engine.dispose();
    commandLog.flush();
  });
  // Every show command in the log, whoever sent it (the window, a phone, Companion, OSC, a script, or the show itself:
  // a slide moving on by itself), and what came of it (alpha.21, logs for 100+ installs (a)): written a turn later.
  const dispatchNow = engine.dispatch.bind(engine);
  let dispatching = 0;
  engine.dispatch = (command) => {
    dispatching++;
    let result: ReturnType<typeof dispatchNow>;
    try {
      result = dispatchNow(command);
    } finally {
      dispatching--;
    }
    try {
      commandLog.show(command, result);
    } catch {
      // The log is never in a show command's way.
    }
    return result;
  };
  // And what the show did by itself (a slide moving on, a message's time up, what a restart put back): the parts that
  // changed, never what they hold.
  let showBefore = engine.current;
  engine.onChange((state) => {
    const was = showBefore;
    showBefore = state;
    if (dispatching > 0) return;
    const parts = (Object.keys(state.layers) as (keyof typeof state.layers)[]).filter(
      (k) => state.layers[k] !== was.layers[k],
    ) as string[];
    if (state.live !== was.live) parts.unshift('live');
    if (state.blackout !== was.blackout) parts.push('black-out');
    if (state.wallpaper !== was.wallpaper) parts.push('wallpaper');
    try {
      if (parts.length > 0) commandLog.changedByItself(engine.rev, parts);
    } catch {
      // Nor in the show's own changes'.
    }
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
    renamed: (from, to) => inputRenamed(from, to),
    changed: (view) => {
      sendToPage(operatorWindow, IPC.videoInputs.changed, view);
      // The slide editor's own window names them for a slide's background (Session 55, Part 17a).
      slideEditor?.send(IPC.videoInputs.changed, view);
      inputsChanged();
      // A phone naming or putting up an input reads them again (Session 54).
      net.hint('setup');
      // The chosen one (Session 55), for a stage layout's video input box on every stage screen.
      showStageInput();
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
  /** The chosen video input (Session 55) to every stage screen, through the engine's state. */
  function showStageInput(): void {
    const chosen = videoInputs?.chosen() ?? null;
    engine.setStage({
      input: chosen
        ? { inputId: chosen.id, name: chosen.name, device: chosen.device, fit: chosen.fit }
        : null,
    });
  }
  showStageInput();
  engine.onChange(() => {
    inputs.follow();
  });
  stops.add('video inputs', () => {
    inputs.close();
  });
  const stageLayoutRepo = new StageLayoutRepo(db);
  const looks = new LookService({
    repo: lookRepo,
    engine,
    log: (message) => {
      log.info(message);
    },
  });
  lookService = looks;
  // Each group's settings, read the first time.
  engine.refreshLook();
  // Stage layouts, and the one chosen for every stage screen (Session 55), given to the engine once recovery has
  // put back the Look in use (below): at the first start after the update, that Look's layout becomes the chosen one.
  /** Tell the operator window the stage layouts changed (set once its window can be told, further down). */
  let stageLayoutsChanged: (layouts: StageLayout[]) => void = () => undefined;
  const stageLayouts = new StageLayoutService({
    repo: stageLayoutRepo,
    settings,
    lookLayoutId: () => looks.liveStageLayoutId(),
    show: (layout) => {
      engine.setStage({ layout });
    },
    forgetInLooks: (id) => {
      lookRepo.forgetStageLayout(id);
    },
    changed: (layouts) => {
      stageLayoutsChanged(layouts);
    },
    log: (message) => {
      log.info(message);
    },
  });
  const timers = new TimerRepo(db);
  engine.setTimers(timers.list());

  // ---- media ----------------------------------------------------------------
  const userDataDir = app.getPath('userData');
  const mediaDir = join(userDataDir, 'Media');
  mkdirSync(mediaDir, { recursive: true });
  const media = new MediaRepo(db);
  registerEditVideoIpc({
    appendScenes: (id, times, save) => withSceneMarkers(libraryDb, media, id, times, save),
    markersChanged: () => libraryChanged(true),
    repo: videoEdits,
    fromOperator: (event) => fromOperator(event) && !simpleNow(),
    available: (id) => {
      const file = media.file(id);
      return !!file && !file.missing && !file.deleted && existsSync(join(mediaDir, file.path));
    },
    changed: (edit) => {
      const cue = engine.current.videoCue;
      if (cue && videoEdits.sourceId(cue.background.mediaId) === edit.mediaId)
        engine.dispatch({ type: 'cancelVideoCue' });
      sendToOperator(IPC.media.videoEditChanged, edit);
    },
    write: sourceWrite(
      libraryDb,
      () => importer?.giveWay() ?? { ready: Promise.resolve(), done: () => undefined },
    ),
  });
  const trimmedVideos = new TrimmedVideos(libraryDb, media, playlists);
  mediaLength = (mediaId) => media.lengthOf(mediaId);
  mediaKind = (mediaId) => media.kindAndName(mediaId)?.kind ?? null;
  /** The largest audience screen's picture as drawn, in pixels (set once the outputs are). */
  let audienceScreenSize: (() => PixelSize | null) | null = null;
  let audienceDisplaySizes: () => PixelSize[] = () => [];
  let streamDisplaySize: () => PixelSize = () => DEFAULT_DISPLAY_SIZE;
  let displayOnAir: () => boolean = () => true;
  const displayTargets = () => [...audienceDisplaySizes(), streamDisplaySize()];
  let displayWorkerBusy: () => boolean = () => false;
  // ---- pictures' sharpened copies (Session 26f): made once each, drawn by every screen ----------
  const sharpened = new SharpenedCopies({
    mediaDir,
    wanted: () => media.sharpenWants(),
    canWork: () => !displayWorkerBusy(),
    // The largest audience screen's picture as drawn (Session 26g): copies are made at that size.
    screen: () => audienceScreenSize?.() ?? streamDisplaySize(),
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
  // No shared media permissions or cache: this Session can read only its one currently granted source.
  const displaySession = session.fromPartition('drashti-display-copies');
  applySessionSecurity(displaySession);
  const displayBlobFiles = new DisplayBlobFiles(displaySession);
  stops.add('display blob files', () => displayBlobFiles.close());
  let displayWorkerId = 0;
  // A new picture's copy is never made during a transition on the screens (alpha.21, Q60-59 A, answered for the owner
  // by his assister under his 1-minute rule: made during a hall dissolve, its work held up the hall's frames): it waits
  // for the running dissolve or fade to end, then starts at once (one wake-up at that end).
  let transitionWake: ReturnType<typeof setTimeout> | null = null;
  // An import waits the same way (Q60-60 A, the owner's own "A."): until no transition runs, re-checked at each end, at
  // most IMPORT_QUIET_MAX_MS so a run of dissolves never holds it long.
  const untilNoTransition = (): Promise<void> =>
    new Promise((resolve) => {
      const giveUp = Date.now() + IMPORT_QUIET_MAX_MS;
      const check = () => {
        const ends = transitionsEndAt(engine.current, Date.now());
        if (ends === null || Date.now() >= giveUp) {
          resolve();
          return;
        }
        setTimeout(check, Math.min(ends, giveUp) - Date.now() + TRANSITION_WAKE_MARGIN_MS);
      };
      check();
    });
  importQuiet = untilNoTransition;
  importTransitionsEnd = () => transitionsEndAt(engine.current, Date.now());
  const noTransitionRunning = (): boolean => {
    const ends = transitionsEndAt(engine.current, Date.now());
    if (ends === null) return true;
    transitionWake ??= setTimeout(
      () => {
        transitionWake = null;
        displayCopies.activityChanged();
      },
      ends - Date.now() + TRANSITION_WAKE_MARGIN_MS,
    );
    return false;
  };
  stops.add('display copies’ transition wake', () => {
    if (transitionWake) clearTimeout(transitionWake);
  });
  const displayCopies = new DisplayCopies({
    mediaDir,
    targets: displayTargets,
    canStart: () => !sharpened.working && noTransitionRunning(),
    // Held while a transition runs: a new picture's import says it waits for the screens' transitions (QA22-L8-1).
    held: (waiting) => {
      importDisplayHeld?.(waiting && transitionsEndAt(engine.current, Date.now()) !== null);
    },
    canWork: () => nothingUp(engine.current.layers) && !displayOnAir(),
    open: (gone) => {
      const win = createSharpenWindow(gone, true, displaySession);
      const id = win.webContents.id;
      displayWorkerId = id;
      return {
        id,
        saveBlob: (blob, destination, signal) =>
          displayBlobFiles.save(win.webContents, blob, destination, signal),
        beforeBytes: () => {
          const priority = pictureWorkerPriority(win.webContents.getOSProcessId());
          log.info(`Display copy worker priority: ${String(priority)} (${process.platform})`);
        },
        destroy: () => {
          if (displayWorkerId === id) displayWorkerId = 0;
          if (!win.isDestroyed()) win.destroy();
        },
      };
    },
    changed: () => {
      looksChanged();
      wantedMedia?.invalidate();
      nodeService?.libraryChanged();
    },
    log: (message) => log.info(message),
  });
  displaySession.protocol.handle(MEDIA_SCHEME, (request) =>
    handleDisplaySourceRequest(request, {
      mediaDir,
      lookup: (key) => displayCopies.workerSource(displayWorkerId, key),
      fetchFile: (url, init) => displaySession.fetch(url, init),
    }),
  );
  const refreshDisplayCopies = () =>
    db === null ? Promise.resolve() : displayCopies.refresh(media.displayCandidates());
  displayWorkerBusy = () => displayCopies.working;
  stops.add('display copies', () => displayCopies.close());
  handle(IPC.displayCopies.next, (e) => displayCopies.next(e.sender.id));
  handle(IPC.displayCopies.made, (e, key, bytes) => displayCopies.made(e.sender.id, key, bytes));

  // ---- pictures' blurred copies (Session 55, Part 5, D): made once each, drawn behind a photo that does not fill ----
  /** On air or recording (set once the stream is): no blurred copy is made meanwhile. */
  let blurOnAir: () => boolean = () => false;
  /** The bundled FFmpeg, for pictures' blurred copies and Save picture… (Session 55, Part 5). */
  const pictureFfmpeg = () =>
    findFfmpeg({
      packaged: packaged(),
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      platform: process.platform,
      arch: process.arch,
      override: sw('DRASHTI_FFMPEG'),
    });
  const blurred = new BlurredCopies({
    mediaDir,
    fileOf: (mediaId) => {
      const found = media.kindAndFile(mediaId);
      const file = media.file(mediaId);
      return found?.kind === 'image' && !found.missing && file?.sha256
        ? { sha256: file.sha256, path: found.path }
        : null;
    },
    run: ffmpegBlurRun(pictureFfmpeg),
    onAir: () => blurOnAir(),
    // A copy is ready: the screens and the nodes' lists follow.
    changed: () => {
      engine.refreshPictures();
      wantedMedia?.invalidate();
      nodeService?.libraryChanged();
    },
    log: (message) => {
      log.info(message);
    },
  });
  // The copies already made, found (the screens follow once they are).
  void blurred.scan().then(() => {
    engine.refreshPictures();
  });
  stops.add('blurred copies', () => {
    blurred.close();
  });
  /** Whether a picture is drawn with its blurred copy behind it: its look says, else on for a photo, off for a deck's page. */
  const fillsWithBlur = (mediaId: string, look: PictureLook | null): boolean =>
    look?.fill ?? media.photoByDefault(mediaId);
  /** A look as the screens and thumbnails get it: with its sharpened copy, once that is ready. */
  const shownLook = (
    mediaId: string,
    look: PictureLook | null,
    targets?: readonly PixelSize[],
  ): PictureLook | null => {
    const sha = media.file(mediaId)?.sha256 ?? null;
    const file = sha ? displayCopies.ready(sha, look, targets) : null;
    const shown = file
      ? { ...(look ?? PLAIN), display: { key: file.key, width: file.width, height: file.height } }
      : look;
    const step = look ? sharpenStep(look.sharpness) : 0;
    const ready = sharpened.readyStep(sha);
    return step > 0 && ready === step ? { ...(shown ?? PLAIN), copy: step } : shown;
  };
  /**
   * A look as the screens get it (Session 55, D): with its blurred copy behind it, once that is ready, on for a photo
   * unless its look says not; a picture coming up or on the screens with none yet has it made now.
   */
  const screenLook = (mediaId: string): PictureLook | null => {
    const look = shownLook(mediaId, media.look(mediaId));
    if (!fillsWithBlur(mediaId, look)) return look;
    if (blurred.has(media.file(mediaId)?.sha256 ?? null)) return { ...(look ?? PLAIN), blurred: true };
    blurred.want([mediaId]);
    return look;
  };
  const shownLooks = (): Record<string, PictureLook> => {
    // One fresh physical target snapshot for this synchronous publication.
    const targets = displayTargets();
    const looks = media.looks();
    for (const candidate of media.displayCandidates()) {
      if (!(candidate.mediaId in looks) && displayCopies.ready(candidate.sha256, candidate.look, targets))
        looks[candidate.mediaId] = candidate.look ?? PLAIN;
    }
    return Object.fromEntries(
      Object.entries(looks).flatMap(([id, look]) => {
        const shown = shownLook(id, look, targets);
        return shown ? [[id, shown]] : [];
      }),
    );
  };
  pictureLook = (mediaId) => screenLook(mediaId);
  // Which pictures can draw no see-through pixel (X11, media/see-through.ts), only where Chromium draws without a
  // graphics chip (only there do the screens back a moving slide; with one the state stays as it was): each file's first
  // bytes read once, by its contents, off the main thread's way; the screens hear of one as soon as it is read.
  const seeThrough = new Map<string, boolean | 'reading'>();
  pictureOpaque = (mediaId) => {
    if (warmsUp(gpuStatus())) return false;
    const found = media.kindAndFile(mediaId);
    const sha256 = media.file(mediaId)?.sha256 ?? null;
    if (found?.kind !== 'image' || found.missing || found.path === '' || sha256 === null) return false;
    const known = seeThrough.get(sha256);
    if (known === undefined) {
      seeThrough.set(sha256, 'reading');
      const file = isAbsolute(found.path) ? found.path : join(mediaDir, found.path);
      void pictureCannotSeeThrough(file).then((opaque) => {
        seeThrough.set(sha256, opaque);
        if (opaque) engine.refreshPictures();
      });
    }
    return known === true;
  };
  mediaMarkers = (mediaId, itemId) => {
    const sourceId = editedPlaying.sourceId(mediaId);
    const original = media.markersOf(sourceId);
    const marks =
      original && itemId && trimmedVideos.playsFull(itemId, sourceId, original)
        ? { ...original, startMs: null, endMs: null }
        : original;
    const rendition = editedPlaying.renditionOf(mediaId);
    const length = media.lengthOf(sourceId);
    return marks && rendition && length !== null
      ? videoEditTimes(rendition.recipe, length).markers(marks)
      : marks;
  };
  const captionFileReader = new CaptionFileReader(spawnImportWorker);
  stops.add('video-captions', () => {
    captionFileReader.close();
  });
  registerVideoCaptionIpc({
    fromOperator,
    repo: {
      view: (id) => videoCaptionsRepo.view(editedPlaying.sourceId(id)),
      select: (id, track) => videoCaptionsRepo.select(editedPlaying.sourceId(id), track),
      put: (id, tracks) => videoCaptionsRepo.put(editedPlaying.sourceId(id), tracks),
    },
    reader: captionFileReader,
    write: sourceWrite(
      libraryDb,
      () => importer?.giveWay() ?? { ready: Promise.resolve(), done: () => undefined },
    ),
    pick: async (event) => {
      const parent = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: 'Add a Caption File',
        buttonLabel: 'Add Caption File',
        properties: ['openFile'] as 'openFile'[],
        filters: [{ name: 'Captions (SRT or WebVTT)', extensions: ['srt', 'vtt'] }],
      };
      const picked = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
    changed: (mediaId) => {
      engine.refreshVideoCaptions();
      sendToOperator(IPC.videoCaptions.changed, {
        mediaId,
        view: videoCaptionsRepo.view(editedPlaying.sourceId(mediaId)),
      });
    },
  });
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
      mediaMarkersInputSchema,
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
    slideEditor?.send(IPC.media.looksChanged, shownLooks());
  };
  handle(IPC.media.look, (_e, mediaId) =>
    typeof mediaId === 'string' && MEDIA_ID_PATTERN.test(mediaId) ? media.look(mediaId) : null,
  );
  handle(IPC.media.looks, () => shownLooks());
  /** A picture's look kept (framed already), from the window's Picture editor or a phone's (Session 55, Part 9). */
  const keepLook = (mediaId: string, look: PictureLook | null) => {
    if (!MEDIA_ID_PATTERN.test(mediaId) || !media.setLook(mediaId, look))
      return { ok: false as const, message: 'Only a picture in the library has a look.' };
    looksChanged();
    // Its sharpened copy made (again), or gone with its sharpness (Session 26f).
    void sharpened.refresh();
    void refreshDisplayCopies();
    // Its blurred copy, once its fill is on (Session 55, D).
    if (fillsWithBlur(mediaId, media.look(mediaId))) blurred.want([mediaId]);
    log.info('Pictures: a picture’s look was kept');
    return { ok: true as const };
  };
  handle(IPC.media.setLook, (e, mediaId, raw) => {
    if (!fromOperator(e) || typeof mediaId !== 'string' || !MEDIA_ID_PATTERN.test(mediaId))
      return { ok: false as const, message: 'Only the operator window can change a picture.' };
    const look = raw === null ? null : pictureLookSchema.safeParse(raw);
    if (look && !look.success) return { ok: false as const, message: 'That look cannot be kept.' };
    return keepLook(mediaId, look ? framed(look.data) : null);
  });
  // Keep this zoom: the live zoom kept as the picture's own (its enhancements stay as they were).
  // ---- Session 55 (Part 5): a photo's blurred fill, and Save picture… ----
  handle(IPC.media.photo, (_e, mediaId) =>
    typeof mediaId === 'string' && MEDIA_ID_PATTERN.test(mediaId) ? media.photoByDefault(mediaId) : false,
  );
  handle(IPC.media.savePicture, async (e, mediaId, name) => {
    if (!fromOperator(e) || !operatorWindow || typeof mediaId !== 'string' || !MEDIA_ID_PATTERN.test(mediaId))
      return { ok: false as const, message: 'Only the operator window can save a picture.' };
    const found = media.kindAndFile(mediaId);
    if (found?.kind !== 'image' || found.missing || found.path === '' || isAbsolute(found.path))
      return {
        ok: false as const,
        message: 'That picture is not in the library now, so it cannot be saved.',
      };
    const ext = extOf(found.path);
    const jpeg = savesAsJpeg(ext);
    const last = settings.get('pictures.saveFolder');
    const folder =
      typeof last === 'string' && isAbsolute(last) ? last : (testDownloadsDir ?? app.getPath('pictures'));
    const picked = await dialog.showSaveDialog(operatorWindow, {
      title: 'Save picture',
      defaultPath: join(folder, savedName(typeof name === 'string' ? name : 'Picture', jpeg)),
      buttonLabel: 'Save',
      filters: [
        jpeg
          ? { name: 'JPEG picture', extensions: ['jpg', 'jpeg'] }
          : { name: 'PNG picture', extensions: ['png'] },
      ],
    });
    if (picked.canceled || !picked.filePath) return { ok: false as const, cancelled: true as const };
    const wanted = jpeg ? /\.jpe?g$/iu : /\.png$/iu;
    const target = wanted.test(picked.filePath)
      ? picked.filePath
      : `${picked.filePath}.${jpeg ? 'jpg' : 'png'}`;
    const saved = await savePicture(
      join(mediaDir, found.path),
      ext,
      target,
      media.look(mediaId),
      ffmpegBlurRun(pictureFfmpeg),
    );
    if (!saved.ok) return saved;
    settings.set('pictures.saveFolder', dirname(target));
    log.info('Pictures: a picture was saved where the operator chose');
    return { ok: true as const, path: target };
  });
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
  // A passage's theme background as a slide's cue reads its file (Session 52): by its name, and missing when it was
  // not found or was deleted (before, a missing file read as there, and went up black).
  mediaInfo = (mediaId) => media.asCue(mediaId);
  // The guides inside Drashti (Sessions 31–36): beside an installed Drashti, docs/ in the repository.
  const guideFiles = new GuideFiles(
    guidesDir({ packaged: packaged(), resourcesPath: process.resourcesPath, appPath: app.getAppPath() }),
  );
  // Drashti's default opening photo (the owner's decision of 5 Nov 2026): beside an installed Drashti, in
  // resources/opening in the repository, and a test's own picture in a test (opening/opening-photo.ts).
  const openingPhoto = openingPhotoPlace({
    packaged: packaged(),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    test: sw('DRASHTI_TEST_OPENING_PHOTO'),
    testing: anyTestSwitch(),
  });
  /** The opening pack's sound the opening keeps (alpha.16), by its sha256: set once the opening's service is made. */
  let openingSoundFile: (sha256: string) => string | null = () => null;
  /** A stream link's local stream (alpha.20, slice 8): its folder, and a joined player's playlist; set once its service is made. */
  let streamLinkFolder: (linkId: string) => string | null = () => null;
  let streamLinkPlaylist: (linkId: string, segment: number) => Promise<string | null> = () =>
    Promise.resolve(null);
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
      selectedThumbnail: (id) => videoEdits.thumbnailOf(id),
      sharpened: (sha256, step) => sharpened.relativePath(sha256, step),
      display: (sha256, key) => displayCopies.relativePath(sha256, key),
      blurred: (sha256) => blurred.relativePath(sha256),
      // A picture one of the guides shows (only those, from the guides' own folder).
      guidePicture: (name) => {
        const file = guideFiles.picture(name);
        return file ? { dir: guideFiles.dir, file } : null;
      },
      // Drashti's default opening photo (only it, from its own folder).
      openingPhoto: () => openingPhoto,
      // The opening pack's sound, as Drashti keeps its copy in the media folder (only the one the opening keeps).
      openingSound: (sha256) => openingSoundFile(sha256),
      // A stream link's local stream (alpha.20, slice 8): only while that link is connecting or up.
      liveFolder: (linkId) => streamLinkFolder(linkId),
      livePlaylist: (linkId, segment) => streamLinkPlaylist(linkId, segment),
      warn: (message) => {
        log.warn(message);
      },
      // What of a library file goes out (Q60-51, mediaServed): as it is read, or, at the test pace, as that sends it.
      ...(mediaPaceBps > 0 ? {} : { sent: mediaSent }),
    });
    const asked = mediaRequestOf(request.url);
    const sent = await paced(response, asked?.what === 'media' ? asked.mediaId : null);
    return perfWatch ? watchedMedia(perfWatch, request, started, sent) : sent;
  };
  // Every window's session: the default one, and the audio player's own.
  protocol.handle(MEDIA_SCHEME, serveMedia);
  audioSession.protocol.handle(MEDIA_SCHEME, serveMedia);
  streamSession.protocol.handle(MEDIA_SCHEME, serveMedia);

  // ---- outputs ----------------------------------------------------------
  const outputWindows = new Map<string, BrowserWindow>();
  /** Each output's name, as the watchdog and the log call it. */
  const outputNames = new Map<string, string>();
  // ---- each display's own identity (Session 55, outputs/display-ids.ts) --------------------------------------
  // Read off the main thread (system_profiler on a Mac, PowerShell on Windows), at the start and after every change
  // of the displays, never waited for by the start: until it is read, displays are found as before.
  const noReading = () => Promise.resolve({ ids: new Map<number, string>(), mirroredOnto: [] });
  const displayIds = new DisplayIds({
    read:
      testSerials !== null || testMirroredOnto !== ''
        ? standInReader(
            () => testSerials ?? [],
            EXTRA_DISPLAY_ID,
            () => (testMirroredOnto === '' ? [] : [testMirroredOnto]),
          )
        : autoScreensOn
          ? (systemReader() ?? noReading)
          : noReading,
    displays: electronDisplays,
    log: (message) => {
      log.info(message);
    },
  });
  setDisplayIdentities((d) => displayIds.identityOf(d));
  /**
   * The hall's picture as this computer's stage screens draw it in a layout's audience picture box (Session 50): the
   * first audience group shown here, said off while Audience is off (Session 51). Its nodes' stage screens and a
   * tablet's stage display are told the same.
   */
  const hallHere = () => hallPicture(screenRepo.groups(), manager.switches().audience);
  /** The hall as a tablet's stage display was last told it, to tell it again when it changes (Session 51). */
  let hallTold = '';
  /** Whether a screen's picture is being adjusted in Screens (x27): its grid. The screens service's, once it is made. */
  let adjustingScreen: (screenId: string) => boolean = () => false;
  const contextFor = (screenId: string): OutputContext | null => {
    const s = screenRepo.screen(screenId);
    if (!s) return null;
    const displayId = manager.status().find((st) => st.screenId === screenId)?.displayId;
    const d = listDisplays().find((x) => x.id === displayId);
    const role = screenRepo.groupRole(s.groupId) ?? 'audience';
    return {
      screenId: s.id,
      screenName: s.name,
      groupId: s.groupId,
      groupName: screenRepo.groupName(s.groupId) ?? '',
      role,
      feed: s.feed,
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
      // A stage layout's audience picture box (Session 50): the first audience group's picture, said off with
      // Audience off (Session 51; the switch's reconcile sends every output its context again).
      hall: hallHere(),
      // No warm-up where Chromium draws without a graphics chip (Session 57).
      ...warmUpFact(warmUps, outputWindows.get(screenId), outputNames.get(screenId) ?? 'an output', role),
      // Its picture's geometry (x27): a key and fill pair's key draws its fill's. The grid while it is adjusted.
      geometry: drawnGeometry(
        s,
        screenRepo.allScreens().filter((x) => x.groupId === s.groupId),
      ),
      ...(adjustingScreen(s.id) ? { grid: true as const } : {}),
    };
  };
  // ---- the Stage preview (alpha.22) -------------------------------------------------------------------------
  // A stage screen's page in a normal window on this computer, opened from the Stage screen panel (the owner, 24 Nov
  // 2026: "right now i am unable to setup stage screen even its on"): with one projector, no display has the Stage
  // job, and this shows what a stage screen would, its layout with Stage on and the audience picture with it off,
  // as the first stage group draws it. It is no screen: never counted, never opened by itself, never covering.
  let stagePreview: BrowserWindow | null = null;
  const stagePreviewContext = (): OutputContext => {
    const group = screenRepo.groups().find((g) => g.role === 'stage');
    const first = group?.screens[0];
    return {
      screenId: 'stage-preview',
      screenName: 'Stage preview',
      groupId: group?.id ?? '',
      groupName: group?.name ?? 'Stage',
      role: 'stage',
      feed: null,
      canvasWidth: first?.canvasWidth ?? 1920,
      canvasHeight: first?.canvasHeight ?? 1080,
      scaling: first?.scaling ?? 'fit',
      display: null,
      clockStyle: mainClockStyle(),
      hall: hallHere(),
      ...warmUpFact(warmUps, stagePreview ?? undefined, 'the Stage preview', 'stage'),
    };
  };
  const openStagePreview = (): void => {
    // Never a window opened as Drashti quits (Session 23: it would stop the quit; a22-review-stage S3).
    if (quitStarted) return;
    const open = stagePreview;
    if (open && !open.isDestroyed()) {
      // In sight again, the keyboard left with the operator (a22-review-stage S1).
      revealPreview(open);
      return;
    }
    const near =
      operatorWindow && !operatorWindow.isDestroyed()
        ? electronScreen.getDisplayMatching(operatorWindow.getBounds()).workArea
        : null;
    const win = createStagePreviewWindow(near);
    stagePreview = win;
    log.info('Stage preview opened: what a stage screen shows, in a window on this computer');
    win.on('closed', () => {
      if (stagePreview === win) stagePreview = null;
      log.info('Stage preview closed');
    });
  };
  /** Closed as Simple Mode starts, as the Lower Thirds studio is (a22-review-stage S8). */
  const closeStagePreview = (): void => {
    if (stagePreview && !stagePreview.isDestroyed()) stagePreview.close();
  };
  // An output open before Chromium said how it draws is sent its context again once it skips its warm-up (Session 57).
  followOutputs(warmUps, outputWindows, outputNames, (screenId, win) => {
    const context = contextFor(screenId);
    if (context) sendToPage(win, IPC.output.context, context);
  });
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
    // A window that went down, on Main's next turn once the watchdog has done its part: the video it keeps going down
    // on comes off, and it loads again at once without it (x53, below).
    if (e.kind === 'crashed')
      setImmediate(() => {
        wentDown(e.window);
      });
    // The sound player given up on, or tried again (x53, the owner's Q60-50 (2) A): the red notice says so, or goes.
    if (e.window === SOUND_PLAYER && (e.kind === 'gave-up' || e.kind === 'retried'))
      audioOutput.setPlayerStopped(e.kind === 'gave-up');
    const screenId = screenOfOutput(e.window);
    if (screenId === undefined) return;
    // A page loaded again gets its grace before it is judged.
    if (e.kind === 'reloaded' || e.kind === 'retried') heartbeat.opened(screenId);
    // Given up on: Stopped (the status line and Screens say so) until it draws again.
    if (e.kind === 'gave-up') stopOutput(screenId);
  };
  /*
   * A page that keeps failing on a video up (x53; the owner's Q60-31 bug hunt, x52's show-stoppers; his Q60-50 A): a
   * hall screen whose picture fails each time it draws or whose renderer goes down each time it loads it, LIVE (the
   * operator window) going down each time it loads it, the sound player going down each time it loads its sound. Failing
   * again within a minute with a video up that was up the time before, the newest such comes off as a video that fails
   * does (x46's take-off: its sound with it, on the slide paused, the box off), said by its name and where, and the page
   * loads again at once without it (main/keeps-failing.ts). With nothing to blame, the watchdog gives up on it as before.
   */
  const keepsFailing = new KeepsFailing();
  /** The engine's revision when each screen's picture last failed as it drew (x53): drawn past it, it draws again. */
  const pictureFailedAt = new Map<string, number>();
  /** Where a window the watchdog names is, in the notice's words, and its page: a hall screen, LIVE, the sound player. */
  const failingPage = (window: string): { where: string; page: WatchTarget } | null => {
    if (window === 'operator')
      return pageAlive(operatorWindow) ? { where: 'LIVE', page: operatorWindow.webContents } : null;
    if (window === SOUND_PLAYER)
      return pageAlive(audioWindow)
        ? { where: 'Drashti’s sound player', page: audioWindow.webContents }
        : null;
    const screenId = screenOfOutput(window);
    const win = screenId === undefined ? undefined : outputWindows.get(screenId);
    if (screenId === undefined || !win || win.isDestroyed()) return null;
    const name = screenRepo.screens().find((s) => s.id === screenId)?.name ?? screenId;
    return { where: whereWords([{ screen: name }]), page: win.webContents };
  };
  /** A page failed (`how`): the file it keeps failing on taken off, said and logged. Whether one was. */
  const takeOffWhatFails = (window: string, where: string, how: string): boolean => {
    const mediaId = keepsFailing.failed(window, Date.now(), filesUp(engine.current, window === SOUND_PLAYER));
    if (mediaId === null) return false;
    const name = media.kindAndName(mediaId)?.name ?? 'A file';
    const took = engine.cannotPlay(mediaId);
    if (took) {
      const off = [
        took.background ? 'the background' : '',
        took.slide ? 'paused on the slide' : '',
        took.box ? 'the box' : '',
      ]
        .filter((w) => w !== '')
        .join(', ');
      log.warn(
        `${window} kept failing (${how}) with a video up, twice within a minute: ${mediaId}; taken off (${off})`,
      );
      tellOperator(cannotPlayNotice(name, where, took));
      return true;
    }
    // Still up though x46's take-off left it so (paused on the slide), or the music (Q60-52 A): off as Clear slide or
    // Clear audio takes it, so Back or Oops can bring it back.
    const layer = stillUpOn(engine.current, mediaId);
    if (layer === null || !engine.dispatch({ type: 'clearLayer', layer }).ok) return false;
    log.warn(
      `${window} kept failing (${how}) with a file up, again within a minute: ${mediaId}; its ${layer} cleared`,
    );
    tellOperator(keptFailingNotice(name, where, layer));
    return true;
  };
  /** A window went down (any of them): if it keeps going down on a video, that comes off and it loads again at once. */
  const wentDown = (window: string) => {
    const failing = failingPage(window);
    if (failing && takeOffWhatFails(window, failing.where, 'it went down'))
      watchdog.tookOff(failing.page, window, 'without the video it kept going down on');
  };
  // Tests only (never a packaged Drashti): mark an output as given up on, as a crash loop would,
  // to see Stopped and Try again (Session 23; Playwright cannot follow a renderer that crashes). On Main's next turn,
  // as the watchdog's own word comes: a test's call can arrive in the middle of Main's own query, its library busy
  // (alpha.14's gate on Windows, 4 Nov 2026).
  if (!packaged() && sw('DRASHTI_TEST_GIVE_UP') === '1')
    (globalThis as { drashtiTestGiveUp?: (screenId: string) => void }).drashtiTestGiveUp = (screenId) => {
      setImmediate(() => {
        stopOutput(screenId);
      });
    };
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
        warmUps.forget(h.webContentsId);
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
          void refreshDisplayCopies();
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
    // Stage starts as it was left (alpha.22): off on a new library, and once after the update; the e2e tests start
    // it on (DRASHTI_TEST_STAGE_AT_START), as every start was before. Audience is on at every start.
    startsOff: stageStartsOn(settings, !packaged() && sw('DRASHTI_TEST_STAGE_AT_START') === 'on')
      ? []
      : ['stage'],
    onChange: () => {
      engine.videoCuePageJoined('');
      // A hall screen stopped, or back (events out: Session 28).
      const screensNow = manager.status().map((st): ScreenState => ({
        screenId: st.screenId,
        state: st.state,
        name: screenRepo.screen(st.screenId)?.name ?? '',
      }));
      eventsOut.emit(screenEvents(eventsScreensWas, screensNow));
      eventsScreensWas = screensNow;
      if (pageAlive(operatorWindow)) sendToPage(operatorWindow, IPC.screens.changed, screens.snapshot());
      // The slide editor's safe areas and crop lines (Session 55, Part 17a: its own window).
      slideEditor?.send(IPC.screens.changed, screens.snapshot());
      // And a phone setting them up (Session 54).
      net.hint('setup');
      for (const [screenId, win] of outputWindows) {
        const context = contextFor(screenId);
        if (context) sendToPage(win, IPC.output.context, context);
      }
      // The Stage preview (alpha.22) follows the stage's group and the hall's picture as the stage screens do.
      if (stagePreview && !stagePreview.isDestroyed())
        sendToPage(stagePreview, IPC.output.context, stagePreviewContext());
      guardOperator();
      // Keep these screens? (Session 50): whether an output covers the controls, said again when that changed.
      keepScreens.refresh();
      // And Audience and Stage's question (Session 51): on the output over the controls, wherever that is now.
      switchQuestion.refresh();
      // A stopped output (Session 23) is still on its display and tried again: the display stays awake.
      sleepGuard.update(
        manager.status().filter((st) => st.state === 'showing' || st.state === 'stopped').length,
      );
      // Nodes follow their screens' settings (groups, canvases, names) as they change.
      nodeService?.screensChanged();
      // A tablet's stage display draws the hall in a layout's audience picture box (Session 51): it reads it again
      // when it changed (a screen given to the hall, its canvas, Audience off or on).
      const hall = JSON.stringify(hallHere());
      if (hall !== hallTold) {
        hallTold = hall;
        net.hint('screens');
      }
      // Sharpened copies follow the screens' size (Session 26g).
      void sharpened.screensChanged();
      void refreshDisplayCopies();
    },
  });
  // The audience screens on this computer, each its canvas as drawn in its window, in pixels: the largest.
  // A node's screens count too (Session 26h), at the size of the node's display each is given to.
  audienceDisplaySizes = () => {
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
    return audienceScreenSizes({
      local,
      screens: screenRepo.allScreens(),
      roleOf: (groupId) => screenRepo.groupRole(groupId),
      nodes: nodeService?.displays() ?? [],
    });
  };
  audienceScreenSize = () => {
    const all = audienceDisplaySizes();
    return all.reduce<PixelSize | null>(
      (largest, size) =>
        !largest || size.width * size.height > largest.width * largest.height ? size : largest,
      null,
    );
  };
  stops.add('outputs', () => {
    manager.closeAll();
  });
  /**
   * The display the operator window is on, where an output covers it. Windowed (development) outputs never cover it,
   * but for a test's pretend display that counts as the controls' (DRASHTI_TEST_CONTROLS_DISPLAY).
   */
  const operatorDisplayId = (): number | null =>
    testControlsDisplay ??
    (windowedOutputs || !operatorWindow || operatorWindow.isDestroyed()
      ? null
      : electronScreen.getDisplayMatching(operatorWindow.getBounds()).id);
  /**
   * The display the controls are on, windowed outputs or not (Session 55: never taken by itself; Screens and Set Up
   * Screens… mark it): the operator window's, or the main display before it opens.
   */
  const controlsDisplay = (): number =>
    testControlsDisplay ??
    (operatorWindow && !operatorWindow.isDestroyed()
      ? electronScreen.getDisplayMatching(operatorWindow.getBounds()).id
      : electronScreen.getPrimaryDisplay().id);
  /** The displays set Not used by hand (Session 55): kept with the library, never taken by themselves again. */
  const notUsed = new NotUsedDisplays({
    get: () => settings.get('displaysNotUsed'),
    set: (value) => {
      settings.set('displaysNotUsed', value);
    },
  });
  let stream: StreamService | null = null;
  // Show a Window… and the window for Zoom (Session 48): made with the stream, below.
  let liveWindows: LiveWindowService | null = null;
  let zoomWindow: ZoomWindow | null = null;
  // Video out (x30): the stream's picture to other software, made with the stream, below.
  let videoOutService: VideoOutService | null = null;
  const screens = new ScreensService(
    screenRepo,
    manager,
    listDisplays,
    operatorDisplayId,
    looks,
    {
      displays: () => nodeService?.displays() ?? [],
      screenStatus: () => nodeService?.screenStatus() ?? [],
    },
    notUsed,
  );
  adjustingScreen = (screenId) => screens.adjusting(screenId);
  // ---- Audience and Stage (Session 50; outputs/screen-switches.ts): this computer's screens off and on --------
  // Audience is on at every start; Stage (alpha.22) as it was left, kept in the library's settings as it changes.
  const screenSwitches = new ScreenSwitchService({
    // Turned through the screens, which remember what each screen showed as its switch went off (Session 51).
    outputs: screens,
    simple: () => simpleNow(),
    // A node's stage screens count as set to Stage (alpha.22); only this computer's ever ask before one goes off.
    screens: () => ({
      groups: screenRepo.groups(),
      status: [...manager.status(), ...(nodeService?.screenStatus() ?? [])],
    }),
    state: () => engine.current,
    log: (message) => {
      log.info(message);
    },
    // Stage on with no screen set to Stage (alpha.22): said under the top bar, with Set up Stage screen…, which
    // opens Screens at the displays that could take the job (the controls' last).
    noStageScreen: () => {
      const controls = controlsDisplay();
      const ids = listDisplays().map((d) => d.id);
      sayScreens({
        kind: 'no-stage',
        text: NO_STAGE_SCREEN,
        displayIds: [...ids.filter((id) => id !== controls), ...ids.filter((id) => id === controls)],
      });
    },
  });
  // The engine's Stage off as the switch starts (alpha.22: off on a new library), and the log says how it started.
  engine.setStage({ off: !manager.switches().stage });
  log.info(
    `Screens: Stage starts ${manager.switches().stage ? 'on' : 'off'}${settings.get(STAGE_SETTING) === undefined ? ' (never chosen in this library)' : ', as it was left'}`,
  );

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
  // The changes waiting for an answer, on disk until it comes (Session 51, S3-2): see below for the next start.
  const waitingFile = new WaitingFile(join(userDataDir, 'keep-screens.json'));
  const keepScreens = new KeepScreens<ScreensSetup>({
    starting: () => {
      const here =
        operatorWindow && !operatorWindow.isDestroyed() && !windowedOutputs ? operatorWindow : null;
      controlsBefore = { displayId: operatorDisplayId(), bounds: here ? here.getBounds() : null };
    },
    capture: () => screens.setup(),
    restore: (changes, quitting) => {
      // Only what the changes changed goes back (Session 51): whatever else changed meanwhile stays.
      const result = screens.undo(changes, quitting);
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
    // Only a change that puts an output on the controls' display asks (Session 55); none can with windowed outputs.
    controls: () => {
      const id = controlsDisplayId();
      return id === null ? null : `here ${String(id)}`;
    },
    coversControls: () => coveringNow().length > 0,
    snapshot: () => screens.snapshot(),
    changed: (pending) => {
      sendToPage(operatorWindow, IPC.screens.pendingChanged, pending);
      // A phone that set up the screens answers it too (Session 54).
      net.hint('setup');
      const covering = new Set(pending?.coversControls ? coveringNow() : []);
      for (const [screenId, win] of outputWindows)
        sendToPage(win, IPC.output.keepQuestion, covering.has(screenId) ? pending : null);
    },
    ended: (how) => {
      controlsBefore = null;
      if (how === 'kept') return;
      const text =
        how === 'went-back'
          ? 'The screens went back to how they were before the change.'
          : how === 'went-back-by-itself'
            ? 'Nothing was pressed, so the screens went back to how they were before the change.'
            : COULD_NOT_GO_BACK;
      commandLog.notice(text);
      sendToPage(operatorWindow, IPC.app.notice, { text });
    },
    remember: (changes) => {
      if (changes) waitingFile.keep(changes);
      else waitingFile.forget();
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
  // A change the last run left waiting (it stopped: a crash, a power cut) goes back now, as nothing pressed would
  // have, saved only: the outputs then open on the screens as they were before it, and the operator is told. A
  // backup restored and in use at this start is another library: the change was made to the one before it, so it
  // is dropped (screens-setup.ts, afterStop).
  const afterStopSaid = afterStop(waitingFile, {
    goBack: (changes) => {
      screens.undo(changes, true);
    },
    otherLibrary: restoredInUse,
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  if (afterStopSaid) startNotice = startNotice ? `${startNotice}\n\n${afterStopSaid}` : afterStopSaid;

  // ---- screens that set themselves (Session 55, outputs/auto-screens.ts) -------------------------------------
  // A display plugged in is used at once, asking nothing: the first not the controls' shows the audience picture,
  // the next the stage; what it did is said in one line, with Change… (and once, how to extend when the computer
  // mirrors). Kept for a window that opens after it was said.
  let lastSaid: ScreensSaid | null = null;
  /** The lines said so far: each its own number, whoever said it (the displays plugged in, Stage: alpha.22). */
  let saidCount = 0;
  const sayScreens = (said: Omit<ScreensSaid, 'id'>): void => {
    saidCount += 1;
    lastSaid = { ...said, id: saidCount };
    sendToPage(operatorWindow, IPC.screens.said, lastSaid);
  };
  const autoScreens = new AutoScreens({
    on: autoScreensOn,
    displays: () =>
      autoPretendOnly
        ? listDisplays().filter((d) => d.id >= EXTRA_DISPLAY_ID && d.id < EXTRA_DISPLAY_ID + 4)
        : listDisplays(),
    uses: () => screens.uses(),
    controlsDisplayId: controlsDisplay,
    notUsed,
    give: (jobs) => {
      const given = screens.giveJobs(jobs);
      // As Screens' own changes do: the stream's languages, and a stage display in a browser.
      streaming.contextChanged();
      net.hint('screens');
      return given;
    },
    said: (said) => {
      sayScreens(said);
    },
    mirroredOnto: () => displayIds.mirroredOnto(),
    platform: process.platform,
    log: (message) => {
      log.info(message);
    },
  });
  /** The displays read again (their own identities), the outputs following, then each one plugged in given its job. */
  const displaysRead = () => {
    void displayIds.refresh().then(() => {
      // Read as Drashti quits, after the library has closed: nothing to do.
      if (db === null) return;
      manager.reconcile();
      autoScreens.check();
    });
  };
  /** Keep these screens? as an output shows it: only one over the controls, while a change waits. */
  const keepQuestionFor = (screenId: string) => {
    const pending = keepScreens.current();
    return pending?.coversControls && coveringNow().includes(screenId) ? pending : null;
  };

  // ---- Audience and Stage's question on an output over the controls (Session 51, S2-2) ----------------------
  // The window asks "Turn Audience off?" itself (Mod+1, Mod+2, the top bar's switch) and says so here; with an
  // output over the controls (one display), that output asks the same, large, as Keep these screens? does.
  const switchQuestion = new SwitchQuestion({
    covering: () => coveringScreens(manager.status(), operatorDisplayId()),
    outputs: () => [...outputWindows.keys()],
    show: (screenId, which) => {
      sendToPage(outputWindows.get(screenId), IPC.output.switchQuestion, { which });
    },
    covered: (covered) => {
      sendToPage(operatorWindow, IPC.screenSwitches.covered, { covered });
    },
    answered: (yes) => {
      sendToPage(operatorWindow, IPC.screenSwitches.answered, { yes });
    },
    simple: () => simpleNow(),
    log: (message) => {
      log.info(message);
    },
  });

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
  // Nothing goes until an address is added and a kind ticked; no process runs till then.
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
  const startup: StartupRecovery =
    restored.restored || selfTestRun
      ? { cleanQuit: true, recentStop: false, putBack: null, tooOld: null }
      : startupRecovery(recoveryFiles);
  const saved = startup.putBack;
  if (saved) {
    const put = engine.restore(saved);
    // A video input put back (Session 50; in the picture-in-picture box too, Session 51): the first screen to draw it
    // says whether it is on this computer.
    inputs.restored();
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
      wallpaper: put.wallpaper,
      audio: put.audio,
      messages: put.messages,
      ticker: put.ticker,
      lowerThird: put.lowerThird,
      pip: put.pip,
      stageMessage: put.stageMessage,
      timers: put.timers,
      window: put.window,
      // A stream link (alpha.20, slice 8): never put back, only named.
      link: put.link ?? null,
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
      link: linkName,
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
        linkNotPutBack: linkName !== undefined,
        boxWindowNotPutBack: boxWindowName !== null,
        inputPutBack: inputName !== null,
        inputNotListed: inputNotListed !== null,
        boxInputNotListed: boxInputNotListed !== undefined,
      })}`,
    );
  }
  // The stage screens' layout (Session 55), once the Look in use is the one recovery put back, if any.
  stageLayouts.start();
  const old = startup.tooOld;
  if (old) {
    // Stopped unexpectedly too long ago (RECOVERY_MAX_AGE_MS): the notice names what was live, and
    // nothing goes on the screens.
    const slideGone = old.slide !== null && !presentations.get(old.slide.presentationId);
    recovery = {
      savedAt: old.savedAt,
      putBack: false,
      slide:
        old.slide && !slideGone
          ? {
              presentationName: presentations.get(old.slide.presentationId)?.name ?? '',
              slideNumber: old.slide.slideIndex + 1,
            }
          : null,
      slideGone,
      background:
        old.background !== null &&
        old.background.kind !== 'window' &&
        old.background.kind !== 'input' &&
        old.background.kind !== 'link',
      window: old.background?.kind === 'window' ? old.background.name : null,
      link: old.background?.kind === 'link' ? old.background.name : null,
      // The picture-in-picture box (Session 50): a window in it named apart, as the background's is.
      pip: old.pip !== null && old.pip.source.kind !== 'window',
      pipWindow: old.pip?.source.kind === 'window' ? old.pip.source.name : null,
      input: old.background?.kind === 'input' ? old.background.name : null,
      blackout: old.blackout,
      wallpaper: old.wallpaper,
      audio: old.audio !== null,
      messages: old.messages.length,
      ticker: old.ticker?.items.length ?? 0,
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
    onScreens: () => mediaUpNow(engine.current),
    // What a crash now would put back (Session 57): the show saved last. The unused Trim cuts sweep keeps it.
    putBack: () => {
      const saved = liveWriter.savedState;
      return saved ? mediaUpNow(saved) : new Set<string>();
    },
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
      void refreshDisplayCopies();
    });
  /** After media is deleted or brought back: everything that shows media reads again. */
  const mediaRemovalChanged = () => {
    slides.invalidate();
    // A deletion undone: the slide up names its background file as missing no more (Session 52).
    engine.refreshFiles();
    engine.refreshNext();
    libraryChanged(true);
    sendToOperator(IPC.playlists.changed, { at: Date.now() });
    network?.hint('playlists');
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
  // ---- the one right-click menu (Session 55, Part 14): usage, Rename, Show in Finder or Explorer ----------------
  const fileActions = new FileActions(db, {
    mediaDir,
    livePresentation: () => engine.current.live.presentationId,
  });
  const revealed = (path: string | null, what: string) => {
    if (path === null) return { ok: false as const, message: `Drashti has no file to show for ${what}.` };
    shell.showItemInFolder(path);
    return { ok: true as const };
  };
  /**
   * Rename… of a picture, video or sound, from the window or a phone (Session 55, Part 9): refused in words, the name
   * rule or the file no longer in the library (Session 58, X3).
   */
  const renameMediaFile = (mediaId: string, name: string) => {
    const kept = fileActions.renameMedia(mediaId, name);
    if (!kept.ok) return kept;
    mediaRemovalChanged();
    return { ok: true as const, ids: [mediaId] };
  };
  handle(IPC.media.rename, (e, mediaId, name) => {
    const id = idSchema.safeParse(mediaId);
    if (!fromOperator(e) || !id.success || !MEDIA_ID_PATTERN.test(id.data))
      return { ok: false as const, message: 'Only the operator window can rename media.' };
    return renameMediaFile(id.data, typeof name === 'string' ? name : '');
  });
  handle(IPC.media.reveal, (e, mediaId) => {
    const id = idSchema.safeParse(mediaId);
    if (!fromOperator(e) || !id.success || !MEDIA_ID_PATTERN.test(id.data))
      return { ok: false as const, message: 'Only the operator window can show a file.' };
    return revealed(fileActions.mediaFile(id.data), 'that media');
  });
  handle(IPC.library.presentationUsage, (_e, ids) => {
    const parsed = idListSchema.safeParse(ids);
    return parsed.success
      ? fileActions.presentationUsage(parsed.data)
      : { playlists: { names: [], count: 0 }, live: false };
  });
  /** Rename… of a presentation, from the window or a phone (Session 55, Part 9); refused in words as a file's. */
  const renamePresentationNamed = (presentationId: string, name: string) => {
    const kept = fileActions.renamePresentation(presentationId, name);
    if (!kept.ok) return kept;
    slides.invalidate(presentationId);
    engine.refreshNext();
    libraryChanged(true);
    sendToOperator(IPC.playlists.changed, { at: Date.now() });
    network?.hint('playlists');
    return { ok: true as const, ids: [presentationId] };
  };
  handle(IPC.library.renamePresentation, (e, presentationId, name) => {
    const id = idSchema.safeParse(presentationId);
    if (!fromOperator(e) || !id.success)
      return { ok: false as const, message: 'Only the operator window can rename a presentation.' };
    return renamePresentationNamed(id.data, typeof name === 'string' ? name : '');
  });
  handle(IPC.library.revealPresentation, (e, presentationId) => {
    const id = idSchema.safeParse(presentationId);
    if (!fromOperator(e) || !id.success)
      return { ok: false as const, message: 'Only the operator window can show a file.' };
    return revealed(fileActions.presentationFile(id.data), 'that presentation: it was made in Drashti');
  });
  // Only a quit on purpose is clean (not a crash): the very last step, after the library has closed.
  stops.addLast('clean-quit mark', () => {
    liveWriter.markClean();
  });

  // Automatic error reports (alpha.21): their own consent and outbox, off until the owner turns them on; only the typed
  // ids of the diagnostics files (log-who.ts) cross into them.
  const automaticReports = new ErrorReports({
    dir: join(userDataDir, 'automatic-error-reports'),
    now: Date.now,
    owner: () => isLetIn() && accessState().owner,
    letIn: isLetIn,
    onAir: () => stream?.inUse() === true || testOnAir,
    // Development and CI never contact a real receiver. Unit tests inject local services instead.
    send: (config, body, stop) =>
      packaged() ? sendErrorReport(errorReportTransport, config, body, stop) : Promise.resolve(false),
  });
  const errorAccessStore = new ErrorReportAccessStore(userDataDir);
  automaticErrorRuntime = new ErrorReportRuntime({
    now: Date.now,
    capture: (make) => {
      const kept = automaticReports.captureWith(make);
      if (kept) void automaticReports.wake();
      return kept;
    },
    identity: () => {
      if (!automaticReports.status().enabled) return null;
      const computer = behind?.client?.computer();
      const grant = behind?.service.grant();
      if (!computer || !grant) return null;
      const kept = errorAccessStore.read(0);
      if (
        kept.status !== 'ok' ||
        kept.value.computerId !== computer.id ||
        kept.value.grantId !== grant.grantId
      )
        return null;
      // The same ids a diagnostics file names (diagnosticsWho, alpha.21 logs (b)), whole, and never its names or words.
      return automaticIdentity(
        {
          computerId: computer.id,
          installId: install.id,
          grantId: grant.grantId,
          role: isLetIn() ? { mode: accessState().mode, owner: accessState().owner } : null,
          made: simpleNow() ? 'simple' : 'pro',
        },
        { version: app.getVersion(), platform: process.platform, arch: process.arch, release: osRelease() },
        kept.value.activity,
      );
    },
  });
  // Bounded production wake cadence; no tight failure loop and never while on air.
  const automaticReportTimer = setInterval(
    () => {
      void automaticReports.wake();
    },
    5 * 60 * 1000,
  );
  automaticReportTimer.unref();
  const offAutomaticAccess = onAccessChange(() => {
    if (isLetIn()) void automaticReports.wake();
    else automaticReports.cancel();
  });
  stops.add('automatic reports', () => {
    clearInterval(automaticReportTimer);
    offAutomaticAccess();
    automaticReports.dispose();
    automaticErrorRuntime = null;
  });
  if (!startup.cleanQuit) automaticErrorRuntime.crash();
  void automaticReports.wake();

  // ---- imports ----------------------------------------------------------------
  // The window's page, not just the window: at quit the page goes first (Session 20).
  const sendToOperator = <C extends EventChannel>(channel: C, payload: EventContract[C]) => {
    // Every notice in the log (alpha.21, logs (a)), its names in quotes blanked.
    if (channel === IPC.app.notice) commandLog.notice((payload as EventContract[typeof IPC.app.notice]).text);
    const delivered = sendToPage(operatorWindow, channel, payload);
    // A failure notice the operator was given may leave an automatic report: its text is classified here, never kept.
    if (
      delivered &&
      channel === IPC.app.notice &&
      typeof payload === 'object' &&
      payload !== null &&
      'text' in payload &&
      typeof payload.text === 'string'
    )
      automaticErrorRuntime?.operatorNotice(payload.text);
  };
  // A watched folder can finish its first look before the operator window subscribes.
  const importNotices = automaticImportNotices((notice) =>
    sendToPage(operatorWindow, IPC.library.automaticImportNotice, notice),
  );
  const importNotice = importNotices.publish;

  // ---- streaming -------------------------------------------------------------
  let eventsStreamWas: StreamStatus | null = null;
  // Scheduling on YouTube (x31): told how the stream stands (YouTube's state of the broadcast while on air).
  // Given once the YouTube service is made, below the stream service.
  let youtubeService: YouTubeService | undefined = undefined;
  let captionsStreamUseChanged: ((inUse: boolean) => void) | undefined;
  // File › Speaker's Language is built again when the language changes (alpha.22): set once the menu is made.
  let captionsMenuChanged: () => void = () => undefined;
  let conversionActivityChanged: (() => void) | undefined;
  // Trim's background work (Session 57: finished cuts checked, accepted cuts carried on, unused cuts swept), told
  // when the stream changes.
  let trimActivityChanged: (() => void) | undefined;
  // Edit slides' PDF reading waiting for the show (Session 57): each wait's check, told when the stream changes.
  const pdfReadWaits = new Set<() => void>();
  const countStreams = streamCounter((kind) => behind?.service.count(kind));
  const streamKeys = new StreamKeyStore(
    join(app.getPath('userData'), 'stream-keys.json'),
    safeStorage,
    noSafeStorage,
  );
  // The stream's page's own warm-up as it opens (Session 60, X21; the owner's answer A to Q60-1): none once a hall screen
  // here has drawn its warm-up whole at this start and the opening is over (stream/stream-warm.ts).
  const streamPageWarmUp = new StreamPageWarmUp((line) => {
    log.info(line);
  });
  // What the warm-ups made went with a GPU process that stopped (Sessions 31–36, ROB-5: Chromium starts another).
  app.on('child-process-gone', (_event, details) => {
    if (details.type === 'GPU') streamPageWarmUp.gpuGone();
  });
  stream = new StreamService({
    clockStyle: mainClockStyle,
    // No warm-up for the stream's page where Chromium draws without a graphics chip, as for the outputs (Session 58);
    // none of its own either once a hall screen here has drawn its warm-up whole at this start, the opening over
    // (Session 60, X21): what it draws with is made, and its warm-up, drawn mid-show, held the hall's frames.
    warmUpFact: (page, picture) => {
      const fact = warmUpFact(warmUps, page, 'the stream’s page');
      const none = fact.noGpu !== true && streamPageWarmUp.skips(page.webContents.id, picture);
      return none ? { warmedHere: true } : fact;
    },
    profiles: new StreamProfileRepo(db, (id) => streamKeys.has(id)),
    keys: streamKeys,
    settings,
    screens: screenRepo,
    createStreamSound: () =>
      createStreamSoundWindow((line) => {
        log.info(`Stream sound: ${line}`);
      }),
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
    // Tests: the stream worker's search for its encoder takes at least this long, as on CI's Mac (Session 55).
    encoderSearchMs: swMs('DRASHTI_TEST_ENCODER_SEARCH_MS') ?? undefined,
    recordingDrive: (folder) => onFat(folder),
    titleMarks: (marks) => {
      if (operatorWindow && !operatorWindow.isDestroyed())
        operatorWindow.setTitle(marks ? `Drashti — ${marks}` : 'Drashti');
    },
    statusChanged: (status) => {
      slideEditor?.send(IPC.stream.changed, status);
      automaticErrorRuntime?.stream(status.live.state, status.live.message);
      if (stream?.inUse()) automaticReports.cancel();
      else void automaticReports.wake();
      youtubeService?.streamChanged(status);
      captionsStreamUseChanged?.(stream?.inUse() === true);
      conversionActivityChanged?.();
      if (nothingUp(engine.current.layers) && !displayOnAir()) void refreshDisplayCopies();
      trimActivityChanged?.();
      for (const check of [...pdfReadWaits]) check();
      eventsOut.emit(streamEvents(eventsStreamWas, status));
      eventsStreamWas = status;
      // Each stream and recording started, counted for the Access List (Session 54): never what.
      countStreams(status);
      // On air or recording (or getting there): the computer stays awake for the stream too (Session 31).
      sleepGuard.setStreaming(status.live.state !== 'off' || status.recording.state !== 'off');
    },
    ffmpegPath: () =>
      findFfmpeg({
        packaged: packaged(),
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
      slideEditor?.send(IPC.screens.changed, screens.snapshot());
    },
    programChanged: () => {
      zoomWindow?.programChanged();
      videoOutService?.programChanged();
      // A cue's pages worked out again: one gone (a crash, its cap) is no longer waited for (a22-review-x86 S1).
      engine.videoCuePageJoined('');
    },
    // The stream's sound page went (a crash, its cap, closed): the same, so a waiting cue, an automatic crossfade's
    // among them, goes at its moment and the hall with it (S1). A new page joins by its own subscription.
    soundChanged: () => {
      engine.videoCuePageJoined('');
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
  // ---- scheduling on YouTube (x31) ---------------------------------------------------------------
  // The admin's own Google project signs in, in this computer's own browser; a broadcast's key goes from Google straight
  // into the stream key store, and its sign-in into a secure file of its own (youtube-sign-in.json). Going live never
  // calls Google. Tests reach only the stand-in for Google on 127.0.0.1 (DRASHTI_TEST_GOOGLE_STANDIN, which a packaged
  // Drashti never reads), and under the tests' guard (DRASHTI_TEST_LINK_GUARD) nothing else, loudly.
  const googleStandIn = sw('DRASHTI_TEST_GOOGLE_STANDIN');
  const youtube = new YouTubeService({
    secrets: new StreamKeyStore(
      join(app.getPath('userData'), 'youtube-sign-in.json'),
      safeStorage,
      noSafeStorage,
      YOUTUBE_WORDS.noStorage,
    ),
    settings,
    stream: streaming,
    call: {
      transport: electronGoogleTransport,
      onlyThisComputer: testLinkGuard,
      warn: (message) => {
        log.warn(message);
      },
    },
    endpoints: googleStandIn ? standInEndpoints(googleStandIn) : GOOGLE_ENDPOINTS,
    // The person signs in there, in the computer's own browser: Drashti never drives it.
    openBrowser: (url) => shell.openExternal(url),
    changed: (status) => {
      sendToOperator(IPC.youtube.changed, status);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    now: Date.now,
    clockStyle: mainClockStyle,
    // Tests: YouTube's state asked this often while on air (DRASHTI_TEST_YOUTUBE_STATE_MS), not 15, 20 and 60 s.
    stateMs: swMs('DRASHTI_TEST_YOUTUBE_STATE_MS') ?? undefined,
  });
  youtubeService = youtube;
  stops.add('youtube', () => {
    youtube.cancelSignIn();
  });
  // The stream's page, open before Chromium said how it draws, is sent its context again once it skips its warm-up
  // (Session 58, WU-1), as an output is.
  warmUps.follow(() => {
    const page = streaming.programContents();
    return page && !page.isDestroyed()
      ? [
          {
            id: page.id,
            name: 'the stream’s page',
            tell: () => {
              streaming.contextChanged();
            },
          },
        ]
      : [];
  });
  // No blurred copy is made while on air or recording (Session 55, D; Session 50's rule).
  blurOnAir = () => streaming.inUse() || testOnAir;
  displayOnAir = () => streaming.inUse() || testOnAir;
  streamDisplaySize = () => {
    const { width, height } = streaming.context();
    return { width, height };
  };
  void refreshDisplayCopies();

  // ---- live captions (Session 55, Part 10) ------------------------------------
  // Off until an admin turns them on (File › Live Captions…, Pro Mode); the model downloads once into the data folder.
  // Tests only (never a packaged Drashti): DRASHTI_TEST_SPEECH names placeholder phrases a stand-in engine "hears".
  const testSpeech = packaged() ? undefined : sw('DRASHTI_TEST_SPEECH');
  const whisperProgram = findWhisper({
    packaged: packaged(),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform,
    arch: process.arch,
  });
  // ---- caption and translation models (alpha.22, cap-pack) ---------------------------------------------------
  // An offline pack an admin imports (Help › Caption and Translation Models…, Pro Mode), every file checked, kept in
  // the data folder's model-packs/ (outside the library and its backups). Never fetched; nothing uses it until a
  // caption or translation engine asks (modelPacks.model / acquire): today's captions are as they were.
  const modelPacks = new ModelPackStore({ root: join(app.getPath('userData'), 'model-packs'), log });
  modelPacks.start();
  modelPacks.onChanged((status) => {
    sendToOperator(IPC.modelPacks.changed, status);
  });
  stops.add('model packs', () => {
    modelPacks.close();
  });
  const captionsData = app.getPath('userData');
  // A model of its own per language (alpha.22): the ones this copy knows (tests: DRASHTI_TEST_SPEECH_MODELS), and
  // only from the offline model pack above (the lead's Q-CAPI-2 A): no file comes in any other way.
  const languageModels = packLanguageModelStore(
    knownLanguageModels(packaged() ? undefined : sw('DRASHTI_TEST_SPEECH_MODELS')),
    modelPacks,
  );
  // Caption words (alpha.22): the admin's names and terms, kept in the library (File › Live Captions… › Caption
  // Words…, Pro Mode). The engine is given the first ones as hints; each phrase heard goes through the spelling fixer.
  const captionWords = new CaptionWordsService({
    repo: new CaptionWordsRepo(opened.db),
    pickImport: async () => {
      if (!operatorWindow || operatorWindow.isDestroyed()) return null;
      const picked = await dialog.showOpenDialog(operatorWindow, {
        title: 'Import Caption Words',
        buttonLabel: 'Import',
        properties: ['openFile'],
        filters: [{ name: 'Caption words (CSV)', extensions: ['csv', 'txt'] }],
      });
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
    pickExport: async (defaultName) => {
      if (!operatorWindow || operatorWindow.isDestroyed()) return null;
      const picked = await dialog.showSaveDialog(operatorWindow, {
        title: 'Export Caption Words',
        defaultPath: defaultName,
        buttonLabel: 'Export',
        filters: [{ name: 'Caption words (CSV)', extensions: ['csv'] }],
      });
      return picked.canceled || !picked.filePath ? null : picked.filePath;
    },
    log,
  });
  const captionsEngineProblem =
    testSpeech !== undefined
      ? null
      : (whisperProblem(process.platform, process.getSystemVersion()) ??
        (whisperProgram === null ? 'This copy of Drashti has no captions engine.' : null));
  let speakerLanguageTicked: SpeechLanguage | 'auto' | null = null;
  const captionSettingsRepo = new CaptionSettingsRepo(opened.db);
  const speechEngine =
    testSpeech !== undefined
      ? // DRASHTI_TEST_SPEECH_ONCE: each placeholder phrase heard one time (an end-to-end test corrects one).
        // DRASHTI_TEST_SPEECH_HOLD=n (cap-threads): it rests after its first phrase, as a too-slow computer does, as the
        // n-th rest in a row (3: captions then stop).
        createStandInEngine(testSpeech.split('|'), undefined, {
          once: sw('DRASHTI_TEST_SPEECH_ONCE') !== undefined,
          hold: Number(sw('DRASHTI_TEST_SPEECH_HOLD') ?? 0),
        })
      : createWhisperEngine({
          program: () => whisperProgram,
          // The speaker's language's own model when one is chosen, here and checked (alpha.22); else the general one.
          model: (language) => {
            const own = captions.languageModelFor(language);
            // Only a whisper.cpp model is ever this engine's (another format is caption AI's own route).
            const file =
              own && (own.format ?? 'whisper-ggml') === 'whisper-ggml'
                ? packFileFor(modelPacks, own)?.path
                : undefined;
            return file ?? modelFile(captionsData, captions.selectedModel());
          },
          // Asked before every start of the program: a language's own model not ready is never loaded.
          modelProblem: (language) => captions.modelProblem(language),
          fallback: (language) =>
            captions.languageModelFor(language)?.fallback ?? captions.selectedModel() !== 'turbo',
          // The tuned language models are decoded without timestamps (alpha.22).
          timestamps: (language) => captions.languageModelFor(language)?.timestamps ?? true,
          timing: () => captions.timing(),
          // Captions that have shown a phrase whole are never stopped as too slow (cap-review-threads MUST-1b).
          keptUp: () => captions.keptUp(),
          sound: { open: (chunk) => streaming.listenSound(chunk) },
          // The admin's caption words as hints (cap-glossary).
          hints: captionWords.hints,
          log,
        });
  // Route W (alpha.22, cap-integration): a Gujarati, Hindi or English model of its own from the pack, on Drashti's
  // whisper engine (the stand-in in tests), decoded as that model needs (no timestamps for the tuned ones).
  const whisperRoute = createWhisperRoute({
    store: modelPacks,
    known: (sha256) => {
      const entry = languageModels.known().find((e) => e.sha256 === sha256);
      return entry ? { fallback: entry.fallback, timestamps: entry.timestamps } : null;
    },
    // The pack's file is given back once whisper-server has exited (alpha.23); the stand-in runs no program.
    engine: (file, use, exited) =>
      testSpeech !== undefined
        ? {
            start: (language, to) => {
              const stop = speechEngine.start(language, to);
              return () => {
                stop();
                exited();
              };
            },
          }
        : createWhisperEngine({
            program: () => whisperProgram,
            model: () => file,
            fallback: () => use.fallback,
            timestamps: () => use.timestamps,
            timing: () => captions.timing(),
            keptUp: () => captions.keptUp(),
            sound: { open: (chunk) => streaming.listenSound(chunk) },
            hints: captionWords.hints,
            log,
            onExited: exited,
          }),
  });
  // Route C (alpha.22, cap-ship-c / Codex x94): AI4Bharat's IndicConformer (CTC) from the pack on Drashti's helper
  // and ONNX Runtime 1.23.2, below the show and without a transition gate (the lead's x94 gate A, as Route W).
  const indicProgram = findIndic({
    packaged: packaged(),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform,
    arch: process.arch,
  });
  // What keeps Route C from running on this computer (a Mac before 13.4, no helper): its own reason, never whisper's.
  const routeCProblem = (): string | null =>
    indicProblem(process.platform, process.getSystemVersion()) ??
    (indicProgram === null
      ? 'This copy of Drashti has no IndicConformer captions engine: reinstall Drashti to restore it.'
      : null);
  const conformerRoute = createIndicRoute({
    store: modelPacks,
    program: () => indicProgram,
    problem: () => routeCProblem(),
    admission: 'below-show',
    // Two threads (the lead, with cap-ship-c's measurement: a 2.4-3.7 s clip in 219-258 ms warm on arm64).
    threads: 2,
    // The dialog's live timing (step, pause, longest phrase, speech level), as Route W's (alpha.23, the review).
    timing: () => captions.timing(),
    sound: { open: (chunk) => streaming.listenSound(chunk) },
    log,
  });
  // Caption AI (alpha.22, cap-integration): a speaker's language with a model of its own is heard through the
  // captions coordinator (Codex x90): one clause at a time in at most two lines, provisional while heard, settled
  // when final. As heard, Sanskrit and a language without its own model keep today's captions exactly.
  const captionCoordinator = new CaptionCoordinator({
    settings: () => parseCaptionSettings(captionSettingsRepo.get()),
    show: (shown) => {
      engine.setCaptions(shown);
    },
    // The operator's review panel (Codex x90's) shows caption AI's phrase while it runs, for a correction.
    changed: (review) => sendToOperator(IPC.captions.prototypeChanged, review),
  });
  const captions: CaptionsService = new CaptionsService({
    userData: captionsData,
    platform: process.platform,
    arch: process.arch,
    repo: captionSettingsRepo,
    engine: speechEngine,
    aiPath: {
      ...ownModelCaptionAi({
        language: () => parseCaptionSettings(captionSettingsRepo.get()).language,
        ownModel: (language) => captions.languageModelFor(language),
        // Route W: the pack's file, checked again by the pack when first heard and held while heard.
        engineFor: (own) => {
          const entry = languageModels.known().find((e) => e.id === own.id);
          const found = entry ? packFileFor(modelPacks, entry) : null;
          const packed = found ? modelPacks.model(found.modelId) : null;
          if (!entry || !packed) return null;
          // Route W runs whisper.cpp's files; Route C AI4Bharat's IndicConformer (the stand-in in tests).
          if ((entry.format ?? 'whisper-ggml') === 'whisper-ggml')
            return whisperRoute.make(packed, entry.language);
          const routeC = conformerRoute.make(packed, entry.language);
          return routeC && testSpeech !== undefined ? speechEngine : routeC;
        },
      }),
      // Route C's own reason when it cannot run here (the review's S1); none for the stand-in in tests, as whisper's.
      problem: () => (testSpeech !== undefined ? null : routeCProblem()),
      coordinator: captionCoordinator,
    },
    engineProblem: () => captionsEngineProblem,
    modelReady: (id) =>
      testSpeech !== undefined || modelReady(modelFile(captionsData, id), MODEL_SOURCES[id]),
    download: (id, progress, signal) =>
      downloadModel({ dest: modelFile(captionsData, id), source: MODEL_SOURCES[id], progress, signal }),
    show: (shown) => {
      engine.setCaptions(shown);
    },
    onFinalPhrase: (phrase) => streaming.recordCaption(phrase),
    prototypeChanged: (review) => sendToOperator(IPC.captions.prototypeChanged, review),
    spell: (phrase) => captionWords.fix(phrase),
    changed: (view) => {
      videoCaptionBand = view.settings;
      engine.refreshVideoCaptions();
      sendToOperator(IPC.captions.changed, view);
      // File › Speaker's Language ticks the language as it is (alpha.22).
      if (view.settings.language !== speakerLanguageTicked) {
        speakerLanguageTicked = view.settings.language;
        captionsMenuChanged();
      }
    },
    languageModels,
    log,
  });
  captionsStreamUseChanged = (inUse) => captions.setStreamInUse(inUse);
  captions.start();
  stops.add('captions', () => {
    captionsStreamUseChanged = undefined;
    captions.close();
  });
  // The placeholder rehearsal's controls only where it is not packaged (tests): never in a shipped Drashti (review).
  // A pack imported or removed chooses caption AI's path or today's again at once, and the dialog's rows follow
  // (review S2): no turning captions off and on after importing mid-show.
  let packsShown = '';
  modelPacks.onChanged((status) => {
    // Only when the packs themselves changed (an import's progress is not a change of model).
    const packs = JSON.stringify(status.packs);
    if (packs === packsShown) return;
    packsShown = packs;
    captions.aiPathChanged();
  });
  registerCaptionPrototypeIpc({
    fromOperator: (e) => fromOperator(e) && !simpleNow(),
    captions,
    rehearsal: !packaged(),
  });
  handle(IPC.captions.view, () => captions.view());
  handle(IPC.captions.setOn, (e, on) =>
    fromOperator(e) && typeof on === 'boolean' ? captions.setOn(on) : captions.view(),
  );
  handle(IPC.captions.setModel, (e, model) =>
    fromOperator(e) && isCaptionModel(model) ? captions.setModel(model) : captions.view(),
  );
  handle(IPC.captions.setSettings, (e, settings) =>
    fromOperator(e) ? captions.setSettings(parseCaptionSettings(settings)) : captions.view(),
  );
  handle(IPC.captions.retry, (e) => (fromOperator(e) ? captions.retry() : captions.view()));
  // A model of its own per language and the live timing (alpha.22).
  handle(IPC.captions.setLanguageModel, (e, language, id) =>
    fromOperator(e) && isLanguageModelLanguage(language) && (id === null || typeof id === 'string')
      ? captions.setLanguageModel(language, id)
      : captions.view(),
  );
  handle(IPC.captions.checkLanguageModel, (e, language) =>
    fromOperator(e) && isLanguageModelLanguage(language)
      ? captions.checkLanguageModel(language)
      : captions.view(),
  );
  handle(IPC.captions.setTiming, (e, timing) =>
    fromOperator(e) ? captions.setTiming(parseCaptionTiming(timing)) : captions.view(),
  );

  handleModelPacks({
    handle,
    fromOperator,
    store: modelPacks,
    pick: async (kind) => {
      if (!operatorWindow) return null;
      const picked = await dialog.showOpenDialog(operatorWindow, {
        title: kind === 'zip' ? 'Import a Model Pack (Zip)' : 'Import a Model Pack (Folder)',
        message: 'Choose the caption and translation model pack the admin was given.',
        buttonLabel: 'Import',
        properties: kind === 'zip' ? ['openFile'] : ['openDirectory'],
        ...(kind === 'zip' ? { filters: [{ name: 'Zip', extensions: ['zip'] }] } : {}),
      });
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
  });
  const captionWordsElsewhere = () => ({
    ok: false,
    view: captionWords.view(),
    message: 'Only the operator window can do that.',
  });
  handle(IPC.captionWords.view, (e) =>
    fromOperator(e)
      ? captionWords.view()
      : { words: [], hinted: { gu: 0, hi: 0, sa: 0, en: 0 }, hintsOn: { ...CAPTION_HINTS_ON } },
  );
  handle(IPC.captionWords.set, (e, words) =>
    fromOperator(e) ? captionWords.set(words) : captionWordsElsewhere(),
  );
  handle(IPC.captionWords.import, (e) =>
    fromOperator(e) ? captionWords.importFile() : captionWordsElsewhere(),
  );
  handle(IPC.captionWords.setHints, (e, language, on) =>
    fromOperator(e) ? captionWords.setHints(language, on) : captionWordsElsewhere(),
  );
  handle(IPC.captionWords.export, (e) =>
    fromOperator(e) ? captionWords.exportFile() : captionWordsElsewhere(),
  );

  // ---- another app's window as the background (Session 48) -------------------
  // Tests only (never a packaged Drashti): windows the test opens, titled "Placeholder…", stand in for other
  // apps' (no test may need Screen Recording, or see the computer's own windows).
  const windowStandIn = packaged() ? undefined : sw('DRASHTI_TEST_WINDOW_STANDIN');
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

  // ---- a stream link on the screens (alpha.20, the playback set's slice 8; the owner's Q60-39 P3 A) ------------------
  // Show a Stream Link… (Pro Mode): an HLS or YouTube live link, received by Drashti's own FFmpeg into a short local
  // stream in its own folder, which the screens play (src/main/live-link/). The folder is emptied at each start (what a
  // crash left; its FFmpeg was stopped above with the other leftovers). A test run asks nothing of any address but
  // 127.0.0.1, and looks at YouTube links with the fake yt-dlp only.
  const streamLinkRoot = join(userDataDir, 'Stream links');
  void fsPromises.rm(streamLinkRoot, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  const streamLinkFfmpeg = findFfmpeg({
    packaged: packaged(),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform,
    arch: process.arch,
    override: sw('DRASHTI_FFMPEG'),
  });
  let lastStreamLink: string | null = null;
  const streamLinks = new LiveLinkService({
    startRelay: (args) =>
      startRelay(streamLinkFfmpeg, args, {
        started: (pid) => void leftovers.started(pid, 'stream-link'),
        ended: (pid) => {
          leftovers.forget(pid);
        },
      }),
    fetchPlaylist: (url, signal) => fetchPlaylist(url, { guard: !packaged() && anyTestSwitch(), signal }),
    lookYoutube: (url, signal) =>
      lookYoutube(url, signal, {
        work: join(userDataDir, 'Stream link look'),
        launch: (folders) =>
          youtubeLaunch(
            {
              packaged: packaged(),
              platform: process.platform,
              testing: anyTestSwitch(),
              fake: packaged() ? null : (sw('DRASHTI_TEST_FAKE_YT_DLP') ?? null),
              fakeConfig: packaged() ? null : (sw('DRASHTI_TEST_FAKE_YT_DLP_CONFIG') ?? null),
              execPath: process.execPath,
              tools: findYoutubeTools({
                packaged: packaged(),
                resourcesPath: process.resourcesPath,
                appPath: app.getAppPath(),
                platform: process.platform,
                arch: process.arch,
              }),
              ffmpeg: streamLinkFfmpeg,
            },
            folders,
          ),
        children: {
          started: (pid, group) => void leftovers.started(pid, 'yt-dlp', { group }),
          ended: (pid) => {
            leftovers.forget(pid);
          },
        },
      }),
    onAir: () => streaming.inUse() || testOnAir,
    root: streamLinkRoot,
    progress: localProgress,
    readPlaylist: localPlaylist,
    makeFolder: (dir) => {
      mkdirSync(dir, { recursive: true });
    },
    removeFolder: (dir) =>
      fsPromises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
    showLink: (link) => engine.showLink(link),
    restartLink: (linkId) => engine.restartLink(linkId),
    dropped: (linkId) => engine.linkDropped(linkId),
    clearLink: (linkId) => engine.clearLink(linkId),
    state: () => engine.current,
    changed: (status) => {
      sendToOperator(IPC.liveLink.changed, status);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    now: Date.now,
    newId: randomUUID,
    guard: !packaged() && anyTestSwitch(),
  });
  streamLinkFolder = (linkId) => streamLinks.folderOf(linkId);
  streamLinkPlaylist = (linkId, segment) => streamLinks.playlistFor(linkId, segment);
  engine.onChange(() => {
    streamLinks.follow();
  });
  stops.add('stream links', () => streamLinks.close());
  handle(IPC.liveLink.show, async (e, link) => {
    if (!fromOperator(e) || typeof link !== 'string')
      return { ok: false as const, message: 'Only the operator window can show a stream link.' };
    // Kept for this run only, to offer again (never written down: a link can hold a token); never one too long to be a link.
    lastStreamLink = link.length <= 2000 ? link.trim() : null;
    return streamLinks.show(link);
  });
  handle(IPC.liveLink.stop, (e) => {
    if (fromOperator(e)) streamLinks.stop();
    return null;
  });
  handle(IPC.liveLink.status, () => streamLinks.view());
  handle(IPC.liveLink.last, (e) => (fromOperator(e) ? lastStreamLink : null));
  // Any of Drashti's own pages that plays it (a screen, LIVE, a card, a stage screen's box, the audio player).
  handle(IPC.liveLink.join, (_e, linkId) => (typeof linkId === 'string' ? streamLinks.join(linkId) : null));

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

  // ---- video out (x30): the stream's picture to other software ---------------------
  // Off until someone turns it on (then kept over a restart). On, the stream's page is kept open and its own capture
  // gives each frame to the video-out process as well; frames never pass through here (src/main/video-out/).
  const videoOut = new VideoOutService({
    readSetting: () => settings.get('videoOut'),
    writeSetting: (value) => {
      settings.set('videoOut', value);
    },
    sender: () =>
      videoOutSender({
        standIn: sw('DRASHTI_TEST_VIDEO_OUT_STAND_IN') ?? null,
        platform: process.platform,
        arch: process.arch,
        packaged: packaged(),
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
      }),
    holdProgram: (on) => {
      streaming.setVideoOut(on);
    },
    pairProgram: (port) => streaming.pairVideoOut(port),
    channel: videoOutChannel,
    spawnWorker: () =>
      spawnVideoOutWorker((line) => {
        log.info(`[video out] ${line}`);
      }),
    log: (level, line) => {
      if (level === 'warn') log.warn(line);
      else log.info(line);
    },
    changed: (status) => {
      sendToOperator(IPC.stream.videoOutChanged, status);
    },
    now: Date.now,
    later: (run, ms) => {
      setTimeout(run, ms).unref();
    },
  });
  videoOutService = videoOut;
  videoOut.start();
  stops.add('video out', () => {
    videoOut.close();
  });
  // A passage fits where the live Look shows it: audience and key and fill groups, and the stream's
  // lower third while it is on air or recording in its Camera layout.
  passageTargets = () => {
    const look = engine.snapshot().state.look;
    const context = streaming.context();
    const camera = context.layout === 'camera' && context.capturing;
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

  // ---- Simple Mode ----------------------------------------------------------------
  // The mode is kept in the library's settings as it changes. Since Session 20 a start after a clean
  // quit begins in Pro Mode; after an unexpected stop Drashti comes back in the mode it was in, so the
  // operator carries on. The same answer as restart recovery's: did the last run stop unexpectedly, less
  // than RECOVERY_MAX_AGE_MS ago? A stop longer ago starts like a clean quit (Session 21). Simple Mode
  // is a way of working, never a lock (Session 54, E5: roles and PINs are gone), but with Simple access
  // (Session 55, the list's answer) it is all this computer may use: mode-keeper.ts holds it there, and
  // brings Pro Mode back by itself when Pro access comes again, if the access put it in Simple Mode.
  let mode: OperatorMode = 'pro';
  let rebuildMenu: () => void = () => undefined;
  // The Lower Thirds studio closes in Simple Mode (Session 55, Part 16): set once it is made, below. (The slide
  // editor's window stays: Simple Mode edits the slides of what its playlists hold since Session 56.)
  let closeStudio: () => void = () => undefined;
  let cancelSourceEdits: () => void = () => undefined;
  let drainSourceEdits: () => Promise<void> = () => Promise.resolve();
  let cancelPdfCopies: () => void = () => undefined;
  let drainPdfCopies: () => Promise<void> = () => Promise.resolve();
  let drainKirtanExports: () => Promise<void> = () => Promise.resolve();
  // Simple Mode's playlist (Session 55, Part 18): the playlist open in Pro Mode when Drashti switched to Simple Mode, or
  // a new one when there was none; since Session 56 whichever its window opens after that (simple-playlist.ts).
  const simplePlaylist = new SimplePlaylist({
    saved: settings.get('simplePlaylist'),
    save: (id) => {
      laterSetting('simplePlaylist', id);
    },
    usable: (id) => playlists.tree().some((n) => n.id === id && !n.isFolder),
    empty: (id) => playlists.tree().find((n) => n.id === id)?.itemCount === 0,
    create: () => {
      // Never named as a playlist the operator deleted (alpha.15): "Sabha, 30 Oct 2026 (2)" after the day's own was
      // deleted, so the new, empty one is never taken for the deleted one come back after a restart.
      const id = playlists.createAtTop(freeName(playlists, simplePlaylistName(new Date()), true));
      sendToOperator(IPC.playlists.changed, { at: Date.now() });
      network?.hint('playlists');
      return id;
    },
    log: (line) => {
      log.info(line);
    },
  });
  // Simple Mode Features (alpha.22; the owner's "the features can be brought to simple mode, only 1-2 and max 3"): which
  // of Pro Mode's tools Simple Mode has, kept with the library as the mode is, none to begin with. Simple Mode's lock
  // and the engine read it as each request comes, so a tool turned off ends at once.
  const simpleFeatures = new SimpleFeaturesKeeper({
    saved: settings.get('simpleFeatures'),
    save: (chosen) => {
      laterSetting('simpleFeatures', chosen);
    },
    changed: (chosen) => {
      sendToOperator(IPC.app.simpleFeaturesChanged, { chosen: [...chosen] });
    },
    log: (line) => {
      log.info(line);
    },
  });
  simpleChosen = () => simpleFeatures.chosen();
  const modes = new ModeKeeper({
    saved: { mode: settings.get('operatorMode'), byAccess: settings.get('simpleByAccess') },
    recentStop: startup.recentStop,
    cleanQuit: startup.cleanQuit,
    access: () => accessState().mode,
    save: (next, byAccess) => {
      laterSetting('operatorMode', next);
      laterSetting('simpleByAccess', byAccess);
    },
    changed: (next) => {
      mode = next;
      // Its playlist first, so the window opens it as it shows Simple Mode.
      if (next === 'simple') simplePlaylist.adopt();
      rebuildMenu();
      if (next === 'simple') {
        closeStudio();
        closeStagePreview();
      }
      sendToOperator(IPC.app.modeChanged, { mode: next });
      // A phone's Add photos (Session 55, Part 8) go to Pro Mode's open playlist, and in Simple Mode its pictures to
      // Simple Mode's playlist (question 5): the phones hear of the change.
      network?.uploadsChanged();
      // And (Part 9) a phone shows only what Simple Mode allows, and opens its playlist: it reads the hall again.
      network?.hint('mode');
    },
    menu: () => {
      rebuildMenu();
    },
    log: (line) => {
      log.info(line);
    },
  });
  mode = modes.mode;
  // A start in Simple Mode (after an unexpected stop in it, or with Simple access): its playlist from before.
  if (mode === 'simple') simplePlaylist.keep();
  // The list's answer each check: Simple access puts this computer in Simple Mode within one check.
  onAccessChange(() => {
    modes.accessChanged();
    if (!isLetIn() || simpleAccess()) {
      cancelSourceEdits();
    }
  });
  simpleNow = () => mode === 'simple';
  /**
   * Simple Mode's open playlist and what it holds, and (Session 56) every playlist and folder as the bounds read them,
   * read as each request comes (simple-mode.ts's bounds).
   */
  const simpleScope = (): SimpleScope => {
    const one = simplePlaylist.current();
    const rows = () => (one === null ? [] : playlists.itemsOf(one));
    return {
      playlistId: one,
      playlistOf: (itemId) => playlists.playlistOf(itemId),
      holdsMedia: (mediaId) => rows().some((i) => i.kind === 'media' && i.mediaId === mediaId),
      holdsPresentation: (presentationId) =>
        rows().some((i) => i.kind === 'presentation' && i.presentationId === presentationId),
      kindOf: (id) => playlists.kindOf(id),
      listsMedia: (mediaId) => playlists.listsMedia(mediaId),
      listsPresentation: (presentationId) => playlists.listsPresentation(presentationId),
      // Session 56: Audio's tracks (its right-click Trim and Rename), and what an edit kept for Undo covers (made
      // below, before any request reaches the lock).
      inMusic: (mediaId) =>
        musicService?.view().playlists.some((p) => p.tracks.some((t) => t.mediaId === mediaId)) ?? false,
      revisionCovers: (revisionId) => revisions.covers(revisionId),
    };
  };
  /** Simple Mode's phone controls use every active playlist, with the same bounds as the window. */
  const simplePhones = (): SimplePhoneScope | null =>
    mode === 'simple'
      ? {
          ...simpleScope(),
          activePlaylist: (id) => playlists.activePlaylist(id),
          activeItem: (id, itemId) => playlists.activeItem(id, itemId),
          plays: (id, from) => playlists.playsPresentation(id, from),
          refusal: () => simplePhoneRefusalText(modes.simpleOnly()),
        }
      : null;
  // While it is on, every request that would change the library, screens or sound is refused here, but what Simple
  // Mode offers (Session 55, Part 18), each within its bounds.
  lockChannels(
    () => mode === 'simple',
    simpleModeRefusals(
      () => audioOutput.status,
      () => simpleRefusalText(modes.simpleOnly()),
    ),
    simpleModeBounds(simpleScope, () => simpleFeatures.chosen()),
  );
  handle(IPC.app.getMode, () => mode);
  // The playlist Simple Mode shows (Session 55, Part 18): null in Pro Mode.
  handle(IPC.app.simplePlaylist, () => (mode === 'simple' ? simplePlaylist.current() : null));
  // Edit › Simple Mode Features… (alpha.22): read in either mode; changed in Pro Mode only (Simple Mode's lock refuses
  // it before it comes here), at most three.
  handle(IPC.app.simpleFeatures, () => [...simpleFeatures.chosen()]);
  handle(IPC.app.setSimpleFeature, (e, feature, on) => {
    if (!fromOperator(e))
      return { ok: false as const, message: 'Only the operator window can choose Simple Mode’s tools.' };
    return simpleFeatures.set(feature, on);
  });
  handle(IPC.app.setMode, (e, wanted): ModeResult => {
    if (!fromOperator(e) || !isOperatorMode(wanted))
      return { ok: false, message: 'Only the operator window can switch the mode.' };
    return modes.request(wanted);
  });
  const switchMode = () => {
    // Either way at once (nothing to type since Session 55, Part 18); Pro Mode never with Simple access.
    modes.menuSwitch();
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
      // Renditions are known before an imported item is first drawn as a thumbnail.
      looksChanged();
      sendToOperator(IPC.library.changed, { at: lastChanged, what: 'presentations' });
      // The slide editor's own window: its pictures, videos and sounds to choose from (Session 55, Part 17a).
      slideEditor?.send(IPC.library.changed, { at: lastChanged, what: 'presentations' });
      network?.hint('presentations');
      // What the nodes should copy may have changed.
      wantedMedia?.invalidate();
      nodeService?.libraryChanged();
      // A sharpened picture's file may have come back, or gone (Session 26f).
      void sharpened.refresh();
      void refreshDisplayCopies();
      // A sound in an audio playlist may have been converted, found or lost.
      if (musicService) sendToOperator(IPC.music.changed, musicService.view());
      // A wallpaper's picture may have been deleted, found or lost (Session 55, Part 6).
      wallpaperService?.mediaChanged();
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
  /** Message templates or Shastra texts changed: the operator's lists of them reload at once. */
  const listChanged = (what: Exclude<LibraryChange, 'presentations'>) => {
    sendToOperator(IPC.library.changed, { at: Date.now(), what });
    network?.hint(what);
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
    // Several pages at once (Session 56) only while nothing is up on the screens and the stream is neither on air nor
    // recording: an import never takes from the show.
    wide: () => !(streaming.inUse() || testOnAir) && nothingUp(engine.snapshot().state.layers),
  });
  const documentReaders = new SourceReaderQueue(
    sourceReader((request) => pdfPictures.readEditable(request), pptxReader(spawnPptxReaderWorker)),
  );
  const pdfGeometry = new PdfPrintGeometry();
  const pdfCopies = new PdfCopySession({
    open: createPdfCopyWindow,
    scaleFactor: (win) => electronScreen.getDisplayMatching(win.getBounds()).scaleFactor,
    assetDirs: (kind) => {
      const folder = kind === 'wasmUrl' ? 'wasm' : kind === 'cMapUrl' ? 'cmaps' : 'standard_fonts';
      return [
        join(rendererDir(), 'pdfjs', folder),
        join(app.getAppPath(), 'node_modules', 'pdfjs-dist', folder),
      ];
    },
    normalize: pdfGeometry.normalize,
    // A phone's picture leaves Main as its pixels (C6's review): their byte order on this computer.
    pixelOrder: capturedPixelOrder,
  });
  handle(IPC.pdfExport.job, (e) => pdfCopies.job(e.sender));
  handle(IPC.pdfExport.capture, (e, id, index) => pdfCopies.capture(e.sender, id, index));
  handle(IPC.pdfExport.print, (e, id, index) => pdfCopies.print(e.sender, id, index));
  handle(IPC.pdfExport.normalized, (e, id, index, pages) => pdfCopies.normalized(e.sender, id, index, pages));
  handle(IPC.pdfExport.done, (e, result) => pdfCopies.done(e.sender, result));
  handle(IPC.pdfExport.asset, (e, kind, name) => pdfCopies.asset(e.sender, kind, name));
  stops.add('PDF copies', () => {
    pdfCopies.stop();
    return pdfGeometry.stop();
  });
  let sourceOutputQuarantined = false;
  documentQuit = new SourceQuitGate({
    cancel: () => cancelSourceEdits(),
    stop: async () => {
      pdfPictures.stopEditable();
      pdfCopies.stop();
      await Promise.all([
        documentReaders.stop(),
        drainSourceEdits(),
        pdfGeometry.stop(),
        drainPdfCopies(),
        drainKirtanExports(),
      ]);
      // A bounded retainOutput fallback is not confirmation that an owned writer/process stopped.
      return !sourceOutputQuarantined && pdfGeometry.exitConfirmed;
    },
  });
  stops.add('document preparation', () => {
    pdfPictures.stopEditable();
    return documentReaders.stop();
  });
  handle(IPC.pictures.job, (e) => pdfPictures.job(e.sender));
  handle(IPC.pictures.page, (e, page) => pdfPictures.page(e.sender, page));
  handle(IPC.pictures.done, (e, done) => {
    pdfPictures.done(e.sender, done);
    return null;
  });
  handle(IPC.pictures.asset, (e, kind, name) => pdfPictures.asset(e.sender, kind, name));
  // ---- book OCR (alpha.21, the owner's Q60-58: "A, Tesseract inside") ----------------------------------
  // New presentation's Read Words from a Page…: scanned pictures, or a PDF's pages drawn by the pictures window, read
  // by Tesseract inside Drashti in a reading process of their own (src/main/ocr/), never on Main's thread.
  const readWords = registerReadWordsIpc({
    fromOperator,
    choose: async () => {
      if (!operatorWindow || operatorWindow.isDestroyed()) return null;
      const picked = await dialog.showOpenDialog(operatorWindow, {
        title: 'Choose scanned pages to read the words of',
        buttonLabel: 'Read Words',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Scanned pages (pictures or a PDF)', extensions: [...READ_WORDS_PICTURES, 'pdf'] }],
      });
      return picked.canceled ? null : picked.filePaths;
    },
    drawPages: (pdf, outDir, pages, signal) =>
      pdfPictures.drawForReading(pdf, outDir, pages, READING_PAGE, signal),
    startReader: (pages, said) =>
      startReader(join(__dirname, 'ocr-worker.js'), builtOcrFiles(__dirname), pages, said),
    tempDir: () => fsPromises.mkdtemp(join(tmpdir(), 'drashti-read-words-')),
    progress: (progress) => {
      sendToOperator(IPC.library.readWordsProgress, { progress });
    },
    log: (line) => {
      log.info(line);
    },
  });
  stops.add('reading words', () => {
    readWords.stop();
  });
  // ---- the guides inside Drashti (Sessions 31–36) -------------------------------------------------
  // Read from the files beside the app, for the operator window only. Simple Mode is given the operator's
  // and the presenter's guides: the admin's and the setup day's are about setting Drashti up, Pro Mode's.
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
        // With Simple access (Session 55) no way to Pro Mode is offered, in words either.
        message: modes.simpleOnly()
          ? 'That guide is read in Pro Mode, which this computer’s access does not include: ask the person who looks after Drashti.'
          : 'That guide is read in Pro Mode: double-click Pro Mode at the top right, or ask the admin.',
      };
    const text = guideFiles.read(guide.id);
    return text === null
      ? { ok: false, message: 'This guide is missing from Drashti’s folder: install Drashti again.' }
      : { ok: true, text, sizes: guideFiles.sizesFor(text) };
  });
  // ---- the Drashti Manual (x37, Session 60) ---------------------------------------------------------
  // Read from the files beside the app, for the operator window only, in either mode (reading it changes nothing);
  // printed, or saved as a PDF where the person chooses, from a hidden window of its own (manual-print.ts).
  handle(IPC.manual.read, (e) =>
    fromOperator(e)
      ? readManual(guideFiles)
      : { ok: false, message: 'Only Drashti’s own window can read the manual: open it from Help.' },
  );
  // Every printer's one test (the Manual's, a running order's, a kirtan's words'; shared/print-waits.ts): never while
  // the show is live (the lead's call of 20 Nov 2026): anything up, or the stream on air or recording, as Trim's and
  // the conversions' background work waits; since alpha.22 also while a video waits at Cue or goes out in a crossfade
  // (a22-review-print S1). A test can say the stream is on air.
  const printingLive = () => testOnAir || printWaits(engine.current, streaming.inUse());
  const manualPrinter = new ManualPrinter({
    files: guideFiles,
    live: printingLive,
    version: () => app.getVersion(),
    tempDir: () => app.getPath('temp'),
    suggestedFolder: () => testDownloadsDir ?? app.getPath('documents'),
    askWhere: async (suggested) => {
      if (!operatorWindow) return null;
      const picked = await dialog.showSaveDialog(operatorWindow, {
        title: 'Save the manual as a PDF',
        defaultPath: suggested,
        buttonLabel: 'Save',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (picked.canceled || !picked.filePath) return null;
      return picked.filePath.toLowerCase().endsWith('.pdf') ? picked.filePath : `${picked.filePath}.pdf`;
    },
  });
  const notFromOperator = {
    ok: false,
    cancelled: false,
    message: 'Only Drashti’s own window can print the manual: open it from Help.',
  } as const;
  handle(IPC.manual.print, (e) => (fromOperator(e) ? manualPrinter.print() : notFromOperator));
  handle(IPC.manual.pdf, (e) => (fromOperator(e) ? manualPrinter.pdf() : notFromOperator));
  // ---- a singers' sheet (alpha.22): Print words… and Save words as PDF… of a presentation -------------------------
  // Pro Mode's (simple-mode.ts), from the operator window only, never while the show is live (the Manual's rule), from
  // the Manual's hidden window (words-print.ts). It only reads the library.
  const wordsPrinter = new WordsPrinter({
    read: (id) => {
      const name = presentations.get(id)?.name;
      const rows = name === undefined ? null : presentations.content(id);
      return name === undefined || !rows ? null : { name, rows };
    },
    live: printingLive,
    tempDir: () => app.getPath('temp'),
    suggestedFolder: () => testDownloadsDir ?? app.getPath('documents'),
    askWhere: async (suggested) => {
      if (!operatorWindow) return null;
      const picked = await dialog.showSaveDialog(operatorWindow, {
        title: 'Save the words as a PDF',
        defaultPath: suggested,
        buttonLabel: 'Save',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (picked.canceled || !picked.filePath) return null;
      return picked.filePath.toLowerCase().endsWith('.pdf') ? picked.filePath : `${picked.filePath}.pdf`;
    },
  });
  const wordsNotFromOperator = {
    ok: false,
    cancelled: false,
    message: 'Only the operator window can print a presentation’s words.',
  } as const;
  handle(IPC.library.printWords, (e, presentationId) => {
    const id = idSchema.safeParse(presentationId);
    if (!fromOperator(e) || !id.success) return wordsNotFromOperator;
    return wordsPrinter.print(id.data);
  });
  handle(IPC.library.saveWordsPdf, (e, presentationId) => {
    const id = idSchema.safeParse(presentationId);
    if (!fromOperator(e) || !id.success) return wordsNotFromOperator;
    return wordsPrinter.pdf(id.data);
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
  // A deck's import cut short last time (Session 54, C review): its copies in PowerPoint's folder and its work folders.
  // Tests only (never a packaged Drashti): PowerPoint's folder is this one instead, and what the start does in it is
  // counted (globalThis.drashtiTestOfficeFolder), so a test can see a start leave it alone (Session 56).
  const testOffice = packaged() ? undefined : sw('DRASHTI_TEST_OFFICE_FOLDER');
  const officeSeen = { touched: 0, done: false };
  if (testOffice !== undefined)
    (globalThis as { drashtiTestOfficeFolder?: () => typeof officeSeen }).drashtiTestOfficeFolder = () => ({
      ...officeSeen,
    });
  void clearDeckLeftovers({
    copies: new OfficeCopies(officeCopiesFile(userDataDir)),
    ...(testOffice !== undefined ? { office: testOffice } : {}),
    touched: () => {
      officeSeen.touched++;
    },
  })
    .catch(() => 0)
    .then(() => {
      officeSeen.done = true;
    });
  // Tests only (never a packaged Drashti): imports judge media by their headers alone, as before Session 50,
  // and nothing is converted by itself, so a test can try Convert as an operator does.
  const noConvertAtImport = !packaged() && sw('DRASHTI_TEST_NO_CONVERT_AT_IMPORT') === '1';
  // Whether this computer plays HEVC video (Session 51): Chromium says once the operator window has opened, asked in
  // a page of its own (below, question 36), and each import converts HEVC by itself where it cannot; one starting
  // before the answer waits for it (15 s at most). Tests only (never a packaged Drashti): the answer given ('1' plays,
  // '0' cannot), as no test can rely on a real HEVC decoder.
  const testPlaysHevc = packaged() ? undefined : sw('DRASHTI_TEST_PLAYS_HEVC');
  const givenHevc = testPlaysHevc === '1' ? true : testPlaysHevc === '0' ? false : null;
  // Tests only (question 36): the question's answer comes this late (DRASHTI_TEST_HEVC_ANSWER_MS), as Chromium's
  // did on CI's Mac late in a run; with an answer given, that is what comes then, not known from the start.
  const hevcHoldMs = swMs('DRASHTI_TEST_HEVC_ANSWER_MS');
  const hevcTest = hevcHoldMs === null ? null : { holdMs: hevcHoldMs, given: givenHevc };
  const hevc = new HevcAnswer(hevcTest === null ? givenHevc : null);
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
      converters: packaged()
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
            packaged: packaged(),
            resourcesPath: process.resourcesPath,
            appPath: app.getAppPath(),
            platform: process.platform,
            arch: process.arch,
            override: sw('DRASHTI_FFMPEG'),
          }),
      // Tests only (never a packaged Drashti; Session 56's timing check): the stand-in's movie this many lines high, as
      // PowerPoint's own is (1080), and only these apps for a deck (DRASHTI_TEST_DECK_APPS=keynote: Keynote's times).
      standInLines: packaged() ? null : swMs('DRASHTI_TEST_DECK_BAKER_LINES'),
      deckApps: packaged() ? null : deckAppsOf(sw('DRASHTI_TEST_DECK_APPS')),
      // Tests only (never a packaged Drashti; Session 56): the stand-in holds its movie until this file is there, so a
      // test sees a deck's slides preparing.
      standInHold: packaged() ? null : (sw('DRASHTI_TEST_DECK_BAKER_HOLD') ?? null),
    },
    drawPdf: (pdf, outDir, signal, readPageText) => pdfPictures.draw(pdf, outDir, signal, readPageText),
    prepareDisplay: (candidate, signal) => displayCopies.prepare(candidate, signal),
    // A deck with its animations where this computer's setting says so (Session 54, C2 and its review). Tests only
    // (never a packaged Drashti): a stand-in makes its movie, or (with the stand-ins or no converter above) no
    // deck's movie is made, as on a computer with no app for it.
    baker: () =>
      packaged()
        ? deckAnimations
        : sw('DRASHTI_TEST_DECK_BAKER') === '1'
          ? 'stand-in'
          : sw('DRASHTI_TEST_NO_CONVERTER') === '1' || sw('DRASHTI_TEST_DECK_CONVERTER') === '1'
            ? false
            : deckAnimations,
    // No deck's movie is made while the stream is on air or recording (Session 54, C2; Session 50's rule).
    onAir: () => streaming.inUse() || testOnAir,
    playsHevc: () => hevc.wait(),
    // HEVC's other kinds, as the window said with its answer (Session 60, x36), read as the import starts.
    hevcKinds: () => hevc.kinds,
    // Each import starts only once no transition runs on the screens (alpha.21, Q60-60 A).
    quiet: () => importQuiet?.() ?? Promise.resolve(),
    transitionsEndAt: () => importTransitionsEnd?.() ?? null,
    // While an import runs, its own connection copies the WAL into the library file, never a write of Main's (Session
    // 58: such a write copied the import's pages and waited for the disk on the main thread).
    running: leaveCopyingToImports(libraryDb),
    onProgress: (progress) => {
      sendToOperator(IPC.library.importProgress, progress);
    },
    onWrote: ({ presentationId, replaced }) => {
      perfWatch?.note('import wrote a presentation');
      if (replaced) slides.invalidate(presentationId);
      libraryChanged();
    },
    // Points an import gave a file (Session 54): what is up playing it moves to them at once, as for points saved
    // while it plays (Markers), never only once it goes up again.
    onMarked: (mediaIds) => {
      for (const mediaId of mediaIds) engine.refreshMarkers(mediaId);
    },
    onAutoMarked: (mediaIds) => engine.holdPoints(mediaIds),
    onFinished: (run) => {
      // An import can change what comes next (a replaced presentation, a filled playlist). It can also find a file
      // the library was missing (Find missing media…, or the same file imported again): the slides are read again,
      // so one whose background it is puts it up from now on (Session 52: while it is missing, the background stays
      // as it was), and the slide up names it as missing no more.
      slides.invalidate();
      engine.refreshVideoCaptions();
      engine.refreshFiles();
      engine.refreshNext();
      libraryChanged(true);
      // It may have loaded a book (or loaded one again): its passages in playlists are there now, so the playlists
      // are read again, in the window and on the phones (alpha.15, the owner's answer of 4 Nov 2026).
      listChanged('shastra');
      if (run && loadedBooks(importRepo.report(run.id))) {
        sendToOperator(IPC.playlists.changed, { at: Date.now() });
        network?.hint('playlists');
      }
      // Or a calendar.
      calendarService?.refresh();
      // What it found Drashti's player cannot play is converted by itself (Session 50): one file at a time,
      // a moment after the import, never while the stream is on air or recording.
      if (run) conversions.convertImported(importRepo.report(run.id));
      // The photos it brought in have their blurred copies made now, one at a time (Session 55, D).
      if (run)
        blurred.want(
          (importRepo.report(run.id)?.items ?? []).flatMap((item) =>
            item.target?.kind === 'media' && fillsWithBlur(item.target.id, media.look(item.target.id))
              ? [item.target.id]
              : [],
          ),
        );
      // Each import, counted for the Access List (Session 54): never what.
      if (run) {
        behind?.service.count('imports');
        automaticErrorRuntime?.event('import-completed');
      }
      // Its videos and sounds measured a moment later (Session 55, Part 7); a From a Link… import's videos trimmed past
      // their black and silence too. Bytes it brought back may be new: every file's sound is read from the library again.
      if (run) {
        soundKnown.clear();
        const items = importRepo.report(run.id)?.items ?? [];
        // By the files' own paths, known before the import began (its run's id comes to the link service after this).
        const media = (fromLink: boolean) =>
          items.flatMap((i) =>
            i.target?.kind === 'media' && linkPaths.has(i.sourcePath) === fromLink ? [i.target.id] : [],
          );
        soundPass.imported(media(false), false);
        soundPass.imported(media(true), true);
        for (const i of items) linkPaths.delete(i.sourcePath);
      }
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
  importDisplayHeld = (waiting) => {
    imports.displayHeld(waiting);
  };
  stops.add('imports', () => {
    imports.stop();
  });
  // An operator's edit during an import (Session 16) waits for the import to give way between files.
  // Starting and stopping video recording had the same wait before Simple Mode gained Record.
  const edits = new Set<string>([
    ...SIMPLE_MODE_LOCKED,
    ...SIMPLE_MODE_BOUNDED.keys(),
    IPC.stream.startRecording,
    IPC.stream.stopRecording,
  ]);
  edits.add(IPC.playlists.setPlayOptions);
  for (const c of [IPC.library.importPaths, IPC.library.pickImportPaths, IPC.library.relinkMedia])
    edits.delete(c);
  // The slide editor's picture import joins the same queue.
  edits.delete(IPC.slideEditor.addPicture);
  // Its file reads and queued import finish before playlistFileWrite takes the library’s write lock.
  edits.delete(IPC.playlists.importM3u);
  // Export reads the library and writes only the chosen file; no library write lock spans its dialog.
  edits.delete(IPC.playlists.exportM3u);
  // A running order only reads the library (alpha.22): copied, printed or saved where the person chooses.
  edits.delete(IPC.playlists.copyRunningOrder);
  edits.delete(IPC.playlists.printRunningOrder);
  edits.delete(IPC.playlists.saveRunningOrderPdf);
  // So do Print words… and Save words as PDF… (a singers' sheet, alpha.22).
  edits.delete(IPC.library.printWords);
  edits.delete(IPC.library.saveWordsPdf);
  // These wait for the write lock themselves, after the file dialog and background reading have ended.
  edits.delete(IPC.videoCaptions.add);
  edits.delete(IPC.videoCaptions.select);
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

  // What holds a save the operator asked for (alpha.22, the owner's "Trim on a row"; shared/save-waits.ts): a row's
  // Trim, Edit Video's Save and Export clip… wait only while a video or a sound plays, the stream is on air (the tests'
  // hook too) or a recording goes on, never for a still slide, a picture or the Wallpaper up; in the operator's words.
  const saveWaits = (): string | null =>
    saveWaitsFor(engine.current, {
      onAir: testOnAir || streaming.wanted().live,
      recording: streaming.wanted().recording,
    });
  const saveIdle = () => saveWaits() === null;
  // ---- converting media Drashti cannot play -----------------------------------------
  const conversions = new ConvertService({
    prepareDisplay: (candidate, signal) => displayCopies.prepare(candidate, signal),
    db: libraryDb,
    mediaDir,
    // Every video and sound FFmpeg never read, read once at idle moments (alpha.20, "Plays anything"); not in a test
    // that judges files by their headers alone, as before Session 50.
    reread: !noConvertAtImport,
    children: {
      started: (pid, partFile) => void leftovers.started(pid, 'conversion', { partFile }),
      ended: (pid) => {
        leftovers.forget(pid);
      },
    },
    ffmpegPath: () =>
      findFfmpeg({
        packaged: packaged(),
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
    showBusy: () => !nothingUp(engine.current.layers),
    saveBusy: saveWaits,
    freeBytes: diskFreeBytes,
    changed: (jobs) => {
      sendToOperator(IPC.media.conversionsChanged, jobs);
    },
    libraryChanged: () => {
      // What is on the screens keeps playing the original; slides read from now on use the copy. Every presentation's
      // slides are read again (Session 52: not only those it moved), as a copy whose bytes were deleted from the
      // library before brings that file back for every slide that names it, no longer missing (the slide up too).
      slides.invalidate();
      engine.refreshFiles();
      engine.refreshNext();
      libraryChanged(true);
      sendToOperator(IPC.playlists.changed, { at: Date.now() });
      network?.hint('playlists');
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    // The conversions not finished, kept with the library's settings (Session 51): those waiting or going on when
    // Drashti quits or stops start again by themselves at its next start (resumeWaiting, below).
    kept: {
      load: () => settings.get('conversionsWaiting'),
      save: (mediaIds) => {
        laterSetting('conversionsWaiting', mediaIds);
      },
    },
  });
  const videoAnalysis = new VideoAnalysisService({ mediaDir, row: (id) => media.about(id), conversions });
  const analysisResume = setTimeout(() => videoAnalysis.resume(), AFTER_START_MS);
  stops.add('video analysis', () => {
    clearTimeout(analysisResume);
    videoAnalysis.close();
  });
  handle(IPC.media.videoAnalysis, (e, mediaId, audioStream, retry) =>
    fromOperator(e) &&
    typeof mediaId === 'string' &&
    MEDIA_ID_PATTERN.test(mediaId) &&
    (typeof audioStream === 'number' || audioStream === null) &&
    typeof retry === 'boolean'
      ? videoAnalysis.get(mediaId, audioStream, retry)
      : { ok: false as const, message: 'Open the video in the operator window, then try again.' },
  );
  const videoCopies = registerVideoCopies({
    editedExport: (request) =>
      editedClipSource(request, {
        mediaDir,
        sourceId: (id) => videoEdits.sourceId(id),
        row: (id) => media.about(id),
        read: (id) => videoEdits.read(id),
        plan: editPlan,
      }),
    sourceId: (id) => videoEdits.sourceId(id),
    db: libraryDb,
    media,
    mediaDir,
    conversions,
    fromOperator,
    proMode: () => mode === 'pro',
    idle: () => !streaming.inUse() && !testOnAir && nothingUp(engine.current.layers),
    // Export clip… (and Also add the clip to Media) is a save the operator asked for (alpha.22).
    saveIdle,
    gpuStatus,
    freeBytes: diskFreeBytes,
    pickDest: async (name, container) => {
      if (!operatorWindow || operatorWindow.isDestroyed()) return null;
      const picked = await dialog.showSaveDialog(operatorWindow, {
        title: 'Export video clip',
        defaultPath: name,
        buttonLabel: 'Export',
        filters: [{ name: container === 'mp4' ? 'MP4 video' : 'WebM video', extensions: [container] }],
      });
      return picked.canceled ? null : picked.filePath;
    },
    showFile: (path) => shell.showItemInFolder(path),
    libraryChanged: () => libraryChanged(true),
    // Combine videos…' Also save a copy to a file: Export…'s own save dialog (media:export-file, below).
    exportDialog: async (name) => {
      if (!operatorWindow || operatorWindow.isDestroyed()) return null;
      const picked = await dialog.showSaveDialog(operatorWindow, {
        title: 'Export video',
        defaultPath: join(testDownloadsDir ?? app.getPath('downloads'), name),
        buttonLabel: 'Export',
      });
      return picked.canceled || !picked.filePath ? null : picked.filePath;
    },
  });
  proxySourceOf = (id) => videoCopies.proxies.sourceOf(id);
  proxyReadyFor = (id) => videoCopies.proxies.readyFor(id);
  stops.add('video copies', () => videoCopies.close());
  const editedCopies = new EditService({
    repo: videoEdits,
    mediaDir,
    source: (id) => {
      const row = media.kindAndFile(id);
      const named = media.kindAndName(id);
      return row?.kind === 'video' && !row.missing && named
        ? { path: join(mediaDir, row.path), name: named.name }
        : null;
    },
    idle: saveIdle,
    conversions,
    register: (file, info, name, signal) =>
      registerEditedFile({
        db: libraryDb,
        mediaDir,
        file,
        info,
        name,
        signal,
        idle: saveIdle,
        freeBytes: diskFreeBytes,
        write: sourceWrite(libraryDb, () => imports.giveWay()),
      }),
    changed: (edit) => {
      sendToOperator(IPC.media.videoEditChanged, edit);
      libraryChanged(true);
    },
    write: sourceWrite(libraryDb, () => imports.giveWay()),
  });
  stops.add('video edits', () => editedCopies.close());
  conversionActivityChanged = () => conversions.activityChanged();
  let displayWasIdle = nothingUp(engine.current.layers) && !displayOnAir();
  const offDisplayActivity = engine.onChange(() => {
    const idle = nothingUp(engine.current.layers) && !displayOnAir();
    if (idle && !displayWasIdle) void refreshDisplayCopies();
    displayWasIdle = idle;
  });
  stops.add('display activity', offDisplayActivity);
  const offConversionActivity = engine.onChange((state) => {
    if (!nothingUp(state.layers)) conversions.activityChanged();
  });
  stops.add('conversions', () => {
    conversionActivityChanged = undefined;
    offConversionActivity();
    conversions.close();
  });
  // ---- Drashti's own sound with everything else (Session 55, Part 7; main/sound/, shared/sound.ts) ----------------
  // Each video's and sound's loudness and length read once in the background (an import's first, the library's a
  // while after the start), and a From a Link… video's points set past its black and silence (never on air).
  /** The files a From a Link… download gave the import, by path, until the import has read them. */
  const linkPaths = new Set<string>();
  const soundView = () => ({ stepsAside, evenOff: soundRepo.evenOff() });
  // Tests only (never a packaged Drashti): the library's files measured sooner after the start, or not at all ('off').
  const testSoundPass = packaged() ? undefined : sw('DRASHTI_TEST_SOUND_PASS');
  const soundPass = new SoundPass({
    repo: soundRepo,
    mediaDir,
    ffmpegPath: () =>
      testSoundPass === 'off'
        ? null
        : findFfmpeg({
            packaged: packaged(),
            resourcesPath: process.resourcesPath,
            appPath: app.getAppPath(),
            platform: process.platform,
            arch: process.arch,
            override: sw('DRASHTI_FFMPEG'),
          }),
    busy: () => (streaming.inUse() || testOnAir ? 'the stream is on air or recording' : null),
    write: (key, run) => {
      later.write(key, run);
    },
    measured: (mediaId, lengthMs) => {
      soundKnown.delete(mediaId);
      engine.refreshSound();
      // Its length known now (P3): what plays it says its time left.
      if (lengthMs !== null) engine.learnLength(mediaId, lengthMs);
    },
    keepPoints: (mediaId, points) => {
      const was = media.markersOf(mediaId) ?? NO_MARKERS;
      if (was.startMs !== null || was.endMs !== null) return false;
      if (!media.setMarkers(mediaId, { ...was, startMs: points.startMs, endMs: points.endMs })) return false;
      engine.refreshMarkers(mediaId);
      return true;
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    ...(testSoundPass !== undefined && /^\d+$/u.test(testSoundPass)
      ? { afterStartMs: Number(testSoundPass) }
      : {}),
  });
  stops.add('sound pass', () => {
    soundPass.close();
  });
  soundPass.startLibrary();
  handle(IPC.sound.view, () => soundView());
  /** A video's or sound's loudness as measured, and its own switch (the Even loudness notice, the tests). */
  const loudnessSettings = editedSoundSettings(soundRepo, (id) => editedPlaying.sourceId(id));
  const fileSound = (mediaId: string) => {
    const known = loudnessSettings.read(mediaId);
    if (!known) return null;
    const loudness = known.loudness;
    return {
      even: known.even,
      measured: loudness !== null,
      lufs: loudness?.lufs ?? null,
      gainDb: loudness && known.even ? evenGainDb(loudness) : 0,
    };
  };
  handle(IPC.sound.file, (_e, mediaId) =>
    typeof mediaId === 'string' && MEDIA_ID_PATTERN.test(mediaId) ? fileSound(mediaId) : null,
  );
  const setMusicStepsAside = (on: boolean) => {
    stepsAside = on;
    laterSetting('music.stepsAside', on);
    engine.refreshSound();
    log.info(`Sound: the music ${on ? 'steps aside' : 'no longer steps aside'} under a video with sound`);
    const view = soundView();
    sendToOperator(IPC.sound.changed, view);
    network?.hint('music');
    return { ok: true as const, view };
  };
  handle(IPC.sound.setStepsAside, (e, on) =>
    fromOperator(e) && typeof on === 'boolean'
      ? setMusicStepsAside(on)
      : { ok: false as const, message: 'Only the operator window can change Audio’s switches.' },
  );
  // The operator's Audio and Video levels and mutes (X33): every sound plays at them at once, in the hall and the stream.
  /** A level is said in the log once it has stayed put a moment (a drag sends several a second). */
  let levelLogged: ReturnType<typeof setTimeout> | null = null;
  const levelsChanged = (result: SoundLevelsResult, what: string | null): SoundLevelsResult => {
    if (!result.ok) return result;
    engine.refreshSound();
    if (what !== null) log.info(`Sound: ${what}`);
    else {
      if (levelLogged) clearTimeout(levelLogged);
      levelLogged = setTimeout(() => {
        levelLogged = null;
        const { audio, video } = soundLevels.levels();
        log.info(
          `Sound: Audio at ${String(Math.round(audio.level * 100))} %, Video at ${String(Math.round(video.level * 100))} %`,
        );
      }, 1000);
    }
    return result;
  };
  stops.add('sound levels log', () => {
    if (levelLogged) clearTimeout(levelLogged);
  });
  const levelsRefused = {
    ok: false as const,
    message: 'Only the operator window can change the sound’s levels.',
  };
  handle(IPC.sound.setLevel, (e, kind, level) =>
    fromOperator(e) ? levelsChanged(soundLevels.setLevel(kind, level), null) : levelsRefused,
  );
  handle(IPC.sound.setMuted, (e, kind, muted) =>
    fromOperator(e)
      ? levelsChanged(
          soundLevels.setMuted(kind, muted),
          `${kind === 'video' ? 'Video' : 'Audio'} ${muted === true ? 'muted' : 'sound on again'}`,
        )
      : levelsRefused,
  );
  handle(IPC.sound.setEven, (e, mediaId, on) => {
    if (
      !fromOperator(e) ||
      typeof mediaId !== 'string' ||
      !MEDIA_ID_PATTERN.test(mediaId) ||
      typeof on !== 'boolean'
    )
      return { ok: false as const, message: 'Only the operator window can change a file’s loudness.' };
    const changed = loudnessSettings.set(mediaId, on);
    if (!changed.ok)
      return { ok: false as const, message: 'Even loudness is for a video or a sound in the library.' };
    soundKnown.delete(changed.sourceId);
    engine.refreshSound();
    sendToOperator(IPC.sound.changed, soundView());
    log.info(`Sound: a file plays ${on ? 'at the even loudness' : 'as it is'}`);
    const now = fileSound(mediaId);
    return now
      ? { ok: true as const, ...now }
      : { ok: false as const, message: 'That file is not in the library.' };
  });
  handle(IPC.sound.trimEdges, async (e, mediaId) => {
    if (!fromOperator(e) || typeof mediaId !== 'string' || !MEDIA_ID_PATTERN.test(mediaId))
      return { ok: false as const, message: 'Only the operator window can trim a video.' };
    const found = await soundPass.edgesNow(mediaId);
    if (!found.ok) return found;
    if (!found.points) {
      const was = media.markersOf(mediaId) ?? NO_MARKERS;
      return { ok: true as const, points: null, before: { startMs: was.startMs, endMs: was.endMs } };
    }
    const before = trimmedVideos.setSoundEdges(mediaId, found.points);
    if (!before)
      return { ok: false as const, message: 'Only a video in the library has black and silence to trim.' };
    engine.refreshMarkers(mediaId);
    log.info('Sound: a video’s start and end points were set past its black and silence');
    return { ok: true as const, points: found.points, before };
  });
  handle(IPC.media.convert, (e, ids) =>
    fromOperator(e)
      ? conversions.convert(ids)
      : { ok: false as const, message: 'Only the operator window can convert.' },
  );
  handle(IPC.media.retryConversion, (e, id) =>
    fromOperator(e)
      ? conversions.retryImported(id)
      : { ok: false as const, message: 'Only the operator window can retry a conversion.' },
  );
  handle(IPC.media.cancelLinkConversion, (e, id) =>
    fromOperator(e)
      ? conversions.cancelLinkConversion(id)
      : { ok: false as const, message: 'Only the operator window can stop a link conversion.' },
  );
  handle(IPC.media.cancelConversion, (e, id) =>
    fromOperator(e)
      ? conversions.cancel(id)
      : { ok: false as const, message: 'Only the operator window can convert.' },
  );
  handle(IPC.media.conversions, () => conversions.list());
  // Whether this computer plays HEVC video, once known (question 36: told again when it comes, below).
  handle(IPC.media.playsHevc, () => hevc.now);
  handle(IPC.media.undoConversion, (e, id) =>
    fromOperator(e)
      ? conversions.undo(id)
      : { ok: false as const, message: 'Only the operator window can convert.' },
  );
  // ---- Save as MP4… (Session 26e): a video's part copied as it is, run as converting is ----
  const saveFfmpeg = () =>
    findFfmpeg({
      packaged: packaged(),
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
    readRate: !packaged() && sw('DRASHTI_TEST_SAVE_READRATE') === '1',
  });
  // Trim's background work waits for a quiet moment (Q57-7): nothing up on LIVE, no stream on air or recording.
  const trimWorkQuiet = () =>
    !quitStarted && !streaming.inUse() && !testOnAir && nothingUp(engine.current.layers);
  // Trim's records (FT-4): the cuts accepted and waiting, and the copies not yet taken in, kept in a small file written
  // in the background (no longer library settings written on Main, which waited there for an import's write lock).
  // New Trim records left by alpha.17 carry on after an upgrade or downgrade. A restored library begins with its
  // own settings.
  const clearTrimSettings = libraryDb.transaction(() => {
    settings.set('playlistTrimsWaiting', []);
    settings.set('playlistTrimCopies', []);
  });
  const trimRecords = new TrimRecords(join(userDataDir, TRIM_RECORDS_FILE), {
    before: {
      waiting: () => settings.get('playlistTrimsWaiting'),
      copies: () => settings.get('playlistTrimCopies'),
      // Clear both settings together once the record file has them (LOW-2).
      clear: () => {
        later.write('trim record settings', clearTrimSettings);
      },
    },
    afterDowngrade: settings.get('lastStartVersion') === '1.0.0-alpha.17',
    otherLibrary: restoredInUse,
    log: (message) => {
      log.warn(message);
    },
  });
  // A playlist video's Trim makes a cut in the background, then changes just that row (Session 57).
  const playlistTrims = new PlaylistTrims({
    repo: trimmedVideos,
    mediaDir,
    readInfo: async (file) => {
      const ffmpeg = saveFfmpeg();
      return ffmpeg ? readTrimInfo(ffmpeg, file) : { durationMs: null, video: null, audio: null };
    },
    frameAt: (file, atMs) => {
      const ffmpeg = saveFfmpeg();
      return ffmpeg ? frameAtOrBefore(ffmpeg, file, atMs) : Promise.resolve(null);
    },
    isLive: (itemId, mediaId) => rowVideoLive(engine.current, itemId, mediaId),
    // A cut is made, checked and carried on while nothing plays (alpha.22); the unused cuts' sweep still waits until
    // nothing is up (trimCleanupQuiet).
    quiet: () => !quitStarted && saveIdle(),
    waits: saveWaits,
    hash: (file, signal) => hashOffMain(file, signal),
    kept: trimRecords.kept,
    spaceProblem: (file, durationMs, lengthMs) =>
      conversions.trimSpaceProblem(file, dirname(file), durationMs, lengthMs),
    copies: trimRecords.copies,
    saveNow: () => {
      trimRecords.saveNow();
    },
    trash: (file) => shell.trashItem(file),
    queue: (input, beforePublish) =>
      queueTrimCopy(
        {
          saveCopy: (source, dest, info, copy) =>
            conversions.saveCopy(source, dest, info, { ...copy, beforePublish }),
        },
        input,
      ),
    cancel: (id) => conversions.cancelFile(id),
    pendingChanged: (ids) => sendToOperator(IPC.media.preparingTrimsChanged, ids),
    statusChanged: (statuses) => sendToOperator(IPC.media.trimStatusesChanged, statuses),
    // Its trimmed video is in Media (alpha.22): the notice says so, with Show in Media.
    saved: (mediaId, name) => sendToOperator(IPC.app.notice, { text: trimSavedNotice(name), mediaId }),
    rowChanged: (added) => {
      if (added) {
        libraryChanged(true);
        soundPass.imported([added], false);
      }
      playlistsChanged();
    },
    markersChanged: (id) => engine.refreshMarkers(id),
    notice: (text) => sendToOperator(IPC.app.notice, { text }),
  });
  // The cuts accepted before Drashti last closed carry on from the moment kept conversions do (resumeWhenQuiet,
  // below), and the copies nothing carries on go to the Trash then.
  // The unused cuts sweep also waits until nothing Oops, Put it back or Back could bring back (sweepQuiet).
  const trimCleanupQuiet = () => trimWorkQuiet() && sweepQuiet(engine);
  // Tests only, never packaged (DRASHTI_TEST_TRASH_DIR, TM-8): the sweep moves its cuts into this folder in place of
  // the computer's Trash.
  const testTrash = packaged() ? undefined : sw('DRASHTI_TEST_TRASH_DIR');
  const trashCut = (file: string) =>
    testTrash === undefined
      ? shell.trashItem(file)
      : fsPromises.rename(file, join(testTrash, basename(file)));
  const trimCleanup = new TrimCleanup(
    trimCleanupQuiet,
    async (signal) => {
      const gone = await mediaRemoval.trashUnusedTrims(mediaDir, trashCut, trimCleanupQuiet, signal);
      // A cut's file that a quit left in Media during its move goes now (FT-8), named in the same notice.
      gone.push(
        ...(await mediaRemoval.trashLeftTrims(mediaDir, trashCut, trimCleanupQuiet, signal, {
          held: () => playlistTrims.heldFiles(),
          log: (message) => {
            log.info(message);
          },
        })),
      );
      if (gone.length === 0 || quitStarted) return;
      libraryChanged(true);
      log.info(`Media: moved ${String(gone.length)} unused Trim cut(s) to the Trash`);
      // The operator is told which, in one notice (TM-4): the sweep runs only while nothing is up.
      const text = trashedTrimsNotice(gone);
      if (text) sendToOperator(IPC.app.notice, { text });
    },
    (error) => log.warn('Media: could not check unused Trim cuts', error),
    AFTER_START_MS,
  );
  trimActivityChanged = () => {
    playlistTrims.activityChanged();
    trimCleanup.activityChanged();
  };
  testTrimActivityChanged = trimActivityChanged;
  const offTrimActivity = engine.onChange(() => {
    playlistTrims.activityChanged();
    trimCleanup.activityChanged();
  });
  stops.add('playlist trims', () => {
    offTrimActivity();
    trimActivityChanged = undefined;
    testTrimActivityChanged = undefined;
    trimCleanup.close();
    playlistTrims.close();
    // Trim's records on the disk before Drashti ends, and any change from here on at once (FT-4).
    trimRecords.quit();
  });
  const noTrim = { ok: false as const, message: 'Open a video row’s Trim to change that playlist.' };
  handle(IPC.media.rowTrim, (e, itemId) => {
    const id = idSchema.safeParse(itemId);
    return fromOperator(e) && id.success ? trimmedVideos.view(id.data) : null;
  });
  handle(IPC.media.applyRowTrim, (e, itemId, request) => {
    const id = idSchema.safeParse(itemId);
    const parsed = rowTrimRequestSchema.safeParse(request);
    if (!fromOperator(e) || !id.success) return noTrim;
    return parsed.success
      ? playlistTrims.apply(id.data, parsed.data)
      : { ok: false as const, message: 'Choose a valid start and end, with the end later.' };
  });
  handle(IPC.media.resetRowTrim, (e, itemId, mediaId) => {
    const item = idSchema.safeParse(itemId);
    const video = idSchema.safeParse(mediaId);
    return fromOperator(e) && item.success && video.success
      ? playlistTrims.reset(item.data, video.data)
      : noTrim;
  });
  handle(IPC.media.stopRowTrim, (e, itemId, mediaId) => {
    const item = idSchema.safeParse(itemId);
    const video = idSchema.safeParse(mediaId);
    return fromOperator(e) && item.success && video.success
      ? playlistTrims.stop(item.data, video.data)
      : noTrim;
  });
  handle(IPC.media.preparingTrims, (e) => (fromOperator(e) ? playlistTrims.list() : []));
  handle(IPC.media.trimStatuses, (e) => (fromOperator(e) ? playlistTrims.statuses() : {}));
  // Export… (alpha.22, the owner's "export button as well to download"): a finished video in Media (a row's trimmed
  // video) copied byte for byte where the operator chooses, the save dialog beginning in Downloads.
  handle(IPC.media.exportFile, (e, mediaId) => {
    const id = idSchema.safeParse(mediaId);
    if (!fromOperator(e) || !id.success)
      return { ok: false as const, message: 'Open Export… in the operator window, then try again.' };
    return exportMediaFile(
      {
        video: (mediaId) => {
          const row = media.kindAndFile(mediaId);
          const named = media.kindAndName(mediaId);
          return row?.kind === 'video' && !row.missing && row.path !== '' && named
            ? { path: join(mediaDir, row.path), name: named.name }
            : null;
        },
        pickDest: async (name) => {
          if (!operatorWindow || operatorWindow.isDestroyed()) return null;
          const picked = await dialog.showSaveDialog(operatorWindow, {
            title: 'Export video',
            defaultPath: join(testDownloadsDir ?? app.getPath('downloads'), name),
            buttonLabel: 'Export',
          });
          return picked.canceled || !picked.filePath ? null : picked.filePath;
        },
      },
      id.data,
    );
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
    // Simple Mode keeps its own formats and conflict policy. A retried link can carry the 1080p cap.
    const simpleOptions = { ...SIMPLE_IMPORT, maxVideoHeight: options.data.maxVideoHeight };
    return imports.start(paths.data, mode === 'simple' ? simpleOptions : options.data);
  };

  // ---- IPC ----------------------------------------------------------------
  handle(IPC.app.getInfo, () => appInfo());
  // The operator window's own start in the log (question 36 of Session 54): where a slow start's time went.
  handle(IPC.app.windowStarted, (e, raw) => {
    const marks = fromOperator(e) ? parseStartMarks(raw) : null;
    if (marks) log.info(windowStartLine(marks));
    return null;
  });
  handle(IPC.app.recovery, async () => {
    // A video input put back after the restart (Session 50): the notice waits for the first screen to say whether
    // it is on this computer (20 s at most), and names it when it was not (it has come off the screens).
    const gone = await inputs.settled();
    if (gone !== null && recovery) recovery = { ...recovery, input: null, inputGone: gone };
    // One put back in the picture-in-picture box (Session 51): the same, the box taken off.
    const boxGone = await inputs.boxSettled();
    if (boxGone !== null && recovery) recovery = { ...recovery, pip: false, pipInputGone: boxGone };
    return recovery;
  });
  handle(IPC.app.startNotice, (e) => {
    if (!fromOperator(e)) return null;
    // Waits for no FFmpeg: only the cuts that cannot carry on are named (TR-5).
    const interruptedTrim = playlistTrims.reportInterrupted();
    const text = [startNotice, interruptedTrim].filter(Boolean).join(' ') || null;
    startNotice = null;
    startNoticeTaken = true;
    operatorAsked = true;
    return text;
  });
  /** Tell the operator: at once, or as the operator window's page opens while it is down or loading again (x53). */
  const tellOperator = (text: string) => {
    if (operatorAsked && pageAlive(operatorWindow) && !operatorWindow.webContents.isCrashed())
      sendToOperator(IPC.app.notice, { text });
    else startNotice = startNotice ? `${startNotice}\n\n${text}` : text;
  };
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
  handle(IPC.engine.videoCueReady, (event, cueId, kind, ready) => {
    if (typeof cueId !== 'string' || cueId.length > 128 || typeof ready !== 'boolean') return null;
    const picture =
      fromOperator(event) ||
      manager.screenIdFor(event.sender.id) !== undefined ||
      streaming.isProgram(event.sender);
    const sound = event.sender.id === audioWindow?.webContents.id || streaming.isStreamSound(event.sender);
    if ((kind === 'picture' && picture) || (kind === 'sound' && sound))
      engine.reportVideoCue(cueId, `${kind}:${event.sender.id}`, ready);
    return null;
  });
  handle(IPC.engine.subscribe, (event) =>
    windowReads.read('engine', () => {
      transport.add(event.sender);
      engine.videoCuePageJoined(`picture:${event.sender.id}`);
      engine.videoCuePageJoined(`sound:${event.sender.id}`);
      return engine.snapshot();
    }),
  );
  handle(IPC.engine.snapshot, () => engine.snapshot());
  let controllersHaveActions = () => false;
  handle(IPC.engine.command, (event, command, seen) =>
    runEngineCommand(
      engine,
      command,
      fromOperator(event),
      controllersHaveActions() ? (seen ?? null) : undefined,
    ),
  );
  // The deck slide the operator points at (C3, Session 58: Q57-26): its first clip loaded ahead, where a click on its
  // row starts it, by every screen that loads what comes next (each output's Preloader, a node's too), never while
  // this computer is short of memory (main/point-ahead.ts).
  const pointAhead = new PointAhead({
    deckAt: (t) => playable.order(t.presentationId, t.arrangementId)?.slides[t.slideIndex]?.slide.deck,
    room: () => roomToLoadAhead(process.getSystemMemoryInfo(), process.platform),
    tell: (clip) => {
      for (const w of BrowserWindow.getAllWindows())
        if (!w.isDestroyed()) sendToPage(w, IPC.output.pointed, { clip });
      nodeService?.tellPointed(clip);
    },
  });
  handle(IPC.output.getPointed, ({ sender }) =>
    manager.screenIdFor(sender.id) !== undefined || streaming.isProgram(sender) ? pointAhead.current() : null,
  );
  stops.add('pointing ahead', () => {
    pointAhead.stop();
  });
  handle(IPC.engine.pointAt, (event, raw) => {
    if (!fromOperator(event)) return null;
    const target = pointAtSchema.safeParse(raw);
    pointAhead.point(target.success ? target.data : null);
    return null;
  });
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
  const wordsChanges = registerWordsIpc({
    db,
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
  // The slide editor (Session 55, Part 17a): a window of its own, so the show goes on in the operator window meanwhile.
  slideEditor = new SlideEditorWindow({
    workArea: () =>
      (operatorWindow && !operatorWindow.isDestroyed()
        ? electronScreen.getDisplayMatching(operatorWindow.getBounds())
        : electronScreen.getPrimaryDisplay()
      ).workArea,
    background: () => appearance.background(),
    closed: () => cancelSourceEdits(),
    track: (win) => {
      appearance.track(win);
    },
    log: (line) => {
      log.info(line);
    },
  });
  const editorWindow = slideEditor;
  stops.add('slide editor', () => {
    editorWindow.close();
  });
  // Simple Mode may edit presentations that its playlists hold. An unscoped read lists PDFs for Insert pages.
  const mayEditSlides = (presentationId?: string) =>
    !stops.done &&
    !quitStarted &&
    documentQuit?.closing !== true &&
    isLetIn() &&
    (mode === 'pro'
      ? !simpleAccess()
      : presentationId === undefined || aPlaylistsPresentation(simpleScope(), presentationId));
  handleSlideEditor({
    editor: editorWindow,
    fromOperator,
    exists: (presentationId) => presentations.content(presentationId) !== null,
    pictures: {
      allowed: mayEditSlides,
      choose: async (e) => {
        const parent = BrowserWindow.fromWebContents(e.sender);
        if (!parent) return null;
        const picked = await dialog.showOpenDialog(parent, {
          title: 'Choose a picture for this slide',
          buttonLabel: 'Add picture',
          properties: ['openFile'],
          filters: [IMAGE_FILE_FILTER],
        });
        return picked.canceled ? null : (picked.filePaths[0] ?? null);
      },
      importFile: async (file) => {
        const done = await imports.start([file], mode === 'simple' ? SIMPLE_IMPORT : {});
        if (!done.ok) return done;
        const item = importRepo.report(done.run.id)?.items[0];
        if (item?.target?.kind === 'media') return { ok: true, mediaId: item.target.id };
        const issue = item?.issues.find((problem) => problem.severity === 'error');
        return {
          ok: false,
          message: issue?.message ?? 'Drashti couldn’t add that picture. Choose another picture.',
        };
      },
    },
    // The show's F-keys from the editor's window: pressed in the operator window's page, which acts on them.
    showKey: (key) => {
      const page = operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow.webContents : null;
      if (!page || page.isDestroyed()) return;
      page.sendInputEvent({ type: 'keyDown', keyCode: key });
      page.sendInputEvent({ type: 'keyUp', keyCode: key });
    },
  });
  handle(IPC.slideEditor.fontFamilies, (event) =>
    isLetIn() && editorWindow.isPage(event.sender) ? systemFontFamilies() : [],
  );
  const pdfReadIdle = () => !streaming.inUse() && nothingUp(engine.snapshot().state.layers);
  const slideEdits = registerSlidesIpc({
    prepareDisplay: (candidate, signal) => displayCopies.prepare(candidate, signal),
    mayChangeTranslations: () => mode === 'pro',
    choosePdfFile: async (e) => {
      const parent = BrowserWindow.fromWebContents(e.sender);
      const options = {
        title: 'Choose a PDF',
        buttonLabel: 'Choose PDF',
        properties: ['openFile'] as 'openFile'[],
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      };
      const chosen = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      return chosen.canceled ? null : (chosen.filePaths[0] ?? null);
    },
    db,
    presentations,
    revisions,
    settings,
    // The operator window, and the slide editor's own window (Session 55, Part 17a).
    fromOperator: (e) => fromOperator(e) || editorWindow.isPage(e.sender),
    mayPrepareSource: (e, presentationId) =>
      mayEditSlides(presentationId) &&
      !e.sender.isDestroyed() &&
      (fromOperator(e) || editorWindow.isPage(e.sender)),
    sourceReader: async (request) => {
      const result = await documentReaders.read(request);
      if (!result.ok && result.retainOutput) sourceOutputQuarantined = true;
      return result;
    },
    // After the requested PDF pages have opened, the reading behind ends its job whenever the show needs the computer
    // (anything up, or the stream on air or recording), and waits here, outside every queue, until the show is idle.
    showBusy: () => !pdfReadIdle(),
    // Extract pages… to a new presentation and its Undo/Redo wait off air (x85); everything else here goes on.
    onAir: () => streaming.inUse() || testOnAir,
    waitForPdfIdle: (signal) => {
      if (signal.aborted || pdfReadIdle()) return Promise.resolve(!signal.aborted);
      return new Promise<boolean>((resolve) => {
        const finish = (allowed: boolean) => {
          offEngine();
          pdfReadWaits.delete(check);
          signal.removeEventListener('abort', stop);
          resolve(allowed);
        };
        const check = () => {
          if (pdfReadIdle()) finish(true);
        };
        const stop = () => finish(false);
        const offEngine = engine.onChange(check);
        pdfReadWaits.add(check);
        signal.addEventListener('abort', stop, { once: true });
      });
    },
    sourceWrite: sourceWrite(libraryDb, () => imports.giveWay()),
    lookFor: (themeId, size) => themeLook(themes.themeOrDefault(themeId), size.width, size.height),
    changed: contentChanged,
    // A save in the editor's window: one change for the operator window's Undo.
    saved: (saved) => {
      sendToOperator(IPC.slideEditor.edited, saved);
    },
  });
  /** Make a slide…'s keeping (set below, where the open playlist is known). */
  let keepPageSlide: (
    png: Uint8Array | Uint8Array[],
    name: string,
    place: MadeSlidePlace,
    current: () => boolean,
  ) => Promise<MakeSlideResult> = () =>
    Promise.resolve({ ok: false, message: 'Drashti is still starting: try again in a moment.' });
  const pdfEditor = new PdfEditor({
    db: libraryDb,
    mediaDir,
    session: pdfCopies,
    allowed: (e) =>
      !stops.done &&
      documentQuit?.closing !== true &&
      isLetIn() &&
      !simpleAccess() &&
      mode === 'pro' &&
      !e.sender.isDestroyed() &&
      (fromOperator(e) || editorWindow.isPage(e.sender)),
    onAir: () => streaming.inUse() || testOnAir,
    stamp: (presentationId) => {
      const row = libraryDb
        .prepare('SELECT updated_at, content_rev FROM presentations WHERE id = ? AND deleted_at IS NULL')
        .get(presentationId) as { updated_at: string; content_rev: number } | undefined;
      return row ? `${row.updated_at}#${String(row.content_rev)}` : null;
    },
    validate: (id, doc, stamp) => slideEdits.documentForExport(id, doc, stamp),
    chooseOutput: async (e, name) => {
      const parent = BrowserWindow.fromWebContents(e.sender);
      const options = {
        title: 'Save a PDF copy',
        buttonLabel: 'Save copy',
        defaultPath: name.replace(/[\\/:*?"<>|]/gu, ' ').trim() + ' copy.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      };
      const chosen = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options);
      return chosen.canceled ? null : chosen.filePath;
    },
    // Make a slide… (alpha.21): the part drawn from the page just printed, at the size a PDF's pages are imported at.
    drawPart: (pdf, part, signal) => pdfPictures.drawPart(pdf, part, signal),
    keepSlide: ({ png, name, place }, current) => keepPageSlide(png, name, place, current),
  });
  // Make a slide… (alpha.21, the owner's "add a slide button to create a slide in drashti"): the editor's window (or the
  // operator window) asks; Pro Mode only, as Save a PDF copy is.
  handle(IPC.slideEditor.makeSlide, (e, request) => pdfEditor.makeSlide(e, request));
  handle(IPC.slideEditor.slidePlace, (e): SlidePlace => {
    if (!(fromOperator(e) || editorWindow.isPage(e.sender)) || mode !== 'pro') return { playlist: null };
    return { playlist: openPlaylistForSlides() };
  });
  const stopPdfOnAir = () => {
    if (streaming.inUse() || testOnAir) pdfEditor.cancelBatch();
  };
  pdfReadWaits.add(stopPdfOnAir);
  stops.add('PDF off-air guard', () => {
    pdfReadWaits.delete(stopPdfOnAir);
  });
  // Prepare translations (alpha.22, a22-mt): drafts from the offline engine (drashti-translate with a model pack's
  // IndicTrans2 model) for the Translation… dialog only; a named reader checks each before it can show. Pro Mode, off
  // air: what is under way stops when the stream goes on air. Nothing runs until the dialog asks.
  const translateProgram = findTranslateHelper({
    packaged: packaged(),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform,
    arch: process.arch,
  });
  const translationEngine = new TranslationEngine({
    program: () => translateProgram,
    models: modelPacks,
    log,
  });
  const translationOnAir = () => streaming.inUse() || testOnAir;
  // Tests only (never a packaged Drashti): DRASHTI_TEST_TRANSLATE=1 stands in for the engine with x83's stand-in (a
  // marked placeholder, never a translation), so the dialog's Prepare translations is driven without a model pack.
  const testTranslate = !packaged() && sw('DRASHTI_TEST_TRANSLATE') === '1';
  const standInTranslator = new StandInTranslator();
  handleTranslation({
    handle,
    mayDraft: (e) =>
      mayEditSlides() &&
      mode === 'pro' &&
      !e.sender.isDestroyed() &&
      (fromOperator(e) || editorWindow.isPage(e.sender)),
    onAir: translationOnAir,
    engine: testTranslate
      ? {
          installed: () => true,
          available: (from, to) => from !== to,
          unknownModel: () => false,
          translate: (source, from, to) => standInTranslator.translate(source, from, to),
          cancel: () => undefined,
        }
      : translationEngine,
  });
  const stopTranslationOnAir = () => {
    if (translationOnAir()) translationEngine.cancel();
  };
  pdfReadWaits.add(stopTranslationOnAir);
  stops.add('translation engine', () => {
    pdfReadWaits.delete(stopTranslationOnAir);
    translationEngine.stop();
  });
  handle(IPC.library.exportPdf, (e, id, doc, stamp, pages) => pdfEditor.export(e, id, doc, stamp, pages));
  handle(
    IPC.library.pdfWorkAllowed,
    (e) =>
      mayEditSlides() &&
      mode === 'pro' &&
      !streaming.inUse() &&
      !testOnAir &&
      !e.sender.isDestroyed() &&
      (fromOperator(e) || editorWindow.isPage(e.sender)),
  );
  handle(IPC.library.showExtractedPdfCopy, (e, id, visible) => pdfEditor.showExtractedCopy(e, id, visible));
  cancelPdfCopies = () => pdfEditor.cancel();
  drainPdfCopies = () => pdfEditor.stop();
  cancelSourceEdits = () => {
    slideEdits.cancelSourcePreparation();
    cancelPdfCopies();
  };
  drainSourceEdits = () => slideEdits.drainSourcePreparation();
  stops.add('editor source generations', cancelSourceEdits);
  // The QR code… window's logo and Download… (Q60-28): Choose a Picture… and Download… are the system's own dialogs,
  // and every picture of a code is made, and read back, in the QR worker, off Main's thread (library/qr-service.ts).
  const qr = new QrService({
    settings,
    mediaDir,
    make: (job) => runQrJob(job),
    pickPicture: async () => {
      if (!operatorWindow || operatorWindow.isDestroyed()) return null;
      const picked = await dialog.showOpenDialog(operatorWindow, {
        title: 'Choose a picture for the middle of the code',
        buttonLabel: 'Choose',
        properties: ['openFile'],
        filters: [{ name: 'Pictures (PNG or JPEG)', extensions: ['png', 'jpg', 'jpeg'] }],
      });
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
    pickSave: async (defaultPath) => {
      if (!operatorWindow || operatorWindow.isDestroyed()) return null;
      const picked = await dialog.showSaveDialog(operatorWindow, {
        title: 'Download the QR code',
        defaultPath,
        buttonLabel: 'Save',
        filters: [{ name: 'PNG picture (an SVG is saved beside it)', extensions: ['png'] }],
      });
      return picked.canceled || !picked.filePath ? null : picked.filePath;
    },
    downloads: () => testDownloadsDir ?? app.getPath('downloads'),
  });
  const qrNotOperator = { ok: false as const, message: 'Only the operator window can do that.' };
  handle(IPC.library.qrChoices, (e) =>
    fromOperator(e) ? qr.choices() : { logo: null, useLogo: false, wordsUnder: true },
  );
  handle(IPC.library.pickQrLogo, (e) => (fromOperator(e) ? qr.pickLogo() : qrNotOperator));
  handle(IPC.library.keepQrLogo, async (e, name, png) => {
    if (!fromOperator(e)) return qrNotOperator;
    const kept = await qr.keepLogo(name, png);
    if (kept.ok) log.info('QR code: a logo was kept for the middle of the code');
    return kept;
  });
  handle(IPC.library.setQrChoices, (e, change) => (fromOperator(e) ? qr.setChoices(change) : qrNotOperator));
  handle(IPC.library.downloadQr, async (e, text, options) => {
    if (!fromOperator(e)) return qrNotOperator;
    const done = await qr.download(text, options);
    if (done.ok) log.info('QR code: a code was saved where the operator chose');
    return done;
  });
  /**
   * A picture Drashti made (a QR code, a PDF page's part) kept in the library through an import as any picture is,
   * from a temporary file: its media id, or null.
   */
  const keepMadePicture = async (
    png: Uint8Array,
    fileName: string,
    prefix: string,
  ): Promise<string | null> => {
    const dir = await fsPromises.mkdtemp(join(tmpdir(), prefix));
    try {
      const file = join(dir, fileName);
      await fsPromises.writeFile(file, png);
      const done = await importPaths([file], {});
      const made = done.ok
        ? importRepo.report(done.run.id)?.items.find((i) => i.sourcePath === file)?.target
        : undefined;
      return made?.kind === 'media' ? made.id : null;
    } finally {
      // Gone once the import has its copy (Windows may hold it a moment: the system empties its temporary folder).
      await fsPromises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
  // New › QR code… (Session 55, Part 8, G): the code made offline, since alpha.20 in the QR worker and read back first
  // (with the logo in the middle when the window asks, Q60-28), kept as a picture in the library through an import as
  // any picture is, and one slide holding it large, with the words under it unless the window leaves them off.
  handle(IPC.library.newQrSlide, async (e, text, options): Promise<NewFromWordsResult> => {
    if (!fromOperator(e)) return { ok: false, message: 'Only the operator window can make a slide.' };
    const words = typeof text === 'string' ? nfc(text) : '';
    if (words.trim() === '') return { ok: false, message: 'Paste a link or type the words first.' };
    const code = qrWords(words);
    if (code === null)
      return {
        ok: false,
        message: `That is too long for a code a phone can read across the hall: ${String(QR_TEXT_MAX)} letters at most.`,
      };
    const asked: { logo?: unknown; words?: unknown } =
      typeof options === 'object' && options !== null ? options : {};
    const made = await qr.slidePicture(code, asked.logo === true);
    if (!made.ok) return { ok: false, message: made.message };
    const mediaId = await keepMadePicture(made.png, 'QR code.png', 'drashti-qr-');
    if (mediaId === null) return { ok: false, message: 'The code’s picture could not be kept: try again.' };
    const libraryId = presentations.ensureLibrary('Default');
    const look = themeLook(themes.themeOrDefault(null), 1920, 1080);
    const id = presentations.insert(
      qrSlidePresentation(
        libraryId,
        presentations.uniqueName(libraryId, qrSlideName(words)),
        words,
        mediaId,
        look,
        asked.words !== false,
      ),
    );
    contentChanged([id]);
    log.info('Library: a QR-code slide made');
    return { ok: true, id };
  });
  const bundleExporter = new KirtanBundleExporter({
    spawn: spawnImportWorker,
    dbFile: libraryFile(),
    mediaDir,
    schemaVersion: LATEST_VERSION,
    onAir: () => streaming.inUse() || testOnAir,
  });
  drainKirtanExports = () => bundleExporter.stop();
  stops.add('kirtan bundle exports', () => bundleExporter.stop());
  registerKirtanBundleIpc({
    fromOperator,
    canExport: () => mode === 'pro' && documentQuit?.closing !== true,
    exporter: bundleExporter,
    pickOutput: async () => {
      if (!operatorWindow || operatorWindow.isDestroyed()) return null;
      const picked = await dialog.showSaveDialog(operatorWindow, {
        title: 'Export kirtan bundle',
        defaultPath: join(app.getPath('documents'), 'Kirtans.drashti-kirtans'),
        buttonLabel: 'Save bundle',
        filters: [{ name: 'Drashti kirtan bundle', extensions: ['drashti-kirtans'] }],
      });
      if (picked.canceled || !picked.filePath) return null;
      if (isInside(userDataDir, picked.filePath))
        throw new Error('Choose a folder outside Drashti’s data folder.');
      return picked.filePath;
    },
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
  // Themes, Props and the Logo are gone from the window (Session 55, Part 12): a presentation keeps the look its theme
  // gave it, new words start in the library's default look (themeLook, styleNewText), and the props, the logo's
  // setting and the themes stay in the library, unseen.
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
  // Undo of a change or a removal (Session 55): the template as it was, by its id.
  handle(IPC.messages.restore, (e, template) =>
    messageChange(e, () => {
      const t = keptTemplateSchema.safeParse(template);
      if (!t.success) return badMessage;
      messageTemplates.put(t.data);
      return { ok: true, id: t.data.id };
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
      // A phone lists them too (Session 54, D5).
      network?.hint('music');
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
    // No track asked (alpha.20): the one it was stopped on part-way, else its first (music-service.ts).
    const parsed = musicPlaySchema.safeParse({ playlistId, index: trackIndex });
    if (!fromOperator(e) || !parsed.success) return notMusicOperator;
    return music.play(parsed.data.playlistId, parsed.data.index);
  });
  // ---- scheduled backups (Session 14): into a folder picked for them, at their times --------------
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
  // A self-test runs no schedule (Session 54).
  if (selfTestRun) scheduledBackups.dispose();
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
  // Events out (Session 28): Pro Mode's (Simple Mode's lock), the operator window's.
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
  // The new secret's Copy (alpha.20), by the main process as Media information's is (copyWords): never kept or logged.
  handle(IPC.events.copySecret, (e, secret) => copyWords(e, secret));
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
  // ---- updates (Session 14): checked, downloaded and installed when Drashti quits, when asked -----
  const updates = new UpdateService({
    current: appVersion(),
    platform: process.platform,
    arch: process.arch,
    base: updateBase,
    dir: join(userDataDir, 'Updates'),
    // Packaged, an update's files come from GitHub only (Session 30).
    packaged: packaged(),
    fetch: (url, init) => electronNet.fetch(url, init),
    installer: defaultInstaller({
      platform: process.platform,
      isPackaged: packaged(),
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
  // ---- Import from a Link (Session 25b): saved in a folder chosen there, then the normal import ----
  const links = new LinkService({
    children: {
      started: (pid, group) => void leftovers.started(pid, 'yt-dlp', { group }),
      ended: (pid) => {
        leftovers.forget(pid);
      },
    },
    // A Dropbox folder as one playlist (Session 26c, src/main/playlists/folder-playlist.ts), in either mode: Simple Mode
    // (Session 55, Part 18) put its files at the end of its own playlist until Session 56 made its From a Link… whole.
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
    captionPreferences: {
      get: () => {
        const folder = settings.get('links.captionsFolder');
        return {
          enabled: settings.get('links.captions') !== false,
          folder: typeof folder === 'string' && isAbsolute(folder) ? folder : null,
        };
      },
      set: (value) => {
        settings.set('links.captions', value.enabled);
        settings.set('links.captionsFolder', value.folder);
      },
    },
    pickFolder: async (current, target) => {
      if (!operatorWindow) return null;
      const picked = await dialog.showOpenDialog(operatorWindow, {
        title: target === 'captions' ? 'Captions for Learning' : 'Save Downloads In',
        message: 'Choose where the downloaded files are saved. Drashti never moves or deletes them.',
        defaultPath: current,
        buttonLabel: 'Choose',
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
      });
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
    importFiles: async (paths, maxVideoHeight) => {
      // Its videos' start and end points go past their black and silence (Session 55, Part 7): known by their paths,
      // as the import ends before its run comes back here.
      for (const path of paths) linkPaths.add(path);
      // The cap is set here for pasted Dropbox links. The playable original can be added while its copy waits.
      const options = { ...(mode === 'simple' ? SIMPLE_IMPORT : {}), maxVideoHeight };
      const result = await imports.start(paths, options);
      if (!result.ok) for (const path of paths) linkPaths.delete(path);
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
    // The highest video quality (Session 25c), kept with the library's settings.
    maxHeight: {
      get: () => {
        const height = settings.get('links.maxHeight');
        return isLinkHeight(height) ? height : DEFAULT_LINK_MAX_HEIGHT;
      },
      set: (height) => {
        settings.set('links.maxHeight', height);
      },
    },
    // The playlist the last download went into (Session 54), offered first: kept with the library, everyone's.
    lastPlaylist: {
      get: () => {
        const id = settings.get('links.playlist');
        return typeof id === 'string' ? id : null;
      },
      set: (id) => {
        settings.set('links.playlist', id);
      },
    },
    // A Dropbox video above the cap is fitted in the background after the show, stream and recording are idle.
    fitVideo: (path, outDir, maxHeight, report) =>
      conversions.fitHeight(path, outDir, {
        maxHeight,
        waiting: (note) => {
          report(note, null);
        },
        progress: (fraction) => {
          report(null, fraction);
        },
      }),
    // YouTube (Session 25c): Drashti's own yt-dlp and Deno; in tests only ever the fake (never the real one).
    youtubeLaunch: (work) =>
      youtubeLaunch(
        {
          packaged: packaged(),
          platform: process.platform,
          testing: anyTestSwitch(),
          fake: packaged() ? null : (sw('DRASHTI_TEST_FAKE_YT_DLP') ?? null),
          fakeConfig: packaged() ? null : (sw('DRASHTI_TEST_FAKE_YT_DLP_CONFIG') ?? null),
          execPath: process.execPath,
          tools: findYoutubeTools({
            packaged: packaged(),
            resourcesPath: process.resourcesPath,
            appPath: app.getAppPath(),
            platform: process.platform,
            arch: process.arch,
          }),
          ffmpeg: findFfmpeg({
            packaged: packaged(),
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
  handle(IPC.links.start, (e, text, audio, intoOpenPlaylist, options) =>
    fromOperator(e) &&
    typeof text === 'string' &&
    typeof audio === 'boolean' &&
    typeof intoOpenPlaylist === 'boolean'
      ? links.start(text, audio, intoOpenPlaylist, options)
      : notLinksOperator,
  );
  handle(IPC.links.look, (e, kind, link) =>
    fromOperator(e) && (kind === 'dropbox' || kind === 'youtube') && typeof link === 'string'
      ? links.look(kind, link)
      : notLinksOperator,
  );
  handle(IPC.links.pickFolder, (e, target) =>
    fromOperator(e) ? links.pickFolder(target) : notLinksOperator,
  );
  handle(IPC.links.download, (e, choice) => (fromOperator(e) ? links.download(choice) : notLinksOperator));
  handle(IPC.links.stop, (e) => (fromOperator(e) ? links.stop() : notLinksOperator));
  handle(IPC.links.reset, (e) => (fromOperator(e) ? links.reset() : notLinksOperator));
  handle(IPC.links.addWaiting, (e) => (fromOperator(e) ? links.addWaiting() : notLinksOperator));
  handle(IPC.links.setMaxHeight, (e, height) =>
    fromOperator(e) ? links.setMaxHeight(height) : notLinksOperator,
  );
  handle(IPC.links.setPlaylist, (e, id) => (fromOperator(e) ? links.setPlaylist(id) : notLinksOperator));
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
  // ---- the quote of the day into the engine, and what the idle rotation was ----------------
  // The idle rotation is gone (Session 55, Part 12): its settings and quotes stay in the library, unseen. A stage
  // layout's Quote box still shows the quote of the day from its quotes; and what it was set to show is read by
  // oldIdleRotation (main/idle/idle-service.ts), for Part 6 to make a wallpaper set of it.
  const quotes = new QuoteRepo(db);
  const quoteOfTheDay = new QuoteOfTheDay({
    quotes,
    engine: { setQuote: (quote) => engine.setQuote(quote) },
    now: Date.now,
  });
  stops.add('quote of the day', () => {
    quoteOfTheDay.dispose();
  });
  /** What the idle rotation was set to show (Part 6 turns it into a wallpaper set). */
  const idleRotationWas = () =>
    oldIdleRotation({
      settings,
      quotes,
      picture: (id) => {
        const m = media.kindAndName(id);
        return m?.kind === 'image' ? { name: m.name } : null;
      },
    });
  log.info(
    `The idle rotation kept (unseen): ${String(idleRotationWas().pictures.length)} picture(s), ${String(quotes.list().length)} quote(s)`,
  );
  // ---- Wallpapers (Session 55, Part 6, main/wallpapers/) ------------------------------------------------------------
  // The chosen one on every audience screen whenever nothing is up, and under the Wallpaper; the idle rotation made
  // into one, once; a quote's picture imported as any picture is.
  wallpaperService = registerWallpapers({
    db,
    settings,
    media: (id) => media.kindAndName(id),
    engine,
    fromOperator,
    operatorWindow: () => operatorWindow,
    pictureExtensions: () => IMPORTABLE_EXTENSIONS.filter((ext) => mediaKindOf(`x.${ext}`) === 'image'),
    importPicture: async (file) => {
      const done = await importPaths([file], {});
      if (!done.ok) return null;
      const made = importRepo.report(done.run.id)?.items.find((i) => i.sourcePath === file)?.target;
      return made?.kind === 'media' ? made.id : null;
    },
    changed: (view) => {
      sendToOperator(IPC.wallpapers.changed, view);
      // The phones list them too (Session 55, Part 9).
      network?.hint('wallpapers');
      // Nodes copy the wallpapers' pictures.
      wantedMedia?.invalidate();
      nodeService?.libraryChanged();
    },
    idleRotationWas,
    log: (line) => {
      log.info(line);
    },
  });
  // ---- Lower Thirds (Session 44, shared/lower-thirds.ts): the library's, shown and hidden as engine commands --
  const lowerThirds = new LowerThirdRepo(db);
  // Those deleted before this start can no longer be undone.
  lowerThirds.purge();
  // Live behind the studio's preview (alpha.22, lower-thirds/studio-live.ts): a still about once a second while the
  // studio shows Live (not while it is minimized), never otherwise, from a picture already drawn: this computer's first
  // audience screen showing, as the Screens dashboard's pictures are taken (captureLocal). With none here, none (the
  // studio says "No live picture to show"). Read only.
  const studioLive: StudioLive = new StudioLive({
    take: async () => {
      const roles = new Map(screenRepo.groupIds().map((g) => [g.id, g.role]));
      const showingNow = () =>
        new Set(
          manager
            .status()
            .filter((st) => st.state === 'showing')
            .map((st) => st.screenId),
        );
      const showing = showingNow();
      const screenId = hallScreenOf(
        screenRepo.screens(),
        (groupId) => roles.get(groupId) ?? null,
        (id) => showing.has(id) && pageAlive(outputWindows.get(id)),
      );
      const hall = screenId === null ? undefined : outputWindows.get(screenId);
      if (screenId === null || !hall || hall.isDestroyed()) return null;
      const image = await hall.webContents.capturePage();
      // Taken as its window closed (its screen switched off, say), it is not what the hall shows: none (as captureLocal).
      if (hall.isDestroyed() || outputWindows.get(screenId) !== hall || !showingNow().has(screenId))
        return null;
      return livePictureOf(image, 'screen', Date.now());
    },
    send: (picture) => {
      studio.sendLive(picture);
    },
    log: (line) => {
      log.info(line);
    },
  });
  // Tests only (never a packaged Drashti): whether Live's stills are being taken, and how many have been.
  if (!packaged())
    (
      globalThis as { drashtiTestStudioLive?: () => { watching: boolean; taken: number } }
    ).drashtiTestStudioLive = () => ({ watching: studioLive.watching, taken: studioLive.taken });
  // The Lower Thirds studio (Session 55, Part 16): a window of its own, where they are made, shown and hidden.
  const studio = new LowerThirdsStudio({
    workArea: () =>
      (operatorWindow && !operatorWindow.isDestroyed()
        ? electronScreen.getDisplayMatching(operatorWindow.getBounds())
        : electronScreen.getPrimaryDisplay()
      ).workArea,
    background: () => appearance.background(),
    track: (win) => {
      appearance.track(win);
    },
    closed: () => {
      studioLive.stop();
    },
    minimized: (on) => {
      studioLive.pause(on);
    },
    log: (line) => {
      log.info(line);
    },
  });
  closeStudio = () => {
    studio.close();
  };
  stops.add('Lower Thirds studio', () => {
    studio.close();
  });
  handleStudio({
    studio,
    fromOperator,
    get: (id) => lowerThirds.get(id),
    engine,
    live: studioLive,
    log: (line) => {
      log.info(line);
    },
  });
  const fromLowerThirds = (e: IpcMainInvokeEvent) => fromOperator(e) || studio.isPage(e.sender);
  const lowerThirdsChanged = () => {
    const list = lowerThirds.list();
    sendToOperator(IPC.lowerThirds.changed, list);
    studio.send(list);
    // A phone lists them too (Session 54, D5).
    network?.hint('lowerThirds');
  };
  const notLowerThirdOperator = {
    ok: false as const,
    message: 'Only the operator window and the Lower Thirds studio can change lower thirds.',
  };
  const lowerThirdIds = z.array(idSchema).max(500);
  handle(IPC.lowerThirds.list, () => lowerThirds.list());
  handle(IPC.lowerThirds.save, (e, id, raw) => {
    if (!fromLowerThirds(e)) return notLowerThirdOperator;
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
    if (!fromLowerThirds(e)) return notLowerThirdOperator;
    const ids = lowerThirdIds.safeParse(raw);
    if (!ids.success) return { ok: false as const, message: 'Those lower thirds cannot be deleted.' };
    const removed = lowerThirds.remove(ids.data);
    if (removed.length > 0) lowerThirdsChanged();
    return { ok: true as const, ids: removed };
  });
  handle(IPC.lowerThirds.restore, (e, raw) => {
    if (!fromLowerThirds(e)) return notLowerThirdOperator;
    const ids = lowerThirdIds.safeParse(raw);
    if (!ids.success) return { ok: false as const, message: 'Those lower thirds cannot be brought back.' };
    const back = lowerThirds.restore(ids.data);
    if (back.length > 0) lowerThirdsChanged();
    return { ok: true as const, ids: back };
  });
  // The MIDI controller's settings: which device, and what its notes and controllers do.
  const midiNow = () => midiSettingsNow(settings.get('midi'));
  // The MIDI devices the operator window sees, and what a phone asked it to learn (Session 54: the phone as a full
  // Drashti chooses among this computer's own devices, and learns from a press on its controller).
  let seenMidi: MidiSeen | null = null;
  let midiLearning: MidiLearnable | null = null;
  /** Keep MIDI settings, the window's or a phone's alike: a learn waiting is done, and the phones read them again. */
  const keepMidi = (raw: unknown) => {
    const parsed = midiSettingsSchema.safeParse(raw);
    if (!parsed.success) return { ok: false as const, message: 'Those MIDI settings cannot be kept.' };
    settings.set('midi', parsed.data);
    midiLearning = null;
    net.hint('setup');
    return { ok: true as const, settings: parsed.data };
  };
  handle(IPC.midi.get, () => midiNow());
  handle(IPC.midi.set, (e, raw) =>
    fromOperator(e)
      ? keepMidi(raw)
      : { ok: false as const, message: 'Only the operator window can set up MIDI.' },
  );
  handle(IPC.midi.report, (e, raw) => {
    const seen = fromOperator(e) ? midiSeenSchema.safeParse(raw) : null;
    if (seen?.success && JSON.stringify(seen.data) !== JSON.stringify(seenMidi)) {
      seenMidi = seen.data;
      net.hint('setup');
    }
    return null;
  });

  // ---- the local network ----------------------------------------------------------
  // Phones and tablets on the mandir's Wi-Fi, once paired (README "The local network"). Off until
  // the operator turns it on (Pro Mode only); the server runs in a worker of its own.
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
      // A phone deciding on them reads them again (Session 54).
      net.hint('queue');
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
  if (!selfTestRun) announcements.resume();
  stops.add('announcements', () => {
    announcements.close();
  });
  // Files between Drashti and its phones (Session 54): playlists shared with them, and files a phone adds, sent into
  // the media folder's uploads folder and imported as a dropped file is (network/phone-files.ts).
  const phoneDevices = new DeviceRepo(db);
  /** The playlist open in Pro Mode's window, as it says (Session 55, Part 8: a phone's Add photos go there). */
  let openInPro: string | null = null;
  /** Make a slide… (alpha.21): the playlist a made slide can go into, Pro Mode's open one (a playlist, not a folder). */
  const openPlaylistForSlides = (): { id: string; name: string } | null => {
    if (mode !== 'pro' || openInPro === null) return null;
    const row = libraryDb
      .prepare(
        'SELECT id, name FROM playlists WHERE id = ? AND deleted_at IS NULL AND is_folder = 0 AND is_template = 0',
      )
      .get(openInPro) as { id: string; name: string } | undefined;
    return row ?? null;
  };
  /**
   * Make a slide… (alpha.21): the part of a PDF page, drawn at the hall's picture size, kept in the library as a
   * picture (an import, as any picture is), a presentation of one slide holding it, and a row at the end of the open
   * playlist when asked; the operator window is told, for its Undo.
   */
  keepPageSlide = async (png, name, place, current) => {
    const playlist = place === 'playlist' ? openPlaylistForSlides() : null;
    const canKeep = () =>
      current() &&
      (place !== 'playlist' || (playlist !== null && openPlaylistForSlides()?.id === playlist.id));
    const cancelled = {
      ok: false as const,
      message: 'The editor or open playlist changed. Choose where the slides go and try again.',
    };
    if (!canKeep()) return cancelled;
    // The picture's file is named as its slide is (Media lists it by that name).
    const file = `${cutText(name.replace(/[\\/:*?"<>|]/gu, ' ').trim(), 120) || 'Page'}.png`;
    const pictures = Array.isArray(png) ? png : [png];
    const mediaIds: string[] = [];
    for (const [index, picture] of pictures.entries()) {
      if (!canKeep()) return cancelled;
      const mediaId = await keepMadePicture(
        picture,
        pictures.length === 1 ? file : `${String(index + 1)} ${file}`,
        'drashti-page-slide-',
      );
      if (mediaId === null)
        return { ok: false, message: 'The slide’s picture could not be kept: try again.' };
      mediaIds.push(mediaId);
    }
    if (!canKeep()) return cancelled;
    const libraryId = presentations.ensureLibrary('Default');
    const size = pictureSize(screenRepo.allScreens(), screenRepo.firstGroup('audience'));
    const madeName = presentations.uniqueName(libraryId, name);
    const { id, itemId } = libraryDb.transaction(() => {
      const id = presentations.insert(pageSlidePresentation(libraryId, madeName, mediaIds, size));
      const [itemId = null] = playlist
        ? playlists.addItems(playlist.id, null, [{ kind: 'presentation', presentationId: id }])
        : [];
      return { id, itemId };
    })();
    contentChanged([id]);
    if (itemId !== null) playlistsChanged();
    sendToOperator(IPC.slideEditor.slideMade, { presentationId: id, name: madeName, itemId });
    log.info(`Library: a slide made from a PDF page${itemId !== null ? ', in the open playlist' : ''}`);
    return {
      ok: true,
      presentationId: id,
      name: madeName,
      playlist: itemId !== null && playlist ? playlist.name : null,
    };
  };
  const phoneFiles = new PhoneFiles({
    db: libraryDb,
    settings,
    playlists,
    presentations,
    search,
    device: (id) => phoneDevices.get(id),
    mediaDir,
    dir: join(mediaDir, UPLOADS_DIR),
    importFiles: async (paths) => {
      const result = await imports.start(paths, {});
      return result.ok ? { ok: true, runId: result.run.id } : { ok: false, message: result.message };
    },
    report: (runId) => importRepo.report(runId),
    onAir: () => streaming.inUse() || testOnAir,
    simpleMode: () => mode === 'simple',
    notice: (text) => {
      sendToOperator(IPC.app.notice, { text });
    },
    changed: (renamed) => {
      for (const id of renamed) slides.invalidate(id);
      libraryChanged(true);
      playlistsChanged();
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    // Tests only (never a packaged Drashti): a smaller size limit.
    maxBytes: Number(sw('DRASHTI_TEST_UPLOAD_MAX_BYTES') ?? 0) || undefined,
    // No file is taken while Drashti is not let in (Session 54).
    letIn: isLetIn,
    // A phone's Add photos (Session 55, Part 8): the playlist open in Pro Mode's window; none in Simple Mode.
    openPlaylist: () => (mode === 'pro' ? openInPro : null),
    // Question 5 (3 Nov 2026): in Simple Mode a phone's pictures go to the end of its playlist (the open one, Session 56).
    simplePlaylist: () => (mode === 'simple' ? simplePlaylist.current() : null),
  });
  // The library's changes a phone makes as the window does (Session 54, the phone as a full Drashti): filled in
  // below, where the window's own requests for them are registered.
  let playlistChanges: PlaylistChanges | null = null;
  // The phone's own (Session 55, Part 9): the wallpapers (made above), and the quick bar's pins (set further down).
  const wallpapers = (): WallpaperService => {
    return wallpaperService;
  };
  let quickBarNow: { view(): QuickPin[]; set(pins: QuickPin[]): QuickBarResult } | null = null;
  const STILL_STARTING = { ok: false as const, message: 'Drashti is still starting: try again in a moment.' };
  let presentationChanges: Pick<DesktopLibrary, 'removePresentations' | 'restorePresentations'> | null = null;
  const net = new NetworkService({
    // Phones and tablets work only while Drashti is let in (Session 54): every request, pairing and file refused.
    letIn: isLetIn,
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
        packaged: packaged(),
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        platform: process.platform,
        arch: process.arch,
        override: sw('DRASHTI_FFMPEG'),
      }),
      previewDir: join(app.getPath('userData'), 'Network', 'previews'),
      localName: localName(),
      refuseLoopback: networkRefuseLoopback,
      uploads: { dir: join(mediaDir, UPLOADS_DIR), mediaDir },
    }),
    localName: () => networkShown?.localName ?? localName(),
    ...(networkShown ? { interfaceAddresses: () => networkShown.addresses } : {}),
    engine: {
      dispatch: (command) => engine.dispatch(command),
      snapshot: () => withoutCaptions(engine.snapshot()),
      state: () => stateWithoutCaptions(engine.current),
    },
    // A phone's Save captures nothing while the stream is on air or recording (C6's review, MEDIUM 3).
    onAir: () => streaming.inUse() || testOnAir,
    nativeSlidePicture: (slide, looks, current, signal) =>
      captureWithShowAbort(
        (changed) => engine.onChange(changed),
        current,
        signal,
        (stopped) => pdfCopies.picture(slide, looks, current, stopped),
      ),
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
      mediaSource: (mediaId) =>
        previewSource(mediaId, {
          mediaDir,
          kindAndFile: (id) => media.kindAndFile(id),
          display: (id, key) => {
            const found = media.file(id);
            return found?.sha256 && !found.missing ? displayCopies.relativePath(found.sha256, key) : null;
          },
          sharpened: (id, step) => {
            const found = media.file(id);
            return found && !found.missing ? sharpened.relativePath(found.sha256, step) : null;
          },
          // A picture's blurred copy (Session 55, D): a phone draws it behind a photo as the screens do.
          blurred: (id) => {
            const found = media.file(id);
            return found && !found.missing ? blurred.relativePath(found.sha256) : null;
          },
        }),
      // A sound plays on a phone only while a playlist shared with phones has it (Session 54, D3).
      sharedSound: (mediaId) =>
        sharedSoundFile(mediaId, {
          mediaDir,
          kindAndFile: (id) => media.kindAndFile(id),
          shared: (id) => playlists.isSharedMedia(id),
        }),
      stage: () => {
        const groupId = screenRepo.firstGroup('stage');
        return { groupId, languages: groupId ? looks.liveLanguages(groupId) : null };
      },
      // A layout's audience picture box on a tablet (Session 51): the hall as this computer's stage screens draw it.
      hallGroups: () => screenRepo.groups(),
      hall: () => ({ groupId: screenRepo.firstGroup('audience') }),
      // Audience and Stage (Session 50): a Remote says which are off.
      switches: () => manager.switches(),
      clockStyle: mainClockStyle,
    },
    // The phone as a mirror of the operator window (Session 54, D5): read as the window reads them, never changed.
    mirror: {
      media: () =>
        media.list().map((m) => ({
          id: m.id,
          name: m.name,
          kind: m.kind,
          missing: m.missing,
          unplayable: m.unplayable,
        })),
      lowerThirds: () => lowerThirds.list(),
      music: () =>
        music.view().playlists.map((p) => ({ id: p.id, name: p.name, trackCount: p.tracks.length })),
      keys: () => ({ platform: process.platform, singleKeys: settings.get('singleLetterKeys') !== false }),
      // An item's first step in a Repeat Slides playlist (D5 review), as the window's Start on an item finds it.
      repeatStep: (playlistId, itemId) =>
        playableDoc(repeatPresentationId(playlistId))?.groups.find((g) => g.id === itemId)?.slides[0]
          ?.index ?? null,
    },
    audio: { music, stepsAside: () => stepsAside, setStepsAside: setMusicStepsAside },
    playMusic: (who, playlistId, index) => {
      const played = music.play(playlistId, index);
      if (played.ok) log.info(`Music: ${who} played it`);
      return played.ok ? { ok: true as const } : { ok: false as const, message: played.message };
    },
    announcements: {
      submit: (device, address, input) => announcements.submit(device, address, input),
      statusFor: (device, args) => announcements.statusFor(device, args),
    },
    // The phone as a full Drashti (Session 54): the computer's screens and Audience and Stage, as the window's own
    // requests change them; covering the controls is asked in the computer's own box, never taken from a phone.
    desktop: {
      screens: {
        snapshot: () => screens.snapshot(),
        controlsDisplayId: () => operatorDisplayId(),
        createGroup: (name) => screenChanges.createGroup(name),
        renameGroup: (id, name) => screenChanges.renameGroup(id, name),
        setGroupRole: (id, role) => screenChanges.setGroupRole(id, role),
        deleteGroup: (id) => screenChanges.deleteGroup(id),
        assignDisplay: (groupId, displayId, options) =>
          screenChanges.assignDisplay(groupId, displayId, options),
        updateScreen: (id, patch, options) => screenChanges.updateScreen(id, patch, options),
        setDisplayJob: (displayId, job, options) => screenChanges.setJob(displayId, job, options),
        removeScreen: (id) => screenChanges.removeScreen(id),
        identify: () => {
          screenChanges.identify();
        },
        pending: () => keepScreens.current(),
        keep: () => keepScreens.keep(),
        goBack: () => keepScreens.goBack(),
      },
      switches: {
        get: () => screenSwitches.get(),
        asksFirst: (which) => screenSwitches.asksFirst(which),
        turn: (which, on) => screenSwitches.turn(which, on),
      },
      // The stage layout every stage screen shows (Session 55), as the Stage screen panel's Layout chooses it.
      stageLayouts: {
        list: () => stageLayouts.list().map(({ id, name }) => ({ id, name })),
        chosenId: () => stageLayouts.chosenId(),
        choose: (id) => stageLayouts.choose(id),
      },
      inputs: {
        view: () => inputs.view(),
        access: () => inputs.access(),
        cameras: () => seenCameras,
        add: (fields) => inputs.add(fields),
        update: (id, fields) => inputs.update(id, fields),
        remove: (id) => inputs.remove(id),
      },
      windows: {
        list: () => shownWindows.list(),
        show: (id) => shownWindows.show(id),
      },
      queue: {
        view: () => announcements.view(),
        approve: (input) => announcements.approve(input),
        reject: (input) => announcements.reject(input),
        takeOff: (input) => announcements.takeOff(input),
      },
      midi: {
        view: () => ({ settings: midiNow(), seen: seenMidi, learning: midiLearning }),
        listen: () => {
          sendToOperator(IPC.midi.ask, { listen: true });
        },
        set: (next) => {
          const kept = keepMidi(next);
          if (kept.ok) sendToOperator(IPC.midi.changed, kept.settings);
          return kept;
        },
        learn: (action) => {
          midiLearning = action;
          sendToOperator(IPC.midi.ask, { listen: true });
          sendToOperator(IPC.midi.ask, { learn: action });
          net.hint('setup');
        },
      },
      library: {
        newFromWords: (name, words) => wordsChanges.newFromWords(name, words),
        removePresentations: (ids) =>
          presentationChanges?.removePresentations(ids) ?? { ok: false, message: 'Nothing was removed.' },
        restorePresentations: (ids) =>
          presentationChanges?.restorePresentations(ids) ?? { ok: false, message: 'Nothing was restored.' },
        playlists: () => playlistChanges,
      },
      simple: () => simpleNow(),
      confirmCover: async (question) => {
        const box = coverBox(question, process.platform);
        const parent = operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : undefined;
        const answer = parent ? await dialog.showMessageBox(parent, box) : await dialog.showMessageBox(box);
        return answer.response === 1;
      },
    },
    files: phoneFiles,
    // The phone's own (Session 55, Part 9): each the very function the window's own request calls.
    phone: {
      wallpapers: {
        view: () => wallpapers().view(),
        choose: (id) => wallpapers().choose(id),
        rename: (id, name) => wallpapers().rename(id, name),
        remove: (id) => wallpapers().remove(id),
        restore: (id) => wallpapers().restore(id),
      },
      quickBar: {
        view: () => quickBarNow?.view() ?? [],
        set: (pins) => quickBarNow?.set(pins) ?? STILL_STARTING,
      },
      looks: {
        look: (mediaId) => (MEDIA_ID_PATTERN.test(mediaId) ? media.look(mediaId) : null),
        photo: (mediaId) => MEDIA_ID_PATTERN.test(mediaId) && media.photoByDefault(mediaId),
        set: (mediaId, look) => keepLook(mediaId, look),
      },
      rename: {
        media: (mediaId, name) => renameMediaFile(mediaId, name),
        presentation: (presentationId, name) => renamePresentationNamed(presentationId, name),
      },
      whenEnds: (itemId, whenEnds) => playlistChanges?.setWhenEnds(itemId, whenEnds) ?? STILL_STARTING,
    },
    // With the window request's own arguments where a phone's has them (Session 55, Part 9: Simple Mode's bounds).
    refused: (channel, args) => refusalFor(channel, args) !== undefined,
    // In words true for this computer's access (Session 55).
    refusal: () => simpleRefusalText(modes.simpleOnly()),
    // In Simple Mode a phone does only what its window does (Session 55, the owner's answer of 30 Oct 2026).
    simple: simplePhones,
    changed: (status) => {
      sendToOperator(IPC.network.changed, status);
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
    notice: (text) => sendToOperator(IPC.app.notice, { text }),
    now: Date.now,
  });
  network = net;
  net.resume();
  stops.add('network', () => net.close());
  const osc = new OscService({
    settings: { get: (key) => settings.get(key), set: laterSetting },
    letIn: isLetIn,
    canConfigure: () => mode === 'pro',
    run: (action) => net.runShowAction(action).status === 200,
    changed: (status) => sendToOperator(IPC.osc.changed, status),
    log: (level, message) => {
      if (level === 'warn') log.warn(message);
      else log.info(message);
    },
  });
  void osc.resume();
  stops.add('OSC', () => osc.close());
  handle(IPC.osc.status, (e) => {
    if (!fromOperator(e)) throw new Error('Only the operator window can read OSC settings.');
    return osc.status();
  });
  handle(IPC.osc.configure, (e, settings) =>
    fromOperator(e)
      ? osc.configure(settings)
      : { ok: false as const, message: 'Only the operator window can change OSC settings.' },
  );
  // On air or off, the phones' pieces come slower or at full speed again (Session 54).
  phoneFiles.watch(() => {
    net.uploadsChanged();
  });
  stops.add('files from phones', () => {
    phoneFiles.close();
  });

  // ---- output nodes (Session 13) ----------------------------------------------------------------
  const nodeRepo = new NodeRepo(db);
  const wanted = new WantedMedia(
    db,
    // The wallpapers' pictures (Session 55, Part 6), so a node shows the chosen one at once.
    () => wallpaperService.pictureIds(),
    Date.now,
    // A picture's sharpened copy (Session 26f), once it is ready: one more file for the node, copied as
    // media is, right after the picture's own.
    {
      display: (mediaId) => {
        const found = media.file(mediaId);
        const copy =
          found?.sha256 && !found.missing ? displayCopies.ready(found.sha256, media.look(mediaId)) : null;
        return copy
          ? { id: displayMediaId(mediaId, copy.key), sha256: copy.hash, bytes: copy.bytes, ext: copy.ext }
          : null;
      },
      want: (mediaId) => {
        const look = media.look(mediaId);
        const step = look ? sharpenStep(look.sharpness) : 0;
        const found = step > 0 ? media.file(mediaId) : null;
        const file = found && !found.missing ? sharpened.fileOf(found.sha256, step) : null;
        return file
          ? { id: copyMediaId(mediaId, step), sha256: file.hash, bytes: file.bytes, ext: file.ext }
          : null;
      },
      // A picture's blurred copy (Session 55, D), once it is ready and the picture is drawn with it.
      blurred: (mediaId) => {
        const found = media.file(mediaId);
        if (!found || found.missing || !fillsWithBlur(mediaId, media.look(mediaId))) return null;
        const file = blurred.fileOf(found.sha256);
        return file ? { id: blurMediaId(mediaId), sha256: file.hash, bytes: file.bytes, ext: 'jpg' } : null;
      },
      source: (copyId) => {
        const display = displayOfId(copyId);
        if (display) {
          const found = media.file(display.mediaId);
          const file =
            found?.sha256 && !found.missing ? displayCopies.fileOf(found.sha256, display.key) : null;
          return file
            ? { path: join(mediaDir, file.path), sha256: file.hash, bytes: file.bytes, ext: file.ext }
            : null;
        }
        const blurOf = blurOfId(copyId);
        if (blurOf) {
          const found = media.file(blurOf);
          const relative = found && !found.missing ? blurred.relativePath(found.sha256) : null;
          const file = found ? blurred.fileOf(found.sha256) : null;
          return relative && file
            ? { path: join(mediaDir, relative), sha256: file.hash, bytes: file.bytes, ext: 'jpg' }
            : null;
        }
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
  // A paired node's report (x49) is kept by Main's reports, made further on: until then, the node keeps it.
  let reportsForNodes: ReportService | null = null;
  const nodes = new NodeService({
    nodes: nodeRepo,
    write: (key, run) => {
      later.write(key, run);
    },
    screens: screenRepo,
    settings,
    pointed: () => pointAhead.current(),
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
    // A node with no audience screen of its own draws this hall in a stage layout's box (Session 51).
    hall: hallHere,
    // A node's screen being adjusted in Screens shows its grid too (x27).
    adjusting: (screenId) => adjustingScreen(screenId),
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
      snapshot: () => withoutCaptions(engine.snapshot()),
      state: () => stateWithoutCaptions(engine.current),
      rev: () => engine.rev,
      acceptsPress: (rev, session) => engine.acceptsPress(rev, session),
      session: engine.session,
    },
    runShowAction: (command, who) => net.runShowAction({ op: 'command', args: command }, who),
    wanted: (state, everything) => wanted.list(state, everything),
    mediaFile: (mediaId) => wanted.source(mediaId, mediaDir),
    nodeReport: (node, body) =>
      reportsForNodes
        ? reportsForNodes.fromNode(node, body)
        : Promise.resolve({ ok: false as const, message: 'Main is starting: the report goes in a moment.' }),
    onAir: () => streaming.inUse(),
    changed: (status) => {
      engine.videoCuePageJoined('');
      sendToOperator(IPC.nodes.changed, status);
    },
    screensChanged: () => {
      sendToOperator(IPC.screens.changed, screens.snapshot());
      slideEditor?.send(IPC.screens.changed, screens.snapshot());
      // A node's displays or screens changed: copies follow the screens' size, a node's included (Session 26h).
      void sharpened.screensChanged();
    },
    thumbs: (thumbs) => {
      sendToOperator(IPC.nodes.thumbs, thumbs);
    },
    // A paired computer's screen could not play a video (Q60-44, the owner's answer A): it keeps what it showed; the
    // video plays on everywhere else, and the operator is told, once for each node and showing (media/cannot-play.ts).
    videoCue: (nodeId, report) => {
      if (
        screenRepo.screen(report.screenId)?.nodeId !== nodeId ||
        engine.current.videoCue?.id !== report.cueId
      )
        return;
      const participant = `node:${nodeId}:${report.screenId}`;
      if (report.state === 'loading') engine.videoCuePageJoined(participant);
      else engine.reportVideoCue(report.cueId, participant, report.state === 'ready');
    },
    cannotPlay: (node, report) => {
      const file = media.kindAndName(report.mediaId);
      if (file?.kind !== 'video') return;
      const screen = screenRepo.screens().find((s) => s.id === report.screenId)?.name ?? report.screenId;
      const told = nodeCannotPlay.heard(node, screen, file, report);
      if (!told) return;
      log.warn(told.log);
      sendToOperator(IPC.app.notice, { text: told.notice });
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
    notice: (text) => sendToOperator(IPC.app.notice, { text }),
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
          // Taken as its window closed (its screen switched off, say: Session 51), it is not what its display
          // shows: never sent, so the dashboard never shows it.
          const state = manager.status().find((st) => st.screenId === screenId)?.state;
          if (win.isDestroyed() || outputWindows.get(screenId) !== win) return;
          if (state !== 'showing' && state !== 'stopped') return;
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
  handle(IPC.nodes.remove, (e, id) => {
    if (!fromOperator(e)) return notNodesOperator;
    const removed = nodes.remove(id);
    // Its screens went with it (Session 51): the hall's picture may be another group's now. Reconciled, as after any
    // change to the screens, so this computer's stage screens, the other nodes and a tablet's stage display are told
    // (onChange). Not on every node report (the dependency the service calls): each would push every node's screens.
    if (removed.ok) manager.reconcile();
    return removed;
  });
  handle(IPC.nodes.newIdentity, (e) => (fromOperator(e) ? nodes.newIdentity() : notNodesOperator));
  handle(IPC.nodes.everything, (e, id, on) =>
    fromOperator(e) ? nodes.setEverything(id, on) : notNodesOperator,
  );
  controllersHaveActions = () => nodes.hasControllerActions();
  handle(IPC.nodes.setControllerAreas, (e, id, areas) =>
    fromOperator(e) ? nodes.setControllerAreas(id, areas) : notNodesOperator,
  );
  handle(IPC.nodes.setController, (e, id, on) =>
    fromOperator(e) ? nodes.setController(id, on) : notNodesOperator,
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
  /** Each output page's warm-up end already said (when it ended, on its page's clock): Session 58, WU-2. */
  const warmUpEnds = new Map<string, number>();
  /** Told as each output page's first frame is said (the opening waits for them: set further down). */
  let firstPainted: () => void = () => undefined;
  handle(IPC.output.report, (e, raw) => {
    const screenId = manager.screenIdFor(e.sender.id);
    const r = raw as {
      droppedFrames?: unknown;
      paintedRev?: unknown;
      warming?: unknown;
      missingFonts?: unknown;
      firstPaint?: { rev?: unknown; wallAt?: unknown } | null;
      warmUp?: unknown;
    } | null;
    // How its page's warm-up ended and how long it took, once per page (Session 58, WU-2).
    const warmUpEnd = warmUpEndOf(r?.warmUp);
    if (screenId && warmUpEnd && warmUpEnds.get(screenId) !== warmUpEnd.at) {
      warmUpEnds.set(screenId, warmUpEnd.at);
      log.info(warmUpEndLine(outputNames.get(screenId) ?? 'an output', warmUpEnd));
      // One drawn whole: the stream's page opened from now on draws without a warm-up of its own (Session 60, X21).
      streamPageWarmUp.hallEnded(warmUpEnd.how);
    }
    // Its page's first painted frame, once per page: the start's last phase line (Sessions 31–36, PERF-1).
    const first = r?.firstPaint;
    if (
      screenId &&
      typeof first?.rev === 'number' &&
      typeof first.wallAt === 'number' &&
      firstPaints.get(screenId) !== first.wallAt
    ) {
      firstPaints.set(screenId, first.wallAt);
      firstPainted();
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
      // A page whose picture failed, having painted a change since its last failure (its boundary draws the scene
      // again at each change; a failure would have been said before this report): it draws again (x53). Given up on
      // for it, it is back by itself, no reload.
      const failedAt = pictureFailedAt.get(screenId);
      const win = outputWindows.get(screenId);
      if (failedAt !== undefined && r.paintedRev > failedAt && win && !win.isDestroyed()) {
        pictureFailedAt.delete(screenId);
        watchdog.drawsAgain(win.webContents, outputNames.get(screenId) ?? 'an output');
        manager.setStopped(screenId, false);
      }
    }
    return null;
  });
  // Render errors in any window (Session 23): logged; an output draws black and is reloaded once, or given up on if it
  // fails again (x53), unless the video it keeps failing on comes off (keepsFailing, above).
  hearRenderErrors({
    log: (line) => {
      log.warn(line);
    },
    watchdog,
    failed: (name) => {
      const screenId = screenOfOutput(name);
      const failing = failingPage(name);
      if (screenId === undefined || !failing) return false;
      // A failure from a draw of what was just taken off is not a new one (keeps-failing.ts): nothing more is done.
      if (
        keepsFailing.stillDrawingWhatWentOff(name, Date.now(), localReports.get(screenId)?.paintedRev ?? null)
      )
        return true;
      pictureFailedAt.set(screenId, engine.rev);
      const tookOff = takeOffWhatFails(name, failing.where, 'its picture failed as it drew');
      if (tookOff) keepsFailing.tookOff(name, engine.rev, Date.now());
      return tookOff;
    },
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
      const sound = streaming.soundContents();
      if (sound && !sound.isDestroyed()) sound.send(IPC.output.testClock, { at });
      return reached;
    };
  // Tests only: LIVE's clock in the operator window held the same way (Session 54, C review), on its own so a test that
  // holds the screens' clock still sees the controls' time move. Says whether it reached it.
  if (testClockHold)
    (globalThis as { drashtiTestHoldLive?: (at: number | null) => boolean }).drashtiTestHoldLive = (at) => {
      if (!operatorWindow || operatorWindow.isDestroyed()) return false;
      operatorWindow.webContents.send(IPC.output.testClock, { at });
      return true;
    };
  // Tests only (never a packaged Drashti): every screen group moves Calm or Bold, as the performance check's Bold
  // transitions ask (Session 55: Movement went with Looks and every group is Calm; the specs that draw Bold ask here).
  // On the event loop, never inside the test's call itself: that can come between a query's steps, and the library's
  // connection refuses another query then ("This database connection is busy executing a query").
  if (!packaged())
    (globalThis as { drashtiTestMovement?: (movement: Movement) => void }).drashtiTestMovement = (
      movement,
    ) => {
      setImmediate(() => {
        looks.moveAll(movement);
      });
    };
  if (testRenderErrors)
    (
      globalThis as { drashtiTestRenderError?: (screenId?: string, whileUp?: string | null) => number }
    ).drashtiTestRenderError = (screenId, whileUp) => {
      let sent = 0;
      for (const [id, win] of outputWindows)
        if (screenId === undefined || id === screenId) {
          // A file named (null: none): the scene fails each time it draws while that file is up (x53), and the page
          // keeps the word until it loads again; else it fails at once, whatever is up, until it loads again.
          if (whileUp === undefined) sendToPage(win, IPC.output.testThrow, {});
          else sendToPage(win, IPC.output.testThrowWhile, { mediaId: whileUp });
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
  handle(IPC.network.setAddFiles, (e, on) => (fromOperator(e) ? net.setAddFiles(on) : notNetworkOperator));
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
    if (!fromOperator(e) && !(slideEditor?.isPage(e.sender) ?? false))
      return { ok: false, message: 'Only the operator window can change timers.' };
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
  // A slide timer's own time and kind, from the slide editor's window too (Session 55, Parts 15 and 17a).
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
  /**
   * Countdown to the start (Session 55, Part 15): the sabha's time counted down over the wallpaper on the audience and
   * the stage, gone by itself at zero. Its one timer (by its name) made, or changed to this time, then shown.
   */
  const startCountdown = (time: unknown): TimerResult => {
    const at = startTimeSchema.safeParse(time);
    if (!at.success)
      return { ok: false, message: 'Write the sabha’s time as hours and minutes, for example 19:30.' };
    // A time already come today would go at once.
    if (startTimeGone(at.data, Date.now()))
      return { ok: false, message: 'That time has already come today: write the sabha’s time later today.' };
    const fields = startCountdownFields(at.data);
    const was = timers.list().find((t) => t.name === START_COUNTDOWN_NAME);
    const id = was ? (timers.update(was.id, fields) ? was.id : null) : timers.create(fields);
    if (id === null) return { ok: false, message: 'That timer no longer exists.' };
    engine.setTimers(timers.list());
    const shown = engine.dispatch({ type: 'showAudienceTimer', timerId: id });
    return shown.ok ? { ok: true, id } : { ok: false, message: shown.message };
  };
  handle(IPC.timers.startCountdown, (e, time) =>
    fromOperator(e) ? startCountdown(time) : { ok: false, message: 'Only the operator window can do that.' },
  );
  const playlistsChanged = () => {
    // A live item's order may have changed, and what comes next may be different.
    engine.reorderLive();
    engine.refreshNext();
    // A video row's When it ends (Session 55, Part 6), changed while it plays.
    engine.refreshEnds();
    sendToOperator(IPC.playlists.changed, { at: Date.now() });
    net.hint('playlists');
    syncAudios();
  };
  // A video input added, renamed or removed in Media (Session 51): the items naming one are read again, here and
  // on the phones, marked as on this computer or not, and Next goes to it or past it.
  inputsChanged = playlistsChanged;
  // Playlist playback and M3U (x50): only the operator chooses files; the import remains today’s queued import.
  const playlistFileWrite = sourceWrite(libraryDb, () => imports.giveWay());
  handle(IPC.playlists.setPlayOptions, (e, playlistId, raw) => {
    const id = idSchema.safeParse(playlistId);
    const options = playlistPlayOptionsSchema.safeParse(raw);
    if (!fromOperator(e) || simpleNow() || !id.success || !options.success)
      return { ok: false, message: 'Only the operator window in Pro Mode can change playlist playback.' };
    if (!playlists.setPlayOptions(id.data, options.data))
      return { ok: false, message: 'That playlist no longer exists.' };
    playlistsChanged();
    return { ok: true, ids: [id.data] };
  });
  const playlistFileFailure = (message: string): M3uResult => ({ ok: false, message });
  handle(IPC.playlists.importM3u, async (e, audio, targetId): Promise<M3uResult> => {
    if (
      !fromOperator(e) ||
      typeof audio !== 'boolean' ||
      (targetId !== null && !idSchema.safeParse(targetId).success)
    )
      return playlistFileFailure('Only the operator window can import a playlist file.');
    const parent = BrowserWindow.fromWebContents(e.sender);
    if (!parent) return playlistFileFailure('The operator window is no longer open.');
    const picked = await dialog.showOpenDialog(parent, {
      title: audio ? 'Import Sounds or a Playlist File' : 'Import a Playlist File (M3U)',
      properties: audio ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: audio
        ? [{ name: 'Sounds or M3U playlists', extensions: [...SOUND_EXTENSIONS, 'm3u', 'm3u8'] }]
        : [{ name: 'M3U playlists', extensions: ['m3u', 'm3u8'] }],
    });
    if (picked.canceled) return { ok: true, id: null, notTaken: [] };
    try {
      let id: string | null = null;
      const notTaken: M3uNotTaken[] = [];
      const guard = {
        signal: new AbortController().signal,
        allowed: () => !e.sender.isDestroyed() && fromOperator(e) && !accessShut(),
      };
      const importFiles = async (paths: string[]) => {
        const result = await imports.start(paths, mode === 'simple' ? SIMPLE_IMPORT : {});
        if (!result.ok) throw new M3uError(result.message);
        return importRepo.report(result.run.id)?.items ?? [];
      };
      for (const file of picked.filePaths.filter((path) => /\.m3u8?$/iu.test(path))) {
        const result = await importM3u(file, audio, {
          importFiles,
          isAudio: (mediaId) => media.kindAndName(mediaId)?.kind === 'audio',
          make: (name, rows, sounds) =>
            playlistFileWrite(guard, () => {
              if (sounds) {
                const made = audioPlaylists.create(cutText(name, 120));
                audioPlaylists.addTracks(
                  made,
                  rows.flatMap((r) => (r.item.kind === 'media' ? [r.item.mediaId] : [])),
                  null,
                );
                sendToOperator(IPC.music.changed, music.view());
                net.hint('music');
                return made;
              }
              const made = playlists.create(freeName(playlists, cutText(name, 180)), null, false);
              if (!made) throw new M3uError('The playlist could not be made: try importing the file again.');
              const added = playlists.addItems(
                made,
                null,
                rows.map((r) => r.item),
              );
              added.forEach((item, index) => {
                const title = rows[index]?.title;
                if (title) playlists.setItemLabel(item, title);
              });
              return made;
            }),
        });
        id = result.id ?? id;
        notTaken.push(...result.notTaken);
      }
      const sounds = audio ? picked.filePaths.filter((path) => !/\.m3u8?$/iu.test(path)) : [];
      if (sounds.length) {
        const report = await importFiles(sounds);
        const items = itemsMadeBy(report, sounds);
        id = await playlistFileWrite(guard, () => {
          const made =
            typeof targetId === 'string' && audioPlaylists.get(targetId)
              ? targetId
              : audioPlaylists.create('Audio playlist');
          audioPlaylists.addTracks(
            made,
            items.flatMap((i) =>
              i.kind === 'media' && media.kindAndName(i.mediaId)?.kind === 'audio' ? [i.mediaId] : [],
            ),
            null,
          );
          sendToOperator(IPC.music.changed, music.view());
          net.hint('music');
          return made;
        });
      }
      playlistsChanged();
      return { ok: true, id, notTaken };
    } catch (error) {
      return playlistFileFailure(error instanceof M3uError ? error.message : fileProblem(error, 'read'));
    }
  });
  handle(IPC.playlists.exportM3u, async (e, playlistId, audio): Promise<M3uResult> => {
    const parsed = idSchema.safeParse(playlistId);
    if (!fromOperator(e) || !parsed.success || typeof audio !== 'boolean')
      return playlistFileFailure('Only the operator window can export a playlist file.');
    const list = audio
      ? audioPlaylists.get(parsed.data)
      : playlists.tree().find((p) => p.id === parsed.data && !p.isFolder && !p.template);
    if (!list) return playlistFileFailure('That playlist no longer exists.');
    const parent = BrowserWindow.fromWebContents(e.sender);
    if (!parent) return playlistFileFailure('The operator window is no longer open.');
    try {
      const rows: M3uExportRow[] =
        audio && 'tracks' in list
          ? list.tracks.flatMap((t) => {
              const file = media.file(t.mediaId);
              return file
                ? [
                    {
                      label: t.name,
                      durationMs: t.playingMs ?? t.durationMs,
                      path: join(mediaDir, file.path),
                    },
                  ]
                : [];
            })
          : playlists.itemsOf(parsed.data).flatMap((item): M3uExportRow[] => {
              if (item.kind === 'media') {
                const file = media.file(item.mediaId);
                return file && !file.deleted
                  ? [
                      {
                        label: item.label,
                        durationMs: item.playingMs ?? item.durationMs,
                        path: join(mediaDir, file.path),
                      },
                    ]
                  : [];
              }
              return [
                {
                  label: item.label,
                  comment:
                    item.kind === 'presentation' ? 'Presentation' : item.kind === 'header' ? 'Header' : 'Row',
                },
              ];
            });
      const text = writeM3u(rows);
      const picked = await dialog.showSaveDialog(parent, {
        title: 'Export as M3U',
        defaultPath: `${list.name.replace(/[\\/:*?"<>|]/gu, '_')}.m3u8`,
        filters: [{ name: 'UTF-8 M3U playlist', extensions: ['m3u8'] }],
      });
      if (picked.canceled || !picked.filePath) return { ok: true, id: null, notTaken: [] };
      const file = /\.m3u8$/iu.test(picked.filePath) ? picked.filePath : `${picked.filePath}.m3u8`;
      if (file !== picked.filePath && existsSync(file)) {
        const replace = await dialog.showMessageBox(parent, {
          type: 'question',
          buttons: ['Replace', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          message: `Replace “${basename(file)}”?`,
          detail: 'A file with this name already exists.',
          noLink: true,
        });
        if (replace.response !== 0) return { ok: true, id: null, notTaken: [] };
      }
      await fsPromises.writeFile(file, text, 'utf8');
      return { ok: true, id: null, notTaken: [] };
    } catch (error) {
      return playlistFileFailure(error instanceof M3uError ? error.message : fileProblem(error, 'write'));
    }
  });
  // ---- a playlist's running order (alpha.22; main/running-order.ts) ----------------------------------
  // For the sanchalak, the anchor and the sound desk before a sabha: one of the operator's playlists (never a folder,
  // a template or an audio playlist), read as it is now. Copy running order puts its plain lines on the clipboard, by
  // the main process (a page's own clipboard is refused: windows/security.ts).
  const runningOrderSource = (playlistId: unknown) => {
    const parsed = idSchema.safeParse(playlistId);
    if (!parsed.success) return null;
    const list = playlists.tree().find((p) => p.id === parsed.data && !p.isFolder && !p.template);
    return list ? { name: list.name, items: playlists.itemsOf(list.id) } : null;
  };
  handle(IPC.playlists.copyRunningOrder, async (e, playlistId) => {
    if (!fromOperator(e))
      return { ok: false, message: 'Only Drashti’s own window can copy a running order.' } as const;
    const source = runningOrderSource(playlistId);
    if (!source) return { ok: false, message: 'That playlist no longer exists.' } as const;
    const rows = source.items.filter((i) => i.kind !== 'header').length;
    return clipboard.writeText(runningOrderLines(source)).then(
      () => ({ ok: true, rows }) as const,
      () => ({ ok: false, message: 'The running order could not be copied: try again.' }) as const,
    );
  });
  // Print running order… and Save running order as PDF…: from a hidden window as the manual is (main/manual-print.ts),
  // one page at a time across every printer, and never while the show is live (printingLive, the Manual's).
  const runningOrderPrinter = new RunningOrderPrinter({
    source: (playlistId) => runningOrderSource(playlistId),
    printed: () => {
      const style = mainClockStyle();
      return new Intl.DateTimeFormat(style.locale, { dateStyle: 'full', timeZone: style.timeZone }).format(
        Date.now(),
      );
    },
    live: printingLive,
    tempDir: () => app.getPath('temp'),
    suggestedFolder: () => testDownloadsDir ?? app.getPath('documents'),
    askWhere: async (suggested) => {
      if (!operatorWindow) return null;
      const picked = await dialog.showSaveDialog(operatorWindow, {
        title: 'Save the running order as a PDF',
        defaultPath: suggested,
        buttonLabel: 'Save',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (picked.canceled || !picked.filePath) return null;
      return picked.filePath.toLowerCase().endsWith('.pdf') ? picked.filePath : `${picked.filePath}.pdf`;
    },
  });
  const notPrintedHere = {
    ok: false,
    cancelled: false,
    message: 'Only Drashti’s own window can print a running order.',
  } as const;
  handle(IPC.playlists.printRunningOrder, (e, playlistId) =>
    fromOperator(e) && typeof playlistId === 'string'
      ? runningOrderPrinter.print(playlistId)
      : notPrintedHere,
  );
  handle(IPC.playlists.saveRunningOrderPdf, (e, playlistId) =>
    fromOperator(e) && typeof playlistId === 'string' ? runningOrderPrinter.pdf(playlistId) : notPrintedHere,
  );

  // Renamed (Session 52): the library's playlist items and slides that named it take its new name in one write, and
  // only that write can refuse the rename. What it returns runs once the library has the new name, the rename
  // standing whatever happens there (a failure is only logged), and before the list's change is told
  // (inputsChanged, just above, then reads the items and what comes next again, by the new name): those slides are
  // read again from now on (first, so what comes next reads them whatever fails after), the slides' copies kept for
  // Undo name it so too, and the operator's library, the phones and the nodes hear they changed. What is on the
  // screens keeps playing.
  inputRenamed = (from, to) => {
    const carried = carryInputName(libraryDb, from, to);
    return () => {
      for (const id of carried.presentations) slides.invalidate(id);
      revisions.carryInput(from, to);
      if (carried.presentations.length > 0) libraryChanged(true);
      if (carried.items.length + carried.cues.length > 0)
        log.info(
          `A renamed video input’s new name went to ${String(carried.items.length)} playlist item(s) and ${String(carried.cues.length)} slide background(s)`,
        );
    };
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
    importNotice,
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
    importNotice,
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
  if (!selfTestRun) void dropFolder.start();
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
  playlistChanges = registerPlaylistIpc({
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
      fromDrop: (paths) => smartFolders.fromDrop(paths),
      views: () => smartFolders.views(),
      removeMissing: (playlistId) => smartFolders.removeMissing(playlistId),
      itemsRestored: (itemIds) => {
        smartFolders.itemsRestored(itemIds);
      },
      refresh: () => smartFolders.refresh(),
    },
    opened: (playlistId) => {
      // The window says which it has open, or that it closed it: Simple Mode takes Pro Mode's as it comes (Session 55),
      // and since Session 56 follows what its own window opens; a phone then opens that one (it reads the hall again),
      // and its pictures go there.
      if (simplePlaylist.opened(playlistId, mode)) {
        network.uploadsChanged();
        network.hint('mode');
      }
      // A phone's Add photos go to it (Session 55, Part 8): the phones hear which.
      if (mode === 'pro' && playlistId !== openInPro) {
        openInPro = playlistId;
        network.uploadsChanged();
      }
      if (playlistId === null) return;
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
  handle(IPC.shastra.remove, (e, textId) => {
    if (!fromOperator(e))
      return { ok: false as const, message: 'Only the operator window can remove a book.' };
    const t = textIdSchema.safeParse(textId);
    if (!t.success || !shastra.remove(t.data))
      return { ok: false as const, message: 'That book is not loaded.' };
    listChanged('shastra');
    // Its passages in playlists are missing now: the playlists are read again (and what comes next).
    playlistsChanged();
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
                : mode === 'simple'
                  ? {
                      name: 'Sounds, videos, pictures, PDFs and PowerPoint or Keynote decks',
                      extensions: SIMPLE_IMPORT_EXTENSIONS,
                    }
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
  // Presentations taken out of the library and put back: the window's and a phone's alike (Session 54).
  presentationChanges = {
    removePresentations: (ids) => {
      const parsed = idListSchema.safeParse(ids);
      if (!parsed.success) return { ok: false as const, message: 'Nothing was removed.' };
      const removed = presentations.remove(parsed.data);
      for (const id of removed) slides.invalidate(id);
      engine.refreshNext();
      log.info(`Removed ${removed.length} presentation(s)`);
      libraryChanged(true);
      return { ok: true as const, ids: removed };
    },
    restorePresentations: (ids) => {
      const parsed = idListSchema.safeParse(ids);
      if (!parsed.success) return { ok: false as const, message: 'Nothing was restored.' };
      const restored = presentations.restore(parsed.data);
      for (const id of restored) slides.invalidate(id);
      engine.refreshNext();
      log.info(`Restored ${restored.length} presentation(s)`);
      libraryChanged(true);
      return { ok: true as const, ids: restored };
    },
  };
  const changingPresentations = presentationChanges;
  handle(IPC.library.removePresentations, (e, ids) =>
    fromOperator(e)
      ? changingPresentations.removePresentations(ids)
      : { ok: false as const, message: 'Nothing was removed.' },
  );
  handle(IPC.library.restorePresentations, (e, ids) =>
    fromOperator(e)
      ? changingPresentations.restorePresentations(ids)
      : { ok: false as const, message: 'Nothing was restored.' },
  );
  handle(IPC.library.getImportReport, (_e, runId) => {
    const parsed = runIdSchema.safeParse(runId);
    return parsed.success ? importRepo.report(parsed.data) : null;
  });
  handle(IPC.library.takeAutomaticImportNotices, (e) => {
    if (!fromOperator(e)) return [];
    return importNotices.take();
  });
  handle(IPC.media.saveStill, async (e, mediaId, jpeg) => {
    if (!fromOperator(e) || typeof mediaId !== 'string' || !MEDIA_ID_PATTERN.test(mediaId)) {
      return { ok: false as const, message: 'Only the operator window can keep still frames.' };
    }
    const file = media.file(mediaId);
    if (!file?.sha256 || file.missing) return { ok: false as const, message: 'That media item has no file.' };
    return saveStill(mediaDir, file.sha256, jpeg);
  });
  // Media information… (alpha.20, Q60-34 item 1; the owner's "Yes, all A" to Q60-39): a video's or a sound's file read
  // by the bundled FFmpeg at low priority, one at a time, with the library's notes on it. It only reads, so Simple Mode
  // has it too; nothing on the screens or in the library changes.
  const mediaDetails = new MediaDetailsService({
    mediaDir,
    row: (id) => media.about(id),
    ffmpeg: pictureFfmpeg,
    converting: (id) =>
      conversions.list().some((j) => j.mediaId === id && (j.state === 'waiting' || j.state === 'converting')),
  });
  handle(IPC.media.details, (e, mediaId) =>
    fromOperator(e) && typeof mediaId === 'string' && MEDIA_ID_PATTERN.test(mediaId)
      ? mediaDetails.details(mediaId)
      : { ok: false as const, message: 'Only the operator window can read a file’s information.' },
  );
  // Resume where it stopped, last played and play counts (alpha.20, the owner's Q60-34 item 3 and his "Yes, all A" to
  // Q60-39): Main follows the engine's state; each write waits while the library is busy. An audio playlist stopped
  // part-way plays on from its track. What plays at a quit keeps where it is.
  const historyMedia = editedPlayHistory(media, {
    sourceId: (id) => editedPlaying.sourceId(id),
    renditionOf: (id) => editedPlaying.renditionOf(id),
  });
  const history = new PlayHistory(
    { later: (key, run) => later.write(key, run), media: historyMedia, now: () => Date.now() },
    engine.current,
  );
  engine.onChange((state) => {
    history.changed(state);
    music.follow(state);
  });
  stops.add('play history', () => {
    history.quitting();
    music.quitting();
  });
  handle(IPC.media.resumePoint, (e, mediaId) =>
    fromOperator(e) && typeof mediaId === 'string' && MEDIA_ID_PATTERN.test(mediaId)
      ? historyMedia.resumeOf(mediaId)
      : null,
  );
  // Snapshot (alpha.20, the time bar's ⋯; the owner's "Yes, all A" to Q60-39 P6 (d) A): the frame on the screens, made
  // from the video's own file (media/snapshot.ts), a PNG in Media through the import, never put up. Pro Mode's.
  handle(IPC.media.snapshot, (e, playing) => {
    const ref = playingSchema.safeParse(playing);
    if (!fromOperator(e) || !ref.success)
      return { ok: false as const, message: 'Only the operator window can make a snapshot.' };
    return takeSnapshot(
      {
        state: () => engine.current,
        now: () => Date.now(),
        file: (id) => {
          const row = media.about(id);
          return row && !row.missing && !row.deleted && row.path !== ''
            ? { path: join(mediaDir, row.path), name: row.name }
            : null;
        },
        ffmpeg: pictureFfmpeg,
        importFile: async (path) => {
          const done = await imports.start([path], {});
          if (!done.ok) return { ok: false as const, message: done.message };
          const item = importRepo.report(done.run.id)?.items[0];
          if (item?.target?.kind === 'media') return { ok: true as const, mediaId: item.target.id };
          return {
            ok: false as const,
            message:
              item?.issues.find((problem) => problem.severity === 'error')?.message ??
              'Drashti could not add the snapshot to Media. Try again.',
          };
        },
      },
      ref.data,
    );
  });
  // Its Copy: the window's words on the clipboard, by the main process (copyWords).
  handle(IPC.media.copyDetails, (e, text) => copyWords(e, text));
  // Sound and picture… (alpha.20; the owner's "Yes, all A" to Q60-39 P2 A and P6 (a) A): a video's or a sound's own
  // tone and delays, kept with it; the engine stamps them again at once, so the hall and the stream follow. Pro Mode's.
  handle(IPC.media.playback, (e, mediaId) =>
    fromOperator(e) && typeof mediaId === 'string' && MEDIA_ID_PATTERN.test(mediaId)
      ? playbackOfFile(mediaId)
      : null,
  );
  handle(IPC.media.setPlayback, (e, mediaId, settings) => {
    const parsed = playbackSettingsSchema.safeParse(settings);
    if (!fromOperator(e) || typeof mediaId !== 'string' || !MEDIA_ID_PATTERN.test(mediaId) || !parsed.success)
      return {
        ok: false as const,
        message: 'Those settings could not be kept: open Sound and picture… again and set them once more.',
      };
    const sourceId = editedPlaying.sourceId(mediaId);
    if (!media.setPlayback(sourceId, parsed.data))
      return {
        ok: false as const,
        message: 'Only a video or a sound has these settings: choose one in Media.',
      };
    ownPlayback.set(sourceId, parsed.data);
    engine.refreshSound();
    engine.refreshVideoCaptions();
    engine.refreshVideoShapes();
    return { ok: true as const };
  });
  handle(IPC.audio.getOutput, () => audioOutput.status);
  // The sound player's red notice's Try again (x53, the owner's Q60-50 (2) A), in either mode: tried again now, its
  // count afresh; the notice goes as it is tried, and comes again if it is given up on again.
  handle(IPC.audio.tryAgain, (e) => {
    if (!fromOperator(e))
      return { ok: false as const, message: 'Only the operator window can try the sound again.' };
    if (!pageAlive(audioWindow))
      return { ok: false as const, message: 'Drashti’s sound player is not running.' };
    log.info('Trying the sound player again, as the operator asked');
    watchdog.retryNow(audioWindow.webContents, 'Try again');
    return { ok: true as const };
  });
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
  // A video's picture cannot be drawn on this computer (Session 60, x36: the owner's bug, his "Yes, A"): an output or
  // the operator window found it plays as sound only. What of it is up comes off (the background, with its sound; the
  // box, Q60-46) or waits paused (on the slide); the operator window says so, once a file; and it is converted by itself
  // once the show is idle. Only for a video that was up, so a page's word never takes off anything else; the other
  // windows that found the same showing find it off already, and say nothing more.
  // How much of a library file Main has sent so far (Q60-51): a page waiting on a video's first frame counts it as
  // progress.
  handle(IPC.media.served, (_e, mediaId) =>
    typeof mediaId === 'string' && MEDIA_ID_PATTERN.test(mediaId) ? (mediaServed.get(mediaId) ?? 0) : 0,
  );
  handle(IPC.media.noPicture, (e, mediaId, startedAt) => {
    const drawsShow = fromOperator(e) || manager.screenIdFor(e.sender.id) !== undefined;
    if (!drawsShow || typeof mediaId !== 'string' || !MEDIA_ID_PATTERN.test(mediaId)) return null;
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
    const file = media.kindAndName(mediaId);
    if (file?.kind !== 'video' || !engine.noPicture(mediaId, startedAt)) return null;
    log.warn(`A video's picture cannot be drawn here (sound only): ${mediaId}; taken off`);
    const converting = conversions.convertUndrawable(mediaId);
    sendToOperator(IPC.app.notice, { text: noPictureNotice(file.name, converting) });
    return null;
  });
  // A video whose element failed on a page that draws the show (Q60-31, the owner's own bug: the hall went black while
  // its sound played on, never taken off, nobody told): taken off as one whose picture cannot be drawn (its sound with
  // it; on the slide, paused; the box off), said by its name and where it failed, and logged with the error's kind,
  // after a short wait; unless a GPU process stopped then, whose videos load again by themselves.
  handle(IPC.media.cannotPlay, (e, mediaId, startedAt, code, words) => {
    const screenId = manager.screenIdFor(e.sender.id);
    const where: CannotPlayWhere | null =
      screenId !== undefined
        ? { screen: screenRepo.screens().find((s) => s.id === screenId)?.name ?? screenId }
        : fromOperator(e)
          ? 'live'
          : streaming.isProgram(e.sender)
            ? 'stream'
            : null;
    if (where === null || typeof mediaId !== 'string' || !MEDIA_ID_PATTERN.test(mediaId)) return null;
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
    if (typeof code !== 'number' || typeof words !== 'string') return null;
    const file = media.kindAndName(mediaId);
    if (file?.kind !== 'video') return null;
    // The error's kind and Chromium's words, for the log only (the notice names the file and where).
    const kind = errorKindWords(code);
    const detail = words === '' ? '' : `: ${cutText(words, 300, '…')}`;
    // No first frame within FIRST_FRAME_MS (Q60-44): heeded from Main's own screens, what the hall sees; LIVE's or the
    // stream's page alone only logs it (shared/no-picture.ts).
    if ((code === NO_FIRST_FRAME || code === NO_START_IN_TIME) && screenId === undefined) {
      log.info(
        `A video had ${kind} on ${whereWords([where])}: ${mediaId}; left up (only a screen’s takes it off)`,
      );
      return null;
    }
    // Every page that says so within the wait is named, the screens first (cannot-play.ts whereWords).
    cannotPlay.heard(
      `${mediaId}@${String(startedAt)}`,
      where,
      (named) => {
        const took = engine.cannotPlay(mediaId, startedAt);
        if (!took) return;
        const off = [
          took.background ? 'the background' : '',
          took.slide ? 'paused on the slide' : '',
          took.box ? 'the box' : '',
        ]
          .filter((w) => w !== '')
          .join(', ');
        log.warn(`A video could not play on ${named} (${kind}${detail}): ${mediaId}; taken off (${off})`);
        // Q60-51: a video that still loaded but could not start in time is said to be that, never damaged.
        sendToOperator(IPC.app.notice, {
          text:
            code === NO_START_IN_TIME
              ? cannotStartInTimeNotice(file.name, named, took)
              : cannotPlayNotice(file.name, named, took),
        });
      },
      (named) => {
        log.info(
          `A video could not play on ${named} (${kind}${detail}) as the GPU process stopped: ${mediaId}; it loads again`,
        );
      },
    );
    return null;
  });
  handle(IPC.audio.reportDevices, (e, devices, state) => {
    if (fromAudioPlayer(e)) audioOutput.report(devices, state);
    return null;
  });
  // ---- stage layouts (Session 55: one chosen for every stage screen, made further up) ------------------------
  stageLayoutsChanged = (layouts) => {
    sendToOperator(IPC.stageLayouts.changed, layouts);
    // A phone's Layout picker reads them again (Session 55).
    net.hint('setup');
  };
  const notLayoutOperator = {
    ok: false as const,
    message: 'Only the operator window can change stage layouts.',
  };
  handle(IPC.stageLayouts.list, () => stageLayouts.list());
  handle(IPC.stageLayouts.save, (e, id, layout) =>
    fromOperator(e) ? stageLayouts.save(id, layout) : notLayoutOperator,
  );
  handle(IPC.stageLayouts.remove, (e, id) => (fromOperator(e) ? stageLayouts.remove(id) : notLayoutOperator));
  handle(IPC.stageLayouts.rename, (e, id, name) =>
    fromOperator(e) ? stageLayouts.rename(id, name) : notLayoutOperator,
  );
  handle(IPC.stageLayouts.restore, (e, layout, at, chosen) =>
    fromOperator(e) ? stageLayouts.restore({ layout, at, chosen }) : notLayoutOperator,
  );
  handle(IPC.stageLayouts.choose, (e, id) => (fromOperator(e) ? stageLayouts.choose(id) : notLayoutOperator));

  // A test's first moments (Session 51, S2-4): the operator window's first ask for the screens answered this long
  // after it asks, so a test presses a key before the window knows which screens are open. Never packaged.
  let screensLateMs = swMs('DRASHTI_TEST_SCREENS_LATE_MS');
  handle(IPC.screens.get, async () => {
    const late = screensLateMs;
    screensLateMs = null;
    if (late !== null)
      await new Promise((resolve) => {
        setTimeout(resolve, late);
      });
    return screens.snapshot();
  });
  // The screens' changes, as the window's requests and a phone's make them alike (Session 54: the phone as a full
  // Drashti, network/desktop-answers.ts). Only the window's own request ever says it agreed to cover the controls.
  const screenChanges = {
    createGroup: (name: unknown) => screens.createGroup(name),
    setGroupRole: (id: unknown, role: unknown) => {
      // Shows (Session 51, S3-3): another picture on the group's displays asks Keep these screens? too.
      const result = keepScreens.change(() => screens.setGroupRole(id, role));
      // A stage display in a browser shows the stage group's languages.
      net.hint('screens');
      return result;
    },
    renameGroup: (id: unknown, name: unknown) => screens.renameGroup(id, name),
    deleteGroup: (id: unknown) => {
      const result = screens.deleteGroup(id);
      streaming.contextChanged();
      // A stage display in a browser follows the first stage group: it may be another now.
      net.hint('screens');
      return result;
    },
    // Use this display and On (Session 50): a change that puts an output on a display asks Keep these screens?; so
    // does a key and fill pair's Sends (Session 51, S3-3: the key is another picture), through updateScreen.
    assignDisplay: (groupId: unknown, displayId: unknown, options?: unknown) =>
      keepScreens.change(() => screens.assignDisplay(groupId, displayId, options)),
    updateScreen: (id: unknown, patch: unknown, options?: unknown) =>
      keepScreens.change(() => screens.updateScreen(id, patch, options)),
    // A display's job in one click (Session 55): asked only when it puts an output on the controls' display.
    setJob: (displayId: unknown, job: unknown, options?: unknown) => {
      const result = keepScreens.change(() => screens.setDisplayJob(displayId, job, options));
      streaming.contextChanged();
      net.hint('screens');
      return result;
    },
    removeScreen: (id: unknown) => screens.removeScreen(id),
    identify: () => {
      for (const [screenId, win] of outputWindows) {
        const s = screenRepo.screen(screenId);
        if (s) {
          sendToPage(win, IPC.output.identify, {
            name: s.name,
            groupName: screenRepo.groupName(s.groupId) ?? '',
          });
        }
      }
    },
  };
  handle(IPC.screens.createGroup, (e, name) =>
    fromOperator(e) ? screenChanges.createGroup(name) : notAllowed,
  );
  handle(IPC.screens.setGroupRole, (e, id, role) =>
    fromOperator(e) ? screenChanges.setGroupRole(id, role) : notAllowed,
  );
  handle(IPC.screens.setGroupLanguages, (e, id, languages) => {
    if (!fromOperator(e)) return notAllowed;
    const result = screens.setGroupLanguages(id, languages);
    // The stream group's languages are the stream's lower third's and slides'; a stage display's too.
    streaming.contextChanged();
    net.hint('screens');
    return result;
  });
  handle(IPC.screens.renameGroup, (e, id, name) =>
    fromOperator(e) ? screenChanges.renameGroup(id, name) : notAllowed,
  );
  handle(IPC.screens.deleteGroup, (e, id) => (fromOperator(e) ? screenChanges.deleteGroup(id) : notAllowed));
  handle(IPC.screens.assignDisplay, (e, groupId, displayId, options) =>
    fromOperator(e) ? screenChanges.assignDisplay(groupId, displayId, options) : notAllowed,
  );
  handle(IPC.screens.updateScreen, (e, id, patch, options) =>
    fromOperator(e) ? screenChanges.updateScreen(id, patch, options) : notAllowed,
  );
  handle(IPC.screens.setJob, (e, displayId, job, options) =>
    fromOperator(e) ? screenChanges.setJob(displayId, job, options) : notAllowed,
  );
  // A screen's geometry (x27): One wide picture and Separate pictures, and the grid while it is adjusted; the operator
  // window's only (a phone never adjusts a picture).
  handle(IPC.screens.widePicture, (e, groupId, overlap) =>
    fromOperator(e) ? screens.makeWidePicture(groupId, overlap) : notAllowed,
  );
  handle(IPC.screens.separatePictures, (e, groupId) =>
    fromOperator(e) ? screens.separatePictures(groupId) : notAllowed,
  );
  handle(IPC.screens.adjusting, (e, screenId, on) =>
    fromOperator(e) ? screens.setAdjusting(screenId, on) : notAllowed,
  );
  // What the screens did by themselves (Session 55), for a window that opened after it was said, until it is closed.
  handle(IPC.screens.lastSaid, (e) => (fromOperator(e) ? lastSaid : null));
  // The Stage preview (alpha.22): opened, or brought forward, from the Stage screen panel.
  handle(IPC.screens.openStagePreview, (e) => {
    if (fromOperator(e)) openStagePreview();
    return null;
  });
  handle(IPC.screens.saidClosed, (e, id) => {
    if (fromOperator(e) && lastSaid?.id === id) lastSaid = null;
    return null;
  });
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
  handle(IPC.screens.removeScreen, (e, id) =>
    fromOperator(e) ? screenChanges.removeScreen(id) : notAllowed,
  );
  // Audience and Stage (Session 50): anyone's in Pro Mode, in Simple Mode only on.
  handle(IPC.screenSwitches.get, () => screenSwitches.get());
  handle(IPC.screenSwitches.turn, (e, which, on) =>
    fromOperator(e)
      ? screenSwitches.turn(which, on)
      : { ok: false as const, message: 'Only the operator window can turn the screens off or on.' },
  );
  // The window's question before one goes off (Session 51): shown too on an output over the controls.
  handle(IPC.screenSwitches.asking, (e, which) => ({
    covered: fromOperator(e) ? switchQuestion.asking(which) : false,
  }));
  // Its answer on that output, were the output ever to have the keyboard (none does: an output over the controls is
  // full screen and never takes it, and windowed outputs never cover the controls): the window acts on it.
  handle(IPC.output.switchAnswer, (e, yes) => {
    const screenId = manager.screenIdFor(e.sender.id);
    if (screenId !== undefined) switchQuestion.answer(screenId, yes);
    return null;
  });
  screenSwitches.onChanged((switches) => {
    // Stage off (Session 55): every stage screen shows exactly the audience picture, from the engine's state.
    engine.setStage({ off: !switches.stage });
    // Kept for the next start (alpha.22), written as the mode is: never on the main thread under an import's lock
    // (a22-review-stage S2).
    keepStage({ set: laterSetting }, switches.stage);
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
    if (fromOperator(e)) screenChanges.identify();
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
  // A profile's own key typed or removed by hand: it no longer streams to its YouTube broadcast (x31).
  const ownKey = (place: unknown) => place === undefined || place === null || place === '';
  handle(IPC.stream.setKey, (e, id, key, place) => {
    if (!fromOperator(e)) return notOperator;
    const kept = streaming.setKey(id, key, place);
    if (kept.ok && ownKey(place) && typeof id === 'string') youtube.keyChangedByHand(id);
    return kept;
  });
  handle(IPC.stream.removeKey, (e, id, place) => {
    if (!fromOperator(e)) return notOperator;
    const removed = streaming.removeKey(id, place);
    if (removed.ok && ownKey(place) && typeof id === 'string') youtube.keyChangedByHand(id);
    return removed;
  });
  handle(IPC.stream.goLive, (e, confirm) =>
    fromOperator(e) && confirmedSchema.safeParse(confirm).success
      ? streaming.goLive()
      : { ok: false as const, message: 'Going live needs the operator to confirm it.' },
  );
  handle(IPC.stream.end, (e, confirm) => {
    if (!fromOperator(e) || !confirmedSchema.safeParse(confirm).success)
      return { ok: false as const, message: 'Ending the stream needs the operator to confirm it.' };
    const profileId = streaming.profilesView().activeId;
    const ended = streaming.end();
    // Its profile's YouTube broadcast ends there too (x31): in the background, after the encoder was told to stop.
    if (ended.ok && profileId !== null) youtube.streamEnded(profileId);
    return ended;
  });
  handle(IPC.stream.startRecording, (e) => (fromOperator(e) ? streaming.startRecording() : notOperator));
  handle(IPC.stream.startSoundRecording, (e) =>
    fromOperator(e) ? streaming.startSoundRecording() : notOperator,
  );
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
  handle(IPC.stream.pageContext, (e) =>
    streaming.isProgram(e.sender) || streaming.isStreamSound(e.sender) ? streaming.context() : null,
  );
  handle(IPC.stream.pageInputs, (e, inputs) => {
    streaming.reportInputs(e.sender, inputs);
    return null;
  });
  handle(IPC.stream.pageFrames, (e, grid: unknown) => {
    const told = grid as Partial<FrameGrid> | null;
    if (
      streaming.isProgram(e.sender) &&
      typeof told?.at === 'number' &&
      Number.isFinite(told.at) &&
      typeof told.periodMs === 'number' &&
      told.periodMs >= 10 &&
      told.periodMs <= 100
    )
      streamFrames = { at: told.at, periodMs: told.periodMs, told: Date.now() };
    return null;
  });

  // ---- scheduling on YouTube (x31): the operator window, Pro Mode (Simple Mode refuses all but its status) -------
  const notYouTube = {
    ok: false as const,
    message: 'Only the operator window, in Pro Mode, can schedule streams on YouTube.',
  };
  const youtubeAsks = (e: IpcMainInvokeEvent) => fromOperator(e) && mode === 'pro';
  handle(IPC.youtube.status, () => youtube.status());
  handle(IPC.youtube.setClient, (e, clientId, clientSecret) =>
    youtubeAsks(e) ? youtube.setClient(clientId, clientSecret) : notYouTube,
  );
  handle(IPC.youtube.removeClient, (e) => (youtubeAsks(e) ? youtube.removeClient() : notYouTube));
  handle(IPC.youtube.signIn, (e) => (youtubeAsks(e) ? youtube.signIn() : notYouTube));
  handle(IPC.youtube.cancelSignIn, (e) => (youtubeAsks(e) ? youtube.cancelSignIn() : notYouTube));
  handle(IPC.youtube.signOut, (e) => (youtubeAsks(e) ? youtube.signOut() : notYouTube));
  handle(IPC.youtube.upcoming, (e) => (youtubeAsks(e) ? youtube.upcoming() : notYouTube));
  handle(IPC.youtube.schedule, (e, input) => (youtubeAsks(e) ? youtube.schedule(input) : notYouTube));
  handle(IPC.youtube.useBroadcast, (e, profileId, broadcastId) =>
    youtubeAsks(e) ? youtube.useBroadcast(profileId, broadcastId) : notYouTube,
  );
  handle(IPC.youtube.endBroadcast, (e, profileId) =>
    youtubeAsks(e) ? youtube.endBroadcast(profileId) : notYouTube,
  );

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
  // Locked in Simple Mode (simple-mode.ts) unless Picture in Picture is chosen for it (alpha.22); moving the box up
  // remembers its place by itself (below).
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
  handle(IPC.stream.videoOut, () => videoOut.status());
  handle(IPC.stream.setVideoOut, (e, raw) =>
    fromOperator(e) && mode === 'pro'
      ? videoOut.set(raw)
      : { ok: false as const, message: 'Only the operator window, in Pro Mode, can change video out.' },
  );
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
  // Naming them: the operator window, Pro Mode (Simple Mode locks these channels).
  const notOperatorInputs = {
    ok: false as const,
    message: 'Only the operator window can change the video inputs.',
  };
  // The list: the operator window's Media, and every screen's page, which opens only an input listed here.
  // The slide editor's window too (Session 55, Part 17a): a slide's background is a video input by its name.
  handle(IPC.videoInputs.list, (e) =>
    screenPage(e) || (slideEditor?.isPage(e.sender) ?? false) ? inputs.view() : { inputs: [] },
  );
  handle(IPC.videoInputs.add, (e, fields) => (fromOperator(e) ? inputs.add(fields) : notOperatorInputs));
  handle(IPC.videoInputs.update, (e, id, fields) =>
    fromOperator(e) ? inputs.update(id, fields) : notOperatorInputs,
  );
  handle(IPC.videoInputs.remove, (e, id) => (fromOperator(e) ? inputs.remove(id) : notOperatorInputs));
  // The chosen one (Session 55): the stage's video input box and LIVE's one press.
  handle(IPC.videoInputs.choose, (e, id) => (fromOperator(e) ? inputs.choose(id) : notOperatorInputs));
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
  // The cameras the operator window sees, by name (Session 54): a phone naming an input chooses among them.
  handle(IPC.videoInputs.cameras, (e, raw) => {
    const names = fromOperator(e) ? cameraNamesIn(raw) : null;
    if (names && JSON.stringify(names) !== JSON.stringify(seenCameras)) {
      seenCameras = names;
      net.hint('setup');
    }
    return null;
  });

  // ---- the setup wizard ----------------------------------------------------------
  // Tests start with it closed, unless a test is about it; the self-tests never open it (a dialog
  // would take the show's keys).
  const wizardOff = sw('DRASHTI_TEST_NO_WIZARD') === '1' || sw('DRASHTI_SELFTEST') !== undefined;
  // The first start's welcome (Session 26g): once per library, before anything was set up; never in Simple Mode or on
  // a node. The opening (Session 55) gives way to it, and to Simple Mode's first steps.
  const welcomeNow = () =>
    mode === 'pro' &&
    !wizardOff &&
    settings.get('welcome') === undefined &&
    settings.get('setupWizard') === undefined;
  const simpleStepsNow = () =>
    mode === 'simple' && !wizardOff && settings.get('simpleFirstRun') === undefined;
  handle(IPC.setup.state, () => ({
    // The wizard by itself on a first start, in Pro Mode (anyone's since Session 54, E5: roles are gone).
    firstRun: mode === 'pro' && !wizardOff && settings.get('setupWizard') === undefined,
    welcome: welcomeNow(),
    operatorDisplayId: operatorDisplayId(),
    // Session 44: the display the controls are on, windowed outputs or not (Session 55: never taken by itself).
    controlsDisplayId: controlsDisplay(),
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
  handle(IPC.app.simpleFirstRun, (e) => fromOperator(e) && simpleStepsNow());
  handle(IPC.app.simpleFirstRunSeen, (e) => {
    if (fromOperator(e) && settings.get('simpleFirstRun') === undefined) {
      settings.set('simpleFirstRun', new Date().toISOString());
      log.info('Simple Mode: its first steps were seen');
    }
    return null;
  });
  // ---- the opening (Session 55, the owner's brief of 3 Nov 2026; alpha.16, his words of 11 Nov: shared/opening.ts) ---
  // Two seconds as Drashti starts, over the operator window only, decided once (opening/opening-start.ts); its photo
  // and the pack's sound kept with the library and changed in File › Opening… (Pro Mode). Never their names in the log.
  const opening = new OpeningService({
    settings,
    later: laterSetting,
    boot: {
      selfTest: selfTestRun,
      // A test sees it only when it asks (DRASHTI_TEST_OPENING=1); a packaged Drashti honours no test switch.
      testNotAsking: anyTestSwitch() && sw('DRASHTI_TEST_OPENING') !== '1',
      cleanQuit: startup.cleanQuit,
      // An unexpected stop longer ago starts afresh, and so the opening plays (the owner's answer of 4 Nov 2026).
      recentStop: startup.recentStop,
      restored: restored.restored,
      version: appVersion(),
    },
    picture: (mediaId) => {
      const file = media.file(mediaId);
      const known = media.kindAndName(mediaId);
      return known?.kind === 'image' && file && !file.missing && !file.deleted && file.sha256
        ? { sha256: file.sha256, name: known.name }
        : null;
    },
    hasCopy: (sha256) => existsSync(join(mediaDir, openingCopyPath(sha256))),
    // With nothing chosen, Drashti's default photo; its file missing, the lamp, as before (and the log says so).
    defaultPhoto: () => openingPhotoThere(openingPhoto),
    mediaDir,
    welcome: () => welcomeNow() || simpleStepsNow(),
    importPhotos: async (paths) => {
      const done = await imports.start(paths, {});
      if (!done.ok) return { ok: false, message: done.message };
      const items = importRepo.report(done.run.id)?.items ?? [];
      const ids: string[] = [];
      for (const [i, path] of paths.entries()) {
        const item = items.find((it) => it.sourcePath === path);
        const id = item?.target?.kind === 'media' ? item.target.id : null;
        if (id === null)
          return {
            ok: false,
            message: `Photo ${String(i + 1)} of the opening pack could not be brought into Media${
              item?.message ? `: ${item.message}` : ''
            }. Nothing was changed.`,
          };
        ids.push(id);
      }
      libraryChanged(true);
      return { ok: true, ids };
    },
    log: (line) => {
      log.info(line);
    },
  });
  openingSoundFile = (sha256) => opening.soundFile(sha256);
  /** When the operator window was made; whether its page was loaded again (or its process ended) since. */
  let openingWindowAt = 0;
  let openingPageAgain = false;
  /** When it started playing, while it plays. */
  let openingSince: number | null = null;
  /** The hall's screens on this computer still getting ready: one without its first frame said. */
  const screensWarming = () => [...outputWindows.keys()].some((id) => !firstPaints.has(id));
  /** Waiting to tell the operator window that every screen has drawn. */
  let openingWaits = false;
  firstPainted = () => {
    if (!openingWaits || screensWarming()) return;
    openingWaits = false;
    sendToOperator(IPC.opening.screens, { at: Date.now() });
  };
  let openingLimit: NodeJS.Timeout | null = null;
  // Any key ends it, and the main process keeps that key from the page and the menu (Space never moves the show on).
  const openingKeys = new OpeningKeys(() => {
    sendToOperator(IPC.opening.key, { at: Date.now() });
  });
  const openingOver = () => {
    // The start has settled: the stream's page may now draw without a warm-up of its own (Session 60, X21).
    streamPageWarmUp.openingOver();
    openingWaits = false;
    openingKeys.stop();
    if (openingLimit) clearTimeout(openingLimit);
    openingLimit = null;
  };
  handle(IPC.opening.atStart, (e) => {
    if (!fromOperator(e)) return null;
    const plan = opening.atStart({ pageAgain: openingPageAgain, sinceWindow: Date.now() - openingWindowAt });
    if (!plan) {
      // No opening at this start: the stream's page may draw without a warm-up of its own (Session 60, X21).
      streamPageWarmUp.openingOver();
      return null;
    }
    // Until it ends, the stream's page warms itself up as before (Session 60, X21).
    streamPageWarmUp.openingPlays();
    openingSince = Date.now();
    openingKeys.start();
    // A page that never says it ended (it stopped, say) leaves the keys to the show soon after its two seconds.
    // Its longest hold (the window's, longer than the screens': OPENING_START_HOLD_MS), its photo's wait and its two
    // seconds, with room to spare (Session 58).
    openingLimit = setTimeout(openingOver, OPENING_MS + OPENING_START_HOLD_MS + 3000);
    // It never moves while the hall's screens are getting ready: told here once they all have drawn.
    openingWaits = screensWarming();
    return { ...plan, hold: openingWaits };
  });
  handle(IPC.opening.ended, (e, how, figures) => {
    if (!fromOperator(e) || openingSince === null) return null;
    openingOver();
    // With the window's figures for it (Session 58), read whole by the service.
    opening.ended(how === 'key' || how === 'click' ? how : 'itself', Date.now() - openingSince, figures);
    openingSince = null;
    return null;
  });
  handle(IPC.opening.view, () => opening.view());
  handle(IPC.opening.setOn, (e, on) =>
    fromOperator(e) && typeof on === 'boolean'
      ? opening.setOn(on)
      : { ok: false as const, message: 'Only the operator window can change the opening.' },
  );
  handle(IPC.opening.setChoice, (e, choice) =>
    fromOperator(e)
      ? opening.setChoice(choice)
      : { ok: false as const, message: 'Only the operator window can change the opening.' },
  );
  handle(IPC.opening.loadPack, async (e) => {
    if (!fromOperator(e) || !operatorWindow)
      return { ok: false as const, message: 'Only the operator window can load the opening pack.' };
    const picked = await dialog.showOpenDialog(operatorWindow, {
      title: 'Load the Opening Pack',
      message: 'Choose the opening pack’s folder: the one with the photos folder in it.',
      buttonLabel: 'Load',
      properties: ['openDirectory'],
    });
    const dir = picked.canceled ? null : (picked.filePaths[0] ?? null);
    return dir === null ? null : opening.loadPack(dir);
  });
  handle(IPC.opening.removeSound, (e) =>
    fromOperator(e)
      ? opening.removeSound()
      : { ok: false as const, message: 'Only the operator window can change the opening.' },
  );
  handle(IPC.opening.saveCopy, (e, mediaId, bytes) =>
    fromOperator(e) && typeof mediaId === 'string'
      ? opening.saveCopy(mediaId, bytes)
      : { ok: false as const, message: 'Only the operator window can keep a photo’s copy.' },
  );
  // ---- Ready? (Session 55, Part 8, H): read only when pressed, never at start and never the keychain; the files on
  // the disk and the notifications' state are read asynchronously, so nothing here holds up the show ----------------
  const readyDeps: ReadyDeps = {
    platform: process.platform,
    home: app.getPath('home'),
    now: Date.now,
    screens: () => {
      const here = controlsDisplay();
      const snapshot = screens.snapshot();
      const known = new Map(
        snapshot.groups.flatMap((g) =>
          g.screens.map((sc) => [sc.id, { name: sc.name, role: g.role, node: sc.nodeId !== null }] as const),
        ),
      );
      const now = Date.now();
      const outputs = snapshot.status.flatMap((st): ReadyOutput[] => {
        const sc = known.get(st.screenId);
        if (!sc) return [];
        // Open for a while and not heard from: its page is not drawing (the heartbeat restarts it by itself too).
        const seen = sc.node || st.state !== 'showing' ? null : heartbeat.lastSeen(st.screenId);
        const quiet =
          seen !== null &&
          now - seen.since > OPEN_GRACE_MS &&
          (seen.reportAt === null || now - seen.reportAt > REPORT_STALE_MS);
        return [{ name: sc.name, role: sc.role, state: quiet ? 'not-drawing' : st.state, node: sc.node }];
      });
      return {
        others: listDisplays().filter((d) => d.id !== here).length,
        mirrored: displayIds.mirroredOnto().length > 0,
        switches: screenSwitches.get(),
        outputs,
      };
    },
    sound: () => {
      const st = audioOutput.status;
      return {
        state: st.state,
        checked: st.checked,
        chosen: st.chosen?.label ?? null,
        // Down and given up on (x53) is not running: Ready? says so.
        playerRunning: pageAlive(audioWindow) && !audioWindow.webContents.isCrashed(),
      };
    },
    videoInput: () => {
      const chosen = inputs.chosen();
      return {
        chosen: chosen ? { name: chosen.name, device: chosen.device } : null,
        access: inputs.access(),
        seen: seenCameras,
      };
    },
    access: () => {
      const view = behind?.service.view();
      return {
        phase: view?.phase ?? accessState().phase,
        stopsInMs: view?.stopsInMs ?? null,
        endsInMs: view?.endsInMs ?? null,
      };
    },
    playlist: (id) => {
      const found = playlists.list().find((p) => p.id === id);
      return found ? { name: found.name, rows: playlists.itemsOf(id) } : null;
    },
    mediaFile: (mediaId) => {
      const found = media.kindAndFile(mediaId);
      if (!found || found.path === '') return null;
      return isAbsolute(found.path) ? found.path : join(mediaDir, found.path);
    },
    exists: (path) =>
      fsPromises.access(path).then(
        () => true,
        () => false,
      ),
    onBattery: () => powerMonitor.isOnBatteryPower(),
    keptAwake: () => sleepGuard.held,
    readFile: (path) => fsPromises.readFile(path, 'utf8'),
    powershell: (script) => runPowerShell(script, {}, 15_000),
  };
  handle(IPC.ready.check, async (e, openPlaylistId) => {
    if (!fromOperator(e)) return null;
    const open = typeof openPlaylistId === 'string' && openPlaylistId.length <= 200 ? openPlaylistId : null;
    const report = await readyReport(readyDeps, open);
    log.info(
      `Ready?: ${report.lines.map((l) => `${l.id} ${l.ok ? 'green' : l.unknown === true ? 'amber (can’t tell)' : 'amber'}`).join(', ')}`,
    );
    return report;
  });
  // ---- The quick bar (Session 55, Part 8, F): up to 8 pinned items, kept in the library's settings ------------------
  // A pin that can't be read is left out as it is read; a change is the whole bar, checked whole (at most 8, each once).
  // Simple Mode refuses changing it (simple-mode.ts), and its window shows none.
  let quickPins = readQuickBar(settings.get('quickBar'));
  /** The whole bar, checked already, from the window or a phone (Session 55, Part 9): kept, and everyone told. */
  const setQuickPins = (pins: QuickPin[]) => {
    quickPins = pins;
    laterSetting('quickBar', quickPins);
    sendToOperator(IPC.quickBar.changed, quickPins);
    net.hint('quickBar');
    log.info(`Quick bar: ${String(quickPins.length)} pinned`);
    return { ok: true as const, pins: quickPins };
  };
  quickBarNow = { view: () => quickPins, set: setQuickPins };
  handle(IPC.quickBar.view, () => quickPins);
  handle(IPC.quickBar.set, (e, pins) => {
    if (!fromOperator(e))
      return { ok: false as const, message: 'Only the operator window can change the quick bar.' };
    const parsed = quickPinsSchema.safeParse(pins);
    if (!parsed.success)
      return {
        ok: false as const,
        message: `The quick bar holds at most ${String(QUICK_BAR_MAX)} things, each once.`,
      };
    return setQuickPins(parsed.data);
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
    const { outputs, sound } = plan.data;
    // The screens first: covering the operator's display asks before anything changes.
    if (outputs) {
      // Keep these screens? (Session 50): Go back puts back the screens only; the sound stays as chosen.
      const applied = keepScreens.change(() => screens.applySetup(outputs, options));
      if (!applied.ok) return applied;
      net.hint('screens');
    }
    if (sound !== 'skip') audioOutput.choose(sound);
    settings.set('setupWizard', new Date().toISOString());
    // No test slide (Session 55): each screen shows what is up, or nothing (black) until something is put up.
    log.info(
      `Setup finished: ${outputs ? `${outputs.length} display(s) set` : 'screens kept'}; sound ${sound === 'skip' ? 'kept' : 'chosen'}`,
    );
    const snapshot = screens.snapshot();
    return { ok: true, snapshot, showing: snapshot.status.filter((st) => st.state === 'showing').length };
  });

  handle(IPC.output.getContext, (event) => {
    // The Stage preview (alpha.22): a stage screen's page, never a screen.
    if (stagePreview && !stagePreview.isDestroyed() && event.sender.id === stagePreview.webContents.id)
      return stagePreviewContext();
    const screenId = manager.screenIdFor(event.sender.id);
    // Keep these screens? on an output over the controls that opened, or loaded again, as a change waits: sent
    // before the answer, so after the page listens for it (output-store.ts listens first).
    const question = screenId ? keepQuestionFor(screenId) : null;
    if (question && screenId) sendToPage(outputWindows.get(screenId), IPC.output.keepQuestion, question);
    // Audience and Stage's question too (Session 51), the same way.
    if (screenId) switchQuestion.loaded(screenId);
    return screenId ? contextFor(screenId) : null;
  });

  // ---- windows --------------------------------------------------------------
  const showingCount = () => manager.status().filter((st) => st.state === 'showing').length;
  /** Ask before anything that would black out the screens or end the stream. Returns true when it is fine to quit. */
  const confirmQuit = (): boolean => {
    // Stopped (Session 54): the screens are black and the stream has ended; Quit is the one thing that works.
    if (accessState().phase === 'stopped') return true;
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
  // The opening (Session 55): timed from the window's making; a page loaded again (the watchdog's reload, Reload
  // Operator Window) or gone never plays it; and while it plays, the keys are its own (before the page and the menu).
  openingWindowAt = Date.now();
  let operatorPages = 0;
  operatorWindow.webContents.on('did-navigate', () => {
    operatorPages += 1;
    if (operatorPages > 1) {
      openingPageAgain = true;
      openingKeys.reset();
    }
  });
  operatorWindow.webContents.on('render-process-gone', () => {
    openingPageAgain = true;
    openingKeys.reset();
  });
  operatorWindow.webContents.on('before-input-event', (event, input) => {
    if (openingKeys.take(input)) event.preventDefault();
  });
  const openTrimCleanup = () => {
    if (operatorWindow?.isVisible() && !operatorWindow.webContents.isLoadingMainFrame()) trimCleanup.open();
  };
  if (sw('DRASHTI_SELFTEST') === undefined) {
    operatorWindow.once('show', openTrimCleanup);
    operatorWindow.webContents.once('did-finish-load', openTrimCleanup);
  }
  operatorWindow.once('show', () => {
    log.info(phaseLine('operator window shown'));
  });
  operatorWindow.webContents.once('did-finish-load', () => {
    log.info(phaseLine('operator window loaded'));
  });
  watchdog.watch(operatorWindow.webContents, 'operator');
  // Audience and Stage's question on an output over the controls is the window's (Session 51): as the window loads
  // again, or its page stops, the question goes from the outputs too, never left there.
  operatorWindow.webContents.on('did-start-loading', () => {
    switchQuestion.asking(null);
    // A picture adjusted from the window that is loading again (x27): its grid goes from the screens.
    screens.stopAdjusting();
    // News waits for its page to open (x53: tellOperator).
    operatorAsked = false;
  });
  operatorWindow.webContents.on('did-start-navigation', (navigation) => {
    if (loadsOperatorPageAgain(navigation, { devServerUrl: devServerUrl(), rendererDir: rendererDir() }))
      importNotices.pause();
  });
  operatorWindow.webContents.on('render-process-gone', () => {
    importNotices.pause();
    switchQuestion.asking(null);
    screens.stopAdjusting();
    operatorAsked = false;
  });
  // Whether this computer plays HEVC video (Session 51), unless a test gave the answer: asked once the operator window
  // has loaded, and again at its next load while it could not be told. Never of the operator window itself (question
  // 36): Chromium holds the page that asks until the GPU process has said which video decoders it has (about 15 s on
  // CI's Mac late in a run), so a page of its own asks (convert/hevc-page.ts), made before the audio player. The
  // imports waiting for the answer go on then, and the operator window is told (Media offers to convert HEVC only once
  // it knows this computer cannot play it).
  let hevcPage: HevcPage | null = null;
  const askHevc = () => {
    if (hevc.now !== null || hevcPage !== null || quitStarted) return;
    const page = askInOwnPage(playsHevcScript(hevcTest), hevcKindsScript(hevcTest));
    hevcPage = page;
    // HEVC's other kinds (Session 60, x36), known before the answer is told, so an import has both.
    void page.kinds.then((kinds) => {
      if (kinds === null || quitStarted) return;
      hevc.kinds = kinds;
      log.info(
        `The other kinds of HEVC on this computer: Main 10 ${kinds.main10 ? 'plays' : 'cannot play'}; 4:2:2, 4:4:4 and 12-bit ${kinds.rext ? 'play' : 'cannot play'}`,
      );
    });
    void page.answer.then((answer) => {
      hevcPage = null;
      // Closed as Drashti quits: nothing to tell.
      if (hevc.now !== null || quitStarted) return;
      hevc.tell(answer);
      if (answer === null) {
        log.warn('Whether this computer plays HEVC video could not be told');
        return;
      }
      sendToOperator(IPC.media.playsHevcChanged, answer);
      log.info(
        answer
          ? 'This computer plays HEVC video'
          : 'This computer cannot play HEVC video: imports convert it by itself',
      );
    });
  };
  if (hevc.now === null) operatorWindow.webContents.on('did-finish-load', askHevc);
  // The audio player once the operator window has loaded (or after 5 s whatever happens). Created
  // first, Chromium 152 can hand the operator window the audio player's list of sound outputs.
  let audioStarted = false;
  const startAudioPlayer = () => {
    if (audioStarted || quitStarted) return;
    audioStarted = true;
    audioWindow = createAudioWindow();
    watchdog.watch(audioWindow.webContents, SOUND_PLAYER);
  };
  operatorWindow.webContents.once('did-finish-load', startAudioPlayer);
  operatorWindow.webContents.once('did-finish-load', resumeStream);
  // Conversions waiting when Drashti last stopped start again by themselves (Session 51), now that the stream's own
  // start is known (just above, it may go on air or record again by itself): never while it is. A self-test's run
  // leaves them waiting for the next start.
  if (sw('DRASHTI_SELFTEST') === undefined)
    operatorWindow.webContents.once('did-finish-load', () => {
      conversions.resumeWaiting();
      // Trim cuts accepted before Drashti last closed (TR-5): from the same moment and as long after it as kept
      // conversions, then at the first quiet moment (nothing up, no stream on air or recording).
      setTimeout(() => {
        playlistTrims.resumeWhenQuiet();
        editedCopies.resume();
      }, AFTER_START_MS).unref();
    });
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
  let quitSavingSound = false;
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
    const soundSaved = streaming.quitting();
    studio.quitting();
    // The HEVC question's own page, if it is still asking (it can be held for seconds): it goes now.
    hevcPage?.close();
    slideEditor?.quitting();
    if (soundSaved) {
      event.preventDefault();
      if (!quitSavingSound) {
        quitSavingSound = true;
        // The WAV is waited for 5 s at most (Session 58, X2: sound-recording.ts's QUIT_FINISH_MS): a disk that does not
        // answer never holds the quit, and the next before-quit is not held again.
        void soundSaved
          .then(
            (how) => {
              if (how === 'late')
                log.warn(
                  'Quit: the sound recording’s disk did not answer in time, so its WAV was left as it was: it plays up to the last whole second its header says, and what had not reached the disk is lost',
                );
            },
            () => {
              log.warn('The sound recording could not be finished before quitting.');
            },
          )
          .then(() => {
            quitSavingSound = false;
            app.quit();
          });
      }
      return;
    }
    const sourceQuit = documentQuit;
    if (
      sourceQuit &&
      !sourceQuit.request(
        event,
        () => app.quit(),
        (result) => {
          log.error(
            `Source preparation did not confirm shutdown (${result.reason}); the library remains open.`,
          );
        },
      )
    )
      return;
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
    // In the window's words and case (Session 51, S2-7): Turn off, never Turn Off.
    const box = switchOffBox(which);
    const parent = operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : undefined;
    const answer = parent ? await dialog.showMessageBox(parent, box) : await dialog.showMessageBox(box);
    return answer.response === 1;
  };

  /** File > Use This Computer as a Node…: asks, then restarts as a node (Pro Mode). */
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
  // ---- View › Access List… (Session 54, E4): the owner's computer only --------------------------------
  const accessList = startAccessList({
    workArea: () =>
      (operatorWindow && !operatorWindow.isDestroyed()
        ? electronScreen.getDisplayMatching(operatorWindow.getBounds())
        : electronScreen.getPrimaryDisplay()
      ).workArea,
    background: () => appearance.background(),
    track: (win) => {
      appearance.track(win);
    },
    ownerChanged: () => {
      rebuildMenu();
    },
    log: (line) => {
      log.info(line);
    },
    // The lock's own client and way in: one client for every call to the list.
    client: () => Promise.resolve(behind?.client ?? null),
    grant: () => behind?.service.grant() ?? null,
  });
  stops.add('Access List', () => {
    accessList.close();
  });
  // ---- Help › Report a Problem… (x49, the owner's Q60-38 and his "Yes, all A" to Q60-42) ----------------
  // In either mode, while let in: the window's picture taken as it opens (kept in memory only), the files made by the
  // report worker off Main's thread, and each report sent by itself through the access list, never while the stream
  // or a recording is on.
  const reportRetry = packaged() ? undefined : swMs('DRASHTI_TEST_REPORT_RETRY_MS');
  const reportShowFiles = !packaged() && sw('DRASHTI_TEST_REPORT_SHOW') === 'log';
  /**
   * Who and what makes a diagnostics file here (alpha.21, logs for 100+ installs (b)): this computer as the Access
   * List names it, its ids (given by their first letters only), this install, its role and mode, and the period.
   */
  const diagnosticsWho = (period: LogPeriod, now: Date): DiagnosticsWho => {
    const computer = behind?.client?.computer() ?? null;
    const view = accessState();
    return {
      computer: computer?.name ?? computerName(),
      computerId: computer?.id ?? null,
      installId: install.id,
      grantId: behind?.service.grant()?.grantId ?? null,
      role: isLetIn() ? { mode: view.mode === 'simple' ? 'simple' : 'pro', owner: view.owner } : null,
      made: simpleNow() ? 'simple' : 'pro',
      period: periodText(period, now.getTime()),
    };
  };
  const reports = new ReportService({
    dir: join(userDataDir, 'reports'),
    dbFile: libraryFile(),
    client: () => Promise.resolve(behind?.client ?? null),
    grant: () => behind?.service.grant() ?? null,
    letIn: isLetIn,
    gmail: () => accessState().gmail,
    owner: () => isLetIn() && accessState().owner,
    from: () => (simpleNow() ? 'simple' : 'pro'),
    onAir: () => streaming.inUse() || testOnAir,
    crashFiles: () => crashFiles(crashFilesDir),
    diagnostics: async (crashIncluded, period) => {
      const now = new Date();
      return {
        app: appInfo(),
        displays: listDisplays(),
        screens: screens.snapshot(),
        sound: audioOutput.status,
        watchdog: watchdogHistory,
        crashJournal: crashJournal.entries(),
        crashFiles: { files: crashFiles(crashFilesDir), included: crashIncluded, kept: crashFilesKept },
        logFiles: periodLogFiles(period, now.getTime()),
        now,
        graphics: await readGraphics(),
        who: diagnosticsWho(period, now),
      };
    },
    logDays,
    makeFiles: (job) => runReportJob(job),
    // A paired node's report (x49): read, checked and written by a report worker, off Main's thread.
    intake: (job) => runReportIntake(job),
    now: () => Date.now(),
    setTimer: (ms, run) => {
      const t = setTimeout(run, ms);
      return () => {
        clearTimeout(t);
      };
    },
    notice: (text) => {
      sendToOperator(IPC.app.notice, { text });
    },
    changed: () => {
      sendToOperator(IPC.report.changed, { at: Date.now() });
    },
    log: (line) => {
      log.info(line);
    },
    ...(reportRetry ? { retryMs: [reportRetry], startDelayMs: reportRetry } : {}),
  });
  reportsForNodes = reports;
  stops.add('reports', () => {
    reportsForNodes = null;
    reports.dispose();
  });
  // Let in again (an answer after none, or a start), what waits is tried at once.
  let reportsLetIn = isLetIn();
  onAccessChange(() => {
    if (isLetIn() && !reportsLetIn) reports.wake();
    reportsLetIn = isLetIn();
  });
  /** The operator window as it is now, before Report a Problem draws: its pixels and a small copy. */
  const captureOperator = async (): Promise<HeldPicture | null> => {
    const win = operatorWindow;
    if (!win || win.isDestroyed()) return null;
    try {
      const image = await win.webContents.capturePage();
      if (image.isEmpty()) return null;
      // A Retina window's picture is at twice its size in points: its pixels at the scale they were taken.
      for (const scaleFactor of [...image.getScaleFactors(), 1]) {
        const { width, height } = image.getSize(scaleFactor);
        const pixels = image.toBitmap({ scaleFactor });
        if (width > 0 && height > 0 && pixels.length === width * height * 4)
          return {
            picture: {
              width,
              height,
              pixels: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.length),
              order: capturedPixelOrder(),
            },
            thumb: `data:image/jpeg;base64,${image.resize({ width: 320, quality: 'good' }).toJPEG(70).toString('base64')}`,
          };
      }
      return null;
    } catch {
      return null;
    }
  };
  const notLetIn = { ok: false as const, message: 'Report a Problem works once this computer is let in.' };
  handle(IPC.report.open, async (e) =>
    fromOperator(e) && isLetIn() ? reports.opened(await captureOperator()) : notLetIn,
  );
  handle(IPC.report.close, (e) => {
    if (fromOperator(e)) reports.closed();
    return true;
  });
  handle(IPC.report.prepare, (e, raw) => {
    const draft = readReportDraft(raw);
    return fromOperator(e) && draft ? reports.prepare(draft) : Promise.resolve(notLetIn);
  });
  handle(IPC.report.discard, (e, id) => {
    if (fromOperator(e) && isReportId(id)) reports.discard(id);
    return true;
  });
  handle(IPC.report.send, (e, id) =>
    fromOperator(e) && isReportId(id) ? reports.send(id) : Promise.resolve(null),
  );
  handle(IPC.report.list, (e) => (fromOperator(e) ? reports.list() : []));
  handle(IPC.report.forget, (e, id) => fromOperator(e) && isReportId(id) && reports.forget(id));
  handle(IPC.report.copy, async (e, id) => {
    if (!fromOperator(e) || !isReportId(id))
      return { ok: false as const, cancelled: false as const, message: notLetIn.message };
    const options = {
      title: 'Save a Copy of the Report',
      defaultPath: app.getPath('desktop'),
      buttonLabel: 'Save Here',
      properties: ['openDirectory' as const, 'createDirectory' as const],
    };
    const parent = operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow : null;
    const picked = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    const into = picked.filePaths[0];
    if (picked.canceled || !into) return { ok: false as const, cancelled: true as const };
    try {
      const folder = reports.copy(id, into);
      return folder
        ? { ok: true as const, folder }
        : { ok: false as const, cancelled: false as const, message: 'That report is no longer kept here.' };
    } catch (error) {
      return { ok: false as const, cancelled: false as const, message: fileProblem(error, 'write') };
    }
  });
  handle(IPC.report.showFile, async (e, id, name) => {
    const file =
      fromOperator(e) && isReportId(id) && typeof name === 'string' && name.length <= 200
        ? reports.filePath(id, name)
        : null;
    if (!file) return false;
    // Tests: said in the log, never opened in another app.
    if (reportShowFiles) {
      log.info(`Report: would show ${basename(file)}`);
      return true;
    }
    return (await shell.openPath(file)) === '';
  });
  reports.start();
  captionsMenuChanged = () => {
    setImmediate(() => {
      rebuildMenu();
    });
  };
  rebuildMenu = () => {
    // Not let in (a self-test, or stopped, Session 54): Quit and the editing keys only.
    if (!isLetIn()) {
      installLockedMenu();
      return;
    }
    installMenu(menuActions());
  };
  // Help › Save Diagnostics › One Day lists the days the log keeps: built again when they change (a new day, one gone),
  // a turn later, never inside the log line that changed them.
  onLogDaysChanged(() => {
    setImmediate(() => {
      rebuildMenu();
    });
  });
  // ---- View > Show Books, Templates and Kirtan Details (Session 26a) -------------------------------
  // Hidden, not deleted: their code, data and the remote's library stay; the same item brings them back.
  const extrasShown = () => settings.get('showExtras') === true;
  const setExtras = (on: boolean) => {
    settings.set('showExtras', on);
    log.info(`View: Books, Templates and Kirtan Details ${on ? 'shown' : 'hidden'}`);
    sendToOperator(IPC.library.extrasChanged, { on });
    rebuildMenu();
  };
  handle(IPC.library.extras, () => extrasShown());
  // ---- View > Show Safe Areas (Sessions 31–36): the slide editor's guides, anyone's to turn on ---------
  const safeAreasShown = () => settings.get('showSafeAreas') === true;
  handle(IPC.app.safeAreas, () => safeAreasShown());
  // The LIVE picture's warm-up where Chromium draws without a graphics chip (Session 58, WU-1): none, as for the outputs
  // and the stream's page. Asked as the window opens, and told once Chromium has said, should it open before then.
  handle(IPC.app.noGpu, (e) =>
    fromOperator(e) && operatorWindow !== null
      ? warmUpFact(warmUps, operatorWindow, 'the LIVE picture').noGpu === true
      : false,
  );
  warmUps.follow(() =>
    operatorWindow && !operatorWindow.isDestroyed() && !operatorWindow.webContents.isDestroyed()
      ? [
          {
            id: operatorWindow.webContents.id,
            name: 'the LIVE picture',
            tell: () => {
              sendToOperator(IPC.app.noGpuChanged, { on: true });
            },
          },
        ]
      : [],
  );
  // ---- Single-letter keys (Session 37, WCAG 2.1.4): B, . and ? act unless they are turned off ----
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
  // Moving: On or Off (Session 60, the owner's safety rule), this computer's, as the appearance is.
  handle(IPC.appearance.setMoving, (e, on) => {
    if (!fromOperator(e) || typeof on !== 'boolean')
      return { ok: false as const, message: 'Only the operator window can turn moving on or off.' };
    appearance.setMoving(on);
    return { ok: true as const };
  });
  // Favourites (Session 60): an appearance starred or unstarred in the Appearance window.
  handle(IPC.appearance.setFavourite, (e, id, on) => {
    if (!fromOperator(e) || typeof id !== 'string' || typeof on !== 'boolean')
      return { ok: false as const, message: 'Only the operator window can star an appearance.' };
    return appearance.setFavourite(id, on)
      ? { ok: true as const }
      : { ok: false as const, message: 'That appearance is no longer here.' };
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
    // A phone's clears name the keys as the window's buttons do (Session 54, D5).
    network.hint('keys');
    return { ok: true as const, on };
  });
  handle(IPC.library.setExtras, (e, on) => {
    if (!fromOperator(e) || typeof on !== 'boolean')
      return { ok: false as const, message: 'Only the operator window can change what it shows.' };
    setExtras(on);
    return { ok: true as const, on };
  });
  // View › Audience and Stage chosen again within 0.7 s (Session 51): a held ⌘1 or ⌘2 repeating, where the Mac's
  // menu still answers them (under one of the system's own boxes), never an operator choosing twice. One for each.
  const menuSwitchChoice: Record<ScreenSwitch, () => boolean> = {
    audience: choiceGuard(REPEAT_CHOICE_MS),
    stage: choiceGuard(REPEAT_CHOICE_MS),
  };
  const menuActions = (): Parameters<typeof installMenu>[0] => ({
    mode,
    // Simple access (Session 55): no way back to Pro Mode in the menu.
    simpleOnly: modes.simpleOnly(),
    switchMode,
    setUpScreens: () => {
      if (mode === 'pro') sendToOperator(IPC.setup.open, { at: Date.now() });
    },
    zoomWindow: () => {
      if (mode === 'pro') zoom.open();
    },
    accessList:
      mode === 'pro' && accessList.offered()
        ? () => {
            accessList.open();
          }
        : null,
    backUpLibrary: () => {
      if (mode === 'pro') void backUp(backupUi);
    },
    restoreLibrary: () => {
      if (mode === 'pro') void restore(backupUi);
    },
    importFromLink: () => {
      if (mode === 'pro') sendToOperator(IPC.links.open, { at: Date.now() });
    },
    scheduledBackups: () => {
      if (mode === 'pro') sendToOperator(IPC.backups.open, { at: Date.now() });
    },
    eventsOut: () => {
      if (mode === 'pro') sendToOperator(IPC.events.open, { at: Date.now() });
    },
    dropFolder: () => {
      if (mode === 'pro') sendToOperator(IPC.drop.open, { at: Date.now() });
    },
    opening: () => {
      if (mode === 'pro') sendToOperator(IPC.opening.open, { at: Date.now() });
    },
    liveCaptions: () => {
      if (mode === 'pro') sendToOperator(IPC.captions.open, { at: Date.now() });
    },
    // File › Speaker's Language (alpha.22): the language live captions listen for, chosen as the speakers change.
    speakerLanguage: {
      language: captions.view().settings.language,
      choose: (language) => {
        if (mode === 'pro') captions.setSettings({ ...captions.view().settings, language });
        rebuildMenu();
      },
    },
    modelPacks: () => {
      if (mode === 'pro') sendToOperator(IPC.modelPacks.open, { at: Date.now() });
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
    // Help › Drashti Manual… (x37, Session 60), in either mode.
    manual: () => {
      sendToOperator(IPC.app.showManual, { at: Date.now() });
    },
    // Help › Report a Problem… (x49): the window asks for its picture and opens.
    reportProblem: () => {
      sendToOperator(IPC.app.showReport, { at: Date.now() });
    },
    // Edit › Simple Mode Features… (alpha.22): Pro Mode's, its window in the operator window.
    simpleFeatures: () => {
      if (mode === 'pro') sendToOperator(IPC.app.showSimpleFeatures, { at: Date.now() });
    },
    // The Tools menu (Session 60, x36): Pro Mode's, each item opening its window in the operator window.
    tools: (tool) => {
      if (mode === 'pro') sendToOperator(IPC.app.showTool, { tool, at: Date.now() });
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
            // The tick follows the setting, not the click.
            rebuildMenu();
            if (mode === 'pro') item.toggle();
          },
        }
      );
    })(),
    useAsNode: () => {
      if (mode === 'pro') useAsNode();
    },
    deckAnimations: {
      on: deckAnimations,
      toggle: () => {
        // The tick follows the setting, not the click.
        if (mode === 'pro') {
          deckAnimations = !deckAnimations;
          writeDeckAnimations(app.getPath('userData'), deckAnimations);
          log.info(`Decks with their animations on this computer: ${deckAnimations ? 'on' : 'off'}`);
          sendToOperator(IPC.app.notice, {
            text: deckAnimations
              ? 'A PowerPoint or Keynote deck now comes in with its animations on this computer, where PowerPoint or Keynote can make them.'
              : 'A PowerPoint or Keynote deck now comes in as pictures on this computer, with its videos as real videos.',
          });
        }
        rebuildMenu();
      },
    },
    extras: {
      shown: extrasShown(),
      toggle: () => {
        // The tick follows the setting, not the click.
        rebuildMenu();
        if (mode === 'pro') setExtras(!extrasShown());
      },
    },
    safeAreas: {
      shown: safeAreasShown(),
      toggle: () => {
        const on = !safeAreasShown();
        settings.set('showSafeAreas', on);
        sendToOperator(IPC.app.safeAreasChanged, { on });
        // The slide editor draws them (Session 55, Part 17a: in its own window).
        slideEditor?.send(IPC.app.safeAreasChanged, { on });
        rebuildMenu();
      },
    },
    // View › Appearance (Sessions 39–40): Pro Mode only, anyone's; the choice is this computer's.
    appearance: {
      choices: [
        { id: FOLLOW, label: 'Follow the Computer' },
        ...appearance.list().map((a) => ({ id: a.id, label: a.name, family: familyOf(a) })),
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
    // click, until it changes (a question answered Cancel leaves it as it was). A choice within 0.7 s of the last
    // is a held key repeating (Session 51), let go by: a held ⌘1 changes the screens once, never off, on, off.
    screenSwitches: {
      on: screenSwitches.get(),
      toggle: (which) => {
        rebuildMenu();
        if (mode === 'pro' && menuSwitchChoice[which]()) void screenSwitches.toggle(which, askSwitchOff);
      },
    },
    reloadOperator: () => {
      operatorWindow?.webContents.reload();
    },
    undo: {
      accelerator: acceleratorFor('undo'),
      run: () => {
        // The slide editor's window, when it has the keyboard (Session 55, Part 17a): its typing, or its last change.
        const editing = slideEditor?.focused();
        if (editing) {
          editing.webContents.undo();
          slideEditor?.send(IPC.app.undo, { at: Date.now() });
          return;
        }
        // Undo typing in a text field (as the standard Edit menu would); the page ignores the
        // message then, and otherwise undoes the last removal.
        operatorWindow?.webContents.undo();
        sendToOperator(IPC.app.undo, { at: Date.now() });
      },
    },
    redo: {
      run: () => {
        const editing = slideEditor?.focused();
        if (editing) {
          editing.webContents.redo();
          slideEditor?.send(IPC.app.redo, { at: Date.now() });
          return;
        }
        // As Undo: redo typing in a text field.
        operatorWindow?.webContents.redo();
        sendToOperator(IPC.app.redo, { at: Date.now() });
      },
    },
    uncoverControls: { accelerator: uncoverAccelerator, run: uncover },
    logDays,
    automaticErrorReports:
      isLetIn() && accessState().owner
        ? () => {
            if (operatorWindow && !operatorWindow.isDestroyed())
              void manageErrorReports(
                automaticReports,
                operatorWindow,
                () => isLetIn() && accessState().owner,
              );
          }
        : null,
    // Help › Save Diagnostics (alpha.21, logs (c)): the log of the period chosen; the file is made by a report worker,
    // off Main's thread (a period's log can be days long), and written here.
    saveDiagnostics: (period) => {
      void (async () => {
        try {
          const crash = await chooseCrashFiles();
          if (!crash) return;
          const now = new Date();
          const made = await runDiagnosticsText({
            kind: 'diagnostics-text',
            main: {
              input: {
                app: appInfo(),
                displays: listDisplays(),
                screens: screens.snapshot(),
                sound: audioOutput.status,
                watchdog: watchdogHistory,
                crashJournal: crashJournal.entries(),
                crashFiles: crash,
                logFiles: periodLogFiles(period, now.getTime()),
                now,
                graphics: await readGraphics(),
                who: diagnosticsWho(period, now),
              },
              dbFile: libraryFile(),
            },
            node: null,
          });
          if (!made.ok) throw new Error(made.message);
          const file = writeDiagnosticsFile(app.getPath('desktop'), now, made.text, crash);
          log.info(
            `Diagnostics saved to the Desktop (the log of ${periodText(period, now.getTime())})${crash.included ? ', with the crash files' : ''}`,
          );
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
            await refreshDisplayCopies();
            await displayCopies.idle();
          },
        },
        operatorContents: () =>
          operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow.webContents : null,
        music,
        engine,
        setMovement: (movement) => {
          looks.moveAll(movement);
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
            packaged: packaged(),
            resourcesPath: process.resourcesPath,
            appPath: app.getAppPath(),
            platform: process.platform,
            arch: process.arch,
            override: sw('DRASHTI_FFMPEG'),
          }),
        cpu: () => app.getAppMetrics().reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0),
        // The library's write lock as Main sees it while measured (Session 58): a write then would have waited so long.
        lock: new LockWatch({ free: () => writeLockFree(libraryDb, LIBRARY_BUSY_TIMEOUT_MS) }),
        // Each page's warm-up marks (Session 58, WU-1): the LIVE picture's, the stream's page's and each output's.
        warmUps: async () => {
          const pages: [string, Electron.WebContents | null][] = [
            [
              'the LIVE picture',
              operatorWindow && !operatorWindow.isDestroyed() ? operatorWindow.webContents : null,
            ],
            ['the stream’s page', streaming.programContents() ?? null],
            ...[...outputWindows.entries()].map(([screenId, w]): [string, Electron.WebContents | null] => [
              outputNames.get(screenId) ?? 'an output',
              w.isDestroyed() ? null : w.webContents,
            ]),
          ];
          return Promise.all(
            pages
              .flatMap(([page, contents]) =>
                !contents || contents.isDestroyed() ? [] : [[page, contents] as const],
              )
              .map(async ([page, contents]): Promise<[string, [string, number][] | null]> => {
                try {
                  const marks = (await contents.executeJavaScript(
                    "performance.getEntriesByType('mark').filter((m) => m.name.startsWith('drashti-warm-up')).map((m) => [m.name, Math.round(m.startTime)])",
                    true,
                  )) as [string, number][];
                  return [page, marks];
                } catch {
                  return [page, null];
                }
              }),
          );
        },
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

  // ---- access by Gmail (Session 54): a stop stops everything; Main's nodes and phones hear it ----------------
  stops.add(
    'access effects',
    followAccess({
      stopShow: () => {
        // The captions rehearsal ends first, without starting live captions again (Codex x90's access-stop rule).
        captions.cancelPrototype();
        engine.stop();
      },
      stream: streaming,
      tellNodes: (letIn) => {
        nodes.tellAccess(letIn);
      },
      lockMenu: () => {
        rebuildMenu();
      },
      dropShortcuts: () => {
        globalShortcut.unregisterAll();
      },
      uncover: () => {
        const names = screens.uncoverOperator().turnedOff ?? [];
        log.info(
          `Access: the stop’s screen uncovered: turned off ${names.length > 0 ? names.join(', ') : 'nothing'}`,
        );
        if (operatorWindow && !operatorWindow.isDestroyed()) operatorWindow.show();
      },
      later: (ms, run) => {
        setTimeout(run, ms);
      },
      others: [
        { what: 'the window for Zoom', stop: () => zoom.close() },
        { what: 'the drop folder', stop: () => dropFolder.stop() },
        { what: 'downloads', stop: () => links.close() },
        { what: 'imports', stop: () => imports.stop() },
        {
          what: 'kirtan bundle exports',
          stop: () => {
            void bundleExporter.stop();
          },
        },
        { what: 'conversions', stop: () => conversions.close() },
      ],
      every: (ms, run) => {
        const t = setInterval(run, ms);
        return () => {
          clearInterval(t);
        };
      },
      log: (message, error) => {
        if (error === undefined) log.warn(message);
        else log.error(message, error);
      },
    }),
  );
  onAccessChange(() => {
    net.accessChanged();
    void osc.accessChanged();
  });
  // Each presentation put up, counted for the Access List: never which.
  engine.onChange(
    showCounter((kind) => {
      behind?.service.count(kind);
      automaticErrorRuntime?.event('show-started');
    }),
  );

  // Restore the saved screen assignments, and follow display changes: at once, then again once each display's own
  // identity has been read (Session 55), when a display plugged in is given its job.
  manager.reconcile();
  displaysRead();
  watchDisplays(() => {
    // A display change noticed as Drashti quits comes after the library has closed: nothing to do.
    if (db === null) return;
    manager.reconcile();
    displaysRead();
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
  /** The main thread's time working so far (ms), or null where the system does not say: never in the quit's way. */
  const mainThreadWork = (): number | null => {
    try {
      const { user, system } = process.threadCpuUsage();
      return (user + system) / 1000;
    } catch {
      return null;
    }
  };
  app.on('will-quit', () => {
    const started = performance.now();
    const workBefore = mainThreadWork();
    stops.run();
    const workAfter = mainThreadWork();
    const took = Math.round(performance.now() - started);
    // How much of that time Drashti's main thread was working (12 Nov 2026): the rest it waited, on the disk (the
    // library's last write), on another process, or on a busy computer. On Windows the thread's time moves in steps
    // of about 16 ms, so it is never said as more than the whole.
    const working =
      workBefore === null || workAfter === null
        ? 'its working time not known'
        : `${String(Math.min(took, Math.round(workAfter - workBefore)))} ms of it working`;
    log.info(`Quit: Drashti's own stops took ${String(took)} ms (${working})`);
    log.info(`Quit: how long each stop took, in ms: ${stopTimes(stops.times)}`);
  });
}
