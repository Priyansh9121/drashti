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
import type {
  ItemOrder,
  MediaSummary,
  NewItem,
  PlaylistItemInfo,
  PlaylistNode,
  PlaylistResult,
  TemplateRequest,
} from './playlists';
import type { MessageResult, MessageTemplate, MessageTemplateFields } from './messages';
import type { PropFields, PropInfo, PropResult } from './props';
import type { SearchResult } from './search';
import type { ApplyThemeResult, Theme, ThemeFields, ThemeResult } from './themes';
import type { TimerFields, TimerResult } from './timers';
import type {
  CoverOptions,
  OutputContext,
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
  output: {
    /** An output window asks which screen it is. */
    getContext: 'output:get-context',
    /** main -> output: this window's screen settings changed. */
    context: 'output:context',
    /** main -> output: show the screen's name for a few seconds. */
    identify: 'output:identify',
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
  [IPC.screens.changed]: ScreensSnapshot;
  [IPC.output.context]: OutputContext;
  [IPC.output.identify]: { name: string; groupName: string };
  [IPC.audio.chosen]: { device: AudioDevice | null };
  [IPC.audio.testTone]: { deviceId: string };
  [IPC.setup.open]: { at: number };
  [IPC.audio.status]: AudioOutputStatus;
  [IPC.stream.changed]: StreamStatus;
  [IPC.media.conversionsChanged]: ConversionJob[];
  [IPC.stream.port]: { role: 'preview' | 'encoder' };
  [IPC.stream.context]: ProgramContext;
}

export type InvokeChannel = keyof InvokeContract;
export type EventChannel = keyof EventContract;
export type InvokeArgs<C extends InvokeChannel> = InvokeContract[C]['args'];
export type InvokeResult<C extends InvokeChannel> = InvokeContract[C]['result'];

/** Every channel name, for checks. */
export function allChannels(): string[] {
  return Object.values(IPC).flatMap((group) => Object.values(group));
}
