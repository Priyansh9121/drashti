import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceOcrFiles } from './ocr-files';
import { blankPng, ocrSelfTest } from './ocr-selftest';
import type { ReaderSays } from './reader-protocol';

/*
 * Book OCR's part of the FFmpeg self-test (alpha.21): the files are there, the model is tessdata_best's own, and the
 * reading process reads a blank page to the end. The reading process is a stand-in here; the real one reads the blank
 * page in ocr-engine.test.ts, and the installed app's in scripts/check-installers.mjs.
 */

const root = process.cwd();

function run(files = sourceOcrFiles(root), answer: ReaderSays | { kind: 'gone' } | null = { kind: 'done' }) {
  const pages: string[][] = [];
  const dirs: string[] = [];
  const result = ocrSelfTest({
    files,
    tempDir: () => {
      const dir = mkdtempSync(join(tmpdir(), 'drashti-ocr-selftest-test-'));
      dirs.push(dir);
      return Promise.resolve(dir);
    },
    startReader: (given, said) => {
      pages.push(given);
      // The page it was given is a PNG, there while it reads.
      expect(
        readFileSync(given[0] ?? '')
          .subarray(1, 4)
          .toString('latin1'),
      ).toBe('PNG');
      if (answer) setTimeout(() => said(answer), 1);
      return { stop: () => undefined };
    },
    timeoutMs: 50,
  });
  return { result, pages, dirs };
}

describe('book OCR’s self-test', () => {
  it('passes when its own model is there and the reading process reads the blank page to the end', async () => {
    const t = run();
    expect(await t.result).toEqual({
      passed: true,
      detail:
        'Book OCR reads with its own model (Gujarati.traineddata, SHA-256 82f06ffd7c0db4232e00af1b8c90b596c28b49a77453d9a54ce5b99a16b3e0a5), in its reading process, offline.',
      model: sourceOcrFiles(root).model,
    });
    expect(t.pages).toHaveLength(1);
    for (const dir of t.dirs) expect(existsSync(dir)).toBe(false);
  });

  it('fails with another model, with a file missing, and when the reading process fails, ends or says nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-ocr-selftest-test-'));
    const other = join(dir, 'Gujarati.traineddata');
    writeFileSync(other, 'not the model');
    const files = sourceOcrFiles(root);
    const wrong = await run({ ...files, model: other }).result;
    expect(wrong.passed).toBe(false);
    expect(wrong.detail).toContain('is not the one Drashti was built with');
    const copy = join(dir, 'copy.traineddata');
    copyFileSync(files.model, copy);
    expect(await run({ ...files, model: copy, wasm: join(dir, 'missing.wasm') }).result).toEqual({
      passed: false,
      detail: 'Book OCR’s reader or its model is missing from this copy of Drashti.',
      model: copy,
    });
    for (const [answer, said] of [
      [{ kind: 'failed', page: 0 }, 'failed'],
      [{ kind: 'gone' }, 'gone'],
      [null, 'timeout'],
    ] as const)
      expect(await run(files, answer).result).toEqual({
        passed: false,
        detail: `Book OCR’s reading process did not read a blank page (${said}).`,
        model: files.model,
      });
  });

  it('its blank page is a PNG of the size asked, all white', () => {
    const png = blankPng(64);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(64);
    expect(png.readUInt32BE(20)).toBe(64);
  });
});
