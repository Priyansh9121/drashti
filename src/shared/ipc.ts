import type { AppInfo } from './app-info';
import type { AudioDevice, AudioOutputState, AudioOutputStatus } from './audio';
import type { CommandResult, EngineCommand } from './engine/commands';
import type { EngineMessage, EngineSnapshotMessage } from './engine/protocol';
import type { ImportOptions, ImportProgress, ImportReport, ImportResult, ImportRunSummary } from './import';
import type { PresentationDoc, PresentationSummary, RemoveResult } from './library';
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
import type { SearchResult } from './search';
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
    /** What was put back on the screens after an unexpected stop, or null. */
    recovery: 'app:recovery',
    /** The operator has read the recovery notice. */
    dismissRecovery: 'app:dismiss-recovery',
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
    legacyPresentations: 'library:legacy-presentations',
    getPresentation: 'library:get-presentation',
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
    /** main -> operator: presentations were added or changed. */
    changed: 'library:changed',
  },
  media: {
    /** Keep a still frame the operator window made (operator window only). */
    saveStill: 'media:save-still',
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
    /** main -> operator: playlists changed. */
    changed: 'playlists:changed',
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
    deleteGroup: 'screens:delete-group',
    assignDisplay: 'screens:assign-display',
    updateScreen: 'screens:update-screen',
    removeScreen: 'screens:remove-screen',
    identify: 'screens:identify',
    uncoverOperator: 'screens:uncover-operator',
    /** main -> operator: the screen setup or display list changed. */
    changed: 'screens:changed',
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
  [IPC.engine.subscribe]: { args: []; result: EngineSnapshotMessage };
  [IPC.engine.snapshot]: { args: []; result: EngineSnapshotMessage };
  [IPC.engine.command]: { args: [command: EngineCommand]; result: CommandResult };
  [IPC.library.listPresentations]: { args: []; result: PresentationSummary[] };
  [IPC.library.listMedia]: { args: []; result: MediaSummary[] };
  [IPC.library.search]: { args: [query: string]; result: SearchResult };
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
  [IPC.library.getPresentation]: { args: [id: string]; result: PresentationDoc | null };
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
  [IPC.media.saveStill]: { args: [mediaId: string, jpeg: Uint8Array]; result: SaveStillResult };
  [IPC.audio.getOutput]: { args: []; result: AudioOutputStatus };
  [IPC.audio.setOutput]: { args: [device: AudioDevice | null]; result: AudioOutputStatus };
  [IPC.audio.reportDevices]: { args: [devices: AudioDevice[], state: AudioOutputState]; result: null };
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
}

/** main -> renderer event channels and their payloads. */
export interface EventContract {
  [IPC.engine.message]: EngineMessage;
  [IPC.library.importProgress]: ImportProgress;
  [IPC.library.changed]: { at: number };
  [IPC.playlists.changed]: { at: number };
  [IPC.app.undo]: { at: number };
  [IPC.screens.changed]: ScreensSnapshot;
  [IPC.output.context]: OutputContext;
  [IPC.output.identify]: { name: string; groupName: string };
  [IPC.audio.chosen]: { device: AudioDevice | null };
  [IPC.audio.status]: AudioOutputStatus;
}

export type InvokeChannel = keyof InvokeContract;
export type EventChannel = keyof EventContract;
export type InvokeArgs<C extends InvokeChannel> = InvokeContract[C]['args'];
export type InvokeResult<C extends InvokeChannel> = InvokeContract[C]['result'];

/** Every channel name, for checks. */
export function allChannels(): string[] {
  return Object.values(IPC).flatMap((group) => Object.values(group));
}
