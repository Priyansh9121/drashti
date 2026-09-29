import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaProbe } from './probe';
import { probeMedia, unplayableAdvice } from './probe';

/*
 * Files made of headers only, written here: enough structure for the probe,
 * no pictures or sound in them.
 */

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-probe-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]);
};
const ftyp = (major: string, ...compatible: string[]) =>
  box('ftyp', Buffer.from(major, 'latin1'), u32(0), ...compatible.map((c) => Buffer.from(c, 'latin1')));
const trak = (handler: 'vide' | 'soun', codec: string) =>
  box(
    'trak',
    box(
      'mdia',
      box('hdlr', u32(0), u32(0), Buffer.from(handler, 'latin1'), Buffer.alloc(12)),
      box('minf', box('stbl', box('stsd', u32(0), u32(1), box(codec, Buffer.alloc(16))))),
    ),
  );
const movie = (...tracks: Buffer[]) => box('moov', box('mvhd', Buffer.alloc(100)), ...tracks);

async function probe(name: string, ...parts: Buffer[]): Promise<MediaProbe> {
  const file = join(dir, name);
  writeFileSync(file, Buffer.concat(parts));
  return probeMedia(file);
}

describe('recognising media Drashti cannot play', () => {
  it('reads the codecs of MP4 and QuickTime files, wherever the movie box is', async () => {
    expect(
      await probe('h264.mp4', ftyp('isom', 'mp41'), movie(trak('vide', 'avc1'), trak('soun', 'mp4a'))),
    ).toEqual({
      playable: true,
      format: 'H.264 video (MP4)',
      kind: 'video',
    });
    // The movie box after a large media data box, as cameras and editors write it.
    const mdat = box('mdat', Buffer.alloc(300_000));
    expect(await probe('prores.mov', ftyp('qt  ', 'qt  '), mdat, movie(trak('vide', 'apcn')))).toEqual({
      playable: false,
      format: 'ProRes 422 video (QuickTime)',
      kind: 'video',
    });
    expect((await probe('mpeg4.mp4', ftyp('mp42'), movie(trak('vide', 'mp4v')))).playable).toBe(false);
    expect((await probe('mjpeg.mov', ftyp('qt  '), movie(trak('vide', 'jpeg')))).format).toBe(
      'Motion JPEG video (QuickTime)',
    );
    // HEVC depends on the computer; a picture that plays with sound that does not is not sure either.
    expect((await probe('hevc.mp4', ftyp('isom'), movie(trak('vide', 'hvc1')))).playable).toBeNull();
    expect(
      await probe('ac3.mov', ftyp('qt  '), movie(trak('vide', 'avc1'), trak('soun', 'ac-3'))),
    ).toMatchObject({
      playable: null,
      format: 'H.264 video (QuickTime) with AC-3 sound',
    });
    // QuickTime files without a file-type box.
    expect((await probe('old.mov', box('wide'), movie(trak('vide', 'apch')))).playable).toBe(false);
  });

  it('reads the sound of M4A files, and knows HEIC from AVIF', async () => {
    expect(await probe('aac.m4a', ftyp('M4A '), movie(trak('soun', 'mp4a')))).toEqual({
      playable: true,
      format: 'AAC sound file (M4A)',
      kind: 'audio',
    });
    expect((await probe('alac.m4a', ftyp('M4A '), movie(trak('soun', 'alac')))).playable).toBe(false);
    expect(await probe('photo.heic', ftyp('heic', 'mif1', 'heic'))).toEqual({
      playable: false,
      format: 'HEIC photo',
      kind: 'image',
    });
    expect((await probe('photo.avif', ftyp('avif', 'mif1', 'avif'))).playable).toBe(true);
  });

  it('knows containers Chromium never plays', async () => {
    const riff = (form: string) =>
      Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from(form, 'latin1')]);
    expect(await probe('clip.avi', riff('AVI '), Buffer.alloc(64))).toMatchObject({
      playable: false,
      format: 'AVI video',
    });
    const asf = Buffer.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9]);
    expect((await probe('clip.wmv', asf, Buffer.alloc(64))).playable).toBe(false);
    expect((await probe('clip.mpg', Buffer.from([0, 0, 1, 0xba]), Buffer.alloc(64))).playable).toBe(false);
    const ts = Buffer.alloc(400);
    ts[0] = 0x47;
    ts[188] = 0x47;
    expect((await probe('clip.mts', ts)).format).toBe('MPEG transport stream video');
    const m2ts = Buffer.alloc(400);
    m2ts[4] = 0x47;
    m2ts[196] = 0x47;
    expect((await probe('clip.m2ts', m2ts)).format).toBe('AVCHD (M2TS) video');
    expect((await probe('clip.flv', Buffer.from('FLV'), Buffer.alloc(16))).playable).toBe(false);
  });

  it('reads the codecs in Matroska and WebM', async () => {
    const ebml = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    expect(await probe('clip.webm', ebml, Buffer.from('....webm....V_VP8....A_OPUS'))).toEqual({
      playable: true,
      format: 'VP8 video (WebM)',
      kind: 'video',
    });
    expect((await probe('clip.mkv', ebml, Buffer.from('matroska V_MPEG4/ISO/AVC A_AAC'))).playable).toBe(
      true,
    );
    expect((await probe('prores.mkv', ebml, Buffer.from('matroska V_PRORES'))).playable).toBe(false);
    expect(await probe('dts.mkv', ebml, Buffer.from('matroska V_MPEG4/ISO/AVC A_DTS'))).toMatchObject({
      playable: null,
      format: 'H.264 video (Matroska) with DTS sound',
    });
  });

  it('knows pictures and sound files by their first bytes', async () => {
    const cases: [string, Buffer, boolean | null][] = [
      ['a.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), true],
      ['a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), true],
      ['a.gif', Buffer.from('GIF89a'), true],
      ['a.bmp', Buffer.from('BM'), true],
      ['a.tif', Buffer.from('II*\0'), false],
      ['a.tiff', Buffer.from('MM\0*'), false],
      ['a.aiff', Buffer.concat([Buffer.from('FORM'), Buffer.alloc(4), Buffer.from('AIFF')]), false],
      ['a.mp3', Buffer.from('ID3\x03'), true],
      ['b.mp3', Buffer.from([0xff, 0xfb, 0x90, 0x64]), true],
      ['a.aac', Buffer.from([0xff, 0xf1, 0x50, 0x80]), true],
      ['a.flac', Buffer.from('fLaC'), true],
      ['a.ogg', Buffer.concat([Buffer.from('OggS'), Buffer.alloc(24), Buffer.from('OpusHead')]), true],
    ];
    for (const [name, bytes, playable] of cases) {
      expect((await probe(name, bytes, Buffer.alloc(32))).playable, name).toBe(playable);
    }
    const wav = (tag: number) => {
      const fmt = Buffer.alloc(16);
      fmt.writeUInt16LE(tag, 0);
      const chunk = Buffer.concat([Buffer.from('fmt '), Buffer.from([16, 0, 0, 0]), fmt]);
      return Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), chunk]);
    };
    expect((await probe('pcm.wav', wav(1))).playable).toBe(true);
    expect(await probe('adpcm.wav', wav(2))).toMatchObject({
      playable: false,
      format: 'ADPCM WAV sound file',
    });
  });

  it('is not sure about files it does not recognise, and never throws', async () => {
    expect((await probe('odd.mov', Buffer.from('not a movie at all'))).playable).toBeNull();
    expect((await probeMedia(join(dir, 'no such file.mp4'))).playable).toBeNull();
    expect((await probe('empty.mp4', Buffer.alloc(0))).playable).toBeNull();
  });

  it('says what to do about each kind of file', () => {
    expect(unplayableAdvice({ playable: false, format: 'HEIC photo', kind: 'image' })).toMatch(/JPEG or PNG/);
    expect(unplayableAdvice({ playable: false, format: 'AIFF sound file', kind: 'audio' })).toMatch(
      /MP3 or AAC/,
    );
    expect(unplayableAdvice({ playable: false, format: 'AVI video', kind: 'video' })).toMatch(/H\.264 MP4/);
  });
});
