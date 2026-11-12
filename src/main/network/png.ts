import { promisify } from 'node:util';
import { crc32, deflate } from 'node:zlib';
import type { CapturedPicture } from '../../shared/pdf-copy';

/*
 * A phone's picture of a deck's click made a PNG (Session 57, C6's review, MEDIUM 1): here, in the network's own
 * process, which answers the phone, never on Main's thread. Main hands on the pixels as it captured them. They are
 * drawn over black, as the screens are (their colours are already multiplied by their alpha), so the PNG is RGB. The
 * rows are copied a slice at a time, so the phones' and nodes' messages go on between slices, and squeezed on Node's
 * own thread pool.
 */

const squeeze = promisify(deflate);
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** The most pixels a phone's picture holds: 3840 x 2160, a 1920 x 1080 slide on a display at twice the size. */
const MOST_PIXELS = 3840 * 2160;
/** About this many pixels copied between turns of the process's other work. */
const SLICE_PIXELS = 65_536;

/** What Main answered is a captured picture, whole: its size, and as many pixels. */
export function isCapturedPicture(value: unknown): value is CapturedPicture {
  if (!value || typeof value !== 'object') return false;
  const { width, height, pixels, order } = value as Partial<CapturedPicture>;
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width * height <= MOST_PIXELS &&
    pixels instanceof Uint8Array &&
    pixels.length === width * height * 4 &&
    (order === 'bgra' || order === 'rgba')
  );
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body, crc32(head.subarray(4))), 0);
  return Buffer.concat([head, body, check]);
}

/** The picture as a PNG: 8-bit RGB, each row stored as it is (filter 0). */
export async function pngOf({ width, height, pixels, order }: CapturedPicture): Promise<Buffer> {
  const red = order === 'bgra' ? 2 : 0;
  const blue = 2 - red;
  const stride = width * 3 + 1;
  // Zeroed: each row's first byte, its filter, stays 0.
  const rows = Buffer.alloc(stride * height);
  const slice = Math.max(1, Math.floor(SLICE_PIXELS / width));
  for (let top = 0; top < height; top += slice) {
    if (top > 0)
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    for (let y = top; y < Math.min(height, top + slice); y++) {
      let from = y * width * 4;
      const end = from + width * 4;
      for (let to = y * stride + 1; from < end; from += 4, to += 3) {
        rows[to] = pixels[from + red] ?? 0;
        rows[to + 1] = pixels[from + 1] ?? 0;
        rows[to + 2] = pixels[from + blue] ?? 0;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits a colour
  header[9] = 2; // RGB
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', await squeeze(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
