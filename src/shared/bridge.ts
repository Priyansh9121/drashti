import type { AppearanceView, InterfaceMotion, OwnAppearance } from './appearance/appearances';
import type { LowerThird, LowerThirdInput, LowerThirdResult, LowerThirdsResult } from './lower-thirds';
import type { CalendarResult, CalendarView } from './calendar';
import type { GuideId, GuideRead } from './guides';
import type { IdleResult, IdleSettings, IdleView, QuoteFields, QuoteResult } from './idle';
import type {
  PassageInfo,
  PassageResult,
  ShastraHit,
  ShastraResult,
  ShastraTextInfo,
  ShastraTree,
} from './shastra';
import type { AccessView } from './access';
import type { AppInfo, TaskProgress } from './app-info';
import type { AudioDevice, AudioOutputState, AudioOutputStatus } from './audio';
import type { CommandResult, EngineCommand } from './engine/commands';
import type { EngineMessage, EngineSnapshotMessage } from './engine/protocol';
import type { ImportOptions, ImportProgress, ImportReport, ImportResult, ImportRunSummary } from './import';
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
import type { LinkKind, LinkResult, LinkView, YouTubeChoice } from './links';
import type { UpdateResult, UpdateView } from './updates';
import type { MusicResult, MusicView } from './music';
import type { MediaRemovalResult, MediaUsage } from './media-removal';
import type { MarkersResult, MediaMarkers } from './markers';
import type { PictureAssetKind, PictureJob, PicturePage, PicturesDone, SharpenJobView } from './pictures';
import type { BackupSchedule, BackupsResult, PickFolderResult, ScheduledBackupsView } from './backups';
import type { EventAddressPatch, EventsOutResult, EventsOutView } from './events-out';
import type { DropFolderResult, DropFolderView } from './drop-folder';
import type { Lang, RenderSlide, Transition } from './model';
import type { EditDoc, EditSlidesResult, SaveSlidesResult, ThemeSlide } from './slide-edit';
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
import type { ZoomProgram } from './zoom';
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
import type { SaveStillResult } from './media';
import type { DeviceKind, NetworkResult, NetworkStatus } from './network';
import type { NodesResult, NodesStatus, NodeView, NodeViewResult, ScreenThumb } from './nodes';
import type { AnnouncementResult, AnnouncementsView } from './announcements';
import type {
  ItemOrder,
  MediaSummary,
  NewItem,
  PlaylistItemInfo,
  PlaylistNode,
  PlaylistResult,
  SmartPlaylistView,
  TemplateRequest,
  TimerCue,
} from './playlists';
import type { RepeatSettings } from './repeat';
import type { KeyframeResult, SaveJob, SaveRequest, SaveResult } from './trim';
import type { PictureLook } from './picture-look';
import type { MessageResult, MessageTemplate, MessageTemplateFields } from './messages';
import type { PropFields, PropInfo, PropResult } from './props';
import type { GroupLookPatch, LookResult, LooksView } from './looks';
import type { StageLayout, StageLayoutResult } from './stage-layouts';
import type { Mask, MaskResult } from './masks';
import type { MidiResult, MidiSettings } from './midi';
import type { SearchResult } from './search';
import type { RenderErrorReport } from './render-errors';
import type { ApplyThemeResult, Theme, ThemeFields, ThemeResult } from './themes';
import type { TimerFields, TimerResult } from './timers';
import type {
  CoverOptions,
  OutputContext,
  OutputReport,
  ScreenPatch,
  ScreenRole,
  ScreensResult,
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
    /** Edit > Undo was chosen (operator window). */
    onUndo(listener: () => void): () => void;
    /** Edit > Redo was chosen (operator window). */
    onRedo(listener: () => void): () => void;
    /** Something to tell the operator, from the main process. */
    onNotice(listener: (text: string) => void): () => void;
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
    /** Single-letter keys (Session 37): whether B, ., L and ? act, and turning them on or off (Pro Mode). */
    singleKeys(): Promise<boolean>;
    setSingleKeys(on: boolean): Promise<{ ok: true; on: boolean } | { ok: false; message: string }>;
    onSingleKeysChanged(listener: (on: boolean) => void): () => void;
    /** A long task's progress (a backup), or null when it has ended. */
    onProgress(listener: (progress: TaskProgress | null) => void): () => void;
    /** Simple Mode or Pro Mode. */
    getMode(): Promise<OperatorMode>;
    /** Into Simple Mode at once; back to Pro Mode only with the word typed (operator window only). */
    setMode(mode: OperatorMode, word?: string): Promise<ModeResult>;
    onModeChanged(listener: (mode: OperatorMode) => void): () => void;
    /** View > Switch to Pro Mode… was chosen: ask for the word. */
    onAskLeaveSimple(listener: () => void): () => void;
    /** Help > Keyboard Shortcuts… was chosen (Pro Mode). */
    onShowKeys(listener: () => void): () => void;
    /** Help > Guides… was chosen (Sessions 31–36), in either mode. */
    onShowGuides(listener: () => void): () => void;
  };
  /** The guides inside Drashti (Sessions 31–36): those this mode may read, and a guide's text. */
  guides: {
    list(): Promise<{ id: GuideId; tab: string }[]>;
    read(id: GuideId): Promise<GuideRead>;
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
    look(kind: LinkKind, link: string): Promise<LinkResult>;
    pickFolder(): Promise<LinkResult>;
    /** Download what was looked at: a YouTube video with its type, quality and the permission tick. */
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
    /** Undo a change to a presentation's content: write back the copy kept before it. */
    restoreRevision(revisionId: string): Promise<RevisionResult>;
    /** Presentations with slide text in legacy fonts, which search cannot read yet. */
    legacyPresentations(): Promise<{ id: string; name: string }[]>;
    getPresentation(id: string): Promise<PresentationDoc | null>;
    /** A presentation's slides, everything on them, and how new text looks, for the slide editor. */
    slidesForEdit(presentationId: string): Promise<EditSlidesResult>;
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
    /** View › Show Shastra, Templates and Kirtan Details (Session 26a): off to begin with. */
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
  };
  /** Kirtans: words by language and details; changing them is for the operator window only. */
  kirtans: {
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
    /** The operator opened it: it counts as this week's for output nodes (Session 14). */
    opened(playlistId: string): Promise<null>;
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
    /** Take a smart playlist's missing items out (their files are gone from its folder). */
    removeMissing(playlistId: string): Promise<PlaylistResult>;
    /** A new Repeat Slides playlist (Session 26d) in a folder or at the top level, and its settings. */
    createRepeat(parentId: string | null): Promise<PlaylistResult>;
    setRepeat(playlistId: string, settings: RepeatSettings): Promise<PlaylistResult>;
    onChanged(listener: () => void): () => void;
    onSmartChanged(listener: (views: SmartPlaylistView[]) => void): () => void;
  };
  /** Props: a logo or a fixed line over whatever slide is live. Showing one goes through the engine. */
  props: {
    list(): Promise<PropInfo[]>;
    /** Make a prop (no id) or change one. */
    save(propId: string | null, fields: PropFields): Promise<PropResult>;
    remove(propId: string): Promise<PropResult>;
    /** The prop marked as the logo, or null. */
    getLogo(): Promise<string | null>;
    /** Mark a prop as the logo (null: none) (operator window, Pro Mode). */
    setLogo(propId: string | null): Promise<PropResult>;
  };
  /** Themes: how presentations' words look, per language, and what is behind them. */
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
    /** View › Appearance… was chosen. */
    onOpen(listener: () => void): () => void;
    /** The appearance or the motion changed (every window draws it by itself; the Appearance window shows it). */
    onChanged(listener: () => void): () => void;
  };
  themes: {
    list(): Promise<{ themes: Theme[]; defaultId: string }>;
    /** Make a theme (no id) or change one. */
    save(themeId: string | null, fields: ThemeFields): Promise<ThemeResult>;
    /** Remove a theme; the default one stays. */
    remove(themeId: string): Promise<ThemeResult>;
    /** Make a theme the default: presentations made in Drashti start with it. */
    setDefault(themeId: string): Promise<ThemeResult>;
    /** Apply a theme to presentations: their styles change, never their words; one Undo brings them back. */
    apply(themeId: string, presentationIds: string[]): Promise<ApplyThemeResult>;
    /** A theme from a presentation's first text box (an imported template). */
    fromPresentation(presentationId: string): Promise<ThemeResult>;
    /** A theme from a slide in the slide editor, as it is there (saved or not). */
    fromSlide(name: string, slide: ThemeSlide): Promise<ThemeResult>;
  };
  /** Message templates ("Car {plate} please move"). Showing one goes through the engine. */
  messages: {
    list(): Promise<MessageTemplate[]>;
    create(template: MessageTemplateFields): Promise<MessageResult>;
    update(templateId: string, template: MessageTemplateFields): Promise<MessageResult>;
    remove(templateId: string): Promise<MessageResult>;
  };
  /** Making and editing timers (operator window only). Starting and pausing go through the engine. */
  timers: {
    create(fields: TimerFields): Promise<TimerResult>;
    update(timerId: string, fields: TimerFields): Promise<TimerResult>;
    remove(timerId: string): Promise<TimerResult>;
  };
  media: {
    /**
     * Keep a still frame (a JPEG drawn from the file) for a media item's
     * thumbnails, so it is made only once (operator window only).
     */
    saveStill(mediaId: string, jpeg: Uint8Array): Promise<SaveStillResult>;
    /** Convert files Drashti cannot play (in turn, in the background). */
    convert(mediaIds: string[]): Promise<ConvertResult>;
    /** Cancel one conversion, or every one not finished (null). */
    cancelConversion(jobId: string | null): Promise<ConvertResult>;
    conversions(): Promise<ConversionJob[]>;
    onConversions(listener: (jobs: ConversionJob[]) => void): () => void;
    /** Undo a conversion: the original is used again wherever it was moved from. */
    undoConversion(conversionId: string): Promise<{ ok: true } | { ok: false; message: string }>;
    /** Save as MP4… (Session 26e): where a part saved from `startMs` begins (its keyframe). */
    keyframe(mediaId: string, startMs: number): Promise<KeyframeResult>;
    /** Save the part as an MP4 where the operator chooses (a save dialog), in the background. */
    saveTrim(request: SaveRequest): Promise<SaveResult>;
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
    onLooks(listener: (looks: Record<string, PictureLook>) => void): () => void;
    /** Where media is used, asked before deleting it (Session 26a). */
    usage(mediaIds: string[]): Promise<MediaUsage>;
    /** Delete media from the library, taking it out of playlists and music; Undo with restore. */
    remove(mediaIds: string[]): Promise<MediaRemovalResult>;
    restore(mediaIds: string[]): Promise<MediaRemovalResult>;
    /** A video's or sound's start and end points and markers (Session 14); setting them is the operator's. */
    markers(mediaId: string): Promise<MediaMarkers>;
    setMarkers(mediaId: string, markers: MediaMarkers): Promise<MarkersResult>;
    /** How long a file is, learned as it played (outputs and the audio player only). */
    reportLength(mediaId: string, durationMs: number): Promise<null>;
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
    stopRecording(): Promise<StreamResult>;
    pickFolder(): Promise<StreamResult>;
    /** Let the offer to go live again after a crash go. */
    dismissResume(): Promise<null>;
    /** Try the stream's page again, stopped after crashing too often (Session 31). */
    tryAgain(): Promise<StreamResult>;
    /** The stream's own page. */
    page: {
      context(): Promise<ProgramContext | null>;
      onContext(listener: (context: ProgramContext) => void): () => void;
      reportInputs(inputs: ProgramInputs): Promise<null>;
    };
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
  /**
   * Looks: what each screen group shows, one live at a time (changing them:
   * operator window, Pro Mode). Switching the live Look is the engine's
   * setLook command.
   */
  looks: {
    list(): Promise<LooksView>;
    onChanged(listener: (view: LooksView) => void): () => void;
    /** A new Look at the end of the list, a copy of `copyOf` (or every group with the defaults). */
    create(name: string, copyOf: string | null): Promise<LookResult>;
    rename(lookId: string, name: string): Promise<LookResult>;
    /** Not the last one. Removing the live Look puts the first one live. */
    remove(lookId: string): Promise<LookResult>;
    /** To this place in the list (0: first, the Look Drashti starts with). */
    move(lookId: string, to: number): Promise<LookResult>;
    /** Change one group's settings in a Look. */
    setGroup(lookId: string, groupId: string, patch: GroupLookPatch): Promise<LookResult>;
  };
  /** Lower Thirds (Session 44): changing them is the operator window's, in Pro Mode. */
  lowerThirds: {
    list(): Promise<LowerThird[]>;
    onChanged(listener: (lowerThirds: LowerThird[]) => void): () => void;
    /** Make one (no id) or change one. */
    save(id: string | null, input: LowerThirdInput): Promise<LowerThirdResult>;
    /** Delete these (Undo brings them back, until Drashti next starts). */
    remove(ids: string[]): Promise<LowerThirdsResult>;
    restore(ids: string[]): Promise<LowerThirdsResult>;
  };
  /** The MIDI controller: which device, and what its notes and controllers do. */
  midi: {
    get(): Promise<MidiSettings>;
    set(settings: MidiSettings): Promise<MidiResult>;
  };
  /** The mask library (changing it: operator window, Pro Mode). A mask goes up with the engine's setMask. */
  masks: {
    list(): Promise<Mask[]>;
    onChanged(listener: (masks: Mask[]) => void): () => void;
    /** Make one (no id) or save one. */
    save(maskId: string | null, mask: Omit<Mask, 'id'>): Promise<MaskResult>;
    /** It comes off the Masks layer and out of every Look. */
    remove(maskId: string): Promise<MaskResult>;
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
    setTheme(textId: string, themeId: string | null): Promise<ShastraResult>;
    remove(textId: string): Promise<ShastraResult>;
  };
  /** The idle rotation's pictures, timing and quotes (changing them: operator window, Pro Mode). */
  idle: {
    view(): Promise<IdleView>;
    onChanged(listener: (view: IdleView) => void): () => void;
    saveSettings(settings: IdleSettings): Promise<IdleResult>;
    /** Make one (no id) or save one. */
    saveQuote(quoteId: string | null, quote: QuoteFields): Promise<QuoteResult>;
    removeQuote(quoteId: string): Promise<IdleResult>;
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
    /** Groups whose Looks used it show the Standard stage screen. */
    remove(layoutId: string): Promise<StageLayoutResult>;
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
    /** Off closes them (their displays go back to the computer); on opens them where they were. */
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
    /** Tests only (a packaged Drashti never sends it): draw an element that throws (Session 23). */
    onTestThrow(listener: () => void): () => void;
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
  pictures: {
    job(): Promise<PictureJob | null>;
    /** False: stop (the import was cancelled). */
    page(page: PicturePage): Promise<boolean>;
    done(done: PicturesDone): Promise<null>;
    asset(kind: PictureAssetKind, name: string): Promise<Uint8Array | null>;
  };
  /** The hidden window that makes pictures' sharpened copies (Session 26f); that window only. */
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
}
