import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { type DrashtiBridge } from '../shared/bridge';
import { type EngineMessage } from '../shared/engine/protocol';
import { IPC, type InvokeArgs, type InvokeChannel, type InvokeResult } from '../shared/ipc';

/** Typed ipcRenderer.invoke over the shared contract. */
function invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<InvokeResult<C>>;
}

const bridge: DrashtiBridge = {
  app: {
    getInfo: () => invoke(IPC.app.getInfo),
  },
  engine: {
    onMessage: (listener) => {
      const handler = (_event: IpcRendererEvent, message: EngineMessage) => {
        listener(message);
      };
      ipcRenderer.on(IPC.engine.message, handler);
      return () => {
        ipcRenderer.removeListener(IPC.engine.message, handler);
      };
    },
    subscribe: () => invoke(IPC.engine.subscribe),
    snapshot: () => invoke(IPC.engine.snapshot),
    dispatch: (command) => invoke(IPC.engine.command, command),
  },
};

contextBridge.exposeInMainWorld('drashti', bridge);
