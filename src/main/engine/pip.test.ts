import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import { parseEngineCommand } from '../../shared/engine/commands';
import type { PipLayer, PipPlace } from '../../shared/engine/state';
import { SIMPLE_MODE_REFUSAL, SIMPLE_MODE_REFUSED_COMMANDS } from '../../shared/mode';
import { mediaInState, mediaUpNow } from '../../shared/node-media';
import { PLAIN } from '../../shared/picture-look';
import { DEFAULT_PIP_PLACE } from '../../shared/pip';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport } from './testing';

/*
 * Picture in picture in the engine (Session 50): the box holds the slides, a picture or video from Media, a video
 * input from this computer's list or a window Show a Window… just offered, each looked up by the main process and
 * never taken from a page; it goes where the library remembers; Swap and moving it keep how it was, for the
 * animation; Take off plays its out; Clear all takes it off at once and Put it back brings it back; black-out
 * and the logo cover it and never take it off. Placeholder names only.
 */

const CAMERA = { name: 'Input 1', device: 'Placeholder capture device' };
const MEETING = { id: 'window:4021:0', name: 'Placeholder meeting' };
const REMEMBERED: PipPlace = { ...DEFAULT_PIP_PLACE, corner: 'top-left', size: 'small', motion: 'slide' };
const DRAGGED: PipPlace = {
  ...DEFAULT_PIP_PLACE,
  corner: null,
  x: 0.4,
  y: 0.3,
  size: 'large',
  border: false,
};

function setup(options: { simple?: boolean } = {}) {
  let clock = 1000;
  const media = new Map<string, 'image' | 'video' | 'audio'>([
    ['m-photo', 'image'],
    ['m-clip', 'video'],
    ['m-tune', 'audio'],
  ]);
  const inputs = new Map([['in-1', CAMERA]]);
  /** The windows Show a Window… offered last, by id. */
  const offered = new Map([[MEETING.id, MEETING.name]]);
  const transport = new RecordingTransport();
  const engine = new ShowEngine(makeSource(), transport, () => (clock += 10), undefined, {
    mediaKind: (id) => media.get(id) ?? null,
    inputs: (id) => inputs.get(id) ?? null,
    windows: (id) => {
      const name = offered.get(id);
      return name === undefined ? null : { sourceId: id, name };
    },
    pipPlace: () => REMEMBERED,
    pictureLook: (id) => (id === 'm-photo' ? { ...PLAIN, brightness: 0.2 } : null),
    refuse: (c) =>
      options.simple === true && SIMPLE_MODE_REFUSED_COMMANDS.includes(c.type) ? SIMPLE_MODE_REFUSAL : null,
    schedule: () => () => undefined,
  });
  return { engine, transport, inputs, offered, advance: (ms: number) => (clock += ms) };
}

const show = (source: Extract<EngineCommand, { type: 'showPip' }>['source'], place?: PipPlace) =>
  ({ type: 'showPip', source, ...(place ? { place } : {}) }) as const;

describe('the picture-in-picture box in the engine', () => {
  it('takes the slides, a picture or video from Media, a video input or an offered window, from now, where the library remembers', () => {
    const { engine } = setup();
    expect(engine.dispatch(show({ kind: 'slides' }))).toMatchObject({ ok: true, changed: true });
    const slides = engine.current.layers.pip;
    expect(slides).toEqual({ source: { kind: 'slides' }, place: REMEMBERED, swapped: false, shownAt: 1010 });
    expect(engine.current.pipOff).toBeNull();
    engine.dispatch(show({ kind: 'media', mediaId: 'm-photo' }));
    expect(engine.current.layers.pip?.source).toEqual({ kind: 'media', mediaId: 'm-photo', media: 'image' });
    engine.dispatch(show({ kind: 'media', mediaId: 'm-clip' }));
    expect(engine.current.layers.pip?.source).toEqual({ kind: 'media', mediaId: 'm-clip', media: 'video' });
    // The input as this computer's list names it: what a page sends besides its id is never used.
    expect(
      parseEngineCommand({ type: 'showPip', source: { kind: 'input', inputId: 'in-1', device: 'Another' } }),
    ).toEqual({ ok: true, command: { type: 'showPip', source: { kind: 'input', inputId: 'in-1' } } });
    engine.dispatch(show({ kind: 'input', inputId: 'in-1' }));
    expect(engine.current.layers.pip?.source).toEqual({ kind: 'input', inputId: 'in-1', ...CAMERA });
    engine.dispatch(show({ kind: 'window', id: MEETING.id }));
    expect(engine.current.layers.pip?.source).toEqual({
      kind: 'window',
      sourceId: MEETING.id,
      name: MEETING.name,
    });
    // Still where it went up, each new picture from its own moment.
    expect(engine.current.layers.pip?.place).toEqual(REMEMBERED);
    expect(engine.current.layers.pip?.shownAt).toBeGreaterThan(slides?.shownAt ?? 0);
  });

  it('refuses what is not there: an input not in the list, a window not just offered, media not in Media, a sound', () => {
    const { engine, transport, inputs, offered } = setup();
    expect(engine.dispatch(show({ kind: 'input', inputId: 'in-gone' }))).toMatchObject({
      ok: false,
      error: 'unknown-input',
    });
    for (const id of ['window:999:0', 'screen:0:0'])
      expect(engine.dispatch(show({ kind: 'window', id }))).toMatchObject({
        ok: false,
        error: 'unknown-item',
      });
    expect(engine.dispatch(show({ kind: 'media', mediaId: 'm-gone' }))).toMatchObject({
      ok: false,
      error: 'unknown-item',
    });
    expect(engine.dispatch(show({ kind: 'media', mediaId: 'm-tune' }))).toMatchObject({
      ok: false,
      error: 'not-playable',
    });
    // An input removed, or the windows listed again without it: no longer.
    inputs.clear();
    offered.clear();
    expect(engine.dispatch(show({ kind: 'input', inputId: 'in-1' }))).toMatchObject({
      error: 'unknown-input',
    });
    expect(engine.dispatch(show({ kind: 'window', id: MEETING.id }))).toMatchObject({
      error: 'unknown-item',
    });
    expect(engine.current.layers.pip).toBeNull();
    expect(transport.messages).toHaveLength(0);
    // Without the main process's lists (an engine given none), nothing but the slides.
    const bare = new ShowEngine(makeSource(), new RecordingTransport(), () => 5);
    expect(bare.dispatch(show({ kind: 'media', mediaId: 'm-photo' }))).toMatchObject({ ok: false });
    expect(bare.dispatch(show({ kind: 'input', inputId: 'in-1' }))).toMatchObject({ ok: false });
    expect(bare.dispatch(show({ kind: 'window', id: MEETING.id }))).toMatchObject({ ok: false });
    expect(bare.dispatch(show({ kind: 'slides' }))).toMatchObject({ ok: true });
    expect(bare.current.layers.pip?.place).toEqual(DEFAULT_PIP_PLACE);
  });

  it('the same picture again changes nothing; a place given moves it; another picture is a new box from now', () => {
    const { engine } = setup();
    engine.dispatch(show({ kind: 'media', mediaId: 'm-clip' }));
    const up = engine.current.layers.pip;
    expect(engine.dispatch(show({ kind: 'media', mediaId: 'm-clip' }))).toMatchObject({ changed: false });
    // Moved where the operator put it, from how it was (its video carries on).
    engine.dispatch(show({ kind: 'media', mediaId: 'm-clip' }, DRAGGED));
    const moved = engine.current.layers.pip;
    expect(moved).toMatchObject({ place: DRAGGED, shownAt: up?.shownAt, swapped: false });
    expect(moved?.changed).toEqual({ at: expect.any(Number) as number, place: REMEMBERED, swapped: false });
    // Another picture: a box of its own, where this one was, unswapped.
    engine.dispatch({ type: 'swapPip' });
    engine.dispatch(show({ kind: 'slides' }));
    const next = engine.current.layers.pip;
    expect(next).toEqual({
      source: { kind: 'slides' },
      place: DRAGGED,
      swapped: false,
      shownAt: next?.shownAt,
    });
    expect(next?.shownAt).toBeGreaterThan(moved?.shownAt ?? 0);
  });

  it('Swap changes which picture is the main one, and back; the state keeps how it was, for the animation', () => {
    const { engine } = setup();
    expect(engine.dispatch({ type: 'swapPip' })).toMatchObject({ ok: false, error: 'no-pip' });
    engine.dispatch(show({ kind: 'input', inputId: 'in-1' }));
    const up = engine.current.layers.pip;
    expect(engine.dispatch({ type: 'swapPip' })).toMatchObject({ ok: true, changed: true });
    const swapped = engine.current.layers.pip;
    expect(swapped).toMatchObject({ swapped: true, place: REMEMBERED, shownAt: up?.shownAt });
    expect(swapped?.changed).toEqual({ at: expect.any(Number) as number, place: REMEMBERED, swapped: false });
    engine.dispatch({ type: 'swapPip' });
    expect(engine.current.layers.pip).toMatchObject({ swapped: false, changed: { swapped: true } });
    expect(engine.current.layers.pip?.changed?.at).toBeGreaterThan(swapped?.changed?.at ?? 0);
  });

  it('placePip moves and sizes it, keeping where it was for the animation; the same place changes nothing', () => {
    const { engine } = setup();
    expect(engine.dispatch({ type: 'placePip', place: DRAGGED })).toMatchObject({
      ok: false,
      error: 'no-pip',
    });
    engine.dispatch(show({ kind: 'slides' }));
    expect(engine.dispatch({ type: 'placePip', place: DRAGGED })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.layers.pip).toMatchObject({
      place: DRAGGED,
      changed: { place: REMEMBERED, swapped: false },
    });
    expect(engine.dispatch({ type: 'placePip', place: DRAGGED })).toMatchObject({ changed: false });
    // A place off the screen, or a size it does not have, never reaches the engine.
    for (const place of [
      { ...DRAGGED, x: 1.2 },
      { ...DRAGGED, size: 'huge' },
      { ...DRAGGED, corner: 'middle' },
    ])
      expect(parseEngineCommand({ type: 'placePip', place }).ok).toBe(false);
  });

  it('Take off plays its out from then; taking off nothing changes nothing; its own clear plays the out too', () => {
    const { engine } = setup();
    engine.dispatch(show({ kind: 'slides' }));
    const up = engine.current.layers.pip;
    expect(engine.dispatch({ type: 'hidePip' })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.layers.pip).toBeNull();
    expect(engine.current.pipOff).toEqual({ layer: up, at: expect.any(Number) as number });
    expect(engine.current.pipOff?.at).toBeGreaterThan(up?.shownAt ?? 0);
    expect(engine.dispatch({ type: 'hidePip' })).toMatchObject({ ok: true, changed: false });
    // Up again: nothing is leaving any more.
    engine.dispatch(show({ kind: 'slides' }));
    expect(engine.current.pipOff).toBeNull();
    engine.dispatch({ type: 'clearLayer', layer: 'pip' });
    expect(engine.current.layers.pip).toBeNull();
    expect(engine.current.pipOff?.layer.source).toEqual({ kind: 'slides' });
  });

  it('Clear all takes it off at once, with no out; Put it back brings it back as it was', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    engine.dispatch(show({ kind: 'input', inputId: 'in-1' }, DRAGGED));
    engine.dispatch({ type: 'swapPip' });
    const up = engine.current.layers.pip;
    engine.dispatch({ type: 'clearAll' });
    expect(engine.current.layers.pip).toBeNull();
    expect(engine.current.pipOff).toBeNull();
    expect(engine.current.canPutBack).toBe(true);
    engine.dispatch({ type: 'putBack' });
    expect(engine.current.layers.pip).toEqual(up);
    expect(engine.current.pipOff).toBeNull();
    // Taken off, then Clear all: the out it was playing goes at once too.
    engine.dispatch({ type: 'hidePip' });
    expect(engine.current.pipOff).not.toBeNull();
    engine.dispatch({ type: 'clearAll' });
    expect(engine.current.pipOff).toBeNull();
  });

  it('black-out and the logo cover it and never take it off; Next and Previous leave it up', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    engine.dispatch(show({ kind: 'slides' }));
    const up = engine.current.layers.pip;
    engine.dispatch({ type: 'setBlackout', on: true });
    engine.dispatch({ type: 'showLogo', prop: { id: 'logo', name: 'Placeholder logo', elements: [] } });
    expect(engine.current.layers.pip).toBe(up);
    engine.dispatch({ type: 'hideLogo' });
    engine.dispatch({ type: 'toggleBlackout' });
    expect(engine.current.layers.pip).toBe(up);
    expect(engine.current.pipOff).toBeNull();
    // With the slides in it, it follows the slide on the screens: the box itself stays as it is.
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'previous' });
    expect(engine.current.layers.slide?.slideIndex).toBe(0);
    expect(engine.current.layers.pip).toBe(up);
  });

  it('a picture in it is media the screens, the nodes and the stream must have, with its look', () => {
    const { engine } = setup();
    engine.dispatch(show({ kind: 'media', mediaId: 'm-photo' }));
    expect(mediaInState(engine.current).now).toEqual(['m-photo']);
    // Deleted from the library meanwhile, it stays served while it is up (Session 26a).
    expect(mediaUpNow(engine.current).has('m-photo')).toBe(true);
    expect(engine.current.pictures).toEqual({ 'm-photo': { ...PLAIN, brightness: 0.2 } });
    engine.dispatch({ type: 'hidePip' });
    expect(mediaInState(engine.current).now).toEqual([]);
    // Taken off, it keeps its look while its out plays.
    expect(engine.current.pictures).toEqual({ 'm-photo': { ...PLAIN, brightness: 0.2 } });
    // A video input or a window is on this computer only: no media for a node to copy.
    engine.dispatch(show({ kind: 'input', inputId: 'in-1' }));
    expect(mediaInState(engine.current)).toEqual({ now: [], next: [] });
  });

  it('going up stops the idle rotation, as a slide or a picture does', () => {
    const { engine } = setup();
    engine.setIdle({ items: [{ kind: 'picture', mediaId: 'm-photo' }], secondsEach: 10, dissolveMs: 1500 });
    engine.dispatch({ type: 'startIdle' });
    expect(engine.current.idle.startedAt).not.toBeNull();
    engine.dispatch(show({ kind: 'media', mediaId: 'm-clip' }));
    expect(engine.current.idle.startedAt).toBeNull();
  });

  it('Simple Mode refuses setting one up, swapping and moving it, from anywhere; Take off and Clear all still work', () => {
    const { engine } = setup({ simple: true });
    for (const command of [
      show({ kind: 'slides' }),
      { type: 'swapPip' },
      { type: 'placePip', place: DRAGGED },
    ] as const)
      expect(engine.dispatch(command)).toEqual({
        ok: false,
        error: 'forbidden',
        message: SIMPLE_MODE_REFUSAL,
      });
    for (const type of ['hidePip', 'clearAll', 'clearLayer', 'putBack'])
      expect(SIMPLE_MODE_REFUSED_COMMANDS).not.toContain(type);
    // A box already up (put back after a restart, say) comes off in Simple Mode as it does in Pro Mode.
    engine.restore({
      slide: null,
      background: null,
      blackout: false,
      pip: { source: { kind: 'slides' }, place: REMEMBERED, swapped: false, shownAt: 5 },
    });
    expect(engine.dispatch({ type: 'hidePip' })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.pipOff?.layer.source).toEqual({ kind: 'slides' });
  });

  describe('after an unexpected stop', () => {
    const at = (layer: Omit<PipLayer, 'place' | 'swapped' | 'shownAt'>): PipLayer => ({
      ...layer,
      place: DRAGGED,
      swapped: true,
      shownAt: 777,
    });

    it('puts back a box of the slides or of media as it was, still: its video carries on from when it went up', () => {
      for (const source of [
        { kind: 'slides' },
        { kind: 'media', mediaId: 'm-clip', media: 'video' },
      ] as const) {
        const { engine } = setup();
        const saved = { ...at({ source }), changed: { at: 700, place: REMEMBERED, swapped: false } };
        const put = engine.restore({ slide: null, background: null, blackout: false, pip: saved });
        expect(put).toMatchObject({ pip: true, window: null });
        // As it was, without the animation it was playing then.
        expect(engine.current.layers.pip).toEqual(at({ source }));
      }
    });

    it('puts back a video input only while it is in this computer’s list, named as the list names it now', () => {
      const { engine } = setup();
      const saved = at({
        source: { kind: 'input', inputId: 'in-1', name: 'Old name', device: 'Old device' },
      });
      expect(engine.restore({ slide: null, background: null, blackout: false, pip: saved }).pip).toBe(true);
      expect(engine.current.layers.pip?.source).toEqual({ kind: 'input', inputId: 'in-1', ...CAMERA });
      const again = setup();
      again.inputs.clear();
      expect(again.engine.restore({ slide: null, background: null, blackout: false, pip: saved }).pip).toBe(
        false,
      );
      expect(again.engine.current.layers.pip).toBeNull();
    });

    it('never puts back a window (it may be gone, or be another window now), and says which it was', () => {
      const { engine } = setup();
      const put = engine.restore({
        slide: { presentationId: 'p1', slideIndex: 0 },
        background: null,
        blackout: false,
        pip: at({ source: { kind: 'window', sourceId: MEETING.id, name: MEETING.name } }),
      });
      expect(put).toMatchObject({ slide: true, pip: false, window: MEETING.name });
      expect(engine.current.layers.pip).toBeNull();
    });
  });
});
