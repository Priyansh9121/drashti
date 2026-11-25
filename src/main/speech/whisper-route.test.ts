import { describe, expect, it } from 'vitest';
import type { Heard, SpeechState } from '../../shared/speech';
import type { PackModel } from './caption-routes';
import type { SpeechEngine } from './hub';
import { createWhisperRoute } from './whisper-route';

/* Route W from the pack (cap-integration): placeholder ids, paths and hashes; a stand-in engine, no program. */

const KNOWN = 'a'.repeat(64);
/** Every promise already settled has run its handlers. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const model = (sha256 = KNOWN): PackModel => ({
  id: 'gu-small-placeholder',
  format: 'whisper-ggml',
  files: [{ name: 'captions/gu/model.bin', path: '/placeholder/pack/captions/gu/model.bin', sha256 }],
});

function setup(o: { held?: PackModel | null; exitLater?: boolean } = {}) {
  const ran: { file: string; fallback: boolean; timestamps: boolean; language: string }[] = [];
  const released: string[] = [];
  // The engine's program going (alpha.23): at once when stopped, or when the test says (exitLater).
  const exits: (() => void)[] = [];
  let finish: (h: { model: PackModel; release(): void } | null) => void = () => undefined;
  const route = createWhisperRoute({
    store: {
      acquire: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
    known: (sha) => (sha === KNOWN ? { fallback: false, timestamps: false } : null),
    engine: (file, use, exited): SpeechEngine => ({
      start(language, to) {
        ran.push({ file, fallback: use.fallback, timestamps: use.timestamps, language });
        to.state({ phase: 'listening', language });
        return () => {
          released.push('engine');
          if (o.exitLater) exits.push(exited);
          else exited();
        };
      },
    }),
  });
  const states: SpeechState[] = [];
  const to = { heard: (_h: Heard) => undefined, state: (s: SpeechState) => states.push(s) };
  const hold = (m: PackModel | null = o.held === undefined ? model() : o.held) =>
    finish(m ? { model: m, release: () => released.push('pack') } : null);
  return { route, ran, released, states, to, hold, exits };
}

describe('Route W from the pack', () => {
  it('runs a known whisper.cpp file only, the pack holding it while heard', async () => {
    const t = setup();
    expect(t.route.make(model('b'.repeat(64)), 'gu')).toBeNull();
    const engine = t.route.make(model(), 'gu');
    expect(engine).not.toBeNull();
    const stop = engine?.start('gu', t.to);
    expect(t.states).toEqual([{ phase: 'starting' }]);
    t.hold();
    await settle();
    expect(t.ran).toEqual([
      { file: '/placeholder/pack/captions/gu/model.bin', fallback: false, timestamps: false, language: 'gu' },
    ]);
    expect(t.states.at(-1)).toEqual({ phase: 'listening', language: 'gu' });
    stop?.();
    expect(t.released).toEqual(['engine', 'pack']);
  });

  it('hands engine() the very object known() returned (QWC-1: index.ts marks the sized uses by that object)', async () => {
    const given: object[] = [];
    const engines: object[] = [];
    let finish: (h: { model: PackModel; release(): void } | null) => void = () => undefined;
    const route = createWhisperRoute({
      store: { acquire: () => new Promise((resolve) => (finish = resolve)) },
      known: (sha) => {
        if (sha !== KNOWN) return null;
        const use = { fallback: true, timestamps: false };
        given.push(use);
        return use;
      },
      engine: (_file, use): SpeechEngine => {
        engines.push(use);
        return { start: () => () => undefined };
      },
    });
    const stop = route.make(model(), 'gu')?.start('gu', { heard: () => undefined, state: () => undefined });
    finish({ model: model(), release: () => undefined });
    await settle();
    expect(engines).toHaveLength(1);
    expect(given).toContain(engines[0]);
    expect(engines[0]).toBe(given.at(-1));
    stop?.();
  });

  it('a model the pack no longer has, or changed since, is never loaded: one plain reason', async () => {
    const t = setup({ held: null });
    t.route.make(model(), 'gu')?.start('gu', t.to);
    t.hold();
    await settle();
    expect(t.ran).toEqual([]);
    expect(t.states.at(-1)).toMatchObject({ phase: 'failed' });
  });

  it('gives the pack back only once the engine’s program has exited (alpha.23: Windows cannot remove an open file)', async () => {
    const t = setup({ exitLater: true });
    const stop = t.route.make(model(), 'gu')?.start('gu', t.to);
    t.hold();
    await settle();
    expect(t.ran).toHaveLength(1);
    stop?.();
    // whisper-server told to go and still running: the pack still holds its file.
    expect(t.released).toEqual(['engine']);
    expect(t.exits).toHaveLength(1);
    for (const go of t.exits) go();
    expect(t.released).toEqual(['engine', 'pack']);
    for (const go of t.exits) go();
    expect(t.released).toEqual(['engine', 'pack']);
  });

  it('stopped before the pack answered: nothing starts and the hold is given back', async () => {
    const t = setup();
    const stop = t.route.make(model(), 'gu')?.start('gu', t.to);
    stop?.();
    t.hold();
    await settle();
    expect(t.ran).toEqual([]);
    expect(t.released).toEqual(['pack']);
  });
});
