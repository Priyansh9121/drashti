import { describe, expect, it } from 'vitest';
import { PACK_FORMAT, PACK_MANIFEST, type PackFile } from '../../shared/model-packs';
import { checkManifest, readManifestText } from './manifest';

/*
 * The pack's list (alpha.22, cap-pack): every file named with its bytes, SHA-256, licence and purpose; a model's
 * files with the model they belong to, its format and their licence's own text. Anything the list gets wrong refuses
 * the whole pack, in plain words that say what to do. Placeholder names and hashes only.
 */

const HASH = (n: number) => n.toString(16).padStart(64, '0');

const licence: PackFile = {
  name: 'licences/MIT.txt',
  bytes: 1070,
  sha256: HASH(1),
  licence: 'MIT',
  purpose: ['licence'],
};
const gu: PackFile = {
  name: 'captions/gu-placeholder/model.bin',
  bytes: 4096,
  sha256: HASH(2),
  licence: 'MIT',
  purpose: ['captions-gu'],
  model: 'gu-placeholder',
  format: 'whisper-ggml',
  licenceFile: 'licences/MIT.txt',
};
const enIndic = (file: string, n: number): PackFile => ({
  name: `translation/en-indic/${file}`,
  bytes: 100 + n,
  sha256: HASH(10 + n),
  licence: 'MIT',
  purpose: ['translation-en-gu', 'translation-en-hi'],
  model: 'en-indic-placeholder',
  format: 'ctranslate2',
  licenceFile: 'licences/MIT.txt',
});

const pack = (files: PackFile[], more: Record<string, unknown> = {}) => ({
  format: PACK_FORMAT,
  version: 1,
  id: 'placeholder-pack',
  name: 'Placeholder models',
  release: '2026.11.1',
  files,
  ...more,
});

const refusal = (raw: unknown) => {
  const r = checkManifest(raw);
  if (r.ok) throw new Error('the list was taken');
  return r.message;
};

describe('a model pack’s list (alpha.22, cap-pack)', () => {
  it('groups each model’s files with its purposes, format, folder and licences; licence texts kept apart', () => {
    const r = checkManifest(pack([licence, gu, enIndic('model.bin', 1), enIndic('config.json', 2)]));
    if (!r.ok) throw new Error(r.message);
    expect(r.pack.manifest.id).toBe('placeholder-pack');
    expect(r.pack.bytes).toBe(1070 + 4096 + 101 + 102);
    expect(r.pack.licenceTexts.map((f) => f.name)).toEqual(['licences/MIT.txt']);
    expect(r.pack.models.map((m) => [m.id, m.purposes, m.format, m.folder, m.licences, m.bytes])).toEqual([
      ['gu-placeholder', ['captions-gu'], 'whisper-ggml', 'captions/gu-placeholder', ['MIT'], 4096],
      [
        'en-indic-placeholder',
        ['translation-en-gu', 'translation-en-hi'],
        'ctranslate2',
        'translation/en-indic',
        ['MIT'],
        203,
      ],
    ]);
    expect(r.pack.models[1]?.files.map((f) => f.name)).toEqual([
      'translation/en-indic/model.bin',
      'translation/en-indic/config.json',
    ]);
  });

  it('reads the list’s text, and says plainly when it is not one', () => {
    expect(readManifestText(JSON.stringify(pack([licence, gu]))).ok).toBe(true);
    const r = readManifestText('{"format": "drashti-model-pack", ');
    expect(r).toEqual({
      ok: false,
      message: `The pack’s list (${PACK_MANIFEST}) does not read: the pack is damaged. Nothing was installed: ask for a fresh copy of the pack.`,
    });
    expect(refusal({ format: 'something-else', version: 1 })).toBe(
      `This is not a Drashti model pack: its ${PACK_MANIFEST} is not one. Nothing was installed: choose the pack’s own folder or zip.`,
    );
    expect(refusal(pack([licence, gu], { version: 2 }))).toBe(
      'This model pack is for a newer Drashti. Nothing was installed: update Drashti, then import it again.',
    );
  });

  it('refuses a list in the wrong form, saying where', () => {
    expect(refusal(pack([licence, { ...gu, sha256: 'not-a-hash' }]))).toBe(
      'The pack’s list is not right (files › 2 › sha256). Nothing was installed: ask for a fresh copy of the pack.',
    );
    expect(refusal(pack([]))).toBe(
      'The pack’s list is not right (files). Nothing was installed: ask for a fresh copy of the pack.',
    );
  });

  it.each([
    ['../outside.bin'],
    ['/absolute/model.bin'],
    ['C:/model.bin'],
    ['captions\\gu\\model.bin'],
    ['captions/./model.bin'],
    ['.hidden/model.bin'],
  ])('refuses a file name that is not a plain path inside the pack (%s)', (name) => {
    expect(refusal(pack([licence, { ...gu, name }]))).toBe(
      'The pack’s list is not right (files › 2 › name). Nothing was installed: ask for a fresh copy of the pack.',
    );
  });

  it('refuses a file named twice (in any case: Mac and Windows folders do not tell them apart), and its own list', () => {
    expect(refusal(pack([licence, gu, { ...gu, name: 'CAPTIONS/gu-placeholder/Model.bin' }]))).toBe(
      'The pack’s list names CAPTIONS/gu-placeholder/Model.bin twice. Nothing was installed: ask for a fresh copy of the pack.',
    );
    expect(refusal(pack([licence, gu, { ...licence, name: PACK_MANIFEST }]))).toBe(
      `The pack’s list names itself (${PACK_MANIFEST}) as one of its files. Nothing was installed: ask for a fresh copy of the pack.`,
    );
  });

  it('takes free and open licences only (the owner’s rule)', () => {
    expect(refusal(pack([licence, { ...gu, licence: 'Inference-Only-1.0' }]))).toBe(
      'captions/gu-placeholder/model.bin has the licence Inference-Only-1.0, which is not one of the free and open licences Drashti takes (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0, CC-BY-4.0). Nothing was installed: ask for a pack with open licences only.',
    );
    expect(refusal(pack([licence, { ...gu, licence: 'see <the> website' }]))).toBe(
      'captions/gu-placeholder/model.bin has a licence Drashti does not know, which is not one of the free and open licences Drashti takes (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0, CC-BY-4.0). Nothing was installed: ask for a pack with open licences only.',
    );
  });

  it('refuses a purpose Drashti does not know, a licence text that is also a model, and a list with no model', () => {
    expect(refusal(pack([licence, { ...gu, purpose: ['captions-sa'] }]))).toBe(
      'captions/gu-placeholder/model.bin has a purpose Drashti does not know (captions-sa). Nothing was installed: ask for a pack made for this Drashti.',
    );
    expect(refusal(pack([licence, { ...gu, purpose: ['translation-gu-gu'] }]))).toBe(
      'captions/gu-placeholder/model.bin has a purpose Drashti does not know (translation-gu-gu). Nothing was installed: ask for a pack made for this Drashti.',
    );
    expect(refusal(pack([licence, { ...gu, purpose: ['captions-gu', 'licence'] }]))).toBe(
      'captions/gu-placeholder/model.bin is given as a licence’s text and as a model at once. Nothing was installed: ask for a fresh copy of the pack.',
    );
    expect(refusal(pack([licence]))).toBe(
      'The pack holds no model. Nothing was installed: ask for the pack with the caption or translation models.',
    );
  });

  it('needs each model file’s model, format and licence text, and a licence text to be one', () => {
    const { model: _m, ...noModel } = gu;
    expect(refusal(pack([licence, noModel]))).toBe(
      'captions/gu-placeholder/model.bin does not say which model it belongs to, its format and its licence’s text. Nothing was installed: ask for a fresh copy of the pack.',
    );
    const { licenceFile: _l, ...noText } = gu;
    expect(refusal(pack([licence, noText]))).toBe(
      'captions/gu-placeholder/model.bin does not say which model it belongs to, its format and its licence’s text. Nothing was installed: ask for a fresh copy of the pack.',
    );
    expect(refusal(pack([licence, { ...gu, licenceFile: 'licences/Apache-2.0.txt' }]))).toBe(
      'captions/gu-placeholder/model.bin names licences/Apache-2.0.txt as its licence’s text, which the pack does not hold as one. Nothing was installed: ask for a fresh copy of the pack.',
    );
    expect(
      refusal(pack([licence, enIndic('a.bin', 1), { ...gu, licenceFile: enIndic('a.bin', 1).name }])),
    ).toBe(
      'captions/gu-placeholder/model.bin names translation/en-indic/a.bin as its licence’s text, which the pack does not hold as one. Nothing was installed: ask for a fresh copy of the pack.',
    );
    expect(refusal(pack([{ ...licence, model: 'gu-placeholder' }, gu]))).toBe(
      'licences/MIT.txt is a licence’s text, so it belongs to no model and has no format. Nothing was installed: ask for a fresh copy of the pack.',
    );
  });

  it('needs one purpose and format for all of a model’s files, and each model in a folder of its own', () => {
    expect(
      refusal(
        pack([licence, enIndic('a.bin', 1), { ...enIndic('b.bin', 2), purpose: ['translation-en-gu'] }]),
      ),
    ).toBe(
      'The files of the model en-indic-placeholder do not agree on its purpose and format. Nothing was installed: ask for a fresh copy of the pack.',
    );
    expect(refusal(pack([licence, enIndic('a.bin', 1), { ...enIndic('b.bin', 2), format: 'onnx' }]))).toBe(
      'The files of the model en-indic-placeholder do not agree on its purpose and format. Nothing was installed: ask for a fresh copy of the pack.',
    );
    expect(refusal(pack([licence, { ...gu, name: 'model.bin' }]))).toBe(
      'The model gu-placeholder is not in a folder of its own in the pack. Nothing was installed: ask for a fresh copy of the pack.',
    );
    const inside = { ...enIndic('a.bin', 1), name: 'captions/gu-placeholder/more/a.bin' };
    expect(refusal(pack([licence, gu, inside]))).toBe(
      'The model en-indic-placeholder is not in a folder of its own in the pack. Nothing was installed: ask for a fresh copy of the pack.',
    );
  });
});
