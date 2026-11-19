// Video out (x30): this computer's video out programs (scripts/fetch-video-out.mjs: Syphon on a Mac, Spout on Windows)
// send a picture that the tests' receiver on this computer reads back the right way up, in each format the stream's
// page gives (I420, NV12, BGRA, RGBA). Generated frames only, nothing over a network. Each format's picture is a
// different pair of colours, top half and bottom half, and the receiver must see that pair in its top and bottom
// quarters; the sender must then stop by itself when its input ends.
//
//   node scripts/check-video-out.mjs     (after node scripts/fetch-video-out.mjs; exit 1 with what is wrong)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROGRAMS } from './fetch-video-out.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'Drashti video out check';
const W = 1280;
const H = 720;

/** BT.709 limited range, as Chromium's captures come: [Y, U, V] of a colour. */
function yuv([r, g, b]) {
  const y = 16 + (0.2126 * r + 0.7152 * g + 0.0722 * b) * (219 / 255);
  const u = 128 + (-0.1146 * r - 0.3854 * g + 0.5 * b) * (224 / 255);
  const v = 128 + (0.5 * r - 0.4542 * g - 0.0458 * b) * (224 / 255);
  return [y, u, v].map((n) => Math.round(n));
}

const RED = [220, 20, 20];
const GREEN = [20, 220, 20];
const BLUE = [20, 20, 220];
const CASES = [
  { format: 'I420', code: 1, top: RED, bottom: BLUE },
  { format: 'NV12', code: 2, top: GREEN, bottom: RED },
  { format: 'BGRA', code: 3, top: BLUE, bottom: GREEN },
  { format: 'RGBA', code: 4, top: RED, bottom: GREEN },
];

/** One frame, header and bytes, its top half one colour and its bottom half another. */
function frame({ format, code, top, bottom }) {
  const header = Buffer.alloc(16);
  header.write('DVO1', 0, 'latin1');
  header.writeUInt32LE(code, 4);
  header.writeUInt32LE(W, 8);
  header.writeUInt32LE(H, 12);
  const colourAt = (row) => (row < H / 2 ? top : bottom);
  if (format === 'BGRA' || format === 'RGBA') {
    const data = Buffer.alloc(W * H * 4);
    for (let row = 0; row < H; row++) {
      const [r, g, b] = colourAt(row);
      const px = format === 'BGRA' ? [b, g, r, 255] : [r, g, b, 255];
      for (let x = 0; x < W; x++) data.set(px, (row * W + x) * 4);
    }
    return Buffer.concat([header, data]);
  }
  const cw = W / 2;
  const ch = H / 2;
  const luma = Buffer.alloc(W * H);
  for (let row = 0; row < H; row++) luma.fill(yuv(colourAt(row))[0], row * W, (row + 1) * W);
  const u = Buffer.alloc(cw * ch);
  const v = Buffer.alloc(cw * ch);
  const uv = Buffer.alloc(cw * ch * 2);
  for (let row = 0; row < ch; row++) {
    const [, cu, cv] = yuv(colourAt(row * 2));
    u.fill(cu, row * cw, (row + 1) * cw);
    v.fill(cv, row * cw, (row + 1) * cw);
    for (let x = 0; x < cw; x++) uv.set([cu, cv], (row * cw + x) * 2);
  }
  return Buffer.concat(format === 'I420' ? [header, luma, u, v] : [header, luma, uv]);
}

/** Which of red, green and blue a colour is, clearly (one channel 60 above both others), or null. */
function named(rgb) {
  if (!rgb) return null;
  const i = rgb.indexOf(Math.max(...rgb));
  return rgb.every((c, j) => j === i || rgb[i] - c > 60) ? ['red', 'green', 'blue'][i] : null;
}
const nameOf = (rgb) => named(rgb) ?? JSON.stringify(rgb);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function seen(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const platform = process.platform;
  const programs = PROGRAMS[platform];
  if (!programs) throw new Error(`Video out has no programs on ${platform}.`);
  const dir = join(root, 'vendor', 'video-out', `${platform}-${process.arch}`);
  const temp = mkdtempSync(join(tmpdir(), 'drashti-video-out-check-'));
  const file = join(temp, 'received.json');
  const receiver = spawn(join(dir, programs.receiver), ['--name', NAME, '--out', file], {
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  const problems = [];
  try {
    for (const c of CASES) {
      const sender = spawn(join(dir, programs.sender), ['--name', NAME], {
        stdio: ['pipe', 'inherit', 'inherit'],
        windowsHide: true,
      });
      const exited = new Promise((resolve) => sender.on('exit', (code) => resolve(code)));
      const bytes = frame(c);
      const want = [named(c.top), named(c.bottom)];
      let got = null;
      // Frames every 50 ms until the receiver sees this picture (up to 20 s).
      for (let i = 0; i < 400; i++) {
        if (!sender.stdin.write(bytes)) await new Promise((resolve) => sender.stdin.once('drain', resolve));
        await sleep(50);
        const s = seen(file);
        got = s ? [nameOf(s.top), nameOf(s.bottom)] : null;
        if (s && s.width === W && s.height === H && got[0] === want[0] && got[1] === want[1]) break;
      }
      sender.stdin.end();
      const code = await Promise.race([
        exited,
        sleep(10_000).then(() => 'still running 10 s after its input ended'),
      ]);
      const ok = got?.[0] === want[0] && got[1] === want[1];
      console.log(
        `${c.format}: sent ${want.join(' over ')}, received ${got ? got.join(' over ') : 'nothing'}; the sender ${
          code === 0 ? 'stopped by itself' : `ended with ${String(code)}`
        }`,
      );
      if (!ok) problems.push(`${c.format}: the receiver did not see ${want.join(' over ')}`);
      if (code !== 0) {
        sender.kill();
        problems.push(`${c.format}: the sender did not stop cleanly (${String(code)})`);
      }
    }
  } finally {
    receiver.kill();
    rmSync(temp, { recursive: true, force: true });
  }
  if (problems.length > 0) throw new Error(problems.join('\n'));
  console.log(`Video out on ${platform}-${process.arch}: every format arrives the right way up.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
