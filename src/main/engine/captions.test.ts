import { describe, expect, it } from 'vitest';
import type { CaptionsShown } from '../../shared/captions';
import { withoutCaptions, stateWithoutCaptions } from '../../shared/engine/captions-filter';
import type { EngineMessage } from '../../shared/engine/protocol';
import { ENGINE_STATE_VERSION, readsEngineVersion } from '../../shared/engine/state';
import { savedFrom } from '../recovery/live-state';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport } from './testing';

/*
 * Live captions in the engine's state (Session 55, Part 10, engine state 26): only the main process sets them, as
 * bookkeeping (never a change Back, Put it back or Oops would undo), and they never reach a phone or a node.
 * Placeholder words only.
 */

const CAPTIONS: CaptionsShown = {
  lines: ['alpha beta gamma', 'delta epsilon'],
  language: 'en',
  audience: false,
  size: 'medium',
  place: 'bottom',
};

function setup() {
  const transport = new RecordingTransport();
  let clock = 1000;
  const engine = new ShowEngine(makeSource(), transport, () => (clock += 10));
  return { engine, transport };
}

describe('live captions in the engine’s state (engine state 26)', () => {
  it('is engine 27, which retains captions (26), Part 17b (25) and every supported older state whole', () => {
    expect(ENGINE_STATE_VERSION).toBe(27);
    for (const v of [27, 26, 25, 24, 23, 22, 20, 18, 17, 16, 15, 14, 13, 12])
      expect(readsEngineVersion(v), String(v)).toBe(true);
    for (const v of [11, 19, 21, 28, '26', null]) expect(readsEngineVersion(v), String(v)).toBe(false);
  });

  it('are set by the main process alone; the same again is no change; null takes them off', () => {
    const { engine, transport } = setup();
    expect(engine.current.captions ?? null).toBeNull();
    const sent = transport.messages.length;
    expect(engine.setCaptions(CAPTIONS)).toMatchObject({ ok: true, changed: true });
    expect(engine.current.captions).toEqual(CAPTIONS);
    expect(transport.messages.length).toBe(sent + 1);
    expect(engine.setCaptions({ ...CAPTIONS, lines: [...CAPTIONS.lines] })).toMatchObject({ changed: false });
    expect(engine.setCaptions(null)).toMatchObject({ ok: true, changed: true });
    expect(engine.current.captions ?? null).toBeNull();
  });

  it('are never a change to the show: the layers stay, and Put it back has nothing new to put back', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    const layers = engine.current.layers;
    const canPutBack = engine.current.canPutBack;
    engine.setCaptions(CAPTIONS);
    engine.setCaptions({ ...CAPTIONS, lines: ['zeta'] });
    expect(engine.current.layers).toBe(layers);
    expect(engine.current.canPutBack).toBe(canPutBack);
    expect(engine.current.live.slideIndex).toBe(0);
  });

  it('do not swallow a phone’s Next: one sent with the revision it saw before the captions changed still goes', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    const seen = engine.rev;
    engine.setCaptions(CAPTIONS);
    engine.setCaptions({ ...CAPTIONS, lines: ['zeta eta'] });
    expect(engine.rev).toBeGreaterThan(seen);
    expect(engine.dispatch({ type: 'next', rev: seen })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.live.slideIndex).toBe(1);
    // The show moved since: a second Next with the same revision does nothing, captions or not.
    engine.setCaptions(null);
    expect(engine.dispatch({ type: 'next', rev: seen })).toMatchObject({ changed: false });
    expect(engine.current.live.slideIndex).toBe(1);
    // A revision from the future is still refused.
    expect(engine.dispatch({ type: 'next', rev: engine.rev + 1 })).toMatchObject({ changed: false });
  });

  it('spare the main process: its listeners (the recovery file and the rest) hear only changes to the show', () => {
    const { engine } = setup();
    const heard: (string | null)[] = [];
    engine.onChange((state) => heard.push(state.captions?.lines.join(' ') ?? null));
    engine.setCaptions(CAPTIONS);
    engine.setCaptions({ ...CAPTIONS, lines: ['zeta'] });
    expect(heard).toEqual([]);
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    expect(heard).toEqual(['zeta']);
    // The recovery file never keeps them.
    expect(JSON.stringify(savedFrom(engine.current, 'placeholder-session'))).not.toContain('zeta');
  });

  it('never reach a phone or a node: snapshots, patches and the state they are given leave them out', () => {
    const { engine, transport } = setup();
    engine.setCaptions(CAPTIONS);
    const snapshot = engine.snapshot();
    expect(snapshot.state.captions).toEqual(CAPTIONS);
    const forPhones = withoutCaptions(snapshot);
    expect(forPhones.state.captions).toBeNull();
    expect(forPhones.rev).toBe(snapshot.rev);
    expect(JSON.stringify(forPhones)).not.toContain('alpha');
    // A patch keeps its revisions (a copy follows every one), with the captions' op taken out.
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    engine.setCaptions({ ...CAPTIONS, lines: ['zeta eta'] });
    const patches = transport.messages.filter(
      (m): m is Extract<EngineMessage, { kind: 'patch' }> => m.kind === 'patch',
    );
    const last = patches.at(-1);
    expect(last?.ops.map((op) => op.path[0])).toEqual(['captions']);
    const filtered = last && withoutCaptions(last);
    expect(filtered).toMatchObject({ kind: 'patch', baseRev: last?.baseRev, rev: last?.rev, ops: [] });
    for (const message of transport.messages)
      expect(JSON.stringify(withoutCaptions(message))).not.toMatch(/alpha|zeta/);
    // The state the API and the nodes read.
    expect(stateWithoutCaptions(engine.current).captions).toBeNull();
    expect(stateWithoutCaptions(engine.current).layers).toBe(engine.current.layers);
  });
});
