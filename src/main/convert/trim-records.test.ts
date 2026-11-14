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
const nothingBefore = { waiting: () => undefined, copies: () => undefined };
const onDisk = () => JSON.parse(readFileSync(file, 'utf8')) as unknown;

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
  const before = { waiting: vi.fn(() => [cut(1)]), copies: vi.fn(() => [copy]) };
  const first = new TrimRecords(file, { before });
  expect(first.kept.load()).toEqual([cut(1)]);
  expect(first.copies.load()).toEqual([copy]);
  // Written to the file by itself, so the next start reads the file and never the settings.
  await first.settle();
  expect(onDisk()).toEqual({ version: 1, waiting: [cut(1)], copies: [copy] });
  const next = new TrimRecords(file, { before });
  expect(next.kept.load()).toEqual([cut(1)]);
  expect(before.waiting).toHaveBeenCalledOnce();
  expect(before.copies).toHaveBeenCalledOnce();
});

it('starts with nothing waiting and writes nothing when neither the file nor the settings hold anything', async () => {
  const records = new TrimRecords(file, { before: { waiting: () => 'not a list', copies: () => null } });
  expect(records.kept.load()).toEqual([]);
  expect(records.copies.load()).toEqual([]);
  await records.settle();
  expect(existsSync(file)).toBe(false);
});

it('keeps a file it cannot read aside, never writes over it, and starts with nothing waiting', async () => {
  writeFileSync(file, '{"version": 1, "waiting": [');
  const log = vi.fn();
  const before = { waiting: vi.fn(() => [cut(1)]), copies: vi.fn(() => [copy]) };
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
  const before = { waiting: () => [cut(2)], copies: () => [] };
  const records = new TrimRecords(file, { before, otherLibrary: true });
  expect(records.kept.load()).toEqual([cut(2)]);
  expect(records.copies.load()).toEqual([]);
  // Written over at once: a crash now never brings the library before's records back.
  expect(onDisk()).toEqual({ version: 1, waiting: [cut(2)], copies: [] });
});

it('tries a write that failed again by itself, saying so once', async () => {
  let failures = 2;
  const writeFile = vi.fn((path: string, text: string) => {
    if (failures-- > 0) return Promise.reject(new Error('Placeholder: the disk is busy.'));
    writeFileSync(path, text);
    return Promise.resolve();
  });
  const log = vi.fn();
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

it('tries again, at once, a rename held for a moment before a cut can appear in Media (Windows: a scanner reading the file)', () => {
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
});

it('throws when the records cannot be written before a cut can appear in Media, so it is not published', () => {
  const log = vi.fn();
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
});
