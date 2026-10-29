import type { PresentationDoc } from '../../../shared/library';
import { itemPlayOrder } from '../../../shared/order';
import type { ItemOrder, PlaylistItemInfo } from '../../../shared/playlists';

/*
 * A slide's row dragged in the playlist (Session 55, Part 4b). Within its deck or presentation it changes this item's
 * own order of slides; out of it, anywhere else in the playlist, it becomes an item of its own (the same presentation,
 * that slide alone), the deck's item keeping the rest. These work out the orders sent to the main process: the item's
 * (and the new item's), never the library's presentation. Each starts from the order the item plays now (an
 * arrangement's repeats too), so what the operator sees is what moves.
 */

type PresentationItem = Extract<PlaylistItemInfo, { kind: 'presentation' }>;
export type OwnOrder = Extract<ItemOrder, { mode: 'slides' }>;

/** The slides the item plays now, by id, in its order. */
const playedIds = (item: PresentationItem, doc: PresentationDoc): string[] =>
  itemPlayOrder(doc, item.order, item.id).slides.map((s) => s.slide.id);

/**
 * The item's new own order of these slides. The item that holds the deck's slides knows every slide the presentation
 * has now (one added later plays at its end); an item made of a slide dragged out stays without, never taking one.
 */
function ownOrder(item: PresentationItem, doc: PresentationDoc, slideIds: string[]): OwnOrder {
  const holdsDeck = item.order.mode !== 'slides' || item.order.known !== undefined;
  return holdsDeck
    ? { mode: 'slides', slideIds, known: doc.groups.flatMap((g) => g.slides.map((s) => s.id)) }
    : { mode: 'slides', slideIds };
}

/**
 * The slide at `from` in the order the item plays, dropped before the one now at `to` (the end at its length): the
 * item's new own order, or null when it lands where it was.
 */
export function moveSlideWithin(
  item: PresentationItem,
  doc: PresentationDoc,
  from: number,
  to: number,
): OwnOrder | null {
  const ids = playedIds(item, doc);
  const moved = ids[from];
  if (moved === undefined || to === from || to === from + 1 || to < 0 || to > ids.length) return null;
  const rest = ids.filter((_, i) => i !== from);
  return ownOrder(item, doc, rest.toSpliced(to > from ? to - 1 : to, 0, moved));
}

/**
 * The slide at `position` taken out of the item: the item keeps the rest, in the order it plays them, and the slide
 * becomes an item of its own. Null when it is the item's only slide (nothing to split: the item itself moves).
 */
export function takeSlideOut(
  item: PresentationItem,
  doc: PresentationDoc,
  position: number,
): { slideId: string; rest: OwnOrder; alone: OwnOrder } | null {
  const ids = playedIds(item, doc);
  const slideId = ids[position];
  if (slideId === undefined || ids.length < 2) return null;
  return {
    slideId,
    rest: ownOrder(
      item,
      doc,
      ids.filter((_, i) => i !== position),
    ),
    alone: { mode: 'slides', slideIds: [slideId] },
  };
}
