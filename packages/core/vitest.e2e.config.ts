import { defineConfig } from 'vitest/config';

// E2E từng workflow (luồng v2 dùng chung): chạy khi sửa luồng dựng — `npm run test:e2e`.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 30_000,
  },
});
