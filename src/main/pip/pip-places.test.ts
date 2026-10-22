import { describe, expect, it } from 'vitest';
import type { PipPlace } from '../../shared/engine/state';
import { DEFAULT_PIP_PLACE } from '../../shared/pip';
import { openDatabase } from '../db/database';
import { SettingsRepo } from '../db/settings';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport } from '../engine/testing';
import { PIP_PLACE_SETTING, PipPlaces } from './pip-places';

/*
 * Picture in picture's remembered place (Session 50): where a new box goes and how it looks, kept in the
 * library's settings; saved by the operator, and remembered by itself as the operator moves or resizes the box.
 */

const CORNER: PipPlace = { ...DEFAULT_PIP_PLACE, corner: 'top-left', size: 'small', rounded: false };
const DRAGGED: PipPlace = {
  ...DEFAULT_PIP_PLACE,
  corner: null,
  x: 0.4,
  y: 0.3,
  size: 'large',
  motion: 'scale',
};

function setup() {
  const settings = new SettingsRepo(openDatabase(':memory:'));
  const written: { name: string; value: unknown }[] = [];
  const places = new PipPlaces({
    settings,
    // Bookkeeping the show writes by itself: when the library is free (here, at once, and counted).
    write: (name, value) => {
      written.push({ name, value });
      settings.set(name, value);
    },
  });
  return { settings, places, written };
}

describe('the picture-in-picture box’s remembered place', () => {
  it('is bottom right, Medium, with a border and rounded corners, fading, until one is saved; anything unreadable is that', () => {
    const { settings, places } = setup();
    expect(places.place()).toEqual(DEFAULT_PIP_PLACE);
    expect(DEFAULT_PIP_PLACE).toMatchObject({
      corner: 'bottom-right',
      size: 'medium',
      border: true,
      rounded: true,
    });
    settings.set(PIP_PLACE_SETTING, { ...CORNER, size: 'huge' });
    expect(new PipPlaces({ settings }).place()).toEqual(DEFAULT_PIP_PLACE);
    settings.set(PIP_PLACE_SETTING, 'top-left');
    expect(new PipPlaces({ settings }).place()).toEqual(DEFAULT_PIP_PLACE);
  });

  it('saves a place the operator chose, checked, in the library; a wrong one is refused and nothing changes', () => {
    const { settings, places } = setup();
    expect(places.save(CORNER)).toEqual({ ok: true, place: CORNER });
    expect(places.place()).toEqual(CORNER);
    // Kept in the library: the next start reads it.
    expect(new PipPlaces({ settings }).place()).toEqual(CORNER);
    for (const wrong of [{ ...CORNER, x: 2 }, { ...CORNER, motion: 'spin' }, { corner: 'top-left' }, null])
      expect(places.save(wrong), JSON.stringify(wrong)).toMatchObject({ ok: false });
    expect(places.place()).toEqual(CORNER);
    expect(settings.get(PIP_PLACE_SETTING)).toEqual(CORNER);
  });

  it('remembers where the box is as the operator moves or resizes it, once each time, so the next box starts there', () => {
    const { places, written } = setup();
    const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => 1000, undefined, {
      pipPlace: () => places.place(),
    });
    engine.onChange((state) => {
      places.follow(state);
    });
    engine.dispatch({ type: 'showPip', source: { kind: 'slides' } });
    // Where it already was remembered: nothing written.
    expect(engine.current.layers.pip?.place).toEqual(DEFAULT_PIP_PLACE);
    expect(written).toEqual([]);
    engine.dispatch({ type: 'placePip', place: DRAGGED });
    expect(written).toEqual([{ name: PIP_PLACE_SETTING, value: DRAGGED }]);
    expect(places.place()).toEqual(DRAGGED);
    // Other changes to the show write nothing more.
    engine.dispatch({ type: 'swapPip' });
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    engine.dispatch({ type: 'hidePip' });
    expect(written).toHaveLength(1);
    // Next time, it starts where it was left.
    engine.dispatch({ type: 'showPip', source: { kind: 'slides' } });
    expect(engine.current.layers.pip?.place).toEqual(DRAGGED);
    // Put up somewhere given (a corner chosen first): remembered too.
    engine.dispatch({ type: 'showPip', source: { kind: 'slides' }, place: CORNER });
    expect(places.place()).toEqual(CORNER);
    expect(written.map((w) => w.value)).toEqual([DRAGGED, CORNER]);
  });
});
