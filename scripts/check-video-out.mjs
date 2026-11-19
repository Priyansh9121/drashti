// Video out (x30): this computer's video out programs (scripts/fetch-video-out.mjs: Syphon on a Mac, Spout on Windows)
// send a picture that the tests' receiver on this computer reads back the right way up, in each format the stream's
// page gives (I420, NV12, BGRA, RGBA). Generated frames only, nothing over a network. Each format's picture is a
// different pair of colours, top half and bottom half, and the receiver must see that pair in its top and bottom
// quarters; the sender must then stop by itself when its input ends.
// Then the sender alone, as the installers carry it (electron-builder.yml takes it by itself, never what its build
// leaves beside it): copied into a new, empty folder, it must start there, say "ready" and stop by itself when its
// input ends (x39: on Windows it once needed the manifest file its build left beside it). On Windows the log also
// shows what the build left beside the sender, where its manifest is, the DLLs it loads and what it imports from them
// by number alone (dumpbin, from the Visual Studio tools the build uses).
//
//   node scripts/check-video-out.mjs     (after node scripts/fetch-video-out.mjs; exit 1 with what is wrong)
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROGRAMS, vcvars } from './fetch-video-out.mjs';

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

/** An exit code as the log should say it: Windows' loader stops a program with a status before it runs. */
function exitText(code) {
  if (typeof code !== 'number') return String(code);
  if (code >= 0 && code < 0x10000) return `exit ${String(code)}`;
  const status = `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  const why = {
    '0xC0000135': 'a DLL it needs was not found',
    '0xC0000138': 'a DLL does not have a function it imports by number',
    '0xC0000139': 'a DLL does not have a function it imports by name',
  }[status];
  return `exit ${String(code)} = ${status}${why ? `, ${why}` : ''}`;
}

/** The dependent assemblies a manifest asks for (name and version), from its text. */
const assembliesIn = (xml) =>
  [...xml.matchAll(/<dependentAssembly>\s*<assemblyIdentity\b([^>]*)>/gu)].map(([, attributes]) => {
    const value = (name) => new RegExp(`\\b${name}=['"]([^'"]*)['"]`, 'u').exec(attributes)?.[1] ?? '?';
    return `${value('name')} ${value('version')}`;
  });
const asking = (xml) => {
  const wants = assembliesIn(xml);
  return wants.length > 0 ? `asking for ${wants.join(', ')}` : 'asking for no other assembly';
};

/**
 * For the log, never failing the check (Windows): what the build left beside the sender, where the sender's manifest
 * is (inside the program, or a file beside it that an installer taking the program alone leaves behind), the DLLs it
 * loads and what it imports from them by number alone (dumpbin /dependents and /imports, in the Visual Studio
 * environment the build uses).
 */
function describeSender(dir, sender) {
  const program = join(dir, sender);
  const beside = readdirSync(dir).sort();
  console.log(`Beside the built sender: ${beside.join(', ')}`);
  const inside = /<assembly\b[\s\S]*?<\/assembly>/u.exec(readFileSync(program, 'latin1'))?.[0];
  console.log(`The sender's manifest inside it: ${inside ? asking(inside) : 'none'}`);
  for (const name of beside.filter((f) => f.toLowerCase().endsWith('.manifest')))
    console.log(`A manifest file beside it: ${name}, ${asking(readFileSync(join(dir, name), 'utf8'))}`);
  const work = mkdtempSync(join(tmpdir(), 'drashti-video-out-dumpbin-'));
  try {
    const script = join(work, 'dumpbin.cmd');
    writeFileSync(
      script,
      [
        '@echo off',
        `call "${vcvars()}" >nul || exit /b 1`,
        `dumpbin /nologo /dependents "${program}" || exit /b 1`,
        'echo ---imports---',
        `dumpbin /nologo /imports "${program}" || exit /b 1`,
        '',
      ].join('\r\n'),
    );
    const r = spawnSync(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/c', script], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) throw r.error;
    if (r.status !== 0)
      throw new Error(`dumpbin failed (${String(r.status)}): ${(r.stderr || r.stdout).trim()}`);
    const [dependents, imports = ''] = r.stdout.split('---imports---');
    const dll = /^\s+(\S+\.dll)\s*$/iu;
    const loads = dependents.split(/\r?\n/u).flatMap((line) => dll.exec(line)?.[1] ?? []);
    console.log(`The sender loads (dumpbin /dependents): ${loads.join(', ') || dependents.trim()}`);
    const byNumber = [];
    let from = '?';
    for (const line of imports.split(/\r?\n/u)) {
      const name = dll.exec(line)?.[1];
      if (name) from = name;
      const ordinal = /^\s+Ordinal\s+(\d+)\s*$/u.exec(line)?.[1];
      if (ordinal) byNumber.push(`${from} ordinal ${ordinal}`);
    }
    console.log(
      `Imported by number alone (dumpbin /imports): ${byNumber.length > 0 ? byNumber.join(', ') : 'nothing'}`,
    );
  } catch (error) {
    console.log(`dumpbin not run: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The sender alone in a new, empty folder, as the installers carry it: it must start there, say "ready" and stop by
 * itself when its input ends (as the packaged check, scripts/check-ffmpeg.mjs --packaged, then asks of each app's).
 * Returns what is wrong, or null.
 */
async function aloneAsPackaged(dir, sender) {
  const alone = mkdtempSync(join(tmpdir(), 'drashti-video-out-alone-'));
  try {
    const program = join(alone, sender);
    copyFileSync(join(dir, sender), program);
    const child = spawn(program, ['--name', `${NAME} (alone)`], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    child.stdin.on('error', () => {});
    child.stdin.end();
    let timer;
    const code = await new Promise((resolve) => {
      child.on('error', (error) => resolve(`not started: ${error.message}`));
      child.on('close', (c) => resolve(c));
      timer = setTimeout(() => resolve('still running 30 s after its input ended'), 30_000);
    });
    clearTimeout(timer);
    if (typeof code !== 'number') child.kill();
    const said = out.trim().split(/\r?\n/u).join(' | ') || 'nothing';
    const ok = code === 0 && /^ready$/mu.test(out);
    console.log(
      `Alone in a new folder, as packaged: ${ok ? 'started, said ready and stopped by itself' : `FAILED (${exitText(code)})`}; it said: ${said}`,
    );
    return ok
      ? null
      : `alone in a new folder, as packaged, the sender did not start, say ready and stop by itself (${exitText(code)})`;
  } finally {
    try {
      rmSync(alone, { recursive: true, force: true });
    } catch {
      // Windows can hold a folder a moment after its program ends; the system's temp folder is cleared anyway.
    }
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
  if (platform === 'win32') describeSender(dir, programs.sender);
  const alone = await aloneAsPackaged(dir, programs.sender);
  if (alone) problems.push(alone);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  console.log(
    `Video out on ${platform}-${process.arch}: every format arrives the right way up, and the sender runs alone as packaged.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
