import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../../shared/engine/commands';
import { initialEngineState } from '../../../shared/engine/state';
import type { MessageTemplate } from '../../../shared/messages';
import type { QuickPin } from '../../../shared/quick-bar';
import { useEngine } from '../engine/engine-store';
import type { FileTarget } from '../files/file-menu';
import { useNotice } from '../operator/actions';
import { pinFor, pressQuick, quickMenuItems, useQuickBar } from './quick-bar-store';

/*
 * The quick bar (Session 55, Part 8) in Pro Mode's window: what a right-click's thing pins as, the menu's Pin or Unpin,
 * and what one press sends to the engine for each kind of pin. The main process is stood in for by a fake that keeps
 * the engine commands sent. Placeholder names only.
 */

const sent: EngineCommand[] = [];
let templates: MessageTemplate[] = [];

const target = (over: Partial<FileTarget>): FileTarget => ({
  kind: 'picture',
  name: 'Placeholder backdrop',
  place: 'media',
  ...over,
});

beforeEach(() => {
  sent.length = 0;
  templates = [];
  (globalThis as { window?: unknown }).window = {
    drashti: {
      engine: {
        dispatch: (command: EngineCommand) => {
          sent.push(command);
          return Promise.resolve({ ok: true, changed: true, rev: -1 });
        },
      },
      messages: { list: () => Promise.resolve(templates) },
      quickBar: {
        set: (pins: QuickPin[]) => Promise.resolve({ ok: true, pins }),
      },
    },
  };
  useQuickBar.setState({ pins: [] });
  useEngine.setState({ state: initialEngineState() });
  useNotice.setState({ text: null });
});

describe('the quick bar in Pro Mode’s window', () => {
  it('pins a slide’s row, a playlist’s row that goes up, and a picture, video or sound from Media; nothing else', () => {
    expect(
      pinFor(
        target({
          kind: 'slide',
          name: 'Placeholder words_2',
          place: 'playlist',
          presentationId: 'p1',
          slideId: 's2',
          playlistId: 'pl1',
          itemId: 'it1',
        }),
      ),
    ).toEqual({
      kind: 'slide',
      presentationId: 'p1',
      slideId: 's2',
      playlistId: 'pl1',
      itemId: 'it1',
      label: 'Placeholder words_2',
    });
    // The library's chosen presentation's slide: no row.
    expect(
      pinFor(target({ kind: 'slide', place: 'library', presentationId: 'p1', slideId: 's2' })),
    ).toMatchObject({ kind: 'slide', playlistId: null, itemId: null });
    expect(
      pinFor(
        target({
          kind: 'video',
          name: 'Placeholder clip',
          place: 'playlist',
          playlistId: 'pl1',
          itemId: 'it2',
        }),
      ),
    ).toEqual({ kind: 'item', playlistId: 'pl1', itemId: 'it2', label: 'Placeholder clip', what: 'video' });
    expect(
      pinFor(target({ kind: 'deck', place: 'playlist', playlistId: 'pl1', itemId: 'it3' })),
    ).toMatchObject({
      kind: 'item',
      what: 'presentation',
    });
    expect(pinFor(target({ kind: 'picture', place: 'media', mediaId: 'm1' }))).toEqual({
      kind: 'media',
      mediaId: 'm1',
      media: 'image',
      label: 'Placeholder backdrop',
    });
    expect(pinFor(target({ kind: 'sound', place: 'music', mediaId: 'm2' }))).toMatchObject({
      media: 'audio',
    });
    // A header, a slot, a folder, a library presentation and a wallpaper are not pinned.
    expect(pinFor(target({ kind: 'header', place: 'playlist', playlistId: 'pl1', itemId: 'h' }))).toBeNull();
    expect(pinFor(target({ kind: 'slot', place: 'playlist', playlistId: 'pl1', itemId: 's' }))).toBeNull();
    expect(pinFor(target({ kind: 'folder', place: 'playlist', playlistId: 'pl1' }))).toBeNull();
    expect(pinFor(target({ kind: 'presentation', place: 'library', presentationId: 'p1' }))).toBeNull();
    expect(pinFor(target({ kind: 'picture', place: 'wallpapers', mediaId: 'm3' }))).toBeNull();
  });

  it('offers Pin in the right-click menu, and Unpin once pinned', () => {
    const picture = target({ mediaId: 'm1' });
    expect(quickMenuItems(picture).map((e) => e.label)).toEqual(['Pin to the quick bar']);
    useQuickBar.setState({
      pins: [{ kind: 'media', mediaId: 'm1', media: 'image', label: 'Placeholder backdrop' }],
    });
    expect(quickMenuItems(picture).map((e) => e.label)).toEqual(['Unpin from the quick bar']);
    expect(quickMenuItems(target({ kind: 'header', place: 'playlist' }))).toEqual([]);
  });

  it('puts each up with one press: a row as its click does, a picture instead of the slide, a sound, a message', async () => {
    useQuickBar.setState({
      pins: [
        { kind: 'item', playlistId: 'pl1', itemId: 'it2', label: 'Placeholder clip', what: 'video' },
        { kind: 'media', mediaId: 'm1', media: 'image', label: 'Placeholder backdrop' },
        { kind: 'media', mediaId: 'm2', media: 'audio', label: 'Placeholder tune' },
        { kind: 'message', templateId: 'msg1', label: 'Placeholder welcome' },
      ],
    });
    templates = [
      { id: 'msg1', name: 'Placeholder welcome', template: 'Placeholder welcome words', fields: {} },
    ];
    await pressQuick(0);
    expect(sent).toEqual([{ type: 'playItem', playlistId: 'pl1', itemId: 'it2' }]);
    // A slide up: it comes off, and the picture goes up.
    sent.length = 0;
    const state = initialEngineState();
    useEngine.setState({
      state: { ...state, layers: { ...state.layers, slide: {} as never } },
    });
    await pressQuick(1);
    expect(sent).toEqual([
      { type: 'clearLayer', layer: 'slide' },
      {
        type: 'setBackground',
        background: { kind: 'media', mediaId: 'm1', media: 'image', fit: 'fit', loop: false },
      },
    ]);
    sent.length = 0;
    await pressQuick(2);
    expect(sent).toEqual([
      {
        type: 'playAudio',
        audio: { id: 'm2', title: 'Placeholder tune', mediaId: 'm2', volume: 1, loop: false },
      },
    ]);
    sent.length = 0;
    await pressQuick(3);
    expect(sent).toMatchObject([{ type: 'showMessage', message: { text: 'Placeholder welcome words' } }]);
    // Nothing pinned there: nothing happens.
    sent.length = 0;
    await pressQuick(6);
    expect(sent).toEqual([]);
  });

  it('says so when a message pinned is gone, or has words to fill in, and puts nothing up', async () => {
    useQuickBar.setState({ pins: [{ kind: 'message', templateId: 'msg1', label: 'Placeholder welcome' }] });
    await pressQuick(0);
    expect(sent).toEqual([]);
    expect(useNotice.getState().text).toContain('no longer in Messages');
    templates = [{ id: 'msg1', name: 'Placeholder welcome', template: 'Welcome {name}', fields: {} }];
    await pressQuick(0);
    expect(sent).toEqual([]);
    expect(useNotice.getState().text).toContain('has words to fill in');
  });
});
