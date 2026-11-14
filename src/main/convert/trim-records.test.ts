import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setAside } from '../state-file';
import { TrimRecords } from './trim-records';

/*
 * Trim's records (FT-4): the cuts accepted and waiting, and the copies made but not yet taken in, kept in a small file
 * written in the background and whole, never as a library setting written on Main (which waited for an import's write
 * lock); written at once only before a cut can appear in Media, and at quit, so no save is lost.
 */

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-trim-records-'));
  file = join(dir, 'trim-cuts.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const cut = (n: number) => ({
  itemId: `item-${String(n)}`,
  mediaId: `media-${String(n)}`,
  name: `Placeholder ${String(n)}.mp4`,
});
const copy = { path: 'ab/Placeholder trimmed.mp4', identity: '1:2:3:4' };
const nothingBefore = { waiting: () => undefined, copies: () => undefined, clear: () => undefined };
const readRecords = () =>
  JSON.parse(readFileSync(file, 'utf8')) as {
    version: number;
    waiting: unknown[];
    copies: unknown[];
    legacy: string | null;
  };
const onDisk = () => {
  const { version, waiting, copies } = readRecords();
  return { version, waiting, copies };
};

/** A busy disk: each write in the background waits until let go; the main process never waits for it. */
function busyDisk() {
  let holding = true;
  const held: (() => void)[] = [];
  const writeFile = vi.fn(async (path: string, text: string) => {
    if (holding) await new Promise<void>((resolve) => held.push(resolve));
    writeFileSync(path, text);
  });
  return {
    writeFile,
    letGo: () => {
      holding = false;
      for (const go of held.splice(0)) go();
    },
  };
}

it('writes a change in the background: the save returns before the disk is written, and the file is replaced whole', async () => {
  const disk = busyDisk();
  const records = new TrimRecords(file, { before: nothingBefore, writeFile: disk.writeFile });
  records.kept.save([cut(1)]);
  expect(existsSync(file)).toBe(false);
  await vi.waitFor(() => {
    expect(disk.writeFile).toHaveBeenCalledOnce();
  });
  // A partial file beside it, moved over it once whole.
  expect(disk.writeFile.mock.calls[0]?.[0]).toMatch(/trim-cuts\.json\.[0-9a-f-]+\.tmp$/u);
  expect(existsSync(file)).toBe(false);
  disk.letGo();
  await records.settle();
  expect(onDisk()).toEqual({ version: 1, waiting: [cut(1)], copies: [] });
  expect(readdirSync(dir)).toEqual(['trim-cuts.json']);
});

it('makes the changes during a write one write after it, of the newest', async () => {
  const disk = busyDisk();
  const records = new TrimRecords(file, { before: nothingBefore, writeFile: disk.writeFile });
  records.kept.save([cut(1)]);
  await vi.waitFor(() => {
    expect(disk.writeFile).toHaveBeenCalledOnce();
  });
  records.kept.save([cut(1), cut(2)]);
  records.copies.save([copy]);
  records.kept.save([cut(2)]);
  disk.letGo();
  await records.settle();
  expect(disk.writeFile).toHaveBeenCalledTimes(2);
  expect(onDisk()).toEqual({ version: 1, waiting: [cut(2)], copies: [copy] });
  expect(records.kept.load()).toEqual([cut(2)]);
  expect(records.copies.load()).toEqual([copy]);
});

it('writes the newest at once before a cut can appear in Media, and a write under way never lands over it', async () => {
  const disk = busyDisk();
  const records = new TrimRecords(file, { before: nothingBefore, writeFile: disk.writeFile });
  records.kept.save([cut(1)]);
  await vi.waitFor(() => {
    expect(disk.writeFile).toHaveBeenCalledOnce();
  });
  records.copies.save([copy]);
  records.kept.save([{ ...cut(1), copy }]);
  records.saveNow();
  const newest = { version: 1, waiting: [{ ...cut(1), copy }], copies: [copy] };
  expect(onDisk()).toEqual(newest);
  disk.letGo();
  await records.settle();
  expect(onDisk()).toEqual(newest);
  expect(readdirSync(dir)).toEqual(['trim-cuts.json']);
});

it('writes at quit what is not on the disk yet, and any change after the quit at once: no save is lost', async () => {
  const disk = busyDisk();
  const records = new TrimRecords(file, { before: nothingBefore, writeFile: disk.writeFile });
  records.kept.save([cut(1)]);
  await vi.waitFor(() => {
    expect(disk.writeFile).toHaveBeenCalledOnce();
  });
  records.kept.save([cut(2)]);
  records.quit();
  expect(onDisk()).toEqual({ version: 1, waiting: [cut(2)], copies: [] });
  // A copy let go as Drashti quits (playlist-trims.ts's discardCopy).
  records.copies.save([copy]);
  expect(onDisk()).toEqual({ version: 1, waiting: [cut(2)], copies: [copy] });
  disk.letGo();
  await records.settle();
  expect(onDisk()).toEqual({ version: 1, waiting: [cut(2)], copies: [copy] });
  expect(disk.writeFile).toHaveBeenCalledOnce();
});

it('reads what alpha.17 kept in the library’s settings once, while the file is not there, so a waiting cut carries on', async () => {
  const before = { waiting: vi.fn(() => [cut(1)]), copies: vi.fn(() => [copy]), clear: vi.fn() };
  const first = new TrimRecords(file, { before });
  expect(first.kept.load()).toEqual([cut(1)]);
  expect(first.copies.load()).toEqual([copy]);
  // Written to the file by itself, so the next start reads the file and never the settings.
  await first.settle();
  expect(onDisk()).toEqual({ version: 1, waiting: [cut(1)], copies: [copy] });
  const next = new TrimRecords(file, { before });
  expect(next.kept.load()).toEqual([cut(1)]);
  expect(before.waiting).toHaveBeenCalledTimes(2);
  expect(before.copies).toHaveBeenCalledTimes(2);
  expect(readRecords().legacy).toMatch(/^[0-9a-f]{64}$/u);
});

it('removes partial Trim writes left by a crash and keeps the records on disk', () => {
  const stale = `${file}.11111111-1111-4111-8111-111111111111.tmp`;
  const unrelated = `${file}.other.tmp`;
  writeFileSync(file, JSON.stringify({ version: 1, waiting: [cut(1)], copies: [copy] }));
  writeFileSync(stale, 'Placeholder partial write');
  writeFileSync(unrelated, 'Placeholder unrelated file');
  const records = new TrimRecords(file, { before: nothingBefore });
  expect(records.kept.load()).toEqual([cut(1)]);
  expect(records.copies.load()).toEqual([copy]);
  expect(readdirSync(dir).sort()).toEqual(['trim-cuts.json', 'trim-cuts.json.other.tmp']);
});

it('takes in new alpha.17 records after a downgrade alongside cuts already in the file', async () => {
  writeFileSync(file, JSON.stringify({ version: 1, waiting: [cut(1)], copies: [copy] }));
  const later = { path: 'cd/Placeholder second cut.mp4', identity: '2:3:4:5' };
  const clear = vi.fn();
  const before = { waiting: () => [cut(2)], copies: () => [later], clear };
  const records = new TrimRecords(file, { before, afterDowngrade: true });
  expect(records.kept.load()).toEqual([cut(1), cut(2)]);
  expect(records.copies.load()).toEqual([copy, later]);
  await records.settle();
  expect(onDisk()).toMatchObject({ waiting: [cut(1), cut(2)], copies: [copy, later] });
  expect(clear).toHaveBeenCalledOnce();
});

it('does not resume a cut twice after a crash before the legacy settings were cleared', async () => {
  const before = { waiting: () => [cut(1)], copies: () => [copy], clear: vi.fn() };
  const first = new TrimRecords(file, { before });
  await first.settle();
  first.kept.save([]);
  first.copies.save([]);
  await first.settle();

  const afterCrash = new TrimRecords(file, { before });
  expect(afterCrash.kept.load()).toEqual([]);
  expect(afterCrash.copies.load()).toEqual([]);
  expect(before.clear).toHaveBeenCalledTimes(2);
});

it('prefers the newer request for the same row and keeps each unfinished copy once', async () => {
  writeFileSync(file, JSON.stringify({ version: 1, waiting: [cut(1)], copies: [copy], legacy: null }));
  const newest = { ...cut(1), name: 'Placeholder later request' };
  const before = { waiting: () => [newest], copies: () => [copy], clear: vi.fn() };
  const records = new TrimRecords(file, { before });
  expect(records.kept.load()).toEqual([newest]);
  expect(records.copies.load()).toEqual([copy]);
  await records.settle();
  expect(onDisk()).toEqual({ version: 1, waiting: [newest], copies: [copy] });
});

it('starts with nothing waiting and writes nothing when neither the file nor the settings hold anything', async () => {
  const records = new TrimRecords(file, {
    before: { waiting: () => 'not a list', copies: () => null, clear: () => undefined },
  });
  expect(records.kept.load()).toEqual([]);
  expect(records.copies.load()).toEqual([]);
  await records.settle();
  expect(existsSync(file)).toBe(false);
});

it('keeps a file it cannot read aside, never writes over it, and starts with nothing waiting', async () => {
  writeFileSync(file, '{"version": 1, "waiting": [');
  const log = vi.fn<(message: string) => void>();
  const before = { waiting: vi.fn(() => [cut(1)]), copies: vi.fn(() => [copy]), clear: vi.fn() };
  const records = new TrimRecords(file, { before, log });
  expect(records.kept.load()).toEqual([]);
  expect(records.copies.load()).toEqual([]);
  expect(before.waiting).not.toHaveBeenCalled();
  const aside = readdirSync(dir).filter((name) => name.startsWith('trim-cuts.unreadable-'));
  expect(aside).toHaveLength(1);
  expect(readFileSync(join(dir, aside[0] ?? ''), 'utf8')).toBe('{"version": 1, "waiting": [');
  expect(log).toHaveBeenCalledWith(expect.stringContaining('could not be read'));
  records.kept.save([cut(2)]);
  await records.settle();
  expect(onDisk()).toEqual({ version: 1, waiting: [cut(2)], copies: [] });
});

it('carries nothing over from the library before a restore: the restored library’s own settings, as before alpha.18', () => {
  writeFileSync(file, JSON.stringify({ version: 1, waiting: [cut(1)], copies: [copy] }));
  const before = { waiting: () => [cut(2)], copies: () => [], clear: () => undefined };
  const records = new TrimRecords(file, { before, otherLibrary: true });
  expect(records.kept.load()).toEqual([cut(2)]);
  expect(records.copies.load()).toEqual([]);
  // Written over at once: a crash now never brings the library before's records back.
  expect(onDisk()).toEqual({ version: 1, waiting: [cut(2)], copies: [] });
});

// LOW-2 (review of 50566755): alpha.17's settings stay in the library until cleared, so a backup restored later, a
// start after a set-aside, or alpha.17 itself after a downgrade would read records alpha.18 has since finished or
// stopped, and make a cut the operator let go.
it('clears alpha.17’s settings once the file holds what they held, and never again (LOW-2)', async () => {
  const disk = busyDisk();
  const clear = vi.fn();
  const records = new TrimRecords(file, {
    before: { waiting: () => [cut(1)], copies: () => [copy], clear },
    writeFile: disk.writeFile,
  });
  await vi.waitFor(() => {
    expect(disk.writeFile).toHaveBeenCalledOnce();
  });
  // Not while the file does not hold them yet: a crash now reads them again at the next start.
  expect(clear).not.toHaveBeenCalled();
  disk.letGo();
  await records.settle();
  expect(onDisk()).toEqual({ version: 1, waiting: [cut(1)], copies: [copy] });
  expect(clear).toHaveBeenCalledOnce();
  records.kept.save([]);
  await records.settle();
  expect(clear).toHaveBeenCalledOnce();
});

it('clears a restored backup’s alpha.17 settings once they are in the file, and clears nothing when they hold nothing (LOW-2)', () => {
  const clear = vi.fn();
  new TrimRecords(file, { before: { waiting: () => [cut(2)], copies: () => [], clear }, otherLibrary: true });
  expect(onDisk()).toEqual({ version: 1, waiting: [cut(2)], copies: [] });
  expect(clear).toHaveBeenCalledOnce();
  rmSync(file);
  const none = vi.fn();
  new TrimRecords(file, {
    before: { waiting: () => [], copies: () => undefined, clear: none },
    otherLibrary: true,
  });
  expect(none).not.toHaveBeenCalled();
});

it('writes empty records after setting a file aside, so the next start never reads the settings (LOW-2)', async () => {
  writeFileSync(file, '{"version": 1, "waiting": [');
  const before = { waiting: vi.fn(() => [cut(1)]), copies: vi.fn(() => [copy]), clear: vi.fn() };
  const first = new TrimRecords(file, { before });
  await first.settle();
  expect(onDisk()).toEqual({ version: 1, waiting: [], copies: [] });
  const next = new TrimRecords(file, { before });
  expect(next.kept.load()).toEqual([]);
  expect(before.clear).toHaveBeenCalledTimes(2);
});

// LOW-3 (review of 50566755): a file that could be neither read nor moved aside at the start (Windows: another program
// held it) may hold records still readable once the hold ends; it is never written over until it moves aside.
it('never writes over a file it could neither read nor move aside: saves fail until it moves aside (LOW-3)', async () => {
  const damaged = '{"version": 1, "waiting": [';
  writeFileSync(file, damaged);
  let holding = true;
  const aside = vi.fn((path: string) => (holding ? null : setAside(path)));
  const log = vi.fn<(message: string) => void>();
  const records = new TrimRecords(file, { before: nothingBefore, setAside: aside, log, retryMs: 10 });
  expect(log).toHaveBeenCalledWith(expect.stringContaining('left where it is'));
  records.kept.save([cut(2)]);
  await vi.waitFor(() => {
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Could not save'));
  });
  expect(readFileSync(file, 'utf8')).toBe(damaged);
  // Before a cut can appear in Media: it throws, so the cut is not published unrecorded.
  expect(() => {
    records.saveNow();
  }).toThrow();
  expect(readFileSync(file, 'utf8')).toBe(damaged);
  holding = false;
  await vi.waitFor(
    () => {
      expect(onDisk()).toEqual({ version: 1, waiting: [cut(2)], copies: [] });
    },
    { timeout: 10_000 },
  );
  const kept = readdirSync(dir).filter((name) => name.startsWith('trim-cuts.unreadable-'));
  expect(kept).toHaveLength(1);
  expect(readFileSync(join(dir, kept[0] ?? ''), 'utf8')).toBe(damaged);
});

it('tries a write that failed again by itself, saying so once', async () => {
  let failures = 2;
  const writeFile = vi.fn((path: string, text: string) => {
    if (failures-- > 0) return Promise.reject(new Error('Placeholder: the disk is busy.'));
    writeFileSync(path, text);
    return Promise.resolve();
  });
  const log = vi.fn<(message: string) => void>();
  // Tried again 10 ms on, then 20 ms (250 ms and 500 ms in Drashti).
  const records = new TrimRecords(file, { before: nothingBefore, writeFile, log, retryMs: 10 });
  records.kept.save([cut(1)]);
  await vi.waitFor(() => {
    expect(existsSync(file)).toBe(true);
  });
  await records.settle();
  expect(onDisk()).toEqual({ version: 1, waiting: [cut(1)], copies: [] });
  expect(writeFile).toHaveBeenCalledTimes(3);
  expect(log.mock.calls.map(([message]) => message)).toEqual([
    expect.stringContaining('Could not save'),
    expect.stringContaining('after 2 failed saves'),
  ]);
  expect(readdirSync(dir)).toEqual(['trim-cuts.json']);
});

it('tries again, at once, a rename held for a moment before a cut can appear in Media (Windows: a scanner reading the file)', async () => {
  let held = 2;
  const rename = vi.fn((from: string, to: string) => {
    if (held-- > 0) throw Object.assign(new Error('Placeholder: the file is held.'), { code: 'EPERM' });
    renameSync(from, to);
  });
  const records = new TrimRecords(file, { before: nothingBefore, renameSync: rename });
  records.copies.save([copy]);
  records.saveNow();
  expect(onDisk()).toEqual({ version: 1, waiting: [], copies: [copy] });
  expect(rename).toHaveBeenCalledTimes(3);
  expect(readdirSync(dir)).toEqual(['trim-cuts.json']);
  // The background write the save queued finds the records on the disk already, and writes nothing.
  await records.settle();
  expect(rename).toHaveBeenCalledTimes(3);
  expect(readdirSync(dir)).toEqual(['trim-cuts.json']);
});

it('throws when the records cannot be written before a cut can appear in Media, so it is not published', async () => {
  const log = vi.fn<(message: string) => void>();
  const rename = vi.fn(() => {
    throw Object.assign(new Error('Placeholder: the folder cannot be written.'), { code: 'EACCES' });
  });
  const records = new TrimRecords(file, { before: nothingBefore, renameSync: rename, log, retryMs: 60_000 });
  records.copies.save([copy]);
  expect(() => {
    records.saveNow();
  }).toThrow('Placeholder: the folder cannot be written.');
  expect(existsSync(file)).toBe(false);
  expect(readdirSync(dir)).toEqual([]);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('Could not save'));
  records.quit();
  // The background write the save queued fails too, and takes its partial file away (CI: the folder was being
  // removed while it wrote).
  await records.settle();
  expect(readdirSync(dir)).toEqual([]);
});
