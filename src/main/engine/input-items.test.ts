import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import type { BackgroundCue } from '../../shared/library';
import { SIMPLE_MODE_REFUSAL, SIMPLE_MODE_REFUSED_COMMANDS } from '../../shared/mode';
import { INPUT_FADE_MS, inputNamed, type VideoInput } from '../../shared/video-inputs';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';

/*
 * A video input as a playlist item and as a slide's background cue (Session 51), in the show engine: placeholder
 * names only. The item comes from the library already found on this computer by its name (or as a 'skip' saying
 * it is not here: db/playlists.ts); a slide's cue names it, and the engine finds it as the slide goes up.
 */

const INPUT: VideoInput = { id: 'in-1', name: 'Input 1', device: 'Placeholder camera', fit: 'fit' };
const OTHER: VideoInput = { id: 'in-2', name: 'Input 2', device: 'Placeholder capture', fit: 'fill' };

/** A slide's background cue naming a video input. */
const inputCue = (name: string): BackgroundCue => ({
  kind: 'background',
  label: '',
  name,
  missing: false,
  unplayable: null,
  background: { kind: 'input', name },
});

/** A slide's background cue with a picture. */
const pictureCue: BackgroundCue = {
  kind: 'background',
  label: '',
  name: 'Placeholder picture.png',
  missing: false,
  unplayable: null,
  background: { kind: 'media', mediaId: 'pic', media: 'image', fit: 'fill', loop: false },
};

/**
 * An engine on a computer with these inputs in Media (a list the test may change), and a playlist: a
 * presentation, an input item, an item naming an input this computer does not have, and another presentation.
 */
function show() {
  const source = makeSource();
  // cam: its first slide's background is Input 1, its second has none, its third names Input 9 (not here), its
  // fourth Input 2.
  source.set(
    'cam',
    [textSlide('c1', 'One'), textSlide('c2', 'Two'), textSlide('c3', 'Three'), textSlide('c4', 'Four')],
    [[inputCue('Input 1')], [], [inputCue('Input 9')], [inputCue('input 2')]],
  );
  source.set('pics', [textSlide('k1', 'Picture')], [[pictureCue]]);
  const playlists = new MemoryPlaylistSource();
  playlists.set('sunday', [
    { id: 'i-p2', kind: 'presentation', presentationId: 'p2', arrangementId: undefined },
    {
      id: 'i-cam',
      kind: 'input',
      inputId: 'in-1',
      label: 'Input 1',
      timers: [{ timerId: 'talk', action: 'start' }],
    },
    { id: 'i-gone', kind: 'skip', why: 'The video input “Input 9” is not on this computer' },
    { id: 'i-p1', kind: 'presentation', presentationId: 'p1', arrangementId: undefined },
  ]);
  const transport = new RecordingTransport();
  let clock = 1000;
  let simple = false;
  const list: VideoInput[] = [INPUT, OTHER];
  const engine = new ShowEngine(source, transport, () => ++clock, playlists, {
    videoInput: (id) => list.find((i) => i.id === id) ?? null,
    inputNamed: (name) => inputNamed(list, name),
    // As Drashti refuses in Simple Mode (src/main/index.ts).
    refuse: (c) => (simple && SIMPLE_MODE_REFUSED_COMMANDS.includes(c.type) ? SIMPLE_MODE_REFUSAL : null),
  });
  engine.setTimers([
    {
      id: 'talk',
      name: 'Placeholder talk',
      kind: 'countdown',
      durationMs: 60_000,
      targetTime: null,
      allowsOverrun: false,
    },
  ]);
  return {
    engine,
    playlists,
    list,
    setSimple: (on: boolean) => {
      simple = on;
    },
  };
}

const play = (itemId: string): EngineCommand => ({ type: 'playItem', playlistId: 'sunday', itemId });
const goLive = (presentationId: string, slideIndex: number): EngineCommand => ({
  type: 'goLive',
  presentationId,
  slideIndex,
});

describe('a video input as a playlist item', () => {
  it('goes up as the background with its fixed 1 s fade, taking the slide off, and runs its timer cues', () => {
    const { engine } = show();
    engine.dispatch(play('i-p2'));
    expect(engine.current.layers.slide).not.toBeNull();
    expect(engine.dispatch({ type: 'next' })).toMatchObject({ ok: true, changed: true });
    const up = engine.current.layers.background;
    if (up?.kind !== 'input') throw new Error('no input up');
    expect(up).toEqual({
      kind: 'input',
      inputId: 'in-1',
      name: 'Input 1',
      device: 'Placeholder camera',
      fit: 'fit',
      startedAt: up.startedAt,
      fade: { at: up.startedAt, durationMs: INPUT_FADE_MS },
    });
    // It is what the audience should see, as a picture or video item is: the slide comes off.
    expect(engine.current.layers.slide).toBeNull();
    expect(engine.current.live).toMatchObject({
      presentationId: null,
      playlist: { playlistId: 'sunday', itemId: 'i-cam' },
    });
    expect(engine.current.timers.find((t) => t.id === 'talk')?.startedAt).not.toBeNull();
    // Back undoes the Next exactly.
    engine.dispatch({ type: 'back' });
    expect(engine.current.layers.background).toBeNull();
    expect(engine.current.live.presentationId).toBe('p2');
  });

  it('is what Next shows next, and a stage screen’s coming up names it', () => {
    const { engine } = show();
    engine.dispatch(play('i-p2'));
    expect(engine.current.next).toEqual({
      kind: 'input',
      itemId: 'i-cam',
      inputId: 'in-1',
      name: 'Input 1',
      label: 'Input 1',
    });
    expect(engine.current.upcoming).toEqual([
      { id: 'i-cam', label: 'Input 1', kind: 'input' },
      { id: 'i-p1', label: '', kind: 'presentation' },
    ]);
  });

  it('one this computer does not have says why, and Next goes on past it', () => {
    const { engine } = show();
    expect(engine.dispatch(play('i-gone'))).toEqual({
      ok: false,
      error: 'not-playable',
      message: 'The video input “Input 9” is not on this computer',
    });
    engine.dispatch(play('i-cam'));
    // From the input, Next steps over the item that is not here to the next presentation.
    expect(engine.current.next).toMatchObject({ kind: 'slide', presentationId: 'p1', itemId: 'i-p1' });
    engine.dispatch({ type: 'next' });
    expect(engine.current.live).toMatchObject({
      presentationId: 'p1',
      playlist: { playlistId: 'sunday', itemId: 'i-p1' },
    });
    // The input stays under the presentation's slides, as a video item's picture would.
    expect(engine.current.layers.background).toMatchObject({ kind: 'input', inputId: 'in-1' });
    // Removed from Media since the playlist was read: nothing to put up, and it says so.
    const removed = show();
    removed.list.splice(0, 1);
    expect(removed.engine.dispatch(play('i-cam'))).toEqual({
      ok: false,
      error: 'not-playable',
      message: 'That video input is not on this computer.',
    });
  });

  it('after a restart, the playlist’s place on an input item comes back, so Next carries on from it', () => {
    const { engine } = show();
    engine.dispatch(play('i-cam'));
    const up = engine.current.layers.background;
    if (up?.kind !== 'input') throw new Error('no input up');
    const again = show().engine;
    again.restore({
      slide: null,
      playlist: { playlistId: 'sunday', itemId: 'i-cam' },
      background: up,
      blackout: false,
    });
    expect(again.current.live.playlist).toEqual({ playlistId: 'sunday', itemId: 'i-cam' });
    expect(again.current.layers.background).toMatchObject({ kind: 'input', inputId: 'in-1' });
    again.dispatch({ type: 'next' });
    expect(again.current.live).toMatchObject({
      presentationId: 'p1',
      playlist: { playlistId: 'sunday', itemId: 'i-p1' },
    });
  });

  it('Simple Mode’s Next puts one up through the playlist, while choosing one directly stays refused', () => {
    const { engine, setSimple } = show();
    engine.dispatch(play('i-p2'));
    setSimple(true);
    expect(engine.dispatch({ type: 'next' })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.layers.background).toMatchObject({ kind: 'input', inputId: 'in-1' });
    expect(engine.dispatch({ type: 'showInput', inputId: 'in-2' })).toEqual({
      ok: false,
      error: 'forbidden',
      message: SIMPLE_MODE_REFUSAL,
    });
  });
});

describe('a video input as a slide’s background cue', () => {
  it('goes up behind the slide with its fixed 1 s fade, carries on under later slides, and Next goes on', () => {
    const { engine } = show();
    engine.dispatch(goLive('cam', 0));
    const up = engine.current.layers.background;
    if (up?.kind !== 'input') throw new Error('no input up');
    expect(up).toMatchObject({ inputId: 'in-1', name: 'Input 1', fade: { durationMs: INPUT_FADE_MS } });
    expect(engine.current.layers.slide).toMatchObject({ presentationId: 'cam', slideIndex: 0 });
    expect(engine.current.layers.slide?.inputMissing).toBeUndefined();
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.background).toBe(up);
    // The same input on another slide carries on (its time kept), as the same video does.
    engine.dispatch(goLive('cam', 0));
    expect(engine.current.layers.background).toEqual(up);
    // The other input, found by its name as Media compares names: Fill, as Media has it.
    engine.dispatch(goLive('cam', 3));
    expect(engine.current.layers.background).toMatchObject({ kind: 'input', inputId: 'in-2', fit: 'fill' });
  });

  it('one this computer does not have leaves the background as it was, never black, and LIVE can say why', () => {
    const { engine } = show();
    engine.dispatch(goLive('pics', 0));
    const picture = engine.current.layers.background;
    expect(picture).toMatchObject({ kind: 'media', mediaId: 'pic' });
    // What Next shows says which input it names.
    engine.dispatch(goLive('cam', 1));
    expect(engine.current.next).toMatchObject({
      kind: 'slide',
      slideIndex: 2,
      background: null,
      input: 'Input 9',
    });
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide).toMatchObject({ slideIndex: 2, inputMissing: 'Input 9' });
    expect(engine.current.layers.background).toBe(picture);
    // Next goes on; the next slide names none missing.
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide?.slideIndex).toBe(3);
    expect(engine.current.layers.slide?.inputMissing).toBeUndefined();
    expect(engine.current.layers.background).toMatchObject({ kind: 'input', inputId: 'in-2' });
    // Back brings the slide back exactly, saying so again.
    engine.dispatch({ type: 'back' });
    expect(engine.current.layers.slide).toMatchObject({ slideIndex: 2, inputMissing: 'Input 9' });
    expect(engine.current.layers.background).toBe(picture);
  });

  it('added to Media since, the slide shown again puts it up and says nothing is missing', () => {
    const { engine, list } = show();
    engine.dispatch(goLive('cam', 2));
    expect(engine.current.layers.slide?.inputMissing).toBe('Input 9');
    list.push({ id: 'in-9', name: 'Input 9', device: 'Placeholder spare', fit: 'fit' });
    engine.dispatch(goLive('cam', 2));
    expect(engine.current.layers.slide?.inputMissing).toBeUndefined();
    expect(engine.current.layers.background).toMatchObject({ kind: 'input', inputId: 'in-9' });
  });

  it('what Next shows names the input behind the next slide, and a slide without one names none', () => {
    const { engine } = show();
    engine.dispatch(goLive('p1', 0));
    expect(engine.current.next).toMatchObject({ kind: 'slide', slideIndex: 1 });
    expect(engine.current.next).not.toHaveProperty('input');
    engine.dispatch(goLive('cam', 3));
    engine.dispatch(goLive('cam', 0));
    expect(engine.current.next).toMatchObject({ kind: 'slide', slideIndex: 1 });
    expect(engine.current.next).not.toHaveProperty('input');
  });
});
