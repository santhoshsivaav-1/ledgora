import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    '**/coverage/**',
    '**/.turbo/**',
    'docs-site/out/**',
    'data/**',
    'Saved Invoices/**',
    'Trash/**',
  ]),

  // Browser app. Still plain JS/JSX; migrated to TypeScript feature by feature in Phase 3.
  {
    files: ['apps/web/src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: { ecmaVersion: 'latest', ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { varsIgnorePattern: '^[A-Z_]', ignoreRestSiblings: true, caughtErrors: 'none' },
      ],
      // React-Compiler diagnostics shipped in eslint-plugin-react-hooks v7. The legacy UI predates
      // them (they were already failing before the monorepo move), so they stay visible as
      // warnings and are fixed as each feature is rewritten in Phase 3.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/refs': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },

  // Node code: build and test scripts, tool configs.
  {
    files: [
      'apps/web/scripts/**/*.{js,mjs}',
      'apps/web/vite.config.js',
      'apps/web/vitest.config.js',
      'apps/web/test/**/*.{js,mjs}',
      'packages/*/test/**/*.{js,mjs}',
      'packages/*/vitest.config.js',
      'docs-site/**/*.mjs',
      'eslint.config.js',
    ],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { ignoreRestSiblings: true, caughtErrors: 'none' }],
    },
  },

  // The browser tests also run callbacks inside the page (document, window, ...).
  {
    files: ['apps/web/scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // TypeScript in packages/ and apps/ (new code).
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },

  // The income-tax maths moved over from JavaScript unchanged and is still loosely typed (change 3.18).
  {
    files: ['packages/tax-engine/src/itr.ts'],
    rules: { '@typescript-eslint/ban-ts-comment': 'off' },
  },

  // API tests read loosely typed JSON bodies; typing every response would only restate the contracts.
  {
    files: ['apps/api/test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
]);
