import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { getVersion } from '@studioflow/core';

const here = path.dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'StudioFlow',
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(here, '../renderer/index.html'));
  }
}

// Phiên bản lấy từ API của core (constitution Điều II), không tính ở UI.
ipcMain.handle('core:version', () => getVersion());

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
