import type { LanguageModelStore } from './captions-service';
import type { LanguageModelCheck, LanguageModelEntry } from './language-models';

/* A language's own captions model from the offline model pack only (the lead's Q-CAPI-2 A). Red: not built yet. */

export interface CaptionPackFiles {
  forPurpose(purpose: `captions-${'gu' | 'hi' | 'en'}`): readonly {
    id: string;
    format: string;
    files: readonly { path: string; bytes: number; sha256: string }[];
  }[];
  acquire(id: string, signal?: AbortSignal): Promise<{ release(): void } | null>;
}

export function packFileFor(
  _pack: CaptionPackFiles,
  _entry: LanguageModelEntry,
): { modelId: string; path: string } | null {
  return null;
}

export const ADD_REFUSED =
  'A captions model comes with the model pack: import the pack with Help › Caption and Translation Models….';

export function packLanguageModelStore(
  known: readonly LanguageModelEntry[],
  _pack: CaptionPackFiles,
): LanguageModelStore {
  return {
    known: () => known,
    check: (): LanguageModelCheck => 'missing',
    verify: (): Promise<LanguageModelCheck> => Promise.resolve('missing'),
    add: () => Promise.reject(new Error('not built yet')),
  };
}
