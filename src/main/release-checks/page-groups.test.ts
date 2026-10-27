import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type BridgePage, bridgeFor, PAGE_GROUPS, pageOf } from '../../preload/page-groups';

/*
 * A narrower bridge (Sessions 31–36, ARCH-7): each window's page gets only the bridge's groups its own code
 * uses. Each page's code is walked from its entry (its imports, not type-only ones) and every group it
 * reaches through the bridge is read (window.drashti.<group>, and render/'s `bridge` taken from
 * globalThis): the table must be exactly that, so no page misses a group it uses (it would break as it
 * loads) and none gets one it does not. The preload gives each page its own groups only.
 */

const APP = join(__dirname, '..', '..', '..');
const RENDERER = join(APP, 'src', 'renderer', 'src');

/** Each page's entry, as its HTML file names it. */
const ENTRIES: Record<BridgePage, string> = {
  index: 'operator/main.tsx',
  output: 'output/main.tsx',
  audio: 'audio/main.ts',
  stream: 'program/main.tsx',
  node: 'node/main.tsx',
  pdf: 'pictures/main.ts',
  sharpen: 'sharpen/main.ts',
  gallery: 'gallery/main.tsx',
  zoom: 'zoom/main.tsx',
  'access-list': 'access-list/main.tsx',
};

const IMPORT =
  /^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"](\.[^'"]+)['"]|^\s*import\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/gmu;

function resolveFrom(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const file of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')])
    if (/\.tsx?$/u.test(file) && existsSync(file) && statSync(file).isFile()) return file;
  return null;
}

/** Every file of ours a page's code reaches from its entry. */
function reached(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [entry];
  for (let file = todo.pop(); file !== undefined; file = todo.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3];
      const next = spec ? resolveFrom(file, spec) : null;
      if (next) todo.push(next);
    }
  }
  return seen;
}

/** The bridge's groups those files use. */
function groupsUsed(files: Iterable<string>): string[] {
  const groups = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/window\.drashti\.([a-zA-Z]+)/gu)) groups.add(m[1] ?? '');
    if (text.includes('const bridge = (globalThis as { drashti?: DrashtiBridge }).drashti;'))
      for (const m of text.matchAll(/\bbridge\??\.([a-zA-Z]+)/gu)) groups.add(m[1] ?? '');
  }
  return [...groups].sort();
}

describe('a narrower bridge (ARCH-7)', () => {
  it('gives each page exactly the groups its code uses, walked from its entry', () => {
    for (const [page, entry] of Object.entries(ENTRIES) as [BridgePage, string][])
      expect(groupsUsed(reached(join(RENDERER, entry))), page).toEqual([...PAGE_GROUPS[page]].sort());
  });

  it("knows each page by its address, and gives a page that is not Drashti's nothing", () => {
    expect(
      pageOf('file:///Applications/Drashti.app/Contents/Resources/app.asar/out/renderer/output.html?x=1'),
    ).toBe('output');
    expect(
      pageOf('file:///C:/Users/x/AppData/Local/Programs/Drashti/resources/app.asar/out/renderer/index.html'),
    ).toBe('index');
    // Vite's root in development is the operator window's page.
    expect(pageOf('http://localhost:5173/')).toBe('index');
    expect(pageOf('http://localhost:5173/audio.html')).toBe('audio');
    expect(pageOf('file:///x/out/renderer/remote.html')).toBeNull();
    expect(pageOf('about:blank')).toBeNull();
    expect(pageOf('not an address')).toBeNull();
    const everything = { app: 1, engine: 2, node: 3, sharpen: 4, library: 5 };
    expect(bridgeFor(everything, 'node')).toEqual({ app: 1, node: 3 });
    expect(bridgeFor(everything, null)).toEqual({});
  });

  it('is what the preload gives each page: its own groups only', () => {
    const preload = readFileSync(join(APP, 'src', 'preload', 'index.ts'), 'utf8');
    expect(preload).toMatch(
      /contextBridge\.exposeInMainWorld\('drashti', bridgeFor\(bridge, pageOf\(here\)\)\);/u,
    );
    expect(preload).not.toContain("contextBridge.exposeInMainWorld('drashti', bridge);");
  });
});
