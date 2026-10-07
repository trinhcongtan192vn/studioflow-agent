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
  MessageChannelMain,
  protocol,
  shell,
  utilityProcess,
  type UtilityProcess,
} from 'electron';
import { getVersion, secretDelete, secretGet, secretHint, secretSet } from '@studioflow/core';

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
const SECRET_NAMES = ['openai', 'deepseek', 'anthropic', 'dashscope_api_key', 'youtube_api_key'];
const MAX_RESTARTS = 3;

let win: BrowserWindow | undefined;
let core: UtilityProcess | undefined;
let restarts = 0;
let quitting = false;
// 045: đóng cửa sổ khi còn việc chạy dở → hỏi người dùng (qua giao diện) trước
let closeConfirmed = false;
let closeTimer: NodeJS.Timeout | undefined;

/** Bí mật đọc ở `main` (D5 mục 5.4) rồi chuyển cho core; renderer không thấy giá trị. */
function readSecrets(): Record<string, string> {
  const out: Record<string, string> = {};
  if (process.platform !== 'win32' || process.env.SF_NO_CREDMAN === '1') return out;
  for (const n of SECRET_NAMES) {
    try {
      const v = secretGet(n);
      if (v) out[n] = v;
    } catch {
      /* Credential Manager không đọc được → bỏ qua */
    }
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
      ...(process.env.SF_APP_DATA ? { appDataDir: process.env.SF_APP_DATA } : {}),
      secrets: {},
    },
    [port1],
  );
  const send = () => win?.webContents.postMessage('core-port', null, [port2]);
  if (win?.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
  core.on('exit', (code) => {
    if (quitting) return;
    win?.webContents.send('core-status', { ok: false, code });
    // `core` mất kết nối → khởi động lại tối đa 3 lần (FN-008 mục 4)
    if (restarts++ < MAX_RESTARTS) startCore();
  });
  // bí mật nạp sau khi cửa sổ hiện (Credential Manager chậm ~1 s)
  setTimeout(() => core?.postMessage({ type: 'secrets', secrets: readSecrets() }), 50);
}

function createWindow(): void {
  win = new BrowserWindow({
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
    win.webContents.send('app:close-request');
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
ipcMain.handle('app:close-reply', (_e, r: 'asking' | 'close' | 'stay') => {
  clearTimeout(closeTimer);
  if (r !== 'close') return;
  closeConfirmed = true;
  win?.close();
});
ipcMain.handle('secrets:status', () =>
  SECRET_NAMES.map((n) => ({ name: n, hint: process.platform === 'win32' ? secretHint(n) : null })),
);
ipcMain.handle('secrets:set', (_e, name: string, value: string) => {
  if (!SECRET_NAMES.includes(name)) throw new Error(`unknown secret ${name}`);
  secretSet(name, value);
  core?.postMessage({ type: 'secrets', secrets: readSecrets() });
  return { name, hint: secretHint(name) };
});
ipcMain.handle('secrets:delete', (_e, name: string) => {
  const ok = secretDelete(name);
  core?.postMessage({ type: 'secrets', secrets: readSecrets() });
  return { name, deleted: ok };
});

// 008: một bản app cho mỗi thư mục dữ liệu — hai core cùng DB thì core sau `recover()` đánh dấu job
// đang chạy của core trước là lỗi và có thể chạy chồng job của nó. Khóa theo userData = app-data.
if (process.env.SF_APP_DATA) app.setPath('userData', process.env.SF_APP_DATA);
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

if (primary)
  void app.whenReady().then(() => {
    registerMedia();
    createWindow();
    startCore();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

app.on('before-quit', (e) => {
  // thoát bằng phím tắt/menu → đi qua bước hỏi của cửa sổ như bấm nút đóng
  if (!closeConfirmed && win && !win.isDestroyed()) {
    e.preventDefault();
    win.close();
    return;
  }
  quitting = true;
  core?.kill();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
