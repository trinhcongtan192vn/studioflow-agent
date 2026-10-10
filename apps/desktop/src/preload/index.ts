import { contextBridge, ipcRenderer } from 'electron';

export interface StudioflowApi {
  coreVersion(): Promise<{ name: string; version: string }>;
  boot(): Promise<{ open_channel: string | null }>;
  pickFolder(): Promise<string | null>;
  pickFiles(): Promise<string[]>;
  openPath(p: string): Promise<string>;
  /** 058: mở File Explorer tại thư mục chứa tệp, chọn sẵn tệp. */
  revealFile(p: string): Promise<boolean>;
  /** 071: mở URL https trong trình duyệt mặc định (đăng nhập Google…). */
  openExternal(url: string): Promise<boolean>;
  /** Đọc file âm thanh được phép (008) để phát trong app. */
  readAudio(absPath: string): Promise<{ mime: string; data: Uint8Array }>;
  /** Gốc URL máy chủ media cục bộ (video/ảnh), rỗng nếu chưa sẵn sàng. */
  mediaBase: string;
  secretsStatus(): Promise<{ name: string; hint: string | null }[]>;
  secretsSet(name: string, value: string): Promise<{ name: string; hint: string | null }>;
  secretsDelete(name: string): Promise<{ name: string; deleted: boolean }>;
  onCoreStatus(fn: (s: { ok: boolean; code?: number }) => void): void;
  /**
   * 045: người dùng đóng cửa sổ → giao diện kiểm việc chạy dở rồi trả lời `closeReply`.
   * `quit`: thoát hẳn (menu khay / thoát app), không ẩn xuống khay (052).
   */
  onCloseRequest(fn: (o: { quit: boolean }) => void): void;
  /** `asking`: đang hỏi người dùng (main chờ); `close`: đóng; `stay`: ở lại; `hide`: ẩn xuống khay (052). */
  closeReply(r: 'asking' | 'close' | 'stay' | 'hide'): Promise<void>;
  /** 052: trạng thái Autopilot cho `main` — khay hệ thống, chống ngủ máy khi đang sản xuất. */
  setAutopilotState(s: {
    background: boolean;
    producing: boolean;
    paused: boolean;
    any: boolean;
  }): void;
  /** 052: lệnh từ menu khay (tạm dừng / tiếp tục Autopilot). */
  onTrayAction(fn: (a: 'pause' | 'resume') => void): void;
  /** 052: khởi động cùng Windows (mở thẳng xuống khay). */
  getAutostart(): Promise<boolean>;
  setAutostart(on: boolean): Promise<boolean>;
}

const api: StudioflowApi = {
  coreVersion: () => ipcRenderer.invoke('core:version'),
  boot: () => ipcRenderer.invoke('app:boot'),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  pickFiles: () => ipcRenderer.invoke('dialog:files'),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  revealFile: (p) => ipcRenderer.invoke('shell:reveal', p),
  openExternal: (url) => ipcRenderer.invoke('shell:external', url),
  readAudio: (p) => ipcRenderer.invoke('media:audio', p),
  mediaBase: String(ipcRenderer.sendSync('media:base') ?? ''),
  secretsStatus: () => ipcRenderer.invoke('secrets:status'),
  secretsSet: (n, v) => ipcRenderer.invoke('secrets:set', n, v),
  secretsDelete: (n) => ipcRenderer.invoke('secrets:delete', n),
  onCoreStatus: (fn) => {
    ipcRenderer.on('core-status', (_e, s) => fn(s));
  },
  onCloseRequest: (fn) => {
    ipcRenderer.on('app:close-request', (_e, o?: { quit?: boolean }) =>
      fn({ quit: Boolean(o?.quit) }),
    );
  },
  closeReply: (r) => ipcRenderer.invoke('app:close-reply', r),
  setAutopilotState: (s) => ipcRenderer.send('autopilot:state', s),
  onTrayAction: (fn) => {
    ipcRenderer.on('tray:action', (_e, a: 'pause' | 'resume') => fn(a));
  },
  getAutostart: () => ipcRenderer.invoke('app:autostart-get'),
  setAutostart: (on) => ipcRenderer.invoke('app:autostart-set', on),
};

contextBridge.exposeInMainWorld('studioflow', api);

// MessagePort tới core (D10 mục 4): chuyển sang main world bằng window.postMessage.
ipcRenderer.on('core-port', (e) => {
  window.postMessage('core-port', '*', e.ports);
});
