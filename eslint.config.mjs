import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const nodeBuiltins = [
  'fs',
  'path',
  'os',
  'child_process',
  'crypto',
  'net',
  'http',
  'https',
  'url',
  'util',
  'stream',
  'events',
].map((name) => ({ name, message: 'No Node APIs here.' }));

export default defineConfig(
  globalIgnores([
    'out/**',
    'dist/**',
    'release/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'node_modules/**',
  ]),
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: globals.browser },
    rules: {
      // Renderers reach the main process only through window.drashti.
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'Use window.drashti (the preload bridge).' }, ...nodeBuiltins],
          patterns: [
            { group: ['node:*'], message: 'No Node APIs in renderers.' },
            {
              group: ['**/main/**', '**/preload/**'],
              message: 'Renderers import only src/shared and src/renderer.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/main/**', 'src/preload/**', 'tests/**', 'scripts/**', 'tools/**', '*.config.*'],
    languageOptions: { globals: globals.node },
  },
  {
    // The shared contracts run in every process: no Node, DOM or Electron.
    files: ['src/shared/**'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'Shared code runs in every process.' }, ...nodeBuiltins],
          patterns: [
            { group: ['node:*'], message: 'Shared code runs in every process.' },
            {
              group: ['**/main/**', '**/preload/**', '**/renderer/**'],
              message: 'Shared code imports only shared code.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
