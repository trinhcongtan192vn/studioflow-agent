import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // e2e từng workflow (render thật, ~1,5–2 phút mỗi cái, chạy tuần tự) không vào verify: `npm run test:e2e`.
    // verify giữ một e2e đại diện (tests/integration/shorts.test.ts) — mọi workflow dùng chung một luồng dựng.
    exclude: ['tests/e2e/**', '**/node_modules/**'],
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/contracts/**', 'src/testing/**'],
      thresholds: { lines: 80 },
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
