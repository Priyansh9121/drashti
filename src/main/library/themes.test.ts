import { describe, expect, it } from 'vitest';
import type { TextElement, TextRun } from '../../shared/model';
import type { Theme } from '../../shared/themes';
import { DEFAULT_THEME } from '../../shared/themes';
import type { ContentRows } from '../db/content';
import { readContent } from '../db/content';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { seedBuiltinThemes } from '../db/seed';
import { ThemeRepo } from '../db/themes';
import { LYRICS_STYLE } from '../import/formats/text';
import { applyTheme, styleNewText, themeLook } from './themes';

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

function savedDesignBackgrounds() {
  const { db, repo, rows } = setup();
  db.prepare('INSERT INTO media (id, kind, name, path, playable) VALUES (?, ?, ?, ?, 1)').run(
    'placeholder-theme-picture',
    'image',
    'Placeholder theme picture',
    'placeholder-theme.png',
  );
  db.prepare('INSERT INTO media (id, kind, name, path, playable) VALUES (?, ?, ?, ?, 1)').run(
    'placeholder-theme-sound',
    'audio',
    'Placeholder theme sound',
    'placeholder-theme.wav',
  );
  const designs = [
    {
      backdrop: { kind: 'gradient', from: '#334455', to: '#667788', angle: 90 },
      layout: 'two-columns',
      skipMaster: true,
      futureDesign: { placeholder: ['first', 1] },
    },
    {
      backdrop: { kind: 'picture', mediaId: 'old', fit: 'fill' },
      layout: 'heading-words',
      skipMaster: false,
      futureDesign: { placeholder: ['second', 2] },
    },
    { layout: 'words', skipMaster: true, futureDesign: { placeholder: ['third', 3] } },
  ];
  // The last slide has no backdrop: its original JSON, including whitespace, must not be rewritten.
  const designJson = designs.map((design, i) => JSON.stringify(design, null, i === 2 ? 2 : undefined));
  const first = must(rows.slides[0]);
  const saved: ContentRows = {
    ...rows,
    slides: rows.slides.map((slide, i) => ({
      ...slide,
      notes: `Placeholder theme notes ${String(i + 1)}`,
      editor_guides: '{"x":[320],"y":[240]}',
      editor_design: must(designJson[i]),
    })),
    cues: [
      ...rows.cues,
      {
        id: 'placeholder-theme-sound-cue',
        slide_id: first.id,
        position: 1,
        kind: 'audio',
        label: 'Placeholder theme sound',
        media_id: 'placeholder-theme-sound',
        props: '{ "volume": 0.4, "loop": false }',
      },
    ],
  };
  repo.setContent(saved);
  const stored = must(readContent(db, rows.presentationId));
  expect(stored.slides.map((slide) => slide.editor_design)).toEqual(designJson);
  return { db, repo, rows: stored, designs, designJson };
}

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

  for (const background of [
    { kind: 'color', color: '#002244' },
    {
      kind: 'media',
      mediaId: 'placeholder-theme-picture',
      media: 'image',
      fit: 'fill',
      loop: false,
    },
  ] as const)
    it(`replaces saved Design backdrops with the theme's ${background.kind} background, keeping the rest and Undo`, () => {
      const { db, repo, rows, designs } = savedDesignBackgrounds();
      try {
        const before = structuredClone(rows);
        const { id: _oldThemeId, ...fields } = theme;
        const themes = new ThemeRepo(db);
        const chosen = must(themes.get(themes.create({ ...fields, background })));
        let cue = 0;
        const changed = applyTheme(rows, chosen, () => `placeholder-theme-cue-${String(++cue)}`);
        expect(rows).toEqual(before);
        repo.setContent(changed);
        const reloaded = must(readContent(db, rows.presentationId));
        const shown = must(repo.get(rows.presentationId)).groups.flatMap((group) => group.slides);
        expect(shown).toHaveLength(rows.slides.length);
        for (const info of shown) {
          // RED on the old source: its stale gradient/picture still covers the newly selected theme.
          expect(info.slide.backdrop).toBeUndefined();
          expect(info.slide.background).toBe(background.kind === 'color' ? background.color : null);
          const backgrounds = info.cues.filter((item) => item.kind === 'background');
          if (background.kind === 'color') expect(backgrounds).toEqual([]);
          else
            expect(backgrounds).toEqual([
              expect.objectContaining({
                kind: 'background',
                background: {
                  kind: 'media',
                  mediaId: background.mediaId,
                  media: background.media,
                  fit: background.fit,
                  loop: background.loop,
                },
              }),
            ]);
        }
        for (const [i, original] of rows.slides.entries()) {
          const actual = must(reloaded.slides[i]);
          const design = must(designs[i]);
          const expected = Object.fromEntries(Object.entries(design).filter(([key]) => key !== 'backdrop'));
          expect(JSON.parse(must(actual.editor_design)) as unknown).toEqual(expected);
          const {
            background: _beforeBackground,
            darken: _beforeDarken,
            editor_design: _beforeDesign,
            ...kept
          } = original;
          const {
            background: _afterBackground,
            darken: _afterDarken,
            editor_design: _afterDesign,
            ...stillKept
          } = actual;
          expect(stillKept).toEqual(kept);
        }
        expect(reloaded.slides[2]?.editor_design).toBe(rows.slides[2]?.editor_design);
        expect(texts(reloaded).map((box) => box.text)).toEqual(texts(rows).map((box) => box.text));
        expect(reloaded.cues.filter((item) => item.kind !== 'background')).toEqual(
          rows.cues
            .filter((item) => item.kind !== 'background')
            .map((item) => ({ ...item, position: item.position + (background.kind === 'media' ? 1 : 0) })),
        );
        // As the operator's Undo does: all original rows, cue props and Design JSON return exactly.
        repo.setContent(rows);
        expect(must(readContent(db, rows.presentationId))).toEqual(rows);
      } finally {
        db.close();
      }
    });

  it('keeps saved Design JSON byte-for-byte when the theme leaves backgrounds alone', () => {
    const { db, repo, rows, designJson, designs } = savedDesignBackgrounds();
    try {
      const { id: _oldThemeId, ...fields } = theme;
      const themes = new ThemeRepo(db);
      const chosen = must(themes.get(themes.create({ ...fields, background: { kind: 'none' } })));
      repo.setContent(applyTheme(rows, chosen));
      const reloaded = must(readContent(db, rows.presentationId));
      expect(reloaded.slides.map((slide) => slide.editor_design)).toEqual(designJson);
      expect(reloaded.cues).toEqual(rows.cues);
      const shown = must(repo.get(rows.presentationId)).groups.flatMap((group) => group.slides);
      expect(shown[0]?.slide.backdrop).toEqual(designs[0]?.backdrop);
      expect(shown[1]?.slide.backdrop).toEqual(designs[1]?.backdrop);
    } finally {
      db.close();
    }
  });

  it('puts its darkening behind the words on every slide, and takes it off where it has none (Sessions 31–36, SLD-3)', () => {
    const { rows } = setup();
    const dark = applyTheme(rows, { ...theme, darken: { kind: 'band', strength: 0.6 } });
    expect(dark.slides.map((s) => s.darken)).toEqual(rows.slides.map(() => '{"kind":"band","strength":0.6}'));
    expect(applyTheme(dark, theme).slides.map((s) => s.darken)).toEqual(rows.slides.map(() => null));
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

  it('gives new text at least 1.35 between its lines; applying a stored theme gives its own (Sessions 31–36, I18N-2)', () => {
    // The theme here has 1.1: new slides get 1.35, and a theme set wider keeps its own.
    expect(themeLook(theme, 1920, 1080).style.lineHeight).toBe(1.35);
    const wide = { ...theme, box: { ...theme.box, lineHeight: 1.6 } };
    expect(themeLook(wide, 1920, 1080).style.lineHeight).toBe(1.6);
    // A new presentation's words, styled by the default theme: new text too.
    const { rows } = setup();
    expect(texts(styleNewText(rows, theme)).map((t) => t.style.lineHeight)).toEqual([1.35, 1.35, 1.35, 1.35]);
    expect(texts(styleNewText(rows, wide)).map((t) => t.style.lineHeight)).toEqual([1.6, 1.6, 1.6, 1.6]);
    // Slides already made, given the theme: its own, as stored themes never change.
    expect(texts(applyTheme(rows, theme)).map((t) => t.style.lineHeight)).toEqual([1.1, 1.1, 1.1, 1.1]);
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

describe('built-in themes in the library (Session 26)', () => {
  it('a built-in one can be removed, and made the default for new presentations', () => {
    const db = openDatabase(':memory:');
    seedBuiltinThemes(db);
    const repo = new ThemeRepo(db);
    const ocean = must(repo.list().find((t) => t.name === 'Ocean'));
    expect(repo.setDefault(ocean.id)).toBe(true);
    expect(repo.themeOrDefault(null).name).toBe('Ocean');
    const ivory = must(repo.list().find((t) => t.name === 'Ivory'));
    expect(repo.remove(ivory.id)).toBe(true);
  });
});
