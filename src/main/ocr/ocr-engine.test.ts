import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OCR_MODEL, openReader, tidyRead } from './ocr-engine';
import { sourceOcrFiles } from './ocr-files';
import { blankPng } from './ocr-selftest';
import {
  LETTERS_FOUND_AT_LEAST,
  LETTERS_RIGHT_AT_LEAST,
  letterScore,
  PAGE_ONE,
} from './testing/scanned-pages';

/*
 * Book OCR's engine (alpha.21): Tesseract's WebAssembly build with its Gujarati model, run by tesseract.js's own
 * worker code, here in Electron's own Node.js as in the reading process. The page is a placeholder page as the e2e
 * test draws one (testing/placeholder-page-one.png: PAGE_ONE in Noto Sans Gujarati, A4 at 150 pixels an inch, made
 * with Electron's Chromium for this test).
 */

const root = process.cwd();
const page = () => new Uint8Array(readFileSync(join(__dirname, 'testing', 'placeholder-page-one.png')));

const restore: (() => void)[] = [];
afterEach(() => {
  for (const undo of restore.splice(0)) undo();
});

/** Every way out to a network, counted and refused while the test runs. */
function noNetwork(): string[] {
  const tried: string[] = [];
  const refuse =
    (what: string) =>
    (...args: unknown[]): never => {
      tried.push(`${what} ${String(args[0])}`);
      throw new Error(`no network in this test (${what})`);
    };
  const patch = (target: object, key: string, what: string) => {
    const before: unknown = Reflect.get(target, key);
    Reflect.set(target, key, refuse(what));
    restore.push(() => Reflect.set(target, key, before));
  };
  patch(globalThis, 'fetch', 'fetch');
  patch(http, 'request', 'http.request');
  patch(http, 'get', 'http.get');
  patch(https, 'request', 'https.request');
  patch(https, 'get', 'https.get');
  patch(net.Socket.prototype, 'connect', 'net.connect');
  return tried;
}

describe('reading a page’s words with Tesseract inside Drashti', () => {
  it('reads a placeholder Gujarati page within the trial’s bounds, fetching nothing', async () => {
    const tried = noNetwork();
    const starting: number[] = [];
    const reader = await openReader(sourceOcrFiles(root), (f) => starting.push(f));
    expect(starting.at(-1)).toBe(1);
    const reading: number[] = [];
    const text = tidyRead(await reader.read(page(), (f) => reading.push(f)));
    const score = letterScore(PAGE_ONE.join('\n'), text);
    expect(score.found, text).toBeGreaterThanOrEqual(LETTERS_FOUND_AT_LEAST);
    expect(score.right, text).toBeGreaterThanOrEqual(LETTERS_RIGHT_AT_LEAST);
    // Its groups as on the page: a blank line between them, so each becomes its own slide.
    expect(text.split('\n\n')).toHaveLength(4);
    // It said how far it had got, up to the end.
    expect(reading.length).toBeGreaterThan(1);
    expect(reading.every((f) => f >= 0 && f <= 1)).toBe(true);
    expect(tried).toEqual([]);
  });

  it('reads the same page again with the same reader, the same words', async () => {
    const reader = await openReader(sourceOcrFiles(root));
    const first = await reader.read(page());
    const again = await reader.read(page());
    expect(again).toBe(first);
  });

  it('a picture it cannot read fails that reading, and the reader goes on to the next', async () => {
    const reader = await openReader(sourceOcrFiles(root));
    await expect(reader.read(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow();
    expect(letterScore(PAGE_ONE.join('\n'), await reader.read(page())).found).toBeGreaterThanOrEqual(
      LETTERS_FOUND_AT_LEAST,
    );
  });

  it('reads the self-test’s blank page (ocr-selftest.ts) to the end, as no words', async () => {
    const reader = await openReader(sourceOcrFiles(root));
    expect(tidyRead(await reader.read(new Uint8Array(blankPng(64))))).toBe('');
  });

  it('is the Gujarati script model', () => {
    expect(OCR_MODEL).toBe('Gujarati');
  });
});

describe('the words as New from words takes them', () => {
  it('ends of lines trimmed, runs of spaces one, at most one blank line between blocks, none at the ends', () => {
    expect(tidyRead('\n\n  first  line  \r\nsecond\t line\n\n\n\nthird\f\n  \n')).toBe(
      'first line\nsecond line\n\nthird',
    );
    expect(tidyRead('   \n \n')).toBe('');
  });
});
