import type { SpeechLanguage } from '../../shared/speech';
import type { SpeechEngine } from './hub';

/*
 * Caption AI's recognizers (cap-integration): each route makes one from a model in the offline pack, the same way.
 * Route W runs a Gujarati, Hindi or English model on Drashti's own whisper.cpp; Route C runs AI4Bharat's
 * IndicConformer on ONNX Runtime (Codex x94). Red: not built yet.
 */

/** What a route needs of a pack's model (cap-pack's PackedModel): its id, its format and its checked files. */
export interface PackModel {
  id: string;
  format: string;
  files: readonly { name: string; path: string; sha256: string }[];
}

/** One way to recognise speech from a pack model. */
export interface CaptionRoute {
  /** For the dialog and the log (never words): 'whisper' (Route W) or 'conformer' (Route C). */
  id: string;
  /** A recognizer for this model in this language, or null when this route cannot run it. */
  make(model: PackModel, language: SpeechLanguage): SpeechEngine | null;
}

/** What caption AI listens with for one language: the route, the pack model and the recognizer it made. */
export interface CaptionRecognizer {
  route: string;
  modelId: string;
  engine: SpeechEngine;
}

/** The pack's purpose for a language's captions (cap-pack's captions-gu, -hi, -en), or null. */
export function captionPurpose(_language: SpeechLanguage): `captions-${'gu' | 'hi' | 'en'}` | null {
  return null;
}

/** The recognizer of the first route (in the order given: the routes that ship, best first) that runs a model. */
export function chooseRecognizer(
  _models: readonly PackModel[],
  _language: SpeechLanguage,
  _routes: readonly CaptionRoute[],
): CaptionRecognizer | null {
  return null;
}

/** Route W's file: the model's one whisper.cpp file, when Drashti knows it by its SHA-256 (cap-whisper's list). */
export function whisperModelFile(_model: PackModel, _known: (sha256: string) => boolean): string | null {
  return null;
}
