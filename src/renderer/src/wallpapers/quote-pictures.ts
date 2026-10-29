import type { Quote, QuoteLang } from '../../../shared/idle';
import { QUOTE_LANGS } from '../../../shared/idle';
import { LANG_FONT_STACK } from '../render/fonts';

/*
 * The idle rotation's quotes as pictures (Session 55, Part 6; the owner's answer of 30 Oct: each quote's words drawn
 * on the rotation's background as a picture, in its wallpaper). Drawn here, in the operator window, which has the
 * bundled fonts: 1920 × 1080, black, each of the quote's languages in its own font, white and centred, as the rotation
 * showed a quote, its attribution under them in grey; then handed to the main process as a PNG, which keeps it in the
 * library and adds it to the wallpaper. Once each: the main process says which are still to draw.
 */

export const QUOTE_PICTURE = { width: 1920, height: 1080 } as const;
/** The words' size, as the rotation drew them (5% of the screen's height), and the attribution's. */
const WORDS_PX = Math.round(QUOTE_PICTURE.height * 0.05);
const BY_PX = Math.round(WORDS_PX * 0.6);
const LINE = 1.35;

/** Words broken into lines no wider than `max`, at spaces (a word longer than a line has a line of its own). */
export function wrapWords(text: string, max: number, width: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/u)) {
    let line = '';
    for (const word of paragraph.split(/\s+/u).filter((w) => w !== '')) {
      const tried = line === '' ? word : `${line} ${word}`;
      if (line !== '' && width(tried) > max) {
        lines.push(line);
        line = word;
      } else line = tried;
    }
    lines.push(line);
  }
  return lines;
}

/** The quote's languages, in the rotation's order: Gujarati, Hindi, English. */
const langsOf = (quote: Quote): QuoteLang[] => QUOTE_LANGS.filter((l) => quote.words[l] !== undefined);

/** One quote drawn as a PNG. */
export async function quotePicture(quote: Quote): Promise<Uint8Array> {
  const families = [...new Set(langsOf(quote).map((l) => LANG_FONT_STACK[l]))];
  // The bundled fonts in, before a word is drawn.
  await Promise.all(
    [...families, LANG_FONT_STACK.default].map((f) =>
      document.fonts.load(`${String(WORDS_PX)}px ${f}`, 'Aa ક क').catch(() => []),
    ),
  );
  const canvas = document.createElement('canvas');
  canvas.width = QUOTE_PICTURE.width;
  canvas.height = QUOTE_PICTURE.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('nothing to draw with');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const max = canvas.width - WORDS_PX * 4;
  const blocks: { lines: string[]; font: string; px: number; color: string }[] = [];
  for (const lang of langsOf(quote)) {
    const font = `${String(WORDS_PX)}px ${LANG_FONT_STACK[lang]}`;
    ctx.font = font;
    blocks.push({
      lines: wrapWords(quote.words[lang] ?? '', max, (s) => ctx.measureText(s).width),
      font,
      px: WORDS_PX,
      color: '#ffffff',
    });
  }
  if (quote.attribution.trim() !== '') {
    const font = `${String(BY_PX)}px ${LANG_FONT_STACK.default}`;
    ctx.font = font;
    blocks.push({
      lines: wrapWords(`— ${quote.attribution}`, max, (s) => ctx.measureText(s).width),
      font,
      px: BY_PX,
      color: '#c9ced8',
    });
  }
  const gap = WORDS_PX * 0.6;
  const heights = blocks.map((b) => b.lines.length * b.px * LINE);
  const total = heights.reduce((a, b) => a + b, 0) + gap * Math.max(0, blocks.length - 1);
  let y = (canvas.height - total) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  blocks.forEach((b, i) => {
    ctx.font = b.font;
    ctx.fillStyle = b.color;
    for (const line of b.lines) {
      ctx.fillText(line, canvas.width / 2, y + (b.px * LINE) / 2);
      y += b.px * LINE;
    }
    if (i < blocks.length - 1) y += gap;
  });
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  if (!blob) throw new Error('the picture could not be made');
  return new Uint8Array(await blob.arrayBuffer());
}

let drawing = false;

/** Draw the quotes still waiting, one at a time, and hand each to the main process (once each). */
export async function drawQuotes(waiting: { into: string; quotes: Quote[] }): Promise<void> {
  if (drawing) return;
  drawing = true;
  try {
    for (const quote of waiting.quotes) {
      let png: Uint8Array;
      try {
        png = await quotePicture(quote);
      } catch {
        continue;
      }
      await window.drashti.wallpapers.quotePicture(waiting.into, quote.id, png);
    }
  } finally {
    drawing = false;
  }
}
