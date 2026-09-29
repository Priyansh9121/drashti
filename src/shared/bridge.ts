import type { AppInfo } from './app-info';
import type { AudioDevice, AudioOutputState, AudioOutputStatus } from './audio';
import type { CommandResult, EngineCommand } from './engine/commands';
import type { EngineMessage, EngineSnapshotMessage } from './engine/protocol';
import type { ImportOptions, ImportProgress, ImportReport, ImportResult, ImportRunSummary } from './import';
import type { PresentationDoc, PresentationSummary, RemoveResult } from './library';
import type { SaveStillResult } from './media';
import type { CoverOptions, OutputContext, ScreenPatch, ScreensResult, ScreensSnapshot } from './screens';

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
    /** Remove presentations; restorePresentations brings them back (Undo). */
    removePresentations(ids: string[]): Promise<RemoveResult>;
    restorePresentations(ids: string[]): Promise<RemoveResult>;
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
