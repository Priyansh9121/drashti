import { describe, expect, it, vi } from 'vitest';
import { fakeHelper, type FakeChild } from '../testing/fake-translate-helper';
import {
  INDICTRANS2_FILES,
  INDICTRANS2_FORMAT,
  TranslationEngine,
  type TranslationModels,
} from './translation-engine';
import { TranslationHelper } from './translation-helper';

const log = { info: vi.fn(), warn: vi.fn() };
const model = (id: string, purposes: string[], format = INDICTRANS2_FORMAT, files = INDICTRANS2_FILES) => ({
  id,
  purposes,
  format,
  files: files.map((name) => ({ name: `${id}/${name}`, path: `/packs/p/${id}/${name}` })),
});

function models(
  list: ReturnType<typeof model>[],
  acquire: TranslationModels['acquire'] = () => Promise.resolve({ release: vi.fn() }),
) {
  return {
    forPurpose: (purpose: string) => list.filter((m) => m.purposes.includes(purpose)),
    acquire: vi.fn(acquire),
  };
}

/** A helper whose "model" answers each sentence with fixed tokens. */
function engineWith(
  store: ReturnType<typeof models>,
  answer: (text: string) => string[] = () => ['▁Placeholder', '▁words', '.', '</s>'],
  program: string | null = '/x/drashti-translate',
) {
  const children: FakeChild[] = [];
  const engine = new TranslationEngine({
    program: () => program,
    models: store,
    log,
    idleMs: 60_000,
    createHelper: (p) =>
      new TranslationHelper({
        program: p,
        log,
        lowerPriority: () => undefined,
        spawn: () => {
          const child = fakeHelper((r) =>
            r['op'] === 'translate'
              ? `{"id":${String(r['id'])},"ok":true,"tokens":${JSON.stringify(answer(String(r['text'])))}}`
              : `{"id":${String(r['id'])},"ok":true}`,
          );
          children.push(child);
          return child;
        },
      }),
  });
  return { engine, children };
}

describe('Prepare translations’ engine', () => {
  it('is off without the helper in this copy of Drashti, or without a pack’s model for the direction', () => {
    const store = models([model('en-indic', ['translation-en-gu', 'translation-en-hi'])]);
    expect(engineWith(store, undefined, null).engine.available('en', 'gu')).toBe(false);
    const { engine } = engineWith(store);
    expect(engine.available('en', 'gu')).toBe(true);
    expect(engine.available('gu', 'en')).toBe(false);
    expect(engine.available('en', 'en')).toBe(false);
    // Another format, or a model missing one of its files, is not this engine's.
    const other = engineWith(models([model('w', ['translation-en-gu'], 'whisper-ggml')])).engine;
    expect(other.available('en', 'gu')).toBe(false);
    const partial = engineWith(
      models([model('p', ['translation-en-gu'], INDICTRANS2_FORMAT, ['model.bin'])]),
    ).engine;
    expect(partial.available('en', 'gu')).toBe(false);
  });

  it('drafts each line on its own through the pack’s model, keeping empty lines, and holds the model while loaded', async () => {
    const store = models([model('en-indic', ['translation-en-gu'])]);
    const { engine, children } = engineWith(store, (text) => [`▁${text.split(' ')[0] ?? ''}`, '</s>']);
    await expect(engine.translate('Alpha one.\n\nBeta two.', 'en', 'gu')).resolves.toBe('Alpha\n\nBeta');
    const requests = children[0]?.requests ?? [];
    expect(requests[0]).toMatchObject({
      op: 'load',
      route: 'en-indic',
      model: '/packs/p/en-indic',
      spm: '/packs/p/en-indic/source.spm',
      threads: 2,
    });
    expect(requests.filter((r) => r['op'] === 'translate')).toHaveLength(2);
    // The careful search, as the reader's grades favoured into Gujarati; the tags of the direction.
    expect(requests[1]).toMatchObject({ src: 'eng_Latn', tgt: 'guj_Gujr', beam: 5, text: 'Alpha one .' });
    expect(store.acquire).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('refuses words holding a model marker, and a model the pack store no longer vouches for', async () => {
    const { engine } = engineWith(models([model('en-indic', ['translation-en-gu'])]));
    await expect(engine.translate('a </s> b', 'en', 'gu')).rejects.toMatchObject({ code: 'special-token' });
    const changed = engineWith(
      models([model('en-indic', ['translation-en-gu'])], () => Promise.resolve(null)),
    ).engine;
    await expect(changed.translate('a b', 'en', 'gu')).rejects.toMatchObject({ code: 'model-changed' });
  });

  it('lets the model go when it changes direction family, and when stopped', async () => {
    const releases: string[] = [];
    const store = models(
      [model('en-indic', ['translation-en-gu']), model('indic-en', ['translation-gu-en'])],
      (id) => Promise.resolve({ release: () => releases.push(id) }),
    );
    const { engine } = engineWith(store);
    await engine.translate('a b', 'en', 'gu');
    await engine.translate('ક ખ', 'gu', 'en');
    expect(releases).toEqual(['en-indic']);
    engine.stop();
    expect(releases).toEqual(['en-indic', 'indic-en']);
  });

  it('cancel stops the helper and refuses what was waiting; the next request starts a fresh one', async () => {
    const store = models([model('en-indic', ['translation-en-gu'])]);
    const { engine, children } = engineWith(store);
    const first = engine.translate('a b', 'en', 'gu');
    const second = engine.translate('c d', 'en', 'gu');
    engine.cancel();
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    await expect(second).rejects.toMatchObject({ code: 'cancelled' });
    await expect(engine.translate('e f', 'en', 'gu')).resolves.toBe('Placeholder words.');
    expect(children.length).toBeGreaterThanOrEqual(1);
    engine.stop();
  });
});
