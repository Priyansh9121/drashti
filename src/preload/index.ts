import { contextBridge, ipcRenderer } from 'electron';
import { type AppInfo } from '../shared/app-info';
import { type DrashtiBridge } from '../shared/bridge';
import { IPC } from '../shared/ipc';

const bridge: DrashtiBridge = {
  app: {
    getInfo: () => ipcRenderer.invoke(IPC.app.getInfo) as Promise<AppInfo>,
  },
};

contextBridge.exposeInMainWorld('drashti', bridge);
