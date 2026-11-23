// The caption models CI measures caption AI with (CAP-CI-1 (a); the owner, 24 Nov 2026: "Yes, all three"): for the
// Performance workflow's `captions` input and the Route C test in a built app, never shipped, never in an installer
// (electron-builder takes nothing from the cache folder), never given to anyone.
//   node scripts/fetch-caption-models.mjs [--cache <dir>] <id>…   each one downloaded (or reused) and checked; one
//                                                                 line "<id>=<the file>" per id
//   node scripts/fetch-caption-models.mjs --sha256 <id>…          their pinned SHA-256s (CI's cache key)
//   node scripts/fetch-caption-models.mjs --list                  the ids, with what each is and its licence
// Each one is a fixed file (its name, size and SHA-256 pinned here): alpha.22's two caption packs (made from
// AI4Bharat's official IndicConformer checkpoints, each pack naming its checkpoint's SHA-256; their provenance:
// docs/admin-guide.md and the packs' own lists), and the small captions model as main/speech/models.ts pins it. A
// pack's address may be set (DRASHTI_CAPTION_PACK_URL_GU, DRASHTI_CAPTION_PACK_URL_HI) to another release page of
// Drashti's own repository holding the same file (where the packs are put is the release lead's choice); empty, the
// release page below. Any other address is refused before it is asked. A
// download is tried three times (download-source.mjs), may be redirected only to the hosts its source names, and is
// refused (and removed) unless its size and SHA-256 are the pinned ones. Kept in <cache>/<sha256>/<name>, so CI's
// cache is keyed by the SHA-256s; a cached copy is checked again before every use.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { downloadSource } from './download-source.mjs';
import { readModelPin } from './whisper-decode-check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Drashti's own release pages, and the caption packs' own (the owner, 24 Nov 2026: "Yes, prerelease page"): a
 * prerelease, never Latest (so the update check and the kit check never read it), holding only the two zips and
 * SHA256SUMS-packs.txt.
 */
const RELEASES = '/Priyansh9121/drashti/releases/download/';
const RELEASE = `https://github.com${RELEASES}caption-packs-2026-11-24`;
/** GitHub sends a release file's download on to its own storage. */
const GITHUB_HOSTS = Object.freeze([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
/** Hugging Face sends a large file's download on to its own storage (names ending .hf.co). */
const HUGGING_FACE_HOSTS = Object.freeze(['huggingface.co', '.huggingface.co', '.hf.co']);

const pack = (language, name, bytes, sha256) =>
  Object.freeze({
    name,
    url: `${RELEASE}/${name}`,
    urlSetting: `DRASHTI_CAPTION_PACK_URL_${language === 'Gujarati' ? 'GU' : 'HI'}`,
    releases: RELEASES,
    hosts: GITHUB_HOSTS,
    bytes,
    sha256,
    licence: 'MIT (AI4Bharat IndicConformer; the licence text is inside the pack)',
    what: `alpha.22's ${language} caption pack (Route C, IndicConformer CTC, int8), as a Main imports it`,
  });

const small = readModelPin();

/** The caption models, by id. Nothing else is ever fetched. */
export const CAPTION_MODELS = Object.freeze({
  'pack-gu-indicconformer-int8': pack(
    'Gujarati',
    'drashti-captions-gu-indicconformer-ctc-int8.zip',
    177_169_639,
    '89652a0dde1aaefc5c5cfc65c537c202261d891f1fc6351d20ed91da31a8fa19',
  ),
  'pack-hi-indicconformer-int8': pack(
    'Hindi',
    'drashti-captions-hi-indicconformer-ctc-int8.zip',
    177_270_115,
    'ba6e5ed19c6641bc2e56e7f4329961fff6b1dc6c6bad5a2eb6c1741bab6b74a2',
  ),
  'whisper-small': Object.freeze({
    name: small.file,
    url: small.url,
    hosts: HUGGING_FACE_HOSTS,
    bytes: small.bytes,
    sha256: small.sha256,
    licence: 'MIT (OpenAI Whisper, in whisper.cpp’s ggml form)',
    what: 'the small captions model (Standard on Windows and Intel Macs), as main/speech/models.ts pins it',
  }),
});

/** Where the models are kept: this computer's cache folder (CI caches it), outside any checkout. */
export const DEFAULT_CACHE = join(homedir(), '.cache', 'drashti', 'caption-models');

/** How long one try may take: 177-488 MB, which CI's runners fetch in well under a minute. */
const TRY_MS = 600_000;
/** Redirects followed at most, each one checked. */
const HOPS = 5;

/** Whether `url` is https at one of the source's hosts (a name given with a leading dot: any name ending so). */
export function hostAllowed(source, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  return source.hosts.some((h) =>
    h.startsWith('.') ? host.endsWith(h) && host.length > h.length : host === h,
  );
}

/** Throws when `dir` is the checkout or inside it (its vendor folder goes into the installers). */
export function refuseInsideCheckout(checkout, dir) {
  const from = relative(resolve(checkout), resolve(dir));
  if (from === '' || (!from.startsWith('..') && !isAbsolute(from)))
    throw new Error(`The caption models are never kept inside the checkout (${dir} is inside ${checkout}).`);
}

async function sha256Of(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const fits = async (file, source) =>
  existsSync(file) && statSync(file).size === source.bytes && (await sha256Of(file)) === source.sha256;

/**
 * Where the source is fetched from: the address its setting gives (another release page of the same repository: one
 * tag, then the same file name, nothing more), else its pinned one. An address set otherwise is refused.
 */
function addressOf(source, env) {
  const set = source.urlSetting ? (env[source.urlSetting] ?? '').trim() : '';
  if (!set) return source.url;
  let parsed;
  try {
    parsed = new URL(set);
  } catch {
    parsed = null;
  }
  const releases = source.releases ?? '';
  const rest =
    releases && parsed?.pathname.startsWith(releases) ? parsed.pathname.slice(releases.length) : '';
  const [tag = '', file = '', ...more] = rest.split('/');
  if (
    !parsed ||
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    !/^[\w.-]{1,100}$/u.test(tag) ||
    file !== source.name ||
    more.length > 0
  )
    throw new Error(
      `refused ${source.name}: ${source.urlSetting ?? ''} must be a release page of github.com${releases} with the same file name, not ${set}`,
    );
  return parsed.href;
}

/**
 * A fetch that goes only where the source allows: every address (the first and each redirect's) must be https at
 * one of its hosts, else the download is refused before that address is asked.
 */
function guarded(source, fetch) {
  return async (url) => {
    let at = url;
    for (let hop = 0; hop <= HOPS; hop += 1) {
      if (!hostAllowed(source, at))
        throw new Error(`refused ${source.name}: ${at} is not one of its hosts (${source.hosts.join(', ')})`);
      const response = await fetch(at, { redirect: 'manual' });
      const to = response.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(response.status) || !to) return response;
      at = new URL(to, at).href;
    }
    throw new Error(`refused ${source.name}: more than ${String(HOPS)} redirects`);
  };
}

/**
 * The model `id`, downloaded (or reused from the cache) and checked: the path of a file whose size and SHA-256 are
 * the pinned ones. Throws for an unknown id, a cache inside the checkout, an address or redirect the source does not
 * allow, a download that could not be had after three tries, or one that is not the pinned file (removed, never
 * used). `fetch` and `pause` are passed in, so the unit test needs neither the network nor the wait.
 */
export async function fetchCaptionModel(
  id,
  { cacheDir, fetch, pause, table = CAPTION_MODELS, checkout = root, env = process.env },
) {
  const source = Object.hasOwn(table, id) ? table[id] : undefined;
  if (!source) throw new Error(`unknown caption model "${id}" (known: ${Object.keys(table).join(', ')})`);
  refuseInsideCheckout(checkout, cacheDir);
  const url = addressOf(source, env);
  if (!hostAllowed(source, url)) throw new Error(`refused ${source.name}: ${url} is not one of its hosts`);
  const folder = join(cacheDir, source.sha256);
  const file = join(folder, source.name);
  if (await fits(file, source)) return file;
  rmSync(file, { force: true });
  mkdirSync(folder, { recursive: true });
  const partial = `${file}.partial`;
  rmSync(partial, { force: true });
  process.stderr.write(`Downloading ${source.name} (${String(source.bytes)} bytes) from ${url}…\n`);
  try {
    await downloadSource({ name: source.name, url }, partial, guarded(source, fetch), pause);
    const bytes = statSync(partial).size;
    if (bytes !== source.bytes)
      throw new Error(
        `${source.name} is ${String(bytes)} bytes, not the pinned ${String(source.bytes)} (${url}). It was removed and not used.`,
      );
    const got = await sha256Of(partial);
    if (got !== source.sha256)
      throw new Error(
        `${source.name} does not match its pinned SHA-256: ${got}, expected ${source.sha256} (${url}). It was removed and not used.`,
      );
    renameSync(partial, file);
  } finally {
    rmSync(partial, { force: true });
  }
  return file;
}

async function main(args) {
  if (args.includes('--list')) {
    for (const [id, s] of Object.entries(CAPTION_MODELS))
      console.log(`${id}: ${s.what}; ${String(s.bytes)} bytes; sha256 ${s.sha256}; ${s.licence}; ${s.url}`);
    return;
  }
  const at = args.indexOf('--cache');
  const cacheDir = at >= 0 ? resolve(args[at + 1] ?? '') : DEFAULT_CACHE;
  const ids = args.filter((a, i) => !a.startsWith('--') && !(at >= 0 && i === at + 1));
  if (ids.length === 0)
    throw new Error(
      'usage: node scripts/fetch-caption-models.mjs [--cache <dir>] <id>… | --sha256 <id>… | --list',
    );
  if (args.includes('--sha256')) {
    for (const id of ids) {
      const s = Object.hasOwn(CAPTION_MODELS, id) ? CAPTION_MODELS[id] : undefined;
      if (!s) throw new Error(`unknown caption model "${id}"`);
      console.log(s.sha256);
    }
    return;
  }
  for (const id of ids) {
    const file = await fetchCaptionModel(id, {
      cacheDir,
      fetch: (url, init) => globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(TRY_MS) }),
      pause: (ms) => sleep(ms),
    });
    process.stdout.write(`${id}=${file}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
