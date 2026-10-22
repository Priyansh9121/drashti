#!/usr/bin/env node
// The picture in the window of Drashti's Mac disk image (Session 50, section 11), made from one source:
// build/background.svg, drawn at the window's size in points (660 x 400). Drashti has no paid Developer ID,
// so the picture shows the free way: drag Drashti to Applications, then the first time, System Settings ›
// Privacy & Security › Open Anyway.
//
//   node scripts/make-dmg-background.mjs
//
//   build/background.png     the window's size, for a usual screen (660 x 400 px)
//   build/background@2x.png  twice that, for a Retina screen: electron-builder finds it beside the first and
//                            joins the two, and the window takes the picture's size (electron-builder.yml)
//
// The words are drawn in Noto Sans, the font the app bundles (@fontsource/noto-sans, LICENSES/fonts/), and
// each must fit its box. Each PNG carries the source's SHA-256 in a text chunk ("Source"), so the unit test
// (src/main/release-checks/dmg-background.test.ts) can tell they were made from the current source. The
// pictures are drawn by Electron's Chromium in a window that never shows
// (scripts/make-dmg-background-render.mjs), as scripts/make-icons.mjs draws the icon.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { crc32 } from 'node:zlib';
import { pngSize } from './icon-files.mjs';

const SOURCE = resolve('build', 'background.svg');
const require = createRequire(import.meta.url);
const FONTS = join(dirname(require.resolve('@fontsource/noto-sans')), 'files');
const WEIGHTS = [400, 500, 700];
const PICTURES = [
  { name: 'background.png', scale: 1 },
  { name: 'background@2x.png', scale: 2 },
];
/** Room kept clear at the bottom (a Finder window's title bar can take it), and beside a chip's words. */
const BOTTOM = 28;
const PADDING = 8;

const svg = readFileSync(SOURCE, 'utf8');
const root = /<svg\b[^>]*>/u.exec(svg)?.[0] ?? '';
const number = (name) => Number(new RegExp(`\\s${name}="([\\d.]+)"`, 'u').exec(root)?.[1] ?? NaN);
const [width, height] = [number('width'), number('height')];
if (
  !Number.isInteger(width) ||
  !Number.isInteger(height) ||
  !root.includes(`viewBox="0 0 ${String(width)} ${String(height)}"`)
)
  throw new Error('build/background.svg needs a whole width and height, and viewBox="0 0 <width> <height>"');
const sha256 = createHash('sha256').update(readFileSync(SOURCE)).digest('hex');

/** A PNG with text chunks (tEXt, Latin-1) put in after its header. */
function withTexts(png, texts) {
  const chunks = Object.entries(texts).map(([keyword, text]) => {
    const data = Buffer.from(`${keyword}\0${text}`, 'latin1');
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write('tEXt', 4, 'latin1');
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
    return chunk;
  });
  const afterHeader = 8 + 12 + png.readUInt32BE(8);
  return Buffer.concat([png.subarray(0, afterHeader), ...chunks, png.subarray(afterHeader)]);
}

/** What is wrong with where the words were drawn: off the picture, too low, or not inside their chip. */
function misplaced(words) {
  const wrong = [];
  for (const { words: said, box, chip } of words) {
    const [x, y, w, h] = box;
    if (x < 0 || y < 0 || x + w > width || y + h > height - BOTTOM)
      wrong.push(`"${said}" runs off the picture or into its bottom ${String(BOTTOM)} points`);
    if (chip) {
      const [cx, cy, cw, ch] = chip;
      if (x < cx + PADDING || x + w > cx + cw - PADDING || y < cy || y + h > cy + ch)
        wrong.push(`"${said}" (${String(w)} points wide) does not fit its chip (${String(cw)} wide)`);
    }
  }
  return wrong;
}

const work = mkdtempSync(join(tmpdir(), 'drashti-dmg-background-'));
try {
  const job = {
    out: work,
    svg,
    width,
    height,
    fonts: WEIGHTS.map((weight) => ({
      weight,
      file: join(FONTS, `noto-sans-latin-${String(weight)}-normal.woff2`),
    })),
    pictures: PICTURES,
  };
  writeFileSync(join(work, 'job.json'), JSON.stringify(job));
  const env = { ...process.env };
  delete env['ELECTRON_RUN_AS_NODE'];
  const drawn = spawnSync(
    require('electron'),
    [resolve('scripts', 'make-dmg-background-render.mjs'), join(work, 'job.json')],
    { env, encoding: 'utf8', timeout: 120_000 },
  );
  if (drawn.status !== 0)
    throw new Error(`Electron could not draw the picture:\n${drawn.stdout}${drawn.stderr}`);
  const report = JSON.parse(readFileSync(join(work, 'report.json'), 'utf8'));

  for (const { name, scale, fonts, words } of report.pictures) {
    const missing = WEIGHTS.filter((weight) => !fonts.includes(`Noto Sans ${String(weight)}`));
    if (missing.length > 0)
      throw new Error(`${name}: Noto Sans ${missing.join(', ')} did not load (loaded: ${fonts.join(', ')})`);
    const wrong = misplaced(words);
    if (wrong.length > 0) throw new Error(`${name}: ${wrong.join('; ')}`);
    const png = readFileSync(join(work, name));
    const size = pngSize(png);
    if (size?.width !== width * scale || size.height !== height * scale)
      throw new Error(`${name} is not ${String(width * scale)} x ${String(height * scale)} px`);
    const made = withTexts(png, {
      Source: `build/background.svg ${sha256}`,
      Software: 'scripts/make-dmg-background.mjs',
    });
    writeFileSync(resolve('build', name), made);
    console.log(
      `build/${name}: ${String(size.width)} x ${String(size.height)} px, ${(made.length / 1024).toFixed(1)} KB`,
    );
  }
  // The words' widths, for fitting the chips after a change to them.
  for (const { words: said, box, chip } of report.pictures[0]?.words ?? [])
    console.log(
      `  "${said}": ${String(box[2])} points wide${chip ? ` in a chip ${String(chip[2])} wide` : ''}`,
    );
} finally {
  rmSync(work, { recursive: true, force: true });
}
