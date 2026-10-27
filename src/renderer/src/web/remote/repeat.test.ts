import { describe, expect, it } from 'vitest';
import { initialEngineState } from '../../../../shared/engine/state';
import type { PlaylistNode } from '../../../../shared/playlists';
import { isRepeatPlaylist, repeatItemUp } from './repeat';

/*
 * Repeat Slides on the phone (Session 54, D5 review): whether the chosen playlist is one, and while it goes round,
 * which of its items has its step up (its steps are named by their items: "<item>/picture", "<item>/2"), as Simple
 * Mode marks it. Made-up ids.
 */

const node = (id: string, kind: PlaylistNode['kind']): PlaylistNode => ({
  id,
  name: `Placeholder ${id}`,
  isFolder: false,
  kind,
  parentId: null,
  itemCount: 2,
  placeholders: 0,
  imported: false,
  template: false,
});

describe('Repeat Slides on the phone', () => {
  it('knows the chosen playlist is a Repeat Slides one', () => {
    const lists = [node('sabha', 'normal'), node('lobby', 'repeat')];
    expect(isRepeatPlaylist(lists, 'lobby')).toBe(true);
    expect(isRepeatPlaylist(lists, 'sabha')).toBe(false);
    expect(isRepeatPlaylist(lists, null)).toBe(false);
    expect(isRepeatPlaylist(null, 'lobby')).toBe(false);
  });

  it('marks the item whose step is up while that playlist goes round, and none otherwise', () => {
    const state = initialEngineState();
    expect(repeatItemUp(state, 'lobby')).toBeNull();
    state.repeat = { playlistId: 'lobby', name: 'Placeholder Lobby' };
    state.layers.slide = {
      presentationId: 'repeat:lobby',
      slideIndex: 2,
      slide: { id: 'item-2/1', width: 1920, height: 1080, elements: [] },
      notes: '',
    } as unknown as typeof state.layers.slide;
    expect(repeatItemUp(state, 'lobby')).toBe('item-2');
    // Another playlist shown on the phone: none of its items is up.
    expect(repeatItemUp(state, 'sabha')).toBeNull();
    state.layers.slide = null;
    expect(repeatItemUp(state, 'lobby')).toBeNull();
  });
});
