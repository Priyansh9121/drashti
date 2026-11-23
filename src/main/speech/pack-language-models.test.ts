import { describe, expect, it } from 'vitest';
import type { LanguageModelEntry } from './language-models';
import { packFileFor, packLanguageModelStore, type CaptionPackFiles } from './pack-language-models';

/* A language's own model from the offline pack only (the lead's Q-CAPI-2 A): placeholder ids, paths and hashes. */

const ENTRY: LanguageModelEntry = {
  id: 'gu-small-placeholder',
  language: 'gu',
  name: 'Placeholder Gujarati',
  bytes: 4_096,
  sha256: 'a'.repeat(64),
  licence: 'Apache-2.0',
  fallback: false,
  timestamps: false,
};

function pack(o: { sha?: string; format?: string; held?: boolean } = {}) {
  const asked: string[] = [];
  const released: string[] = [];
  const store: CaptionPackFiles = {
    forPurpose: (purpose) =>
      purpose === 'captions-gu'
        ? [
            {
              id: 'pack-gu',
              format: o.format ?? 'whisper-ggml',
              files: [{ path: '/placeholder/pack/gu.bin', bytes: 4_096, sha256: o.sha ?? 'a'.repeat(64) }],
            },
          ]
        : [],
    acquire: (id) => {
      asked.push(id);
      return Promise.resolve((o.held ?? true) ? { release: () => released.push(id) } : null);
    },
  };
  return { store, asked, released };
}

describe('a language’s own captions model, from the pack only', () => {
  it('a known model is here when the pack holds its very file (same SHA-256 and size), in whisper.cpp’s format', () => {
    expect(packFileFor(pack().store, ENTRY)).toEqual({
      modelId: 'pack-gu',
      path: '/placeholder/pack/gu.bin',
    });
    expect(packFileFor(pack({ sha: 'b'.repeat(64) }).store, ENTRY)).toBeNull();
    expect(packFileFor(pack({ format: 'indicconformer-ctc-onnx-v1' }).store, ENTRY)).toBeNull();
    expect(packFileFor(pack().store, { ...ENTRY, language: 'hi' })).toBeNull();
    const models = packLanguageModelStore([ENTRY], pack().store);
    expect(models.known()).toEqual([ENTRY]);
    expect(models.check(ENTRY)).toBe('ready');
    expect(packLanguageModelStore([ENTRY], pack({ sha: 'b'.repeat(64) }).store).check(ENTRY)).toBe('missing');
  });

  it('a known Route C model is here only as its own three files: the known model.onnx, tokens.txt and frontend.bin (review M2)', () => {
    const file = (name: string, sha256: string, bytes = 4_096) => ({
      name: `captions/gu-conformer/${name}`,
      path: `/placeholder/pack/${name}`,
      bytes,
      sha256,
    });
    const conformer: LanguageModelEntry = {
      ...ENTRY,
      id: 'gu-conformer',
      format: 'indicconformer-ctc-onnx-v1',
      companions: [
        { name: 'tokens.txt', bytes: 10, sha256: 'c'.repeat(64) },
        { name: 'frontend.bin', bytes: 20, sha256: 'd'.repeat(64) },
      ],
    };
    const known = [
      file('model.onnx', 'a'.repeat(64)),
      file('tokens.txt', 'c'.repeat(64), 10),
      file('frontend.bin', 'd'.repeat(64), 20),
    ];
    const held = (files: ReturnType<typeof file>[]): CaptionPackFiles => ({
      forPurpose: (purpose) =>
        purpose === 'captions-gu' ? [{ id: 'pack-gu', format: 'indicconformer-ctc-onnx-v1', files }] : [],
      acquire: () => Promise.resolve({ release: () => undefined }),
    });
    expect(packFileFor(held(known), conformer)).toEqual({
      modelId: 'pack-gu',
      path: '/placeholder/pack/model.onnx',
    });
    // The known file under a decoy name beside another model.onnx: never run.
    const decoy = [
      file('spare.bin', 'a'.repeat(64)),
      file('model.onnx', 'e'.repeat(64)),
      file('tokens.txt', 'c'.repeat(64), 10),
      file('frontend.bin', 'd'.repeat(64), 20),
    ];
    expect(packFileFor(held(decoy), conformer)).toBeNull();
    expect(packLanguageModelStore([conformer], held(decoy)).check(conformer)).toBe('missing');
    // Another tokens or front-end file, one missing, or one more file: not the known model either.
    const otherTokens = [
      file('model.onnx', 'a'.repeat(64)),
      file('tokens.txt', 'f'.repeat(64), 10),
      file('frontend.bin', 'd'.repeat(64), 20),
    ];
    expect(packFileFor(held(otherTokens), conformer)).toBeNull();
    expect(packFileFor(held(known.slice(0, 2)), conformer)).toBeNull();
    expect(packFileFor(held([...known, file('extra.txt', 'b'.repeat(64))]), conformer)).toBeNull();
    // A Route C entry that pins no tokens or front-end file is never here.
    expect(packFileFor(held(known), { ...conformer, companions: undefined })).toBeNull();
    expect(packFileFor(pack().store, conformer)).toBeNull();
  });

  it('checking again asks the pack to check its files (and gives the hold back); a changed pack says so', async () => {
    const p = pack();
    expect(await packLanguageModelStore([ENTRY], p.store).verify(ENTRY)).toBe('ready');
    expect(p.asked).toEqual(['pack-gu']);
    expect(p.released).toEqual(['pack-gu']);
    expect(await packLanguageModelStore([ENTRY], pack({ held: false }).store).verify(ENTRY)).toBe('changed');
  });
});
