import type { SpeechLanguage } from '../../shared/speech';
import type { SpeechEngine } from './hub';
import { createIndicEngine, type IndicEngineOptions } from './indic-engine';
import { routeCFiles, type IndicPack } from './indic-protocol';

/** Structural subset of cap-pack's store; never imports another worker's unpublished implementation. */
export interface IndicRouteStore {
  model(id: string): IndicPack | null;
  acquire(id: string, signal?: AbortSignal): Promise<{ model: IndicPack; release(): void } | null>;
}
/** Matches cap-integration's CaptionRoute, whose PackModel reference includes id but hides purpose metadata. */
export interface IndicRoute {
  id: string;
  make(model: { id: string }, language: SpeechLanguage): SpeechEngine | null;
}

export function createIndicRoute(
  options: Omit<IndicEngineOptions, 'acquire'> & { store: IndicRouteStore },
): IndicRoute {
  const { store, ...engine } = options;
  return {
    id: 'conformer',
    make(model, language) {
      // This is metadata only. The authoritative store rechecks hashes asynchronously at actual start.
      if (!routeCFiles(store.model(model.id), language)) return null;
      return createIndicEngine({
        ...engine,
        acquire: async (chosen, signal) => {
          const held = await store.acquire(model.id, signal);
          if (!held) return null;
          const files = routeCFiles(held.model, chosen);
          if (!files) {
            held.release();
            return null;
          }
          return { files, release: () => held.release() };
        },
      });
    },
  };
}
