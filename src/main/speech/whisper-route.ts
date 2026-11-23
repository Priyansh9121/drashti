import type { SpeechLanguage } from '../../shared/speech';
import { whisperModelFile, type CaptionRoute, type PackModel } from './caption-routes';
import type { SpeechEngine } from './hub';

/*
 * Route W (cap-integration): a Gujarati, Hindi or English whisper.cpp model from the offline pack, run by Drashti's own
 * whisper engine (whisper-engine.ts) exactly as today's captions run theirs. The file must be one Drashti knows by its
 * SHA-256 (cap-whisper's list). The pack holds the model while it is heard (it is checked again when first used
 * and cannot be removed under the engine); a model the pack no longer has, or one changed since, is never loaded.
 * The hold is given back only once whisper-server has exited after a stop (alpha.23), as Route C's is: Windows cannot
 * remove a file a program still has open.
 */

/** What Route W needs of the pack's store (cap-pack's ModelPackStore). */
export interface WhisperRouteStore {
  acquire(id: string, signal?: AbortSignal): Promise<{ model: PackModel; release(): void } | null>;
}

/** How a known model file is decoded. */
export interface WhisperModelUse {
  fallback: boolean;
  timestamps: boolean;
}

export interface WhisperRouteOptions {
  store: WhisperRouteStore;
  /**
   * Whether Drashti knows this file (cap-whisper's list), and how it is decoded: whisper's warmer retry or not, with
   * timestamps or not (the tuned models were trained without them).
   */
  known(sha256: string): WhisperModelUse | null;
  /**
   * Drashti's whisper engine on this file (index.ts: createWhisperEngine with the stream's sound and the timing). It
   * calls `exited` once after its stop, when its program has exited (at once when none runs), never before the stop.
   */
  engine(file: string, use: WhisperModelUse, exited: () => void): SpeechEngine;
}

const UNCHECKED =
  'The model pack’s captions model could not be checked again: import the pack again (Help › Caption and Translation Models…).';

export function createWhisperRoute(o: WhisperRouteOptions): CaptionRoute {
  const knows = (sha256: string): boolean => o.known(sha256) !== null;
  return {
    id: 'whisper',
    make(model: PackModel, _language: SpeechLanguage): SpeechEngine | null {
      if (whisperModelFile(model, knows) === null) return null;
      return {
        start(language, to) {
          let stopped = false;
          let stopEngine: (() => void) | null = null;
          let hold: { release(): void } | null = null;
          const abort = new AbortController();
          to.state({ phase: 'starting' });
          void o.store
            .acquire(model.id, abort.signal)
            .catch(() => null)
            .then((held) => {
              if (stopped) {
                held?.release();
                return;
              }
              const file = held ? whisperModelFile(held.model, knows) : null;
              const sha = held?.model.files[0]?.sha256;
              const known = sha ? o.known(sha) : null;
              if (!held || file === null || known === null) {
                held?.release();
                to.state({ phase: 'failed', message: UNCHECKED });
                return;
              }
              hold = held;
              // Given back once, when the engine's program has gone after the stop below.
              const giveBack = (): void => {
                const was = hold;
                hold = null;
                was?.release();
              };
              stopEngine = o.engine(file, known, giveBack).start(language, to);
            });
          return () => {
            stopped = true;
            abort.abort();
            const stop = stopEngine;
            stopEngine = null;
            stop?.();
          };
        },
      };
    },
  };
}
