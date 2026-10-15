// What the audience sees, against an earlier commit (Session 26g): builds <ref> in a worktree beside
// this one, runs tests/e2e/audience-pixels.spec.ts on that build and then on this one, and fails if
// any picture of an output, a stage screen, the stream or the stage display in a browser differs.
//
//   node scripts/audience-pixels.mjs 69a0887
//
// The pictures stay in the folder it prints (placeholder slides and generated pictures only). This
// build must already be built (`pnpm build`). The worktree (in .pixels-*, removed at the end)
// borrows this one's node_modules through a link, which is removed first and never followed.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ref = process.argv[2];
if (!ref) {
  console.error('Usage: node scripts/audience-pixels.mjs <earlier commit>');
  process.exit(2);
}
const here = resolve('.');
// The earlier build sits inside this folder (ignored by git), on the same drive as node_modules:
// Vite cannot build across Windows drives (CI's temporary folder is on C:, the checkout on D:).
const work = mkdtempSync(join(here, '.pixels-'));
const base = join(work, 'base');
const frames = join(mkdtempSync(join(tmpdir(), 'drashti-pixels-')), 'frames');
const node = process.execPath;
const bin = (name) => join(here, 'node_modules', name);

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${String(r.status ?? r.signal)})`);
}

let linked = false;
let failed;
try {
  execFileSync('git', ['worktree', 'add', '--detach', base, ref], { stdio: 'inherit' });
  symlinkSync(join(here, 'node_modules'), join(base, 'node_modules'), 'junction');
  linked = true;
  // Its own electron-vite, called directly: never pnpm inside a worktree whose node_modules is a link.
  run(node, [bin('electron-vite/bin/electron-vite.js'), 'build'], { cwd: base });
  const spec = 'tests/e2e/audience-pixels.spec.ts';
  const playwright = bin('@playwright/test/cli.js');
  run(node, [playwright, 'test', spec], {
    env: { ...process.env, DRASHTI_E2E_APP_DIR: base, DRASHTI_PIXELS_OUT: join(frames, 'before') },
  });
  const now = spawnSync(node, [playwright, 'test', spec], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DRASHTI_PIXELS_OUT: join(frames, 'now'),
      DRASHTI_PIXELS_BASE: join(frames, 'before'),
    },
  });
  failed = now.status !== 0;
} catch (e) {
  console.error(String(e));
  failed = true;
} finally {
  if (linked) {
    // The link only: unlink on macOS, rmdir for a Windows junction. Neither follows it.
    try {
      unlinkSync(join(base, 'node_modules'));
    } catch {
      rmdirSync(join(base, 'node_modules'));
    }
  }
  spawnSync('git', ['worktree', 'remove', '--force', base], { stdio: 'inherit' });
  rmSync(work, { recursive: true, force: true });
  console.log(`The pictures: ${frames}`);
}
process.exit(failed ? 1 : 0);
