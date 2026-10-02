import { randomUUID } from 'node:crypto';
import type { SlideElement } from '../../shared/model';
import type { EditCue, EditDoc } from '../../shared/slide-edit';
import type { ContentRows, CueRow, ElementRow, GroupRow, SlideRow } from '../db/content';
import { transitionFromJson, transitionToJson } from '../db/content';
import { elementFromRow } from '../db/presentations';

/*
 * The slide editor's document, made from a presentation's stored rows, and
 * an edited document put back. Putting it back is lossless: every group,
 * slide, element and cue the editor did not change keeps its stored row
 * exactly (its own data byte for byte), elements that could not be read stay
 * where they were, and an edited element keeps any data Drashti does not
 * know about. Anything new gets its id here, never from the window.
 */

/** Equal as plain data, key order aside. */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const byPosition = <T extends { position: number }>(list: readonly T[]) =>
  [...list].sort((x, y) => x.position - y.position);

function bySlide<T extends { slide_id: string; position: number }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of byPosition(rows)) {
    const list = map.get(row.slide_id) ?? [];
    list.push(row);
    map.set(row.slide_id, list);
  }
  return map;
}

const cueOf = (c: CueRow): EditCue => ({
  id: c.id,
  kind: c.kind as EditCue['kind'],
  label: c.label,
  mediaId: c.media_id,
  props: c.props,
});

/** The editor's document for a presentation; elements that cannot be read are counted, not included. */
export function editDocOf(rows: ContentRows, name: string): { doc: EditDoc; unreadable: number } {
  const elements = bySlide(rows.elements);
  const cues = bySlide(rows.cues);
  let unreadable = 0;
  const groups = byPosition(rows.groups).map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    slides: byPosition(rows.slides.filter((s) => s.group_id === g.id)).map((s) => ({
      id: s.id,
      label: s.label,
      notes: s.notes,
      background: s.background,
      enabled: s.enabled === 1,
      transition: transitionFromJson(s.transition),
      autoAdvanceMs: s.auto_advance_ms,
      elements: (elements.get(s.id) ?? []).flatMap((row): SlideElement[] => {
        const el = elementFromRow(row);
        if (!el) unreadable++;
        return el ? [el] : [];
      }),
      cues: (cues.get(s.id) ?? []).map(cueOf),
    })),
  }));
  return {
    doc: {
      presentationId: rows.presentationId,
      name,
      width: rows.width,
      height: rows.height,
      transition: transitionFromJson(rows.transition),
      loop: rows.loop === 1,
      groups,
    },
    unreadable,
  };
}

/** The keys of an element's stored data that Drashti knows, per kind (the rest are kept as they are). */
const KNOWN: Record<SlideElement['kind'], ReadonlySet<string>> = {
  text: new Set(['text', 'lang', 'style', 'runs', 'opacity', 'everyScreen']),
  shape: new Set(['shape', 'fill', 'cornerRadius', 'opacity', 'outline']),
  image: new Set(['mediaId', 'fit', 'loop', 'opacity', 'volume']),
  video: new Set(['mediaId', 'fit', 'loop', 'opacity', 'volume']),
};

function parseObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** An element's own data: everything but its id, kind, place and turn (which have columns of their own). */
function ownData(el: SlideElement): Record<string, unknown> {
  const { id: _id, kind: _kind, frame: _frame, rotation: _rotation, ...props } = el;
  return props;
}

/**
 * A stored row for an element the editor changed (or made). When only its
 * place or turn changed, its own data is kept exactly as stored; otherwise
 * data Drashti does not know about is kept beside the new data.
 */
export function rowOf(
  el: SlideElement,
  id: string,
  slideId: string,
  old: ElementRow | undefined,
): ElementRow {
  const { kind, frame, rotation } = el;
  const props = ownData(el);
  const was = old ? elementFromRow(old) : null;
  const unknown = old
    ? Object.fromEntries(Object.entries(parseObject(old.props)).filter(([k]) => !KNOWN[kind].has(k)))
    : {};
  const data =
    old && was?.kind === kind && sameData(ownData(was), props)
      ? old.props
      : JSON.stringify({ ...unknown, ...props });
  return {
    id,
    slide_id: slideId,
    position: 0,
    kind,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    rotation: rotation ?? 0,
    props: data,
  };
}

/**
 * The presentation's rows with the edited document put in: its groups,
 * slides, elements and cues, its transition and loop. Arrangements keep the
 * groups that are still there; everything else is as it was.
 */
export function applySlideEdit(
  before: ContentRows,
  doc: EditDoc,
  newId: () => string = randomUUID,
): ContentRows {
  // Ids the presentation already has stay; anything new gets an id from here.
  const own = (ids: readonly string[]) => new Set(ids);
  const known = {
    group: own(before.groups.map((g) => g.id)),
    slide: own(before.slides.map((s) => s.id)),
    element: own(before.elements.map((e) => e.id)),
    cue: own(before.cues.map((c) => c.id)),
  };
  const fresh = new Map<string, string>();
  const idFor = (kind: keyof typeof known, id: string): string => {
    if (known[kind].has(id)) return id;
    const key = `${kind}:${id}`;
    let made = fresh.get(key);
    if (!made) {
      made = newId();
      fresh.set(key, made);
    }
    return made;
  };

  const oldSlides = new Map(before.slides.map((s) => [s.id, s]));
  const oldElements = new Map(before.elements.map((e) => [e.id, e]));
  const oldCues = new Map(before.cues.map((c) => [c.id, c]));
  const oldElementsBySlide = bySlide(before.elements);

  const groups: GroupRow[] = [];
  const slides: SlideRow[] = [];
  const elements: ElementRow[] = [];
  const cues: CueRow[] = [];
  doc.groups.forEach((g, gi) => {
    const groupId = idFor('group', g.id);
    groups.push({ id: groupId, name: g.name, color: g.color, position: gi });
    g.slides.forEach((s, si) => {
      const slideId = idFor('slide', s.id);
      const old = oldSlides.get(s.id);
      slides.push({
        id: slideId,
        group_id: groupId,
        position: si,
        label: s.label,
        notes: s.notes,
        background: s.background,
        // A transition as stored stays exactly as it was when it means the same.
        transition:
          old && sameData(transitionFromJson(old.transition), s.transition)
            ? old.transition
            : transitionToJson(s.transition),
        auto_advance_ms: s.autoAdvanceMs,
        enabled: s.enabled ? 1 : 0,
      });
      const list: ElementRow[] = s.elements.map((el) => {
        const was = oldElements.get(el.id);
        const parsed = was ? elementFromRow(was) : null;
        // Unchanged: the stored row exactly as it was (its own data byte for byte).
        if (was && parsed && sameData(parsed, el)) return { ...was, slide_id: slideId };
        return rowOf(el, idFor('element', el.id), slideId, was);
      });
      // Elements that could not be read stay at their place among the others.
      if (old) {
        (oldElementsBySlide.get(old.id) ?? []).forEach((row, at) => {
          if (!elementFromRow(row)) list.splice(Math.min(at, list.length), 0, { ...row, slide_id: slideId });
        });
      }
      list.forEach((row, position) => elements.push({ ...row, position }));
      s.cues.forEach((c, position) => {
        const was = oldCues.get(c.id);
        const same =
          was?.kind === c.kind &&
          was.label === c.label &&
          was.media_id === c.mediaId &&
          (was.props === c.props || sameData(parseObject(was.props), parseObject(c.props)));
        cues.push(
          same
            ? { ...was, slide_id: slideId, position }
            : {
                id: idFor('cue', c.id),
                slide_id: slideId,
                position,
                kind: c.kind,
                label: c.label,
                media_id: c.mediaId,
                props: c.props,
              },
        );
      });
    });
  });
  const groupIds = new Set(groups.map((g) => g.id));
  return {
    ...before,
    transition: sameData(transitionFromJson(before.transition), doc.transition)
      ? before.transition
      : transitionToJson(doc.transition),
    loop: doc.loop ? 1 : 0,
    groups,
    slides,
    elements,
    cues,
    // Arrangements keep the groups that are left, in their order.
    arrangementEntries: before.arrangements.flatMap((a) =>
      byPosition(
        before.arrangementEntries.filter((e) => e.arrangement_id === a.id && groupIds.has(e.group_id)),
      ).map((e, position) => ({ ...e, position })),
    ),
  };
}

/** Every media item an edited document uses (elements and cues), to check they are in the library. */
export function mediaIdsOf(doc: EditDoc): string[] {
  const ids = new Set<string>();
  for (const g of doc.groups)
    for (const s of g.slides) {
      for (const el of s.elements) if (el.kind === 'image' || el.kind === 'video') ids.add(el.mediaId);
      for (const c of s.cues) if (c.mediaId) ids.add(c.mediaId);
    }
  return [...ids];
}
