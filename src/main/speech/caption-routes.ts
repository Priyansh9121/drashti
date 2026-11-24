import type { SpeechLanguage } from '../../shared/speech';
import type { SpeechEngine } from './hub';

/*
 * Caption AI's recognizers (cap-integration): each route makes one from a model in the offline pack, the same way.
 * Route W runs a Gujarati, Hindi or English model on Drashti's own whisper.cpp; Route C runs AI4Bharat's
 * IndicConformer on ONNX Runtime (Codex x94). Which routes ship, and in which order, is decided by the real-speech
 * accuracy numbers (cap-eval); a route not proven is not in the list, so it never runs.
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
  /**
   * A recognizer for this model in this language, or null only when this route does not run models like it (another
   * format, a file missing, not known). A route that runs it but cannot on this computer (too old a Mac) returns a
   * recognizer that says so plainly when started: never a quiet switch to another route.
   */
  make(model: PackModel, language: SpeechLanguage): SpeechEngine | null;
}

/** What caption AI listens with for one language: the route, the pack model and the recognizer it made. */
export interface CaptionRecognizer {
  route: string;
  modelId: string;
  engine: SpeechEngine;
}

/** The pack's purpose for a language's captions (cap-pack's captions-gu, -hi, -en), or null. */
export function captionPurpose(language: SpeechLanguage): `captions-${'gu' | 'hi' | 'en'}` | null {
  return language === 'gu' || language === 'hi' || language === 'en' ? `captions-${language}` : null;
}

/** The recognizer of the first route (in the order given: the routes that ship, best first) that runs a model. */
export function chooseRecognizer(
  models: readonly PackModel[],
  language: SpeechLanguage,
  routes: readonly CaptionRoute[],
): CaptionRecognizer | null {
  for (const route of routes)
    for (const model of models) {
      const engine = route.make(model, language);
      if (engine) return { route: route.id, modelId: model.id, engine };
    }
  return null;
}

/** Route W's file: the model's one whisper.cpp file, when Drashti knows it by its SHA-256 (cap-whisper's list). */
export function whisperModelFile(model: PackModel, known: (sha256: string) => boolean): string | null {
  const [file, ...more] = model.files;
  return model.format === 'whisper-ggml' && file && more.length === 0 && known(file.sha256)
    ? file.path
    : null;
}

/** What caption AI needs to hear a language with a model of its own (cap-whisper's, added and checked). */
export interface OwnModelCaptionAiOptions {
  /** The speaker's language now (the library's captions settings). */
  language(): SpeechLanguage | 'auto';
  /** That language's own model, chosen on this computer and checked (CaptionsService.languageModelFor), or null. */
  ownModel(language: SpeechLanguage | 'auto'): { id: string; format?: string } | null;
  /** The recognizer for that model (Route W on the pack's file, held while heard), or null when it cannot be had. */
  engineFor(model: { id: string }): SpeechEngine | null;
}

/**
 * Caption AI on for the speaker's language when it has a model of its own (Route W on Drashti's whisper engine);
 * "as heard", Sanskrit and a language without one keep today's captions.
 */
export function ownModelCaptionAi(o: OwnModelCaptionAiOptions): {
  on(): boolean;
  route(language: SpeechLanguage): string | null;
  recognizer(language: SpeechLanguage): CaptionRecognizer | null;
} {
  // Route C's IndicConformer or Route W's whisper.cpp, as the model's format says (for the dialog, never words).
  const routeOf = (own: { format?: string }): string =>
    own.format === 'indicconformer-ctc-onnx-v1' ? 'conformer' : 'whisper';
  return {
    on: () => {
      const language = o.language();
      return language !== 'auto' && o.ownModel(language) !== null;
    },
    // The route a language's own model runs on, without making its engine (alpha.23: Route C needs no whisper-server).
    route: (language) => {
      const own = o.ownModel(language);
      return own ? routeOf(own) : null;
    },
    recognizer: (language) => {
      const own = o.ownModel(language);
      const engine = own ? o.engineFor(own) : null;
      if (!own || !engine) return null;
      return { route: routeOf(own), modelId: own.id, engine };
    },
  };
}
