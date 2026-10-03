import { describe, expect, it } from 'vitest';
import type { MkvCluster } from './mkv';
import { MkvSplitter, MkvWriter, retimeCluster } from './mkv';

/** A cluster as FFmpeg writes one to a pipe: known size, a time, then blocks. */
function cluster(timestamp: number, blocks: { track: number; key: boolean }[]): Buffer {
  const parts: Buffer[] = [Buffer.from([0xe7, 0x84]), Buffer.alloc(4)];
  parts[1]?.writeUInt32BE(timestamp, 0);
  for (const b of blocks) {
    const data = Buffer.from([0x80 | b.track, 0x00, 0x00, b.key ? 0x80 : 0x00, 0xaa, 0xbb]);
    parts.push(Buffer.from([0xa3, 0x80 | data.length]), data);
  }
  const body = Buffer.concat(parts);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(0x10000000 | body.length, 0);
  return Buffer.concat([Buffer.from([0x1f, 0x43, 0xb6, 0x75]), size, body]);
}

/** The start of FFmpeg's output: EBML header, a segment of unknown size, Info and Tracks (video is track 1). */
function header(): Buffer {
  const writer = new MkvWriter(
    { width: 16, height: 16, format: 'I420', fps: 30 },
    { sampleRate: 48000, channels: 2 },
  );
  return writer.header();
}

describe('reading the encoder’s Matroska', () => {
  it('splits it into its header and clusters, wherever the chunks break, and finds where pictures start', () => {
    const stream = Buffer.concat([
      header(),
      cluster(0, [
        { track: 2, key: true },
        { track: 1, key: true },
        { track: 1, key: false },
      ]),
      cluster(100, [
        { track: 1, key: false },
        { track: 2, key: true },
      ]),
      cluster(2000, [
        { track: 2, key: true },
        { track: 1, key: true },
      ]),
    ]);
    for (const step of [1, 7, 64, stream.length]) {
      const heads: Buffer[] = [];
      const clusters: MkvCluster[] = [];
      const splitter = new MkvSplitter(
        (h) => heads.push(h),
        (c) => clusters.push(c),
      );
      for (let i = 0; i < stream.length; i += step) splitter.push(stream.subarray(i, i + step));
      expect(heads).toHaveLength(1);
      expect(heads[0]).toEqual(header());
      expect(clusters.map((c) => [c.timestamp, c.startsPicture])).toEqual([
        [0, true],
        [100, false],
        [2000, true],
      ]);
      // Header and clusters together are the stream itself.
      expect(Buffer.concat([heads[0] ?? Buffer.alloc(0), ...clusters.map((c) => c.bytes)])).toEqual(stream);
    }
  });

  it('moves a cluster’s time without changing its length', () => {
    const clusters: MkvCluster[] = [];
    const splitter = new MkvSplitter(
      () => undefined,
      (c) => clusters.push(c),
    );
    splitter.push(Buffer.concat([header(), cluster(2000, [{ track: 1, key: true }])]));
    const first = clusters[0];
    if (!first) throw new Error('no cluster');
    const moved = retimeCluster(first, 0);
    expect(moved.length).toBe(first.bytes.length);
    const again: MkvCluster[] = [];
    new MkvSplitter(
      () => undefined,
      (c) => again.push(c),
    ).push(Buffer.concat([header(), moved]));
    expect(again[0]?.timestamp).toBe(0);
  });
});

describe('writing the encoder’s input', () => {
  it('starts with the tracks, and puts each block in a cluster no more than 250 ms long', () => {
    const writer = new MkvWriter(
      { width: 16, height: 16, format: 'I420', fps: 30 },
      { sampleRate: 48000, channels: 2 },
    );
    const head = writer.header();
    expect(head.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    expect(head.includes(Buffer.from('V_UNCOMPRESSED'))).toBe(true);
    expect(head.includes(Buffer.from('A_PCM/FLOAT/IEEE'))).toBe(true);
    const clusterId = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
    const frame = Buffer.alloc(16 * 16 * 1.5);
    const first = writer.block(1, 0, frame);
    expect(first[0]).toEqual(clusterId);
    // The frame's data goes last, as it is (not copied).
    expect(first.at(-1)).toBe(frame);
    expect(writer.block(2, 0.1, Buffer.alloc(8))[0]).not.toEqual(clusterId);
    expect(writer.block(1, 0.3, frame)[0]).toEqual(clusterId);
  });
});
