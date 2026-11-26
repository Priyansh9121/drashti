import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Playwright loads a spec and every module it imports as CommonJS, through its own transform and require, whatever the
 * file's extension. There `import.meta` is "SyntaxError: Cannot use 'import.meta' outside a module": the spec file does
 * not load and the run says "No tests found". The Intel playback job's first run failed so (alpha.23, a23-intelfix):
 * tests/intel-playback imported scripts/playback-check.mjs, which used import.meta to see whether it was run as a
 * command. So no module Playwright loads may use import.meta: a script that is also a command keeps that part in a file
 * of its own that no test imports (scripts/playback-check-summary.mjs), or knows itself by its name in process.argv
 * (scripts/disk-note.mjs).
 *
 * This walks what Playwright loads for each of the repository's configs (the config, its global setup, the specs under
 * its testDir) through their relative imports; packages are Playwright's own to load. Comments are left out, so a
 * comment may name import.meta.
 */

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(path, 'utf8');
const name = (path: string) => relative(root, path).split(sep).join('/');

const configs = readdirSync(root)
  .filter((f) => /^playwright(\.\w+)?\.config\.ts$/u.test(f))
  .map((f) => join(root, f));
/** Playwright's own default testMatch. */
const SPEC = /\.(spec|test)\.[cm]?[jt]sx?$/u;
/** `from '…'`, `import '…'` and `import('…')` with a relative path. */
const IMPORT = /\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/gu;

const resolveImport = (from: string, path: string): string | null => {
  const base = resolve(dirname(from), path);
  return (
    [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, join(base, 'index.ts')].find(
      (p) => existsSync(p) && statSync(p).isFile(),
    ) ?? null
  );
};

/** Every module Playwright loads for the repository's configs, and the relative imports that found no file. */
function loaded(): { files: Set<string>; unresolved: string[] } {
  const queue: string[] = [];
  for (const config of configs) {
    const text = read(config);
    queue.push(config);
    const setup = /\bglobalSetup: '([^']+)'/u.exec(text)?.[1];
    if (setup) queue.push(join(root, setup));
    const testDir = /\btestDir: '([^']+)'/u.exec(text)?.[1];
    if (testDir)
      queue.push(
        ...readdirSync(join(root, testDir), { recursive: true, withFileTypes: true })
          .filter((e) => e.isFile() && SPEC.test(e.name))
          .map((e) => join(e.parentPath, e.name)),
      );
  }
  const files = new Set<string>();
  const unresolved: string[] = [];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (files.has(file)) continue;
    files.add(file);
    for (const [, path] of read(file).matchAll(IMPORT)) {
      const found = path === undefined ? null : resolveImport(file, path);
      if (found) queue.push(found);
      else unresolved.push(`${name(file)}: ${String(path)}`);
    }
  }
  return { files, unresolved };
}

const withoutComments = (code: string) => code.replace(/\/\*[^]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

describe('the modules Playwright loads', () => {
  const { files, unresolved } = loaded();
  const names = [...files].map(name);

  it('are found: every config, its global setup and its specs, and the scripts they import', () => {
    expect(configs.map(name).sort()).toEqual([
      'playwright.config.ts',
      'playwright.intel.config.ts',
      'playwright.perf.config.ts',
      'playwright.soak.config.ts',
    ]);
    expect(unresolved).toEqual([]);
    for (const file of [
      'tests/global-setup.ts',
      'tests/e2e/helpers.ts',
      'tests/intel-playback/intel-playback.spec.ts',
      'scripts/playback-check.mjs',
      'scripts/disk-note.mjs',
    ])
      expect(names, file).toContain(file);
    expect(names.filter((f) => f.startsWith('tests/e2e/') && SPEC.test(f)).length).toBeGreaterThan(100);
  });

  it('never use import.meta, which Playwright’s CommonJS loading cannot take (the spec then has no tests)', () => {
    const users = [...files].filter((f) => /\bimport\.meta\b/u.test(withoutComments(read(f))));
    expect(users.map(name)).toEqual([]);
    // The check sees import.meta in code, and not in a comment.
    expect(/\bimport\.meta\b/u.test(withoutComments('if (fileURLToPath(import.meta.url) === argv[1]) {}'))).toBe(
      true,
    );
    expect(/\bimport\.meta\b/u.test(withoutComments('// where import.meta is not there\n/* import.meta */'))).toBe(
      false,
    );
  });
});
