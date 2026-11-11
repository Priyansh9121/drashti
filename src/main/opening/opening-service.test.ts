import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mediaUrl } from '../../shared/media';
import { OPENING_DEFAULT_PHOTO_URL, openingPhotoUrl, openingSoundUrl } from '../../shared/opening';
import { openingCopyPath, openingSoundPath } from './opening-files';
import { type OpeningServiceDeps, OpeningService } from './opening-service';

/*
 * The opening in the main process (Session 55; alpha.16, the owner's words of 11 Nov 2026: two seconds, one photo, no
 * words, and the pack's own sound): decided once a start, the version that started recorded for the next, its photo
 * from its copy at the window's size (its whole file until that is made) with the pack's sound beside it, with nothing
 * chosen Drashti's default photo alone and never a sound (the lamp should its file be missing), alpha.15's several
 * photos and lines read as its first photo, File › Opening…'s choices checked whole, and Load the opening pack….
 * Neither its photo's nor its sound's name ever reaches the log. Placeholder names and generated files only.
 */

let dir: string;
const SHA = (n: number) => String(n).repeat(64).slice(0, 64);
const jpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 0xff, 0xd9]);

/** A WAV of a quiet placeholder tone (16-bit mono PCM). */
function wav(hz = 440): Buffer {
  const rate = 8000;
  const data = Buffer.alloc(2400 * 2);
  for (let i = 0; i < data.length / 2; i++)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 2000), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8, 'latin1');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'latin1');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const shaOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-opening-service-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** What plays with nothing chosen: the default photo alone. */
const DEFAULT_PHOTO = { photo: OPENING_DEFAULT_PHOTO_URL, defaultPhoto: true };

/** A sound kept (a tone of its own), its copy in the media folder (unless `copy` is false). */
function keptSound(copy = true, hz = 440) {
  const bytes = wav(hz);
  const sound = { sha256: shaOf(bytes), kind: 'wav' as const, name: 'sound.wav' };
  if (copy) {
    mkdirSync(join(dir, 'opening'), { recursive: true });
    writeFileSync(join(dir, openingSoundPath(sound)), bytes);
  }
  return sound;
}

function service(
  o: {
    kept?: unknown;
    lastVersion?: string | null;
    boot?: Partial<OpeningServiceDeps['boot']>;
    /** Whether the default photo's file is there (it is, unless a test says not). */
    defaultPhoto?: boolean;
  } = {},
) {
  const store = new Map<string, unknown>();
  if (o.kept !== undefined) store.set('opening', o.kept);
  if (o.lastVersion !== null) store.set('lastStartVersion', o.lastVersion ?? '1.0.0-alpha.16');
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
      recentStop: false,
      restored: false,
      version: '1.0.0-alpha.16',
      ...o.boot,
    },
    picture: (id) => {
      const n = pictures.get(id);
      return n === undefined ? null : { sha256: SHA(n), name: `Placeholder ${String(n)}.jpg` };
    },
    hasCopy: (sha) => copies.has(sha),
    defaultPhoto: () => o.defaultPhoto ?? true,
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
  it('plays its photo, from its copy (its whole file until the copy is made), with the pack’s sound', () => {
    const sound = keptSound();
    const s = service({ kept: { photo: 'photo-2', sound } });
    expect(s.opening.atStart(START)).toEqual({
      photo: openingPhotoUrl('photo-2'),
      sound: openingSoundUrl(sound.sha256),
    });
    // Asked again (a page loaded again): no.
    expect(s.opening.atStart({ ...START, pageAgain: true })).toBeNull();
    expect(s.lines).toEqual(['Opening: plays (its photo and sound)']);
    const whole = service({ kept: { photo: 'photo-3' } });
    expect(whole.opening.atStart(START)).toEqual({ photo: mediaUrl('photo-3') });
    expect(whole.lines).toEqual(['Opening: plays (its photo)']);
    // Neither name in the log.
    expect([...s.lines, ...whole.lines].join(' ')).not.toMatch(/Placeholder|sound\.wav/u);
  });

  it('a sound whose copy is gone plays no sound, and the log says so', () => {
    const s = service({ kept: { photo: 'photo-2', sound: keptSound(false) } });
    expect(s.opening.atStart(START)).toEqual({ photo: openingPhotoUrl('photo-2') });
    expect(s.lines).toEqual(['Opening: plays (its photo; its sound’s copy is missing)']);
  });

  it('with no photo, the default photo alone and never a sound; its file missing, the lamp alone, said', () => {
    const s = service({ kept: { photo: null, sound: keptSound() } });
    expect(s.opening.atStart(START)).toEqual(DEFAULT_PHOTO);
    expect(s.lines).toEqual(['Opening: plays (the default photo)']);
    const missing = service({ defaultPhoto: false });
    expect(missing.opening.atStart(START)).toEqual({ photo: null });
    expect(missing.lines).toEqual(['Opening: plays (the lamp; the default photo’s file is missing)']);
    // A photo chosen that has left Media: the default photo, no sound.
    const gone = service({ kept: { photo: 'gone-1', sound: keptSound() } });
    expect(gone.opening.atStart(START)).toEqual(DEFAULT_PHOTO);
    expect(gone.lines).toEqual(['Opening: plays (the default photo; its photo is no longer in Media)']);
  });

  it('reads alpha.15’s several photos and lines as its first photo, with no words', () => {
    const s = service({
      kept: { on: true, photos: ['photo-3', 'photo-4'], lines: ['Placeholder line one', 'Placeholder two'] },
    });
    expect(s.opening.atStart(START)).toEqual({ photo: mediaUrl('photo-3') });
    expect(s.lines).toEqual(['Opening: plays (its photo)']);
  });

  it('records the version that started for the next start, and never plays at a version’s first start', () => {
    const same = service();
    expect(same.later).toEqual([]);
    const updated = service({ lastVersion: '1.0.0-alpha.15' });
    expect(updated.later).toEqual([['lastStartVersion', '1.0.0-alpha.16']]);
    expect(updated.opening.atStart(START)).toBeNull();
    expect(updated.lines).toEqual(['Opening: not played (at the first start of 1.0.0-alpha.16)']);
    const first = service({ lastVersion: null });
    expect(first.later).toEqual([['lastStartVersion', '1.0.0-alpha.16']]);
    expect(first.opening.atStart(START)).toBeNull();
  });

  it('never after an unexpected stop in the last three hours, a restore, nor with the welcome, nor turned off', () => {
    const crash = service({ boot: { cleanQuit: false, recentStop: true } });
    expect(crash.opening.atStart(START)).toBeNull();
    expect(crash.lines).toEqual(['Opening: not played (after an unexpected stop)']);
    // A stop longer ago (the computer switched off with Drashti open, the day before): it plays.
    const yesterday = service({ boot: { cleanQuit: false, recentStop: false } });
    expect(yesterday.opening.atStart(START)).toEqual(DEFAULT_PHOTO);
    const restored = service({ boot: { restored: true } });
    expect(restored.opening.atStart(START)).toBeNull();
    expect(restored.lines).toEqual(['Opening: not played (after a restore)']);
    const welcome = service();
    welcome.setWelcome(true);
    expect(welcome.opening.atStart(START)).toBeNull();
    const off = service({ kept: { on: false } });
    expect(off.opening.atStart(START)).toBeNull();
    expect(off.lines).toEqual(['Opening: not played (turned off in File › Opening…)']);
  });
});

describe('File › Opening…', () => {
  it('shows its photo, whether its copy is made and whether it left Media, and its sound', () => {
    const sound = keptSound();
    expect(service({ kept: { photo: 'photo-3', sound } }).opening.view()).toEqual({
      on: true,
      photo: { mediaId: 'photo-3', name: 'Placeholder 3.jpg', ready: false, gone: false },
      sound: { name: 'sound.wav', url: openingSoundUrl(sound.sha256) },
      defaultPhoto: true,
    });
    expect(service({ kept: { photo: 'photo-2' } }).opening.view()).toMatchObject({
      photo: { mediaId: 'photo-2', ready: true, gone: false },
      sound: null,
    });
    expect(service({ kept: { photo: 'gone-1' } }).opening.view()).toMatchObject({
      photo: { mediaId: 'gone-1', name: '', ready: false, gone: true },
    });
    // Nothing chosen: its preview plays the default photo, while its file is there.
    expect(service().opening.view()).toEqual({ on: true, photo: null, sound: null, defaultPhoto: true });
    expect(service({ defaultPhoto: false }).opening.view()).toMatchObject({ defaultPhoto: false });
    // A sound whose copy is gone is not loaded.
    expect(service({ kept: { photo: 'photo-2', sound: keptSound(false, 550) } }).opening.view()).toMatchObject({
      sound: null,
    });
  });

  it('keeps one photo, a picture in Media only, checked whole; its sound stays', () => {
    const sound = keptSound();
    const s = service({ kept: { on: false, photo: 'photo-1', sound } });
    expect(s.opening.setChoice({ photo: 'photo-3' })).toMatchObject({
      ok: true,
      view: { on: false, photo: { mediaId: 'photo-3' }, sound: { name: 'sound.wav' } },
    });
    expect(s.store.get('opening')).toEqual({ on: false, photo: 'photo-3', sound });
    for (const bad of [
      { photo: 'not-in-media' },
      { photo: 'not a media id!' },
      { photos: ['photo-1'] },
      { photo: ['photo-1'] },
      null,
    ])
      expect(s.opening.setChoice(bad)).toMatchObject({ ok: false });
    expect(s.store.get('opening')).toEqual({ on: false, photo: 'photo-3', sound });
    // Taken out: the default photo plays (with no sound), the sound is kept for a photo chosen later.
    expect(s.opening.setChoice({ photo: null })).toMatchObject({ ok: true, view: { photo: null } });
    expect(s.store.get('opening')).toEqual({ on: false, photo: null, sound });
    expect(s.opening.setOn(true)).toMatchObject({ ok: true, view: { on: true } });
    expect(s.lines).toEqual(['Opening: turned on']);
  });

  it('takes the sound out: no sound, and its copy gone', async () => {
    const sound = keptSound();
    const s = service({ kept: { photo: 'photo-2', sound } });
    expect(await s.opening.removeSound()).toMatchObject({ ok: true, view: { sound: null } });
    expect(s.store.get('opening')).toEqual({ on: true, photo: 'photo-2', sound: null });
    expect(existsSync(join(dir, openingSoundPath(sound)))).toBe(false);
    expect(s.lines).toEqual(['Opening: its sound was taken out']);
    expect(s.opening.soundFile(sound.sha256)).toBeNull();
  });

  it('serves only the sound it keeps', () => {
    const sound = keptSound();
    const s = service({ kept: { photo: 'photo-2', sound } });
    expect(s.opening.soundFile(sound.sha256)).toBe(openingSoundPath(sound));
    expect(s.opening.soundFile(SHA(7))).toBeNull();
    expect(service().opening.soundFile(sound.sha256)).toBeNull();
  });

  it('Load the opening pack…: its photo 1 into Media and its sound kept, replacing what was chosen', async () => {
    const old = keptSound();
    const s = service({ kept: { on: false, photo: 'photo-9', sound: old } });
    const root = join(dir, 'pack');
    mkdirSync(join(root, 'photos'), { recursive: true });
    writeFileSync(join(root, 'photos', '1.jpg'), jpeg());
    const bytes = wav(660);
    writeFileSync(join(root, 'SOUND.WAV'), bytes);
    const loaded = await s.opening.loadPack(root);
    expect(s.imported).toEqual([[join(root, 'photos', '1.jpg')]]);
    const sound = { sha256: shaOf(bytes), kind: 'wav', name: 'SOUND.WAV' };
    expect(loaded).toMatchObject({
      ok: true,
      view: { on: false, photo: { mediaId: 'photo-1' }, sound: { name: 'SOUND.WAV' } },
    });
    expect(s.store.get('opening')).toEqual({ on: false, photo: 'photo-1', sound });
    expect(readFileSync(join(dir, openingSoundPath(sound)))).toEqual(bytes);
    // The sound it replaced is gone from the media folder.
    expect(existsSync(join(dir, openingSoundPath(old)))).toBe(false);
    expect(s.lines).toEqual(['Opening: the opening pack’s photo and sound are the opening’s now']);
  });

  it('an alpha.15 pack (eight photos and words.txt, no sound) loads its photo 1 only, and no sound', async () => {
    const old = keptSound();
    const s = service({ kept: { photo: 'photo-9', sound: old } });
    const root = join(dir, 'pack');
    mkdirSync(join(root, 'photos'), { recursive: true });
    for (let n = 1; n <= 8; n++) writeFileSync(join(root, 'photos', `${String(n)}.jpg`), jpeg());
    writeFileSync(join(root, 'words.txt'), 'Placeholder One\nPlaceholder Two\n');
    expect(await s.opening.loadPack(root)).toMatchObject({ ok: true, view: { sound: null } });
    expect(s.imported).toEqual([[join(root, 'photos', '1.jpg')]]);
    expect(s.store.get('opening')).toEqual({ on: true, photo: 'photo-1', sound: null });
    expect(existsSync(join(dir, openingSoundPath(old)))).toBe(false);
    expect(s.lines).toEqual(['Opening: the opening pack’s photo is the opening’s now']);
  });

  it('a pack without its photo, or with a sound it cannot take, says so, and nothing is brought in or changed', async () => {
    const sound = keptSound();
    const s = service({ kept: { photo: 'photo-9', sound } });
    const root = join(dir, 'pack');
    mkdirSync(join(root, 'photos'), { recursive: true });
    writeFileSync(join(root, 'photos', '2.jpg'), jpeg());
    expect(await s.opening.loadPack(root)).toEqual({
      ok: false,
      message: 'The opening pack has no photo 1 (photos/1.jpg). Nothing was changed.',
    });
    writeFileSync(join(root, 'photos', '1.jpg'), jpeg());
    writeFileSync(join(root, 'sound.mp3'), jpeg());
    expect(await s.opening.loadPack(root)).toEqual({
      ok: false,
      message:
        'Drashti cannot play the opening pack’s sound.mp3 as it is: JPEG picture. Its sound must be an MP3, an M4A (AAC) or a WAV. Nothing was changed.',
    });
    expect(s.imported).toEqual([]);
    expect(s.store.get('opening')).toEqual({ photo: 'photo-9', sound });
    expect(existsSync(join(dir, openingSoundPath(sound)))).toBe(true);
    expect(s.lines).toEqual(['Opening: the opening pack was not loaded', 'Opening: the opening pack was not loaded']);
  });

  it('keeps a photo’s copy for the opening under its sha256, for a picture in Media only', async () => {
    const s = service();
    expect(await s.opening.saveCopy('photo-4', jpeg())).toEqual({ ok: true });
    expect(new Uint8Array(readFileSync(join(dir, openingCopyPath(SHA(4)))))).toEqual(jpeg());
    expect(await s.opening.saveCopy('not-in-media', jpeg())).toMatchObject({ ok: false });
  });
});
