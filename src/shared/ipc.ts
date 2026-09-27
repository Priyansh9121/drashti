import type { AppInfo } from './app-info';
import type { CommandResult, EngineCommand } from './engine/commands';
import type { EngineMessage, EngineSnapshotMessage } from './engine/protocol';
import type { PresentationDoc, PresentationSummary } from './library';
import type { OutputContext, ScreenPatch, ScreensResult, ScreensSnapshot } from './screens';

/**
 * IPC channel names. This is the only place channel strings are written;
 * the preload script and the main process both import them from here.
 */
export const IPC = {
  app: {
    getInfo: 'app:get-info',
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
    getPresentation: 'library:get-presentation',
  },
  screens: {
    get: 'screens:get',
    createGroup: 'screens:create-group',
    renameGroup: 'screens:rename-group',
    deleteGroup: 'screens:delete-group',
    assignDisplay: 'screens:assign-display',
    updateScreen: 'screens:update-screen',
    removeScreen: 'screens:remove-screen',
    identify: 'screens:identify',
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
  [IPC.engine.subscribe]: { args: []; result: EngineSnapshotMessage };
  [IPC.engine.snapshot]: { args: []; result: EngineSnapshotMessage };
  [IPC.engine.command]: { args: [command: EngineCommand]; result: CommandResult };
  [IPC.library.listPresentations]: { args: []; result: PresentationSummary[] };
  [IPC.library.getPresentation]: { args: [id: string]; result: PresentationDoc | null };
  [IPC.screens.get]: { args: []; result: ScreensSnapshot };
  [IPC.screens.createGroup]: { args: [name: string]; result: ScreensResult };
  [IPC.screens.renameGroup]: { args: [groupId: string, name: string]; result: ScreensResult };
  [IPC.screens.deleteGroup]: { args: [groupId: string]; result: ScreensResult };
  [IPC.screens.assignDisplay]: { args: [groupId: string, displayId: number]; result: ScreensResult };
  [IPC.screens.updateScreen]: { args: [screenId: string, patch: ScreenPatch]; result: ScreensResult };
  [IPC.screens.removeScreen]: { args: [screenId: string]; result: ScreensResult };
  [IPC.screens.identify]: { args: []; result: null };
  [IPC.output.getContext]: { args: []; result: OutputContext | null };
}

/** main -> renderer event channels and their payloads. */
export interface EventContract {
  [IPC.engine.message]: EngineMessage;
  [IPC.screens.changed]: ScreensSnapshot;
  [IPC.output.context]: OutputContext;
  [IPC.output.identify]: { name: string; groupName: string };
}

export type InvokeChannel = keyof InvokeContract;
export type EventChannel = keyof EventContract;
export type InvokeArgs<C extends InvokeChannel> = InvokeContract[C]['args'];
export type InvokeResult<C extends InvokeChannel> = InvokeContract[C]['result'];

/** Every channel name, for checks. */
export function allChannels(): string[] {
  return Object.values(IPC).flatMap((group) => Object.values(group));
}
