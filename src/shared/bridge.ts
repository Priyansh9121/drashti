import type { AppInfo, TaskProgress } from './app-info';
import type { AudioDevice, AudioOutputState, AudioOutputStatus } from './audio';
import type { CommandResult, EngineCommand } from './engine/commands';
import type { EngineMessage, EngineSnapshotMessage } from './engine/protocol';
import type { ImportOptions, ImportProgress, ImportReport, ImportResult, ImportRunSummary } from './import';
import type {
  NewFromWordsResult,
  PresentationDoc,
  PresentationSummary,
  RemoveResult,
  RevisionResult,
  SaveWordsResult,
  WordsResult,
} from './library';
import type { RecoveryNotice } from './recovery';
import type { SaveStillResult } from './media';
import type {
  ItemOrder,
  MediaSummary,
  NewItem,
  PlaylistItemInfo,
  PlaylistNode,
  PlaylistResult,
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
 * The API the preload script exposes to every renderer as `window.drashti`.
 * Renderers reach the main process only through this object: no Node, no
 * ipcRenderer, no raw channel names.
 */
export interface DrashtiBridge {
  app: {
    getInfo(): Promise<AppInfo>;
    /** Edit > Undo was chosen (operator window). */
    onUndo(listener: () => void): () => void;
    /** Something to tell the operator, from the main process. */
    onNotice(listener: (text: string) => void): () => void;
    /** What was put back on the screens after Drashti stopped unexpectedly, until dismissed. */
    recovery(): Promise<RecoveryNotice | null>;
    dismissRecovery(): Promise<null>;
    /** Something to tell the operator as the page opens (how a restore went); null after the first ask. */
    startNotice(): Promise<string | null>;
    /** A long task's progress (a backup), or null when it has ended. */
    onProgress(listener: (progress: TaskProgress | null) => void): () => void;
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
    /** Presentations were added or changed (for example by an import). */
    onChanged(listener: () => void): () => void;
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
    onChanged(listener: () => void): () => void;
  };
  /** Props: a logo or a fixed line over whatever slide is live. Showing one goes through the engine. */
  props: {
    list(): Promise<PropInfo[]>;
    /** Make a prop (no id) or change one. */
    save(propId: string | null, fields: PropFields): Promise<PropResult>;
    remove(propId: string): Promise<PropResult>;
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
  };
  /** Screen setup (operator window only). */
  screens: {
    get(): Promise<ScreensSnapshot>;
    onChanged(listener: (snapshot: ScreensSnapshot) => void): () => void;
    createGroup(name: string): Promise<ScreensResult>;
    renameGroup(groupId: string, name: string): Promise<ScreensResult>;
    /** Audience screens show the picture; stage screens show the performers' view. */
    setGroupRole(groupId: string, role: ScreenRole): Promise<ScreensResult>;
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
