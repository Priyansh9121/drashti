import type { ArtiAnswer, ArtiFields, ArtiResult, ArtiView } from './arti';
import type { CalendarResult, CalendarView } from './calendar';
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
import type { Macro, MacroResult, MacroRunResult } from './macros';
import type { MidiResult, MidiSettings } from './midi';
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
 * The API the preload script exposes to every renderer as `window.drashti`.
 * Renderers reach the main process only through this object: no Node, no
 * ipcRenderer, no raw channel names.
 */
export interface DrashtiBridge {
  app: {
    getInfo(): Promise<AppInfo>;
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
    /** A long task's progress (a backup), or null when it has ended. */
    onProgress(listener: (progress: TaskProgress | null) => void): () => void;
    /** Simple Mode or Pro Mode. */
    getMode(): Promise<OperatorMode>;
    /** Into Simple Mode at once; back to Pro Mode only with the word typed (operator window only). */
    setMode(mode: OperatorMode, word?: string): Promise<ModeResult>;
    onModeChanged(listener: (mode: OperatorMode) => void): () => void;
    /** View > Switch to Pro Mode… was chosen: ask for the word. */
    onAskLeaveSimple(listener: () => void): () => void;
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
    pickImportPaths(kind: 'files' | 'folder'): Promise<string[]>;
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
    onChanged(listener: () => void): () => void;
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
  themes: {
    list(): Promise<{ themes: Theme[]; defaultId: string }>;
    /** Make a theme (no id) or change one. */
    save(themeId: string | null, fields: ThemeFields): Promise<ThemeResult>;
    /** Remove a theme; the default one stays. */
    remove(themeId: string): Promise<ThemeResult>;
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
    removeProfile(id: string): Promise<StreamProfilesResult>;
    useProfile(id: string): Promise<StreamProfilesResult>;
    /** The key is kept in the system's secure storage and never comes back. */
    setKey(id: string, key: string): Promise<StreamProfilesResult>;
    removeKey(id: string): Promise<StreamProfilesResult>;
    goLive(confirm: { confirmed: true }): Promise<StreamResult>;
    end(confirm: { confirmed: true }): Promise<StreamResult>;
    startRecording(): Promise<StreamResult>;
    stopRecording(): Promise<StreamResult>;
    pickFolder(): Promise<StreamResult>;
    /** Let the offer to go live again after a crash go. */
    dismissResume(): Promise<null>;
    /** The stream's own page. */
    page: {
      context(): Promise<ProgramContext | null>;
      onContext(listener: (context: ProgramContext) => void): () => void;
      reportInputs(inputs: ProgramInputs): Promise<null>;
    };
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
  /** Macros: actions run in order as one change (changing and running them: operator window, Pro Mode). */
  macros: {
    list(): Promise<Macro[]>;
    onChanged(listener: (macros: Macro[]) => void): () => void;
    /** Make one (no id) or save one; refused if an action is not one a macro may do. */
    save(macroId: string | null, macro: Omit<Macro, 'id'>): Promise<MacroResult>;
    remove(macroId: string): Promise<MacroResult>;
    /** Run it now (Simple Mode refuses). */
    run(macroId: string): Promise<MacroRunResult>;
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
  /** Samvat and tithi: the calendars an admin loaded (through Import), today's entry, removing one (Pro Mode). */
  calendar: {
    view(): Promise<CalendarView>;
    onChanged(listener: (view: CalendarView) => void): () => void;
    remove(calendarId: string): Promise<CalendarResult>;
  };
  /**
   * The arti at its time: schedules (changing them: operator window, Pro Mode) and the prompt, which
   * either mode answers.
   */
  arti: {
    view(): Promise<ArtiView>;
    onChanged(listener: (view: ArtiView) => void): () => void;
    /** Make one (no id) or save one. */
    save(scheduleId: string | null, fields: ArtiFields): Promise<ArtiResult>;
    setEnabled(scheduleId: string, enabled: boolean): Promise<ArtiResult>;
    remove(scheduleId: string): Promise<ArtiResult>;
    /** The prompt's answers, for the prompt with this key. */
    putUp(key: string): Promise<ArtiAnswer>;
    notNow(key: string): Promise<ArtiAnswer>;
    /** Stop it going up by itself; the prompt stays. */
    cancel(key: string): Promise<ArtiAnswer>;
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
    /** Show each screen's name on its output for a few seconds. */
    identify(): Promise<null>;
    /** Turn off any output covering the operator window. */
    uncoverOperator(): Promise<ScreensResult>;
  };
  /** For output windows. */
  output: {
    getContext(): Promise<OutputContext | null>;
    onContext(listener: (context: OutputContext) => void): () => void;
    onIdentify(listener: (who: { name: string; groupName: string }) => void): () => void;
  };
}
