// The captions engine decodes on a Windows without Visual C++ installed (Session 58, X2b; Codex A's suggestion after
// alpha.16). The Release run already checks that the four app-local Microsoft libraries beside whisper-server.exe are
// Microsoft's byte for byte and that the engine starts. Here, on the installed Drashti (scripts/check-installers.mjs):
// the engine decodes a generated clip (a tone and noise its own FFmpeg makes: nothing real) with the smallest model
// Drashti offers (main/speech/models.ts: downloaded here, checked against its SHA-256, never shipped), and the Visual
// C++ libraries the running engine has loaded are the app-local ones (its process's modules), so a PC without them
// in its system folder would load the same files. GitHub's Windows runners have them in System32, which is what this
// tells apart.
//
// The model is downloaded in three tries with pauses (scripts/download-source.mjs) and, in the Release run, kept in
// a cache by its pinned SHA-256 after the installers are uploaded (.github/workflows/release.yml), so a slow Hugging
// Face never stops a publish; whatever is there is checked against the SHA-256 before use.
//
//   node scripts/whisper-decode-check.mjs --sha256   prints sha256=<the model's pinned SHA-256> (the cache's key)
//   node scripts/whisper-decode-check.mjs --fetch    the model into DRASHTI_CAPTIONS_MODEL_DIR, checked
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadSource } from './download-source.mjs';

/** The smallest captions model Drashti offers, as main/speech/models.ts pins it (read from its text). */
export function modelPin(modelsTs) {
  const revision = /const REVISION = '([0-9a-f]{40})'/u.exec(modelsTs)?.[1];
  const base = /const BASE = `([^`]+)`/u.exec(modelsTs)?.[1];
  const small =
    /small:\s*\{\s*url:\s*`\$\{BASE\}\/([\w.-]+)`,\s*bytes:\s*([\d_]+),\s*sha256:\s*'([0-9a-f]{64})'/u.exec(
      modelsTs,
    );
  if (!revision || !base || !small)
    throw new Error('main/speech/models.ts: the small model’s pin was not found');
  return {
    file: small[1] ?? '',
    url: `${base.replace(/\$\{REVISION\}/u, revision)}/${small[1] ?? ''}`,
    bytes: Number((small[2] ?? '').replaceAll('_', '')),
    sha256: small[3] ?? '',
  };
}

/**
 * Whether the Visual C++ libraries a process loaded are the app-local ones: `modules` its modules' paths (Windows
 * paths), `folder` the engine's folder, `libraries` the four (shared/whisper-windows-runtime.json). Each one loaded
 * must come from the folder; the C runtime must be among them (else the list was not read right).
 */
export function runtimeLoaded(modules, folder, libraries) {
  const home = win32.resolve(folder).toLowerCase();
  const problems = [];
  const local = [];
  for (const dll of libraries) {
    const at = modules.filter((m) => win32.basename(m).toLowerCase() === dll.toLowerCase());
    for (const path of at)
      if (win32.dirname(win32.resolve(path)).toLowerCase() !== home) problems.push(`${dll} from ${path}`);
    if (at.length > 0 && at.every((path) => win32.dirname(win32.resolve(path)).toLowerCase() === home))
      local.push(dll);
  }
  if (!modules.some((m) => win32.basename(m).toLowerCase() === 'vcruntime140.dll'))
    problems.push('vcruntime140.dll is not among its modules: the list was not read');
  return problems.length === 0
    ? {
        ok: true,
        line: `the captions engine loaded its Visual C++ libraries from its own folder (${local.join(', ')})`,
      }
    : {
        ok: false,
        line: `the captions engine loaded Visual C++ libraries from outside its folder: ${problems.join('; ')}`,
      };
}

/** Whether the engine decoded the clip: it answered 200 with JSON that holds a text (noise may read as anything). */
export function decodeReply(status, body) {
  let reply = null;
  try {
    reply = JSON.parse(body);
  } catch {
    // Said below.
  }
  if (status === 200 && reply !== null && typeof reply === 'object' && typeof reply.text === 'string')
    return {
      ok: true,
      line: `the captions engine decoded a generated clip (it read ${JSON.stringify(reply.text.trim().slice(0, 40))})`,
    };
  return {
    ok: false,
    line: `the captions engine did not decode a generated clip (HTTP ${String(status)}: ${body.slice(0, 200)})`,
  };
}

/** The pin of the smallest model, read from this checkout's main/speech/models.ts. */
export const readModelPin = () =>
  modelPin(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'speech', 'models.ts'),
      'utf8',
    ),
  );

/** Where the model is kept for the check: the Release run's cached folder, else this computer's temp folder. */
export const modelDir = () =>
  process.env['DRASHTI_CAPTIONS_MODEL_DIR'] || join(tmpdir(), 'drashti-captions-model');

const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const pinned = (file, pin) =>
  existsSync(file) && statSync(file).size === pin.bytes && sha256Of(file) === pin.sha256;

/**
 * The model in `dir`: kept when the file there is the one pinned (as the cache restores it), else downloaded in
 * three tries with pauses (scripts/download-source.mjs; `fetch` and `pause` passed in for the unit test) and
 * checked against its size and SHA-256: one that is not the pinned one is removed and fails loudly.
 */
export async function fetchModel(
  pin,
  dir,
  fetch = (url) => globalThis.fetch(url, { redirect: 'follow' }),
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  const file = join(dir, pin.file);
  if (pinned(file, pin)) return file;
  rmSync(file, { force: true });
  await downloadSource(
    { name: `the captions model ${pin.file}`, url: pin.url, sha256: pin.sha256 },
    file,
    fetch,
    pause,
  );
  if (!pinned(file, pin)) {
    rmSync(file, { force: true });
    throw new Error(`the captions model downloaded is not the one pinned (size or SHA-256): ${pin.url}`);
  }
  return file;
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });

/**
 * The installed engine (`exe`) decodes a clip `ffmpeg` makes, with `model`, and the libraries it loaded are its own:
 * `[decoded, runtime]`, each `{ ok, line }`. The engine is stopped after.
 */
export async function decodeCheck({ exe, ffmpeg, model, workDir, libraries, timeoutMs = 180_000 }) {
  const wav = join(workDir, 'generated-clip.wav');
  const made = spawnSync(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:duration=3',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=color=pink:amplitude=0.05:duration=3',
      '-filter_complex',
      'amix=inputs=2:duration=shortest',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      '-y',
      wav,
    ],
    { encoding: 'utf8', timeout: 60_000, windowsHide: true },
  );
  if (made.status !== 0 || !existsSync(wav))
    return [
      { ok: false, line: `its FFmpeg did not make the generated clip: ${(made.stderr ?? '').slice(0, 200)}` },
    ];
  const port = await freePort();
  const requestPath = `/${randomBytes(16).toString('hex')}`;
  const args = [
    '-m',
    model,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--request-path',
    requestPath,
    '-t',
    '2',
    '--public',
    '',
  ];
  const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let said = '';
  child.stdout.on('data', (d) => (said = `${said}${String(d)}`.slice(-2000)));
  child.stderr.on('data', (d) => (said = `${said}${String(d)}`.slice(-2000)));
  try {
    const deadline = Date.now() + timeoutMs;
    let answer = null;
    while (answer === null && Date.now() < deadline && child.exitCode === null) {
      const form = new FormData();
      form.append('file', new Blob([readFileSync(wav)], { type: 'audio/wav' }), 'clip.wav');
      form.append('response_format', 'json');
      form.append('temperature', '0');
      try {
        const response = await fetch(`http://127.0.0.1:${String(port)}${requestPath}/inference`, {
          method: 'POST',
          body: form,
        });
        answer = { status: response.status, body: await response.text() };
      } catch {
        // Not listening yet (the model loads first).
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
    if (answer === null)
      return [
        {
          ok: false,
          line: `the captions engine never answered (exit ${String(child.exitCode)}): ${said.slice(-300)}`,
        },
      ];
    const decoded = decodeReply(answer.status, answer.body);
    const listed = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `(Get-Process -Id ${String(child.pid)}).Modules | ForEach-Object { $_.FileName }`,
      ],
      { encoding: 'utf8', timeout: 60_000, windowsHide: true },
    );
    const modules = (listed.stdout ?? '')
      .split(/\r?\n/u)
      .map((l) => l.trim())
      .filter(Boolean);
    return [decoded, runtimeLoaded(modules, win32.dirname(exe), libraries)];
  } finally {
    if (child.exitCode === null) child.kill();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pin = readModelPin();
  if (process.argv[2] === '--sha256') process.stdout.write(`sha256=${pin.sha256}\n`);
  else if (process.argv[2] === '--fetch') {
    const dir = modelDir();
    mkdirSync(dir, { recursive: true });
    const file = await fetchModel(pin, dir);
    console.log(`The captions model ${pin.file} is in ${file}, its SHA-256 the one pinned (${pin.sha256}).`);
  } else {
    process.stderr.write('usage: node scripts/whisper-decode-check.mjs --sha256 | --fetch\n');
    process.exit(2);
  }
}
