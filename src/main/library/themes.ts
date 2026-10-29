import { randomUUID } from 'node:crypto';
import type { Lang, TextRun, TextStyle } from '../../shared/model';
import { LANGS, NEW_TEXT_LINE_HEIGHT } from '../../shared/model';
import { detectLang, mainLang, mergeRuns } from '../../shared/text-runs';
import type { Theme, ThemeFields, ThemeLangStyle } from '../../shared/themes';
import type { ContentRows, CueRow, ElementRow, SlideRow } from '../db/content';
import type { NewSlideLook } from './words';

/*
 * Applying a theme to a presentation's rows: styles, the first text box's
 * place, and backgrounds change; words never do. Text in a legacy font keeps
 * its font (it only reads right in that font).
 */

interface TextProps {
  text: string;
  lang: Lang | null;
  style: TextStyle;
  runs?: TextRun[];
}

const readText = (row: ElementRow): TextProps | null => {
  if (row.kind !== 'text') return null;
  try {
    const p = JSON.parse(row.props) as Partial<TextProps>;
    return typeof p.text === 'string' && typeof p.style === 'object' ? (p as TextProps) : null;
  } catch {
    return null;
  }
};

const byPosition = <T extends { position: number }>(list: readonly T[]) =>
  [...list].sort((a, b) => a.position - b.position);

/**
 * A Timer under the theme (Session 50): its digits in the theme's words (font, weight, colour, shadow), as New
 * Timer Slide… makes them; its size, place and own settings as they were. Anything else as it is.
 */
function themedTimer(row: ElementRow, theme: ThemeFields): ElementRow {
  if (row.kind !== 'timer') return row;
  try {
    const p = JSON.parse(row.props) as { style?: unknown };
    if (typeof p.style !== 'object' || p.style === null) return row;
    const en = theme.langs.en;
    const style = {
      ...p.style,
      fontFamily: en.font,
      fontWeight: en.weight,
      color: en.color,
      shadow: en.shadow,
    };
    return { ...row, props: JSON.stringify({ ...p, style }) };
  } catch {
    return row;
  }
}

/** How a run in this language looks under the theme. */
function runLook(
  t: ThemeLangStyle,
  scale: number,
): Pick<TextRun, 'font' | 'size' | 'weight' | 'color' | 'shadow'> {
  return {
    font: t.font,
    size: Math.round(t.size * scale),
    weight: t.weight,
    color: t.color,
    shadow: t.shadow,
  };
}

/** A text box under the theme: every run in its language's look, the box's alignment. */
function themedText(p: TextProps, theme: ThemeFields, scale: number): TextProps {
  const text = p.runs && p.runs.length > 0 ? p.runs.map((r) => r.text).join('') : p.text;
  // The box's own language: Gujarati or Hindi whenever it has any (the Latin beside them is their transliteration).
  const lang: Lang =
    p.lang ??
    mainLang(p.runs && p.runs.length > 0 ? p.runs : text.split('\n').map((l) => ({ text: l }))) ??
    'en';
  const base = theme.langs[lang];
  const style: TextStyle = {
    ...p.style,
    fontFamily: base.font,
    fontSize: Math.round(base.size * scale),
    fontWeight: base.weight,
    color: base.color,
    shadow: base.shadow,
    align: theme.box.align,
    verticalAlign: theme.box.verticalAlign,
    lineHeight: theme.box.lineHeight,
  };
  let runs = p.runs && p.runs.length > 0 ? p.runs : undefined;
  if (!runs) {
    // Lines in more than one language: each gets its own look (the words stay as they are).
    const lines = text
      .split('\n')
      .map((l, i, all) => ({ text: i < all.length - 1 ? `${l}\n` : l, lang: detectLang(l) }));
    const langs = new Set(lines.map((l) => l.lang).filter((l) => l !== null));
    if (langs.size > 1) runs = lines;
  }
  if (!runs) return { ...p, style };
  const themed = runs.map((run): TextRun => {
    const runLang = run.lang ?? detectLang(run.text) ?? lang;
    const look = runLook(theme.langs[runLang], scale);
    // Legacy-font text only reads right in its own font.
    return run.legacy ? { ...run, ...look, font: run.font } : { ...run, ...look, lang: run.lang ?? runLang };
  });
  return { ...p, style, runs: mergeRuns(themed) };
}

/**
 * New text's line spacing under a theme (Sessions 31–36, I18N-2): the theme's, but never below 1.35, room for
 * Gujarati and Hindi marks. A stored theme keeps its own for applying it, as it never changes (Shastra
 * passages are made from it).
 */
const newTextLineHeight = (theme: ThemeFields) => Math.max(theme.box.lineHeight, NEW_TEXT_LINE_HEIGHT);

/** A new presentation's rows styled by a theme (the words editor's): as applyTheme, its new text at least 1.35. */
export function styleNewText(rows: ContentRows, theme: Theme, newId: () => string = randomUUID): ContentRows {
  return applyTheme(rows, { ...theme, box: { ...theme.box, lineHeight: newTextLineHeight(theme) } }, newId);
}

/** A presentation's rows with a theme applied. */
export function applyTheme(rows: ContentRows, theme: Theme, newId: () => string = randomUUID): ContentRows {
  const scale = rows.height / 1080;
  const elements = new Map<string, ElementRow[]>();
  for (const e of rows.elements) elements.set(e.slide_id, [...(elements.get(e.slide_id) ?? []), e]);
  const out: ElementRow[] = [];
  for (const [, list] of elements) {
    // A slide with a Timer (Session 50) keeps its layout: its words (Timer with words' line above the time) stay
    // where they are, taking only the theme's look, never moved into the theme's box across the time.
    const timed = list.some((e) => e.kind === 'timer');
    const firstText = timed ? undefined : byPosition(list).find((e) => readText(e) !== null)?.id;
    for (const e of list) {
      const p = readText(e);
      if (!p) {
        out.push(themedTimer(e, theme));
        continue;
      }
      const box =
        e.id === firstText
          ? {
              x: Math.round(theme.box.x * rows.width),
              y: Math.round(theme.box.y * rows.height),
              width: Math.round(theme.box.width * rows.width),
              height: Math.round(theme.box.height * rows.height),
            }
          : {};
      out.push({ ...e, ...box, props: JSON.stringify(themedText(p, theme, scale)) });
    }
  }
  // Its darkening behind the words (Sessions 31–36, SLD-3) on every slide, none where it has none.
  const darken = theme.darken ? JSON.stringify(theme.darken) : null;
  let slides: SlideRow[] = rows.slides.map((s) => ({ ...s, darken }));
  let cues: CueRow[] = rows.cues;
  const bg = theme.background;
  if (bg.kind === 'color') {
    slides = slides.map((s) => ({ ...s, background: bg.color }));
    cues = cues.filter((c) => c.kind !== 'background');
  } else if (bg.kind === 'media') {
    // The picture or video on every slide: going live anywhere puts it up, and the same file carries on.
    slides = slides.map((s) => ({ ...s, background: null }));
    const others = cues
      .filter((c) => c.kind !== 'background')
      .map((c) => ({ ...c, position: c.position + 1 }));
    const props = JSON.stringify({ media: bg.media, fit: bg.fit, loop: bg.loop });
    cues = [
      ...slides.map((s) => ({
        id: newId(),
        slide_id: s.id,
        position: 0,
        kind: 'background',
        label: '',
        media_id: bg.mediaId,
        props,
      })),
      ...others,
    ];
  }
  return { ...rows, themeId: theme.id, elements: out, slides, cues };
}

/** How a new slide looks under the theme (for the words editor and new presentations). */
export function themeLook(theme: ThemeFields, width: number, height: number): NewSlideLook {
  const scale = height / 1080;
  const en = theme.langs.en;
  return {
    frame: {
      x: Math.round(theme.box.x * width),
      y: Math.round(theme.box.y * height),
      width: Math.round(theme.box.width * width),
      height: Math.round(theme.box.height * height),
    },
    style: {
      fontFamily: en.font,
      fontSize: Math.round(en.size * scale),
      fontWeight: en.weight,
      color: en.color,
      align: theme.box.align,
      verticalAlign: theme.box.verticalAlign,
      lineHeight: newTextLineHeight(theme),
      shadow: en.shadow,
    },
    langs: Object.fromEntries(LANGS.map((l) => [l, runLook(theme.langs[l], scale)])),
    background: theme.background.kind === 'color' ? theme.background.color : null,
    darken: theme.darken ?? null,
  };
}
