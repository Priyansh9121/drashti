import type { SpeechLanguage } from '../../shared/speech';
import type { CaptionPackModel } from './captions-service';

/* Which file caption AI's recognizer runs with (cap-integration). Red: not built yet. */

export interface PackModelFiles {
  id: string;
  format: string;
  files: readonly { path: string; sha256: string }[];
}

export const WHISPER_FORMAT = 'whisper-ggml';

export function captionPurpose(_language: SpeechLanguage): `captions-${'gu' | 'hi' | 'en'}` | null {
  return null;
}

export function packCaptionModel(
  _models: readonly PackModelFiles[],
  _known: (sha256: string) => boolean,
): CaptionPackModel | null {
  return null;
}
