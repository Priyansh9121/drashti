import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../../shared/engine/commands';
import type { PlaylistItemInfo, PlaylistNode } from '../../../shared/playlists';
import { useLibrary } from '../library/library-store';
import { useFolded } from './fold-store';
import { clickCard, clickSlideRow, JUST_SHOWN_MS, meantPress, type CardClick } from './one-click';
import { usePlaylists } from './playlist-store';
import type { MiddleRow } from './rows';

/*
 * One click puts it live (Session 54, F2; Session 55, Part 4: the playlist is where things go live): in Pro Mode's
 * open playlist, a click on any row puts it up at once, once: a video, a picture, a sound, a video input (the owner's
 * answer to question 16) and each slide of a presentation, a PDF or a deck, which are rows under its name; a click on
 * that name folds its slides. Enter does the same; Cmd/Ctrl-click and Shift-click only mark. A file that cannot play
 * goes to the engine too, which says why. The main process is stood in for by a fake that keeps the engine commands
 * sent. Placeholder names only.
 */

const sent: EngineCommand[] = [];

const media = (id: string, kind: 'video' | 'image' | 'audio', over: object = {}): PlaylistItemInfo => ({
  id,
  kind: 'media',
  label: `Placeholder ${id}`,
  mediaId: `media-${id}`,
  media: kind,
  missing: false,
  unplayable: null,
  timers: [],
  ...over,
});
const presentation = (id: string, deck: boolean): PlaylistItemInfo => ({
  id,
  kind: 'presentation',
  label: `Placeholder ${id}`,
  presentationId: `presentation-${id}`,
  presentationName: `Placeholder ${id}`,
  order: { mode: 'presentation' },
  arrangementName: null,
  timers: [],
  ...(deck ? { deck: true } : {}),
});

const video = media('video', 'video');
const picture = media('picture', 'image');
const sound = media('sound', 'audio');
const pdf = presentation('pdf', true);
const deck = presentation('deck', true);
const words = presentation('words', false);
const passage: PlaylistItemInfo = {
  id: 'passage',
  kind: 'shastra',
  label: 'Placeholder 1.1',
  passageId: 'passage-1',
  missing: false,
  timers: [],
};
const input: PlaylistItemInfo = {
  id: 'input',
  kind: 'input',
  label: 'Placeholder input',
  name: 'Placeholder input',
  missing: false,
  timers: [],
};
const header: PlaylistItemInfo = { id: 'header', kind: 'header', label: 'Placeholder part', color: null };
const slot: PlaylistItemInfo = {
  id: 'slot',
  kind: 'placeholder',
  label: 'Placeholder slot',
  hint: null,
  category: null,
};
const missing = media('missing', 'video', { missing: true });
const converting = media('converting', 'video', { unplayable: 'Converting…' });
const ITEMS = [video, picture, sound, pdf, deck, words, passage, input, header, slot, missing, converting];

const node = (id: string, kind: PlaylistNode['kind']): PlaylistNode => ({
  id,
  name: `Placeholder ${id}`,
  isFolder: false,
  kind,
  parentId: null,
  itemCount: ITEMS.length,
  placeholders: 0,
  imported: false,
  template: false,
});

/** A plain click: the first of a run (a double click's second is 2), with no key held. */
const click = (over: Partial<CardClick> = {}): CardClick => ({
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  detail: 1,
  ...over,
});

/** The items put up, by their ids, in the order the clicks sent them. */
const putUp = () => sent.flatMap((c) => (c.type === 'playItem' && c.playlistId === 'P' ? [c.itemId] : []));
/** The slides put up, as "<presentation> <position> <item>". */
const slidesUp = () =>
  sent.flatMap((c) =>
    c.type === 'goLive' ? [`${c.presentationId} ${String(c.slideIndex)} ${c.playlist?.itemId ?? '-'}`] : [],
  );

/** A slide row of an item (its slide at `position` in the order it plays in). */
const slideRow = (item: PlaylistItemInfo, position: number): Extract<MiddleRow, { kind: 'slide' }> => {
  const presentationId = item.kind === 'presentation' ? item.presentationId : 'repeat:P';
  return {
    kind: 'slide',
    key: `${item.id}/${String(position)}`,
    item: item.kind === 'presentation' || item.kind === 'shastra' ? item : null,
    index: ITEMS.indexOf(item),
    presentationId,
    arrangementId: null,
    at: {
      position,
      group: { id: 'g', name: '', color: null },
      occurrence: 0,
      slide: {
        id: `${presentationId}-s${String(position)}`,
        index: position,
        label: '',
        notes: '',
        slide: {
          id: `${presentationId}-s${String(position)}`,
          width: 1920,
          height: 1080,
          background: null,
          elements: [],
        },
        cues: [],
        transition: null,
        autoAdvanceMs: null,
        macroId: null,
      },
    },
    number: 1,
    label: `Placeholder_${String(position + 1)}`,
    line: '',
    firstOfRun: true,
    hidden: false,
  };
};

beforeEach(() => {
  sent.length = 0;
  (globalThis as { window?: unknown }).window = {
    drashti: {
      engine: {
        dispatch: (command: EngineCommand) => {
          sent.push(command);
          return Promise.resolve({ ok: true, changed: true, rev: -1 });
        },
      },
      library: { getPresentation: () => Promise.resolve(null) },
    },
  };
  usePlaylists.setState({
    openId: 'P',
    tree: [node('P', 'normal')],
    templates: [],
    items: ITEMS,
    marked: [],
    anchorId: null,
    filling: null,
  });
  useLibrary.setState({ item: null, selectedId: null, doc: null });
  useFolded.setState({ folded: [] });
});

describe('one click on a playlist’s card', () => {
  it('puts a video, a picture and a sound up at once, each once, and shows it in the middle', () => {
    for (const item of [video, picture, sound]) {
      clickCard(item, click(), 'darwin');
      expect(usePlaylists.getState().marked).toEqual([item.id]);
      expect(useLibrary.getState().item?.id).toBe(item.id);
    }
    expect(putUp()).toEqual(['video', 'picture', 'sound']);
    // On Windows too.
    clickCard(video, click(), 'win32');
    expect(putUp()).toEqual(['video', 'picture', 'sound', 'video']);
  });

  it('puts it up once for a double click: its second click, and a third, put nothing up again', () => {
    clickCard(video, click({ detail: 1 }), 'darwin');
    clickCard(video, click({ detail: 2 }), 'darwin');
    clickCard(video, click({ detail: 3 }), 'darwin');
    expect(putUp()).toEqual(['video']);
    // Still chosen and shown, as it was after the first.
    expect(usePlaylists.getState().marked).toEqual(['video']);
    expect(useLibrary.getState().item?.id).toBe('video');
  });

  it('is what Enter on the card does (a click with no count)', () => {
    clickCard(sound, click({ detail: 0 }), 'win32');
    expect(putUp()).toEqual(['sound']);
    expect(useLibrary.getState().item?.id).toBe('sound');
  });

  it('with Cmd (Ctrl on Windows) or Shift only marks: nothing goes up, nothing is shown', () => {
    clickCard(video, click({ metaKey: true }), 'darwin');
    expect(usePlaylists.getState().marked).toEqual(['video']);
    clickCard(sound, click({ metaKey: true }), 'darwin');
    expect(usePlaylists.getState().marked).toEqual(['video', 'sound']);
    clickCard(picture, click({ shiftKey: true }), 'darwin');
    expect(usePlaylists.getState().marked).toEqual(['picture', 'sound']);
    usePlaylists.setState({ marked: [], anchorId: null });
    clickCard(picture, click({ ctrlKey: true }), 'win32');
    clickCard(sound, click({ shiftKey: true }), 'win32');
    expect(usePlaylists.getState().marked).toEqual(['picture', 'sound']);
    expect(putUp()).toEqual([]);
    expect(useLibrary.getState().item).toBeNull();
  });

  it('never puts anything up with another key held: a Mac’s Ctrl-click (its right-click) or Alt', () => {
    clickCard(video, click({ ctrlKey: true }), 'darwin');
    clickCard(picture, click({ altKey: true }), 'darwin');
    clickCard(sound, click({ altKey: true }), 'win32');
    expect(putUp()).toEqual([]);
    // Shown in the middle, as a click did before Session 54.
    expect(useLibrary.getState().item?.id).toBe('sound');
  });

  it('puts a video input up at once too (question 16), once for a double click', () => {
    clickCard(input, click(), 'darwin');
    clickCard(input, click({ detail: 2 }), 'darwin');
    expect(putUp()).toEqual(['input']);
    expect(useLibrary.getState().item?.id).toBe('input');
  });

  it('folds a presentation’s, a PDF’s, a deck’s and a passage’s slides under its name, and opens them again; a header is only chosen', () => {
    for (const item of [pdf, deck, words, passage]) {
      clickCard(item, click(), 'darwin');
      expect(useFolded.getState().folded).toContain(item.id);
      expect(usePlaylists.getState().marked).toEqual([item.id]);
      // A double click's second click never opens it again.
      clickCard(item, click({ detail: 2 }), 'darwin');
      expect(useFolded.getState().folded).toContain(item.id);
      // Enter on it opens it again.
      clickCard(item, click({ detail: 0 }), 'darwin');
      expect(useFolded.getState().folded).not.toContain(item.id);
    }
    clickCard(header, click(), 'darwin');
    expect(usePlaylists.getState().marked).toEqual(['header']);
    expect(putUp()).toEqual([]);
    expect(slidesUp()).toEqual([]);
  });

  it('puts a slide up from its row, in the item’s order, from the item, so Next goes on through the playlist', () => {
    clickSlideRow(slideRow(pdf, 1), click(), 'darwin');
    expect(slidesUp()).toEqual(['presentation-pdf 1 pdf']);
    expect(usePlaylists.getState().marked).toEqual(['pdf']);
    expect(useLibrary.getState().item?.id).toBe('pdf');
    // A double click: once.
    clickSlideRow(slideRow(deck, 0), click({ detail: 1 }), 'win32');
    clickSlideRow(slideRow(deck, 0), click({ detail: 2 }), 'win32');
    expect(slidesUp()).toEqual(['presentation-pdf 1 pdf', 'presentation-deck 0 deck']);
    // Cmd-click and Shift-click only choose its item.
    clickSlideRow(slideRow(words, 0), click({ metaKey: true }), 'darwin');
    clickSlideRow(slideRow(words, 0), click({ altKey: true }), 'darwin');
    expect(slidesUp()).toHaveLength(2);
    expect(usePlaylists.getState().marked).toContain('words');
  });

  it('asks what goes in a slot, as before', () => {
    clickCard(slot, click(), 'darwin');
    expect(usePlaylists.getState().filling?.id).toBe('slot');
    expect(putUp()).toEqual([]);
  });

  it('sends a file that cannot play (missing, or being converted) to the engine too, which says why', () => {
    clickCard(missing, click(), 'darwin');
    clickCard(converting, click(), 'darwin');
    expect(putUp()).toEqual(['missing', 'converting']);
  });

  it('in a Repeat Slides playlist starts it going round from the row clicked; a template’s rows never go up', async () => {
    usePlaylists.setState({ tree: [node('P', 'repeat')] });
    clickCard(picture, click(), 'darwin');
    // A step of a presentation in it: its row names the playlist's own slides (repeat:P), which the engine goes round.
    clickSlideRow({ ...slideRow(words, 3), presentationId: 'repeat:P' }, click(), 'darwin');
    await Promise.resolve();
    await Promise.resolve();
    expect(sent.map((c) => c.type)).toEqual(expect.arrayContaining(['startRepeat', 'goLive']));
    expect(slidesUp()).toEqual(['repeat:P 3 -']);
    expect(putUp()).toEqual([]);
    sent.length = 0;
    usePlaylists.setState({ tree: [], templates: [{ ...node('P', 'normal'), template: true }] });
    clickCard(video, click(), 'darwin');
    clickCard(sound, click({ detail: 0 }), 'darwin');
    clickSlideRow(slideRow(pdf, 0), click(), 'darwin');
    expect(usePlaylists.getState().marked).toEqual(['pdf']);
    expect(sent).toEqual([]);
  });
});

describe('Up and Down under the chosen card (Session 54’s review)', () => {
  it('take a click only once they have been there a moment, so a double click’s second never moves anything', () => {
    // A double click on the card below the chosen one: its second click lands on the Up or Down that has just
    // appeared under it.
    expect(meantPress(2, 1000, 1100)).toBe(false);
    expect(meantPress(1, 1000, 1000 + JUST_SHOWN_MS - 1)).toBe(false);
    // There a moment: every click counts, a quick run of them too.
    expect(meantPress(1, 1000, 1000 + JUST_SHOWN_MS)).toBe(true);
    expect(meantPress(3, 1000, 2000)).toBe(true);
    // From the keyboard (Enter or Space on it: a click with no count), at once.
    expect(meantPress(0, 1000, 1000)).toBe(true);
  });
});
