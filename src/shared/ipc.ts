import type { ArtiAnswer, ArtiFields, ArtiResult, ArtiView } from './arti';
import type { RolesResult, RolesView } from './roles';
import type { BackupSchedule, BackupsResult, PickFolderResult, ScheduledBackupsView } from './backups';
import type { UpdateResult, UpdateView } from './updates';
import type { MusicResult, MusicView } from './music';
import type { MarkersResult, MediaMarkers } from './markers';
import type { CalendarResult, CalendarView } from './calendar';
import type { IdleResult, IdleSettings, IdleView, QuoteFields, QuoteResult } from './idle';
import type {
  PassageInfo,
  PassageResult,
  ShastraHit,
  ShastraResult,
  ShastraTextInfo,
  ShastraTree,
} from './shastra';
import type { AppInfo, TaskProgress } from './app-info';
import type { AudioDevice, AudioOutputState, AudioOutputStatus } from './audio';
import type { CommandResult, EngineCommand } from './engine/commands';
import type { EngineMessage, EngineSnapshotMessage } from './engine/protocol';
import type { ImportOptions, ImportProgress, ImportReport, ImportResult, ImportRunSummary } from './import';
import type {
  LibraryChange,
  NewFromWordsResult,
  PresentationDoc,
  PresentationListing,
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
import type { Lang, Transition } from './model';
import type { EditDoc, EditSlidesResult, SaveSlidesResult, ThemeSlide } from './slide-edit';
import type { RecoveryNotice } from './recovery';
import type { SetupPlan, SetupResult, SetupState } from './setup';
import type { ConversionJob, ConvertResult } from './convert';
import type {
  ProgramContext,
  ProgramInputs,
  StreamLayout,
  StreamProfileInput,
  StreamProfiles,
  StreamProfilesResult,
  StreamResult,
  StreamStatus,
} from './stream';
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
  TemplateRequest,
  TimerCue,
} from './playlists';
import type { MessageResult, MessageTemplate, MessageTemplateFields } from './messages';
import type { PropFields, PropInfo, PropResult } from './props';
import type { GroupLookPatch, LookResult, LooksView } from './looks';
import type { StageLayout, StageLayoutResult } from './stage-layouts';
import type { Mask, MaskResult } from './masks';
import type { Macro, MacroCountdownView, MacroInput, MacroResult, MacroRunResult } from './macros';
import type { MidiResult, MidiSettings } from './midi';
import type { SearchResult } from './search';
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
 * IPC channel names. This is the only place channel strings are written;
 * the preload script and the main process both import them from here.
 */
export const IPC = {
  app: {
    getInfo: 'app:get-info',
    /** main -> operator: Edit > Undo was chosen (the page decides what to undo). */
    undo: 'app:undo',
    /** main -> operator: Edit > Redo was chosen (the slide editor redoes, unless typing). */
    redo: 'app:redo',
    /** main -> operator: something to tell the operator (for example where diagnostics were saved). */
    notice: 'app:notice',
    /** What was put back on the screens after an unexpected stop, or null. */
    recovery: 'app:recovery',
    /** The operator has read the recovery notice. */
    dismissRecovery: 'app:dismiss-recovery',
    /** Something to tell the operator as the page opens (how a restore went), once. */
    startNotice: 'app:start-notice',
    /** main -> operator: a long task's progress, or null when it has ended. */
    progress: 'app:progress',
    /** Simple Mode or Pro Mode. */
    getMode: 'app:get-mode',
    /** Switch: into Simple Mode at once; out of it only with the word typed (operator window only). */
    setMode: 'app:set-mode',
    /** main -> operator: the mode changed. */
    modeChanged: 'app:mode-changed',
    /** main -> operator: View > Switch to Pro Mode… was chosen; ask for the word. */
    askLeaveSimple: 'app:ask-leave-simple',
  },
  /**
   * Roles (Session 14, shared/roles.ts): an admin PIN and an operator PIN.
   * Setting, changing and removing them are admin requests (with roles on).
   */
  roles: {
    view: 'roles:view',
    /** Whether an admin request would be refused now (roles on, admin locked). */
    needsAdmin: 'roles:needs-admin',
    /** The admin PIN: admin unlocked for a while. */
    unlock: 'roles:unlock',
    /** Lock admin now. */
    lock: 'roles:lock',
    setPins: 'roles:set-pins',
    changePin: 'roles:change-pin',
    turnOff: 'roles:turn-off',
    /** The operator closed the PIN prompt a menu item opened: that item is not done. */
    cancelAsk: 'roles:cancel-ask',
    /** main -> operator: the roles changed (on or off, admin unlocked or locked). */
    changed: 'roles:changed',
    /** main -> operator: a menu item needs the admin PIN; ask for it. */
    askAdmin: 'roles:ask-admin',
    /** main -> operator: File > Roles and PINs… was chosen. */
    open: 'roles:open',
  },
  /** Scheduled backups (Session 14, shared/backups.ts): changing them, and Back up now, are an admin's. */
  backups: {
    view: 'backups:view',
    save: 'backups:save',
    /** Choose the folder (a USB drive or another disk); not kept until saved. */
    pickFolder: 'backups:pick-folder',
    runNow: 'backups:run-now',
    /** The status bar's warning about a skipped or stopped backup has been read. */
    dismiss: 'backups:dismiss',
    /** main -> operator: the schedule or how backups stand changed. */
    changed: 'backups:changed',
    /** main -> operator: File > Scheduled Backups… was chosen. */
    open: 'backups:open',
  },
  /**
   * Updates (Session 14, shared/updates.ts): looking is anyone's in Pro Mode;
   * downloading, installing at quit and the daily look are an admin's.
   * Simple Mode never sees any of it.
   */
  updates: {
    view: 'updates:view',
    check: 'updates:check',
    download: 'updates:download',
    cancel: 'updates:cancel',
    setInstallOnQuit: 'updates:set-install-on-quit',
    setAutoCheck: 'updates:set-auto-check',
    /** Show the downloaded file (to install it by hand on an unsigned Mac). */
    showFile: 'updates:show-file',
    /** main -> operator: how the update stands changed. */
    changed: 'updates:changed',
    /** main -> operator: Help > Check for Updates… was chosen. */
    open: 'updates:open',
  },
  /**
   * Audio playlists (Session 14, shared/music.ts): changing them is the
   * operator's (Simple Mode refuses); playing one starts it in the engine,
   * whose own commands pause it and move through it.
   */
  music: {
    view: 'music:view',
    create: 'music:create',
    rename: 'music:rename',
    remove: 'music:remove',
    setOptions: 'music:set-options',
    addTracks: 'music:add-tracks',
    moveTrack: 'music:move-track',
    removeTrack: 'music:remove-track',
    /** Play a playlist from a track; with none, the one paused plays on or the last one starts (either mode). */
    play: 'music:play',
    /** main -> operator: the audio playlists changed. */
    changed: 'music:changed',
  },
  engine: {
    /** Start receiving engine messages in this window; returns a snapshot. */
    subscribe: 'engine:subscribe',
    /** A fresh snapshot, for resyncing after a missed revision. */
    snapshot: 'engine:snapshot',
    /** Ask the engine to do something (operator window only). */
    command: 'engine:command',
    /** main -> renderer: an EngineMessage (snapshot or patch). */
    message: 'engine:message',
  },
  library: {
    listPresentations: 'library:list-presentations',
    listMedia: 'library:list-media',
    search: 'library:search',
    words: 'library:words',
    /** The rest change presentations (operator window only). */
    saveWords: 'library:save-words',
    newFromWords: 'library:new-from-words',
    restoreRevision: 'library:restore-revision',
    legacyPresentations: 'library:legacy-presentations',
    getPresentation: 'library:get-presentation',
    /** A presentation's slides for the slide editor, and saving them (operator window only). */
    slidesForEdit: 'library:slides-for-edit',
    saveSlides: 'library:save-slides',
    /** The transition for presentations without their own; changing it is for the operator window only. */
    getDefaultTransition: 'library:get-default-transition',
    setDefaultTransition: 'library:set-default-transition',
    /** Import files and folders (operator window only). */
    importPaths: 'library:import-paths',
    cancelImport: 'library:cancel-import',
    listImportRuns: 'library:list-import-runs',
    getImportReport: 'library:get-import-report',
    /** Show a file dialog for files or a folder to import; returns the chosen paths. */
    pickImportPaths: 'library:pick-import-paths',
    /** Ask for a folder, then look there for missing media. */
    relinkMedia: 'library:relink-media',
    /** Choose the order a presentation plays in (operator window only). */
    setArrangement: 'library:set-arrangement',
    removePresentations: 'library:remove-presentations',
    restorePresentations: 'library:restore-presentations',
    /** main -> operator: how an import is going. */
    importProgress: 'library:import-progress',
    /** main -> operator: presentations, props, messages or themes were added or changed. */
    changed: 'library:changed',
  },
  /** Kirtans: their words by language and their details; changing them is for the operator window only. */
  kirtans: {
    tracks: 'kirtans:tracks',
    saveTracks: 'kirtans:save-tracks',
    /** Make a presentation a kirtan with these details, or (null) not a kirtan; its words stay. */
    setDetails: 'kirtans:set-details',
    /** Fill a kirtan's transliteration track from its Gujarati (or Hindi) lines. */
    makeTransliteration: 'kirtans:make-transliteration',
    /** Plain or with accent marks: the app's choice for making transliteration. */
    getTranslitStyle: 'kirtans:get-translit-style',
    setTranslitStyle: 'kirtans:set-translit-style',
    /** The categories a kirtan can have: Drashti's, and any added. */
    categories: 'kirtans:categories',
    addCategory: 'kirtans:add-category',
  },
  media: {
    /** Keep a still frame the operator window made (operator window only). */
    saveStill: 'media:save-still',
    /** Convert media Drashti cannot play, one after another (operator window only). */
    convert: 'media:convert',
    cancelConversion: 'media:cancel-conversion',
    conversions: 'media:conversions',
    /** Put back the original everywhere the conversion moved it (Undo). */
    undoConversion: 'media:undo-conversion',
    /** main -> operator: the conversions changed. */
    conversionsChanged: 'media:conversions-changed',
    /** An output or the audio player learned how long a file is, as it played it (stage screens show the time left). */
    reportLength: 'media:report-length',
    /** A video's or sound's start and end points and markers (Session 14); setting them is the operator's. */
    markers: 'media:markers',
    setMarkers: 'media:set-markers',
  },
  audio: {
    /** The sound output: the operator's choice, the outputs found, and where sound plays. */
    getOutput: 'audio:get-output',
    /** Choose the sound output, null for the system default (operator window only). */
    setOutput: 'audio:set-output',
    /** The audio player tells what outputs it sees and where it plays (audio player only). */
    reportDevices: 'audio:report-devices',
    /** main -> audio player: the operator chose another output. */
    chosen: 'audio:chosen',
    /** main -> audio player: play a short test tone on this output ('' for the system default). */
    testTone: 'audio:test-tone',
    /** main -> operator: the sound output status changed. */
    status: 'audio:status',
  },
  playlists: {
    tree: 'playlists:tree',
    items: 'playlists:items',
    /** The operator opened a playlist: it counts as this week's for output nodes (Session 14). */
    opened: 'playlists:opened',
    /** The rest change playlists (operator window only). */
    create: 'playlists:create',
    rename: 'playlists:rename',
    remove: 'playlists:remove',
    restore: 'playlists:restore',
    addItems: 'playlists:add-items',
    moveItems: 'playlists:move-items',
    removeItems: 'playlists:remove-items',
    restoreItems: 'playlists:restore-items',
    fillPlaceholder: 'playlists:fill-placeholder',
    setItemOrder: 'playlists:set-item-order',
    renameHeader: 'playlists:rename-header',
    /** Sabha templates: kept apart from the playlists, never run themselves. */
    templates: 'playlists:templates',
    saveAsTemplate: 'playlists:save-as-template',
    newFromTemplate: 'playlists:new-from-template',
    /** A slot: a place for a presentation, filled each time (a placeholder with a category). */
    addSlot: 'playlists:add-slot',
    /** A slot's name and category (Session 12). */
    editSlot: 'playlists:edit-slot',
    /** What an item does to timers when it goes up (Session 12). */
    setTimers: 'playlists:set-timers',
    /** main -> operator: playlists changed. */
    changed: 'playlists:changed',
  },
  /** Props; changing them is for the operator window only (showing one goes through the engine). */
  props: {
    list: 'props:list',
    save: 'props:save',
    remove: 'props:remove',
    /** The prop marked as the logo (Simple Mode's Logo button), or null. */
    getLogo: 'props:get-logo',
    setLogo: 'props:set-logo',
  },
  /** Themes; changing and applying them is for the operator window only. */
  themes: {
    list: 'themes:list',
    save: 'themes:save',
    remove: 'themes:remove',
    apply: 'themes:apply',
    fromPresentation: 'themes:from-presentation',
    /** A theme from a slide in the slide editor (its first text box, its colour and background). */
    fromSlide: 'themes:from-slide',
  },
  /** Message templates; changing them is for the operator window only. */
  messages: {
    list: 'messages:list',
    create: 'messages:create',
    update: 'messages:update',
    remove: 'messages:remove',
  },
  /** Changing timers (operator window only); what they count comes with the engine state. */
  timers: {
    create: 'timers:create',
    update: 'timers:update',
    remove: 'timers:remove',
  },
  /** Looks: what each screen group shows. Changing them is for the operator window, Pro Mode (switching the live one is an engine command). */
  looks: {
    list: 'looks:list',
    create: 'looks:create',
    rename: 'looks:rename',
    remove: 'looks:remove',
    move: 'looks:move',
    setGroup: 'looks:set-group',
    /** main -> operator: the Looks changed (or which is live). */
    changed: 'looks:changed',
  },
  /** Macros (changing and running them: operator window, Pro Mode). */
  macros: {
    list: 'macros:list',
    save: 'macros:save',
    remove: 'macros:remove',
    run: 'macros:run',
    /** main -> operator: the macros changed. */
    changed: 'macros:changed',
    /** Macros counting down to run by themselves at their time (Session 14), in either mode. */
    countdown: 'macros:countdown',
    /** Cancel one counting down: it does not run this time (either mode). */
    cancelScheduled: 'macros:cancel-scheduled',
    /** main -> operator: what is counting down changed. */
    countdownChanged: 'macros:countdown-changed',
  },
  /** The MIDI controller's settings (changing them: operator window, Pro Mode). */
  midi: {
    get: 'midi:get',
    set: 'midi:set',
  },
  /** The mask library (changing it: operator window, Pro Mode; putting one up is the engine's setMask). */
  masks: {
    list: 'masks:list',
    save: 'masks:save',
    remove: 'masks:remove',
    /** main -> operator: the masks changed. */
    changed: 'masks:changed',
  },
  /** Shastra texts (Session 12): finding passages; choosing a text's theme or removing it is Pro Mode only. */
  shastra: {
    list: 'shastra:list',
    tree: 'shastra:tree',
    resolve: 'shastra:resolve',
    search: 'shastra:search',
    passage: 'shastra:passage',
    itemPassage: 'shastra:item-passage',
    setTheme: 'shastra:set-theme',
    remove: 'shastra:remove',
  },
  /** The arti at its time (Session 12): schedules (Pro Mode), and answering the prompt (either mode). */
  arti: {
    view: 'arti:view',
    save: 'arti:save',
    setEnabled: 'arti:set-enabled',
    remove: 'arti:remove',
    putUp: 'arti:put-up',
    notNow: 'arti:not-now',
    cancel: 'arti:cancel',
    /** main -> operator: the schedules or the prompt changed. */
    changed: 'arti:changed',
  },
  /** The idle rotation (Session 12): its pictures, timing and quotes (Pro Mode); starting it is an engine command. */
  idle: {
    view: 'idle:view',
    saveSettings: 'idle:save-settings',
    saveQuote: 'idle:save-quote',
    removeQuote: 'idle:remove-quote',
    /** main -> operator: the settings, the quotes or the quote of the day changed. */
    changed: 'idle:changed',
  },
  /** Samvat and tithi (Session 12): the loaded calendars and today's entry; removing one is Pro Mode only. */
  calendar: {
    view: 'calendar:view',
    remove: 'calendar:remove',
    /** main -> operator: the calendars or today's entry changed. */
    changed: 'calendar:changed',
  },
  /** Stage layouts made in Drashti (changing them: operator window, Pro Mode). */
  stageLayouts: {
    list: 'stage:layouts',
    save: 'stage:save-layout',
    remove: 'stage:remove-layout',
    /** main -> operator: the layouts changed. */
    changed: 'stage:layouts-changed',
  },
  screens: {
    get: 'screens:get',
    createGroup: 'screens:create-group',
    renameGroup: 'screens:rename-group',
    setGroupRole: 'screens:set-group-role',
    /** The languages a group shows of a kirtan's slides, in order (null: all). */
    setGroupLanguages: 'screens:set-group-languages',
    deleteGroup: 'screens:delete-group',
    assignDisplay: 'screens:assign-display',
    updateScreen: 'screens:update-screen',
    removeScreen: 'screens:remove-screen',
    /** Put a node's display into a group (Session 13). */
    assignNodeDisplay: 'screens:assign-node-display',
    identify: 'screens:identify',
    uncoverOperator: 'screens:uncover-operator',
    /** main -> operator: the screen setup or display list changed. */
    changed: 'screens:changed',
  },
  /** The setup wizard (operator window only; never in Simple Mode). */
  setup: {
    state: 'setup:state',
    /** It was shown (finished or closed): it does not open by itself again. */
    setSeen: 'setup:set-seen',
    /** Each connected display's number across it, for a few seconds (not the operator's display). */
    identifyDisplays: 'setup:identify-displays',
    /** A short tone on a sound output (null: the system default), through the audio player. */
    testTone: 'setup:test-tone',
    /** Apply the plan: outputs, languages, sound and theme, then a test slide on every screen. */
    finish: 'setup:finish',
    /** main -> operator: View > Set Up Screens… was chosen. */
    open: 'setup:open',
  },
  /** Built-in streaming (PLAN.md 4.2). */
  stream: {
    /** The stream's state: on air, recording, health, inputs. */
    status: 'stream:status',
    /** Camera or Slides, also while live (operator window only). */
    setLayout: 'stream:set-layout',
    /** The operator window watches the Program's preview (or stops); its port comes on `port`. */
    watchPreview: 'stream:watch-preview',
    profiles: 'stream:profiles',
    saveProfile: 'stream:save-profile',
    removeProfile: 'stream:remove-profile',
    useProfile: 'stream:use-profile',
    /** Keep a profile's key (never sent back to any window). */
    setKey: 'stream:set-key',
    removeKey: 'stream:remove-key',
    /** Public: the window must say the operator confirmed. */
    goLive: 'stream:go-live',
    end: 'stream:end',
    startRecording: 'stream:start-recording',
    stopRecording: 'stream:stop-recording',
    /** Choose the recordings' folder. */
    pickFolder: 'stream:pick-folder',
    /** The operator let the offer to go live again (after a crash) go. */
    dismissResume: 'stream:dismiss-resume',
    /** main -> operator: the stream's state changed. */
    changed: 'stream:changed',
    /** main -> a page: a MessagePort for the preview or the encoder ({ role }). */
    port: 'stream:port',
    /** The stream's page asks what to draw and open. */
    pageContext: 'stream:page-context',
    /** The stream's page tells what cameras and sound inputs it sees, and how they are. */
    pageInputs: 'stream:page-inputs',
    /** main -> the stream's page: its context changed. */
    context: 'stream:context',
  },
  network: {
    /** The local network's state: on or off, its addresses, the paired devices (operator window only). */
    status: 'network:status',
    /** Pro Mode only, as are the rest that change it. */
    setOn: 'network:set-on',
    setPort: 'network:set-port',
    /** Offer a one-time code (and QR code) to pair a device of this kind. */
    startPairing: 'network:start-pairing',
    cancelPairing: 'network:cancel-pairing',
    renameDevice: 'network:rename-device',
    /** Remove a device: cut off at once. */
    revokeDevice: 'network:revoke-device',
    /** A new announcements poster link (the old one stops working). */
    makePoster: 'network:make-poster',
    /** main -> operator: the network's state changed. */
    changed: 'network:changed',
  },
  /** Announcements sent from phones: the operator's queue (operator window only). */
  announcements: {
    list: 'announcements:list',
    /** Pro Mode only, as are the rest that change it. */
    edit: 'announcements:edit',
    /** On the screens, as a message or in the ticker, until its time is up. */
    approve: 'announcements:approve',
    reject: 'announcements:reject',
    /** Off the screens before its time is up. */
    takeOff: 'announcements:take-off',
    /** main -> operator: the queue changed. */
    changed: 'announcements:changed',
  },
  /** Output nodes, on Main (Session 13): pairing, the dashboard's status and actions (operator window only). */
  nodes: {
    status: 'nodes:status',
    /** Pro Mode only, as are the rest that change something. */
    startPairing: 'nodes:start-pairing',
    cancelPairing: 'nodes:cancel-pairing',
    rename: 'nodes:rename',
    /** Remove (unpair) a node: cut off at once, its screens gone. */
    remove: 'nodes:remove',
    /** Copy every picture and video to this node ("Get everything ready"), or only the week's. */
    everything: 'nodes:everything',
    /** Reload one output window, on Main or on a node. */
    reload: 'nodes:reload',
    /** A display's number and name on it, on Main or on a node (also in Simple Mode). */
    identify: 'nodes:identify',
    /** The dashboard is open (thumbnails every few seconds) or closed. */
    watch: 'nodes:watch',
    /** main -> operator: the nodes' state changed. */
    changed: 'nodes:changed',
    /** main -> operator: new thumbnails for the dashboard. */
    thumbs: 'nodes:thumbs',
  },
  /** A node's own window (node mode only). */
  node: {
    view: 'node:view',
    /** Pair with Main at an address, with the code it shows. */
    pair: 'node:pair',
    unpair: 'node:unpair',
    /** Restart as Main (the node's settings stay). */
    useAsMain: 'node:use-as-main',
    /** Each display's number across it, for a few seconds. */
    identify: 'node:identify',
    /** Matching Main's version (Session 14): look for it, download it, quit to install it, or show the file. */
    updateCheck: 'node:update-check',
    updateDownload: 'node:update-download',
    updateInstall: 'node:update-install',
    updateShowFile: 'node:update-show-file',
    /** main -> node window: how it stands changed. */
    changed: 'node:changed',
  },
  output: {
    /** An output window asks which screen it is. */
    getContext: 'output:get-context',
    /** main -> output: this window's screen settings changed. */
    context: 'output:context',
    /** main -> output: show the screen's name for a few seconds. */
    identify: 'output:identify',
    /** An output says how it is drawing: frames that came late, and the revision it last painted. */
    report: 'output:report',
    /** main -> output (on a node): a media file's copy has just landed; load it if it could not be before. */
    mediaReady: 'output:media-ready',
  },
} as const;

/** Request/response channels: arguments and result for each. */
export interface InvokeContract {
  [IPC.app.getInfo]: { args: []; result: AppInfo };
  [IPC.app.recovery]: { args: []; result: RecoveryNotice | null };
  [IPC.app.dismissRecovery]: { args: []; result: null };
  [IPC.app.startNotice]: { args: []; result: string | null };
  [IPC.app.getMode]: { args: []; result: OperatorMode };
  [IPC.app.setMode]: { args: [mode: OperatorMode, word?: string]; result: ModeResult };
  [IPC.roles.view]: { args: []; result: RolesView };
  [IPC.roles.needsAdmin]: { args: []; result: boolean };
  [IPC.roles.unlock]: { args: [pin: string]; result: RolesResult };
  [IPC.roles.lock]: { args: []; result: RolesView };
  [IPC.roles.setPins]: { args: [pins: { admin: string; operator: string }]; result: RolesResult };
  [IPC.roles.changePin]: { args: [change: { role: 'admin' | 'operator'; pin: string }]; result: RolesResult };
  [IPC.roles.turnOff]: { args: []; result: RolesResult };
  [IPC.roles.cancelAsk]: { args: []; result: null };
  [IPC.backups.view]: { args: []; result: ScheduledBackupsView };
  [IPC.backups.save]: { args: [schedule: BackupSchedule]; result: BackupsResult };
  [IPC.backups.pickFolder]: { args: []; result: PickFolderResult };
  [IPC.backups.runNow]: { args: []; result: BackupsResult };
  [IPC.backups.dismiss]: { args: []; result: ScheduledBackupsView };
  [IPC.updates.view]: { args: []; result: UpdateView };
  [IPC.music.view]: { args: []; result: MusicView };
  [IPC.music.create]: { args: [name: string]; result: MusicResult };
  [IPC.music.rename]: { args: [playlistId: string, name: string]; result: MusicResult };
  [IPC.music.remove]: { args: [playlistId: string]; result: MusicResult };
  [IPC.music.setOptions]: {
    args: [playlistId: string, options: { loop: boolean; shuffle: boolean }];
    result: MusicResult;
  };
  [IPC.music.addTracks]: {
    args: [playlistId: string, mediaIds: string[], at: number | null];
    result: MusicResult;
  };
  [IPC.music.moveTrack]: { args: [trackId: string, to: number]; result: MusicResult };
  [IPC.music.removeTrack]: { args: [trackId: string]; result: MusicResult };
  [IPC.music.play]: { args: [playlistId: string | null, trackIndex?: number]; result: MusicResult };
  [IPC.updates.check]: { args: []; result: UpdateResult };
  [IPC.updates.download]: { args: []; result: UpdateResult };
  [IPC.updates.cancel]: { args: []; result: UpdateResult };
  [IPC.updates.setInstallOnQuit]: { args: [on: boolean]; result: UpdateResult };
  [IPC.updates.setAutoCheck]: { args: [on: boolean]; result: UpdateResult };
  [IPC.updates.showFile]: { args: []; result: null };
  [IPC.engine.subscribe]: { args: []; result: EngineSnapshotMessage };
  [IPC.engine.snapshot]: { args: []; result: EngineSnapshotMessage };
  [IPC.engine.command]: { args: [command: EngineCommand]; result: CommandResult };
  [IPC.library.listPresentations]: { args: []; result: PresentationListing[] };
  [IPC.library.listMedia]: { args: []; result: MediaSummary[] };
  [IPC.library.search]: { args: [query: string]; result: SearchResult };
  [IPC.library.words]: { args: [presentationId: string]; result: WordsResult };
  [IPC.library.saveWords]: { args: [presentationId: string, text: string]; result: SaveWordsResult };
  [IPC.library.newFromWords]: { args: [name: string, text: string]; result: NewFromWordsResult };
  [IPC.library.restoreRevision]: { args: [revisionId: string]; result: RevisionResult };
  [IPC.library.legacyPresentations]: { args: []; result: { id: string; name: string }[] };
  [IPC.playlists.tree]: { args: []; result: PlaylistNode[] };
  [IPC.playlists.items]: { args: [playlistId: string]; result: PlaylistItemInfo[] };
  [IPC.playlists.opened]: { args: [playlistId: string]; result: null };
  [IPC.playlists.create]: {
    args: [name: string, parentId: string | null, isFolder: boolean];
    result: PlaylistResult;
  };
  [IPC.playlists.rename]: { args: [playlistId: string, name: string]; result: PlaylistResult };
  [IPC.playlists.remove]: { args: [ids: string[]]; result: PlaylistResult };
  [IPC.playlists.restore]: { args: [ids: string[]]; result: PlaylistResult };
  [IPC.playlists.addItems]: {
    args: [playlistId: string, at: number | null, items: NewItem[]];
    result: PlaylistResult;
  };
  [IPC.playlists.moveItems]: {
    args: [playlistId: string, ids: string[], to: number];
    result: PlaylistResult;
  };
  [IPC.playlists.removeItems]: { args: [ids: string[]]; result: PlaylistResult };
  [IPC.playlists.restoreItems]: { args: [ids: string[]]; result: PlaylistResult };
  [IPC.playlists.fillPlaceholder]: { args: [itemId: string, presentationId: string]; result: PlaylistResult };
  [IPC.playlists.setItemOrder]: { args: [itemId: string, order: ItemOrder]; result: PlaylistResult };
  [IPC.playlists.renameHeader]: { args: [itemId: string, label: string]; result: PlaylistResult };
  [IPC.playlists.templates]: { args: []; result: PlaylistNode[] };
  [IPC.playlists.saveAsTemplate]: {
    args: [playlistId: string, request: TemplateRequest];
    result: PlaylistResult;
  };
  [IPC.playlists.newFromTemplate]: {
    args: [templateId: string, name: string, parentId: string | null];
    result: PlaylistResult;
  };
  [IPC.playlists.addSlot]: {
    args: [playlistId: string, at: number | null, slot: { label: string; category: string | null }];
    result: PlaylistResult;
  };
  [IPC.playlists.editSlot]: {
    args: [itemId: string, slot: { label: string; category: string | null }];
    result: PlaylistResult;
  };
  [IPC.playlists.setTimers]: { args: [itemId: string, cues: TimerCue[]]; result: PlaylistResult };
  [IPC.library.getPresentation]: { args: [id: string]; result: PresentationDoc | null };
  [IPC.library.slidesForEdit]: { args: [presentationId: string]; result: EditSlidesResult };
  [IPC.library.saveSlides]: {
    args: [presentationId: string, doc: EditDoc, stamp: string, force: boolean];
    result: SaveSlidesResult;
  };
  [IPC.library.getDefaultTransition]: { args: []; result: Transition };
  [IPC.library.setDefaultTransition]: {
    args: [transition: Transition];
    result: { ok: true; transition: Transition } | { ok: false; message: string };
  };
  [IPC.library.importPaths]: { args: [paths: string[], options?: ImportOptions]; result: ImportResult };
  [IPC.library.cancelImport]: { args: [runId: string]; result: boolean };
  [IPC.library.listImportRuns]: { args: []; result: ImportRunSummary[] };
  [IPC.library.getImportReport]: { args: [runId: string]; result: ImportReport | null };
  [IPC.library.pickImportPaths]: { args: [kind: 'files' | 'folder']; result: string[] };
  [IPC.library.relinkMedia]: { args: [mediaIds?: string[]]; result: ImportResult };
  [IPC.library.setArrangement]: {
    args: [presentationId: string, arrangementId: string | null];
    result: { ok: true } | { ok: false; message: string };
  };
  [IPC.library.removePresentations]: { args: [ids: string[]]; result: RemoveResult };
  [IPC.library.restorePresentations]: { args: [ids: string[]]; result: RemoveResult };
  [IPC.kirtans.tracks]: { args: [presentationId: string]; result: TracksResult };
  [IPC.kirtans.saveTracks]: { args: [presentationId: string, edits: TrackEdit[]]; result: KirtanResult };
  [IPC.kirtans.setDetails]: {
    args: [presentationId: string, details: KirtanDetails | null];
    result: KirtanResult;
  };
  [IPC.kirtans.makeTransliteration]: {
    args: [presentationId: string, style: TranslitStyle, manual: ManualLines];
    result: MakeTranslitResult;
  };
  [IPC.kirtans.getTranslitStyle]: { args: []; result: TranslitStyle };
  [IPC.kirtans.categories]: { args: []; result: string[] };
  [IPC.kirtans.addCategory]: {
    args: [name: string];
    result: { ok: true; categories: string[] } | { ok: false; message: string };
  };
  [IPC.kirtans.setTranslitStyle]: {
    args: [style: TranslitStyle];
    result: { ok: true; style: TranslitStyle } | { ok: false; message: string };
  };
  [IPC.media.saveStill]: { args: [mediaId: string, jpeg: Uint8Array]; result: SaveStillResult };
  [IPC.media.convert]: { args: [mediaIds: string[]]; result: ConvertResult };
  [IPC.media.cancelConversion]: { args: [jobId: string | null]; result: ConvertResult };
  [IPC.media.conversions]: { args: []; result: ConversionJob[] };
  [IPC.media.reportLength]: { args: [mediaId: string, durationMs: number]; result: null };
  [IPC.media.markers]: { args: [mediaId: string]; result: MediaMarkers };
  [IPC.media.setMarkers]: { args: [mediaId: string, markers: MediaMarkers]; result: MarkersResult };
  [IPC.media.undoConversion]: {
    args: [conversionId: string];
    result: { ok: true } | { ok: false; message: string };
  };
  [IPC.audio.getOutput]: { args: []; result: AudioOutputStatus };
  [IPC.audio.setOutput]: { args: [device: AudioDevice | null]; result: AudioOutputStatus };
  [IPC.audio.reportDevices]: { args: [devices: AudioDevice[], state: AudioOutputState]; result: null };
  [IPC.props.list]: { args: []; result: PropInfo[] };
  [IPC.props.save]: { args: [propId: string | null, fields: PropFields]; result: PropResult };
  [IPC.props.remove]: { args: [propId: string]; result: PropResult };
  [IPC.props.getLogo]: { args: []; result: string | null };
  [IPC.props.setLogo]: { args: [propId: string | null]; result: PropResult };
  [IPC.themes.list]: { args: []; result: { themes: Theme[]; defaultId: string } };
  [IPC.themes.save]: { args: [themeId: string | null, fields: ThemeFields]; result: ThemeResult };
  [IPC.themes.remove]: { args: [themeId: string]; result: ThemeResult };
  [IPC.themes.apply]: { args: [themeId: string, presentationIds: string[]]; result: ApplyThemeResult };
  [IPC.themes.fromPresentation]: { args: [presentationId: string]; result: ThemeResult };
  [IPC.themes.fromSlide]: { args: [name: string, slide: ThemeSlide]; result: ThemeResult };
  [IPC.messages.list]: { args: []; result: MessageTemplate[] };
  [IPC.messages.create]: { args: [template: MessageTemplateFields]; result: MessageResult };
  [IPC.messages.update]: {
    args: [templateId: string, template: MessageTemplateFields];
    result: MessageResult;
  };
  [IPC.messages.remove]: { args: [templateId: string]; result: MessageResult };
  [IPC.timers.create]: { args: [fields: TimerFields]; result: TimerResult };
  [IPC.timers.update]: { args: [timerId: string, fields: TimerFields]; result: TimerResult };
  [IPC.timers.remove]: { args: [timerId: string]; result: TimerResult };
  [IPC.looks.list]: { args: []; result: LooksView };
  [IPC.looks.create]: { args: [name: string, copyOf: string | null]; result: LookResult };
  [IPC.looks.rename]: { args: [lookId: string, name: string]; result: LookResult };
  [IPC.looks.remove]: { args: [lookId: string]; result: LookResult };
  [IPC.looks.move]: { args: [lookId: string, to: number]; result: LookResult };
  [IPC.looks.setGroup]: {
    args: [lookId: string, groupId: string, patch: GroupLookPatch];
    result: LookResult;
  };
  [IPC.macros.list]: { args: []; result: Macro[] };
  [IPC.macros.save]: { args: [macroId: string | null, macro: MacroInput]; result: MacroResult };
  [IPC.macros.remove]: { args: [macroId: string]; result: MacroResult };
  [IPC.macros.run]: { args: [macroId: string]; result: MacroRunResult };
  [IPC.macros.countdown]: { args: []; result: MacroCountdownView };
  [IPC.macros.cancelScheduled]: { args: [key: string]; result: MacroCountdownView };
  [IPC.midi.get]: { args: []; result: MidiSettings };
  [IPC.midi.set]: { args: [settings: MidiSettings]; result: MidiResult };
  [IPC.shastra.list]: { args: []; result: ShastraTextInfo[] };
  [IPC.shastra.tree]: { args: [textId: string]; result: ShastraTree | null };
  [IPC.shastra.resolve]: { args: [reference: string]; result: PassageResult };
  [IPC.shastra.search]: { args: [query: string]; result: ShastraHit[] };
  [IPC.shastra.passage]: { args: [passageId: string]; result: PassageInfo | null };
  [IPC.shastra.itemPassage]: { args: [itemId: string]; result: PassageInfo | null };
  [IPC.shastra.setTheme]: { args: [textId: string, themeId: string | null]; result: ShastraResult };
  [IPC.shastra.remove]: { args: [textId: string]; result: ShastraResult };
  [IPC.idle.view]: { args: []; result: IdleView };
  [IPC.idle.saveSettings]: { args: [settings: IdleSettings]; result: IdleResult };
  [IPC.idle.saveQuote]: { args: [quoteId: string | null, quote: QuoteFields]; result: QuoteResult };
  [IPC.idle.removeQuote]: { args: [quoteId: string]; result: IdleResult };
  [IPC.calendar.view]: { args: []; result: CalendarView };
  [IPC.calendar.remove]: { args: [calendarId: string]; result: CalendarResult };
  [IPC.arti.view]: { args: []; result: ArtiView };
  [IPC.arti.save]: { args: [scheduleId: string | null, fields: ArtiFields]; result: ArtiResult };
  [IPC.arti.setEnabled]: { args: [scheduleId: string, enabled: boolean]; result: ArtiResult };
  [IPC.arti.remove]: { args: [scheduleId: string]; result: ArtiResult };
  [IPC.arti.putUp]: { args: [key: string]; result: ArtiAnswer };
  [IPC.arti.notNow]: { args: [key: string]; result: ArtiAnswer };
  [IPC.arti.cancel]: { args: [key: string]; result: ArtiAnswer };
  [IPC.masks.list]: { args: []; result: Mask[] };
  [IPC.masks.save]: { args: [maskId: string | null, mask: Omit<Mask, 'id'>]; result: MaskResult };
  [IPC.masks.remove]: { args: [maskId: string]; result: MaskResult };
  [IPC.stageLayouts.list]: { args: []; result: StageLayout[] };
  [IPC.stageLayouts.save]: {
    args: [layoutId: string | null, layout: Omit<StageLayout, 'id'>];
    result: StageLayoutResult;
  };
  [IPC.stageLayouts.remove]: { args: [layoutId: string]; result: StageLayoutResult };
  [IPC.screens.get]: { args: []; result: ScreensSnapshot };
  [IPC.screens.createGroup]: { args: [name: string]; result: ScreensResult };
  [IPC.screens.renameGroup]: { args: [groupId: string, name: string]; result: ScreensResult };
  [IPC.screens.setGroupRole]: { args: [groupId: string, role: ScreenRole]; result: ScreensResult };
  [IPC.screens.setGroupLanguages]: {
    args: [groupId: string, languages: Lang[] | null];
    result: ScreensResult;
  };
  [IPC.screens.deleteGroup]: { args: [groupId: string]; result: ScreensResult };
  [IPC.screens.assignDisplay]: {
    args: [groupId: string, displayId: number, options?: CoverOptions];
    result: ScreensResult;
  };
  [IPC.screens.updateScreen]: {
    args: [screenId: string, patch: ScreenPatch, options?: CoverOptions];
    result: ScreensResult;
  };
  [IPC.screens.removeScreen]: { args: [screenId: string]; result: ScreensResult };
  [IPC.screens.identify]: { args: []; result: null };
  [IPC.screens.uncoverOperator]: { args: []; result: ScreensResult };
  [IPC.output.getContext]: { args: []; result: OutputContext | null };
  [IPC.output.report]: { args: [report: OutputReport]; result: null };
  [IPC.setup.state]: { args: []; result: SetupState };
  [IPC.setup.setSeen]: { args: []; result: null };
  [IPC.setup.identifyDisplays]: { args: []; result: { shown: number } };
  [IPC.setup.testTone]: { args: [device: AudioDevice | null]; result: { ok: boolean } };
  [IPC.setup.finish]: { args: [plan: SetupPlan, options?: CoverOptions]; result: SetupResult };
  [IPC.stream.status]: { args: []; result: StreamStatus };
  [IPC.stream.setLayout]: { args: [layout: StreamLayout]; result: StreamResult };
  [IPC.stream.watchPreview]: { args: [on: boolean]; result: null };
  [IPC.stream.profiles]: { args: []; result: StreamProfiles };
  [IPC.stream.saveProfile]: {
    args: [id: string | null, input: StreamProfileInput];
    result: StreamProfilesResult;
  };
  [IPC.stream.removeProfile]: { args: [id: string]; result: StreamProfilesResult };
  [IPC.stream.useProfile]: { args: [id: string]; result: StreamProfilesResult };
  [IPC.stream.setKey]: { args: [id: string, key: string]; result: StreamProfilesResult };
  [IPC.stream.removeKey]: { args: [id: string]; result: StreamProfilesResult };
  [IPC.stream.goLive]: { args: [confirm: { confirmed: true }]; result: StreamResult };
  [IPC.stream.end]: { args: [confirm: { confirmed: true }]; result: StreamResult };
  [IPC.stream.startRecording]: { args: []; result: StreamResult };
  [IPC.stream.stopRecording]: { args: []; result: StreamResult };
  [IPC.stream.pickFolder]: { args: []; result: StreamResult };
  [IPC.stream.dismissResume]: { args: []; result: null };
  [IPC.stream.pageContext]: { args: []; result: ProgramContext | null };
  [IPC.stream.pageInputs]: { args: [inputs: ProgramInputs]; result: null };
  [IPC.network.status]: { args: []; result: NetworkStatus };
  [IPC.network.setOn]: { args: [on: boolean]; result: NetworkResult };
  [IPC.network.setPort]: { args: [port: number]; result: NetworkResult };
  [IPC.network.startPairing]: { args: [kind: DeviceKind, name?: string]; result: NetworkResult };
  [IPC.network.cancelPairing]: { args: []; result: NetworkResult };
  [IPC.network.renameDevice]: { args: [deviceId: string, name: string]; result: NetworkResult };
  [IPC.network.revokeDevice]: { args: [deviceId: string]; result: NetworkResult };
  [IPC.network.makePoster]: { args: []; result: NetworkResult };
  [IPC.announcements.list]: { args: []; result: AnnouncementsView };
  [IPC.announcements.edit]: {
    args: [edit: { id: string; text: string; minutes: number }];
    result: AnnouncementResult;
  };
  [IPC.announcements.approve]: {
    args: [approval: { id: string; as: 'message' | 'ticker'; templateId?: string | null }];
    result: AnnouncementResult;
  };
  [IPC.announcements.reject]: { args: [which: { id: string }]; result: AnnouncementResult };
  [IPC.announcements.takeOff]: { args: [which: { id: string }]; result: AnnouncementResult };
  [IPC.nodes.status]: { args: []; result: NodesStatus };
  [IPC.nodes.startPairing]: { args: []; result: NodesResult };
  [IPC.nodes.cancelPairing]: { args: []; result: NodesResult };
  [IPC.nodes.rename]: { args: [nodeId: string, name: string]; result: NodesResult };
  [IPC.nodes.remove]: { args: [nodeId: string]; result: NodesResult };
  [IPC.nodes.everything]: { args: [nodeId: string, on: boolean]; result: NodesResult };
  [IPC.nodes.reload]: { args: [nodeId: string | null, screenId: string]; result: NodesResult };
  [IPC.nodes.identify]: { args: [nodeId: string | null, displayId: number | null]; result: null };
  [IPC.nodes.watch]: { args: [on: boolean]; result: null };
  [IPC.screens.assignNodeDisplay]: {
    args: [groupId: string, nodeId: string, displayId: number];
    result: ScreensResult;
  };
  [IPC.node.view]: { args: []; result: NodeView };
  [IPC.node.pair]: { args: [address: string, code: string]; result: NodeViewResult };
  [IPC.node.unpair]: { args: []; result: NodeViewResult };
  [IPC.node.useAsMain]: { args: []; result: { ok: boolean } };
  [IPC.node.identify]: { args: []; result: { shown: number } };
  [IPC.node.updateCheck]: { args: []; result: NodeViewResult };
  [IPC.node.updateDownload]: { args: []; result: NodeViewResult };
  [IPC.node.updateInstall]: { args: []; result: NodeViewResult };
  [IPC.node.updateShowFile]: { args: []; result: null };
}

/** main -> renderer event channels and their payloads. */
export interface EventContract {
  [IPC.engine.message]: EngineMessage;
  [IPC.library.importProgress]: ImportProgress;
  [IPC.library.changed]: { at: number; what: LibraryChange };
  [IPC.playlists.changed]: { at: number };
  [IPC.app.undo]: { at: number };
  [IPC.app.redo]: { at: number };
  [IPC.app.notice]: { text: string };
  [IPC.app.progress]: { progress: TaskProgress | null };
  [IPC.app.modeChanged]: { mode: OperatorMode };
  [IPC.app.askLeaveSimple]: { at: number };
  [IPC.roles.changed]: RolesView;
  [IPC.roles.askAdmin]: { what: string };
  [IPC.roles.open]: { at: number };
  [IPC.backups.changed]: ScheduledBackupsView;
  [IPC.backups.open]: { at: number };
  [IPC.updates.changed]: UpdateView;
  [IPC.music.changed]: MusicView;
  [IPC.updates.open]: { at: number };
  [IPC.screens.changed]: ScreensSnapshot;
  [IPC.looks.changed]: LooksView;
  [IPC.stageLayouts.changed]: StageLayout[];
  [IPC.masks.changed]: Mask[];
  [IPC.macros.changed]: Macro[];
  [IPC.macros.countdownChanged]: MacroCountdownView;
  [IPC.arti.changed]: ArtiView;
  [IPC.calendar.changed]: CalendarView;
  [IPC.idle.changed]: IdleView;
  [IPC.output.context]: OutputContext;
  [IPC.output.identify]: { name: string; groupName: string; label?: string };
  [IPC.output.mediaReady]: { mediaId: string };
  [IPC.audio.chosen]: { device: AudioDevice | null };
  [IPC.audio.testTone]: { deviceId: string };
  [IPC.setup.open]: { at: number };
  [IPC.audio.status]: AudioOutputStatus;
  [IPC.stream.changed]: StreamStatus;
  [IPC.media.conversionsChanged]: ConversionJob[];
  [IPC.stream.port]: { role: 'preview' | 'encoder' };
  [IPC.stream.context]: ProgramContext;
  [IPC.network.changed]: NetworkStatus;
  [IPC.announcements.changed]: AnnouncementsView;
  [IPC.nodes.changed]: NodesStatus;
  [IPC.nodes.thumbs]: ScreenThumb[];
  [IPC.node.changed]: NodeView;
}

export type InvokeChannel = keyof InvokeContract;
export type EventChannel = keyof EventContract;
export type InvokeArgs<C extends InvokeChannel> = InvokeContract[C]['args'];
export type InvokeResult<C extends InvokeChannel> = InvokeContract[C]['result'];

/** Every channel name, for checks. */
export function allChannels(): string[] {
  return Object.values(IPC).flatMap((group) => Object.values(group));
}
