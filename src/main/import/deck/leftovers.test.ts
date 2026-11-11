import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  clearDeckLeftovers,
  dropOfficeCopy,
  OfficeCopies,
  officeCopiesFile,
  officeCopyFolder,
} from './leftovers';

/*
 * What a deck's import left behind when Drashti stopped in the middle (Session 54, C review): the copies in
 * PowerPoint's own folder (Office's Drashti/convert-*) and the import's work folders (drashti-pictures-*), cleared
 * at the next start; nothing else of those folders.
 *
 * PowerPoint's folder is another app's, and macOS asks the operator each time Drashti reads it (Session 56): a start
 * touches it only for the copies Drashti's own record names (an import cut short), by name, never listing it. On a
 * Mac a folder keeps when it was last read, which shows a listing.
 */

const dir = mkdtempSync(join(tmpdir(), 'drashti-deck-leftovers-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A folder last read two days ago (and changed since): a listing of it shows as a new time on a Mac. */
function lastReadLongAgo(folder: string): number {
  utimesSync(folder, new Date(Date.now() - 2 * 86_400_000), new Date());
  return statSync(folder).atimeMs;
}
const lastRead = (folder: string) => statSync(folder).atimeMs;

let made = 0;
/**
 * A data folder; PowerPoint's folder, with a copy not in Drashti's record and a folder of someone else's; and a
 * temporary folder with a deck's work folder and a bundle's. Each thing done in PowerPoint's folder is counted.
 */
function places() {
  const at = join(dir, String(++made));
  const userData = join(at, 'Data');
  const office = join(at, 'Office Drashti');
  const temp = join(at, 'Temp');
  for (const d of [
    userData,
    join(office, 'convert-NotOurs'),
    join(office, 'Placeholder kept'),
    join(temp, 'drashti-pictures-XyZ789', 'bake-1'),
    join(temp, 'drashti-bundle-Kept'),
  ])
    mkdirSync(d, { recursive: true });
  writeFileSync(join(temp, 'drashti-pictures-XyZ789', 'bake-1', 'movie.mov'), 'placeholder');
  const touched: string[] = [];
  return {
    userData,
    office,
    temp,
    copies: new OfficeCopies(officeCopiesFile(userData)),
    touched,
    touch: (path: string) => {
      touched.push(path);
    },
  };
}

describe('a deck’s leftovers at the start', () => {
  it('leave PowerPoint’s folder alone when Drashti’s record names no copy (a start after a quit), and clear its own temporary work folders', async () => {
    const p = places();
    const before = lastReadLongAgo(p.office);
    const cleared = await clearDeckLeftovers({
      copies: p.copies,
      office: p.office,
      temp: p.temp,
      touched: p.touch,
    });
    expect(p.touched).toEqual([]);
    if (process.platform === 'darwin') expect(lastRead(p.office)).toBe(before);
    expect(existsSync(join(p.office, 'convert-NotOurs'))).toBe(true);
    expect(existsSync(join(p.temp, 'drashti-pictures-XyZ789'))).toBe(false);
    expect(existsSync(join(p.temp, 'drashti-bundle-Kept'))).toBe(true);
    expect(cleared).toBe(1);
  });

  it('clear only the copies the record names, by name, and forget them: the next start leaves the folder alone', async () => {
    const p = places();
    const left = join(p.office, 'convert-AbC123');
    mkdirSync(left);
    writeFileSync(join(left, 'Placeholder (Drashti copy 1234).pptx'), 'placeholder');
    // Written down and already gone: no trouble. Written down and not a copy's folder in PowerPoint's (the record
    // is Drashti's own, but never trusted to name anything else): forgotten, never touched.
    const gone = join(p.office, 'convert-Gone99');
    const elsewhere = join(p.temp, 'drashti-bundle-Kept');
    const notACopy = join(p.office, 'Placeholder kept');
    for (const folder of [left, gone, elsewhere, notACopy]) p.copies.add(folder);
    const before = lastReadLongAgo(p.office);
    const cleared = await clearDeckLeftovers({
      copies: p.copies,
      office: p.office,
      temp: p.temp,
      touched: p.touch,
    });
    expect(p.touched).toEqual([left, gone]);
    expect(existsSync(left)).toBe(false);
    expect(existsSync(join(p.office, 'convert-NotOurs'))).toBe(true);
    expect(existsSync(notACopy)).toBe(true);
    expect(existsSync(elsewhere)).toBe(true);
    expect(existsSync(officeCopiesFile(p.userData))).toBe(false);
    if (process.platform === 'darwin') expect(lastRead(p.office)).toBe(before);
    // The two copies, and the temporary work folder.
    expect(cleared).toBe(3);

    p.touched.length = 0;
    await clearDeckLeftovers({ copies: p.copies, office: p.office, temp: p.temp, touched: p.touch });
    expect(p.touched).toEqual([]);
    expect(existsSync(join(p.office, 'convert-NotOurs'))).toBe(true);
  });

  it('read the record as they begin: a copy an import writes down meanwhile stays its own', async () => {
    const p = places();
    const left = join(p.office, 'convert-Left01');
    mkdirSync(left);
    p.copies.add(left);
    const clearing = clearDeckLeftovers({
      copies: p.copies,
      office: p.office,
      temp: p.temp,
      touched: p.touch,
    });
    // An import that starts as the clearing goes on writes down a copy of its own.
    const live = await officeCopyFolder(p.copies, p.office);
    await clearing;
    expect(existsSync(left)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(p.copies.list()).toEqual([live]);
  });

  it('are no trouble when there is no record, or it cannot be read', async () => {
    const p = places();
    writeFileSync(officeCopiesFile(p.userData), '{ not a record');
    expect(p.copies.list()).toEqual([]);
    await clearDeckLeftovers({ copies: p.copies, office: p.office, temp: p.temp, touched: p.touch });
    expect(p.touched).toEqual([]);
    expect(existsSync(join(p.office, 'convert-NotOurs'))).toBe(true);
    // Folders that are not there are no trouble.
    expect(await clearDeckLeftovers({ office: join(dir, 'none'), temp: join(dir, 'none either') })).toBe(0);
  });
});

describe('a PowerPoint import’s copies', () => {
  it('are written down in Drashti’s own record before their folder is made in PowerPoint’s, and forgotten once removed', async () => {
    const p = places();
    const madeWhenWritten: boolean[] = [];
    class Watched extends OfficeCopies {
      override add(folder: string): void {
        madeWhenWritten.push(existsSync(folder));
        super.add(folder);
      }
    }
    const copies = new Watched(officeCopiesFile(p.userData));
    const inside = await officeCopyFolder(copies, p.office);
    expect(madeWhenWritten).toEqual([false]);
    expect(inside.startsWith(join(p.office, 'convert-'))).toBe(true);
    expect(existsSync(inside)).toBe(true);
    expect(copies.list()).toEqual([inside]);
    // The record is in Drashti's data folder; PowerPoint's has only the copies' folders.
    expect(JSON.parse(readFileSync(officeCopiesFile(p.userData), 'utf8'))).toEqual({
      version: 1,
      copies: [inside],
    });
    const second = await officeCopyFolder(copies, p.office);
    expect(second).not.toBe(inside);
    expect(copies.list()).toEqual([inside, second]);

    writeFileSync(join(inside, 'Placeholder (Drashti copy 1234).pptx'), 'placeholder');
    expect(await dropOfficeCopy(copies, inside)).toBe(true);
    expect(existsSync(inside)).toBe(false);
    expect(copies.list()).toEqual([second]);
    expect(await dropOfficeCopy(copies, second)).toBe(true);
    expect(copies.list()).toEqual([]);
    expect(existsSync(officeCopiesFile(p.userData))).toBe(false);
  });

  it('are never made where the record cannot be written', async () => {
    const p = places();
    // A folder in the record's place: it cannot be written.
    mkdirSync(officeCopiesFile(p.userData));
    await expect(
      officeCopyFolder(new OfficeCopies(officeCopiesFile(p.userData)), p.office),
    ).rejects.toThrow();
    expect(readdirSync(p.office).sort()).toEqual(['Placeholder kept', 'convert-NotOurs']);
  });
});
