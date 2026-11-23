import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAUSES_MS } from '../../../scripts/download-source.mjs';
import {
  CAPTION_MODELS,
  DEFAULT_CACHE,
  fetchCaptionModel,
  hostAllowed,
  refuseInsideCheckout,
  type CaptionModelSource,
} from '../../../scripts/fetch-caption-models.mjs';
import { readModelPin } from '../../../scripts/whisper-decode-check.mjs';

/*
 * CAP-CI-1 (a) (the owner, 24 Nov 2026: "Yes, all three"): CI downloads the caption models it measures from their
 * pinned sources, checked by SHA-256, cached by that SHA-256, never in an installer. alpha.22's two caption packs
 * as its release page carries them (N/release/packs-a22/SHA256SUMS-packs.txt), and the small captions model as
 * main/speech/models.ts pins it. A stand-in fetch with made-up answers and placeholder bytes; nothing real.
 */

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const BODY = Buffer.from('Placeholder pack bytes, generated in the test');
const SOURCE: CaptionModelSource = {
  name: 'placeholder-pack.zip',
  url: 'https://downloads.example.org/r/1/placeholder-pack.zip',
  hosts: ['downloads.example.org', '.cdn.example.org'],
  bytes: BODY.length,
  sha256: sha(BODY),
  licence: 'MIT',
  what: 'a placeholder pack',
};
const TABLE = { placeholder: SOURCE };

let dir = '';
let cacheDir = '';
let asked: string[] = [];
let pauses: number[] = [];
const pause = (ms: number): Promise<void> => {
  pauses.push(ms);
  return Promise.resolve();
};
/** A stand-in fetch: each address its answer; any other address is a test failure. */
function stand(answers: Record<string, () => Response>) {
  return (url: string): Promise<Response> => {
    asked.push(url);
    const answer = answers[url];
    if (!answer) throw new Error(`the test did not expect ${url}`);
    return Promise.resolve(answer());
  };
}
const ok = (b: Buffer) => () => new Response(new Uint8Array(b), { status: 200 });
const moved = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-caption-models-'));
  cacheDir = join(dir, 'cache');
  asked = [];
  pauses = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('the pinned caption models', () => {
  it("pins exactly alpha.22's two caption packs and the small captions model", () => {
    expect(Object.keys(CAPTION_MODELS).sort()).toEqual([
      'pack-gu-indicconformer-int8',
      'pack-hi-indicconformer-int8',
      'whisper-small',
    ]);
    const release = 'https://github.com/Priyansh9121/drashti/releases/download/v1.0.0-alpha.22/';
    const gu = CAPTION_MODELS['pack-gu-indicconformer-int8'];
    expect(gu).toMatchObject({
      name: 'drashti-captions-gu-indicconformer-ctc-int8.zip',
      url: `${release}drashti-captions-gu-indicconformer-ctc-int8.zip`,
      bytes: 177_169_639,
      sha256: '89652a0dde1aaefc5c5cfc65c537c202261d891f1fc6351d20ed91da31a8fa19',
    });
    const hi = CAPTION_MODELS['pack-hi-indicconformer-int8'];
    expect(hi).toMatchObject({
      name: 'drashti-captions-hi-indicconformer-ctc-int8.zip',
      url: `${release}drashti-captions-hi-indicconformer-ctc-int8.zip`,
      bytes: 177_270_115,
      sha256: 'ba6e5ed19c6641bc2e56e7f4329961fff6b1dc6c6bad5a2eb6c1741bab6b74a2',
    });
    const small = readModelPin();
    expect(CAPTION_MODELS['whisper-small']).toMatchObject({
      name: small.file,
      url: small.url,
      bytes: small.bytes,
      sha256: small.sha256,
    });
    for (const source of Object.values(CAPTION_MODELS)) {
      expect(source.url.startsWith('https://')).toBe(true);
      expect(hostAllowed(source, source.url)).toBe(true);
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(source.licence).toMatch(/MIT/u);
      expect(source.what.length).toBeGreaterThan(0);
    }
    expect(Object.isFrozen(CAPTION_MODELS)).toBe(true);
  });

  it("keeps them in this computer's cache folder, outside any checkout", () => {
    expect(DEFAULT_CACHE).toBe(join(homedir(), '.cache', 'drashti', 'caption-models'));
  });

  it('matches a host by its whole name, or by a whole ending given with a leading dot', () => {
    expect(hostAllowed(SOURCE, 'https://downloads.example.org/x')).toBe(true);
    expect(hostAllowed(SOURCE, 'https://edge.cdn.example.org/x')).toBe(true);
    expect(hostAllowed(SOURCE, 'https://cdn.example.org.elsewhere.example.net/x')).toBe(false);
    expect(hostAllowed(SOURCE, 'https://xcdn.example.org/x')).toBe(false);
    expect(hostAllowed(SOURCE, 'https://elsewhere.example.net/x')).toBe(false);
    expect(hostAllowed(SOURCE, 'http://downloads.example.org/x')).toBe(false);
    expect(hostAllowed(SOURCE, 'not an address')).toBe(false);
  });
});

describe('fetchCaptionModel', () => {
  it('downloads a pinned file into the cache, in a folder named by its SHA-256', async () => {
    const path = await fetchCaptionModel('placeholder', {
      cacheDir,
      table: TABLE,
      fetch: stand({ [SOURCE.url]: ok(BODY) }),
      pause,
    });
    expect(path).toBe(join(cacheDir, SOURCE.sha256, SOURCE.name));
    expect(readFileSync(path)).toEqual(BODY);
    expect(readdirSync(join(cacheDir, SOURCE.sha256))).toEqual([SOURCE.name]);
  });

  it('follows a redirect only to a host the source names', async () => {
    const edge = 'https://edge.cdn.example.org/blob/placeholder';
    const path = await fetchCaptionModel('placeholder', {
      cacheDir,
      table: TABLE,
      fetch: stand({ [SOURCE.url]: moved(edge), [edge]: ok(BODY) }),
      pause,
    });
    expect(readFileSync(path)).toEqual(BODY);
    expect(asked).toEqual([SOURCE.url, edge]);
  });

  it('refuses a redirect to a host the source does not name, and keeps nothing', async () => {
    const elsewhere = 'https://elsewhere.example.net/placeholder-pack.zip';
    await expect(
      fetchCaptionModel('placeholder', {
        cacheDir,
        table: TABLE,
        fetch: stand({ [SOURCE.url]: moved(elsewhere), [elsewhere]: ok(BODY) }),
        pause,
      }),
    ).rejects.toThrow(/refused/u);
    expect(asked).not.toContain(elsewhere);
    expect(existsSync(join(cacheDir, SOURCE.sha256, SOURCE.name))).toBe(false);
    expect(existsSync(join(cacheDir, SOURCE.sha256, `${SOURCE.name}.partial`))).toBe(false);
  });

  it('refuses an address that is not https before asking anything', async () => {
    const plain = { placeholder: { ...SOURCE, url: 'http://downloads.example.org/r/1/placeholder-pack.zip' } };
    await expect(
      fetchCaptionModel('placeholder', { cacheDir, table: plain, fetch: stand({}), pause }),
    ).rejects.toThrow(/refused/u);
    expect(asked).toEqual([]);
  });

  it('refuses an unknown model before asking anything', async () => {
    await expect(
      fetchCaptionModel('turbo', { cacheDir, table: TABLE, fetch: stand({}), pause }),
    ).rejects.toThrow(/unknown/u);
    await expect(
      fetchCaptionModel('toString', { cacheDir, fetch: stand({}), pause }),
    ).rejects.toThrow(/unknown/u);
    expect(asked).toEqual([]);
  });

  it('refuses a download whose SHA-256 differs, and keeps nothing', async () => {
    const other = Buffer.from(BODY.toString().replace('Placeholder', 'Elsewhere!!'));
    expect(other.length).toBe(BODY.length);
    await expect(
      fetchCaptionModel('placeholder', { cacheDir, table: TABLE, fetch: stand({ [SOURCE.url]: ok(other) }), pause }),
    ).rejects.toThrow(/SHA-256/u);
    const folder = join(cacheDir, SOURCE.sha256);
    expect(existsSync(folder) ? readdirSync(folder) : []).toEqual([]);
  });

  it('refuses a download of another size, and keeps nothing', async () => {
    const longer = Buffer.concat([BODY, Buffer.from('!')]);
    await expect(
      fetchCaptionModel('placeholder', { cacheDir, table: TABLE, fetch: stand({ [SOURCE.url]: ok(longer) }), pause }),
    ).rejects.toThrow(/bytes/u);
    const folder = join(cacheDir, SOURCE.sha256);
    expect(existsSync(folder) ? readdirSync(folder) : []).toEqual([]);
  });

  it('uses the cached copy without downloading while it is the one pinned', async () => {
    const options = { cacheDir, table: TABLE, fetch: stand({ [SOURCE.url]: ok(BODY) }), pause };
    const first = await fetchCaptionModel('placeholder', options);
    asked = [];
    expect(await fetchCaptionModel('placeholder', options)).toBe(first);
    expect(asked).toEqual([]);
  });

  it('downloads again when the cached copy is no longer the one pinned', async () => {
    const options = { cacheDir, table: TABLE, fetch: stand({ [SOURCE.url]: ok(BODY) }), pause };
    const path = await fetchCaptionModel('placeholder', options);
    writeFileSync(path, Buffer.alloc(BODY.length));
    asked = [];
    expect(await fetchCaptionModel('placeholder', options)).toBe(path);
    expect(asked).toEqual([SOURCE.url]);
    expect(readFileSync(path)).toEqual(BODY);
  });

  it('never keeps a model inside the checkout (its vendor folder, an installer)', async () => {
    const checkout = join(dir, 'checkout');
    mkdirSync(join(checkout, 'vendor'), { recursive: true });
    expect(() => refuseInsideCheckout(checkout, join(checkout, 'vendor', 'models'))).toThrow(/inside/u);
    expect(() => refuseInsideCheckout(checkout, checkout)).toThrow(/inside/u);
    expect(() => refuseInsideCheckout(checkout, join(dir, 'checkout-cache'))).not.toThrow();
    await expect(
      fetchCaptionModel('placeholder', {
        cacheDir: join(checkout, 'vendor', 'models'),
        checkout,
        table: TABLE,
        fetch: stand({ [SOURCE.url]: ok(BODY) }),
        pause,
      }),
    ).rejects.toThrow(/inside/u);
    expect(asked).toEqual([]);
  });

  it('gives up after three tries when the source does not answer, leaving nothing behind', async () => {
    const silent = (url: string): Promise<Response> => {
      asked.push(url);
      return Promise.reject(new TypeError('fetch failed', { cause: new Error('Connect Timeout Error (placeholder)') }));
    };
    await expect(
      fetchCaptionModel('placeholder', { cacheDir, table: TABLE, fetch: silent, pause }),
    ).rejects.toThrow(/could not be downloaded/u);
    expect(asked).toEqual([SOURCE.url, SOURCE.url, SOURCE.url]);
    expect(pauses).toEqual(PAUSES_MS);
    const folder = join(cacheDir, SOURCE.sha256);
    expect(existsSync(folder) ? readdirSync(folder) : []).toEqual([]);
  });
});
