import type { CaptionCorrection, CaptionReview } from './caption-coordinator';
import type { SaveVideoEdit, VideoEditResult, VideoEditSnapshot } from './video-edit';

import type {
  ClipExportRequest,
  ClipExportResult,
  ClipExportJob,
  CombineJob,
  CombineRequest,
  CombineResult,
  VideoProxyResult,
} from './video-copies';
import type { VideoAnalysisResult } from './video-analysis';
import type { PlaybackSettings } from './playback-settings';
import type { PlaylistPlayOptions } from './playlist-playback';
import type { M3uResult } from './m3u';
import type { ControllerArea, ControllerReply, ControllerRequest } from './controller-actions';
import type { VideoCaptionChoice, VideoCaptionResult } from './video-captions';
import type { YouTubeListResult, YouTubeResult, YouTubeScheduleInput, YouTubeStatus } from './youtube';
import type { KirtanBundleExportRequest, KirtanBundleExportResult } from './kirtan-bundles';
import type { PdfPageSource, InsertPdfPagesResult, LinkPdfPageResult } from './slide-edit';
import type { MakeSlideRequest, MakeSlideResult, SlideMade, SlidePlace } from './page-part';
import type { SlidePictureResult } from './slide-picture';
import type { ReadyReport } from './ready';
import type { ToolsMenuItem } from './setup-tools';
import type { SimpleFeature, SimpleFeatureResult } from './simple-features';
import type { PdfJob, PdfPage, PdfPageReceipt, PdfDone } from './editable-source';
import type { PdfCopyFinished, PdfCopyJob, PdfCopyResult, PdfPrintPage } from './pdf-copy';
import type { QuickBarResult, QuickPin } from './quick-bar';
import type { AppearanceView, InterfaceMotion, OwnAppearance } from './appearance/appearances';
import type {
  LowerThird,
  LowerThirdDone,
  LowerThirdInput,
  LowerThirdResult,
  LowerThirdsResult,
  StudioOpen,
} from './lower-thirds';
import type { StudioLivePicture } from './studio-live';
import type { WallpaperFiles, WallpaperResult, WallpapersView, WhenEnds } from './wallpapers';
import type { CalendarResult, CalendarView } from './calendar';
import type { GuideId, GuideRead } from './guides';
import type { ManualPrinted, ManualRead } from './manual';
import type { RunningOrderCopied } from './running-order';
import type { WordsPrinted } from './words-print';
import type {
  ReportCopied,
  ReportDraft,
  ReportOpened,
  ReportPrepared,
  ReportRow,
  ReportStateView,
} from './report';
import type {
  PassageInfo,
  PassageResult,
  ShastraHit,
  ShastraResult,
  ShastraTextInfo,
  ShastraTree,
} from './shastra';
import type { AccessView } from './access';
import type { ReadWordsChoice, ReadWordsProgress, ReadWordsResult } from './read-words';
import type { AppInfo, TaskProgress } from './app-info';
import type { AudioDevice, AudioOutputState, AudioOutputStatus } from './audio';
import type { CommandResult, EngineCommand } from './engine/commands';
import type { EngineMessage, EngineSnapshotMessage } from './engine/protocol';
import type {
  AutomaticImportNotice,
  ImportOptions,
  ImportProgress,
  ImportReport,
  ImportResult,
  ImportRunSummary,
} from './import';
import type {
  QrChoices,
  QrChoicesChange,
  QrChoicesResult,
  QrDownloadResult,
  QrPicked,
  QrSlideOptions,
} from './qr-picture';
import type {
  LibraryChange,
  NewFromWordsResult,
  PresentationDoc,
  PresentationSummary,
  RemoveResult,
  RevisionResult,
  SaveWordsResult,
  WordsResult,
} from './library';
import type {
  KirtanDetails,
  KirtanResult,
  MakeTranslitResult,
  ManualLines,
  TrackEdit,
  TracksResult,
} from './kirtans';
import type { TranslitStyle } from './translit';
import type { ModeResult, OperatorMode } from './mode';
import type { LinkDownloadOptions, LinkKind, LinkResult, LinkView, YouTubeChoice } from './links';
import type { UpdateResult, UpdateView } from './updates';
import type { MusicResult, MusicView } from './music';
import type { MediaRemovalResult, MediaUsage, PresentationUsage, RevealResult } from './media-removal';
import type { MarkersResult, MediaMarkers } from './markers';
import type { DisplayCopyBlob, PictureAssetKind, SharpenJobView } from './pictures';
import type { BackupSchedule, BackupsResult, PickFolderResult, ScheduledBackupsView } from './backups';
import type { EventAddressPatch, EventsOutResult, EventsOutView } from './events-out';
import type { DropFolderResult, DropFolderView } from './drop-folder';
import type {
  OpeningChoice,
  OpeningEnd,
  OpeningFigures,
  OpeningPlan,
  OpeningResult,
  OpeningView,
} from './opening';
import type {
  CaptionModelId,
  CaptionSettings,
  CaptionsStatus,
  CaptionTiming,
  LanguageModelLanguage,
} from './captions';
import type { ModelPacksStatus, PackImportResult, PackLicenceResult, PackRemoveResult } from './model-packs';
import type {
  TranslationDraftRequest,
  TranslationDraftResult,
  TranslationEngineStatus,
  TranslationLanguage,
} from './prepared-translations';
import type { CaptionWord, CaptionWordsResult, CaptionWordsView } from './caption-words';
import type { SpeechLanguage } from './speech';
import type { Lang, RenderSlide, Transition } from './model';
import type {
  CopiedElements,
  EditDoc,
  EditSlidesOpen,
  EditSlidesResult,
  EditSourceRequest,
  EditSourceUpdate,
  SaveSlidesResult,
  SlidesSaved,
} from './slide-edit';
import type { RecoveryNotice } from './recovery';
import type { SetupPlan, SetupResult, SetupState } from './setup';
import type { ConversionJob, ConvertResult } from './convert';
import type {
  DeviceChoice,
  ProgramContext,
  ProgramInputs,
  StreamLayout,
  StreamProfileInput,
  StreamProfiles,
  StreamProfilesResult,
  StreamResult,
  StreamStatus,
} from './stream';
import type { LiveWindowResult, LiveWindowStatus, WindowList } from './live-window';
import type { StreamLinkJoin, StreamLinkResult, StreamLinkStatus } from './live-link';
import type { VideoOutResult, VideoOutSettings, VideoOutStatus } from './video-out';
import type { ZoomProgram } from './zoom';
import type { AccessListAdd, AccessListResult, AccessListSaved, AccessListView } from './access-list';
import type { AccessLength, AccessMode } from './access-protocol';
import type {
  CameraAccess,
  VideoInputFields,
  VideoInputReport,
  VideoInputResult,
  VideoInputsView,
  VideoInputStatus,
} from './video-inputs';
import type { ScreenSwitch, ScreenSwitches, ScreenSwitchResult } from './screen-switches';
import type { PendingScreens } from './keep-screens';
import type { PipSettingsResult } from './pip';
import type { PipPlace } from './engine/state';
import type { SavePictureResult, SaveStillResult } from './media';
import type { MediaDetailsResult } from './media-details';
import type { ResumePoint } from './play-history';
import type { SnapshotResult } from './snapshot';
import type { PlayingRef } from './engine/playing';
import type { DeviceKind, NetworkResult, NetworkStatus } from './network';
import type { OscResult, OscSettings, OscStatus } from './osc';
import type { NodesResult, NodesStatus, NodeView, NodeViewResult, ScreenThumb } from './nodes';
import type { AnnouncementResult, AnnouncementsView } from './announcements';
import type {
  ItemOrder,
  MediaSummary,
  NewItem,
  PlaylistItemInfo,
  PlaylistNode,
  PlaylistResult,
  SmartFromDrop,
  SmartPlaylistView,
  TemplateRequest,
  TimerCue,
} from './playlists';
import type { RepeatSettings } from './repeat';
import type {
  KeyframeResult,
  RowTrimRequest,
  RowTrimResult,
  RowTrimView,
  SaveJob,
  SaveRequest,
  SaveResult,
  TrimStatuses,
} from './trim';
import type { PictureLook } from './picture-look';
import type { ExportFileResult } from './export-file';
import type { MessageResult, MessageTemplate, MessageTemplateFields } from './messages';
import type { StageChoiceResult, StageLayout, StageLayoutResult } from './stage-layouts';
import type { MidiAsk, MidiResult, MidiSeen, MidiSettings } from './midi';
import type { PointAt, PointedClip } from './point-ahead';
import type { SearchResult } from './search';
import type { RenderErrorReport } from './render-errors';
import type { StartMarks } from './start-marks';
import type { FrameGrid } from './video-cue';
import type {
  EvenResult,
  FileSoundView,
  SoundKind,
  SoundLevelsResult,
  SoundView,
  SoundViewResult,
  TrimEdgesResult,
} from './sound';
import type { TimerFields, TimerResult } from './timers';
import type {
  CoverOptions,
  DisplayJob,
  OutputContext,
  OutputReport,
  ScreenPatch,
  ScreenRole,
  ScreensResult,
  ScreensSaid,
  ScreensSnapshot,
} from './screens';

/**
 * The API the preload script exposes to every renderer as `window.drashti`.
 * Renderers reach the main process only through this object: no Node, no
 * ipcRenderer, no raw channel names.
 */
export interface DrashtiBridge {
  app: {
    getInfo(): Promise<AppInfo>;
    /** A render error in this window, for the main process's log (Session 23; any of Drashti's windows). */
    renderError(report: RenderErrorReport): Promise<null>;
    /** The operator window's own start, for the log: when it knew what it waits for, and drew its controls (question 36). */
    windowStarted(marks: StartMarks): Promise<null>;
    /** Edit > Undo was chosen (operator window). */
    onUndo(listener: () => void): () => void;
    /** Edit > Redo was chosen (operator window). */
    onRedo(listener: () => void): () => void;
    /** Something to tell the operator, from the main process. */
    onNotice(listener: (text: string, mediaId?: string) => void): () => void;
    /** What was put back on the screens after Drashti stopped unexpectedly, until dismissed. */
    recovery(): Promise<RecoveryNotice | null>;
    dismissRecovery(): Promise<null>;
    /** Something to tell the operator as the page opens (how a restore went); null after the first ask. */
    startNotice(): Promise<string | null>;
    /** Whether Simple Mode shows its three first steps: once per library, never in tests unless asked. */
    simpleFirstRun(): Promise<boolean>;
    /** They were seen (skipped, done, or a slide went up): they never come again for this library. */
    simpleFirstRunSeen(): Promise<null>;
    /** View › Show Safe Areas: whether the slide editor draws them. */
    safeAreas(): Promise<boolean>;
    onSafeAreasChanged(listener: (on: boolean) => void): () => void;
    /**
     * Whether Chromium draws without a graphics chip, as Main decides it (Session 58, WU-1): the LIVE picture then skips
     * its warm-up; and once it is said, after the window opened.
     */
    noGpu(): Promise<boolean>;
    onNoGpu(listener: () => void): () => void;
    /** Single-letter keys (Session 37): whether B, . and ? act, and turning them on or off (Pro Mode). */
    singleKeys(): Promise<boolean>;
    setSingleKeys(on: boolean): Promise<{ ok: true; on: boolean } | { ok: false; message: string }>;
    onSingleKeysChanged(listener: (on: boolean) => void): () => void;
    /** A long task's progress (a backup), or null when it has ended. */
    onProgress(listener: (progress: TaskProgress | null) => void): () => void;
    /** Simple Mode or Pro Mode. */
    getMode(): Promise<OperatorMode>;
    /**
     * Into Simple Mode, or back to Pro Mode, at once (operator window only): nothing typed since Session 55, Part 18
     * (Pro Mode's double-click); never Pro Mode with Simple access.
     */
    setMode(mode: OperatorMode): Promise<ModeResult>;
    onModeChanged(listener: (mode: OperatorMode) => void): () => void;
    /**
     * Simple Mode's playlist (Session 55, Part 18): the one open in its window (Session 56: as it comes, then whichever
     * it opened); null in Pro Mode, or with none open.
     */
    simplePlaylist(): Promise<string | null>;
    /** Help > Keyboard Shortcuts… was chosen (Pro Mode). */
    onShowKeys(listener: () => void): () => void;
    /** Help > Guides… was chosen (Sessions 31–36), in either mode. */
    onShowGuides(listener: () => void): () => void;
    /** Help › Drashti Manual… was chosen (x37, Session 60), in either mode. */
    onShowManual(listener: () => void): () => void;
    /** Help › Report a Problem… was chosen (x49), in either mode. */
    onShowReport(listener: () => void): () => void;
    /** An item of the Tools menu was chosen (Session 60, x36; Pro Mode): which. */
    onShowTool(listener: (tool: ToolsMenuItem) => void): () => void;
    /**
     * Simple Mode Features (alpha.22, shared/simple-features.ts): which of Pro Mode's tools Simple Mode has, in either
     * mode; one turned on or off (Pro Mode only, at most three); told as they change; Edit › Simple Mode Features….
     */
    simpleFeatures(): Promise<SimpleFeature[]>;
    setSimpleFeature(feature: SimpleFeature, on: boolean): Promise<SimpleFeatureResult>;
    onSimpleFeaturesChanged(listener: (chosen: SimpleFeature[]) => void): () => void;
    onShowSimpleFeatures(listener: () => void): () => void;
  };
  /** The guides inside Drashti (Sessions 31–36): those this mode may read, and a guide's text. */
  guides: {
    list(): Promise<{ id: GuideId; tab: string }[]>;
    read(id: GuideId): Promise<GuideRead>;
  };
  /**
   * The Drashti Manual (x37, Session 60), in either mode: every chapter's text; the whole manual through the system's
   * print dialog; and saved as a PDF where the person chooses (the system's save dialog).
   */
  manual: {
    read(): Promise<ManualRead>;
    print(): Promise<ManualPrinted>;
    pdf(): Promise<ManualPrinted>;
  };
  /**
   * Help › Report a Problem… (x49, the owner's Q60-38 and Q60-42), in either mode, while this computer is let in: open
   * (the window's picture is taken first, kept in memory only), Review (exactly what goes), Send (the outbox sends it by
   * itself through the access list), the reports kept here, Forget, Save a Copy…, a file shown in the computer's app.
   */
  report: {
    open(): Promise<ReportOpened>;
    close(): Promise<boolean>;
    prepare(draft: ReportDraft): Promise<ReportPrepared>;
    discard(id: string): Promise<boolean>;
    send(id: string): Promise<ReportStateView | null>;
    list(): Promise<ReportRow[]>;
    forget(id: string): Promise<boolean>;
    copy(id: string): Promise<ReportCopied>;
    showFile(id: string, name: string): Promise<boolean>;
    onChanged(listener: () => void): () => void;
  };
  /** Scheduled backups (Session 14, operator window). */
  backups: {
    view(): Promise<ScheduledBackupsView>;
    save(schedule: BackupSchedule): Promise<BackupsResult>;
    pickFolder(): Promise<PickFolderResult>;
    runNow(): Promise<BackupsResult>;
    dismiss(): Promise<ScheduledBackupsView>;
    onChanged(listener: (view: ScheduledBackupsView) => void): () => void;
    /** File > Scheduled Backups… was chosen. */
    onOpen(listener: () => void): () => void;
  };
  /** Events out (Session 28, operator window; Pro Mode). */
  events: {
    view(): Promise<EventsOutView>;
    add(url: string, allowInternet: boolean): Promise<EventsOutResult>;
    update(id: string, patch: EventAddressPatch): Promise<EventsOutResult>;
    remove(id: string): Promise<EventsOutResult>;
    rotate(id: string): Promise<EventsOutResult>;
    test(id: string): Promise<{ ok: boolean; message: string }>;
    /** The new secret's Copy, by the main process (alpha.20); false when it could not be copied. */
    copySecret(secret: string): Promise<boolean>;
    onChanged(listener: (view: EventsOutView) => void): () => void;
    /** File > Events Out… was chosen. */
    onOpen(listener: () => void): () => void;
  };
  /** The drop folder (Session 28, operator window; Pro Mode). */
  drop: {
    view(): Promise<DropFolderView>;
    /** Choose the folder (null: cancelled). */
    pickFolder(): Promise<DropFolderResult | null>;
    setOn(on: boolean): Promise<DropFolderResult>;
    importAnyway(name: string): Promise<DropFolderResult>;
    onChanged(listener: (view: DropFolderView) => void): () => void;
    /** File > Drop Folder… was chosen. */
    onOpen(listener: () => void): () => void;
  };
  /**
   * The opening (Session 55, operator window; alpha.16: two seconds, one photo, the pack's own sound): played as
   * Drashti starts; chosen in File › Opening… (Pro Mode).
   */
  opening: {
    /** What to play as the window opens, or null (main decides, once). */
    atStart(): Promise<OpeningPlan | null>;
    /** It ended; with the window's figures for it, for the log (Session 58). */
    ended(how: OpeningEnd, figures?: OpeningFigures): Promise<null>;
    /** A key ended it (main kept that key from the show). */
    onEnd(listener: () => void): () => void;
    /** Every hall screen has drawn its first frame. */
    onScreens(listener: () => void): () => void;
    view(): Promise<OpeningView>;
    setOn(on: boolean): Promise<OpeningResult>;
    setChoice(choice: OpeningChoice): Promise<OpeningResult>;
    /** Load the opening pack… (null: no folder chosen). */
    loadPack(): Promise<OpeningResult | null>;
    /** The pack's sound taken out. */
    removeSound(): Promise<OpeningResult>;
    saveCopy(mediaId: string, bytes: Uint8Array): Promise<{ ok: true } | { ok: false; message: string }>;
    /** File › Opening… was chosen. */
    onOpen(listener: () => void): () => void;
  };
  /** Caption words (alpha.22, operator window; Pro Mode): the admin's names and terms for live captions. */
  captionWords: {
    view(): Promise<CaptionWordsView>;
    /** The whole list after a change (each word checked again in the main process). */
    set(words: CaptionWord[]): Promise<CaptionWordsResult>;
    /** Import… a CSV file the admin chooses: its words are added to the list. */
    importFile(): Promise<CaptionWordsResult>;
    /** Export… the list as a CSV file where the admin chooses. */
    exportFile(): Promise<CaptionWordsResult>;
    /** A language's switch: its words go to the captions engine as hints (Gujarati off until turned on). */
    setHints(language: SpeechLanguage, on: boolean): Promise<CaptionWordsResult>;
  };
  /** Live captions (Session 55, Part 10, operator window; Pro Mode): how they stand, never a word heard. */
  videoCaptions: {
    view(mediaId: string): Promise<VideoCaptionChoice>;
    select(mediaId: string, trackId: string | null): Promise<VideoCaptionResult>;
    add(mediaId: string): Promise<VideoCaptionResult>;
    onChanged(listener: (change: { mediaId: string; view: VideoCaptionChoice }) => void): () => void;
  };
  captions: {
    /** Ephemeral, operator-only phase D rehearsal; never part of captions status or the network API. */
    prototypeView(): Promise<CaptionReview | null>;
    setPrototypeOn(on: boolean): Promise<CaptionReview | null>;
    advancePrototype(): Promise<CaptionReview | null>;
    restartPrototype(): Promise<CaptionReview | null>;
    correctPrototype(correction: CaptionCorrection): Promise<boolean>;
    dismissPrototype(identity: Omit<CaptionCorrection, 'text'>): Promise<boolean>;
    onPrototypeChanged(listener: (review: CaptionReview) => void): () => void;
    view(): Promise<CaptionsStatus>;
    setOn(on: boolean): Promise<CaptionsStatus>;
    setModel(model: CaptionModelId): Promise<CaptionsStatus>;
    setSettings(settings: CaptionSettings): Promise<CaptionsStatus>;
    retry(): Promise<CaptionsStatus>;
    /** A model of its own for a language (alpha.22): one Drashti knows, or the general model (null). */
    setLanguageModel(language: LanguageModelLanguage, id: string | null): Promise<CaptionsStatus>;
    checkLanguageModel(language: LanguageModelLanguage): Promise<CaptionsStatus>;
    /** The live timing on this computer (alpha.22). */
    setTiming(timing: CaptionTiming): Promise<CaptionsStatus>;
    onChanged(listener: (view: CaptionsStatus) => void): () => void;
    /** File > Live Captions… was chosen. */
    onOpen(listener: () => void): () => void;
  };
  /**
   * Caption and translation models (alpha.22, cap-pack; operator window, Pro Mode): the offline packs on this
   * computer. The pack's folder or zip is chosen in main's own dialog; never fetched.
   */
  modelPacks: {
    view(): Promise<ModelPacksStatus>;
    import(kind: 'folder' | 'zip'): Promise<PackImportResult>;
    cancel(): Promise<boolean>;
    remove(packId: string): Promise<PackRemoveResult>;
    licence(packId: string, file: string): Promise<PackLicenceResult>;
    onChanged(listener: (status: ModelPacksStatus) => void): () => void;
    /** Help › Caption and Translation Models… was chosen. */
    onOpen(listener: () => void): () => void;
  };
  /** Audio playlists (Session 14, operator window). */
  music: {
    view(): Promise<MusicView>;
    create(name: string): Promise<MusicResult>;
    rename(playlistId: string, name: string): Promise<MusicResult>;
    remove(playlistId: string): Promise<MusicResult>;
    setOptions(playlistId: string, options: { loop: boolean; shuffle: boolean }): Promise<MusicResult>;
    addTracks(playlistId: string, mediaIds: string[], at: number | null): Promise<MusicResult>;
    moveTrack(trackId: string, to: number): Promise<MusicResult>;
    removeTrack(trackId: string): Promise<MusicResult>;
    /** Undo: a playlist removed, back (Session 26a). */
    restore(playlistId: string): Promise<MusicResult>;
    /** Undo: a track taken out, back at `at`. */
    restoreTrack(trackId: string, at: number): Promise<MusicResult>;
    /** Play from a track; with no playlist, play on (paused) or start the last one. */
    play(playlistId: string | null, trackIndex?: number): Promise<MusicResult>;
    onChanged(listener: (view: MusicView) => void): () => void;
  };
  /** Updates (Session 14, operator window, Pro Mode). */
  updates: {
    view(): Promise<UpdateView>;
    check(): Promise<UpdateResult>;
    download(): Promise<UpdateResult>;
    cancel(): Promise<UpdateResult>;
    setInstallOnQuit(on: boolean): Promise<UpdateResult>;
    setAutoCheck(on: boolean): Promise<UpdateResult>;
    showFile(): Promise<null>;
    onChanged(listener: (view: UpdateView) => void): () => void;
    /** Help > Check for Updates… was chosen. */
    onOpen(listener: () => void): () => void;
  };
  /** Import from a Link (Session 25b, operator window, Pro Mode). */
  links: {
    view(): Promise<LinkView>;
    start(
      text: string,
      audio: boolean,
      intoOpenPlaylist: boolean,
      options?: LinkDownloadOptions,
    ): Promise<LinkResult>;
    look(kind: LinkKind, link: string): Promise<LinkResult>;
    pickFolder(target?: 'downloads' | 'captions'): Promise<LinkResult>;
    /** Download what was looked at: a YouTube video with its type and quality. */
    download(choice?: YouTubeChoice | null): Promise<LinkResult>;
    stop(): Promise<LinkResult>;
    reset(): Promise<LinkResult>;
    /** A Dropbox folder's PDFs and pictures: into its playlist, each at the end of its folder's part. */
    addWaiting(): Promise<LinkResult>;
    /** Show where the files were saved: an import run's (its report), or the dialog's download (null). */
    showSaved(runId: string | null): Promise<null>;
    /** The highest video quality, for YouTube and Dropbox (Session 25c): 1080, 1440, 2160 or 4320. */
    setMaxHeight(height: number): Promise<LinkResult>;
    /** The playlist a download went into (Session 54): the dialog offers it first the next time. */
    setPlaylist(playlistId: string): Promise<LinkResult>;
    onChanged(listener: (view: LinkView) => void): () => void;
    /** File > Import from a Link… was chosen. */
    onOpen(listener: () => void): () => void;
  };
  /** Files dropped on a page. */
  files: {
    /** The path of a file or folder dropped from the desktop ('' for other files). */
    pathFor(file: File): string;
  };
  engine: {
    /** A matching first decoded cue frame or sound, reported by a trusted participant. */
    videoCueReady(cueId: string, kind: 'picture' | 'sound', ready: boolean): Promise<null>;
    /**
     * Listen for engine messages (snapshots and patches). Register before
     * calling subscribe() so nothing is missed. Returns an unsubscribe function.
     */
    onMessage(listener: (message: EngineMessage) => void): () => void;
    /** Start receiving messages in this window and get the current snapshot. */
    subscribe(): Promise<EngineSnapshotMessage>;
    /** A fresh snapshot (after a missed revision). */
    snapshot(): Promise<EngineSnapshotMessage>;
    /** Ask the engine to do something. Only the operator window may. */
    dispatch(command: EngineCommand): Promise<CommandResult>;
    /**
     * The operator's pointer on a slide's row, or null (C3, Session 58: Q57-26): the screens load that deck slide's
     * first clip ahead. Only the operator window may.
     */
    pointAt(target: PointAt | null): Promise<null>;
  };
  library: {
    listPresentations(): Promise<PresentationSummary[]>;
    /** Every media item, for the library's media list. */
    listMedia(): Promise<MediaSummary[]>;
    /** Presentations by title and slide text, best first. */
    search(query: string): Promise<SearchResult>;
    /** A presentation's words as plain text, for the words editor. */
    words(presentationId: string): Promise<WordsResult>;
    /** Put edited words back; slides that are still there keep their look and cues. */
    saveWords(presentationId: string, text: string): Promise<SaveWordsResult>;
    /** A new presentation from pasted words, in the default look. */
    newFromWords(name: string, text: string): Promise<NewFromWordsResult>;
    /** Book OCR (alpha.21): choose pictures or a PDF to read the words of (the system's dialog). */
    readWordsChoose(): Promise<ReadWordsChoice>;
    /** Read the chosen pictures, or the chosen PDF's pages `fromPage` to `toPage` (from 1). */
    readWords(fromPage: number | null, toPage: number | null): Promise<ReadWordsResult>;
    /** Stop the reading going on (true when there was one). */
    stopReadingWords(): Promise<boolean>;
    onReadWordsProgress(listener: (payload: { progress: ReadWordsProgress | null }) => void): () => void;
    /**
     * New › QR code… (Session 55, Part 8): one slide, a large code of the link or words and the words under it; since
     * alpha.20 (Q60-28) with the logo in the middle and without the words, as the window asks.
     */
    newQrSlide(text: string, options?: QrSlideOptions): Promise<NewFromWordsResult>;
    /** The QR code… window's choices (Q60-28): the logo kept for the middle, Logo in the middle, the words under it. */
    qrChoices(): Promise<QrChoices>;
    /** Logo in the middle: Choose a Picture…, the system's open dialog: the picture's own bytes, or why not. */
    pickQrLogo(): Promise<QrPicked>;
    /** The window's copy of that picture (a PNG at most 1024 pixels a side), kept and remembered, the logo on. */
    keepQrLogo(name: string, png: Uint8Array): Promise<QrChoicesResult>;
    /** Logo in the middle on or off, and the words under the code: remembered. */
    setQrChoices(change: QrChoicesChange): Promise<QrChoicesResult>;
    /** Download…: the system's save dialog, then the code as a PNG of about 2048 pixels and an SVG there. */
    downloadQr(text: string, options: { logo: boolean }): Promise<QrDownloadResult>;
    /** Undo a change to a presentation's content: write back the copy kept before it. */
    restoreRevision(revisionId: string): Promise<RevisionResult>;
    /** Presentations with slide text in legacy fonts, which search cannot read yet. */
    legacyPresentations(): Promise<{ id: string; name: string }[]>;
    getPresentation(id: string): Promise<PresentationDoc | null>;
    /** A presentation's slides, everything on them, and how new text looks, for the slide editor. */
    slidesForEdit(presentationId: string, source?: EditSourceRequest): Promise<EditSlidesResult>;
    /** Save a separate PDF from the current editor document; never saves or closes the presentation. */
    linkPdfPage(
      presentationId: string,
      doc: EditDoc,
      stamp: string,
      slideId: string,
      pictureId: string,
      preparedId: string,
    ): Promise<LinkPdfPageResult>;
    pdfPageSources(): Promise<PdfPageSource[]>;
    insertPdfPages(presentationId: string, stamp: string, sourceId: string): Promise<InsertPdfPagesResult>;
    insertPdfFile(presentationId: string, stamp: string): Promise<InsertPdfPagesResult>;
    cancelPdfInsertion(presentationId: string, stamp: string): Promise<boolean>;
    exportPdf(presentationId: string, doc: EditDoc, stamp: string, pages?: number[]): Promise<PdfCopyResult>;
    /** A singers' sheet (alpha.22): the presentation's words printed, or saved as a PDF where the person chooses. */
    printWords(presentationId: string): Promise<WordsPrinted>;
    saveWordsPdf(presentationId: string): Promise<WordsPrinted>;
    extractPdfPages(
      presentationId: string,
      doc: EditDoc,
      stamp: string,
      pages: number[],
    ): Promise<{ ok: true; id: string; name: string } | { ok: false; message: string }>;
    showExtractedPdf(id: string, visible: boolean): Promise<boolean>;
    showExtractedPdfCopy(id: string, visible: boolean): Promise<boolean>;
    pdfWorkAllowed(): Promise<boolean>;
    /**
     * Put edited slides back as one change (Undo brings back the copy kept
     * before it). Refused when the presentation changed since `stamp`, unless forced.
     */
    saveSlides(
      presentationId: string,
      doc: EditDoc,
      stamp: string,
      force?: boolean,
    ): Promise<SaveSlidesResult>;
    /** The transition for presentations without their own (a cut, until it is changed). */
    getDefaultTransition(): Promise<Transition>;
    /** View › Show Books, Templates and Kirtan Details (Session 26a): off to begin with. */
    extras(): Promise<boolean>;
    /** Pro Mode's (the View menu does it too). */
    setExtras(on: boolean): Promise<{ ok: true; on: boolean } | { ok: false; message: string }>;
    onExtrasChanged(listener: (on: boolean) => void): () => void;
    setDefaultTransition(
      transition: Transition,
    ): Promise<{ ok: true; transition: Transition } | { ok: false; message: string }>;
    /** Presentations (for example by an import), props, messages or themes were added or changed. */
    onChanged(listener: (what: LibraryChange) => void): () => void;
    /**
     * Import files and folders (operator window only). Resolves when the run
     * has ended; changed files come back as conflicts unless options say what to do.
     */
    importPaths(paths: string[], options?: ImportOptions): Promise<ImportResult>;
    cancelImport(runId: string): Promise<boolean>;
    onImportProgress(listener: (progress: ImportProgress) => void): () => void;
    onAutomaticImportNotice(listener: (notice: AutomaticImportNotice) => void): () => void;
    takeAutomaticImportNotices(): Promise<AutomaticImportNotice[]>;
    listImportRuns(): Promise<ImportRunSummary[]>;
    getImportReport(runId: string): Promise<ImportReport | null>;
    /** Ask for files or a folder to import (a system dialog); [] when cancelled. */
    pickImportPaths(kind: 'files' | 'folder' | 'sounds'): Promise<string[]>;
    /** Ask for a folder and look there for missing media (all, or just these). */
    relinkMedia(mediaIds?: string[]): Promise<ImportResult>;
    /** Choose the order a presentation plays in: an arrangement, or null for every slide (operator window only). */
    setArrangement(
      presentationId: string,
      arrangementId: string | null,
    ): Promise<{ ok: true } | { ok: false; message: string }>;
    /** Remove presentations; restorePresentations brings them back (Undo). */
    removePresentations(ids: string[]): Promise<RemoveResult>;
    restorePresentations(ids: string[]): Promise<RemoveResult>;
    /** Session 55 (Part 14): the playlists that hold presentations and whether one is up; a rename; Show in Finder. */
    presentationUsage(ids: string[]): Promise<PresentationUsage>;
    renamePresentation(id: string, name: string): Promise<RemoveResult>;
    revealPresentation(id: string): Promise<RevealResult>;
  };
  /** Kirtans: words by language and details; changing them is for the operator window only. */
  kirtans: {
    exportBundle(request: KirtanBundleExportRequest): Promise<KirtanBundleExportResult>;
    /** Every slide's words by language. */
    tracks(presentationId: string): Promise<TracksResult>;
    /** Put changed lines back, slide by slide and language by language (one change for Undo). */
    saveTracks(presentationId: string, edits: TrackEdit[]): Promise<KirtanResult>;
    /** Make it a kirtan with these details, or (null) not a kirtan; its words stay as they are. */
    setDetails(presentationId: string, details: KirtanDetails | null): Promise<KirtanResult>;
    /**
     * Fill its transliteration track from its Gujarati (or Hindi) lines, in
     * this style. Lines changed by hand: 'ask' changes nothing and asks
     * (when there are any), 'keep' leaves them, 'replace' makes them again.
     */
    makeTransliteration(
      presentationId: string,
      style: TranslitStyle,
      manual: ManualLines,
    ): Promise<MakeTranslitResult>;
    getTranslitStyle(): Promise<TranslitStyle>;
    /** The categories a kirtan can have: Drashti's, those added, and any a kirtan in the library has. */
    categories(): Promise<string[]>;
    addCategory(name: string): Promise<{ ok: true; categories: string[] } | { ok: false; message: string }>;
    setTranslitStyle(
      style: TranslitStyle,
    ): Promise<{ ok: true; style: TranslitStyle } | { ok: false; message: string }>;
  };
  /** Playlists and folders; changing them is for the operator window only. */
  playlists: {
    tree(): Promise<PlaylistNode[]>;
    items(playlistId: string): Promise<PlaylistItemInfo[]>;
    /** Presentations' first slides, for the open playlist's cards (Session 26a). */
    firstSlides(presentationIds: string[]): Promise<Record<string, RenderSlide | null>>;
    /**
     * The operator opened it: it counts as this week's for output nodes (Session 14); null, Pro Mode's window closed it
     * (Session 55, Part 18: Simple Mode then takes a new playlist).
     */
    opened(playlistId: string | null): Promise<null>;
    create(name: string, parentId: string | null, isFolder: boolean): Promise<PlaylistResult>;
    rename(playlistId: string, name: string): Promise<PlaylistResult>;
    /** Remove playlists or folders (with what they hold); restore brings them back (Undo). */
    remove(ids: string[]): Promise<PlaylistResult>;
    restore(ids: string[]): Promise<PlaylistResult>;
    /** Add at a position, or at the end when it is null. */
    addItems(playlistId: string, at: number | null, items: NewItem[]): Promise<PlaylistResult>;
    /** Move items so the first lands at `to` among the others. */
    moveItems(playlistId: string, ids: string[], to: number): Promise<PlaylistResult>;
    removeItems(ids: string[]): Promise<PlaylistResult>;
    restoreItems(ids: string[]): Promise<PlaylistResult>;
    /** Put a presentation where the import left a placeholder. */
    fillPlaceholder(itemId: string, presentationId: string): Promise<PlaylistResult>;
    setItemOrder(itemId: string, order: ItemOrder): Promise<PlaylistResult>;
    renameHeader(itemId: string, label: string): Promise<PlaylistResult>;
    /** The sabha templates, kept apart from the playlists. */
    templates(): Promise<PlaylistNode[]>;
    /** A template from a playlist; the items named become slots. */
    saveAsTemplate(playlistId: string, request: TemplateRequest): Promise<PlaylistResult>;
    /** A new playlist from a template, in a folder or at the top level, its slots ready to fill. */
    newFromTemplate(templateId: string, name: string, parentId: string | null): Promise<PlaylistResult>;
    /** A slot's name, and the category its search starts at (a Shastra passage, or none). */
    editSlot(itemId: string, slot: { label: string; category: string | null }): Promise<PlaylistResult>;
    /** What an item does to timers when it goes up: start, reset or show each (none to take them away). */
    setTimers(itemId: string, cues: TimerCue[]): Promise<PlaylistResult>;
    /** What a video's row does when it ends (Session 55, Part 6). */
    setWhenEnds(itemId: string, whenEnds: WhenEnds): Promise<PlaylistResult>;
    setPlayOptions(playlistId: string, options: PlaylistPlayOptions): Promise<PlaylistResult>;
    importM3u(audio: boolean, targetId: string | null): Promise<M3uResult>;
    exportM3u(playlistId: string, audio: boolean): Promise<M3uResult>;
    /** Its running order (alpha.22) as plain lines on the clipboard: numbered rows, headers as sections, the total. */
    copyRunningOrder(playlistId: string): Promise<RunningOrderCopied>;
    /** Its running order through the system's print dialog, from a hidden window (never while the show is live). */
    printRunningOrder(playlistId: string): Promise<ManualPrinted>;
    /** Its running order saved as a PDF where the person chooses (the system's save dialog). */
    saveRunningOrderPdf(playlistId: string): Promise<ManualPrinted>;

    /** "<name> copy" beside it, with its rows in their order (Session 55, Part 4). */
    duplicate(playlistId: string): Promise<PlaylistResult>;
    /**
     * A slide's row dragged out of its deck (Session 55, Part 4b): an item of its own at `at` playing `alone`, the item
     * keeping `rest` (both own orders of slides). Its ids: the new item's.
     */
    splitItem(itemId: string, rest: ItemOrder, alone: ItemOrder, at: number): Promise<PlaylistResult>;
    /** Its Undo: the item plays `order` again, and the item made is taken out. */
    undoSplit(itemId: string, order: ItemOrder, madeId: string): Promise<PlaylistResult>;
    /** A slot, at a position or the end. */
    addSlot(
      playlistId: string,
      at: number | null,
      slot: { label: string; category: string | null },
    ): Promise<PlaylistResult>;
    /** Smart playlists (Session 26c): how following each one's folder goes. */
    smartViews(): Promise<SmartPlaylistView[]>;
    /** A smart playlist from a folder chosen in a dialog (none made: no ids). */
    createSmart(): Promise<PlaylistResult>;
    /**
     * Files and folders dropped (Session 56, item 5): a smart playlist from each folder, at once, nothing asked; the
     * rest given back for the drop's own place.
     */
    createSmartFrom(paths: string[]): Promise<SmartFromDrop>;
    /** Take a smart playlist's missing items out (their files are gone from its folder). */
    removeMissing(playlistId: string): Promise<PlaylistResult>;
    /** A new Repeat Slides playlist (Session 26d) in a folder or at the top level, and its settings. */
    createRepeat(parentId: string | null): Promise<PlaylistResult>;
    setRepeat(playlistId: string, settings: RepeatSettings): Promise<PlaylistResult>;
    /** Share a playlist with phones and tablets, or stop (Session 54). */
    share(playlistId: string, on: boolean): Promise<PlaylistResult>;
    onChanged(listener: () => void): () => void;
    onSmartChanged(listener: (views: SmartPlaylistView[]) => void): () => void;
  };
  /** The look of Drashti's own windows (Sessions 39–40): the Appearance window's view, and choosing. */
  appearance: {
    view(): Promise<AppearanceView>;
    /** FOLLOW or an appearance's id (Pro Mode; Simple Mode refuses it). */
    choose(choice: string): Promise<{ ok: true } | { ok: false; message: string }>;
    /** Make one's own and choose it (every rule is checked again in the main process); delete one's own. */
    make(
      fields: Omit<OwnAppearance, 'id'>,
    ): Promise<{ ok: true; id: string } | { ok: false; message: string }>;
    remove(id: string): Promise<{ ok: true } | { ok: false; message: string }>;
    /** Interface motion: Calm, Lively or Off (Session 40). */
    setMotion(motion: InterfaceMotion): Promise<{ ok: true } | { ok: false; message: string }>;
    /** Moving: On or Off (Session 60). */
    setMoving(on: boolean): Promise<{ ok: true } | { ok: false; message: string }>;
    /** Star or unstar an appearance (Session 60). */
    setFavourite(id: string, on: boolean): Promise<{ ok: true } | { ok: false; message: string }>;
    /** View › Appearance… was chosen. */
    onOpen(listener: () => void): () => void;
    /** The appearance or the motion changed (every window draws it by itself; the Appearance window shows it). */
    onChanged(listener: () => void): () => void;
  };
  /** Message templates ("Car {plate} please move"). Showing one goes through the engine. */
  messages: {
    list(): Promise<MessageTemplate[]>;
    create(template: MessageTemplateFields): Promise<MessageResult>;
    update(templateId: string, template: MessageTemplateFields): Promise<MessageResult>;
    remove(templateId: string): Promise<MessageResult>;
    /** A template put back as it was, its id too (Session 55: Undo of a change or a removal). */
    restore(template: MessageTemplate): Promise<MessageResult>;
  };
  /** Making and editing timers (operator window only). Starting and pausing go through the engine. */
  timers: {
    create(fields: TimerFields): Promise<TimerResult>;
    update(timerId: string, fields: TimerFields): Promise<TimerResult>;
    remove(timerId: string): Promise<TimerResult>;
    /**
     * Countdown to the start (Session 55, Part 15): a countdown to the sabha's time ("19:30") over the wallpaper on
     * the audience and the stage, gone by itself at zero; its timer made, or changed when it is there, and shown.
     */
    startCountdown(time: string): Promise<TimerResult>;
  };
  media: {
    proxyStatus(mediaId: string, retry?: boolean): Promise<VideoProxyResult>;
    stopProxy(mediaId: string): Promise<boolean>;
    clipExport(request: ClipExportRequest): Promise<ClipExportResult>;
    clipExports(): Promise<ClipExportJob[]>;
    stopClipExport(jobId: string): Promise<boolean>;
    showClipExport(jobId: string): Promise<null>;
    /**
     * Combine videos… (alpha.22): the videos (two to ten, in the order they play) joined end to end into one new video
     * in Media, waiting for an idle moment (operator window, Pro Mode); the combines; and Stop.
     */
    combineVideos(request: CombineRequest): Promise<CombineResult>;
    combineList(): Promise<CombineJob[]>;
    stopCombine(jobId: string): Promise<boolean>;
    /** Cached source-time analysis; queues only through the idle conversion worker. Audio uses 0:a:N. */
    videoAnalysis(
      mediaId: string,
      audioStream?: number | null,
      retry?: boolean,
    ): Promise<VideoAnalysisResult>;
    /**
     * Keep a still frame (a JPEG drawn from the file) for a media item's
     * thumbnails, so it is made only once (operator window only).
     */
    saveStill(mediaId: string, jpeg: Uint8Array): Promise<SaveStillResult>;
    /** Convert files Drashti cannot play (in turn, in the background). */
    convert(mediaIds: string[]): Promise<ConvertResult>;
    /** Try a failed automatic conversion again. */
    retryConversion(jobId: string): Promise<ConvertResult>;
    /** Stop making a smaller copy of a linked video. */
    cancelLinkConversion(jobId: string): Promise<ConvertResult>;
    /** Cancel one conversion, or every one not finished (null). */
    cancelConversion(jobId: string | null): Promise<ConvertResult>;
    conversions(): Promise<ConversionJob[]>;
    onConversions(listener: (jobs: ConversionJob[]) => void): () => void;
    /**
     * Whether this computer plays HEVC video (question 36): null until Drashti knows, a moment after the start
     * (on a slow computer, several seconds), then told once.
     */
    playsHevc(): Promise<boolean | null>;
    onPlaysHevc(listener: (plays: boolean) => void): () => void;
    /** Undo a conversion: the original is used again wherever it was moved from. */
    undoConversion(conversionId: string): Promise<{ ok: true } | { ok: false; message: string }>;
    /** Save as MP4… (Session 26e): where a part saved from `startMs` begins (its keyframe). */
    keyframe(mediaId: string, startMs: number): Promise<KeyframeResult>;
    /** Save the part as an MP4 where the operator chooses (a save dialog), in the background. */
    saveTrim(request: SaveRequest): Promise<SaveResult>;
    rowTrim(itemId: string): Promise<RowTrimView | null>;
    applyRowTrim(itemId: string, request: RowTrimRequest): Promise<RowTrimResult>;
    resetRowTrim(itemId: string, mediaId: string): Promise<RowTrimResult>;
    stopRowTrim(itemId: string, mediaId: string): Promise<RowTrimResult>;
    preparingTrims(): Promise<string[]>;
    onPreparingTrims(listener: (itemIds: string[]) => void): () => void;
    /** How each row's cut stands (alpha.22): why it waits, or how far it is. */
    trimStatuses(): Promise<TrimStatuses>;
    onTrimStatuses(listener: (statuses: TrimStatuses) => void): () => void;
    /** Export… (alpha.22): a finished video in Media copied where the operator chooses (a save dialog in Downloads). */
    exportFile(mediaId: string): Promise<ExportFileResult>;
    saves(): Promise<SaveJob[]>;
    onSaves(listener: (jobs: SaveJob[]) => void): () => void;
    stopSave(jobId: string): Promise<boolean>;
    /** Show a saved file in the Finder (Explorer on Windows). */
    showSave(jobId: string): Promise<null>;
    /** A picture's look (Session 26e), every picture's, and keeping one (null: shown as it is). */
    look(mediaId: string): Promise<PictureLook | null>;
    looks(): Promise<Record<string, PictureLook>>;
    setLook(
      mediaId: string,
      look: PictureLook | null,
    ): Promise<{ ok: true } | { ok: false; message: string }>;
    /** Keep this zoom: the live zoom kept as the picture's own. */
    keepLiveZoom(): Promise<{ ok: true } | { ok: false; message: string }>;
    /** Session 55 (Part 5): a photo (its blurred fill on by itself), not a deck's page. */
    photo(mediaId: string): Promise<boolean>;
    /** Save picture… (Session 55, Part 5): the picture full size, as it shows, where the operator chooses. */
    savePicture(mediaId: string, name: string): Promise<SavePictureResult>;
    onLooks(listener: (looks: Record<string, PictureLook>) => void): () => void;
    /** The videos' page copies ready, by media id: their heights (QA23-FADE-9 candidate 1). */
    pageCopies(): Promise<Record<string, number[]>>;
    onPageCopies(listener: (ready: Record<string, number[]>) => void): () => void;
    /** Where media is used, asked before deleting it (Session 26a). */
    usage(mediaIds: string[]): Promise<MediaUsage>;
    /** Delete media from the library, taking it out of playlists and music; Undo with restore. */
    remove(mediaIds: string[]): Promise<MediaRemovalResult>;
    restore(mediaIds: string[]): Promise<MediaRemovalResult>;
    /** Session 55 (Part 14): a rename (its playlist rows that had its name follow), and Show in Finder or Explorer. */
    rename(mediaId: string, name: string): Promise<MediaRemovalResult>;
    reveal(mediaId: string): Promise<RevealResult>;
    /** A video's or sound's start and end points and markers (Session 14); setting them is the operator's. */
    markers(mediaId: string): Promise<MediaMarkers>;
    /** Media information… (alpha.20, Q60-34 item 1): what a video's or a sound's file holds, as FFmpeg reads it. */
    details(mediaId: string): Promise<MediaDetailsResult>;
    /** Media information's Copy: its words on the clipboard, by the main process; false when they could not be. */
    copyDetails(text: string): Promise<boolean>;
    /** Resume where it stopped (alpha.20): where a long file was taken off before its end, and when; null for none. */
    resumePoint(mediaId: string): Promise<ResumePoint | null>;
    /** Snapshot (alpha.20): the frame of a video on the screens now, a PNG in Media; or why not. */
    snapshot(playing: PlayingRef): Promise<SnapshotResult>;
    /** Sound and picture… (alpha.20): a video's or a sound's own tone and delays; null for anything else. */
    videoEdit(mediaId: string): Promise<VideoEditResult>;
    setVideoEdit(request: SaveVideoEdit): Promise<VideoEditResult>;
    onVideoEdit(listener: (edit: VideoEditSnapshot) => void): () => void;
    playback(mediaId: string): Promise<PlaybackSettings | null>;
    /** Keep them (heard at once wherever it plays). */
    setPlayback(
      mediaId: string,
      settings: PlaybackSettings,
    ): Promise<{ ok: true } | { ok: false; message: string }>;
    setMarkers(mediaId: string, markers: MediaMarkers): Promise<MarkersResult>;
    /** How long a file is, learned as it played (outputs and the audio player only). */
    reportLength(mediaId: string, durationMs: number): Promise<null>;
    /**
     * A video's picture cannot be drawn on this computer (Session 60, x36), found as it loaded in an output or the
     * operator window: its showing (its file and when it went up).
     */
    noPicture(mediaId: string, startedAt: number): Promise<null>;
    /**
     * A video's element failed on a page that draws the show (Q60-31: this computer's decoder raising an error, a cut
     * or damaged file, its copy unreadable): its showing (its file and when it went up), and its MediaError's code (1 to
     * 4; 0: none) and Chromium's words for Main's log.
     */
    cannotPlay(mediaId: string, startedAt: number, code: number, words: string): Promise<null>;
    /** How many bytes of a library file Main has sent the pages so far (Q60-51; 0 for none). */
    served(mediaId: string): Promise<number>;
  };
  /**
   * Drashti's own sound with everything else (Session 55, Part 7): Audio's Music steps aside, a file's Even loudness,
   * and a video's points set past its black and silence (the operator window's).
   */
  sound: {
    view(): Promise<SoundView>;
    /** A video's or sound's loudness as measured, and its own switch; null for no such file. */
    file(mediaId: string): Promise<FileSoundView | null>;
    setStepsAside(on: boolean): Promise<SoundViewResult>;
    /**
     * The operator's Audio or Video level, 0 to 1 (X33), kept across a restart; and its mute, never kept. The engine's
     * state says them (its sound's levels), and the hall and the stream play by them at once.
     */
    setLevel(kind: SoundKind, level: number): Promise<SoundLevelsResult>;
    setMuted(kind: SoundKind, muted: boolean): Promise<SoundLevelsResult>;
    setEven(mediaId: string, on: boolean): Promise<EvenResult>;
    trimEdges(mediaId: string): Promise<TrimEdgesResult>;
    onChanged(listener: (view: SoundView) => void): () => void;
  };
  /** Where sound plays. */
  audio: {
    getOutput(): Promise<AudioOutputStatus>;
    /** Choose the sound output; null for the system default (operator window only). */
    setOutput(device: AudioDevice | null): Promise<AudioOutputStatus>;
    onStatus(listener: (status: AudioOutputStatus) => void): () => void;
    /** Audio player only: the outputs it sees, and where it is playing. */
    reportDevices(devices: AudioDevice[], state: AudioOutputState): Promise<null>;
    /** Audio player only: the operator chose another output. */
    onChosen(listener: (device: AudioDevice | null) => void): () => void;
    /** Audio player only: play a short test tone on this output ('' for the system default). */
    onTestTone(listener: (deviceId: string) => void): () => void;
    /** The sound player given up on, tried again now (x53: its red notice's Try again). */
    tryAgain(): Promise<{ ok: true } | { ok: false; message: string }>;
  };
  /** Built-in streaming (PLAN.md 4.2). Going live and ending need the operator's confirmation. */
  stream: {
    status(): Promise<StreamStatus>;
    onChanged(listener: (status: StreamStatus) => void): () => void;
    setLayout(layout: StreamLayout): Promise<StreamResult>;
    /** Watch the Program's preview: frames and the sound level come on a port (see stream/preview.ts). */
    watchPreview(on: boolean): Promise<null>;
    profiles(): Promise<StreamProfiles>;
    saveProfile(id: string | null, input: StreamProfileInput): Promise<StreamProfilesResult>;
    /** The camera and sound input of the profile in use (without reading the profiles). */
    setInputs(camera: DeviceChoice | null, sound: DeviceChoice | null): Promise<StreamResult>;
    removeProfile(id: string): Promise<StreamProfilesResult>;
    useProfile(id: string): Promise<StreamProfilesResult>;
    /** The key is kept in the system's secure storage and never comes back. */
    /** A profile's own key, or (with `place`) one of its other places' (Session 28). */
    setKey(id: string, key: string, place?: string): Promise<StreamProfilesResult>;
    removeKey(id: string, place?: string): Promise<StreamProfilesResult>;
    goLive(confirm: { confirmed: true }): Promise<StreamResult>;
    end(confirm: { confirmed: true }): Promise<StreamResult>;
    startRecording(): Promise<StreamResult>;
    startSoundRecording(): Promise<StreamResult>;
    stopRecording(): Promise<StreamResult>;
    pickFolder(): Promise<StreamResult>;
    /** Let the offer to go live again after a crash go. */
    dismissResume(): Promise<null>;
    /** Try the stream's page again, stopped after crashing too often (Session 31). */
    tryAgain(): Promise<StreamResult>;
    /** Video out (x30): the stream's picture to other software, off until it is turned on. */
    videoOut(): Promise<VideoOutStatus>;
    /** The operator window, Pro Mode: turn it on or off, or name it. */
    setVideoOut(settings: VideoOutSettings): Promise<VideoOutResult>;
    onVideoOut(listener: (status: VideoOutStatus) => void): () => void;
    /** The stream's own page. */
    page: {
      context(): Promise<ProgramContext | null>;
      onContext(listener: (context: ProgramContext) => void): () => void;
      reportInputs(inputs: ProgramInputs): Promise<null>;
      /** While a cue waits: when its frames begin and how far apart (a manual Go is placed on them). */
      reportFrames(grid: FrameGrid): Promise<null>;
    };
  };
  /**
   * Scheduling a YouTube stream from Drashti (x31): the operator window, Pro Mode. Never a token or a key comes
   * back: only who is signed in, each profile's broadcast and the channel's coming broadcasts.
   */
  youtube: {
    status(): Promise<YouTubeStatus>;
    onChanged(listener: (status: YouTubeStatus) => void): () => void;
    /** The admin's own Google client, kept in this computer's secure storage and never shown again. */
    setClient(clientId: string, clientSecret: string): Promise<YouTubeResult>;
    removeClient(): Promise<YouTubeResult>;
    /** Opens Google's sign-in page in this computer's own browser; the answer comes by onChanged. */
    signIn(): Promise<YouTubeResult>;
    cancelSignIn(): Promise<YouTubeResult>;
    signOut(): Promise<YouTubeResult>;
    upcoming(): Promise<YouTubeListResult>;
    schedule(input: YouTubeScheduleInput): Promise<YouTubeResult>;
    useBroadcast(profileId: string, broadcastId: string): Promise<YouTubeResult>;
    endBroadcast(profileId: string): Promise<YouTubeResult>;
  };
  /** Show a Stream Link… (alpha.20, the playback set's slice 8): an HLS or YouTube live link on the hall's screens. */
  liveLink: {
    /** The operator window: show a link typed (up once its pictures come), or why not. */
    show(link: string): Promise<StreamLinkResult>;
    /** The operator window: stop the link connecting, or take the one up off. */
    stop(): Promise<null>;
    status(): Promise<StreamLinkStatus>;
    /** The operator window: the last link shown, to offer again. */
    last(): Promise<string | null>;
    /** A screen's page or the audio player: join the link up (where its player starts, and when), or null. */
    join(linkId: string): Promise<StreamLinkJoin | null>;
    onChanged(listener: (status: StreamLinkStatus) => void): () => void;
  };
  /** Show a Window… (Session 48): another app's window as the hall's background. */
  liveWindow: {
    /** The operator window: the other apps' open windows (or why there are none to offer). */
    list(): Promise<WindowList>;
    /** The operator window: put one of the windows just listed on the screens. */
    show(id: string): Promise<LiveWindowResult>;
    /** The operator window, on a Mac: System Settings at Screen Recording. */
    access(): Promise<null>;
    status(): Promise<LiveWindowStatus>;
    onChanged(listener: (status: LiveWindowStatus) => void): () => void;
    /** A screen's page: may it capture the window up now? Its next request for a picture then gets it. */
    ask(sourceId: string): Promise<boolean>;
    /** A screen's page: its capture of the window ended. */
    ended(sourceId: string): Promise<null>;
  };
  /** Video inputs (Session 50): this computer's cameras and capture inputs, named in Media. */
  videoInputs: {
    list(): Promise<VideoInputsView>;
    onChanged(listener: (view: VideoInputsView) => void): () => void;
    /** The operator window, Pro Mode: name one of this computer's inputs. */
    add(fields: VideoInputFields): Promise<VideoInputResult>;
    update(id: string, fields: Partial<VideoInputFields>): Promise<VideoInputResult>;
    remove(id: string): Promise<VideoInputResult>;
    /** The chosen one (Session 55): a stage layout's video input box and LIVE's one press (operator window only). */
    choose(id: string): Promise<VideoInputResult>;
    /** May Drashti use the cameras? */
    access(): Promise<CameraAccess>;
    /** A Mac: ask for the camera (the page has said why first). */
    askAccess(): Promise<CameraAccess>;
    /** System Settings (or Windows' Settings) at the camera's privacy page. */
    openSettings(): Promise<null>;
    /** A page drawing the input up now: it plays, or it stopped. */
    report(report: VideoInputReport): Promise<null>;
    status(): Promise<VideoInputStatus>;
    onStatus(listener: (status: VideoInputStatus) => void): () => void;
    /** The operator window: the camera names it sees, for a phone naming an input (Session 54). */
    cameras(names: string[]): Promise<null>;
  };
  /** Picture in picture (Session 50): where a new box goes and how it looks, as the library remembers. */
  pip: {
    place(): Promise<PipPlace>;
    savePlace(place: PipPlace): Promise<PipSettingsResult>;
  };
  /** The window for Zoom (Session 48). */
  zoom: {
    /** The operator window: open it, or bring it forward. */
    open(): Promise<null>;
    /** The window for Zoom's page: the stream's picture as it stands (null: not ready). */
    program(): Promise<ZoomProgram | null>;
    onProgram(listener: (program: ZoomProgram | null) => void): () => void;
  };
  /** View › Access List… (Session 54, E4): the owner's window onto the access list (that window only). */
  accessList: {
    view(): Promise<AccessListView>;
    refresh(): Promise<AccessListView>;
    add(fields: AccessListAdd): Promise<AccessListResult>;
    /** Approved for a length of access (Unlimited, or days), counted from now, Pro or Simple (Session 55). */
    approve(gmail: string, length: AccessLength, mode: AccessMode): Promise<AccessListResult>;
    reject(gmail: string): Promise<AccessListResult>;
    revoke(gmail: string): Promise<AccessListResult>;
    regrant(gmail: string, length: AccessLength, mode: AccessMode): Promise<AccessListResult>;
    /** A new length of access for a Gmail approved, counted from now. */
    changeLength(gmail: string, length: AccessLength): Promise<AccessListResult>;
    /** How a Gmail may use Drashti (Session 55): Pro or Simple, heard at its computers' next check. */
    changeMode(gmail: string, mode: AccessMode): Promise<AccessListResult>;
    note(gmail: string, note: string): Promise<AccessListResult>;
    /** The rows shown, by Gmail in their order, saved as a CSV where the owner chooses. */
    exportCsv(gmails: string[]): Promise<AccessListSaved>;
    onChanged(listener: (view: AccessListView) => void): () => void;
  };
  /** The local network: phones and tablets on the mandir's Wi-Fi (operator window only). */
  network: {
    status(): Promise<NetworkStatus>;
    onChanged(listener: (status: NetworkStatus) => void): () => void;
    setOn(on: boolean): Promise<NetworkResult>;
    setPort(port: number): Promise<NetworkResult>;
    startPairing(kind: DeviceKind, name?: string): Promise<NetworkResult>;
    cancelPairing(): Promise<NetworkResult>;
    renameDevice(deviceId: string, name: string): Promise<NetworkResult>;
    revokeDevice(deviceId: string): Promise<NetworkResult>;
    makePoster(): Promise<NetworkResult>;
    /** "Phones and tablets may add files" (Session 54). */
    setAddFiles(on: boolean): Promise<NetworkResult>;
  };
  /** Output nodes on Main (Session 13): pairing, the dashboard, its actions (changes in Pro Mode only). */
  nodes: {
    status(): Promise<NodesStatus>;
    onChanged(listener: (status: NodesStatus) => void): () => void;
    onThumbs(listener: (thumbs: ScreenThumb[]) => void): () => void;
    startPairing(): Promise<NodesResult>;
    cancelPairing(): Promise<NodesResult>;
    rename(nodeId: string, name: string): Promise<NodesResult>;
    remove(nodeId: string): Promise<NodesResult>;
    /** A new identity for the nodes, in place of one that could not be read (Session 23). */
    newIdentity(): Promise<NodesResult>;
    everything(nodeId: string, on: boolean): Promise<NodesResult>;
    /** Main's Pro Mode only: enable the paired computer's shared show view, without show actions. */
    setController(nodeId: string, on: boolean): Promise<NodesResult>;
    setControllerAreas(nodeId: string, areas: ControllerArea[]): Promise<NodesResult>;
    /** Reload one output: on Main (nodeId null) or on a node. */
    reload(nodeId: string | null, screenId: string): Promise<NodesResult>;
    /** A display's number and name on it (null: every display of that computer). */
    identify(nodeId: string | null, displayId: number | null): Promise<null>;
    /** The dashboard is open: thumbnails come every few seconds while it is. */
    watch(on: boolean): Promise<null>;
  };
  /** A node's own window (node mode only). */
  node: {
    view(): Promise<NodeView>;
    action(request: ControllerRequest): Promise<ControllerReply>;
    onChanged(listener: (view: NodeView) => void): () => void;
    pair(address: string, code: string): Promise<NodeViewResult>;
    unpair(): Promise<NodeViewResult>;
    useAsMain(): Promise<{ ok: boolean }>;
    identify(): Promise<{ shown: number }>;
    /** Matching Main's version (Session 14): look for it, download it, quit to install it, or show the file. */
    updateCheck(): Promise<NodeViewResult>;
    updateDownload(): Promise<NodeViewResult>;
    updateInstall(): Promise<NodeViewResult>;
    updateShowFile(): Promise<null>;
  };
  /** Announcements sent from phones: the operator's queue (operator window only; changes in Pro Mode only). */
  announcements: {
    list(): Promise<AnnouncementsView>;
    onChanged(listener: (view: AnnouncementsView) => void): () => void;
    edit(edit: { id: string; text: string; minutes: number }): Promise<AnnouncementResult>;
    approve(approval: {
      id: string;
      as: 'message' | 'ticker';
      templateId?: string | null;
    }): Promise<AnnouncementResult>;
    reject(which: { id: string }): Promise<AnnouncementResult>;
    takeOff(which: { id: string }): Promise<AnnouncementResult>;
  };
  /** The setup wizard (operator window only; never in Simple Mode). */
  setup: {
    state(): Promise<SetupState>;
    setSeen(): Promise<null>;
    /** The first start's welcome was answered: it never comes again for this library. */
    welcomeSeen(): Promise<null>;
    identifyDisplays(): Promise<{ shown: number }>;
    testTone(device: AudioDevice | null): Promise<{ ok: boolean }>;
    finish(plan: SetupPlan, options?: CoverOptions): Promise<SetupResult>;
    /** View > Set Up Screens… was chosen. */
    onOpen(listener: () => void): () => void;
  };
  /** Lower Thirds (Session 44): changing them is the operator window's, in Pro Mode. */
  /** The wallpapers (Session 55, Part 6, shared/wallpapers.ts). */
  wallpapers: {
    view(): Promise<WallpapersView>;
    onChanged(listener: (view: WallpapersView) => void): () => void;
    /** Files offered (a drop, Import…): the pictures, and the rest with why each is not one. */
    sortFiles(paths: string[]): Promise<WallpaperFiles>;
    /** The system's dialog for pictures; the paths chosen (none when cancelled). */
    pickFiles(): Promise<string[]>;
    /** Pictures in the library as wallpapers, one each, or into one (`into`). */
    add(mediaIds: string[], into: string | null): Promise<WallpaperResult>;
    rename(id: string, name: string): Promise<WallpaperResult>;
    setPictures(id: string, mediaIds: string[]): Promise<WallpaperResult>;
    setTiming(id: string, timing: { secondsEach: number; fadeMs: number }): Promise<WallpaperResult>;
    /** Delete one (Undo brings it back, until Drashti next starts). */
    remove(id: string): Promise<WallpaperResult>;
    restore(id: string): Promise<WallpaperResult>;
    /** Choose one, or none (null). */
    choose(id: string | null): Promise<WallpaperResult>;
    /** A quote of the idle rotation's, drawn as a picture (PNG), into its wallpaper. */
    quotePicture(into: string, quoteId: string, png: Uint8Array): Promise<WallpaperResult>;
  };
  /**
   * The slide editor's window (Session 55, Part 17a): opened by the operator window on a presentation's slides; the
   * editor told which to open while it is open, and asked before closing with changes not saved; the operator window
   * told of a save there (for its Undo).
   */
  slideEditor: {
    open(
      presentationId: string,
      slideId: string | null,
    ): Promise<{ ok: true } | { ok: false; message: string }>;
    onEdit(listener: (open: EditSlidesOpen) => void): () => void;
    onSourcePrepared(listener: (update: EditSourceUpdate) => void): () => void;
    dirty(dirty: boolean): Promise<null>;
    close(): Promise<null>;
    onAskClose(listener: () => void): () => void;
    onSaved(listener: (saved: SlidesSaved) => void): () => void;
    /** What the editor copied, kept for the next editor window, and what is kept. */
    copy(copied: CopiedElements): Promise<null>;
    copied(): Promise<CopiedElements | null>;
    /** A picture chosen in the editor's file dialog (null) or dropped from the desktop. */
    addPicture(presentationId: string, path: string | null): Promise<SlidePictureResult>;
    fontFamilies(): Promise<readonly string[]>;
    /** One of the show's F-keys (Clear all F1, Oops F9, Wallpaper F12...): the operator window acts on it. */
    showKey(key: string): Promise<null>;
    /**
     * Make a slide… (alpha.21): a PDF page as the editor has it now, or a part of it, drawn from the page at the hall's
     * picture size and kept as a one-slide presentation, in the open playlist or the library only (Pro Mode).
     */
    makeSlide(request: MakeSlideRequest): Promise<MakeSlideResult>;
    /** Where Make a slide… can put the slide: the operator window's open playlist, or none. */
    slidePlace(): Promise<SlidePlace>;
    /** The operator window: a slide was made in the editor's window (one change for its Undo). */
    onSlideMade(listener: (made: SlideMade) => void): () => void;
    /** Prepare translations (alpha.22): whether the offline engine can draft this direction here. */
    translationStatus(from: TranslationLanguage, to: TranslationLanguage): Promise<TranslationEngineStatus>;
    /** One text box's draft (Pro Mode, off air): a named reader checks it before it can show. */
    translationDraft(request: TranslationDraftRequest): Promise<TranslationDraftResult>;
    /** Stop Prepare translations. */
    translationCancel(): Promise<boolean>;
    /**
     * The stream's state, read only (x85's Extract, Replace, Split and Hand-out wait while it is on air or recording):
     * the editor's narrower bridge (ARCH-7) has none of the stream's controls.
     */
    streamStatus(): Promise<StreamStatus>;
    onStreamChanged(listener: (status: StreamStatus) => void): () => void;
  };
  lowerThirds: {
    list(): Promise<LowerThird[]>;
    onChanged(listener: (lowerThirds: LowerThird[]) => void): () => void;
    /** Make one (no id) or change one. */
    save(id: string | null, input: LowerThirdInput): Promise<LowerThirdResult>;
    /** Delete these (Undo brings them back, until Drashti next starts). */
    remove(ids: string[]): Promise<LowerThirdsResult>;
    restore(ids: string[]): Promise<LowerThirdsResult>;
    /** The Lower Thirds studio (Session 55, Part 16): open it (the operator window), on one or a new one. */
    studio(open: StudioOpen): Promise<LowerThirdDone>;
    /** Show one as the library has it, or hide the one up (the operator window or the studio). */
    show(id: string): Promise<LowerThirdDone>;
    hide(): Promise<LowerThirdDone>;
    /** The studio, told which to open while it is open. */
    onEdit(listener: (open: NonNullable<StudioOpen>) => void): () => void;
    /** The studio says whether it has changes not saved; asked to close with some, it asks first, then closes. */
    dirty(dirty: boolean): Promise<null>;
    close(): Promise<null>;
    onAskClose(listener: () => void): () => void;
    /** The studio shows Live behind its preview (true) or another backdrop (alpha.22): stills only while it does. */
    watchLive(on: boolean): Promise<null>;
    /** Live's still, about once a second while it is watched (null: nothing on this computer to take it from). */
    onLive(listener: (picture: StudioLivePicture | null) => void): () => void;
  };
  /** OSC: explicitly allowed local UDP senders, independent of Phones. */
  osc: {
    status(): Promise<OscStatus>;
    configure(settings: OscSettings): Promise<OscResult>;
    onChanged(listener: (status: OscStatus) => void): () => void;
  };
  /** The MIDI controller: which device, and what its notes and controllers do. */
  midi: {
    get(): Promise<MidiSettings>;
    set(settings: MidiSettings): Promise<MidiResult>;
    /** The devices this window sees (Session 54: a phone chooses among them). */
    report(seen: MidiSeen): Promise<null>;
    /** A phone asks this window to listen, or to learn the next press for an action (Session 54). */
    onAsk(listener: (ask: MidiAsk) => void): () => void;
    /** The settings changed from a phone (Session 54). */
    onChanged(listener: (settings: MidiSettings) => void): () => void;
  };
  /** Shastra texts (Session 12): references, search and browsing; a text's theme and removing it (Pro Mode). */
  shastra: {
    list(): Promise<ShastraTextInfo[]>;
    tree(textId: string): Promise<ShastraTree | null>;
    /** "SD 14", "Vach G.Pr. 1", "SD 14-16": the passage, or why it names nothing. */
    resolve(reference: string): Promise<PassageResult>;
    search(query: string): Promise<ShastraHit[]>;
    passage(passageId: string): Promise<PassageInfo | null>;
    itemPassage(itemId: string): Promise<PassageInfo | null>;
    remove(textId: string): Promise<ShastraResult>;
  };
  /** Samvat and tithi: the calendars loaded (through Import), today's entry, removing one (Pro Mode). */
  calendar: {
    view(): Promise<CalendarView>;
    onChanged(listener: (view: CalendarView) => void): () => void;
    remove(calendarId: string): Promise<CalendarResult>;
  };
  /** Stage layouts made in Drashti: boxes on the stage canvas (changing them: operator window, Pro Mode). */
  stageLayouts: {
    list(): Promise<StageLayout[]>;
    onChanged(listener: (layouts: StageLayout[]) => void): () => void;
    /** Make one (no id) or save one. */
    save(layoutId: string | null, layout: Omit<StageLayout, 'id'>): Promise<StageLayoutResult>;
    /** Removed; the one chosen for the stage screens removed, they show the Standard stage screen. */
    remove(layoutId: string): Promise<StageLayoutResult>;
    /** Its name only (Session 55: Rename…). */
    rename(layoutId: string, name: string): Promise<StageLayoutResult>;
    /** A removed one put back as it was, in its place, chosen again if it was (Session 55: Undo of Delete). */
    restore(layout: StageLayout, at: number, chosen: boolean): Promise<StageLayoutResult>;
    /** The layout every stage screen shows (Session 55), or null for the Standard stage screen. */
    choose(layoutId: string | null): Promise<StageChoiceResult>;
  };
  /** Screen setup (operator window only). */
  screens: {
    get(): Promise<ScreensSnapshot>;
    onChanged(listener: (snapshot: ScreensSnapshot) => void): () => void;
    createGroup(name: string): Promise<ScreensResult>;
    renameGroup(groupId: string, name: string): Promise<ScreensResult>;
    /** Audience screens show the picture; stage screens show the performers' view. */
    setGroupRole(groupId: string, role: ScreenRole): Promise<ScreensResult>;
    /**
     * The languages a group shows of a kirtan's slides in the live Look, in
     * this order; null for all, in each slide's order (looks.setGroup sets them in any Look).
     */
    setGroupLanguages(groupId: string, languages: Lang[] | null): Promise<ScreensResult>;
    deleteGroup(groupId: string): Promise<ScreensResult>;
    /** May answer `confirm: 'covers-operator'`: ask the operator, then repeat with { coverOperator: true }. */
    assignDisplay(groupId: string, displayId: number, options?: CoverOptions): Promise<ScreensResult>;
    updateScreen(screenId: string, patch: ScreenPatch, options?: CoverOptions): Promise<ScreensResult>;
    /**
     * One wide picture (x27): an audience group's two to four screens side by side, each overlapping the next by
     * `overlap` canvas pixels, with ramps over the overlaps; Separate pictures undoes it.
     */
    widePicture(groupId: string, overlap: number): Promise<ScreensResult>;
    separatePictures(groupId: string): Promise<ScreensResult>;
    /** A screen's picture being adjusted, or no longer (x27): a grid over it on its display meanwhile. */
    adjusting(screenId: string, on: boolean): Promise<ScreensResult>;
    /**
     * A display's job in one click (Session 55): the audience picture, the stage, or Not used. May answer
     * `confirm: 'covers-operator'`, as assignDisplay does.
     */
    setJob(displayId: number, job: DisplayJob, options?: CoverOptions): Promise<ScreensResult>;
    /** What the screens did by themselves (Session 55), last said, or null. */
    lastSaid(): Promise<ScreensSaid | null>;
    /** That was closed in the window (or its Change… followed): not said again as the window opens again. */
    saidClosed(id: number): Promise<null>;
    /** The Stage preview window (alpha.22): opened, or brought forward. */
    openStagePreview(): Promise<null>;
    onSaid(listener: (said: ScreensSaid) => void): () => void;
    removeScreen(screenId: string): Promise<ScreensResult>;
    /** Put one of a node's displays into a group (Session 13). */
    assignNodeDisplay(groupId: string, nodeId: string, displayId: number): Promise<ScreensResult>;
    /** Show each screen's name on its output for a few seconds. */
    identify(): Promise<null>;
    /** Turn off any output covering the operator window. */
    uncoverOperator(): Promise<ScreensResult>;
    /** Try a stopped screen on this computer again (Session 26h; Simple Mode too). */
    tryAgain(screenId: string): Promise<{ ok: true } | { ok: false; message: string }>;
    /** Keep these screens? (Session 50): the change waiting for an answer, or null. */
    pending(): Promise<PendingScreens | null>;
    onPending(listener: (pending: PendingScreens | null) => void): () => void;
    /** Keep the change. */
    keep(): Promise<ScreensResult>;
    /** Go back to exactly the screens as they were before it. */
    goBack(): Promise<ScreensResult>;
  };
  /** Audience and Stage (Session 50): this computer's outputs of each kind, off and on. */
  screenSwitches: {
    get(): Promise<ScreenSwitches>;
    onChanged(listener: (switches: ScreenSwitches) => void): () => void;
    /** Audience off closes them (their displays go back to the computer); Stage off shows the audience picture on the stage screens (Session 55); on opens them where they were. */
    turn(which: ScreenSwitch, on: boolean): Promise<ScreenSwitchResult>;
    /**
     * The window's question before one goes off opened, or went (null), Session 51: an output over the controls
     * asks the same. Whether one does.
     */
    asking(which: ScreenSwitch | null): Promise<{ covered: boolean }>;
    /** An output over the controls started or stopped asking too, while the window asks. */
    onCovered(listener: (covered: boolean) => void): () => void;
    /** The answer given on that output, as it had the keyboard: true turns it off, false cancels. */
    onAnswered(listener: (yes: boolean) => void): () => void;
  };
  /** For output windows. */
  output: {
    getContext(): Promise<OutputContext | null>;
    onContext(listener: (context: OutputContext) => void): () => void;
    onIdentify(listener: (who: { name: string; groupName: string; label?: string }) => void): () => void;
    /** How it draws: late frames and the revision it last painted (every few seconds). */
    report(report: OutputReport): Promise<null>;
    /** On a node: a media file's copy has just landed (load it again if it could not be loaded). */
    onMediaReady(listener: (mediaId: string) => void): () => void;
    /** The GPU process stopped and another starts (Sessions 31–36, ROB-5): play again a video that failed. */
    onGpuRestarted(listener: () => void): () => void;
    /** The deck slide's first clip to load ahead for the operator's pointer (C3, Session 58), null for none. */
    getPointed(): Promise<PointedClip | null>;
    onPointed(listener: (clip: PointedClip | null) => void): () => void;
    /** Tests only (a packaged Drashti never sends it): draw an element that throws (Session 23). */
    onTestThrow(listener: () => void): () => void;
    /** Tests only (a packaged Drashti never sends it): the scene fails as it draws while this file is up (x53). */
    onTestThrowWhile(listener: (mediaId: string | null) => void): () => void;
    /** Tests only (a packaged Drashti never sends it): hold the clock at a moment, or let it go (Session 26d). */
    onTestClock(listener: (at: number | null) => void): () => void;
    /** Keep these screens? (Session 50) on this output, when it covers the controls (null: answered). */
    onKeepQuestion(listener: (pending: PendingScreens | null) => void): () => void;
    /** Enter (keep) or Esc (go back) on this output. */
    keepAnswer(keep: boolean): Promise<null>;
    /** The operator window's "Turn … off?" (Session 51) on this output, when it covers the controls (null: gone). */
    onSwitchQuestion(listener: (which: ScreenSwitch | null) => void): () => void;
    /** Enter (turn it off) or Esc (cancel) on this output. */
    switchAnswer(yes: boolean): Promise<null>;
  };
  /** For the hidden window that draws a PDF's pages as pictures (Session 15). */
  pdfExport: {
    capture(id: string, index: number): Promise<Uint8Array | null>;
    job(): Promise<PdfCopyJob | null>;
    print(id: string, index: number): Promise<Uint8Array | null>;
    normalized(id: string, index: number, pages: PdfPrintPage[]): Promise<Uint8Array | null>;
    done(done: PdfCopyFinished): Promise<boolean>;
    asset(kind: PictureAssetKind, name: string): Promise<Uint8Array | null>;
  };
  pictures: {
    job(): Promise<PdfJob | null>;
    /**
     * False: stop (the import was cancelled, or Edit slides' reading ended its job for the show). 'skipped': Main
     * kept that page's saved picture; go on with the next page.
     */
    page(page: PdfPage): Promise<PdfPageReceipt>;
    done(done: PdfDone): Promise<null>;
    asset(kind: PictureAssetKind, name: string): Promise<Uint8Array | null>;
  };
  /** The hidden window that makes pictures' sharpened copies (Session 26f); that window only. */
  displayCopies: {
    next(): Promise<SharpenJobView | null>;
    made(key: string, blob: DisplayCopyBlob | null): Promise<boolean>;
  };
  sharpen: {
    /** The next picture to make a copy of (null: none left). */
    next(): Promise<SharpenJobView | null>;
    /** The copy as made (null: it could not be). False: not this window's to make. */
    made(key: string, bytes: Uint8Array | null): Promise<boolean>;
  };
  /**
   * Access by Gmail (Session 54): the lock screen, the stop and the countdown. Each answers the view as it is
   * after; what came of it is in the view's message.
   */
  access: {
    view(): Promise<AccessView>;
    onChanged(listener: (view: AccessView) => void): () => void;
    request(gmail: string, name: string): Promise<AccessView>;
    status(): Promise<AccessView>;
    redeem(gmail: string, token: string): Promise<AccessView>;
    retry(): Promise<AccessView>;
    quit(): Promise<null>;
  };
  /** Ready? (Session 55, Part 8): the check, with the playlist open in the window (its files are checked). */
  ready: {
    check(openPlaylistId: string | null): Promise<ReadyReport | null>;
  };
  /** The quick bar (Session 55, Part 8): its pins, kept with the library; changed in Pro Mode only. */
  quickBar: {
    view(): Promise<QuickPin[]>;
    /** The whole bar as it should be now: at most 8, each once. */
    set(pins: QuickPin[]): Promise<QuickBarResult>;
    onChanged(listener: (pins: QuickPin[]) => void): () => void;
  };
}
