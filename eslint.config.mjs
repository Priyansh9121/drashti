import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import textCut from './tools/eslint/text-cut.mjs';

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
    // The bundled programs (FFmpeg, yt-dlp, Deno), fetched, never ours to lint.
    'vendor/**',
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
      // Type-only imports must vanish from the bundle (a sandboxed preload must stay tiny).
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Words are cut with cutText, never inside a letter (Sessions 31–36, I18N-5; tools/eslint/text-cut.mjs).
    // Allowed by name: ids and codes, and cuts at a character the code found. [file, the call, why].
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', 'src/main/**/testing/**'],
    plugins: { drashti: { rules: { 'text-cut': textCut } } },
    rules: {
      'drashti/text-cut': [
        'error',
        {
          allow: [
            // Ids and codes.
            ['src/main/arti/arti-service.ts', 'toTimeString().slice(0, 5)', 'a time, as 13:05'],
            ['src/main/backup/scheduled-backups.ts', 'toTimeString().slice(0, 5)', 'a time, as 13:05'],
            ['src/main/macros/macro-scheduler.ts', 'toTimeString().slice(0, 5)', 'a time, as 13:05'],
            ['src/main/nodes/certificate.ts', '.slice(0, 14)', 'a certificate’s time, as 20261017093000'],
            ['src/shared/calendar.ts', 'toISOString().slice(0, 10)', 'a date, as 2026-10-17'],
            ['src/main/import/formats/pp6.ts', '.slice(0, 7)', 'a colour, #rrggbb'],
            ['src/main/import/formats/pp7.ts', '.slice(0, 7)', 'a colour, #rrggbb'],
            ['src/main/library/themes.ts', 'background.slice(0, 7)', 'a colour, #rrggbb'],
            [
              'src/renderer/src/editor/Inspector.tsx',
              '.slice(0, 7)',
              'a colour, #rrggbb without its opacity',
            ],
            ['src/renderer/src/editor/SlidePanel.tsx', 'background.slice(0, 7)', 'a colour, #rrggbb'],
            [
              'src/main/import/media-store.ts',
              'sha256.slice(0, 2)',
              'a hash’s first two letters, its folder',
            ],
            ['src/main/import/stand-in-converter.ts', 'hash.slice(0, ', 'a hash'],
            ['src/main/index.ts', "(a.mediaId ?? '-').slice(0, 8)", 'a media id’s start, for the log'],
            [
              'src/renderer/src/network/NetworkPanel.tsx',
              'code.slice(0, 3)',
              'a pairing code, in two halves',
            ],
            [
              'src/renderer/src/screens/NodesSection.tsx',
              'code.slice(0, 3)',
              'a pairing code, in two halves',
            ],
            ['src/shared/nodes.ts', '.slice(0, 16)', 'a fingerprint’s hex letters'],
            ['src/main/nodes/link-server.ts', 'version.slice(0, 40)', 'a version, as 1.0.0-alpha.6'],
            ['src/main/network/addresses.ts', 'a.slice(0, zone)', 'an address without its zone'],
            // Cut at a character the code found.
            ['src/main/convert/trim.ts', 'name.slice(0, dot)', 'a file’s name before its extension’s dot'],
            ['src/main/links/unzip.ts', 'leaf.slice(0, dot)', 'a file’s name before its extension’s dot'],
            ['src/renderer/src/playlists/add-made.tsx', 'last.slice(0, dot)', 'a file’s name before its dot'],
            [
              'src/main/links/names.ts',
              'name.slice(0, name.length - ext.length)',
              'a file’s name before its extension',
            ],
            ['src/main/stream/worker/progress.ts', 'buffer.slice(0, at)', 'FFmpeg’s output up to a newline'],
            [
              'src/main/import/rtf/rtf.ts',
              'style.slice(0, -slant[0].length)',
              'a font’s name without its style',
            ],
            ['src/main/import/rtf/rtf.ts', '.slice(0, dash)', 'a font’s name before its dash'],
            ['src/shared/translit.ts', 'line.slice(0, at)', 'a line up to the letter made a capital'],
            [
              'src/main/import/formats/docx.ts',
              'run.text.slice(0, run.text.length - cut)',
              'spaces taken off the end',
            ],
          ],
        },
      ],
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
    // The audience screens' motion (Session 27; docs/design.md, "Audience screens' motion"): what the hall's
    // screens, the nodes, the stream and the stage display draw is a pure function of the engine's state and
    // the engine's time, so every screen draws the same frame at the same moment. No computer clock, no
    // chance, no CSS motion; a timer or a Web Animation only where it never decides a frame (seeked from the
    // engine's time). The few lines that may are allowed one by one, each with its reason beside it.
    files: [
      'src/renderer/src/render/**/*.{ts,tsx}',
      'src/renderer/src/output/**/*.{ts,tsx}',
      'src/renderer/src/program/**/*.{ts,tsx}',
      'src/renderer/src/web/stage/**/*.{ts,tsx}',
      'src/shared/idle.ts',
      'src/shared/picture-look.ts',
    ],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...[
          ['Date', 'now'],
          ['performance', 'now'],
          ['performance', 'timeOrigin'],
        ].map(([object, property]) => ({
          object,
          property,
          message: "The audience screens run on the engine's clock: use engineNow() (render/clock.ts).",
        })),
        { object: 'Math', property: 'random', message: 'Every screen must draw the same frame: no chance.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "NewExpression[callee.name='Date'][arguments.length=0], CallExpression[callee.name='Date']",
          message: "A date with no time given reads the computer's clock: give it engineNow().",
        },
        {
          selector:
            'Property[key.name=/^(transition|animation)/][value.type=/^(Literal|TemplateLiteral)$/], Property[key.value=/^(transition|animation)/][value.type=/^(Literal|TemplateLiteral)$/], AssignmentExpression[left.property.name=/^(transition|animation)/]',
          message: "No CSS transition or animation on the audience screens: draw from the engine's time.",
        },
        {
          selector: "CallExpression[callee.property.name='animate']",
          message: "A Web Animation only when seeked from the engine's time: allow the line, saying how.",
        },
        {
          selector:
            'CallExpression[callee.name=/^(setTimeout|setInterval|requestIdleCallback)$/], CallExpression[callee.object.name=/^(window|globalThis)$/][callee.property.name=/^(setTimeout|setInterval|requestIdleCallback)$/]',
          message: "A timer never decides a frame: allow the line, saying why it doesn't.",
        },
      ],
    },
  },
  {
    files: ['src/main/**', 'src/preload/**', 'tests/**', 'scripts/**', 'tools/**', '*.config.*'],
    languageOptions: { globals: globals.node },
  },
  {
    // End-to-end tests wait for a condition, never for a while (Sessions 31–36, TST-6, TST-7): where time
    // itself is tested, or something must not happen, or Drashti must have saved the show before it is
    // stopped dead, tests/e2e/helpers.ts says so (letTimePass, holdStill, savedLive, nodeSaved).
    files: ['tests/e2e/**/*.ts'],
    ignores: ['tests/e2e/helpers.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='waitForTimeout']",
          message:
            'Wait for a condition (a locator, expect.poll), or say why time must pass: letTimePass, holdStill, savedLive or nodeSaved (tests/e2e/helpers.ts).',
        },
        {
          selector:
            "NewExpression[callee.name='Promise'] CallExpression[callee.name='setTimeout'][arguments.0.type='Identifier']",
          message:
            'A sleep: wait for a condition (expect.poll), or say why time must pass: letTimePass or holdStill (tests/e2e/helpers.ts).',
        },
      ],
    },
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
