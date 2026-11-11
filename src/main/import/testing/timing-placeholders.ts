import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DECK_HEIGHT, DECK_WIDTH, type DeckMediaFiles, makeTestDeck, type TestDeckSlide } from './make-deck';

/*
 * Tests only (Session 56): the timing check's placeholders, made by code (tests/e2e/import-timing.spec.ts). Decks of
 * 6, 30 and 60 slides, each six slides alike: one with a transition and three bullets one click at a time, two
 * plain, one with two bullets one click at a time and no transition, two plain (a third with animations, half that
 * nothing ever moves on). And PDFs of 10 and 100 pages, each page a generated picture (FFmpeg's test pattern, ten
 * of them taken in turn, each page its own copy) with placeholder words. Every word is made up.
 */

const IN = 914_400;

/** Made-up words, taken in turn. */
const WORDS = [
  'Velora',
  'tamsin',
  'orvel',
  'praxis',
  'tamber',
  'quessa',
  'marion',
  'pellum',
  'sennet',
  'ilo',
  'drovan',
  'kessa',
  'lumen',
  'varo',
  'tessel',
  'brindo',
];
const words = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => WORDS[(from + i) % WORDS.length] ?? '').join(' ');

/** Which kind each slide of six is: with a transition and builds, plain, plain, builds only, plain, plain. */
export const PATTERN = ['transition', 'plain', 'plain', 'builds', 'plain', 'plain'] as const;
export type PlaceholderKind = (typeof PATTERN)[number];
export const kindOf = (i: number): PlaceholderKind => PATTERN[i % PATTERN.length] ?? 'plain';

/** The colours the slides take in turn (dark, so white words read on them). */
const BACKGROUNDS = ['1B2A4A', '0F3D2E', '3A1F4D', '4A2A1B', '1F3A4D', '2E2E2E'];

/** The slides of a placeholder deck of `n` slides. */
export function placeholderSlides(n: number): TestDeckSlide[] {
  return Array.from({ length: n }, (_, i): TestDeckSlide => {
    const kind = kindOf(i);
    const bullets = kind === 'transition' ? 3 : kind === 'builds' ? 2 : 3;
    return {
      key: `slide-${String(i + 1)}`,
      bg: BACKGROUNDS[i % BACKGROUNDS.length] ?? '1B2A4A',
      transition: kind === 'transition' ? { kind: 'fade', dur: 700 } : { kind: 'none', dur: 0 },
      notes: `Placeholder notes for slide ${String(i + 1)}: ${words(i, 6)}.`,
      shapes: [
        {
          id: 2,
          type: 'text',
          name: 'Title',
          x: 0.6 * IN,
          y: 0.35 * IN,
          w: DECK_WIDTH - 1.2 * IN,
          h: 1.0 * IN,
          paras: [{ text: `${String(i + 1)}. ${words(i * 3, 3)}`, size: 40, bold: true }],
        },
        {
          id: 3,
          type: 'text',
          name: 'Bullets',
          x: 0.8 * IN,
          y: 1.6 * IN,
          w: 7.2 * IN,
          h: 3.6 * IN,
          paras: Array.from({ length: bullets }, (_, k) => ({
            text: words(i * 5 + k * 2, 4),
            size: 30,
            bullet: true,
          })),
        },
        {
          id: 4,
          type: 'pic',
          name: 'Pattern',
          media: i % 2 === 0 ? 'pic1' : 'pic2',
          x: 8.4 * IN,
          y: 1.8 * IN,
          w: 4.0 * IN,
          h: 2.25 * IN,
        },
        {
          id: 5,
          type: 'shape',
          name: 'Bar',
          geom: 'rect',
          fill: 'F5D90A',
          x: 0,
          y: DECK_HEIGHT - 0.3 * IN,
          w: DECK_WIDTH,
          h: 0.3 * IN,
        },
      ],
      effects:
        kind === 'plain'
          ? []
          : Array.from({ length: bullets }, (_, k) => ({
              kind: 'fade' as const,
              target: 3,
              para: k,
              dur: 500,
              start: 'click' as const,
            })),
    };
  });
}

/** A placeholder deck of `n` slides, as PowerPoint writes one. */
export function placeholderDeck(n: number, media: DeckMediaFiles): Buffer {
  return makeTestDeck(placeholderSlides(n), media);
}

/** Ten pictures (FFmpeg's test pattern in ten hues, 1280 × 720, JPEG), made once into `dir`. */
export function placeholderJpegs(ffmpeg: string, dir: string): Buffer[] {
  mkdirSync(dir, { recursive: true });
  return Array.from({ length: 10 }, (_, i) => {
    const file = join(dir, `pattern-${String(i)}.jpg`);
    if (!existsSync(file)) {
      const r = spawnSync(ffmpeg, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=s=1280x720:d=1,hue=h=${String(i * 36)}`,
        '-frames:v',
        '1',
        '-q:v',
        '3',
        file,
      ]);
      if (r.status !== 0) throw new Error(r.stderr.toString());
    }
    return readFileSync(file);
  });
}

/** JPEG's own size, from its first frame header (SOF0 to SOF15, but DHT, JPG and DAC). */
export function jpegSize(jpeg: Buffer): { width: number; height: number } {
  let at = 2;
  while (at + 9 < jpeg.length) {
    if (jpeg[at] !== 0xff) throw new Error('Not a JPEG');
    const marker = jpeg[at + 1] ?? 0;
    const length = jpeg.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { height: jpeg.readUInt16BE(at + 5), width: jpeg.readUInt16BE(at + 7) };
    at += 2 + length;
  }
  throw new Error('No frame in the JPEG');
}

/**
 * A placeholder PDF of `pages` 16:9 pages (960 × 540 points), each with one of `jpegs` (its own copy in the file,
 * so each is read for itself) and three lines of placeholder words. Written by hand, as the tests' PDFs are.
 */
export function placeholderPdf(pages: number, jpegs: readonly Buffer[]): Buffer {
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (let p = 0; p < pages; p++) {
    const jpeg = jpegs[p % jpegs.length];
    if (!jpeg) throw new Error('No pictures to place');
    const { width, height } = jpegSize(jpeg);
    const image = add(
      `<< /Type /XObject /Subtype /Image /Width ${String(width)} /Height ${String(height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${String(jpeg.length)} >>\nstream\n${jpeg.toString('latin1')}\nendstream`,
    );
    const lines = [
      `0.1 0.12 0.2 rg`,
      '0 0 960 540 re f',
      'q 520 0 0 292 400 150 cm /Pattern Do Q',
      '1 1 1 rg',
      'BT /F1 34 Tf 40 470 Td',
      `(${String(p + 1)}. ${words(p * 3, 3)}) Tj`,
      'ET',
      ...[0, 1, 2].flatMap((k) => [
        'BT /F1 22 Tf',
        `48 ${String(380 - k * 60)} Td`,
        `(${words(p * 5 + k * 2, 3)}) Tj`,
        'ET',
      ]),
    ].join('\n');
    const content = add(
      `<< /Length ${String(Buffer.byteLength(lines, 'latin1'))} >>\nstream\n${lines}\nendstream`,
    );
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Contents ${String(content)} 0 R /Resources << /Font << /F1 ${String(font)} 0 R >> /XObject << /Pattern ${String(image)} 0 R >> >> >>`,
      ),
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${String(k)} 0 R`).join(' ')}] /Count ${String(kids.length)} >>`;
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
