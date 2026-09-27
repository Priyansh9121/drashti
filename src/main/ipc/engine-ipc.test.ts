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

  it('rejects malformed input', () => {
    const engine = setup();
    expect(runEngineCommand(engine, { type: 'goLive', presentationId: 'p1' }, true)).toMatchObject({
      ok: false,
      error: 'invalid-command',
    });
    expect(runEngineCommand(engine, '<script>', true)).toMatchObject({ ok: false, error: 'invalid-command' });
  });
});
