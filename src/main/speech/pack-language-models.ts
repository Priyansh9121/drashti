import type { LanguageModelStore } from './captions-service';
import { LanguageModelRefused, type LanguageModelCheck, type LanguageModelEntry } from './language-models';

/*
 * A language's own captions model comes one way only: in the offline model pack (the lead's Q-CAPI-2 A, 24 Nov).
 * Drashti still knows each model by its SHA-256 (cap-whisper's list); the pack (cap-pack) checked every file when it
 * was imported and checks it again when it is first used. No file is added any other way.
 */

/** What this needs of the pack's store (src/main/model-packs/store.ts). */
export interface CaptionPackFiles {
  forPurpose(purpose: `captions-${'gu' | 'hi' | 'en'}`): readonly {
    id: string;
    format: string;
    files: readonly { path: string; bytes: number; sha256: string }[];
  }[];
  acquire(id: string, signal?: AbortSignal): Promise<{ release(): void } | null>;
}

/** The pack's model and file for a known entry, or null. */
export function packFileFor(
  pack: CaptionPackFiles,
  entry: LanguageModelEntry,
): { modelId: string; path: string } | null {
  for (const model of pack.forPurpose(`captions-${entry.language}`)) {
    if (model.format !== 'whisper-ggml') continue;
    const file = model.files.find((f) => f.sha256 === entry.sha256 && f.bytes === entry.bytes);
    if (file) return { modelId: model.id, path: file.path };
  }
  return null;
}

export const ADD_REFUSED =
  'A captions model comes with the model pack: import the pack with Help › Caption and Translation Models….';

export function packLanguageModelStore(
  known: readonly LanguageModelEntry[],
  pack: CaptionPackFiles,
): LanguageModelStore {
  return {
    known: () => known,
    check: (entry): LanguageModelCheck => (packFileFor(pack, entry) ? 'ready' : 'missing'),
    verify: async (entry): Promise<LanguageModelCheck> => {
      const found = packFileFor(pack, entry);
      if (!found) return 'missing';
      const held = await pack.acquire(found.modelId);
      if (!held) return 'changed';
      held.release();
      return 'ready';
    },
    add: () => Promise.reject(new LanguageModelRefused(ADD_REFUSED)),
  };
}
