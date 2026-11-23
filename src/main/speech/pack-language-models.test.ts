import { describe, expect, it } from 'vitest';
import type { LanguageModelEntry } from './language-models';
import {
  ADD_REFUSED,
  packFileFor,
  packLanguageModelStore,
  type CaptionPackFiles,
} from './pack-language-models';

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

  it('checking again asks the pack to check its files (and gives the hold back); a changed pack says so', async () => {
    const p = pack();
    expect(await packLanguageModelStore([ENTRY], p.store).verify(ENTRY)).toBe('ready');
    expect(p.asked).toEqual(['pack-gu']);
    expect(p.released).toEqual(['pack-gu']);
    expect(await packLanguageModelStore([ENTRY], pack({ held: false }).store).verify(ENTRY)).toBe('changed');
  });

  it('no model file is added any other way: it says to import the pack', async () => {
    await expect(
      packLanguageModelStore([ENTRY], pack().store).add('gu', '/placeholder/file.bin'),
    ).rejects.toThrow(ADD_REFUSED);
  });
});
