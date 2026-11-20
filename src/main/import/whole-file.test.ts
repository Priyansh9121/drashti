import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wholeFile } from './whole-file';

/*
 * Whole or cut by a file's own structure (Q60-31 (m2)): MP4/MOV boxes, a RIFF chunk (WAV, AVI), a Matroska/WebM
 * Segment, made here byte by byte; anything else cannot be told.
 */

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'drashti-whole-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** An ISO base media box: its size, its type and its body. */
const box = (type: string, body: Buffer | number): Buffer => {
  const b = typeof body === 'number' ? Buffer.alloc(body, 1) : body;
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + b.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, b]);
};
const ftyp = () => box('ftyp', Buffer.from('isom\0\0\x02\0isomiso2avc1mp41', 'latin1'));
const at = async (name: string, bytes: Buffer) => {
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
};

describe('a file whole or cut, by its own structure (Q60-31)', () => {
  it('an MP4: whole with its movie box, at its start or its end; cut part-way through a box, or with no movie box yet', async () => {
    const mdat = box('mdat', 4000);
    const moov = box('moov', 300);
    expect(await wholeFile(await at('fast.mp4', Buffer.concat([ftyp(), moov, mdat])))).toBe('whole');
    const exported = Buffer.concat([ftyp(), box('free', 0), mdat, moov]);
    expect(await wholeFile(await at('export.mov', exported))).toBe('whole');
    // Still being copied: the media data's box says it is longer than the bytes there.
    expect(await wholeFile(await at('half.mp4', exported.subarray(0, 2000)))).toBe('cut');
    // Every byte of the media data there, its movie box (at the end) not yet.
    expect(await wholeFile(await at('nomoov.mp4', Buffer.concat([ftyp(), box('free', 0), mdat])))).toBe(
      'cut',
    );
    // A camera's few stray bytes after the last box are no reason to wait.
    expect(await wholeFile(await at('tail.mov', Buffer.concat([exported, Buffer.alloc(4)])))).toBe('whole');
  });

  it('a RIFF file (WAV, AVI): cut when its RIFF size runs past its end; a size of 0 (a recorder stopped dead) cannot tell', async () => {
    const riff = (size: number, bytes: number) => {
      const b = Buffer.alloc(bytes);
      b.write('RIFF', 0, 'latin1');
      b.writeUInt32LE(size, 4);
      b.write('WAVE', 8, 'latin1');
      return b;
    };
    expect(await wholeFile(await at('whole.wav', riff(992, 1000)))).toBe('whole');
    expect(await wholeFile(await at('cut.wav', riff(9992, 1000)))).toBe('cut');
    expect(await wholeFile(await at('stopped.wav', riff(0, 1000)))).toBe('unknown');
  });

  it('a Matroska or WebM file: cut when its Segment runs past its end; a Segment of unknown size (a live recording) cannot tell', async () => {
    const ebml = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01]);
    const segment = (size: Buffer, body: number) =>
      Buffer.concat([ebml, Buffer.from([0x18, 0x53, 0x80, 0x67]), size, Buffer.alloc(body, 2)]);
    // Size 1000 in an 8-byte vint (0x01 then seven bytes).
    const eight = (n: number) => {
      const b = Buffer.alloc(8);
      b[0] = 0x01;
      b.writeUIntBE(n, 2, 6);
      return b;
    };
    expect(await wholeFile(await at('whole.mkv', segment(eight(1000), 1000)))).toBe('whole');
    expect(await wholeFile(await at('cut.webm', segment(eight(5000), 1000)))).toBe('cut');
    expect(
      await wholeFile(
        await at('live.webm', segment(Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), 100)),
      ),
    ).toBe('unknown');
  });

  it('anything else, empty, or not there cannot tell', async () => {
    expect(await wholeFile(await at('words.mp4', Buffer.from('Placeholder words, not a video')))).toBe(
      'unknown',
    );
    expect(await wholeFile(await at('empty.mp4', Buffer.alloc(0)))).toBe('unknown');
    expect(await wholeFile(join(dir, 'not-there.mp4'))).toBe('unknown');
  });
});
