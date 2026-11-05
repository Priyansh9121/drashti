import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/*
 * The tests' own default opening photo (the owner's decision of 5 Nov 2026). No test ever shows Drashti's own photo:
 * tests/global-setup.ts makes this placeholder once a run, and every Drashti a test starts shows it instead
 * (DRASHTI_TEST_OPENING_PHOTO, which a packaged Drashti never reads; a test can give a picture of its own). Two flat
 * colours, made here as the run starts: nothing is committed.
 */

/** Its size, so a test can tell that it is the picture shown. */
export const PLACEHOLDER_OPENING_PHOTO = { width: 800, height: 450 } as const;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([head, typed, tail]);
}

/** Write the placeholder (a PNG: warm on the left, deep blue on the right) to `file`; its path. */
export function writePlaceholderOpeningPhoto(file: string): string {
  const { width, height } = PLACEHOLDER_OPENING_PHOTO;
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    // Each row: its filter (0, none), then its pixels.
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = x < width / 2 ? [200, 170, 120] : [40, 60, 110];
      raw.set([r, g, b], y * stride + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits
  header[9] = 2; // RGB
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
  return file;
}
