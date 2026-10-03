import { contextBridge, ipcRenderer } from 'electron';

export interface StudioflowApi {
  coreVersion(): Promise<{ name: string; version: string }>;
  boot(): Promise<{ open_channel: string | null }>;
  pickFolder(): Promise<string | null>;
  pickFiles(): Promise<string[]>;
  openPath(p: string): Promise<string>;
  secretsStatus(): Promise<{ name: string; hint: string | null }[]>;
  secretsSet(name: string, value: string): Promise<{ name: string; hint: string | null }>;
  secretsDelete(name: string): Promise<{ name: string; deleted: boolean }>;
  onCoreStatus(fn: (s: { ok: boolean; code?: number }) => void): void;
}

const api: StudioflowApi = {
  coreVersion: () => ipcRenderer.invoke('core:version'),
  boot: () => ipcRenderer.invoke('app:boot'),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  pickFiles: () => ipcRenderer.invoke('dialog:files'),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  secretsStatus: () => ipcRenderer.invoke('secrets:status'),
  secretsSet: (n, v) => ipcRenderer.invoke('secrets:set', n, v),
  secretsDelete: (n) => ipcRenderer.invoke('secrets:delete', n),
  onCoreStatus: (fn) => {
    ipcRenderer.on('core-status', (_e, s) => fn(s));
  },
};

contextBridge.exposeInMainWorld('studioflow', api);

// MessagePort tới core (D10 mục 4): chuyển sang main world bằng window.postMessage.
ipcRenderer.on('core-port', (e) => {
  window.postMessage('core-port', '*', e.ports);
});
