import type { AppInfo } from './app-info';
import type { CommandResult, EngineCommand } from './engine/commands';
import type { EngineMessage, EngineSnapshotMessage } from './engine/protocol';
import type { PresentationDoc, PresentationSummary } from './library';

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
} as const;

/** Request/response channels: arguments and result for each. */
export interface InvokeContract {
  [IPC.app.getInfo]: { args: []; result: AppInfo };
  [IPC.engine.subscribe]: { args: []; result: EngineSnapshotMessage };
  [IPC.engine.snapshot]: { args: []; result: EngineSnapshotMessage };
  [IPC.engine.command]: { args: [command: EngineCommand]; result: CommandResult };
  [IPC.library.listPresentations]: { args: []; result: PresentationSummary[] };
  [IPC.library.getPresentation]: { args: [id: string]; result: PresentationDoc | null };
}

/** main -> renderer event channels and their payloads. */
export interface EventContract {
  [IPC.engine.message]: EngineMessage;
}

export type InvokeChannel = keyof InvokeContract;
export type EventChannel = keyof EventContract;
export type InvokeArgs<C extends InvokeChannel> = InvokeContract[C]['args'];
export type InvokeResult<C extends InvokeChannel> = InvokeContract[C]['result'];

/** Every channel name, for checks. */
export function allChannels(): string[] {
  return Object.values(IPC).flatMap((group) => Object.values(group));
}
