import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DrashtiBridge } from '../shared/bridge';
import type { EventChannel, EventContract, InvokeArgs, InvokeChannel, InvokeResult } from '../shared/ipc';
import { IPC } from '../shared/ipc';

/** Typed ipcRenderer.invoke over the shared contract. */
function invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<InvokeResult<C>>;
}

/** Typed listener for a main -> renderer event; returns an unsubscribe function. */
function on<C extends EventChannel>(channel: C, listener: (payload: EventContract[C]) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: EventContract[C]) => {
    listener(payload);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const bridge: DrashtiBridge = {
  app: {
    getInfo: () => invoke(IPC.app.getInfo),
  },
  engine: {
    onMessage: (listener) => on(IPC.engine.message, listener),
    subscribe: () => invoke(IPC.engine.subscribe),
    snapshot: () => invoke(IPC.engine.snapshot),
    dispatch: (command) => invoke(IPC.engine.command, command),
  },
  library: {
    listPresentations: () => invoke(IPC.library.listPresentations),
    getPresentation: (id) => invoke(IPC.library.getPresentation, id),
    onChanged: (listener) =>
      on(IPC.library.changed, () => {
        listener();
      }),
    importPaths: (paths, options) => invoke(IPC.library.importPaths, paths, options),
    cancelImport: (runId) => invoke(IPC.library.cancelImport, runId),
    onImportProgress: (listener) => on(IPC.library.importProgress, listener),
    listImportRuns: () => invoke(IPC.library.listImportRuns),
    getImportReport: (runId) => invoke(IPC.library.getImportReport, runId),
  },
  screens: {
    get: () => invoke(IPC.screens.get),
    onChanged: (listener) => on(IPC.screens.changed, listener),
    createGroup: (name) => invoke(IPC.screens.createGroup, name),
    renameGroup: (groupId, name) => invoke(IPC.screens.renameGroup, groupId, name),
    deleteGroup: (groupId) => invoke(IPC.screens.deleteGroup, groupId),
    assignDisplay: (groupId, displayId, options) =>
      invoke(IPC.screens.assignDisplay, groupId, displayId, options),
    updateScreen: (screenId, patch, options) => invoke(IPC.screens.updateScreen, screenId, patch, options),
    removeScreen: (screenId) => invoke(IPC.screens.removeScreen, screenId),
    identify: () => invoke(IPC.screens.identify),
    uncoverOperator: () => invoke(IPC.screens.uncoverOperator),
  },
  output: {
    getContext: () => invoke(IPC.output.getContext),
    onContext: (listener) => on(IPC.output.context, listener),
    onIdentify: (listener) => on(IPC.output.identify, listener),
  },
};

contextBridge.exposeInMainWorld('drashti', bridge);
