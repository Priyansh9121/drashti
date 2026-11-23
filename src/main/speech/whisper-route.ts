import type { SpeechLanguage } from '../../shared/speech';
import { whisperModelFile, type CaptionRoute, type PackModel } from './caption-routes';
import type { SpeechEngine } from './hub';

/*
 * Route W (cap-integration): a Gujarati, Hindi or English whisper.cpp model from the offline pack, run by Drashti's own
 * whisper engine (whisper-engine.ts) exactly as today's captions run theirs. The file must be one Drashti knows by its
 * SHA-256 (cap-whisper's list). The pack holds the model while it is heard (it is checked again when first used
 * and cannot be removed under the engine); a model the pack no longer has, or one changed since, is never loaded.
 */

/** What Route W needs of the pack's store (cap-pack's ModelPackStore). */
export interface WhisperRouteStore {
  acquire(id: string, signal?: AbortSignal): Promise<{ model: PackModel; release(): void } | null>;
}

export interface WhisperRouteOptions {
  store: WhisperRouteStore;
  /** Whether Drashti knows this file (cap-whisper's list), and whether whisper's warmer retry suits it. */
  known(sha256: string): { fallback: boolean } | null;
  /** Drashti's whisper engine on this file (index.ts: createWhisperEngine with the stream's sound and the timing). */
  engine(file: string, fallback: boolean): SpeechEngine;
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
              stopEngine = o.engine(file, known.fallback).start(language, to);
            });
          return () => {
            stopped = true;
            abort.abort();
            stopEngine?.();
            stopEngine = null;
            hold?.release();
            hold = null;
          };
        },
      };
    },
  };
}
