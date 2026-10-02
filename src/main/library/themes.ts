import { randomUUID } from 'node:crypto';
import type { Lang, TextRun, TextStyle } from '../../shared/model';
import { LANGS } from '../../shared/model';
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

/** A presentation's rows with a theme applied. */
export function applyTheme(rows: ContentRows, theme: Theme, newId: () => string = randomUUID): ContentRows {
  const scale = rows.height / 1080;
  const elements = new Map<string, ElementRow[]>();
  for (const e of rows.elements) elements.set(e.slide_id, [...(elements.get(e.slide_id) ?? []), e]);
  const out: ElementRow[] = [];
  for (const [, list] of elements) {
    const firstText = byPosition(list).find((e) => readText(e) !== null)?.id;
    for (const e of list) {
      const p = readText(e);
      if (!p) {
        out.push(e);
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
  let slides: SlideRow[] = rows.slides;
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
      lineHeight: theme.box.lineHeight,
      shadow: en.shadow,
    },
    langs: Object.fromEntries(LANGS.map((l) => [l, runLook(theme.langs[l], scale)])),
    background: theme.background.kind === 'color' ? theme.background.color : null,
  };
}

/**
 * A theme from a presentation's first text box (an imported template): its
 * place and alignment, each language's look as its runs have it (the box's
 * own style for the rest), and the first slide's background. Null when it
 * has no text box.
 */
export function themeFromContent(rows: ContentRows, name: string): ThemeFields | null {
  const groupOrder = new Map(rows.groups.map((g) => [g.id, g.position]));
  const slides = [...rows.slides].sort(
    (a, b) =>
      (groupOrder.get(a.group_id) ?? 0) - (groupOrder.get(b.group_id) ?? 0) || a.position - b.position,
  );
  for (const slide of slides) {
    const element = byPosition(rows.elements.filter((e) => e.slide_id === slide.id)).find((e) => readText(e));
    const p = element ? readText(element) : null;
    if (!element || !p) continue;
    const scale = rows.height / 1080;
    const s = p.style;
    const own: ThemeLangStyle = {
      font: s.fontFamily,
      size: Math.round(s.fontSize / scale),
      weight: s.fontWeight,
      color: s.color,
      // Themes keep a shadow on or off: a shadow of the box's own counts as on.
      shadow: s.shadow !== false,
    };
    const langs = Object.fromEntries(LANGS.map((l) => [l, { ...own }])) as Record<Lang, ThemeLangStyle>;
    const seen = new Set<Lang>();
    for (const run of p.runs ?? []) {
      const lang = run.lang ?? detectLang(run.text);
      if (!lang || run.legacy || seen.has(lang)) continue;
      seen.add(lang);
      langs[lang] = {
        font: run.font ?? own.font,
        size: run.size !== undefined ? Math.round(run.size / scale) : own.size,
        weight: run.weight ?? own.weight,
        color: run.color ?? own.color,
        shadow: run.shadow === undefined ? own.shadow : run.shadow !== false,
      };
    }
    const cue = rows.cues.find((c) => c.slide_id === slide.id && c.kind === 'background' && c.media_id);
    let background: ThemeFields['background'] = slide.background
      ? { kind: 'color', color: slide.background.slice(0, 7) }
      : { kind: 'none' };
    if (cue?.media_id) {
      const c = JSON.parse(cue.props) as {
        media?: 'image' | 'video';
        fit?: 'fit' | 'fill' | 'stretch';
        loop?: boolean;
      };
      background = {
        kind: 'media',
        mediaId: cue.media_id,
        media: c.media ?? 'image',
        fit: c.fit ?? 'fill',
        loop: c.loop ?? true,
      };
    }
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return {
      name,
      langs,
      box: {
        x: clamp(element.x / rows.width),
        y: clamp(element.y / rows.height),
        width: clamp(Math.max(element.width / rows.width, 0.05)),
        height: clamp(Math.max(element.height / rows.height, 0.05)),
        align: s.align,
        verticalAlign: s.verticalAlign,
        lineHeight: s.lineHeight,
      },
      background:
        background.kind === 'color' && !/^#[0-9a-fA-F]{6}$/u.test(background.color)
          ? { kind: 'none' }
          : background,
    };
  }
  return null;
}
