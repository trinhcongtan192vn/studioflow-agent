import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    // core được bundle vào main để bản cài không phụ thuộc symlink workspace.
    plugins: [externalizeDepsPlugin({ exclude: ['@studioflow/core'] })],
    // phụ thuộc tùy chọn của `ws` (qua puppeteer-core của core, 030): để ngoài bundle, `ws` tự bỏ qua khi thiếu
    build: { rollupOptions: { external: ['bufferutil', 'utf-8-validate'] } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
