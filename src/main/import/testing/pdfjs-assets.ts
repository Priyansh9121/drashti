import { join } from 'node:path';

/** Node factories read filesystem paths, but PDF.js requires a URL-style trailing slash. */
export function nodePdfAssets(root: string, paths: { join(...parts: string[]): string } = { join }) {
  return {
    standardFontDataUrl: paths.join(root, 'standard_fonts') + '/',
    cMapUrl: paths.join(root, 'cmaps') + '/',
    cMapPacked: true,
    wasmUrl: paths.join(root, 'wasm') + '/',
  };
}
