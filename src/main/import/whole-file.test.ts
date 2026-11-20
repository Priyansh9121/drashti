import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ffmpegHere, testFfmpeg } from '../testing/ffmpeg-here';
import { compoundFile } from './testing/compound-file';
import { makeZip } from './testing/zip-writer';
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

/** The kinds the import takes whose own bytes say where they end (the lead, 20 Nov: as few "cannot tell" as can be). */
describe('a file whole or cut, every kind that says where it ends (Q60-31)', () => {
  const cut = (b: Buffer, keep: number) => b.subarray(0, keep);
  const tellsBoth = async (name: string, whole: Buffer, part: Buffer) => {
    expect(await wholeFile(await at(`whole-${name}`, whole)), `${name} whole`).toBe('whole');
    expect(await wholeFile(await at(`cut-${name}`, part)), `${name} cut`).toBe('cut');
  };

  it('a HEIC or AVIF picture (its meta box, no movie box) and a QuickTime movie with no ftyp', async () => {
    const heif = Buffer.concat([
      box('ftyp', Buffer.from('heic\0\0\0\0mif1heic', 'latin1')),
      box('meta', 200),
      box('mdat', 3000),
    ]);
    await tellsBoth('photo.heic', heif, cut(heif, 1500));
    const avif = Buffer.concat([
      box('ftyp', Buffer.from('avif\0\0\0\0avifmif1', 'latin1')),
      box('meta', 200),
      box('mdat', 2000),
    ]);
    await tellsBoth('picture.avif', avif, cut(avif, 1000));
    const old = Buffer.concat([box('wide', 0), box('mdat', 3000), box('moov', 300)]);
    await tellsBoth('old.mov', old, cut(old, 1500));
  });

  it('a JPEG: whole once its end marker follows its picture data (bytes after it too); cut without it', async () => {
    const segment = (marker: number, body: number) => {
      const b = Buffer.alloc(4 + body, 7);
      b[0] = 0xff;
      b[1] = marker;
      b.writeUInt16BE(2 + body, 2);
      return b;
    };
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      segment(0xe0, 14),
      segment(0xdb, 65),
      segment(0xc0, 15),
      segment(0xda, 10),
      Buffer.alloc(5000, 0x12),
      Buffer.from([0xff, 0xd9]),
    ]);
    await tellsBoth('photo.jpg', jpeg, cut(jpeg, 3000));
    expect(await wholeFile(await at('trailer.jpg', Buffer.concat([jpeg, Buffer.alloc(300, 9)])))).toBe(
      'whole',
    );
  });

  it('a PNG (its IEND chunk) and a GIF (its trailer)', async () => {
    const chunk = (type: string, body: number) => {
      const b = Buffer.alloc(12 + body, 3);
      b.writeUInt32BE(body, 0);
      b.write(type, 4, 'latin1');
      return b;
    };
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', 13),
      chunk('IDAT', 4000),
      chunk('IEND', 0),
    ]);
    await tellsBoth('picture.png', png, cut(png, 2000));
    expect(await wholeFile(await at('noiend.png', cut(png, png.length - 12)))).toBe('cut');
    // GIF89a, a 2x2 screen with no colour table, one image: its LZW data in sub-blocks, then the trailer.
    const gif = Buffer.concat([
      Buffer.from('GIF89a', 'latin1'),
      Buffer.from([2, 0, 2, 0, 0x00, 0, 0]),
      Buffer.from([0x21, 0xf9, 4, 0, 0, 0, 0, 0]),
      Buffer.from([0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0x00]),
      // Its LZW minimum code size, then two sub-blocks of 200 bytes, then the terminator.
      Buffer.from([2, 200]),
      Buffer.alloc(200, 5),
      Buffer.from([200]),
      Buffer.alloc(200, 6),
      Buffer.from([0, 0x3b]),
    ]);
    await tellsBoth('moving.gif', gif, cut(gif, 300));
  });

  it('a PDF (startxref and %%EOF at its end) and a zip-based deck or document (its end-of-central-directory record)', async () => {
    const pdf = Buffer.from(
      `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${'%'.repeat(3000)}\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R >>\nstartxref\n3080\n%%EOF\n`,
      'latin1',
    );
    await tellsBoth('pages.pdf', pdf, cut(pdf, 2000));
    const zip = makeZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'ppt/presentation.xml', data: 'p'.repeat(4000) },
    ]);
    await tellsBoth('deck.pptx', zip, cut(zip, Math.floor(zip.length / 2)));
  });

  it('an MP3 with a Xing, Info or VBRI header (its byte count); one without cannot tell', async () => {
    // MPEG-1 Layer III, 128 kb/s, 44.1 kHz, stereo: 417-byte frames; its Xing header 32 bytes after the frame header.
    const frame = () => {
      const f = Buffer.alloc(417);
      f.set([0xff, 0xfb, 0x90, 0x00]);
      return f;
    };
    const frames = 20;
    const xing = (tag: 'Xing' | 'Info') => {
      const first = frame();
      first.write(tag, 4 + 32, 'latin1');
      first.writeUInt32BE(0x3, 4 + 32 + 4);
      first.writeUInt32BE(frames, 4 + 32 + 8);
      first.writeUInt32BE(frames * 417, 4 + 32 + 12);
      return Buffer.concat([first, ...Array.from({ length: frames - 1 }, frame)]);
    };
    const id3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 10, ...new Array<number>(10).fill(0)]);
    const vbr = Buffer.concat([id3, xing('Xing')]);
    await tellsBoth('song.mp3', vbr, cut(vbr, 4000));
    await tellsBoth('cbr.mp3', xing('Info'), cut(xing('Info'), 3000));
    const vbriFirst = frame();
    vbriFirst.write('VBRI', 36, 'latin1');
    vbriFirst.writeUInt32BE(frames * 417, 36 + 10);
    const vbri = Buffer.concat([vbriFirst, ...Array.from({ length: frames - 1 }, frame)]);
    await tellsBoth('vbri.mp3', vbri, cut(vbri, 5000));
    const plain = Buffer.concat(Array.from({ length: frames }, frame));
    expect(await wholeFile(await at('plain.mp3', plain))).toBe('unknown');
  });

  it('an AIFF (its FORM size), an Ogg file (its last page marked as the end), a BMP, a WMA or WMV, and a JPEG 2000', async () => {
    const form = Buffer.alloc(2000);
    form.write('FORM', 0, 'latin1');
    form.writeUInt32BE(1992, 4);
    form.write('AIFF', 8, 'latin1');
    await tellsBoth('sound.aiff', form, cut(form, 1000));
    const page = (last: boolean, body: number) => {
      const p = Buffer.alloc(27 + 1 + body, 4);
      p.write('OggS', 0, 'latin1');
      p[4] = 0;
      p[5] = last ? 0x04 : 0x00;
      p[26] = 1;
      p[27] = body;
      return p;
    };
    const ogg = Buffer.concat([page(false, 200), page(false, 200), page(true, 100)]);
    await tellsBoth('song.ogg', ogg, cut(ogg, ogg.length - 50));
    expect(await wholeFile(await at('noend.ogg', Buffer.concat([page(false, 200), page(false, 200)])))).toBe(
      'cut',
    );
    const bmp = Buffer.alloc(3000, 8);
    bmp.write('BM', 0, 'latin1');
    bmp.writeUInt32LE(3000, 2);
    await tellsBoth('picture.bmp', bmp, cut(bmp, 1000));
    const guid = (hex: string) => Buffer.from(hex, 'hex');
    const fileProps = Buffer.alloc(104);
    guid('a1dcab8c47a9cf118ee400c00c205365').copy(fileProps, 0);
    fileProps.writeBigUInt64LE(104n, 16);
    const header = Buffer.alloc(30);
    guid('3026b2758e66cf11a6d900aa0062ce6c').copy(header, 0);
    header.writeBigUInt64LE(BigInt(30 + 104), 16);
    header.writeUInt32LE(1, 24);
    const asf = Buffer.concat([header, fileProps, Buffer.alloc(3000, 1)]);
    asf.writeBigUInt64LE(BigInt(asf.length), 30 + 40);
    await tellsBoth('sound.wma', asf, cut(asf, 1500));
    const jp2 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a]),
      box('ftyp', Buffer.from('jp2 \0\0\0\0jp2 ', 'latin1')),
      box(
        'jp2c',
        Buffer.concat([
          Buffer.from([0xff, 0x4f, 0xff, 0x51]),
          Buffer.alloc(3000, 5),
          Buffer.from([0xff, 0xd9]),
        ]),
      ),
    ]);
    await tellsBoth('picture.jp2', jp2, cut(jp2, 1500));
  });

  it('what truly cannot tell (no size nor end mark in its own bytes) says so: an MPEG-TS of whole packets, a raw AAC or AC-3', async () => {
    const ts = Buffer.alloc(188 * 20, 0xff);
    for (let i = 0; i < 20; i++) ts[i * 188] = 0x47;
    expect(await wholeFile(await at('camera.mts', ts))).toBe('unknown');
    expect(
      await wholeFile(
        await at('sound.aac', Buffer.from([0xff, 0xf1, 0x50, 0x80, ...new Array<number>(500).fill(1)])),
      ),
    ).toBe('unknown');
    expect(
      await wholeFile(await at('sound.ac3', Buffer.from([0x0b, 0x77, ...new Array<number>(500).fill(1)]))),
    ).toBe('unknown');
  });
});

/** What keeps a verdict right on real files' odd turns. */
describe('a file whole or cut: the odd turns of real files (Q60-31)', () => {
  it('an MP4 with a top-level meta box is still a movie: cut until its movie box is there (only a HEIF or AVIF picture, by its brands, is whole by its meta box)', async () => {
    const mp4 = Buffer.concat([ftyp(), box('meta', 100), box('mdat', 3000)]);
    expect(await wholeFile(await at('meta.mp4', mp4))).toBe('cut');
    expect(await wholeFile(await at('meta-moov.mp4', Buffer.concat([mp4, box('moov', 300)])))).toBe('whole');
  });

  it('an MP3 cut part-way through its ID3 tag (a large cover picture) is cut', async () => {
    // A tag of 5000 bytes (syncsafe 0x00 0x00 0x27 0x08), only 1000 of it there.
    const tag = Buffer.alloc(1000);
    tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x27, 0x08]);
    expect(await wholeFile(await at('cover.mp3', tag))).toBe('cut');
  });

  it('an Ogg page’s four letters inside its last page’s data do not mislead', async () => {
    const page = (last: boolean, body: Buffer) => {
      const p = Buffer.alloc(27 + 1);
      p.write('OggS', 0, 'latin1');
      p[5] = last ? 0x04 : 0x00;
      p[26] = 1;
      p[27] = body.length;
      return Buffer.concat([p, body]);
    };
    const data = Buffer.alloc(120, 9);
    data.write('OggS', 40, 'latin1');
    const ogg = Buffer.concat([page(false, Buffer.alloc(200, 4)), page(true, data)]);
    expect(await wholeFile(await at('letters.ogg', ogg))).toBe('whole');
  });

  it('an AVI past 1 GB (a second RIFF chunk, AVIX): cut when that one runs past its end', async () => {
    const riff = (form: string, body: number) => {
      const b = Buffer.alloc(8 + body, 1);
      b.write('RIFF', 0, 'latin1');
      b.writeUInt32LE(body, 4);
      b.write(form, 8, 'latin1');
      return b;
    };
    const avi = Buffer.concat([riff('AVI ', 2000), riff('AVIX', 3000)]);
    expect(await wholeFile(await at('long.avi', avi))).toBe('whole');
    expect(await wholeFile(await at('long-cut.avi', avi.subarray(0, 3500)))).toBe('cut');
  });

  it('a JPEG 2000 whose codestream runs to the file’s end (its size 0), and one with a box after its codestream', async () => {
    const signature = Buffer.from([0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a]);
    const codestream = Buffer.concat([
      Buffer.from([0xff, 0x4f, 0xff, 0x51]),
      Buffer.alloc(2000, 5),
      Buffer.from([0xff, 0xd9]),
    ]);
    const toTheEnd = Buffer.concat([
      signature,
      box('ftyp', Buffer.from('jp2 \0\0\0\0jp2 ', 'latin1')),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('jp2c', 'latin1'),
      codestream,
    ]);
    expect(await wholeFile(await at('to-end.jp2', toTheEnd))).toBe('whole');
    expect(await wholeFile(await at('to-end-cut.jp2', toTheEnd.subarray(0, 1200)))).toBe('cut');
    const after = Buffer.concat([
      signature,
      box('ftyp', Buffer.from('jp2 \0\0\0\0jp2 ', 'latin1')),
      box('jp2c', codestream),
      box('xml ', 50),
    ]);
    expect(await wholeFile(await at('after.jp2', after))).toBe('whole');
    expect(await wholeFile(await at('bare.j2k', codestream))).toBe('whole');
    expect(await wholeFile(await at('bare-cut.j2k', codestream.subarray(0, 900)))).toBe('cut');
  });

  it('a transport stream (AVCHD .mts, .m2ts, .ts): cut when it ends part-way through a packet; of whole packets it cannot tell', async () => {
    const stream = (packet: number, sync: number, count: number) => {
      const b = Buffer.alloc(packet * count, 0x10);
      for (let i = 0; i < count; i++) b[i * packet + sync] = 0x47;
      return b;
    };
    const ts = stream(188, 0, 30);
    expect(await wholeFile(await at('cut.ts', ts.subarray(0, 188 * 20 + 100)))).toBe('cut');
    const m2ts = stream(192, 4, 30);
    expect(await wholeFile(await at('whole.m2ts', m2ts))).toBe('unknown');
    expect(await wholeFile(await at('cut.mts', m2ts.subarray(0, 192 * 20 + 64)))).toBe('cut');
  });
});

/** Each whole one, then cut at these shares of its length: whole, then cut each time. */
async function wholeThenCut(name: string, whole: Buffer, shares = [0.5, 0.9]): Promise<void> {
  expect(await wholeFile(await at(name, whole)), `${name} whole`).toBe('whole');
  for (const share of shares)
    expect(
      await wholeFile(
        await at(`cut-${String(share)}-${name}`, whole.subarray(0, Math.floor(whole.length * share))),
      ),
      `${name} cut at ${String(share * 100)} %`,
    ).toBe('cut');
}

const ffmpeg = testFfmpeg();

/** A file the bundled FFmpeg makes, as a program would write it (generated, placeholder only). */
function made(name: string, args: string[]): Buffer {
  const out = join(dir, `made-${name}`);
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args, out], {
    timeout: 60_000,
  });
  if (r.status !== 0) throw new Error(`FFmpeg could not make ${name}: ${r.stderr.toString()}`);
  return readFileSync(out);
}

const SINE = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=3'];
const BARS = (size: string, seconds: number) => [
  '-f',
  'lavfi',
  '-i',
  `testsrc=size=${size}:rate=25:duration=${String(seconds)}`,
];

/** The kinds whose own bytes tell, read further than a header (Q60-46 (2), the owner's answer A through the lead). */
describe.skipIf(!ffmpegHere(ffmpeg))(
  'a file whole or cut, the kinds told on a longer read, as FFmpeg writes them (Q60-46)',
  () => {
    it('FLAC: its last frame, by its number and its own check, against the samples its header counts (a tag after it too)', async () => {
      const flac = made('song.flac', [...SINE, '-c:a', 'flac']);
      await wholeThenCut('song.flac', flac, [0.5, 0.9, 0.999]);
      const tagged = Buffer.concat([flac, Buffer.from(`TAG${'x'.repeat(125)}`, 'latin1')]);
      expect(await wholeFile(await at('tagged.flac', tagged))).toBe('whole');
    });

    it('TIFF: its strips within the file', async () => {
      await wholeThenCut(
        'scan.tif',
        made('scan.tif', [...BARS('320x240', 1), '-frames:v', '1', '-c:v', 'tiff']),
      );
    });

    it('Targa, run-length and plain: its picture data within the file', async () => {
      await wholeThenCut(
        'rle.tga',
        made('rle.tga', [...BARS('160x120', 1), '-frames:v', '1', '-c:v', 'targa']),
      );
      await wholeThenCut(
        'plain.tga',
        made('plain.tga', [...BARS('160x120', 1), '-frames:v', '1', '-c:v', 'targa', '-rle', '0']),
      );
    });

    it('ICO: each picture within the file', async () => {
      await wholeThenCut('icon.ico', made('icon.ico', [...BARS('64x64', 1), '-frames:v', '1']));
    });

    it('FLV: its last tag ends where its last tag size says', async () => {
      await wholeThenCut('clip.flv', made('clip.flv', [...BARS('320x240', 2), '-c:v', 'flv', '-an']));
    });

    it('MXF: its random index pack at its end; cut before its footer', async () => {
      await wholeThenCut(
        'camera.mxf',
        made('camera.mxf', [...BARS('720x576', 1), '-c:v', 'mpeg2video', '-an']),
      );
    });

    it('RealMedia: its chunks within the file', async () => {
      await wholeThenCut('old.rm', made('old.rm', [...BARS('320x240', 2), '-c:v', 'rv10', '-an']));
    });

    it('CAF and AU: their sizes', async () => {
      await wholeThenCut('sound.caf', made('sound.caf', [...SINE, '-c:a', 'pcm_s16le', '-f', 'caf']));
      await wholeThenCut('sound.au', made('sound.au', [...SINE, '-c:a', 'pcm_s16be', '-f', 'au']));
    });

    it('WavPack: its last block ends the samples its blocks count', async () => {
      await wholeThenCut('sound.wv', made('sound.wv', [...SINE, '-c:a', 'wavpack']));
    });

    it('DV: whole frames of a DV picture (144,000 bytes in PAL); one ending part-way through a frame is cut', async () => {
      const dv = made('tape.dv', [
        ...BARS('720x576', 1),
        '-c:v',
        'dvvideo',
        '-pix_fmt',
        'yuv420p',
        '-an',
        '-f',
        'dv',
      ]);
      expect(await wholeFile(await at('whole.dv', dv))).toBe('unknown');
      expect(await wholeFile(await at('cut.dv', dv.subarray(0, 144_000 * 3 + 5000)))).toBe('cut');
    });
  },
);

describe('a file whole or cut, the kinds no FFmpeg here writes (Q60-46)', () => {
  it('PSD: its sections and its picture data, plain and run-length', async () => {
    const psd = (rle: boolean) => {
      const head = Buffer.alloc(26);
      head.write('8BPS', 0, 'latin1');
      head.writeUInt16BE(1, 4);
      head.writeUInt16BE(3, 12);
      head.writeUInt32BE(64, 14);
      head.writeUInt32BE(64, 18);
      head.writeUInt16BE(8, 22);
      head.writeUInt16BE(3, 24);
      const sections = Buffer.alloc(12); // colour mode data, image resources, layers and masks: none
      if (!rle) return Buffer.concat([head, sections, Buffer.from([0, 0]), Buffer.alloc(3 * 64 * 64, 7)]);
      // Each row of each channel packed as one run of 64 (PackBits: -63, then the byte): 2 bytes a row.
      const counts = Buffer.alloc(3 * 64 * 2);
      for (let r = 0; r < 3 * 64; r++) counts.writeUInt16BE(2, r * 2);
      const rows = Buffer.alloc(3 * 64 * 2);
      for (let r = 0; r < 3 * 64; r++) rows.set([0xc1, 7], r * 2);
      return Buffer.concat([head, sections, Buffer.from([0, 1]), counts, rows]);
    };
    await wholeThenCut('plain.psd', psd(false));
    await wholeThenCut('packed.psd', psd(true));
  });

  it('APE (Monkey’s Audio): the lengths its descriptor gives', async () => {
    const ape = Buffer.alloc(1124, 3);
    ape.write('MAC ', 0, 'latin1');
    ape.writeUInt16LE(3990, 4);
    ape.writeUInt16LE(0, 6);
    for (const [at, v] of [
      [8, 52],
      [12, 24],
      [16, 4],
      [20, 44],
      [24, 1000],
      [28, 0],
      [32, 0],
    ] as const)
      ape.writeUInt32LE(v, at);
    await wholeThenCut('sound.ape', ape);
  });

  it('an old PowerPoint or Word file (an Office compound file): the last sector its table uses', async () => {
    await wholeThenCut('deck.ppt', compoundFile('PowerPoint Document'));
    await wholeThenCut('notes.doc', compoundFile('WordDocument'));
  });
});
