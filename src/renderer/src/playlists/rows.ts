import type { PresentationDoc } from '../../../shared/library';
import type { RenderSlide } from '../../../shared/model';
import { type OrderedSlide, playOrder } from '../../../shared/order';
import type { PlaylistItemInfo } from '../../../shared/playlists';

/*
 * The playlist is where things go live (Session 55, Part 4): its rows, as the middle shows them. A presentation (a
 * PDF, a PowerPoint or Keynote deck, or Drashti's own) is its name, which folds, with one row a slide under it,
 * "<name>_1" to "<name>_N", a text slide's row saying its first line too; a picture, a video, a sound and a video
 * input are a row each; a header and a slot are rows that never go up. One click on a row puts it up (the middle's
 * components do that). Every row that goes up has a number, for jumping to it from the keyboard (operator/jump.ts):
 * folded ones keep theirs, so a number never moves while the playlist stays as it is. With no playlist open, the
 * library's chosen presentation shows as rows the same way (presentationRows).
 */

/** An item whose slides are rows under its name: a presentation, or a Shastra passage. */
export type GroupItem = Extract<PlaylistItemInfo, { kind: 'presentation' | 'shastra' }>;

/**
 * Whether a presentation's slides are there to show: read, still being read, not read (Try again), or gone (removed
 * from the library, or a passage whose text is not loaded).
 */
export type RowsRead = 'ready' | 'loading' | 'unread' | 'gone';

export type MiddleRow =
  /** A picture, video, sound, video input, header or slot: one row (numbered when it can go up). */
  | { kind: 'item'; key: string; item: PlaylistItemInfo; index: number; number: number | null }
  /** A presentation's or a passage's name, which folds its slides. */
  | {
      kind: 'group';
      key: string;
      item: GroupItem;
      index: number;
      folded: boolean;
      read: RowsRead;
      /** How many slides it has (0 until read). */
      count: number;
    }
  /** One of its slides. */
  | {
      kind: 'slide';
      key: string;
      /** The playlist item it plays from; null for the library's chosen presentation. */
      item: GroupItem | null;
      /** The item's place in the playlist (-1 for the library's). */
      index: number;
      presentationId: string;
      /** The order it plays in (an arrangement, or null for every slide), as the engine's goLive takes it. */
      arrangementId: string | null;
      at: OrderedSlide;
      number: number;
      /** "<name>_N". */
      label: string;
      /** A text slide's first line ('' for a picture's). */
      line: string;
      /** The first slide each time its group comes up (its name shown there, as the slide grid did). */
      firstOfRun: boolean;
      /** Under a folded name: still numbered, not shown. */
      hidden: boolean;
    };

/** A slide's name in the rows: "<name>_N" (N from 1). */
export function slideName(name: string, position: number): string {
  return `${name}_${String(position + 1)}`;
}

/** A slide's first line of words, trimmed: from its first text that has any ('' for a picture alone). */
export function firstLine(slide: RenderSlide): string {
  for (const el of slide.elements) {
    if (el.kind !== 'text') continue;
    const line = el.text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '');
    if (line !== undefined) return line;
  }
  return '';
}

/** The order a playlist item plays its presentation in (the item's own, else the presentation's). */
export function itemArrangement(item: GroupItem, doc: PresentationDoc): string | null {
  if (item.kind === 'shastra') return doc.selectedArrangementId;
  if (item.order.mode === 'all') return null;
  if (item.order.mode === 'arrangement') return item.order.arrangementId;
  return doc.selectedArrangementId;
}

/** The library's id of what a group row's slides come from. */
export function groupDocId(item: GroupItem): string {
  return item.kind === 'presentation' ? item.presentationId : item.passageId;
}

/** The name its slides' rows are called by. */
export function groupName(item: GroupItem, doc: PresentationDoc | null): string {
  if (item.kind === 'presentation') return item.presentationName ?? item.label;
  return doc?.name ?? item.label;
}

/** Whether a row of this item is numbered (it can be put up from it, or says why not). */
const numbered = (item: PlaylistItemInfo): boolean => item.kind === 'media' || item.kind === 'input';

/** A presentation's slides as rows, in an order, numbered on from `from`. */
function slideRows(
  doc: PresentationDoc,
  item: GroupItem | null,
  index: number,
  arrangementId: string | null,
  name: string,
  from: number,
  hidden: boolean,
): Extract<MiddleRow, { kind: 'slide' }>[] {
  const order = playOrder(doc, arrangementId);
  return order.slides.map((at, i) => {
    const before = order.slides[i - 1];
    return {
      kind: 'slide',
      key: `${item?.id ?? doc.id}/${String(at.position)}`,
      item,
      index,
      presentationId: doc.id,
      arrangementId: order.arrangementId,
      at,
      number: from + i,
      label: slideName(name, at.position),
      line: firstLine(at.slide.slide),
      firstOfRun: before?.group.id !== at.group.id || before.occurrence !== at.occurrence,
      hidden,
    };
  });
}

/**
 * A playlist's rows: `docs` holds each presentation's slides by its id (null: they could not be read; left out:
 * still being read), and `folded` the items whose slides are folded under their names.
 */
export function playlistRows(
  items: readonly PlaylistItemInfo[],
  docs: ReadonlyMap<string, PresentationDoc | null>,
  folded: ReadonlySet<string>,
): MiddleRow[] {
  const rows: MiddleRow[] = [];
  let next = 1;
  items.forEach((item, index) => {
    if (item.kind !== 'presentation' && item.kind !== 'shastra') {
      const number = numbered(item) ? next++ : null;
      rows.push({ kind: 'item', key: item.id, item, index, number });
      return;
    }
    const gone = item.kind === 'presentation' ? item.presentationName === null : item.missing;
    const doc = gone ? undefined : docs.get(groupDocId(item));
    const read: RowsRead = gone ? 'gone' : doc === undefined ? 'loading' : doc === null ? 'unread' : 'ready';
    const isFolded = folded.has(item.id);
    const slides = doc
      ? slideRows(doc, item, index, itemArrangement(item, doc), groupName(item, doc), next, isFolded)
      : [];
    next += slides.length;
    rows.push({
      kind: 'group',
      key: item.id,
      item,
      index,
      folded: isFolded,
      read,
      count: slides.length,
    });
    rows.push(...slides);
  });
  return rows;
}

/**
 * A Repeat Slides playlist's rows (Session 26d): its steps come from the playlist's own presentation (`doc`, the
 * engine's `repeat:<id>`), each presentation's under its name; a picture is a row of its own. A click on a step starts
 * it going round from there.
 */
export function repeatRows(
  items: readonly PlaylistItemInfo[],
  doc: PresentationDoc | null | undefined,
  folded: ReadonlySet<string>,
): MiddleRow[] {
  const rows: MiddleRow[] = [];
  const order = doc ? playOrder(doc, null) : null;
  let next = 1;
  items.forEach((item, index) => {
    if (item.kind !== 'presentation' && item.kind !== 'shastra') {
      const number = item.kind === 'media' ? next++ : null;
      rows.push({ kind: 'item', key: item.id, item, index, number });
      return;
    }
    const steps = order?.slides.filter((s) => s.group.id === item.id) ?? [];
    const isFolded = folded.has(item.id);
    const name = groupName(item, null);
    rows.push({
      kind: 'group',
      key: item.id,
      item,
      index,
      folded: isFolded,
      read: doc === undefined ? 'loading' : doc === null ? 'unread' : steps.length > 0 ? 'ready' : 'gone',
      count: steps.length,
    });
    steps.forEach((at, i) => {
      rows.push({
        kind: 'slide',
        key: `${item.id}/${String(i)}`,
        item,
        index,
        presentationId: doc?.id ?? '',
        arrangementId: null,
        at,
        number: next++,
        label: slideName(name, i),
        line: firstLine(at.slide.slide),
        firstOfRun: i === 0,
        hidden: isFolded,
      });
    });
  });
  return rows;
}

/** The library's chosen presentation as rows, with no playlist open: a slide a row, numbered from 1. */
export function presentationRows(doc: PresentationDoc, arrangementId: string | null): MiddleRow[] {
  return slideRows(doc, null, -1, arrangementId, doc.name, 1, false);
}

/** Every numbered row, in order: what a typed number puts up. */
export function rowNumbers(rows: readonly MiddleRow[]): { number: number; key: string }[] {
  return rows.flatMap((r) =>
    r.kind === 'slide' || (r.kind === 'item' && r.number !== null)
      ? [{ number: r.number ?? 0, key: r.key }]
      : [],
  );
}
