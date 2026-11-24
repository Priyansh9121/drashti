import type { LanguageModelStore } from './captions-service';
import type { LanguageModelCheck, LanguageModelEntry } from './language-models';

/*
 * A language's own captions model comes one way only: in the offline model pack (the lead's Q-CAPI-2 A, 24 Nov).
 * Drashti still knows each model by its SHA-256 (cap-whisper's list); the pack (cap-pack) checked every file when it
 * was imported and checks it again when it is first used. No file is added any other way.
 */

/** A model's file in the pack: its name in the pack, where it is, and what it was checked to be. */
interface PackFile {
  name?: string;
  path: string;
  bytes: number;
  sha256: string;
}

/** What this needs of the pack's store (src/main/model-packs/store.ts). */
export interface CaptionPackFiles {
  forPurpose(purpose: `captions-${'gu' | 'hi' | 'en'}`): readonly {
    id: string;
    format: string;
    files: readonly PackFile[];
  }[];
  acquire(id: string, signal?: AbortSignal): Promise<{ release(): void } | null>;
}

const baseName = (name: string): string => name.replaceAll('\\', '/').split('/').at(-1) ?? '';

/**
 * A Route C model is the known one only as exactly its own files, each where IndicConformer's helper reads it:
 * the known model.onnx, and the tokens and front-end files the entry pins, by name, size and SHA-256 (review M2).
 */
function conformerFile(files: readonly PackFile[], entry: LanguageModelEntry): string | null {
  const pins = entry.companions ?? [];
  if (pins.length === 0) return null;
  const wanted = [{ name: 'model.onnx', bytes: entry.bytes, sha256: entry.sha256 }, ...pins];
  if (files.length !== wanted.length) return null;
  let model: string | null = null;
  for (const want of wanted) {
    const named = files.filter((f) => f.name !== undefined && baseName(f.name) === want.name);
    const [only] = named;
    if (named.length !== 1 || only?.sha256 !== want.sha256 || only.bytes !== want.bytes) return null;
    model ??= only.path;
  }
  return model;
}

/** The pack's model and file for a known entry, or null. */
export function packFileFor(
  pack: CaptionPackFiles,
  entry: LanguageModelEntry,
): { modelId: string; path: string } | null {
  for (const model of pack.forPurpose(`captions-${entry.language}`)) {
    if (model.format !== (entry.format ?? 'whisper-ggml')) continue;
    if (entry.format === 'indicconformer-ctc-onnx-v1') {
      const path = conformerFile(model.files, entry);
      if (path) return { modelId: model.id, path };
      continue;
    }
    const file = model.files.find((f) => f.sha256 === entry.sha256 && f.bytes === entry.bytes);
    if (file) return { modelId: model.id, path: file.path };
  }
  return null;
}

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
  };
}
