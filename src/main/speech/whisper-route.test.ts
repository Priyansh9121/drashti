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

function setup(o: { held?: PackModel | null } = {}) {
  const ran: { file: string; fallback: boolean; language: string }[] = [];
  const released: string[] = [];
  let finish: (h: { model: PackModel; release(): void } | null) => void = () => undefined;
  const route = createWhisperRoute({
    store: {
      acquire: (id) =>
        new Promise((resolve) => {
          finish = resolve;
          void id;
        }),
    },
    known: (sha) => (sha === KNOWN ? { fallback: true } : null),
    engine: (file, fallback): SpeechEngine => ({
      start(language, to) {
        ran.push({ file, fallback, language });
        to.state({ phase: 'listening', language });
        return () => released.push('engine');
      },
    }),
  });
  const states: SpeechState[] = [];
  const to = { heard: (_h: Heard) => undefined, state: (s: SpeechState) => states.push(s) };
  const hold = (m: PackModel | null = o.held === undefined ? model() : o.held) =>
    finish(m ? { model: m, release: () => released.push('pack') } : null);
  return { route, ran, released, states, to, hold };
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
      { file: '/placeholder/pack/captions/gu/model.bin', fallback: true, language: 'gu' },
    ]);
    expect(t.states.at(-1)).toEqual({ phase: 'listening', language: 'gu' });
    stop?.();
    expect(t.released).toEqual(['engine', 'pack']);
  });

  it('a model the pack no longer has, or changed since, is never loaded: one plain reason', async () => {
    const t = setup({ held: null });
    t.route.make(model(), 'gu')?.start('gu', t.to);
    t.hold();
    await settle();
    expect(t.ran).toEqual([]);
    expect(t.states.at(-1)).toMatchObject({ phase: 'failed' });
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
