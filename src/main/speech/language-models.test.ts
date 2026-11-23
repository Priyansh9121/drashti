import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addLanguageModelFile,
  checkLanguageModel,
  knownLanguageModels,
  LANGUAGE_MODELS,
  languageModelFile,
  LanguageModelRefused,
  languageModelStore,
  parseLanguageModelList,
  verifyLanguageModel,
  type LanguageModelEntry,
} from './language-models';

/*
 * A model of its own per language (alpha.22, cap-whisper): Drashti knows each by its size and SHA-256, and uses no
 * other file. The "models" here are generated placeholder bytes, never a real model; nothing is downloaded.
 */

const bytesOf = (seed: number, size = 4_096): Buffer => {
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) b[i] = (i * 31 + seed * 7) % 251;
  return b;
};
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

function placeholders() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-language-models-'));
  const userData = join(dir, 'data');
  const gujarati = bytesOf(1);
  const hindi = bytesOf(2);
  const other = bytesOf(3);
  const files = {
    gujarati: join(dir, 'placeholder-gu.bin'),
    hindi: join(dir, 'placeholder-hi.bin'),
    other: join(dir, 'placeholder-other.bin'),
  };
  writeFileSync(files.gujarati, gujarati);
  writeFileSync(files.hindi, hindi);
  writeFileSync(files.other, other);
  const known: LanguageModelEntry[] = [
    {
      id: 'placeholder-gu',
      language: 'gu',
      name: 'Placeholder Gujarati',
      bytes: gujarati.length,
      sha256: sha(gujarati),
      licence: 'MIT',
      fallback: true,
      timestamps: true,
    },
    {
      id: 'placeholder-hi',
      language: 'hi',
      name: 'Placeholder Hindi',
      bytes: hindi.length,
      sha256: sha(hindi),
      licence: 'MIT',
      fallback: true,
      timestamps: false,
    },
  ];
  const plenty = () => Promise.resolve(100 * 1024 ** 3);
  return { dir, userData, files, known, plenty };
}

describe('the models Drashti knows for a language (alpha.22)', () => {
  it('keeps only well-made entries: a plain id, a language with a model of its own, a size and a SHA-256', () => {
    const good = {
      id: 'placeholder-gu',
      language: 'gu',
      name: 'Placeholder Gujarati',
      bytes: 4_096,
      sha256: 'a'.repeat(64),
      licence: 'MIT',
      fallback: true,
    };
    expect(
      parseLanguageModelList([
        good,
        { ...good, id: 'Bad Id/..' },
        { ...good, id: 'placeholder-sa', language: 'sa', sha256: 'b'.repeat(64) },
        { ...good, id: 'placeholder-empty', bytes: 0, sha256: 'c'.repeat(64) },
        { ...good, id: 'placeholder-short', sha256: 'abc' },
        { ...good, id: 'placeholder-gu', sha256: 'd'.repeat(64) },
        { ...good, id: 'placeholder-same-file', sha256: 'a'.repeat(64) },
        { ...good, id: 'placeholder-odd-stamps', sha256: 'f'.repeat(64), timestamps: 'no' },
        'nonsense',
      ]),
    ).toEqual([{ ...good, timestamps: true }]);
    // A tuned model decoded without timestamps says so.
    expect(parseLanguageModelList([{ ...good, timestamps: false }])).toEqual([
      { ...good, timestamps: false },
    ]);
    expect(parseLanguageModelList({ not: 'a list' })).toEqual([]);
  });

  it('knows a Route C model (IndicConformer, ONNX Runtime) by its format; a format no route runs is not known', () => {
    const conformer = {
      id: 'placeholder-gu-conformer',
      language: 'gu',
      name: 'Placeholder Gujarati (IndicConformer)',
      bytes: 4_096,
      sha256: 'e'.repeat(64),
      licence: 'MIT',
      fallback: false,
      format: 'indicconformer-ctc-onnx-v1',
    };
    expect(
      parseLanguageModelList([
        conformer,
        { ...conformer, id: 'placeholder-odd', sha256: '9'.repeat(64), format: 'odd' },
      ]),
    ).toEqual([{ ...conformer, timestamps: true }]);
  });

  it('knows the tuned Gujarati and Hindi models by their exact size and SHA-256 (cap-route-w), decoded without timestamps, Gujarati without fallback; the list is well made', () => {
    expect(parseLanguageModelList(LANGUAGE_MODELS)).toEqual(LANGUAGE_MODELS);
    expect(LANGUAGE_MODELS.map((m) => [m.id, m.language, m.bytes, m.sha256])).toEqual([
      [
        'gu-small-vasista22-f16',
        'gu',
        487_601_967,
        '4352740b11928eef0743477d0729c3abda01c3f95f2e7802ad771beeeeb45c7a',
      ],
      [
        'gu-small-vasista22-q8_0',
        'gu',
        264_464_607,
        '44927c4860080a0122d6eac5d42a12b3b1e30c56d3bdeddc3850456bc303d215',
      ],
      [
        'gu-small-vasista22-q5_1',
        'gu',
        190_085_487,
        'e756347b8fb573b88a5625ad98dac9075746549fdf407260d321d077a73b094a',
      ],
      [
        'gu-small-vasista22-q5_0',
        'gu',
        175_209_663,
        '608a61708e73fd529025500487f77089909b05ad8966455314c6124cb272ecac',
      ],
      [
        'gu-medium-vasista22-f16',
        'gu',
        1_533_763_059,
        '591ddaff1202b383c53be6aa2b9cc8278a169f17e4f583ac57032a059282671f',
      ],
      [
        'gu-medium-vasista22-q8_0',
        'gu',
        823_369_779,
        'f1468ff2d0f69265feda6db834803919385e3f69885775ffd2aa40644e84157c',
      ],
      [
        'gu-medium-vasista22-q5_0',
        'gu',
        539_212_467,
        '0d539e6d025489e1412453f28852b46d806682b11afcefbee9e5aa1010375f5c',
      ],
      [
        'hi-small-vasista22-f16',
        'hi',
        487_601_967,
        '5d9f25596aad22c9a8a67de67632b5e8f0d1e43b26cdd0f26c1d628d7e953e91',
      ],
      [
        'hi-small-vasista22-q8_0',
        'hi',
        264_464_607,
        '0b2ff62094c004b0b180f47d6cb4aefec12d4d93ad3282058aa022827eb721e5',
      ],
      [
        'hi-small-vasista22-q5_1',
        'hi',
        190_085_487,
        '6813fed7ffa6c3fa14490c1f1788d2d8b6e3b7badf59a2f75fb4c5c21cf00f3f',
      ],
      [
        'hi-small-vasista22-q5_0',
        'hi',
        175_209_663,
        '8d436e4bcceae1e5021df902d7db87c130ee7cf4810dbd6fa8edd8038595f33e',
      ],
    ]);
    expect(LANGUAGE_MODELS.every((m) => !m.timestamps)).toBe(true);
    expect(LANGUAGE_MODELS.filter((m) => m.fallback).map((m) => m.language)).toEqual([
      'hi',
      'hi',
      'hi',
      'hi',
    ]);
    // Free and open only: the tunes' Apache-2.0 on OpenAI's MIT base.
    expect(LANGUAGE_MODELS.every((m) => m.licence === 'Apache-2.0 (base model MIT)')).toBe(true);
  });

  it('keeps a language model in the data folder, under its id', () => {
    expect(languageModelFile('/data', 'placeholder-gu')).toBe(
      join('/data', 'speech-models', 'languages', 'placeholder-gu.bin'),
    );
  });
});

describe('adding a language model file (alpha.22)', () => {
  it('takes a known file for its language: copied into the data folder, checked again, and ready', async () => {
    const { userData, files, known, plenty } = placeholders();
    const entry = await addLanguageModelFile({
      userData,
      source: files.gujarati,
      language: 'gu',
      known,
      freeBytes: plenty,
    });
    expect(entry.id).toBe('placeholder-gu');
    const file = languageModelFile(userData, 'placeholder-gu');
    expect(existsSync(file)).toBe(true);
    expect(checkLanguageModel(file, entry)).toBe('ready');
    // Nothing half-made is left beside it.
    expect(readdirSync(join(userData, 'speech-models', 'languages')).sort()).toEqual([
      'placeholder-gu.bin',
      'placeholder-gu.bin.check',
    ]);
  });

  it('refuses a file it does not know, plainly, and keeps nothing of it', async () => {
    const { userData, files, known, plenty } = placeholders();
    const adding = addLanguageModelFile({
      userData,
      source: files.other,
      language: 'gu',
      known,
      freeBytes: plenty,
    });
    await expect(adding).rejects.toBeInstanceOf(LanguageModelRefused);
    await expect(adding).rejects.toThrow(
      'This file is not a model Drashti knows for Gujarati, so it was not added. Use a file from the approved list of captions models.',
    );
    expect(existsSync(join(userData, 'speech-models', 'languages', 'placeholder-gu.bin'))).toBe(false);
  });

  it('refuses another language’s model, naming it', async () => {
    const { userData, files, known, plenty } = placeholders();
    await expect(
      addLanguageModelFile({ userData, source: files.hindi, language: 'gu', known, freeBytes: plenty }),
    ).rejects.toThrow('This file is the Hindi model, not a Gujarati one, so it was not added.');
  });

  it('leaves the room the show needs on the drive', async () => {
    const { userData, files, known } = placeholders();
    await expect(
      addLanguageModelFile({
        userData,
        source: files.gujarati,
        language: 'gu',
        known,
        freeBytes: () => Promise.resolve(1024 ** 3),
      }),
    ).rejects.toThrow(/^Free at least \d+ MB more on this computer, then add the model again\.$/u);
  });
});

describe('a language model is checked before it is used (alpha.22)', () => {
  it('is changed when its file is not as it was checked: a byte changed, or more added; missing when gone', async () => {
    const { userData, files, known, plenty } = placeholders();
    const entry = await addLanguageModelFile({
      userData,
      source: files.gujarati,
      language: 'gu',
      known,
      freeBytes: plenty,
    });
    const file = languageModelFile(userData, entry.id);
    // The same size with one byte changed (its time moves on, as any change makes it).
    const changed = bytesOf(1);
    changed[100] = (changed[100] ?? 0) ^ 0xff;
    writeFileSync(file, changed);
    utimesSync(file, new Date(), new Date(Date.now() + 5_000));
    expect(checkLanguageModel(file, entry)).toBe('changed');
    expect(await verifyLanguageModel(file, entry)).toBe('changed');
    expect(checkLanguageModel(file, entry)).toBe('changed');
    appendFileSync(file, 'more');
    expect(checkLanguageModel(file, entry)).toBe('changed');
    expect(checkLanguageModel(join(userData, 'no-such.bin'), entry)).toBe('missing');
  });

  it('checked again whole, a file only touched is ready again', async () => {
    const { userData, files, known, plenty } = placeholders();
    const entry = await addLanguageModelFile({
      userData,
      source: files.gujarati,
      language: 'gu',
      known,
      freeBytes: plenty,
    });
    const file = languageModelFile(userData, entry.id);
    utimesSync(file, new Date(), new Date(Date.now() + 5_000));
    expect(checkLanguageModel(file, entry)).toBe('changed');
    expect(await verifyLanguageModel(file, entry)).toBe('ready');
    expect(checkLanguageModel(file, entry)).toBe('ready');
  });

  it('is not ready under another entry, even with the same name', async () => {
    const { userData, files, known, plenty } = placeholders();
    const entry = await addLanguageModelFile({
      userData,
      source: files.gujarati,
      language: 'gu',
      known,
      freeBytes: plenty,
    });
    const file = languageModelFile(userData, entry.id);
    expect(checkLanguageModel(file, { ...entry, sha256: 'e'.repeat(64) })).toBe('changed');
  });
});

describe('the language models as the captions service asks for them (alpha.22)', () => {
  it('knows the built-in list, or only for a test the list its switch names (none from a damaged one)', () => {
    const { dir, known } = placeholders();
    expect(knownLanguageModels(undefined)).toBe(LANGUAGE_MODELS);
    const list = join(dir, 'models.json');
    writeFileSync(list, JSON.stringify(known));
    expect(knownLanguageModels(list)).toEqual(known);
    writeFileSync(list, '[{');
    expect(knownLanguageModels(list)).toEqual([]);
    expect(knownLanguageModels(join(dir, 'no-such.json'))).toEqual([]);
  });

  it('adds, checks and checks again in this computer’s data folder', async () => {
    const { userData, files, known } = placeholders();
    const store = languageModelStore(userData, known);
    const gu = known[0];
    if (!gu) throw new Error('no placeholder');
    expect(store.known()).toBe(known);
    expect(store.check(gu)).toBe('missing');
    await expect(store.add('gu', files.gujarati)).resolves.toEqual(gu);
    expect(store.check(gu)).toBe('ready');
    await expect(store.verify(gu)).resolves.toBe('ready');
  });
});
