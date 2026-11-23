import { describe, expect, it, vi } from 'vitest';
import { fakeHelper, type FakeChild } from '../testing/fake-translate-helper';
import {
  INDICTRANS2_FILES,
  INDICTRANS2_FORMAT,
  KNOWN_INDICTRANS2_MODELS,
  TranslationEngine,
  type TranslationModels,
} from './translation-engine';
import { TranslationHelper } from './translation-helper';

const log = { info: vi.fn(), warn: vi.fn() };
const model = (
  id: string,
  purposes: string[],
  format = INDICTRANS2_FORMAT,
  files: readonly string[] = INDICTRANS2_FILES,
) => ({
  id,
  purposes,
  format,
  files: files.map((name) => ({
    name: `${id}/${name}`,
    path: `/packs/p/${id}/${name}`,
    sha256: '0'.repeat(64),
  })),
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
    // Stand-in models: their files are not x74's conversions, so every one is taken as known here.
    checkFiles: () => true,
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

  it('runs only the IndicTrans2 conversions this Drashti knows, by every file’s SHA-256 (a22-review-mt A14)', () => {
    const knownFiles = (route: keyof typeof KNOWN_INDICTRANS2_MODELS) =>
      Object.entries(KNOWN_INDICTRANS2_MODELS[route]).map(([name, sha256]) => ({
        name: `${route}/${name}`,
        path: `/packs/p/${route}/${name}`,
        sha256,
      }));
    const engineFor = (m: ReturnType<typeof model>) =>
      new TranslationEngine({ program: () => '/x/drashti-translate', models: models([m]), log });
    const real = { ...model('en-indic', ['translation-en-gu']), files: knownFiles('en-indic') };
    expect(engineFor(real).available('en', 'gu')).toBe(true);
    expect(engineFor(real).unknownModel('en', 'gu')).toBe(false);
    // One file not the known one (another conversion, or a file only the pack's own list vouches for): not run.
    const changed = {
      ...real,
      files: real.files.map((f) => (f.name.endsWith('model.bin') ? { ...f, sha256: 'f'.repeat(64) } : f)),
    };
    expect(engineFor(changed).available('en', 'gu')).toBe(false);
    expect(engineFor(changed).unknownModel('en', 'gu')).toBe(true);
    // The right files offered for another direction family: not run either.
    expect(engineFor({ ...real, purposes: ['translation-gu-en'] }).available('gu', 'en')).toBe(false);
    for (const route of ['en-indic', 'indic-en', 'indic-indic'] as const) {
      expect(Object.keys(KNOWN_INDICTRANS2_MODELS[route]).sort()).toEqual([...INDICTRANS2_FILES].sort());
      for (const sha of Object.values(KNOWN_INDICTRANS2_MODELS[route]))
        expect(sha).toMatch(/^[0-9a-f]{64}$/u);
    }
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

  it('drafts words that name a model marker, as Python does, and refuses a model the pack store no longer vouches for', async () => {
    // Both tokenisers split "<", "/" and ">" apart, so the marker never reaches the model (a22-review-mt A12).
    const { engine, children } = engineWith(models([model('en-indic', ['translation-en-gu'])]));
    await expect(engine.translate('Use <s> and </s> tags.', 'en', 'gu')).resolves.toBe('Placeholder words.');
    expect(children[0]?.requests.find((r) => r['op'] === 'translate')?.['text']).toBe(
      'Use < s > and < / s > tags .',
    );
    engine.stop();
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
    const { engine, children } = engineWith(store);
    await engine.translate('a b', 'en', 'gu');
    await engine.translate('ક ખ', 'gu', 'en');
    expect(releases).toEqual(['en-indic']);
    // Only one model is ever loaded in the helper: the first is unloaded before the second loads.
    expect(children[0]?.requests.map((r) => `${String(r['op'])} ${String(r['route'])}`)).toEqual([
      'load en-indic',
      'translate en-indic',
      'unload en-indic',
      'load indic-en',
      'translate indic-en',
    ]);
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

  it('Stop while the helper is starting stops it: no model loads, nothing is drafted (a22-review-mt A7)', async () => {
    let child: FakeChild | undefined;
    const ok = (r: Record<string, unknown>) =>
      r['op'] === 'translate'
        ? `{"id":${String(r['id'])},"ok":true,"tokens":["\u2581x","</s>"]}`
        : `{"id":${String(r['id'])},"ok":true}`;
    const engine = new TranslationEngine({
      program: () => '/x/drashti-translate',
      models: models([model('en-indic', ['translation-en-gu'])]),
      log,
      createHelper: (p) =>
        new TranslationHelper({
          program: p,
          log,
          lowerPriority: () => undefined,
          spawn: () => (child = fakeHelper(ok, '')),
        }),
    });
    const pending = engine.translate('a b', 'en', 'gu');
    await vi.waitFor(() => {
      expect(child).toBeDefined();
    });
    engine.cancel();
    child?.stdout.write(
      '{"hello":"drashti-translate","protocol":1,"ctranslate2":"4.9.1","sentencepiece":"0.2.1"}\n',
    );
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(child?.killed).toBe(true);
    expect(child?.requests.filter((r) => r['op'] === 'load')).toEqual([]);
  });

  it('Stop while the model is being checked lets the model go and says Stopped, not a fault (a22-review-mt A7)', async () => {
    const release = vi.fn();
    let checked: ((hold: { release(): void }) => void) | undefined;
    const store = models(
      [model('en-indic', ['translation-en-gu'])],
      () => new Promise((resolve) => (checked = resolve)),
    );
    const { engine, children } = engineWith(store);
    const pending = engine.translate('a b', 'en', 'gu');
    await vi.waitFor(() => {
      expect(checked).toBeDefined();
    });
    engine.cancel();
    checked?.({ release });
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(release).toHaveBeenCalledTimes(1);
    expect(children[0]?.requests.filter((r) => r['op'] === 'load')).toEqual([]);
  });

  it('refuses a draft the model cut at its length limit, as this box only (a22-review-mt A9)', async () => {
    const store = models([model('en-indic', ['translation-en-gu'])]);
    // 256 tokens and no end token: the model stopped mid-sentence.
    const { engine } = engineWith(store, () => Array.from({ length: 256 }, () => '\u2581x'));
    await expect(engine.translate('A long placeholder line.', 'en', 'gu')).rejects.toMatchObject({
      code: 'too-long',
    });
    engine.stop();
  });

  it('sends only well-formed text the helper can read, and refuses a line too long for one request (a22-review-mt A10)', async () => {
    const store = models([model('en-indic', ['translation-en-gu'])]);
    const { engine, children } = engineWith(store);
    // A broken emoji (a lone surrogate) is drafted, not refused; the helper never sees the lone surrogate.
    await expect(engine.translate('Placeholder \ud83d words.', 'en', 'gu')).resolves.toBe(
      'Placeholder words.',
    );
    const sent = children[0]?.requests.find((r) => r['op'] === 'translate');
    expect(String(sent?.['text'])).not.toMatch(/[\ud800-\udfff]/u);
    // About 65 KB in one line: too long for one request, this box only; the helper keeps running.
    await expect(engine.translate('word '.repeat(13_000), 'en', 'gu')).rejects.toMatchObject({
      code: 'too-long',
    });
    expect(children[0]?.killed).toBe(false);
    engine.stop();
  });
});
