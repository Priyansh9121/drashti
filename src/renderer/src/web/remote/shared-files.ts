import type { PresentationDoc } from '../../../../shared/library';
import { type OrderedSlide, playOrder } from '../../../../shared/order';
import type { PlaylistItemInfo } from '../../../../shared/playlists';

/*
 * A shared playlist's files as a phone looks through them (Session 54, D3), in D1's viewer: which can be looked at,
 * what each is in a word, and the pages the viewer turns, in the playlist's order. A picture, a video and a sound
 * are a page each (a sound played on the device); a presentation (a deck's or a PDF's pages, a Shastra passage) is
 * its slides one by one, in the order its item plays them.
 */

/** What an item is, in a word. */
export function itemWord(item: PlaylistItemInfo): string {
  switch (item.kind) {
    case 'media':
      return item.media === 'image' ? 'Picture' : item.media === 'video' ? 'Video' : 'Sound';
    case 'presentation':
      return item.deck ? 'Deck' : 'Presentation';
    case 'shastra':
      return 'Shastra passage';
    case 'input':
      return 'Video input';
    case 'placeholder':
      return 'Empty';
    case 'header':
      return 'Header';
  }
}

/** Whether an item can be looked at on a phone: a file that is there, or a presentation's slides. */
export const viewable = (item: PlaylistItemInfo): boolean =>
  (item.kind === 'media' && !item.missing) ||
  (item.kind === 'presentation' && item.presentationName !== null) ||
  (item.kind === 'shastra' && !item.missing);

/** The presentation (or Shastra passage) whose slides an item shows; null for anything else. */
const slidesOf = (item: PlaylistItemInfo): string | null =>
  item.kind === 'presentation' ? item.presentationId : item.kind === 'shastra' ? item.passageId : null;

/** The presentations and passages the files show, each once, to be read before they are looked through. */
export function slidesToRead(files: readonly PlaylistItemInfo[]): string[] {
  return [...new Set(files.flatMap((f) => slidesOf(f) ?? []))];
}

/** The slides an item plays, in its order: its own arrangement, its presentation's chosen one, or every slide. */
function itemSlides(item: PlaylistItemInfo, doc: PresentationDoc): OrderedSlide[] {
  const arrangementId =
    item.kind !== 'presentation' || item.order.mode === 'all'
      ? null
      : item.order.mode === 'arrangement'
        ? item.order.arrangementId
        : doc.selectedArrangementId;
  return playOrder(doc, arrangementId).slides;
}

/** What makes each kind of page: D1's viewer pages (shared-pages.tsx), plain words in the tests. */
export interface PageMakers<P> {
  picture: (mediaId: string, name: string) => P;
  video: (mediaId: string, name: string) => P;
  sound: (mediaId: string, name: string) => P;
  /** One slide of a presentation, `name` the item's. */
  slide: (presentationId: string, name: string, s: OrderedSlide) => P;
}

/** Which page a media item is. */
const PAGE_OF = { image: 'picture', video: 'video', audio: 'sound' } as const;

/**
 * The pages for a shared playlist's files, in its order, and the first page of the file tapped (`tapped`, its place
 * among `files`). A presentation Drashti could not give has none; when it is the one tapped (or it has no slides),
 * null: nothing opens.
 */
export function sharedPages<P>(
  files: readonly PlaylistItemInfo[],
  tapped: number,
  docs: (id: string) => PresentationDoc | null,
  make: PageMakers<P>,
): { pages: P[]; start: number } | null {
  const pages: P[] = [];
  let start: number | null = null;
  for (const [i, item] of files.entries()) {
    const first = pages.length;
    if (item.kind === 'media') pages.push(make[PAGE_OF[item.media]](item.mediaId, item.label));
    const id = slidesOf(item);
    const doc = id === null ? null : docs(id);
    if (id !== null && doc) for (const s of itemSlides(item, doc)) pages.push(make.slide(id, item.label, s));
    if (i === tapped && pages.length > first) start = first;
  }
  return start === null ? null : { pages, start };
}
