import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../../shared/engine/commands';
import type { PlaylistItemInfo, PlaylistNode } from '../../../shared/playlists';
import { useLibrary } from '../library/library-store';
import { clickCard, type CardClick } from './one-click';
import { usePlaylists } from './playlist-store';

/*
 * One click puts it live (Session 54, F2): in Pro Mode's open playlist, a click on a video, a picture or a sound
 * puts it up at once, once; Enter does the same; Cmd/Ctrl-click and Shift-click only mark; everything else opens
 * in the middle as before. The main process is stood in for by a fake that keeps the engine commands sent.
 * Placeholder names only.
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

  it('opens a presentation, a PDF and a deck, a Shastra passage, a video input and a header in the middle, as before', () => {
    for (const item of [pdf, deck, words, passage, input, header]) {
      clickCard(item, click(), 'darwin');
      expect(useLibrary.getState().item?.id).toBe(item.id);
      clickCard(item, click({ detail: 0 }), 'darwin');
    }
    expect(putUp()).toEqual([]);
    expect(useLibrary.getState().selectedId).toBe('passage-1');
  });

  it('asks what goes in a slot, as before', () => {
    clickCard(slot, click(), 'darwin');
    expect(usePlaylists.getState().filling?.id).toBe('slot');
    expect(putUp()).toEqual([]);
  });

  it('never puts up a file that cannot play: missing, or being converted (the middle says why)', () => {
    clickCard(missing, click(), 'darwin');
    expect(useLibrary.getState().item?.id).toBe('missing');
    clickCard(converting, click(), 'darwin');
    expect(useLibrary.getState().item?.id).toBe('converting');
    expect(putUp()).toEqual([]);
  });

  it('never puts up a Repeat Slides playlist’s item (its steps go round from the grid) or a template’s', () => {
    usePlaylists.setState({ tree: [node('P', 'repeat')] });
    clickCard(picture, click(), 'darwin');
    expect(useLibrary.getState().selectedId).toBe('repeat:P');
    usePlaylists.setState({ tree: [], templates: [{ ...node('P', 'normal'), template: true }] });
    clickCard(video, click(), 'darwin');
    clickCard(sound, click({ detail: 0 }), 'darwin');
    expect(usePlaylists.getState().marked).toEqual(['sound']);
    expect(putUp()).toEqual([]);
  });
});
