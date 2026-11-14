import { describe, expect, it } from 'vitest';
import type { PresentationDoc, SlideInfo } from '../../../../shared/library';
import type { RenderSlide } from '../../../../shared/model';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import type { QuickPin } from '../../../../shared/quick-bar';
import { pinKey } from '../../../../shared/quick-bar';
import type { MiddleRow } from '../../playlists/rows';
import { phoneRows, rowMenu, rowTap } from './phone-rows';

/*
 * The playlist on a phone (Session 55, Part 9), as Part 4 made the window's: its rows (a presentation's name, which
 * folds, and a row a slide under it, "<name>_N"; a picture, video, sound and video input a row each), one tap putting a
 * row up, and a long press opening the row's menu: what Part 14's one right-click menu, Part 5's Save picture… and
 * Picture editor…, Part 6's When it ends and Part 8's Pin to the quick bar give the window, that a phone can do, and in
 * Simple Mode what its window's menu has (Rename and Delete). Placeholder names only.
 */

const words = (id: string, text: string): RenderSlide => ({
  id,
  width: 1920,
  height: 1080,
  background: '#000000',
  elements: [
    {
      id: `${id}-t`,
      kind: 'text',
      frame: { x: 0, y: 0, width: 1920, height: 1080 },
      text,
      lang: 'en',
      style: {
        fontFamily: null,
        fontSize: 72,
        fontWeight: 400,
        color: '#ffffff',
        align: 'center',
        verticalAlign: 'middle',
        lineHeight: 1.2,
        shadow: false,
      },
    },
  ],
});
const page = (id: string): RenderSlide => ({
  id,
  width: 1920,
  height: 1080,
  background: '#000000',
  elements: [
    {
      id: `${id}-p`,
      kind: 'image',
      mediaId: `page-${id}`,
      frame: { x: 0, y: 0, width: 1920, height: 1080 },
      fit: 'fit',
    },
  ],
});
const info = (slide: RenderSlide, index: number): SlideInfo => ({
  id: slide.id,
  index,
  label: '',
  notes: '',
  slide,
  cues: [],
  transition: null,
  autoAdvanceMs: null,
  macroId: null,
});
const doc = (id: string, name: string, slides: RenderSlide[]): PresentationDoc => ({
  id,
  name,
  width: 1920,
  height: 1080,
  groups: [{ id: `${id}-g`, name: '', color: null, slides: slides.map(info) }],
  arrangements: [],
  selectedArrangementId: null,
  transition: null,
  loop: false,
  kirtan: null,
  source: null,
});

const DECK = doc('deck', 'Placeholder deck', [page('d1'), page('d2')]);
const TALK = doc('talk', 'Placeholder talk', [
  words('t1', 'Placeholder opening'),
  words('t2', 'Placeholder end'),
]);

const presentation = (id: string, presentationId: string, name: string, deck = false): PlaylistItemInfo => ({
  id,
  kind: 'presentation',
  label: name,
  presentationId,
  presentationName: name,
  order: { mode: 'presentation' },
  arrangementName: null,
  timers: [],
  ...(deck ? { deck: true } : {}),
});
const media = (id: string, kind: 'image' | 'video' | 'audio', over: Partial<PlaylistItemInfo> = {}) =>
  ({
    id,
    kind: 'media',
    label: `Placeholder ${id}`,
    mediaId: `m-${id}`,
    media: kind,
    missing: false,
    unplayable: null,
    timers: [],
    ...over,
  }) as PlaylistItemInfo;

const ITEMS: PlaylistItemInfo[] = [
  { id: 'h', kind: 'header', label: 'Placeholder part', color: null },
  presentation('i-deck', 'deck', 'Placeholder deck', true),
  presentation('i-talk', 'talk', 'Placeholder talk'),
  media('picture', 'image'),
  media('video', 'video', { whenEnds: 'loop' }),
  media('sound', 'audio'),
  {
    id: 'input',
    kind: 'input',
    label: 'Placeholder camera',
    name: 'Placeholder camera',
    missing: false,
    timers: [],
  },
  { id: 'slot', kind: 'placeholder', label: 'Placeholder slot', hint: null, category: null },
  {
    id: 'passage',
    kind: 'shastra',
    label: 'Placeholder Granth 14',
    passageId: 'shastra:pg#14',
    reference: 'PG 14',
    missing: false,
    timers: [],
  } as PlaylistItemInfo,
];
const DOCS = new Map<string, PresentationDoc | null>([
  ['deck', DECK],
  ['talk', TALK],
]);

const rows = phoneRows(ITEMS, DOCS, new Set(), false);
const row = (test: (r: MiddleRow) => boolean): MiddleRow => {
  const found = rows.find(test);
  if (!found) throw new Error('no such row');
  return found;
};
const slideRow = (label: string) => row((r) => r.kind === 'slide' && r.label === label);
const itemRow = (id: string) => row((r) => r.kind !== 'slide' && r.item.id === id);

const pinned: QuickPin[] = [];
const ctx = (over: { simple?: boolean; pins?: QuickPin[] } = {}) => ({
  playlistId: 'pl',
  simple: over.simple ?? false,
  pinned: (pin: QuickPin) => (over.pins ?? pinned).some((p) => pinKey(p) === pinKey(pin)),
});
const ids = (r: MiddleRow, over: { simple?: boolean; pins?: QuickPin[] } = {}) =>
  rowMenu(r, ctx(over)).map((a) =>
    a.id === 'whenEnds' ? `whenEnds:${a.value}${a.checked ? '*' : ''}` : a.id,
  );

describe('the playlist’s rows on a phone (Session 55, Part 9)', () => {
  it('are the window’s rows: a presentation’s name with a row a slide under it, a row each for the rest', () => {
    expect(rows.map((r) => (r.kind === 'slide' ? r.label : `${r.kind} ${r.item.id}`))).toEqual([
      'item h',
      'group i-deck',
      'Placeholder deck_1',
      'Placeholder deck_2',
      'group i-talk',
      'Placeholder talk_1',
      'Placeholder talk_2',
      'item picture',
      'item video',
      'item sound',
      'item input',
      'item slot',
      'group passage',
    ]);
    // Folded: its slides' rows hidden, still there (their names keep their numbers).
    const folded = phoneRows(ITEMS, DOCS, new Set(['i-deck']), false);
    expect(
      folded.filter((r) => r.kind === 'slide' && r.hidden).map((r) => (r.kind === 'slide' ? r.label : '')),
    ).toEqual(['Placeholder deck_1', 'Placeholder deck_2']);
  });

  it('puts a row up with one tap, as a click on the window’s row does; a name folds, a header and a slot do nothing', () => {
    expect(rowTap(slideRow('Placeholder talk_2'), 'pl', false)).toEqual({
      kind: 'post',
      path: '/api/v1/trigger/slide',
      body: {
        presentationId: 'talk',
        slideIndex: 1,
        arrangementId: null,
        playlist: { playlistId: 'pl', itemId: 'i-talk' },
      },
    });
    expect(rowTap(itemRow('picture'), 'pl', false)).toEqual({
      kind: 'post',
      path: '/api/v1/trigger/item',
      body: { playlistId: 'pl', itemId: 'picture' },
    });
    // A video input's row too (the owner's answer to question 16); a missing file goes up the same way, and Drashti
    // says why (as the window's row does).
    expect(rowTap(itemRow('input'), 'pl', false)).toMatchObject({
      kind: 'post',
      path: '/api/v1/trigger/item',
    });
    expect(rowTap(itemRow('i-deck'), 'pl', false)).toEqual({ kind: 'fold', itemId: 'i-deck' });
    expect(rowTap(itemRow('h'), 'pl', false)).toEqual({ kind: 'none' });
    expect(rowTap(itemRow('slot'), 'pl', false)).toEqual({ kind: 'none' });
  });

  it('in a Repeat Slides playlist: a row each, and a tap starts it going round from there', () => {
    const repeat = phoneRows(ITEMS, DOCS, new Set(), true);
    expect(repeat.every((r) => r.kind === 'item')).toBe(true);
    const deck = repeat.find((r) => r.kind === 'item' && r.item.id === 'i-deck');
    if (!deck) throw new Error('no deck row');
    expect(rowTap(deck, 'pl', true)).toEqual({
      kind: 'post',
      path: '/api/v1/repeat/pl/start',
      body: { itemId: 'i-deck' },
    });
  });

  it('holds in a row’s menu what the window’s has that a phone can do, in the window’s order', () => {
    // A picture: looked at here, the Picture editor, Save picture…, pinned, renamed, taken out.
    expect(ids(itemRow('picture'))).toEqual(['look', 'edit', 'save', 'pin', 'rename', 'remove']);
    // A video: played here, When it ends (its own ticked), pinned, renamed, taken out.
    expect(ids(itemRow('video'))).toEqual([
      'look',
      'whenEnds:wallpaper',
      'whenEnds:next',
      'whenEnds:loop*',
      'whenEnds:freeze',
      'pin',
      'rename',
      'remove',
    ]);
    // A video with none set: Wallpaper, the default, ticked.
    const plain = phoneRows([media('clip', 'video')], DOCS, new Set(), false)[0];
    if (!plain) throw new Error('no row');
    expect(ids(plain).find((a) => a.startsWith('whenEnds'))).toBe('whenEnds:wallpaper*');
    expect(ids(itemRow('sound'))).toEqual(['pin', 'rename', 'remove']);
    expect(ids(itemRow('input'))).toEqual(['pin', 'remove']);
    // A deck's slide (a picture): looked at, its picture edited and saved, pinned as the slide, its deck taken out.
    expect(ids(slideRow('Placeholder deck_2'))).toEqual(['look', 'edit', 'save', 'pin', 'remove']);
    expect(ids(slideRow('Placeholder talk_1'))).toEqual(['look', 'pin', 'remove']);
    expect(ids(itemRow('i-talk'))).toEqual(['pin', 'rename', 'remove']);
    expect(ids(itemRow('passage'))).toEqual(['pin', 'remove']);
    expect(ids(itemRow('h'))).toEqual(['remove']);
    expect(ids(itemRow('slot'))).toEqual(['remove']);
  });

  it('says what each does: the slide pinned as the window pins it, Unpin once pinned, Remove naming what goes', () => {
    const slide = rowMenu(slideRow('Placeholder deck_2'), ctx());
    expect(slide.find((a) => a.id === 'pin')).toEqual({
      id: 'pin',
      pin: {
        kind: 'slide',
        presentationId: 'deck',
        slideId: 'd2',
        playlistId: 'pl',
        itemId: 'i-deck',
        label: 'Placeholder deck_2',
      },
    });
    expect(slide.find((a) => a.id === 'save')).toEqual({
      id: 'save',
      mediaId: 'page-d2',
      name: 'Placeholder deck_2',
    });
    expect(slide.find((a) => a.id === 'remove')).toEqual({
      id: 'remove',
      itemId: 'i-deck',
      name: 'Placeholder deck',
    });
    const picturePin: QuickPin = {
      kind: 'item',
      playlistId: 'pl',
      itemId: 'picture',
      label: 'Placeholder picture',
      what: 'picture',
    };
    expect(rowMenu(itemRow('picture'), ctx()).find((a) => a.id === 'pin')).toEqual({
      id: 'pin',
      pin: picturePin,
    });
    expect(ids(itemRow('picture'), { pins: [picturePin] })).toEqual([
      'look',
      'edit',
      'save',
      'unpin',
      'rename',
      'remove',
    ]);
    expect(rowMenu(itemRow('picture'), ctx({ pins: [picturePin] })).find((a) => a.id === 'unpin')).toEqual({
      id: 'unpin',
      key: pinKey(picturePin),
    });
    expect(rowMenu(itemRow('i-talk'), ctx()).find((a) => a.id === 'rename')).toEqual({
      id: 'rename',
      what: { kind: 'presentation', presentationId: 'talk' },
      name: 'Placeholder talk',
    });
    expect(rowMenu(itemRow('video'), ctx()).find((a) => a.id === 'rename')).toEqual({
      id: 'rename',
      what: { kind: 'media', mediaId: 'm-video', media: 'video' },
      name: 'Placeholder video',
    });
  });

  it('in Simple Mode offers all four ways to end a video and keeps Pro-only edits and pins out', () => {
    expect(ids(itemRow('picture'), { simple: true })).toEqual(['look', 'save', 'rename', 'remove']);
    expect(ids(itemRow('video'), { simple: true })).toEqual([
      'look',
      'whenEnds:wallpaper',
      'whenEnds:next',
      'whenEnds:loop*',
      'whenEnds:freeze',
      'rename',
      'remove',
    ]);
    expect(ids(itemRow('sound'), { simple: true })).toEqual(['rename', 'remove']);
    expect(ids(slideRow('Placeholder deck_1'), { simple: true })).toEqual(['look', 'save', 'remove']);
    expect(ids(itemRow('i-talk'), { simple: true })).toEqual(['rename', 'remove']);
    // A header's words are its part of the playlist: never renamed from the menu.
    expect(ids(itemRow('h'), { simple: true })).toEqual(['remove']);
  });

  it('offers nothing a file that is not there can do: no looking, saving or editing a missing picture', () => {
    const gone = phoneRows([media('lost', 'image', { missing: true })], DOCS, new Set(), false)[0];
    if (!gone) throw new Error('no row');
    expect(ids(gone)).toEqual(['pin', 'rename', 'remove']);
  });

  it('renames a file by its own name, never a row label of its own; the row keeps its label (C18, FT-2)', () => {
    const labelled = media('labelled', 'video', {
      label: 'Placeholder row label',
      mediaName: 'Placeholder file name',
    });
    const plain = media('plain', 'image');
    const own = phoneRows([labelled, plain], new Map(), new Set(), false);
    const menu = (id: string) => {
      const found = own.find((r) => r.kind !== 'slide' && r.item.id === id);
      if (!found) throw new Error('no such row');
      return rowMenu(found, ctx());
    };
    expect(menu('labelled').find((a) => a.id === 'rename')).toEqual({
      id: 'rename',
      what: { kind: 'media', mediaId: 'm-labelled', media: 'video' },
      name: 'Placeholder file name',
    });
    // Remove names the row as it shows; a row with no file name given (an older Main's) renames by its label.
    expect(menu('labelled').find((a) => a.id === 'remove')).toMatchObject({ name: 'Placeholder row label' });
    expect(menu('plain').find((a) => a.id === 'rename')).toMatchObject({ name: 'Placeholder plain' });
  });
});
