import { describe, expect, it } from 'vitest';
import type { SpeechEngine } from './hub';
import {
  captionPurpose,
  chooseRecognizer,
  ownModelCaptionAi,
  whisperModelFile,
  type CaptionRoute,
  type PackModel,
} from './caption-routes';

/* Caption AI's routes plug in the same way (cap-integration): placeholder model ids, paths and hashes only. */

const KNOWN = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const whisper = (id: string, sha256 = KNOWN, files = 1): PackModel => ({
  id,
  format: 'whisper-ggml',
  files: Array.from({ length: files }, (_, n) => ({
    name: `captions/${id}/${String(n)}.bin`,
    path: `/placeholder/${id}/${String(n)}.bin`,
    sha256,
  })),
});
const conformer = (id: string): PackModel => ({
  id,
  format: 'indicconformer-ctc-onnx-v1',
  files: [{ name: `captions/${id}/model.onnx`, path: `/placeholder/${id}/model.onnx`, sha256: KNOWN }],
});
const engine = (name: string): SpeechEngine & { name: string } => ({ name, start: () => () => undefined });

/** A route that runs models of one format, recording what it was asked. */
function route(id: string, format: string, asked: string[]): CaptionRoute {
  return {
    id,
    make: (model, language) => {
      asked.push(`${id}:${model.id}:${language}`);
      return model.format === format ? engine(`${id}-${model.id}`) : null;
    },
  };
}

describe('caption AI routes', () => {
  it('the pack’s purpose for a language: Gujarati, Hindi and English; Sanskrit has none', () => {
    expect(captionPurpose('gu')).toBe('captions-gu');
    expect(captionPurpose('hi')).toBe('captions-hi');
    expect(captionPurpose('en')).toBe('captions-en');
    expect(captionPurpose('sa')).toBeNull();
  });

  it('the first route in the order given that runs one of the models wins, whatever the pack’s order', () => {
    const asked: string[] = [];
    const conformerRoute = route('conformer', 'indicconformer-ctc-onnx-v1', asked);
    const whisperRoute = route('whisper', 'whisper-ggml', asked);
    const routes = [conformerRoute, whisperRoute];
    const chosen = chooseRecognizer([whisper('gu-small'), conformer('gu-conformer')], 'gu', routes);
    expect(chosen).toMatchObject({ route: 'conformer', modelId: 'gu-conformer' });
    expect((chosen?.engine as { name?: string } | undefined)?.name).toBe('conformer-gu-conformer');
    expect(asked).toEqual(['conformer:gu-small:gu', 'conformer:gu-conformer:gu']);
    // Route C not shipped (not proven): the same pack runs on Route W.
    expect(
      chooseRecognizer([whisper('gu-small'), conformer('gu-conformer')], 'gu', [whisperRoute]),
    ).toMatchObject({
      route: 'whisper',
      modelId: 'gu-small',
    });
    expect(chooseRecognizer([conformer('gu-conformer')], 'gu', [whisperRoute])).toBeNull();
    expect(chooseRecognizer([], 'gu', routes)).toBeNull();
  });

  it('Route W runs one whisper.cpp file Drashti knows by its SHA-256, nothing else', () => {
    const known = (sha: string) => sha === KNOWN;
    expect(whisperModelFile(whisper('gu-small'), known)).toBe('/placeholder/gu-small/0.bin');
    expect(whisperModelFile(whisper('unknown', OTHER), known)).toBeNull();
    expect(whisperModelFile(whisper('two-files', KNOWN, 2), known)).toBeNull();
    expect(whisperModelFile(conformer('gu-conformer'), known)).toBeNull();
  });

  it('a language with a model of its own (cap-whisper’s) is heard by caption AI; "as heard" and others keep today’s', () => {
    let language: 'gu' | 'hi' | 'auto' = 'gu';
    const whisperEngine = engine('whisper');
    const ai = ownModelCaptionAi({
      language: () => language,
      ownModel: (l) => (l === 'gu' ? { id: 'gu-own-placeholder' } : null),
      engine: whisperEngine,
    });
    expect(ai.on()).toBe(true);
    expect(ai.recognizer('gu')).toEqual({
      route: 'whisper',
      modelId: 'gu-own-placeholder',
      engine: whisperEngine,
    });
    expect(ai.recognizer('hi')).toBeNull();
    language = 'hi';
    expect(ai.on()).toBe(false);
    language = 'auto';
    expect(ai.on()).toBe(false);
  });
});
