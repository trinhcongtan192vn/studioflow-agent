import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    // core được bundle vào main để bản cài không phụ thuộc symlink workspace.
    plugins: [externalizeDepsPlugin({ exclude: ['@studioflow/core'] })],
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
