import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mediaUrl } from '../../shared/media';
import { openingPhotoUrl } from '../../shared/opening';
import { openingCopyPath } from './opening-files';
import { type OpeningServiceDeps, OpeningService } from './opening-service';

/*
 * The opening in the main process (Session 55, the owner's brief of 3 Nov 2026): decided once a start, the version
 * that started recorded for the next, each photo from its copy at the window's size (its whole file until that is
 * made), File › Opening…'s choices checked whole, and Load the opening pack…. Its words never reach the log.
 * Placeholder words and generated files only.
 */

let dir: string;
const SHA = (n: number) => String(n).repeat(64).slice(0, 64);
const jpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 0xff, 0xd9]);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-opening-service-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function service(
  o: { kept?: unknown; lastVersion?: string | null; boot?: Partial<OpeningServiceDeps['boot']> } = {},
) {
  const store = new Map<string, unknown>();
  if (o.kept !== undefined) store.set('opening', o.kept);
  if (o.lastVersion !== null) store.set('lastStartVersion', o.lastVersion ?? '1.0.0-alpha.14');
  const later: [string, unknown][] = [];
  const lines: string[] = [];
  const imported: string[][] = [];
  // Pictures 1 to 9 are in Media; picture 2's copy is made.
  const pictures = new Map<string, number>(
    Array.from({ length: 9 }, (_, i) => [`photo-${String(i + 1)}`, i + 1]),
  );
  const copies = new Set([SHA(2)]);
  let welcome = false;
  const opening = new OpeningService({
    settings: { get: (name) => store.get(name), set: (name, value) => store.set(name, value) },
    later: (name, value) => later.push([name, value]),
    boot: {
      selfTest: false,
      testNotAsking: false,
      cleanQuit: true,
      restored: false,
      version: '1.0.0-alpha.14',
      ...o.boot,
    },
    picture: (id) => {
      const n = pictures.get(id);
      return n === undefined ? null : { sha256: SHA(n), name: `Placeholder ${String(n)}.jpg` };
    },
    hasCopy: (sha) => copies.has(sha),
    mediaDir: dir,
    welcome: () => welcome,
    importPhotos: (paths) => {
      imported.push(paths);
      return Promise.resolve({ ok: true, ids: paths.map((_, i) => `photo-${String(i + 1)}`) });
    },
    log: (line) => lines.push(line),
  });
  return {
    opening,
    store,
    later,
    lines,
    imported,
    setWelcome: (on: boolean) => {
      welcome = on;
    },
  };
}

const START = { pageAgain: false, sinceWindow: 300 };

describe('as Drashti starts', () => {
  it('plays once, each photo from its copy (its whole file until the copy is made), never naming its words', () => {
    const s = service({
      kept: {
        photos: ['photo-1', 'photo-2', 'not-in-media'],
        lines: ['Placeholder line one', 'Placeholder two'],
      },
    });
    expect(s.opening.atStart(START)).toEqual({
      photos: [mediaUrl('photo-1'), openingPhotoUrl('photo-2')],
      lines: ['Placeholder line one', 'Placeholder two'],
    });
    // Asked again (a page loaded again): no.
    expect(s.opening.atStart({ ...START, pageAgain: true })).toBeNull();
    expect(s.lines).toEqual(['Opening: plays (2 photos, 2 lines; 1 photo no longer in Media left out)']);
    expect(s.lines.join(' ')).not.toContain('Placeholder');
  });

  it('with nothing chosen it plays the lamp', () => {
    const s = service();
    expect(s.opening.atStart(START)).toEqual({ photos: [], lines: [] });
    expect(s.lines).toEqual(['Opening: plays (the lamp, 0 lines)']);
  });

  it('records the version that started for the next start, and never plays at a version’s first start', () => {
    const same = service();
    expect(same.later).toEqual([]);
    const updated = service({ lastVersion: '1.0.0-alpha.13' });
    expect(updated.later).toEqual([['lastStartVersion', '1.0.0-alpha.14']]);
    expect(updated.opening.atStart(START)).toBeNull();
    expect(updated.lines).toEqual(['Opening: not played (at the first start of 1.0.0-alpha.14)']);
    const first = service({ lastVersion: null });
    expect(first.later).toEqual([['lastStartVersion', '1.0.0-alpha.14']]);
    expect(first.opening.atStart(START)).toBeNull();
  });

  it('never after an unexpected stop, nor with the welcome, nor turned off', () => {
    const crash = service({ boot: { cleanQuit: false } });
    expect(crash.opening.atStart(START)).toBeNull();
    expect(crash.lines).toEqual(['Opening: not played (after an unexpected stop)']);
    const welcome = service();
    welcome.setWelcome(true);
    expect(welcome.opening.atStart(START)).toBeNull();
    const off = service({ kept: { on: false } });
    expect(off.opening.atStart(START)).toBeNull();
    expect(off.lines).toEqual(['Opening: not played (turned off in File › Opening…)']);
  });
});

describe('File › Opening…', () => {
  it('shows each photo, whether its copy is made and whether it left Media, and the lines', () => {
    const s = service({ kept: { photos: ['photo-2', 'photo-3', 'gone-1'], lines: ['Placeholder'] } });
    expect(s.opening.view()).toEqual({
      on: true,
      photos: [
        { mediaId: 'photo-2', name: 'Placeholder 2.jpg', ready: true, gone: false },
        { mediaId: 'photo-3', name: 'Placeholder 3.jpg', ready: false, gone: false },
        { mediaId: 'gone-1', name: '', ready: false, gone: true },
      ],
      lines: ['Placeholder'],
    });
  });

  it('keeps photos and lines checked whole: a picture in Media only, lines made tidy, empty ones left out', () => {
    const s = service({ kept: { on: false } });
    const kept = s.opening.setChoice({
      photos: ['photo-3', 'photo-1'],
      lines: ['  Placeholder  one ', '', 'Two'],
    });
    expect(kept).toMatchObject({ ok: true, view: { on: false, lines: ['Placeholder one', 'Two'] } });
    expect(s.store.get('opening')).toEqual({
      on: false,
      photos: ['photo-3', 'photo-1'],
      lines: ['Placeholder one', 'Two'],
    });
    for (const bad of [
      { photos: ['not-in-media'], lines: [] },
      { photos: Array.from({ length: 9 }, (_, i) => `photo-${String(i + 1)}`), lines: [] },
      { photos: [], lines: ['1', '2', '3', '4', '5', '6'] },
      { photos: 'photo-1', lines: [] },
      null,
    ])
      expect(s.opening.setChoice(bad)).toMatchObject({ ok: false });
    expect(s.store.get('opening')).toEqual({
      on: false,
      photos: ['photo-3', 'photo-1'],
      lines: ['Placeholder one', 'Two'],
    });
    expect(s.opening.setOn(true)).toMatchObject({ ok: true, view: { on: true } });
    expect(s.lines).toEqual(['Opening: turned on']);
  });

  it('Load the opening pack…: its eight photos into Media, in order, and they and its lines replace what was chosen', async () => {
    const s = service({ kept: { on: false, photos: ['photo-9'], lines: ['Placeholder old'] } });
    const root = join(dir, 'pack');
    mkdirSync(join(root, 'photos'), { recursive: true });
    for (let n = 1; n <= 8; n++) writeFileSync(join(root, 'photos', `${String(n)}.jpg`), jpeg());
    writeFileSync(
      join(root, 'words.txt'),
      ['One', 'Two', 'Three', 'Four', 'Five'].map((w) => `Placeholder ${w}`).join('\n'),
    );
    const loaded = await s.opening.loadPack(root);
    expect(s.imported).toEqual([
      Array.from({ length: 8 }, (_, i) => join(root, 'photos', `${String(i + 1)}.jpg`)),
    ]);
    expect(loaded).toMatchObject({ ok: true, view: { on: false } });
    expect(s.store.get('opening')).toEqual({
      on: false,
      photos: Array.from({ length: 8 }, (_, i) => `photo-${String(i + 1)}`),
      lines: [
        'Placeholder One',
        'Placeholder Two',
        'Placeholder Three',
        'Placeholder Four',
        'Placeholder Five',
      ],
    });
    expect(s.lines).toEqual(["Opening: the opening pack's 8 photos and 5 lines are the opening's now"]);
  });

  it('a pack that is not complete says what it is missing, and nothing is brought in or changed', async () => {
    const s = service({ kept: { photos: ['photo-9'], lines: ['Placeholder old'] } });
    const root = join(dir, 'pack');
    mkdirSync(join(root, 'photos'), { recursive: true });
    for (let n = 1; n <= 7; n++) writeFileSync(join(root, 'photos', `${String(n)}.jpg`), jpeg());
    writeFileSync(join(root, 'words.txt'), 'Placeholder\n');
    expect(await s.opening.loadPack(root)).toEqual({
      ok: false,
      message:
        'The opening pack is missing photo 8 (photos/8.jpg), and has 1 line of the 5 in words.txt. Nothing was changed.',
    });
    expect(s.imported).toEqual([]);
    expect(s.store.get('opening')).toEqual({ photos: ['photo-9'], lines: ['Placeholder old'] });
  });

  it('keeps a photo’s copy for the opening under its sha256, for a picture in Media only', async () => {
    const s = service();
    expect(await s.opening.saveCopy('photo-4', jpeg())).toEqual({ ok: true });
    expect(new Uint8Array(readFileSync(join(dir, openingCopyPath(SHA(4)))))).toEqual(jpeg());
    expect(await s.opening.saveCopy('not-in-media', jpeg())).toMatchObject({ ok: false });
  });
});
