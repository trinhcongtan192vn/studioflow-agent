import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/ui',
  testMatch: '**/*.ui.test.ts',
  timeout: 60_000,
  reporter: 'list',
  outputDir: 'test-results',
});
