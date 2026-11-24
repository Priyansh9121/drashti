import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPTION_TIMING } from '../../shared/captions';
import type { SpeechState } from '../../shared/speech';
import { createWhisperEngine } from './whisper-engine';

/*
 * The whisper engine on a computer with two logical processors (cap-threads), as index.ts makes it: told nothing about
 * the computer, it asks Node (os.availableParallelism) itself. Node's answer is pretended here; no program runs.
 */

vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  return { ...os, availableParallelism: () => 2 };
});

describe('the whisper engine asks this computer for its logical processors (cap-threads)', () => {
  it('starts whisper-server with two threads on a two-processor computer when the dialog says 4', async () => {
    const spawned: string[][] = [];
    const states: SpeechState[] = [];
    const engine = createWhisperEngine({
      program: () => '/placeholder/whisper-server',
      model: () => '/placeholder/model.bin',
      fallback: () => true,
      timing: () => ({ ...DEFAULT_CAPTION_TIMING, threads: 4 }),
      sound: { open: () => null },
      log: { info: () => undefined, warn: () => undefined },
      spawn: (_program, args) => {
        spawned.push(args);
        const child = new EventEmitter() as ChildProcess & EventEmitter;
        Object.assign(child, { pid: undefined, exitCode: null, kill: () => true });
        return child;
      },
      // Never ready: the test needs only how it was started.
      fetch: () => Promise.reject(new Error('not listening')),
    });
    const stop = engine.start('en', { heard: () => undefined, state: (s) => states.push(s) });
    try {
      await vi.waitFor(() => {
        expect(spawned.length).toBe(1);
      });
      const args = spawned[0] ?? [];
      expect(args[args.indexOf('-t') + 1]).toBe('2');
    } finally {
      stop();
    }
  });
});
