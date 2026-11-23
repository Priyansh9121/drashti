import { describe, expect, it } from 'vitest';
import { engineCommandSchema } from '../../shared/engine/commands';
import type { EngineState } from '../../shared/engine/state';
import { simpleModeRefuses } from '../../shared/mode';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport } from './testing';
const command = (hidden: boolean) => engineCommandSchema.parse({ type: 'setTranslationHidden', hidden });
const hidden = (state: EngineState) =>
  (state as EngineState & { translationHidden?: boolean }).translationHidden === true;

describe('Pro Mode Hide translation', () => {
  it('hides and restores only translations at once, with Oops and without changing source layers or Next', () => {
    const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => 1000);
    expect(engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 }).ok).toBe(true);
    const before = engine.current;
    expect(engine.dispatch(command(true)).ok).toBe(true);
    expect(hidden(engine.current)).toBe(true);
    expect(engine.current.layers).toBe(before.layers);
    expect(engine.current.live).toBe(before.live);
    expect(engine.current.next).toEqual(before.next);
    expect(engine.dispatch({ type: 'oops' }).ok).toBe(true);
    expect(hidden(engine.current)).toBe(false);
    expect(engine.current.layers).toBe(before.layers);
    expect(engine.dispatch(command(true)).ok).toBe(true);
    expect(engine.dispatch(command(false)).ok).toBe(true);
    expect(hidden(engine.current)).toBe(false);
  });
  it('refuses hide or restore in Simple Mode through the same Main command guard', () => {
    const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => 1000, undefined, {
      refuse: (value) => (simpleModeRefuses(value, null) ? 'Use Pro Mode.' : null),
    });
    expect(engine.dispatch(command(true)).ok).toBe(false);
    expect(engine.dispatch(command(false)).ok).toBe(false);
    expect(hidden(engine.current)).toBe(false);
  });
});
