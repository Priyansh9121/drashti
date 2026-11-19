import { describe, expect, it } from 'vitest';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport } from '../engine/testing';
import { runEngineCommand } from './engine-ipc';

describe('runEngineCommand', () => {
  const setup = () => new ShowEngine(makeSource(), new RecordingTransport());

  it('runs a valid command from an allowed window', () => {
    const engine = setup();
    expect(
      runEngineCommand(engine, { type: 'goLive', presentationId: 'p1', slideIndex: 0 }, true),
    ).toMatchObject({
      ok: true,
      changed: true,
    });
  });

  it('refuses windows that may not control the show', () => {
    const engine = setup();
    expect(runEngineCommand(engine, { type: 'toggleBlackout' }, false)).toMatchObject({
      ok: false,
      error: 'forbidden',
    });
    expect(engine.current.blackout).toBe(false);
  });

  it('refuses Main’s stale view when controller actions are enabled, in either press order', () => {
    const engine = setup();
    const seen = { session: engine.session, rev: engine.rev };
    engine.dispatch({ type: 'toggleWallpaper' });
    expect(runEngineCommand(engine, { type: 'toggleBlackout' }, true, seen)).toMatchObject({ ok: false });
    expect(engine.current.blackout).toBe(false);
    expect(
      runEngineCommand(engine, { type: 'toggleBlackout' }, true, { session: 'old-run', rev: engine.rev }),
    ).toMatchObject({ ok: false });
    expect(engine.current.blackout).toBe(false);
  });

  it('rejects malformed input', () => {
    const engine = setup();
    expect(runEngineCommand(engine, { type: 'goLive', presentationId: 'p1' }, true)).toMatchObject({
      ok: false,
      error: 'invalid-command',
    });
    expect(runEngineCommand(engine, '<script>', true)).toMatchObject({ ok: false, error: 'invalid-command' });
  });
});
