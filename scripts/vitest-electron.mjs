// Runs Vitest inside Electron's own Node.js (ELECTRON_RUN_AS_NODE), so unit
// tests use exactly the Node, V8 and native-module ABI that ship in the app.
// The run gets one temporary folder (scripts/temp-root.mjs), removed at the end.
//   node scripts/vitest-electron.mjs run [vitest args]
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { makeTempRoot, removeTempRoot, tempEnv } from './temp-root.mjs';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const vitestCli = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

const root = makeTempRoot();
const result = spawnSync(electronBinary, [vitestCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ...tempEnv(root), ELECTRON_RUN_AS_NODE: '1' },
});
removeTempRoot(root);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
