import { basename, join } from 'node:path';
import type { OcrFiles } from './ocr-engine';

/*
 * Where book OCR's reader comes from (alpha.21, the owner's Q60-58: "A, Tesseract inside"): Tesseract's WebAssembly
 * build (tesseract.js-core's SIMD, LSTM-only loader and its WebAssembly, as they are) and Tesseract's best Gujarati
 * script model (resources/ocr/, its source and licence beside it). The build copies them beside the main bundle into
 * ocr/ (electron.vite.config.ts), inside the app; the reading process reads them from there. Nothing is fetched while
 * Drashti runs.
 */

/** Each file, from the repository's root. */
export const OCR_SOURCES: Readonly<OcrFiles> = {
  core: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.js',
  wasm: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm',
  model: 'resources/ocr/Gujarati.traineddata',
};

/** The model's SHA-256: tessdata_best's own file, as the engine trial read with (resources/ocr/SOURCE.txt). */
export const OCR_MODEL_SHA256 = '82f06ffd7c0db4232e00af1b8c90b596c28b49a77453d9a54ce5b99a16b3e0a5';

/** The folder beside the main bundle the build copies them into. */
export const OCR_FOLDER = 'ocr';

/** Each file as the build publishes it (beside the main bundle) and where it comes from. */
export const ocrBuildFiles = (): [published: string, source: string][] =>
  [OCR_SOURCES.core, OCR_SOURCES.wasm, OCR_SOURCES.model].map((source) => [
    `${OCR_FOLDER}/${basename(source)}`,
    source,
  ]);

/** The files beside a built main bundle (`mainDir`: out/main, inside the app when packaged). */
export const builtOcrFiles = (mainDir: string): OcrFiles => ({
  core: join(mainDir, OCR_FOLDER, basename(OCR_SOURCES.core)),
  wasm: join(mainDir, OCR_FOLDER, basename(OCR_SOURCES.wasm)),
  model: join(mainDir, OCR_FOLDER, basename(OCR_SOURCES.model)),
});

/** The files where they are in the repository (`root`): for the tests. */
export const sourceOcrFiles = (root: string): OcrFiles => ({
  core: join(root, OCR_SOURCES.core),
  wasm: join(root, OCR_SOURCES.wasm),
  model: join(root, OCR_SOURCES.model),
});
