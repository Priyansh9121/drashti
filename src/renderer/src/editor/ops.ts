import type {
  Lang,
  MediaElement,
  Outline,
  ShapeElement,
  SlideElement,
  TextAlign,
  TextElement,
  TextRun,
  TextShadow,
  VerticalAlign,
} from '../../../shared/model';
import type { EditDoc, EditSlide, SlideLook } from '../../../shared/slide-edit';
import { mainLang } from '../../../shared/text-runs';
import { boundsOf, type Point } from './geometry';

/*
 * What the slide editor does to its document, as pure functions: each
 * returns a new document (or element) and leaves the old one as it was, so
 * Undo is keeping the old one.
 */

/** A fresh id for something new (the main process gives it its stored id when saved). */
export const newId = (): string => crypto.randomUUID();

export function findSlide(doc: EditDoc, slideId: string | null): EditSlide | undefined {
  if (slideId === null) return undefined;
  for (const g of doc.groups) for (const s of g.slides) if (s.id === slideId) return s;
  return undefined;
}

export function mapSlide(doc: EditDoc, slideId: string, fn: (slide: EditSlide) => EditSlide): EditDoc {
  return {
    ...doc,
    groups: doc.groups.map((g) =>
      g.slides.some((s) => s.id === slideId)
        ? { ...g, slides: g.slides.map((s) => (s.id === slideId ? fn(s) : s)) }
        : g,
    ),
  };
}

/** Change some elements of a slide. */
export function mapElements(
  doc: EditDoc,
  slideId: string,
  ids: readonly string[],
  fn: (el: SlideElement) => SlideElement,
): EditDoc {
  const set = new Set(ids);
  return mapSlide(doc, slideId, (s) => ({
    ...s,
    elements: s.elements.map((el) => (set.has(el.id) ? fn(el) : el)),
  }));
}

const round = (n: number) => Math.round(n * 100) / 100;

export function moveElements(doc: EditDoc, slideId: string, ids: readonly string[], d: Point): EditDoc {
  return mapElements(doc, slideId, ids, (el) => ({
    ...el,
    frame: { ...el.frame, x: round(el.frame.x + d.x), y: round(el.frame.y + d.y) },
  }));
}

/** Move each element by its own amount (lining up and spacing out). */
export function moveEach(doc: EditDoc, slideId: string, moves: ReadonlyMap<string, Point>): EditDoc {
  return mapElements(doc, slideId, [...moves.keys()], (el) => {
    const d = moves.get(el.id) ?? { x: 0, y: 0 };
    return { ...el, frame: { ...el.frame, x: round(el.frame.x + d.x), y: round(el.frame.y + d.y) } };
  });
}

export function deleteElements(doc: EditDoc, slideId: string, ids: readonly string[]): EditDoc {
  const set = new Set(ids);
  return mapSlide(doc, slideId, (s) => ({ ...s, elements: s.elements.filter((el) => !set.has(el.id)) }));
}

/** Put a new element on top of the others. */
export function addElement(doc: EditDoc, slideId: string, el: SlideElement): EditDoc {
  return mapSlide(doc, slideId, (s) => ({ ...s, elements: [...s.elements, el] }));
}

/** Copies of some elements, a little down and to the right, on top; returns the copies' ids. */
export function duplicateElements(
  doc: EditDoc,
  slideId: string,
  ids: readonly string[],
  offset = 24,
): { doc: EditDoc; ids: string[] } {
  const slide = findSlide(doc, slideId);
  if (!slide) return { doc, ids: [] };
  const copies = slide.elements
    .filter((el) => ids.includes(el.id))
    .map((el) => ({
      ...structuredClone(el),
      id: newId(),
      frame: { ...el.frame, x: el.frame.x + offset, y: el.frame.y + offset },
    }));
  return {
    doc: mapSlide(doc, slideId, (s) => ({ ...s, elements: [...s.elements, ...copies] })),
    ids: copies.map((c) => c.id),
  };
}

export type Arrange = 'front' | 'forward' | 'backward' | 'back';

/** Bring elements to the front or one step forward, or send them back (the order is bottom to top). */
export function arrange(doc: EditDoc, slideId: string, ids: readonly string[], how: Arrange): EditDoc {
  const set = new Set(ids);
  return mapSlide(doc, slideId, (s) => {
    const list = [...s.elements];
    if (how === 'front' || how === 'back') {
      const moving = list.filter((el) => set.has(el.id));
      const rest = list.filter((el) => !set.has(el.id));
      return { ...s, elements: how === 'front' ? [...rest, ...moving] : [...moving, ...rest] };
    }
    // One step: each chosen element swaps with the next one that is not chosen.
    const step = how === 'forward' ? 1 : -1;
    const order = list.map((_, i) => i);
    if (step > 0) order.reverse();
    for (const i of order) {
      const j = i + step;
      const a = list[i];
      const b = list[j];
      if (a && b && set.has(a.id) && !set.has(b.id)) [list[i], list[j]] = [b, a];
    }
    return { ...s, elements: list };
  });
}

// ---- new elements in the presentation's look ------------------------------------------

/** A new, empty text box in the theme's place and style. */
export function newTextBox(look: SlideLook): TextElement {
  return {
    id: newId(),
    kind: 'text',
    frame: { ...look.frame },
    text: '',
    lang: null,
    style: { ...look.style },
  };
}

export type ShapeChoice = 'rectangle' | 'rounded' | 'ellipse' | 'line';

/**
 * A new shape in the middle of the slide, in a colour that shows on any
 * slide (blue, as verses are): a box, a rounded one or an ellipse; a line in
 * the theme's text colour.
 */
export function newShape(
  choice: ShapeChoice,
  look: SlideLook,
  size: { width: number; height: number },
): ShapeElement {
  const width = Math.round(size.width * 0.4);
  const height = choice === 'line' ? 20 : Math.round(size.height * 0.3);
  const frame = {
    x: Math.round((size.width - width) / 2),
    y: Math.round((size.height - height) / 2),
    width,
    height,
  };
  const base = { id: newId(), kind: 'shape' as const, frame, cornerRadius: 0, opacity: 1 };
  if (choice === 'line')
    return { ...base, shape: 'line', fill: null, outline: { color: look.style.color, width: 6 } };
  return {
    ...base,
    ...(choice === 'ellipse' ? { shape: 'ellipse' as const } : { shape: 'rectangle' as const }),
    fill: '#3e63dd',
    cornerRadius: choice === 'rounded' ? Math.round(Math.min(width, height) * 0.12) : 0,
  };
}

/** A picture or video at its own proportions, half the slide wide at most, in the middle. */
export function newMedia(
  media: { id: string; kind: 'image' | 'video'; width?: number; height?: number },
  size: { width: number; height: number },
): MediaElement {
  const ratio = media.width && media.height ? media.width / media.height : 16 / 9;
  let width = size.width * 0.5;
  let height = width / ratio;
  if (height > size.height * 0.6) {
    height = size.height * 0.6;
    width = height * ratio;
  }
  return {
    id: newId(),
    kind: media.kind,
    frame: {
      x: Math.round((size.width - width) / 2),
      y: Math.round((size.height - height) / 2),
      width: Math.round(width),
      height: Math.round(height),
    },
    mediaId: media.id,
    fit: 'fit',
    ...(media.kind === 'video' ? { loop: true } : {}),
  };
}

// ---- text styles for a whole box --------------------------------------------------------

/** A change to how text looks: a value sets it, undefined goes back to the box's (or default). */
export interface TextPatch {
  font?: string | null | undefined;
  size?: number | undefined;
  weight?: number | undefined;
  italic?: boolean | undefined;
  color?: string | undefined;
  shadow?: TextShadow | undefined;
  outline?: Outline | null | undefined;
  lang?: Lang | null | undefined;
}

/** Box-only settings. */
export interface BoxPatch {
  align?: TextAlign;
  verticalAlign?: VerticalAlign;
  lineHeight?: number;
  shrinkToFit?: boolean;
}

/** The run fields each text setting writes. */
const RUN_KEYS: Record<keyof TextPatch, keyof TextRun> = {
  font: 'font',
  size: 'size',
  weight: 'weight',
  italic: 'italic',
  color: 'color',
  shadow: 'shadow',
  outline: 'outline',
  lang: 'lang',
};

/** A run look with a change: set keys, and drop the ones changed to undefined (so they follow the box). */
export function patchRun(run: TextRun, patch: TextPatch): TextRun {
  const changes = (Object.entries(patch) as [keyof TextPatch, unknown][]).map(
    ([k, v]) => [RUN_KEYS[k], v] as const,
  );
  const changed = new Set<string>(changes.map(([k]) => k));
  return Object.fromEntries([
    ...Object.entries(run).filter(([k]) => !changed.has(k)),
    ...changes.filter(([, v]) => v !== undefined),
  ]) as unknown as TextRun;
}

/**
 * The whole box in a new style: the box takes it, and its words stop
 * overriding it (they follow the box). Words in a legacy font keep their
 * font and language: they only read right in that font.
 */
export function styleBox(el: TextElement, patch: TextPatch, box: BoxPatch = {}): TextElement {
  const style = { ...el.style, ...box };
  if ('font' in patch) style.fontFamily = patch.font ?? null;
  if (patch.size !== undefined) style.fontSize = patch.size;
  if (patch.weight !== undefined) style.fontWeight = patch.weight;
  if (patch.color !== undefined) style.color = patch.color;
  if ('shadow' in patch) style.shadow = patch.shadow ?? false;
  if ('outline' in patch) {
    if (patch.outline) style.outline = patch.outline;
    else delete style.outline;
  }
  // Italic has no box setting: every word gets it. Everything else: the words follow the box.
  const forWords: TextPatch = {};
  for (const k of Object.keys(patch) as (keyof TextPatch)[]) {
    if (k === 'italic') forWords.italic = patch.italic ? true : undefined;
    else forWords[k] = undefined;
  }
  let runs = el.runs?.map((r) =>
    patchRun(r, r.legacy ? { ...forWords, font: r.font, lang: r.lang } : forWords),
  );
  if (patch.italic && (!runs || runs.length === 0)) runs = [{ text: el.text, italic: true }];
  const next: TextElement = { ...el, style };
  if ('lang' in patch) next.lang = patch.lang ?? null;
  if (runs?.some((r) => Object.keys(r).some((k) => k !== 'text'))) next.runs = runs;
  else delete next.runs;
  if (!('lang' in patch) && next.lang === null && runs) next.lang = mainLang(runs);
  return next;
}

/** Whether an element can be seen with its frame here: its upright bounds meet the slide. */
export const onSlide = (el: SlideElement, size: { width: number; height: number }): boolean => {
  const b = boundsOf(el);
  return b.x < size.width && b.y < size.height && b.x + b.width > 0 && b.y + b.height > 0;
};

// ---- slides and groups -----------------------------------------------------------------

/** A blank slide (with the look's background colour). */
export function newSlide(look: SlideLook | null): EditSlide {
  return {
    id: newId(),
    label: '',
    notes: '',
    background: look?.background ?? null,
    enabled: true,
    transition: null,
    autoAdvanceMs: null,
    macroId: null,
    elements: [],
    cues: [],
  };
}

/** A slide's place: its group and its index in the group. */
export function placeOf(doc: EditDoc, slideId: string): { group: number; index: number } | null {
  for (const [group, g] of doc.groups.entries()) {
    const index = g.slides.findIndex((s) => s.id === slideId);
    if (index >= 0) return { group, index };
  }
  return null;
}

/** Put a slide in a group at an index (taking it out of wherever it was). */
export function placeSlide(doc: EditDoc, slide: EditSlide, groupId: string, index: number): EditDoc {
  const without = doc.groups.map((g) => ({ ...g, slides: g.slides.filter((s) => s.id !== slide.id) }));
  return {
    ...doc,
    groups: without.map((g) => {
      if (g.id !== groupId) return g;
      const slides = [...g.slides];
      slides.splice(Math.max(0, Math.min(index, slides.length)), 0, slide);
      return { ...g, slides };
    }),
  };
}

/** Add a slide just after another (in its group). */
export function addSlideAfter(doc: EditDoc, afterId: string, slide: EditSlide): EditDoc {
  const at = placeOf(doc, afterId);
  const group = at ? doc.groups[at.group] : doc.groups.at(-1);
  if (!group) return { ...doc, groups: [{ id: newId(), name: '', color: null, slides: [slide] }] };
  return placeSlide(doc, slide, group.id, at ? at.index + 1 : group.slides.length);
}

/** A copy of a slide, with new ids for it and everything on it. */
export function copySlide(slide: EditSlide): EditSlide {
  return {
    ...structuredClone(slide),
    id: newId(),
    elements: slide.elements.map((el) => ({ ...structuredClone(el), id: newId() })),
    cues: slide.cues.map((c) => ({ ...c, id: newId() })),
  };
}

export function removeSlide(doc: EditDoc, slideId: string): EditDoc {
  return {
    ...doc,
    groups: doc.groups.map((g) => ({ ...g, slides: g.slides.filter((s) => s.id !== slideId) })),
  };
}

/**
 * One place up or down in the order. At the edge of its group it goes into
 * the group before or after (at the end or the start of it).
 */
export function moveSlideBy(doc: EditDoc, slideId: string, step: -1 | 1): EditDoc {
  const at = placeOf(doc, slideId);
  const slide = findSlide(doc, slideId);
  const group = at ? doc.groups[at.group] : undefined;
  if (!at || !slide || !group) return doc;
  const index = at.index + step;
  if (index >= 0 && index < group.slides.length) return placeSlide(doc, slide, group.id, index);
  const next = doc.groups[at.group + step];
  if (!next) return doc;
  return placeSlide(doc, slide, next.id, step < 0 ? next.slides.length : 0);
}

/** The colours offered for groups: the usual ones for verses, choruses and the like. */
export const GROUP_COLORS = ['#3e63dd', '#e5484d', '#f76b15', '#8e4ec6', '#12a594', '#ffc53d'] as const;

/** A new group at the end, with one blank slide; returns the slide's id. */
export function addGroup(
  doc: EditDoc,
  name: string,
  look: SlideLook | null,
): { doc: EditDoc; slideId: string } {
  const slide = newSlide(look);
  const used = new Set(doc.groups.map((g) => g.color));
  const color = GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[0];
  return {
    doc: { ...doc, groups: [...doc.groups, { id: newId(), name, color, slides: [slide] }] },
    slideId: slide.id,
  };
}

export function changeGroup(
  doc: EditDoc,
  groupId: string,
  patch: { name?: string; color?: string | null },
): EditDoc {
  return { ...doc, groups: doc.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)) };
}

export function removeGroup(doc: EditDoc, groupId: string): EditDoc {
  return { ...doc, groups: doc.groups.filter((g) => g.id !== groupId) };
}

/** Change a slide's own settings (label, notes, colour, hidden, transition, auto-advance, cues). */
export function changeSlide(
  doc: EditDoc,
  slideId: string,
  patch: Partial<Omit<EditSlide, 'id' | 'elements'>>,
): EditDoc {
  return mapSlide(doc, slideId, (s) => ({ ...s, ...patch }));
}

// ---- a slide's background and sound (its cues) ------------------------------------------

interface CueSettings {
  media?: 'image' | 'video';
  fit?: 'fit' | 'fill' | 'stretch';
  loop?: boolean;
  volume?: number;
}

/** A cue's settings, read leniently. */
export function cueSettings(cue: EditSlide['cues'][number]): CueSettings {
  try {
    const parsed: unknown = JSON.parse(cue.props);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The slide's background picture or video (a cue: it goes on the background
 * layer when the slide goes live), or none. Other cues stay as they are.
 */
export function setBackgroundCue(
  slide: EditSlide,
  media: { id: string; kind: 'image' | 'video'; fit: 'fit' | 'fill' | 'stretch'; loop: boolean } | null,
): EditSlide {
  const old = slide.cues.find((c) => c.kind === 'background');
  const others = slide.cues.filter((c) => c.kind !== 'background');
  if (!media) return { ...slide, cues: others };
  const props = {
    ...(old ? cueSettings(old) : {}),
    media: media.kind,
    fit: media.fit,
    loop: media.kind === 'video' && media.loop,
  };
  return {
    ...slide,
    cues: [
      {
        id: old?.id ?? newId(),
        kind: 'background',
        label: old?.label ?? '',
        mediaId: media.id,
        props: JSON.stringify(props),
      },
      ...others,
    ],
  };
}

/** The slide's sound (a cue on the audio layer), or none. */
export function setSoundCue(
  slide: EditSlide,
  sound: { id: string; volume: number; loop: boolean } | null,
): EditSlide {
  const old = slide.cues.find((c) => c.kind === 'audio');
  const others = slide.cues.filter((c) => c.kind !== 'audio');
  if (!sound) return { ...slide, cues: others };
  const props = { ...(old ? cueSettings(old) : {}), volume: sound.volume, loop: sound.loop };
  return {
    ...slide,
    cues: [
      ...others,
      {
        id: old?.id ?? newId(),
        kind: 'audio',
        label: old?.label ?? '',
        mediaId: sound.id,
        props: JSON.stringify(props),
      },
    ],
  };
}

// ---- one slide's look for every slide ----------------------------------------------------

/**
 * Every other slide in this slide's look: its colour, its shapes (those
 * behind its first text box go behind, the rest in front), and for each
 * text box (first with first, second with second...) its place, turn and
 * style, with each language's words in the look they have here. Words
 * never change, pictures and videos stay, and words in a legacy font keep
 * their font.
 */
export function applyLookToAll(doc: EditDoc, slideId: string): EditDoc {
  const source = findSlide(doc, slideId);
  if (!source) return doc;
  const texts = source.elements.filter((e): e is TextElement => e.kind === 'text');
  const firstText = source.elements.findIndex((e) => e.kind === 'text');
  const shapes = source.elements.filter((e): e is ShapeElement => e.kind === 'shape');
  const behind = shapes.filter((s) => firstText < 0 || source.elements.indexOf(s) < firstText);
  const front = shapes.filter((s) => !behind.includes(s));
  const looks = new Map<Lang, Omit<TextRun, 'text' | 'lang' | 'legacy'>>();
  for (const t of texts)
    for (const run of t.runs ?? []) {
      if (!run.lang || run.legacy || looks.has(run.lang)) continue;
      const { text: _t, lang: _l, legacy: _g, ...look } = run;
      looks.set(run.lang, look);
    }
  const restyle = (el: TextElement, model: TextElement): TextElement => {
    // A box without runs is one run in its own language.
    const own = el.runs ?? (el.lang && looks.has(el.lang) ? [{ text: el.text, lang: el.lang }] : undefined);
    const runs = own?.map((r) => {
      if (r.legacy) return r;
      const look = r.lang ? looks.get(r.lang) : undefined;
      // The run takes its language's look from the model slide, or follows the box.
      const { text, lang, ...own } = r;
      const plain = Object.fromEntries(
        Object.entries(own).filter(
          ([k]) =>
            !['font', 'size', 'weight', 'italic', 'color', 'letterSpacing', 'shadow', 'outline'].includes(k),
        ),
      );
      return { text, ...(lang !== undefined ? { lang } : {}), ...plain, ...(look ?? {}) };
    });
    const next: TextElement = { ...el, frame: { ...model.frame }, style: structuredClone(model.style) };
    if (model.rotation) next.rotation = model.rotation;
    else delete next.rotation;
    if (runs?.some((r) => Object.keys(r).some((k) => k !== 'text'))) next.runs = runs;
    else delete next.runs;
    return next;
  };
  const copy = (s: ShapeElement): ShapeElement => ({ ...structuredClone(s), id: newId() });
  return {
    ...doc,
    groups: doc.groups.map((g) => ({
      ...g,
      slides: g.slides.map((s) => {
        if (s.id === source.id) return s;
        let n = 0;
        const kept = s.elements
          .filter((e) => e.kind !== 'shape')
          .map((e) => {
            if (e.kind !== 'text') return e;
            const model = texts[n++];
            return model ? restyle(e, model) : e;
          });
        return {
          ...s,
          background: source.background,
          elements: [...behind.map(copy), ...kept, ...front.map(copy)],
        };
      }),
    })),
  };
}
