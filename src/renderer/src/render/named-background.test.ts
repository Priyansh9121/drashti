import { describe, expect, it } from 'vitest';
import type { InputBackground, PipLayer, WindowBackground } from '../../../shared/engine/state';
import { initialEngineState } from '../../../shared/engine/state';
import { DEFAULT_LIVE_GROUP_LOOK, LOOK_LAYERS } from '../../../shared/looks';
import { DEFAULT_PIP_PLACE } from '../../../shared/pip';
import { namedBackground, unseenLive } from './named-background';

/*
 * A phone names a live background it cannot draw (Session 48: another app's window; Session 50: a video input)
 * and can clear it, never choose one. A stage layout's audience picture box on a page that cannot draw them (a
 * tablet's stage display, a node's stage screen) names them in the same words (Session 51).
 */

const input: InputBackground = {
  kind: 'input',
  inputId: 'i1',
  name: 'Placeholder input',
  device: 'fake_device_0',
  fit: 'fill',
  startedAt: 1,
};
const meeting: WindowBackground = {
  kind: 'window',
  sourceId: 'window:1:0',
  name: 'Placeholder meeting',
  startedAt: 1,
};

describe('a phone’s line for a background it cannot draw', () => {
  it('names a video input as “Video input: <name>”', () => {
    const line = namedBackground(input);
    expect(line).toEqual({ kind: 'input', label: 'Video input:', name: 'Placeholder input' });
    expect(line && `${line.label} ${line.name}`).toBe('Video input: Placeholder input');
  });

  it('names a window as before, and nothing else', () => {
    expect(namedBackground(meeting)).toEqual({
      kind: 'window',
      label: 'A window:',
      name: 'Placeholder meeting',
    });
    expect(namedBackground(null)).toBeNull();
    expect(namedBackground(undefined)).toBeNull();
    expect(namedBackground({ kind: 'color', color: '#000000' })).toBeNull();
    expect(
      namedBackground({ kind: 'media', mediaId: 'm', media: 'video', fit: 'fill', loop: true, startedAt: 1 }),
    ).toBeNull();
  });
});

describe('the lines a stage box names over the hall’s picture where it cannot draw them (Session 51)', () => {
  const state = initialEngineState();
  const box = (source: PipLayer['source']): PipLayer => ({
    source,
    place: DEFAULT_PIP_PLACE,
    swapped: false,
    shownAt: 1,
  });
  const up = (background: InputBackground | WindowBackground | null, pip: PipLayer | null = null) => ({
    ...state,
    layers: { ...state.layers, background, pip },
  });
  const look = DEFAULT_LIVE_GROUP_LOOK;

  it('names the background’s video input or window, and the box’s, in the phone remote’s words', () => {
    expect(unseenLive(up(input), look, false)).toEqual(['Video input: Placeholder input']);
    expect(unseenLive(up(meeting), look, false)).toEqual(['A window: Placeholder meeting']);
    const inBox = box({ kind: 'input', inputId: 'i1', name: 'Placeholder input', device: 'fake_device_0' });
    expect(unseenLive(up(meeting, inBox), look, false)).toEqual([
      'A window: Placeholder meeting',
      'Picture in picture: Placeholder input',
    ]);
    const windowInBox = box({ kind: 'window', sourceId: 'window:1:0', name: 'Placeholder meeting' });
    expect(unseenLive(up(null, windowInBox), look, false)).toEqual([
      'Picture in picture: Placeholder meeting',
    ]);
  });

  it('names nothing a page draws, nor what the hall does not show', () => {
    const inBox = box({ kind: 'input', inputId: 'i1', name: 'Placeholder input', device: 'fake_device_0' });
    // This computer's own pages draw them.
    expect(unseenLive(up(input, inBox), look, true)).toEqual([]);
    // Black-out and the logo cover them on the hall's screens.
    expect(unseenLive({ ...up(input, inBox), blackout: true }, look, false)).toEqual([]);
    const logo = { id: 'placeholder-logo', name: 'Placeholder logo', elements: [] };
    expect(unseenLive({ ...up(input, inBox), logo }, look, false)).toEqual([]);
    // A Look that leaves the background, or the box, out of the hall's group.
    const noBackground = { ...look, layers: LOOK_LAYERS.filter((l) => l !== 'background') };
    expect(unseenLive(up(input, inBox), noBackground, false)).toEqual([
      'Picture in picture: Placeholder input',
    ]);
    const noBox = { ...look, layers: LOOK_LAYERS.filter((l) => l !== 'pip') };
    expect(unseenLive(up(input, inBox), noBox, false)).toEqual(['Video input: Placeholder input']);
    // Pictures, videos and the slides are drawn as small previews, never named.
    expect(unseenLive(up(null, box({ kind: 'slides' })), look, false)).toEqual([]);
    expect(unseenLive(up(null, box({ kind: 'media', mediaId: 'm', media: 'video' })), look, false)).toEqual(
      [],
    );
    expect(unseenLive(state, look, false)).toEqual([]);
  });
});
