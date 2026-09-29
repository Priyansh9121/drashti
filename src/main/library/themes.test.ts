import { describe, expect, it } from 'vitest';
import type { TextElement, TextRun } from '../../shared/model';
import type { Theme } from '../../shared/themes';
import { DEFAULT_THEME } from '../../shared/themes';
import type { ContentRows } from '../db/content';
import { readContent } from '../db/content';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { ThemeRepo } from '../db/themes';
import { LYRICS_STYLE } from '../import/formats/text';
import { applyTheme, themeFromContent, themeLook } from './themes';

/* Placeholder words only. */

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing');
  return value;
}

const text = (
  value: string,
  runs?: TextRun[],
  frame = { x: 96, y: 96, width: 1728, height: 888 },
): TextElement => ({
  id: 'x',
  kind: 'text',
  frame,
  text: value,
  lang: null,
  style: LYRICS_STYLE,
  ...(runs ? { runs } : {}),
});

const theme: Theme = {
  id: 'theme-1',
  ...DEFAULT_THEME,
  name: 'Placeholder theme',
  langs: {
    ...DEFAULT_THEME.langs,
    gu: { font: 'Placeholder Gujarati Font', size: 100, weight: 700, color: '#ffee00', shadow: true },
    translit: { font: null, size: 50, weight: 400, color: '#cccccc', shadow: false },
  },
  box: { x: 0.1, y: 0.5, width: 0.8, height: 0.4, align: 'left', verticalAlign: 'bottom', lineHeight: 1.1 },
};

function setup(height = 1080) {
  const db = openDatabase(':memory:');
  const repo = new PresentationRepo(db);
  const lib = repo.ensureLibrary('Kirtans');
  db.prepare(
    "INSERT INTO media (id, kind, name, path, playable) VALUES ('old', 'image', 'Old.png', 'ab/o.png', 1)",
  ).run();
  const id = repo.insert({
    libraryId: lib,
    name: 'Placeholder',
    width: height === 1080 ? 1920 : 1280,
    height,
    groups: [
      {
        name: 'Verse',
        slides: [
          {
            background: '#123456',
            elements: [
              text('નમૂના\nNamūnā', [
                { text: 'નમૂના\n', size: 70, lang: 'gu' },
                { text: 'Namūnā', size: 40, italic: true, lang: 'translit' },
              ]),
              text('Placeholder English', undefined, { x: 5, y: 6, width: 7, height: 8 }),
            ],
            cues: [
              {
                kind: 'background',
                label: '',
                mediaId: 'old',
                props: { media: 'image', fit: 'fill', loop: false },
              },
            ],
          },
          { elements: [text('Rkk', [{ text: 'Rkk', legacy: true, font: 'Gopika', size: 50 }])] },
          { elements: [text('નમૂના\nNamūnā plain')] },
        ],
      },
    ],
  });
  return { db, repo, rows: must(readContent(db, id)) };
}

const texts = (rows: ContentRows) => rows.elements.map((e) => JSON.parse(e.props) as TextElement);

describe('applying a theme', () => {
  it('styles each run by its language, moves the first text box, and never changes words', () => {
    const { rows } = setup();
    const out = applyTheme(rows, theme, () => 'cue');
    const [first, second] = out.elements
      .filter((e) => e.slide_id === rows.slides[0]?.id)
      .sort((a, b) => a.position - b.position);
    expect([first?.x, first?.y, first?.width, first?.height]).toEqual([192, 540, 1536, 432]);
    expect([second?.x, second?.y, second?.width, second?.height]).toEqual([5, 6, 7, 8]);
    const box = JSON.parse(must(first).props) as TextElement;
    expect(box.runs).toEqual([
      {
        text: 'નમૂના\n',
        lang: 'gu',
        font: 'Placeholder Gujarati Font',
        size: 100,
        weight: 700,
        color: '#ffee00',
        shadow: true,
      },
      {
        text: 'Namūnā',
        lang: 'translit',
        italic: true,
        font: null,
        size: 50,
        weight: 400,
        color: '#cccccc',
        shadow: false,
      },
    ]);
    expect(box.style).toMatchObject({
      align: 'left',
      verticalAlign: 'bottom',
      lineHeight: 1.1,
      fontSize: 100,
    });
    const english = JSON.parse(must(second).props) as TextElement;
    expect(english.style).toMatchObject({ fontSize: 80, align: 'left' });
    // Words are the same, box by box.
    expect(texts(out).map((t) => t.text)).toEqual(texts(rows).map((t) => t.text));
    expect(out.themeId).toBe('theme-1');
  });

  it('keeps legacy-font text in its font, and gives plain mixed lines a look per language', () => {
    const { rows } = setup();
    const out = texts(applyTheme(rows, theme));
    const legacy = out.find((t) => t.text === 'Rkk');
    expect(legacy?.runs?.[0]).toMatchObject({ font: 'Gopika', legacy: true, size: 80 });
    const plain = out.find((t) => t.text.endsWith('plain'));
    expect(plain?.runs).toEqual([
      {
        text: 'નમૂના\n',
        lang: 'gu',
        font: 'Placeholder Gujarati Font',
        size: 100,
        weight: 700,
        color: '#ffee00',
        shadow: true,
      },
      {
        text: 'Namūnā plain',
        lang: 'translit',
        font: null,
        size: 50,
        weight: 400,
        color: '#cccccc',
        shadow: false,
      },
    ]);
  });

  it('scales sizes to the presentation', () => {
    const { rows } = setup(720);
    const out = texts(applyTheme(rows, theme));
    // 100 on a 1080-high slide is 67 on a 720-high one.
    expect(out.find((t) => t.text === 'નમૂના\nNamūnā')?.runs?.[0]?.size).toBe(67);
  });

  it('puts a picture or video on every slide as a background cue, or a colour behind every slide', () => {
    const { rows } = setup();
    const media = applyTheme(rows, {
      ...theme,
      background: { kind: 'media', mediaId: 'new', media: 'video', fit: 'fill', loop: true },
    });
    expect(media.cues.map((c) => [c.kind, c.media_id])).toEqual(rows.slides.map(() => ['background', 'new']));
    expect(media.slides.every((s) => s.background === null)).toBe(true);
    const color = applyTheme(rows, { ...theme, background: { kind: 'color', color: '#002244' } });
    expect(color.cues).toEqual([]);
    expect(color.slides.map((s) => s.background)).toEqual(rows.slides.map(() => '#002244'));
    const none = applyTheme(rows, theme);
    expect(none.cues).toEqual(rows.cues);
    expect(none.slides).toEqual(rows.slides);
  });
});

describe('theme looks and themes from templates', () => {
  it("gives new slides the theme's box, English look, and a look per language", () => {
    const look = themeLook(theme, 1920, 1080);
    expect(look.frame).toEqual({ x: 192, y: 540, width: 1536, height: 432 });
    expect(look.style).toMatchObject({ fontSize: 80, align: 'left', verticalAlign: 'bottom' });
    expect(look.langs.gu).toEqual({
      font: 'Placeholder Gujarati Font',
      size: 100,
      weight: 700,
      color: '#ffee00',
      shadow: true,
    });
  });

  it('makes a theme from a template: its first text box, the look of each language, its background', () => {
    const { rows } = setup();
    const made = must(themeFromContent(rows, 'From a template'));
    expect(made.box).toMatchObject({ x: 0.05, y: 96 / 1080, align: 'center', verticalAlign: 'middle' });
    expect(made.langs.gu).toMatchObject({ size: 70 });
    expect(made.langs.translit).toMatchObject({ size: 40 });
    expect(made.langs.en).toMatchObject({ size: 80 });
    expect(made.background).toEqual({
      kind: 'media',
      mediaId: 'old',
      media: 'image',
      fit: 'fill',
      loop: false,
    });
  });
});

describe('themes in the library', () => {
  it('keeps a default theme that cannot be removed, and the ones the operator makes', () => {
    const repo = new ThemeRepo(openDatabase(':memory:'));
    const def = repo.defaultId();
    expect(repo.defaultId()).toBe(def);
    expect(repo.list().map((t) => t.name)).toEqual(['Drashti default']);
    const id = repo.create({ ...DEFAULT_THEME, name: 'Placeholder evening' });
    expect(repo.update(id, { ...DEFAULT_THEME, name: 'Placeholder night' })).toBe(true);
    expect(repo.get(id)?.name).toBe('Placeholder night');
    expect(repo.remove(def)).toBe(false);
    expect(repo.remove(id)).toBe(true);
    expect(repo.themeOrDefault(id).id).toBe(def);
  });
});
