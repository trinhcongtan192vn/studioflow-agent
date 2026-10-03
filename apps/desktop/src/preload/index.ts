import { contextBridge, ipcRenderer } from 'electron';

export interface StudioflowApi {
  coreVersion(): Promise<{ name: string; version: string }>;
}

const api: StudioflowApi = {
  coreVersion: () => ipcRenderer.invoke('core:version'),
};

contextBridge.exposeInMainWorld('studioflow', api);
