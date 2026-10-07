import { contextBridge, ipcRenderer } from 'electron';

export interface StudioflowApi {
  coreVersion(): Promise<{ name: string; version: string }>;
  boot(): Promise<{ open_channel: string | null }>;
  pickFolder(): Promise<string | null>;
  pickFiles(): Promise<string[]>;
  openPath(p: string): Promise<string>;
  /** Đọc file âm thanh được phép (008) để phát trong app. */
  readAudio(absPath: string): Promise<{ mime: string; data: Uint8Array }>;
  secretsStatus(): Promise<{ name: string; hint: string | null }[]>;
  secretsSet(name: string, value: string): Promise<{ name: string; hint: string | null }>;
  secretsDelete(name: string): Promise<{ name: string; deleted: boolean }>;
  onCoreStatus(fn: (s: { ok: boolean; code?: number }) => void): void;
  /** 045: người dùng đóng cửa sổ → giao diện kiểm việc chạy dở rồi trả lời `closeReply`. */
  onCloseRequest(fn: () => void): void;
  /** `asking`: đang hỏi người dùng (main chờ); `close`: đóng; `stay`: ở lại. */
  closeReply(r: 'asking' | 'close' | 'stay'): Promise<void>;
}

const api: StudioflowApi = {
  coreVersion: () => ipcRenderer.invoke('core:version'),
  boot: () => ipcRenderer.invoke('app:boot'),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  pickFiles: () => ipcRenderer.invoke('dialog:files'),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  readAudio: (p) => ipcRenderer.invoke('media:audio', p),
  secretsStatus: () => ipcRenderer.invoke('secrets:status'),
  secretsSet: (n, v) => ipcRenderer.invoke('secrets:set', n, v),
  secretsDelete: (n) => ipcRenderer.invoke('secrets:delete', n),
  onCoreStatus: (fn) => {
    ipcRenderer.on('core-status', (_e, s) => fn(s));
  },
  onCloseRequest: (fn) => {
    ipcRenderer.on('app:close-request', () => fn());
  },
  closeReply: (r) => ipcRenderer.invoke('app:close-reply', r),
};

contextBridge.exposeInMainWorld('studioflow', api);

// MessagePort tới core (D10 mục 4): chuyển sang main world bằng window.postMessage.
ipcRenderer.on('core-port', (e) => {
  window.postMessage('core-port', '*', e.ports);
});
