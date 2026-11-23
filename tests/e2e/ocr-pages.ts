import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/*
 * Book OCR's test pages (alpha.21), drawn while the test runs (nothing committed): placeholder Gujarati lines
 * (src/main/ocr/testing/scanned-pages.ts) in Noto Sans Gujarati, black on a white A4 page at 150 pixels an inch, as a
 * scanner makes one; as a PNG and as a JPEG (a scanned PDF's pages are JPEGs).
 */

const fontFile = (): string =>
  createRequire(join(process.cwd(), 'package.json')).resolve(
    '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-gujarati-400-normal.woff2',
  );

export interface DrawnPage {
  png: Buffer;
  jpeg: Buffer;
  width: number;
  height: number;
}

/** One A4 page of `lines` (a blank line leaves a gap), drawn in `page` (any of Drashti's windows). */
export async function drawScannedPage(page: Page, lines: readonly string[]): Promise<DrawnPage> {
  const font = readFileSync(fontFile()).toString('base64');
  const drawn = await page.evaluate(
    async ({ font, lines }) => {
      const bytes = Uint8Array.from(atob(font), (c) => c.charCodeAt(0));
      const face = new FontFace('Placeholder Scan Gujarati', bytes.buffer);
      await face.load();
      document.fonts.add(face);
      // A4 at 150 pixels an inch; the words 12 points high, as a book's.
      const width = 1240;
      const height = 1754;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#000000';
      ctx.font = '36px "Placeholder Scan Gujarati"';
      let y = 160;
      for (const line of lines) {
        if (line !== '') ctx.fillText(line, 120, y);
        y += 62;
      }
      document.fonts.delete(face);
      return {
        png: canvas.toDataURL('image/png').split(',')[1] ?? '',
        jpeg: canvas.toDataURL('image/jpeg', 0.92).split(',')[1] ?? '',
        width,
        height,
      };
    },
    { font, lines },
  );
  return {
    png: Buffer.from(drawn.png, 'base64'),
    jpeg: Buffer.from(drawn.jpeg, 'base64'),
    width: drawn.width,
    height: drawn.height,
  };
}
