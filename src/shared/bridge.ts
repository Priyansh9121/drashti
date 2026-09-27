import type { AppInfo } from './app-info';
import type { CommandResult, EngineCommand } from './engine/commands';
import type { EngineMessage, EngineSnapshotMessage } from './engine/protocol';
import type { PresentationDoc, PresentationSummary } from './library';
import type { OutputContext, ScreenPatch, ScreensResult, ScreensSnapshot } from './screens';

/**
 * The API the preload script exposes to every renderer as `window.drashti`.
 * Renderers reach the main process only through this object: no Node, no
 * ipcRenderer, no raw channel names.
 */
export interface DrashtiBridge {
  app: {
    getInfo(): Promise<AppInfo>;
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
    getPresentation(id: string): Promise<PresentationDoc | null>;
  };
  /** Screen setup (operator window only). */
  screens: {
    get(): Promise<ScreensSnapshot>;
    onChanged(listener: (snapshot: ScreensSnapshot) => void): () => void;
    createGroup(name: string): Promise<ScreensResult>;
    renameGroup(groupId: string, name: string): Promise<ScreensResult>;
    deleteGroup(groupId: string): Promise<ScreensResult>;
    assignDisplay(groupId: string, displayId: number): Promise<ScreensResult>;
    updateScreen(screenId: string, patch: ScreenPatch): Promise<ScreensResult>;
    removeScreen(screenId: string): Promise<ScreensResult>;
    /** Show each screen's name on its output for a few seconds. */
    identify(): Promise<null>;
  };
  /** For output windows. */
  output: {
    getContext(): Promise<OutputContext | null>;
    onContext(listener: (context: OutputContext) => void): () => void;
    onIdentify(listener: (who: { name: string; groupName: string }) => void): () => void;
  };
}
