import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  knownLanguageModels,
  LANGUAGE_MODELS,
  parseLanguageModelList,
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

/** A folder for a test's list, and two placeholder models Drashti could know (their bytes only made, never written). */
function placeholders() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-language-models-'));
  const gujarati = bytesOf(1);
  const hindi = bytesOf(2);
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
  return { dir, known };
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
      companions: [
        { name: 'tokens.txt', bytes: 10, sha256: 'c'.repeat(64) },
        { name: 'frontend.bin', bytes: 20, sha256: 'd'.repeat(64) },
      ],
    };
    expect(
      parseLanguageModelList([
        conformer,
        { ...conformer, id: 'placeholder-odd', sha256: '9'.repeat(64), format: 'odd' },
        // A Route C model that pins no tokens or front-end file is not known (review M2).
        { ...conformer, id: 'placeholder-unpinned', sha256: '8'.repeat(64), companions: undefined },
        {
          ...conformer,
          id: 'placeholder-bad-pin',
          sha256: '7'.repeat(64),
          companions: [{ name: 'tokens.txt' }],
        },
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
      // Route C (cap-route-c's IndicConformer CTC exports, cap-pack's packs): Gujarati and Hindi, 8-bit and full.
      [
        'gu-indicconformer-ctc-int8',
        'gu',
        197_297_864,
        '52d70bb2b311e9acf44fa868f5f75c3ab21e49885ed89f77ade4c2f011a32307',
      ],
      [
        'hi-indicconformer-ctc-int8',
        'hi',
        197_297_864,
        '02ef118807cbf4eda797cebab30703757ec920e328acdcf067227220ef0afeed',
      ],
      [
        'gu-indicconformer-ctc',
        'gu',
        493_034_563,
        '7f5e83cd55d7832d671db1c9bd9299ea37cea6e5f8b79d2981fecb7c58537766',
      ],
      [
        'hi-indicconformer-ctc',
        'hi',
        493_034_563,
        'fdeb04da4f5a9abc0b4a6f0d3900848776629331c23d64a92ddd466bddb3ecf0',
      ],
    ]);
    // Route C's models are known in IndicConformer's format (never loaded by whisper.cpp).
    expect(LANGUAGE_MODELS.filter((m) => m.format === 'indicconformer-ctc-onnx-v1').map((m) => m.id)).toEqual(
      [
        'gu-indicconformer-ctc-int8',
        'hi-indicconformer-ctc-int8',
        'gu-indicconformer-ctc',
        'hi-indicconformer-ctc',
      ],
    );
    // Each Route C model pins its tokens and front-end files too, by size and SHA-256 (cap-route-c's packs).
    const pins = (tokens: string, bytes: number) => [
      { name: 'tokens.txt', bytes, sha256: tokens },
      {
        name: 'frontend.bin',
        bytes: 82_240,
        sha256: 'd6f2450a1bf5142d092aebbaac8dea32002945dc953b58aacfb70a5aa08e895a',
      },
    ];
    const gu = pins('4949fb9c77c7d706c6cbe4339828076e497b02867d7864310c52ea1829645e90', 1_826);
    const hi = pins('e2bc7bca13b590fd2394504707326e3464d84ec3e70dcb0cf7f2be12e4e6f711', 1_784);
    expect(
      LANGUAGE_MODELS.filter((m) => m.format === 'indicconformer-ctc-onnx-v1').map((m) => m.companions),
    ).toEqual([gu, hi, gu, hi]);
    expect(LANGUAGE_MODELS.every((m) => !m.timestamps)).toBe(true);
    expect(LANGUAGE_MODELS.filter((m) => m.fallback).map((m) => m.language)).toEqual([
      'hi',
      'hi',
      'hi',
      'hi',
    ]);
    // Free and open only, each its exact licence: the tunes' Apache-2.0 on OpenAI's MIT base; Route C's IndicConformer
    // AI4Bharat's MIT (cap-route-c, the licence text its packs carry).
    const licenceOf = (m: (typeof LANGUAGE_MODELS)[number]) =>
      m.format === 'indicconformer-ctc-onnx-v1' ? 'MIT' : 'Apache-2.0 (base model MIT)';
    expect(LANGUAGE_MODELS.every((m) => m.licence === licenceOf(m))).toBe(true);
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
});
