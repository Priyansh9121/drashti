import { describe, expect, it } from 'vitest';
import type { Quote } from '../../shared/idle';
import type { ChosenWallpaper, WallpapersView } from '../../shared/wallpapers';
import { openDatabase } from '../db/database';
import { MediaRepo } from '../db/media';
import { SettingsRepo } from '../db/settings';
import { WallpaperRepo } from '../db/wallpapers';
import { sortWallpaperFiles } from './wallpaper-files';
import { quotePictureName, WallpaperService } from './wallpaper-service';

/*
 * The wallpapers' service (Session 55, Part 6): a wallpaper of each picture added (pictures only, anything else
 * refused with the reason), one chosen and kept over a restart, the chosen one in the engine's state for every screen
 * (none once it is deleted, back again with Undo), a wallpaper of several pictures and its timing, and the idle
 * rotation made into one wallpaper once: its pictures still in the library, then its quotes, each drawn as a picture
 * by the operator window (which has the fonts). Placeholder names and quotes only.
 */

type Pushed = Omit<ChosenWallpaper, 'since'> | null;

function setup(db = openDatabase(':memory:')) {
  const add = db.prepare('INSERT OR IGNORE INTO media (id, kind, name, path) VALUES (?, ?, ?, ?)');
  add.run('blue', 'image', 'Placeholder blue.png', 'ab/blue');
  add.run('green', 'image', 'Placeholder green.jpg', 'ab/green');
  add.run('clip', 'video', 'Placeholder clip.mp4', 'ab/clip');
  add.run('tone', 'audio', 'Placeholder tone.wav', 'ab/tone');
  const pushed: Pushed[] = [];
  const views: WallpapersView[] = [];
  const kept: string[] = [];
  const media = new MediaRepo(db);
  const service = new WallpaperService({
    repo: new WallpaperRepo(db),
    settings: new SettingsRepo(db),
    media: (id) => media.kindAndName(id),
    engine: {
      setChosenWallpaper: (w) => {
        pushed.push(w);
      },
    },
    keepPicture: (png, name) => {
      expect(png.byteLength).toBeGreaterThan(0);
      const id = `drawn-${String(kept.length + 1)}`;
      add.run(id, 'image', `${name}.png`, `ab/${id}`);
      kept.push(name);
      return Promise.resolve(id);
    },
    changed: (view) => {
      views.push(view);
    },
  });
  service.start();
  return { db, service, pushed, views, kept };
}

const names = (view: WallpapersView) =>
  view.wallpapers.map((w) => `${w.name}${w.id === view.chosenId ? ' *' : ''} (${String(w.pictures.length)})`);

describe('the wallpapers', () => {
  it('makes a wallpaper of each picture, named as its file, and refuses anything that is not a picture', () => {
    const { service, views } = setup();
    const made = service.add(['blue', 'green'], null);
    expect(made).toMatchObject({ ok: true });
    expect(names(service.view())).toEqual(['Placeholder blue (1)', 'Placeholder green (1)']);
    expect(views.length).toBeGreaterThan(0);
    expect(service.add(['clip'], null)).toEqual({
      ok: false,
      message: '“Placeholder clip.mp4” is a video, not a picture. Wallpapers are pictures only.',
    });
    expect(service.add(['no-such'], null)).toMatchObject({ ok: false });
    expect(names(service.view())).toHaveLength(2);
  });

  it('keeps one chosen over a restart, and the engine has it; none once it is deleted, and chosen again with Undo', () => {
    const { db, service, pushed } = setup();
    const made = service.add(['blue', 'green'], null);
    const [blue = '', green = ''] = made.ok ? made.ids : [];
    expect(pushed.at(-1)).toBeNull();
    expect(service.choose(green)).toMatchObject({ ok: true });
    expect(pushed.at(-1)).toEqual({
      id: green,
      name: 'Placeholder green',
      pictures: ['green'],
      secondsEach: 10,
      fadeMs: 1500,
    });
    expect(service.choose('no-such')).toMatchObject({ ok: false });
    // A restart: still chosen, and the engine has it from the start.
    const again = setup(db);
    expect(names(again.service.view())).toEqual(['Placeholder blue (1)', 'Placeholder green * (1)']);
    expect(again.pushed.at(-1)).toMatchObject({ id: green });
    // Renamed: the engine has its new name.
    again.service.rename(green, 'Placeholder evening');
    expect(again.pushed.at(-1)).toMatchObject({ id: green, name: 'Placeholder evening' });
    // Deleted: none chosen, black. Undo brings it back, chosen as it was.
    expect(again.service.remove(green)).toMatchObject({ ok: true });
    expect(again.service.view().chosenId).toBeNull();
    expect(again.pushed.at(-1)).toBeNull();
    expect(again.service.restore(green)).toMatchObject({ ok: true });
    expect(again.service.view().chosenId).toBe(green);
    expect(again.pushed.at(-1)).toMatchObject({ id: green });
    // None: a click on the chosen one.
    again.service.choose(null);
    expect(again.service.view().chosenId).toBeNull();
    expect(again.pushed.at(-1)).toBeNull();
    expect(blue).not.toBe('');
  });

  it('a wallpaper of several pictures: pictures added into it, set in order, its timing; one deleted from the library is left out', () => {
    const { db, service, pushed } = setup();
    const made = service.add(['blue'], null);
    const [id = ''] = made.ok ? made.ids : [];
    service.choose(id);
    expect(service.add(['green'], id)).toMatchObject({ ok: true, ids: [id] });
    expect(names(service.view())).toEqual(['Placeholder blue * (2)']);
    expect(pushed.at(-1)).toMatchObject({ pictures: ['blue', 'green'] });
    expect(service.setPictures(id, ['green', 'blue'])).toMatchObject({ ok: true });
    expect(service.setPictures(id, ['green', 'tone'])).toMatchObject({ ok: false });
    expect(service.setTiming(id, { secondsEach: 4, fadeMs: 800 })).toMatchObject({ ok: true });
    expect(pushed.at(-1)).toMatchObject({ pictures: ['green', 'blue'], secondsEach: 4, fadeMs: 800 });
    // A picture deleted from the library: left out on the screens, shown missing in the window.
    db.prepare("UPDATE media SET deleted_at = '2026-10-30T07:00:00.000Z' WHERE id = 'green'").run();
    service.mediaChanged();
    expect(pushed.at(-1)).toMatchObject({ pictures: ['blue'] });
    expect(service.view().wallpapers[0]?.pictures.map((p) => [p.mediaId, p.missing])).toEqual([
      ['green', true],
      ['blue', false],
    ]);
    expect(service.pictureIds()).toEqual(['blue']);
    expect(service.usedBy('blue')).toEqual(['Placeholder blue']);
  });
});

describe('the idle rotation, made into a wallpaper', () => {
  const quotes: Quote[] = [
    { id: 'q1', words: { en: 'Placeholder quote one' }, attribution: 'Placeholder' },
    { id: 'q2', words: { gu: 'પ્લેસહોલ્ડર', en: 'Placeholder quote two' }, attribution: '' },
  ];

  it('once: its pictures still in the library, in order with its seconds, then each quote drawn as a picture', async () => {
    const { service, kept, pushed } = setup();
    service.fromIdleRotation({
      pictures: [
        { mediaId: 'green', name: 'Placeholder green.jpg' },
        { mediaId: 'gone', name: null },
        { mediaId: 'blue', name: 'Placeholder blue.png' },
      ],
      secondsEach: 7,
      quoteOfTheDay: true,
      quotes,
    });
    const view = service.view();
    expect(names(view)).toEqual(['Idle rotation (2)']);
    // Not chosen by itself: the screens stay as they were.
    expect(view.chosenId).toBeNull();
    expect(pushed.every((p) => p === null)).toBe(true);
    const [made] = view.wallpapers;
    expect(made?.secondsEach).toBe(7);
    expect(view.quotesToDraw).toEqual({ into: made?.id, quotes });
    // The window draws each quote and sends it: in the same wallpaper, after the pictures.
    expect(await service.addQuotePicture(made?.id ?? '', 'q1', new Uint8Array([1, 2, 3]))).toMatchObject({
      ok: true,
    });
    expect(service.view().quotesToDraw).toEqual({ into: made?.id, quotes: [quotes[1]] });
    await service.addQuotePicture(made?.id ?? '', 'q2', new Uint8Array([4]));
    expect(service.view().quotesToDraw).toBeNull();
    expect(kept).toEqual(quotes.map((q) => quotePictureName(q)));
    expect(names(service.view())).toEqual(['Idle rotation (4)']);
    // A quote not asked for (or sent twice) is refused.
    expect(await service.addQuotePicture(made?.id ?? '', 'q1', new Uint8Array([1]))).toMatchObject({
      ok: false,
    });
    // Once: never again.
    service.fromIdleRotation({
      pictures: [{ mediaId: 'blue', name: 'x' }],
      secondsEach: 7,
      quoteOfTheDay: true,
      quotes,
    });
    expect(names(service.view())).toEqual(['Idle rotation (4)']);
  });

  it('an idle rotation with nothing in it makes nothing; its quotes alone make one', () => {
    const { service } = setup();
    service.fromIdleRotation({ pictures: [], secondsEach: 10, quoteOfTheDay: true, quotes: [] });
    expect(service.view().wallpapers).toEqual([]);
    const other = setup();
    other.service.fromIdleRotation({ pictures: [], secondsEach: 10, quoteOfTheDay: false, quotes });
    expect(names(other.service.view())).toEqual(['Idle rotation (0)']);
    expect(other.service.view().quotesToDraw?.quotes).toEqual(quotes);
  });

  it('names a quote’s picture by its first words, safe as a file’s name on Windows too', () => {
    expect(
      quotePictureName({ id: 'q', words: { en: 'Placeholder: one/two? "three"' }, attribution: '' }),
    ).toBe('Quote · Placeholder one two three');
    expect(
      quotePictureName({ id: 'q', words: { gu: 'પ્લેસહોલ્ડર શબ્દો' }, attribution: '' }).startsWith(
        'Quote · ',
      ),
    ).toBe(true);
    expect(
      quotePictureName({ id: 'q', words: { en: 'x'.repeat(200) }, attribution: '' }).length,
    ).toBeLessThanOrEqual(60);
  });
});

describe('files offered as wallpapers', () => {
  it('are sorted: the pictures, and the rest with why each is not one', async () => {
    const sorted = await sortWallpaperFiles(
      [
        '/p/Placeholder darshan.jpg',
        '/p/Placeholder sunrise.HEIC',
        '/p/Placeholder bhajan.wav',
        '/p/Placeholder clip.mp4',
        '/p/Placeholder notices.pdf',
        '/p/Placeholder deck.pptx',
        '/p/Placeholder notes.txt',
        '/p/Placeholder folder',
        'C:\\p\\Placeholder windows.png',
      ],
      (path) => Promise.resolve(path.endsWith('folder')),
    );
    expect(sorted).toEqual({
      pictures: [
        '/p/Placeholder darshan.jpg',
        '/p/Placeholder sunrise.HEIC',
        'C:\\p\\Placeholder windows.png',
      ],
      refused: [
        { name: 'Placeholder bhajan.wav', why: 'is a sound' },
        { name: 'Placeholder clip.mp4', why: 'is a video' },
        { name: 'Placeholder notices.pdf', why: 'is a PDF' },
        { name: 'Placeholder deck.pptx', why: 'is a PowerPoint deck' },
        { name: 'Placeholder notes.txt', why: 'is not a picture' },
        { name: 'Placeholder folder', why: 'is a folder' },
      ],
    });
  });
});
