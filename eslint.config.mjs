import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      'release/**',
      'workers/**',
      '.specify/**',
      '.claude/**',
      '**/test-results/**',
      'scripts/tests/fixtures/**',
      'packages/core/src/contracts/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Ranh giới Điều II: desktop chỉ dùng API công khai của core (001 FR-SC-002b).
    files: ['apps/desktop/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@studioflow/core/(?!cli$)',
              message: 'Chỉ import "@studioflow/core" (API công khai), không import nội bộ core.',
            },
            {
              regex: '(^|/)packages/core(/|$)',
              message: 'Không import core qua đường dẫn tương đối; dùng "@studioflow/core".',
            },
          ],
        },
      ],
    },
  },
);
