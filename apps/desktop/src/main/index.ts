import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MessageChannelMain,
  nativeImage,
  powerSaveBlocker,
  protocol,
  shell,
  Tray,
  utilityProcess,
  type NativeImage,
  type UtilityProcess,
} from 'electron';
import {
  getVersion,
  secretDelete,
  secretGet,
  secretGetMany,
  secretHint,
  secretSet,
} from '@studioflow/core';
import { resolveAppDataDir } from './app-data.js';
import { handleSecretRequest, STATIC_SECRETS } from './secret-bridge.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// 026: renderer phát audio xem trước (`.sf/preview/*.wav`) của bảng caption qua `sf-media:` — chỉ đọc,
// chỉ file dẫn xuất trong `.sf/preview/`; 008: thêm video render (`renders/*/*.mp4`) và ảnh để xem trong chat/explorer.
protocol.registerSchemesAsPrivileged([
  { scheme: 'sf-media', privileges: { stream: true, supportFetchAPI: true, standard: false } },
]);
const MEDIA_OK = [
  /[\\/]\.sf[\\/]preview[\\/][^\\/]+\.wav$/i,
  // 033: câu mẫu của giọng (nghe thử giọng gợi ý)
  /[\\/]voices[\\/]vo_[0-9a-z]{8}[\\/]ref\.wav$/i,
  /[\\/]videos[\\/][^\\/]+[\\/]renders[\\/][^\\/]+[\\/][^\\/]+\.mp4$/i,
  /[\\/]videos[\\/][^\\/]+[\\/].+\.(png|jpe?g|webp)$/i,
];
const MEDIA_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp4: 'video/mp4',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
/** 008: âm thanh phát trong app (thẻ giọng, explorer) — đọc qua IPC thành blob, chỉ các file này. */
const AUDIO_OK = [
  /[\\/]voices[\\/]vo_[0-9a-z]{8}[\\/][^\\/]+\.wav$/i,
  /[\\/]videos[\\/][^\\/]+[\\/].+\.(wav|mp3|m4a|ogg|flac)$/i,
  /[\\/]music[\\/]files[\\/][^\\/]+\.(wav|mp3|m4a|ogg|flac)$/i,
  /[\\/]uploads[\\/][^\\/]+\.(wav|mp3|m4a|ogg|flac)$/i,
];
const AUDIO_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};
const AUDIO_MAX_BYTES = 80 * 1024 * 1024;
ipcMain.handle('media:audio', (_e, p: string) => {
  const abs = path.normalize(String(p));
  if (!AUDIO_OK.some((r) => r.test(abs)) || abs.includes('..'))
    throw new Error(`not a playable audio file: ${abs}`);
  if (!existsSync(abs)) throw new Error(`file not found: ${abs}`);
  if (statSync(abs).size > AUDIO_MAX_BYTES) throw new Error('audio file too large to play in app');
  return {
    mime: AUDIO_TYPES[path.extname(abs).slice(1).toLowerCase()] ?? 'audio/wav',
    data: readFileSync(abs),
  };
});

function registerMedia(): void {
  protocol.handle('sf-media', (req) => {
    const abs = path.normalize(decodeURI(new URL(req.url).pathname).replace(/^\/+/, ''));
    if (!MEDIA_OK.some((r) => r.test(abs)) || abs.includes('..') || !existsSync(abs))
      return new Response(null, { status: 404 });
    // hỗ trợ Range để <audio> biết thời lượng và tua được
    const size = statSync(abs).size;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '');
    const start = m?.[1] ? Number(m[1]) : 0;
    const end = m?.[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    const body = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream;
    return new Response(body, {
      status: m ? 206 : 200,
      headers: {
        'Content-Type':
          MEDIA_TYPES[path.extname(abs).slice(1).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        ...(m ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      },
    });
  });
}
// 055: thêm token Telegram và OAuth client YouTube; tên động `oauth:…` chỉ đi qua cầu thông điệp (secret-bridge)
const SECRET_NAMES = STATIC_SECRETS;
const MAX_RESTARTS = 3;

let win: BrowserWindow | undefined;
let core: UtilityProcess | undefined;
let restarts = 0;
let quitting = false;
// 045: đóng cửa sổ khi còn việc chạy dở → hỏi người dùng (qua giao diện) trước
let closeConfirmed = false;
let closeTimer: NodeJS.Timeout | undefined;
// 052: chạy nền ở khay hệ thống + chống ngủ máy khi Autopilot đang sản xuất
let quitRequested = false;
let tray: Tray | undefined;
let blocker: number | undefined;
let apState = { background: false, producing: false, paused: false, any: false };
const startHidden = process.argv.includes('--hidden');

/** Bí mật đọc ở `main` (D5 mục 5.4) rồi chuyển cho core; renderer không thấy giá trị. */
// 058: không dùng Credential Manager (test / máy không phải Windows) → kho trong bộ nhớ của tiến trình
const NO_CREDMAN = process.platform !== 'win32' || process.env.SF_NO_CREDMAN === '1';
const memSecrets = new Map<string, string>();
const secretBackend = NO_CREDMAN
  ? {
      get: (n: string) => memSecrets.get(n),
      set: (n: string, v: string) => void memSecrets.set(n, v),
      delete: (n: string) => memSecrets.delete(n),
    }
  : { get: secretGet, set: secretSet, delete: secretDelete };

/** Bí mật tĩnh cho core — một lần gọi PowerShell cho mọi tên (058: không đứng giao diện). */
function readSecrets(): Record<string, string> {
  const out: Record<string, string> = {};
  if (NO_CREDMAN) {
    for (const [n, v] of memSecrets) if (SECRET_NAMES.includes(n)) out[n] = v;
    return out;
  }
  try {
    for (const [n, v] of Object.entries(secretGetMany(SECRET_NAMES))) if (v) out[n] = v;
  } catch {
    /* Credential Manager không đọc được → bỏ qua */
  }
  return out;
}

/** Tiến trình `core` (tech-defaults: utilityProcess) + MessagePort renderer ↔ core. */
function startCore(): void {
  const entry = createRequire(import.meta.url).resolve('@studioflow/core/host-entry');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[0] !== 'ELECTRON_RUN_AS_NODE' && e[1] !== undefined,
    ),
  );
  core = utilityProcess.fork(entry, [], { serviceName: 'studioflow-core', env, stdio: 'inherit' });
  const { port1, port2 } = new MessageChannelMain();
  core.postMessage(
    {
      type: 'init',
      appDataDir: appData.dir,
      secrets: {},
    },
    [port1],
  );
  const send = () => win?.webContents.postMessage('core-port', null, [port2]);
  if (win?.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
  // 055: core hỏi bí mật qua thông điệp (kho bí mật `SecretStore`); chỉ main chạm Credential Manager
  core.on('message', (m: unknown) => {
    const reply = handleSecretRequest(m, secretBackend);
    if (reply) core?.postMessage(reply);
  });
  core.on('exit', (code) => {
    if (quitting) return;
    win?.webContents.send('core-status', { ok: false, code });
    // `core` mất kết nối → khởi động lại tối đa 3 lần (FN-008 mục 4)
    if (restarts++ < MAX_RESTARTS) startCore();
  });
  // bí mật nạp sau khi cửa sổ hiện (Credential Manager chậm ~1 s)
  setTimeout(() => core?.postMessage({ type: 'secrets', secrets: readSecrets() }), 50);
}

/** Biểu tượng khay vẽ bằng mã (không cần file ảnh): ô vuông bo góc màu nhấn, chấm trắng khi đang làm. */
function trayIcon(producing: boolean): NativeImage {
  const n = 32;
  const buf = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const r = 6;
      const cx = Math.min(Math.max(x, r), n - 1 - r);
      const cy = Math.min(Math.max(y, r), n - 1 - r);
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      const dot = producing && (x - 23) ** 2 + (y - 23) ** 2 <= 25;
      // BGRA
      buf[i] = dot ? 255 : 0xde;
      buf[i + 1] = dot ? 255 : 0x6f;
      buf[i + 2] = dot ? 255 : 0x2f;
      buf[i + 3] = inside ? 255 : 0;
    }
  return nativeImage.createFromBitmap(buf, { width: n, height: n });
}

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Khay hệ thống (052): mở cửa sổ, tạm dừng / tiếp tục Autopilot, thoát hẳn. */
function updateTray(): void {
  if (!apState.any && !(win && !win.isVisible())) {
    tray?.destroy();
    tray = undefined;
    return;
  }
  tray ??= new Tray(trayIcon(apState.producing));
  tray.setImage(trayIcon(apState.producing));
  tray.setToolTip(
    `StudioFlow — Autopilot ${apState.paused ? 'tạm dừng' : apState.producing ? 'đang làm video' : 'đang chờ'}`,
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mở StudioFlow', click: showWindow },
      {
        label: apState.paused ? 'Tiếp tục Autopilot' : 'Tạm dừng Autopilot',
        enabled: apState.any,
        click: () => win?.webContents.send('tray:action', apState.paused ? 'resume' : 'pause'),
      },
      { type: 'separator' },
      {
        label: 'Thoát hẳn',
        click: () => {
          quitRequested = true;
          showWindow();
          win?.close();
        },
      },
    ]),
  );
  tray.removeAllListeners('click');
  tray.on('click', showWindow);
}

function createWindow(): void {
  win = new BrowserWindow({
    show: !startHidden,
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    title: 'StudioFlow',
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.on('close', (e) => {
    if (closeConfirmed || !win || win.webContents.isCrashed()) return;
    e.preventDefault();
    win.webContents.send('app:close-request', { quit: quitRequested });
    // giao diện không trả lời (treo) → vẫn đóng
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      closeConfirmed = true;
      win?.close();
    }, 4000);
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(here, '../renderer/index.html'));
}

// Phiên bản lấy từ API của core (constitution Điều II), không tính ở UI.
ipcMain.handle('core:version', () => getVersion());
ipcMain.handle('app:boot', () => ({ open_channel: process.env.SF_OPEN_CHANNEL ?? null }));
ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:files', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('shell:open', (_e, p: string) => shell.openPath(p));
// 058: "Mở thư mục" sau khi render — chọn sẵn video trong File Explorer
ipcMain.handle('shell:reveal', (_e, p: string) => {
  if (!existsSync(p)) return false;
  shell.showItemInFolder(path.resolve(p));
  return true;
});
ipcMain.handle('app:close-reply', (_e, r: 'asking' | 'close' | 'stay' | 'hide') => {
  clearTimeout(closeTimer);
  if (r === 'hide') {
    // 052: chạy nền — ẩn xuống khay, Autopilot vẫn làm
    win?.hide();
    updateTray();
    return;
  }
  if (r === 'stay') quitRequested = false;
  if (r !== 'close') return;
  closeConfirmed = true;
  win?.close();
});
ipcMain.on('autopilot:state', (_e, s: typeof apState) => {
  apState = s;
  // không cho máy ngủ khi đang sản xuất video
  if (s.producing && blocker === undefined)
    blocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!s.producing && blocker !== undefined) {
    powerSaveBlocker.stop(blocker);
    blocker = undefined;
  }
  updateTray();
});
ipcMain.handle('app:autostart-get', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('app:autostart-set', (_e, on: boolean) => {
  app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('secrets:status', () => {
  if (NO_CREDMAN)
    return SECRET_NAMES.map((n) => {
      const v = memSecrets.get(n);
      return { name: n, hint: v ? `…${v.slice(-4)}` : null };
    });
  // một lần đọc cho mọi tên (bộ nhớ đệm), rồi gợi ý 4 ký tự cuối
  try {
    secretGetMany(SECRET_NAMES);
  } catch {
    /* đọc lẻ bên dưới */
  }
  return SECRET_NAMES.map((n) => ({ name: n, hint: secretHint(n) }));
});
ipcMain.handle('secrets:set', (_e, name: string, value: string) => {
  if (!SECRET_NAMES.includes(name)) throw new Error(`unknown secret ${name}`);
  secretBackend.set(name, value);
  core?.postMessage({ type: 'secrets', secrets: readSecrets() });
  const v = secretBackend.get(name);
  return { name, hint: v ? `…${v.slice(-4)}` : null };
});
ipcMain.handle('secrets:delete', (_e, name: string) => {
  const ok = Boolean(secretBackend.delete(name));
  core?.postMessage({ type: 'secrets', secrets: readSecrets() });
  return { name, deleted: ok };
});

// 008: một bản app cho mỗi thư mục dữ liệu — hai core cùng DB thì core sau `recover()` đánh dấu job
// đang chạy của core trước là lỗi và có thể chạy chồng job của nó. Khóa theo userData = app-data.
// 069: thư mục dữ liệu riêng `%APPDATA%\StudioFlow Agent` (chuyển một lần từ `%APPDATA%\StudioFlow`)
const appData = resolveAppDataDir(process.env);
if (appData.migrated) console.log(`[app-data] moved to ${appData.dir}`);
if (appData.error) console.warn(`[app-data] could not move the old folder: ${appData.error}`);
app.setPath('userData', appData.dir);
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', () => {
  // mở app lần nữa (kể cả khi đang chạy nền ở khay) → hiện cửa sổ
  showWindow();
});

if (primary)
  void app.whenReady().then(() => {
    registerMedia();
    createWindow();
    startCore();
    // 052: khởi động cùng Windows (`--hidden`) → chỉ hiện ở khay
    if (startHidden) updateTray();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

app.on('before-quit', (e) => {
  // thoát bằng phím tắt/menu → đi qua bước hỏi của cửa sổ như bấm nút đóng
  if (!closeConfirmed && win && !win.isDestroyed()) {
    e.preventDefault();
    quitRequested = true;
    win.close();
    return;
  }
  quitting = true;
  core?.kill();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
