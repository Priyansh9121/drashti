import type { SpeechLanguage } from '../../shared/speech';
import type { SpeechEngine } from './hub';
import { createIndicEngine, type IndicEngineOptions } from './indic-engine';
import { routeCFiles, type IndicPack } from './indic-protocol';

/** Structural subset of cap-pack's store; never imports another worker's unpublished implementation. */
export interface CheckedIndicPack extends IndicPack {
  files: readonly { name: string; path: string; sha256: string }[];
}
export interface IndicRouteStore {
  model(id: string): CheckedIndicPack | null;
  acquire(id: string, signal?: AbortSignal): Promise<{ model: CheckedIndicPack; release(): void } | null>;
}
function identity(pack: CheckedIndicPack | null): string | null {
  if (!pack || pack.files.some((file) => !/^[a-f0-9]{64}$/u.test(file.sha256))) return null;
  return JSON.stringify({
    format: pack.format,
    purposes: [...pack.purposes].sort(),
    files: pack.files
      .map((file) => [file.name, file.sha256])
      .sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? '')),
  });
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
      const selected = store.model(model.id);
      const expected = identity(selected);
      if (!expected || !routeCFiles(selected, language)) return null;
      return createIndicEngine({
        ...engine,
        acquire: async (chosen, signal) => {
          const held = await store.acquire(model.id, signal);
          if (!held) return null;
          const files = routeCFiles(held.model, chosen);
          if (!files || identity(held.model) !== expected) {
            held.release();
            return null;
          }
          return { files, release: () => held.release() };
        },
      });
    },
  };
}
