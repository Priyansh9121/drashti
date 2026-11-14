import { crc32, createDeflate } from 'node:zlib';
import type { CapturedPicture } from '../../shared/pdf-copy';

/*
 * A phone's picture of a deck's click made a PNG (Session 57, C6's review, MEDIUM 1): here, in the network's own
 * process, which answers the phone, never on Main's thread. Main hands on the pixels as it captured them. They are
 * drawn over black, as the screens are (their colours are already multiplied by their alpha), so the PNG is RGB. The
 * rows are made a slice at a time, each squeezed on Node's own thread pool before the next is begun, so the phones'
 * and nodes' messages go on between slices; and before each slice comes the pace the server gives (C18's review,
 * LOW-2): it waits while the hall screens move (slide-picture.ts whileScreensMove), so an operator's Next as the PNG
 * is made has the computer's processor (a two-core laptop's) to itself, and the PNG goes on as the motion ends.
 */

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** The most pixels a phone's picture holds: 3840 x 2160, a 1920 x 1080 slide on a display at twice the size. */
const MOST_PIXELS = 3840 * 2160;
const PNG_LONG_SIDE = 1920;
/** About this many pixels made and squeezed at a time: a few milliseconds' work, even on a slow laptop. */
const SLICE_PIXELS = 16_384;

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

function sampleAt(pixel: number, size: number, sourceSize: number) {
  const at = ((pixel + 0.5) * sourceSize) / size - 0.5;
  const near = Math.floor(at);
  return { near, far: Math.min(near + 1, sourceSize - 1), weight: at - near };
}

/**
 * The picture as a PNG: 8-bit RGB, with a 1920-pixel cap even from a high-density capture. `pace` is waited for
 * before each slice of rows is made (none: straight on).
 */
export async function pngOf(
  { width: sourceWidth, height: sourceHeight, pixels, order }: CapturedPicture,
  pace: () => Promise<void> = () => Promise.resolve(),
): Promise<Buffer> {
  const scale = Math.min(1, PNG_LONG_SIDE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const columns = scale < 1 ? Array.from({ length: width }, (_, x) => sampleAt(x, width, sourceWidth)) : [];
  const red = order === 'bgra' ? 2 : 0;
  const blue = 2 - red;
  const channels = [red, 1, blue];
  const stride = width * 3 + 1;
  const slice = Math.max(1, Math.floor(SLICE_PIXELS / width));
  const squeezer = createDeflate();
  const squeezed: Buffer[] = [];
  squeezer.on('data', (data: Buffer) => {
    squeezed.push(data);
  });
  // A failure comes to the slice's write as well, or to the end, which is waited for below: never left unheard.
  const ended = new Promise<void>((resolve, reject) => {
    squeezer.once('end', resolve).once('error', reject);
  });
  ended.catch(() => undefined);
  try {
    for (let top = 0; top < height; top += slice) {
      await pace();
      const bottom = Math.min(height, top + slice);
      // Zeroed: each row's first byte, its filter, stays 0.
      const rows = Buffer.alloc(stride * (bottom - top));
      for (let y = top; y < bottom; y++) {
        let to = (y - top) * stride + 1;
        if (columns.length) {
          // Sample between pixel centres. A twice-density capture contributes all four pixels to each output pixel.
          const row = sampleAt(y, height, sourceHeight);
          const upper = row.near * sourceWidth * 4;
          const lower = row.far * sourceWidth * 4;
          for (const { near, far, weight } of columns) {
            for (const channel of channels) {
              const left = near * 4 + channel;
              const right = far * 4 + channel;
              const a = (pixels[upper + left] ?? 0) * (1 - weight) + (pixels[upper + right] ?? 0) * weight;
              const b = (pixels[lower + left] ?? 0) * (1 - weight) + (pixels[lower + right] ?? 0) * weight;
              rows[to++] = Math.round(a * (1 - row.weight) + b * row.weight);
            }
          }
          continue;
        }
        for (let from = y * width * 4, end = from + width * 4; from < end; from += 4, to += 3) {
          rows[to] = pixels[from + red] ?? 0;
          rows[to + 1] = pixels[from + 1] ?? 0;
          rows[to + 2] = pixels[from + blue] ?? 0;
        }
      }
      await new Promise<void>((resolve, reject) => {
        squeezer.write(rows, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    squeezer.end();
    await ended;
  } finally {
    squeezer.destroy();
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits a colour
  header[9] = 2; // RGB
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', Buffer.concat(squeezed)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
