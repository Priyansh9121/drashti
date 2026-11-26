import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PipLayer, PipPlace } from '../../../shared/engine/state';
import { initialEngineState } from '../../../shared/engine/state';
import { DEFAULT_PIP_PLACE } from '../../../shared/pip';
import { useEngine } from '../engine/engine-store';
import { followRememberedPlace, usePipPlace } from './pip-store';

/*
 * Where the next box goes, as the Picture in Picture section's preview shows it (QA24-PIPPREVIEW-1; the review's F2):
 * read from the library as the section opens, and read again each time the box comes off, since a box moved by a
 * phone or the API while it was up is remembered by the main process (main/engine/pip-places.ts) and this window
 * hears nothing of it otherwise. Never sends anything: it only reads.
 */

const MOVED: PipPlace = { ...DEFAULT_PIP_PLACE, corner: 'top-left', size: 'large' };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function withBox(up: boolean): void {
  const state = initialEngineState();
  const pip: PipLayer | null = up
    ? { source: { kind: 'slides' }, place: MOVED, swapped: false, shownAt: 1 }
    : null;
  useEngine.setState({ state: { ...state, layers: { ...state.layers, pip } } });
}

describe('the section’s next box follows the place the library remembers', () => {
  const asked: string[] = [];
  let remembered: PipPlace = DEFAULT_PIP_PLACE;
  const g = globalThis as { window?: unknown };
  let before: unknown;
  beforeEach(() => {
    asked.length = 0;
    remembered = DEFAULT_PIP_PLACE;
    before = g.window;
    g.window = {
      drashti: {
        pip: {
          place: () => {
            asked.push('place');
            return Promise.resolve(remembered);
          },
          savePlace: () => {
            asked.push('savePlace');
            return Promise.resolve({ ok: true, place: remembered });
          },
        },
        engine: {
          dispatch: () => {
            asked.push('dispatch');
            return Promise.resolve({ ok: true });
          },
        },
      },
    };
    usePipPlace.setState({ place: null });
    withBox(false);
  });
  afterEach(() => {
    g.window = before;
    useEngine.setState({ state: null });
  });

  it('reads it as the section opens', async () => {
    const stop = followRememberedPlace();
    await flush();
    expect(asked).toEqual(['place']);
    expect(usePipPlace.getState().place).toEqual(DEFAULT_PIP_PLACE);
    stop();
  });

  it('reads it again when the box comes off: a box moved from a phone meanwhile is the next box’s place', async () => {
    const stop = followRememberedPlace();
    await flush();
    withBox(true);
    await flush();
    expect(asked).toEqual(['place']);
    // The phone moved the box while it was up; the main process remembered it.
    remembered = MOVED;
    withBox(false);
    await flush();
    expect(asked).toEqual(['place', 'place']);
    expect(usePipPlace.getState().place).toEqual(MOVED);
    stop();
    // Stopped (the section folded): no more reads.
    withBox(true);
    withBox(false);
    await flush();
    expect(asked).toEqual(['place', 'place']);
  });
});
