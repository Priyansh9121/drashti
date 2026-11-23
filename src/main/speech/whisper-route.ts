import type { SpeechLanguage } from '../../shared/speech';
import type { CaptionRoute, PackModel } from './caption-routes';
import type { SpeechEngine } from './hub';

/* Route W from the offline pack (cap-integration). Red: not built yet. */

export interface WhisperRouteStore {
  acquire(id: string, signal?: AbortSignal): Promise<{ model: PackModel; release(): void } | null>;
}

export interface WhisperRouteOptions {
  store: WhisperRouteStore;
  known(sha256: string): { fallback: boolean } | null;
  engine(file: string, fallback: boolean): SpeechEngine;
}

export function createWhisperRoute(_o: WhisperRouteOptions): CaptionRoute {
  return { id: 'whisper', make: (_model: PackModel, _language: SpeechLanguage) => null };
}
