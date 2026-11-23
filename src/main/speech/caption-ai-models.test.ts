import { describe, expect, it } from 'vitest';
import { captionPurpose, packCaptionModel, type PackModelFiles } from './caption-ai-models';

/* Which pack file caption AI runs (cap-integration): placeholder ids and hashes only. */

const KNOWN = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const whisper = (id: string, sha256: string, files = 1): PackModelFiles => ({
  id,
  format: 'whisper-ggml',
  files: Array.from({ length: files }, (_, n) => ({ path: `/placeholder/${id}/${String(n)}.bin`, sha256 })),
});

describe('caption AI: the pack file the recognizer runs', () => {
  it('the language’s purpose in the pack: Gujarati, Hindi and English only', () => {
    expect(captionPurpose('gu')).toBe('captions-gu');
    expect(captionPurpose('hi')).toBe('captions-hi');
    expect(captionPurpose('en')).toBe('captions-en');
    expect(captionPurpose('sa')).toBeNull();
  });

  it('the first one-file whisper.cpp model Drashti knows by its SHA-256; none: null', () => {
    const known = (sha: string) => sha === KNOWN;
    expect(packCaptionModel([whisper('unknown', OTHER), whisper('gu-small', KNOWN)], known)).toEqual({
      path: '/placeholder/gu-small/0.bin',
      sha256: KNOWN,
    });
    // Another format (a Conformer for ONNX Runtime) or a model of several files is not run by this engine.
    expect(
      packCaptionModel(
        [
          {
            id: 'gu-conformer',
            format: 'onnx-ctc',
            files: [{ path: '/placeholder/gu.onnx', sha256: KNOWN }],
          },
        ],
        known,
      ),
    ).toBeNull();
    expect(packCaptionModel([whisper('two-files', KNOWN, 2)], known)).toBeNull();
    expect(packCaptionModel([whisper('unknown', OTHER)], known)).toBeNull();
    expect(packCaptionModel([], known)).toBeNull();
  });
});
