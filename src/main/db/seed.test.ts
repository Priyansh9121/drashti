import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { PlaylistRepo } from './playlists';
import { PresentationRepo } from './presentations';
import { slideLines } from '../../shared/tracks';
import { BUILTIN_THEMES } from '../../shared/builtin-themes';
import { DEFAULT_THEME } from '../../shared/themes';
import { switchesFor } from '../switches';
import {
  EXAMPLE_TEMPLATES,
  KIRTAN_PRESENTATION_NAME,
  seedBuiltinThemes,
  seedLibrary,
  seedOptions,
  seedPlaceholders,
  TEST_LINES,
  TEST_PRESENTATION_NAME,
} from './seed';
import { ThemeRepo } from './themes';

describe('seedLibrary (Session 50: a new library starts without the placeholder presentations)', () => {
  it('gives a new library the example sabha templates and the built-in themes, and no placeholder presentations', () => {
    const db = openDatabase(':memory:');
    expect(seedLibrary(db, { placeholders: false })).toEqual({
      placeholders: false,
      templates: true,
      themes: true,
    });
    expect(new PresentationRepo(db).list()).toEqual([]);
    expect(new PlaylistRepo(db).tree(true).map((t) => t.name)).toEqual(EXAMPLE_TEMPLATES.map((t) => t.name));
    expect(new ThemeRepo(db).list()).toHaveLength(BUILTIN_THEMES.length + 1);
    // Once: a second start adds nothing.
    expect(seedLibrary(db, { placeholders: false })).toEqual({
      placeholders: false,
      templates: false,
      themes: false,
    });
  });

  it('adds the placeholder presentations when asked (the tests), with the templates and themes', () => {
    const db = openDatabase(':memory:');
    expect(seedLibrary(db, { placeholders: true })).toEqual({
      placeholders: true,
      templates: true,
      themes: true,
    });
    expect(new PresentationRepo(db).list().map((p) => p.name)).toEqual(
      [TEST_PRESENTATION_NAME, KIRTAN_PRESENTATION_NAME].sort(),
    );
    expect(new PlaylistRepo(db).tree(true)).toHaveLength(EXAMPLE_TEMPLATES.length);
  });

  it('decides at a library’s first start: one that started without them never gains them later', () => {
    const db = openDatabase(':memory:');
    seedLibrary(db, { placeholders: false });
    expect(seedLibrary(db, { placeholders: true }).placeholders).toBe(false);
    expect(new PresentationRepo(db).list()).toEqual([]);
    // And one that started with them keeps them, asked or not.
    const other = openDatabase(':memory:');
    seedLibrary(other, { placeholders: true });
    expect(seedLibrary(other, { placeholders: false }).placeholders).toBe(false);
    expect(new PresentationRepo(other).list()).toHaveLength(2);
  });
});

describe('seedOptions (Session 50: the placeholders behind a test switch)', () => {
  const asked = { DRASHTI_TEST_SEED_PLACEHOLDERS: '1' };

  it('seeds them under DRASHTI_TEST_SEED_PLACEHOLDERS=1, which a packaged Drashti ignores', () => {
    expect(seedOptions(switchesFor(false, asked))).toEqual({ placeholders: true });
    expect(seedOptions(switchesFor(true, asked))).toEqual({ placeholders: false });
    // The end-to-end tests' way to start without them: the switch given empty.
    expect(seedOptions(switchesFor(false, { DRASHTI_TEST_SEED_PLACEHOLDERS: '' }))).toEqual({
      placeholders: false,
    });
    expect(seedOptions(switchesFor(false, {}))).toEqual({ placeholders: false });
    expect(seedOptions(switchesFor(true, {}))).toEqual({ placeholders: false });
  });

  it('never seeds them for a self-test: the watchdog’s brings slides of its own to an empty library', () => {
    // scripts/check-installers.mjs runs it on the installed app, in a data folder of its own: it leaves nothing.
    for (const packaged of [true, false])
      for (const selftest of ['watchdog', 'performance', 'restore-relaunch'])
        expect(seedOptions(switchesFor(packaged, { DRASHTI_SELFTEST: selftest })), selftest).toEqual({
          placeholders: false,
        });
  });
});

describe('seedPlaceholders', () => {
  it('adds the two placeholder presentations once', () => {
    const db = openDatabase(':memory:');
    expect(seedPlaceholders(db)).toBe(true);
    expect(seedPlaceholders(db)).toBe(false);
    const list = new PresentationRepo(db).list();
    expect(list.map((p) => p.name)).toEqual([TEST_PRESENTATION_NAME, KIRTAN_PRESENTATION_NAME].sort());
  });

  it('puts one line in each language on the first test slide', () => {
    const db = openDatabase(':memory:');
    seedPlaceholders(db);
    const repo = new PresentationRepo(db);
    const test = repo.list().find((p) => p.name === TEST_PRESENTATION_NAME);
    const first = test && repo.get(test.id)?.groups[0]?.slides[0]?.slide;
    const lines = first?.elements.flatMap((e) => (e.kind === 'text' ? [[e.lang, e.text]] : []));
    expect(lines).toEqual([
      ['en', TEST_LINES.en],
      ['gu', TEST_LINES.gu],
      ['hi', TEST_LINES.hi],
      ['translit', TEST_LINES.translit],
    ]);
    expect(test && repo.get(test.id)?.source).toMatchObject({ kind: 'drashti', ref: 'seed:language-test' });
  });

  it('gives the sample kirtan all four language tracks on every slide', () => {
    const db = openDatabase(':memory:');
    seedPlaceholders(db);
    const repo = new PresentationRepo(db);
    const summary = repo.list().find((p) => p.name === KIRTAN_PRESENTATION_NAME);
    expect(summary?.kirtanTracks).toEqual(['en', 'gu', 'hi', 'translit']);
    const doc = summary && repo.get(summary.id);
    const slides = doc?.groups.flatMap((g) => g.slides) ?? [];
    expect(slides).toHaveLength(3);
    // The tracks are the slides' own words, one line in each language.
    for (const s of slides)
      expect(Object.keys(slideLines(s.slide.elements).lines).sort()).toEqual(['en', 'gu', 'hi', 'translit']);
    expect(doc?.kirtan).toMatchObject({ category: 'Kirtan', tracks: ['en', 'gu', 'hi', 'translit'] });
    expect(slides.every((s) => s.slide.kirtan === true)).toBe(true);
  });

  it('does not come back after the operator deletes the placeholders', () => {
    const db = openDatabase(':memory:');
    seedPlaceholders(db);
    db.prepare('DELETE FROM presentations').run();
    expect(seedPlaceholders(db)).toBe(false);
    expect(new PresentationRepo(db).list()).toEqual([]);
  });
});

describe('seedBuiltinThemes (Session 26)', () => {
  it('adds the ten built-in themes once, after Drashti default, marked built in; a deleted one stays deleted', () => {
    const db = openDatabase(':memory:');
    expect(seedBuiltinThemes(db)).toBe(true);
    const themes = new ThemeRepo(db);
    expect(themes.list().map((t) => [t.name, t.builtIn === true])).toEqual([
      ['Drashti default', false],
      ...BUILTIN_THEMES.map((b) => [b.fields.name, true]),
    ]);
    const charcoal = themes.list().find((t) => t.name === 'Charcoal');
    expect(charcoal && themes.remove(charcoal.id)).toBe(true);
    expect(seedBuiltinThemes(db)).toBe(false);
    expect(themes.list().map((t) => t.name)).not.toContain('Charcoal');
    expect(themes.list()).toHaveLength(BUILTIN_THEMES.length);
  });

  it('comes after a library’s own themes when it is upgraded', () => {
    const db = openDatabase(':memory:');
    const themes = new ThemeRepo(db);
    themes.defaultId();
    themes.create({ ...DEFAULT_THEME, name: 'Placeholder own theme' });
    seedBuiltinThemes(db);
    expect(
      themes
        .list()
        .slice(0, 3)
        .map((t) => t.name),
    ).toEqual(['Drashti default', 'Placeholder own theme', 'Midnight']);
  });
});
