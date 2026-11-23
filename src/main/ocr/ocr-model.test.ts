import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtOcrFiles, OCR_FOLDER, OCR_MODEL_SHA256, ocrBuildFiles, sourceOcrFiles } from './ocr-files';

/*
 * Book OCR's files (alpha.21, the owner's Q60-58): the model committed in resources/ocr/ is tessdata_best's own
 * script/Gujarati.traineddata, byte for byte (the engine trial's file), with its licence and source beside it; the
 * build copies it and Tesseract's WebAssembly build beside the main bundle, where the reading process looks.
 */

const root = process.cwd();

describe('book OCR’s files', () => {
  it('the model is tessdata_best’s Gujarati script model, byte for byte, its licence and source beside it', () => {
    const model = readFileSync(join(root, 'resources', 'ocr', 'Gujarati.traineddata'));
    expect(model.length).toBe(7_074_537);
    expect(createHash('sha256').update(model).digest('hex')).toBe(
      '82f06ffd7c0db4232e00af1b8c90b596c28b49a77453d9a54ce5b99a16b3e0a5',
    );
    expect(OCR_MODEL_SHA256).toBe('82f06ffd7c0db4232e00af1b8c90b596c28b49a77453d9a54ce5b99a16b3e0a5');
    expect(readFileSync(join(root, 'resources', 'ocr', 'LICENSE-tessdata_best.txt'), 'utf8')).toContain(
      'Apache License',
    );
    const source = readFileSync(join(root, 'resources', 'ocr', 'SOURCE.txt'), 'utf8');
    expect(source).toContain('82f06ffd7c0db4232e00af1b8c90b596c28b49a77453d9a54ce5b99a16b3e0a5');
    expect(source).toContain(
      'tessdata_best/e12c65a915945e4c28e237a9b52bc4a8f39a0cec/script/Gujarati.traineddata',
    );
  });

  it('the compiled-in libraries’ licence texts are each as its project has it, by the SHA-256 SOURCES.txt gives', () => {
    const dir = join(root, 'LICENSES', 'tesseract');
    const listed = [
      ...readFileSync(join(dir, 'SOURCES.txt'), 'utf8').matchAll(
        /^(\S+)\s+\(.*\n\s+URL:\s+(\S+)\n\s+Commit:\s+([0-9a-f]{40})\n\s+SHA-256:\s+([0-9a-f]{64})$/gmu,
      ),
    ].map(([, file = '', url = '', commit = '', sha = '']) => ({ file, url, commit, sha }));
    expect(listed.map((l) => l.file)).toEqual([
      'leptonica-license.txt',
      'libjpeg-README.txt',
      'giflib-COPYING.txt',
      'libpng-LICENSE.txt',
      'libtiff-COPYRIGHT.txt',
      'libwebp-COPYING.txt',
      'zlib-README.txt',
      'openlibm-LICENSE.md.txt',
    ]);
    for (const { file, url, commit, sha } of listed) {
      expect(url, file).toContain(`/${commit}/`);
      expect(
        createHash('sha256')
          .update(readFileSync(join(dir, file)))
          .digest('hex'),
        file,
      ).toBe(sha);
    }
  });

  it('Tesseract’s WebAssembly build is there to be copied: the SIMD, LSTM-only loader and its WebAssembly', () => {
    const files = sourceOcrFiles(root);
    for (const file of [files.core, files.wasm, files.model])
      expect(statSync(file).size, file).toBeGreaterThan(0);
    // tesseract.js-core 7.0.0 exactly, as package.json pins it.
    const core = JSON.parse(
      readFileSync(join(root, 'node_modules', 'tesseract.js-core', 'package.json'), 'utf8'),
    ) as {
      version: string;
      license: string;
    };
    expect(core).toMatchObject({ version: '7.0.0', license: 'Apache-2.0' });
  });

  it('the build publishes each file in ocr/ beside the main bundle, where the reading process reads it', () => {
    const published = ocrBuildFiles().map(([at]) => at);
    expect(published).toEqual([
      'ocr/tesseract-core-simd-lstm.js',
      'ocr/tesseract-core-simd-lstm.wasm',
      'ocr/Gujarati.traineddata',
    ]);
    const built = builtOcrFiles(join('out', 'main'));
    expect([built.core, built.wasm, built.model]).toEqual(
      published.map((at) => join('out', 'main', ...at.split('/'))),
    );
    expect(OCR_FOLDER).toBe('ocr');
    for (const [, from] of ocrBuildFiles()) expect(existsSync(join(root, from)), from).toBe(true);
    // And the reading process is built as a bundle of its own beside them.
    expect(readFileSync(join(root, 'electron.vite.config.ts'), 'utf8')).toContain(
      "'ocr-worker': resolve('src/main/ocr/ocr-worker.ts')",
    );
  });
});
