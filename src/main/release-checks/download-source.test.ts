import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { PAUSES_MS, downloadSource } from '../../../scripts/download-source.mjs';

/*
 * A release's source archives (scripts/release-assets.mjs): each download is tried up to three times, with a
 * pause before the second try and a longer one before the third (Session 47: ffmpeg.org once did not answer
 * and stopped a publish). A stand-in fetch with made-up answers, and pauses that are noted, never waited.
 */

const SOURCE = { name: 'placeholder-1.0.tar.xz', url: 'https://example.invalid/placeholder-1.0.tar.xz' };
/** What Node's fetch throws when a server does not answer: "fetch failed", with why as its cause. */
const NO_ANSWER = () =>
  new TypeError('fetch failed', { cause: new Error('Connect Timeout Error (placeholder)') });

let dir = '';
let file = '';
let events: string[] = [];
let log: MockInstance<typeof console.log>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-download-'));
  file = join(dir, SOURCE.name);
  events = [];
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  log.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

/** A stand-in fetch giving each answer in turn: a response, or an error it throws. */
function fetchGiving(...answers: (() => Response | Error)[]) {
  return vi.fn((url: string) => {
    events.push(`fetch ${url}`);
    const answer = answers.shift()?.() ?? new Error('asked once too often');
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
}

/** A pause that is noted when it ends, so a fetch before its end would show. */
async function pause(ms: number) {
  await Promise.resolve();
  events.push(`paused ${String(ms)}`);
}

describe('a source archive’s download', () => {
  it('tries again after 5 s and then 15 s, and keeps the download that works', async () => {
    const fetch = fetchGiving(
      NO_ANSWER,
      () => new Response('Placeholder: busy', { status: 503 }),
      () => new Response('Placeholder source archive'),
    );
    await downloadSource(SOURCE, file, fetch, pause);
    expect(readFileSync(file, 'utf8')).toBe('Placeholder source archive');
    expect(PAUSES_MS).toEqual([5000, 15000]);
    expect(events).toEqual([
      `fetch ${SOURCE.url}`,
      'paused 5000',
      `fetch ${SOURCE.url}`,
      'paused 15000',
      `fetch ${SOURCE.url}`,
    ]);
    expect(log.mock.calls).toEqual([
      [
        'placeholder-1.0.tar.xz: try 1 of 3 failed (fetch failed: Connect Timeout Error (placeholder)); trying again in 5 s',
      ],
      ['placeholder-1.0.tar.xz: try 2 of 3 failed (503); trying again in 15 s'],
    ]);
  });

  it('stops after the third try with the plain message, as before the tries', async () => {
    const busy = () => new Response(null, { status: 503 });
    const fetch = fetchGiving(busy, busy, busy);
    await expect(downloadSource(SOURCE, file, fetch, pause)).rejects.toThrow(
      new Error('placeholder-1.0.tar.xz could not be downloaded (503)'),
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(events.filter((e) => e.startsWith('paused'))).toEqual(['paused 5000', 'paused 15000']);
    expect(existsSync(file)).toBe(false);
  });

  it('says why when the server never answers', async () => {
    const fetch = fetchGiving(NO_ANSWER, NO_ANSWER, NO_ANSWER);
    await expect(downloadSource(SOURCE, file, fetch, pause)).rejects.toThrow(
      new Error(
        'placeholder-1.0.tar.xz could not be downloaded (fetch failed: Connect Timeout Error (placeholder))',
      ),
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
