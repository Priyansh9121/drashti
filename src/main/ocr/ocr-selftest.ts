import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import type { OcrFiles } from './ocr-engine';
import { OCR_MODEL_SHA256 } from './ocr-files';
import type { ReaderHandle } from './reader-process';
import type { ReaderSays } from './reader-protocol';

/*
 * Book OCR's part of the FFmpeg self-test (alpha.21; DRASHTI_SELFTEST=ffmpeg, scripts/check-ffmpeg.mjs and
 * scripts/check-installers.mjs): the reader's files are beside the main bundle (inside the app when packaged), the
 * model is tessdata_best's own (its SHA-256), and the reading process starts with them and reads a blank page to the
 * end. So an installed Drashti proves it carries its model and can read with it, offline.
 */

export interface OcrSelfTest {
  passed: boolean;
  detail: string;
  /** The model it read with (inside the installed app, the installers' check says). */
  model: string;
}

/** A white page, `size` pixels a side: an 8-bit grey PNG. */
export function blankPng(size: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits a pixel, grey (colour type 0), no interlace.
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size, 255)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function ocrSelfTest(deps: {
  files: OcrFiles;
  tempDir: () => Promise<string>;
  startReader: (pages: string[], said: (m: ReaderSays | { kind: 'gone' }) => void) => ReaderHandle;
  timeoutMs?: number;
}): Promise<OcrSelfTest> {
  const { model } = deps.files;
  const failed = (detail: string): OcrSelfTest => ({ passed: false, detail, model });
  try {
    const sha = createHash('sha256')
      .update(await readFile(model))
      .digest('hex');
    if (sha !== OCR_MODEL_SHA256)
      return failed(`Book OCR’s model is not the one Drashti was built with (${sha}).`);
    for (const file of [deps.files.core, deps.files.wasm]) await readFile(file);
  } catch {
    return failed('Book OCR’s reader or its model is missing from this copy of Drashti.');
  }
  const dir = await deps.tempDir();
  try {
    const page = join(dir, 'blank.png');
    await writeFile(page, blankPng(64));
    const said = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        reader.stop();
        resolve('timeout');
      }, deps.timeoutMs ?? 60_000);
      const reader = deps.startReader([page], (m) => {
        if (m.kind !== 'done' && m.kind !== 'failed' && m.kind !== 'gone') return;
        clearTimeout(timer);
        resolve(m.kind);
      });
    });
    return said === 'done'
      ? {
          passed: true,
          detail: `Book OCR reads with its own model (Gujarati.traineddata, SHA-256 ${OCR_MODEL_SHA256}), in its reading process, offline.`,
          model,
        }
      : failed(`Book OCR’s reading process did not read a blank page (${said}).`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
