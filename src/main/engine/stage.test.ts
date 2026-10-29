import { describe, expect, it } from 'vitest';
import { ENGINE_STATE_VERSION, readsEngineVersion } from '../../shared/engine/state';
import { SIMPLE_MODE_REFUSAL, SIMPLE_MODE_REFUSED_COMMANDS } from '../../shared/mode';
import { newStageBox, type StageLayout } from '../../shared/stage-layouts';
import { INPUT_FADE_MS, type VideoInput } from '../../shared/video-inputs';
import { NO_PLAYLISTS } from './playlist-source';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport } from './testing';

/*
 * The stage screens in the engine's state (Session 55): the one layout chosen for every stage screen, Stage off (the
 * stage screens then show exactly the audience picture) and the chosen video input, which every stage screen, node
 * and tablet reads from the state; and the chosen video input put up on the audience in one press, and taken off
 * again with what was there before coming back. Placeholder names only.
 */

const INPUT: VideoInput = { id: 'in-1', name: 'Input 1', device: 'Placeholder capture', fit: 'fit' };

const LAYOUT: StageLayout = {
  id: 'placeholder-layout',
  name: 'Placeholder anchoring',
  background: '#000000',
  boxes: [newStageBox('videoInput', 'input'), newStageBox('clock', 'clock')],
};

function show() {
  const transport = new RecordingTransport();
  let clock = 1000;
  let simple = false;
  const list: VideoInput[] = [INPUT];
  const engine = new ShowEngine(makeSource(), transport, () => (clock += 10), NO_PLAYLISTS, {
    videoInput: (id) => list.find((i) => i.id === id) ?? null,
    refuse: (c) => (simple && SIMPLE_MODE_REFUSED_COMMANDS.includes(c.type) ? SIMPLE_MODE_REFUSAL : null),
  });
  return {
    engine,
    transport,
    list,
    simple: (on: boolean) => {
      simple = on;
    },
  };
}

describe('the stage screens in the engine’s state (Session 55)', () => {
  it('start with the Standard stage screen, Stage on and no video input', () => {
    const { engine } = show();
    expect(engine.current.stage).toEqual({ layout: null });
  });

  it('take the chosen layout, Stage off and the chosen video input, each on its own, the rest kept', () => {
    const { engine, transport } = show();
    const sent = transport.messages.length;
    engine.setStage({ layout: LAYOUT });
    expect(engine.current.stage).toEqual({ layout: LAYOUT });
    expect(transport.messages.length).toBe(sent + 1);
    engine.setStage({ off: true });
    expect(engine.current.stage).toEqual({ layout: LAYOUT, off: true });
    engine.setStage({ input: { inputId: INPUT.id, name: INPUT.name, device: INPUT.device, fit: INPUT.fit } });
    expect(engine.current.stage).toEqual({
      layout: LAYOUT,
      off: true,
      input: { inputId: 'in-1', name: 'Input 1', device: 'Placeholder capture', fit: 'fit' },
    });
    // On again, and no input: left out, as a state saved before keeps none.
    engine.setStage({ off: false, input: null });
    expect(engine.current.stage).toEqual({ layout: LAYOUT });
    // The same again sends nothing.
    const now = transport.messages.length;
    engine.setStage({ layout: { ...LAYOUT } });
    expect(transport.messages.length).toBe(now);
    engine.setStage({ layout: null });
    expect(engine.current.stage).toEqual({ layout: null });
  });

  it('change nothing on the audience: no layer, nothing Back or Put it back would undo', () => {
    const { engine } = show();
    engine.dispatch({ type: 'setBackground', background: { kind: 'color', color: '#123456' } });
    const layers = engine.current.layers;
    engine.setStage({ layout: LAYOUT, off: true });
    expect(engine.current.layers).toBe(layers);
    expect(engine.current.blackout).toBe(false);
  });

  it('is engine 20 (Session 55, Part 5: a picture’s crop, turn and blurred fill; 16, Part 12: the Wallpaper); a state saved with the wallpaper (16), the stage (15), by alpha.13 (14), alpha.12 (13) or alpha.11 (12) is read whole', () => {
    expect(ENGINE_STATE_VERSION).toBe(20);
    for (const v of [20, 16, 15, 14, 13, 12]) expect(readsEngineVersion(v), String(v)).toBe(true);
    for (const v of [11, 17, '16', null]) expect(readsEngineVersion(v), String(v)).toBe(false);
  });
});

describe('the chosen video input on the audience in one press (Session 55)', () => {
  it('goes up as the background, dissolving in, the stage left as it is', () => {
    const { engine } = show();
    engine.setStage({ layout: LAYOUT });
    const stage = engine.current.stage;
    expect(engine.dispatch({ type: 'toggleInput', inputId: INPUT.id })).toMatchObject({ ok: true });
    const bg = engine.current.layers.background;
    expect(bg).toMatchObject({ kind: 'input', inputId: 'in-1', name: 'Input 1', fit: 'fit' });
    expect(bg?.kind === 'input' ? bg.fade?.durationMs : null).toBe(INPUT_FADE_MS);
    // The stage never follows it: its own layout, as it was.
    expect(engine.current.stage).toBe(stage);
  });

  it('pressed again, comes off, and the background that was there before comes back, dissolving in', () => {
    const { engine } = show();
    engine.dispatch({ type: 'setBackground', background: { kind: 'color', color: '#123456' } });
    engine.dispatch({ type: 'toggleInput', inputId: INPUT.id });
    expect(engine.current.layers.background?.kind).toBe('input');
    expect(engine.dispatch({ type: 'toggleInput', inputId: INPUT.id })).toMatchObject({ ok: true });
    expect(engine.current.layers.background).toMatchObject({ kind: 'color', color: '#123456' });
  });

  it('pressed again with nothing there before, comes off: the background is empty', () => {
    const { engine } = show();
    engine.dispatch({ type: 'toggleInput', inputId: INPUT.id });
    engine.dispatch({ type: 'toggleInput', inputId: INPUT.id });
    expect(engine.current.layers.background).toBeNull();
  });

  it('put up some other way, it still comes off in one press; what was before is not guessed', () => {
    const { engine } = show();
    engine.dispatch({ type: 'setBackground', background: { kind: 'color', color: '#123456' } });
    engine.dispatch({ type: 'showInput', inputId: INPUT.id });
    engine.dispatch({ type: 'toggleInput', inputId: INPUT.id });
    expect(engine.current.layers.background).toBeNull();
    // Up by the button, then replaced by something else: the button puts the input up again.
    engine.dispatch({ type: 'toggleInput', inputId: INPUT.id });
    engine.dispatch({ type: 'setBackground', background: { kind: 'color', color: '#654321' } });
    engine.dispatch({ type: 'toggleInput', inputId: INPUT.id });
    expect(engine.current.layers.background).toMatchObject({ kind: 'input', inputId: 'in-1' });
    // And off again: the colour that replaced it comes back.
    engine.dispatch({ type: 'toggleInput', inputId: INPUT.id });
    expect(engine.current.layers.background).toMatchObject({ kind: 'color', color: '#654321' });
  });

  it('is refused for an input this computer does not have, and in Simple Mode', () => {
    const t = show();
    expect(t.engine.dispatch({ type: 'toggleInput', inputId: 'in-9' })).toMatchObject({
      ok: false,
      error: 'unknown-input',
    });
    expect(t.engine.current.layers.background).toBeNull();
    t.simple(true);
    expect(t.engine.dispatch({ type: 'toggleInput', inputId: INPUT.id })).toMatchObject({ ok: false });
    expect(SIMPLE_MODE_REFUSED_COMMANDS).toContain('toggleInput');
  });
});
