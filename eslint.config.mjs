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
