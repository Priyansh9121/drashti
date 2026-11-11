import { describe, expect, it } from 'vitest';
import { emptyLayers, type Layers } from '../../../shared/engine/state';
import type { PlaylistItemInfo } from '../../../shared/playlists';
import { itemStillUp } from './StatusLine';

/*
 * LIVE's line for a picture, video, sound or video input row put up from a playlist (Session 56: LIVE shows one thing at
 * a time): live only while what it put up is still up. Black-out or the Wallpaper going on takes a video off, and the
 * line then says the row was cleared, never that it is live beside the cover.
 */

const media = (mediaId: string, kind: 'image' | 'video' | 'audio'): PlaylistItemInfo => ({
  id: `i-${mediaId}`,
  kind: 'media',
  label: `Placeholder ${mediaId}`,
  mediaId,
  media: kind,
  missing: false,
  unplayable: null,
  timers: [],
});
const input: PlaylistItemInfo = {
  id: 'i-cam',
  kind: 'input',
  label: 'Input 1',
  name: 'Input 1',
  missing: false,
  timers: [],
};

const layers = (more: Partial<Layers>): Layers => ({ ...emptyLayers(), ...more });
const video = layers({
  background: { kind: 'media', mediaId: 'clip', media: 'video', fit: 'fit', loop: false, startedAt: 1 },
});
const sound = layers({
  audio: { id: 'a', title: 'Placeholder', mediaId: 'tune', volume: 1, loop: false, startedAt: 1 },
});
const camera = layers({
  background: {
    kind: 'input',
    inputId: 'in-1',
    name: 'Input 1',
    device: 'Placeholder camera',
    fit: 'fit',
    startedAt: 1,
  },
});

describe('LIVE’s line for a row from a playlist (Session 56)', () => {
  it('is live while what the row put up is up', () => {
    expect(itemStillUp(media('clip', 'video'), video)).toBe(true);
    expect(itemStillUp(media('tune', 'audio'), sound)).toBe(true);
    expect(itemStillUp(input, camera)).toBe(true);
  });

  it('is not once it is off: a cover took the video off, a clear or Clear all took it off, or something else is up', () => {
    expect(itemStillUp(media('clip', 'video'), emptyLayers())).toBe(false);
    expect(itemStillUp(media('clip', 'video'), sound)).toBe(false);
    expect(itemStillUp(media('tune', 'audio'), video)).toBe(false);
    expect(itemStillUp(media('other', 'video'), video)).toBe(false);
    expect(itemStillUp(input, emptyLayers())).toBe(false);
  });

  it('with the row not known here (its playlist not open): live while a picture or a sound is up', () => {
    expect(itemStillUp(undefined, video)).toBe(true);
    expect(itemStillUp(undefined, sound)).toBe(true);
    expect(itemStillUp(undefined, emptyLayers())).toBe(false);
    expect(itemStillUp(undefined, undefined)).toBe(false);
  });
});
