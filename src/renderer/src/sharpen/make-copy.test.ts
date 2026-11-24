import { afterEach, expect, it, vi } from 'vitest';
import type { SharpenJobView } from '../../../shared/pictures';
import { makePictureBlob, makePictureCopy } from './make-copy';

afterEach(() => vi.unstubAllGlobals());
const job = (): SharpenJobView => ({
  key: 'generated-picture',
  data: Uint8Array.from([1]),
  percent: 0,
  type: 'image/png',
  maxPixels: 4,
  box: null,
});

function setup(failure: 'context' | 'draw' | 'encode') {
  const bitmap = { width: 1, height: 1, close: vi.fn() };
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => Promise.resolve(bitmap)),
  );
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        if (failure === 'context') return null;
        return {
          drawImage: () => {
            if (failure === 'draw') throw new Error('No drawing');
          },
          getImageData: () => ({ data: Uint8ClampedArray.from([1, 2, 3, 255]) }),
          putImageData: () => undefined,
        };
      }
      convertToBlob() {
        return Promise.reject(new Error('No encoded picture'));
      }
    },
  );
  return bitmap;
}

it.each(['context', 'draw', 'encode'] as const)(
  'releases its bitmap after a %s failure in the reused worker',
  async (failure) => {
    const bitmap = setup(failure);
    await expect(makePictureCopy(job())).rejects.toThrow();
    expect(bitmap.close).toHaveBeenCalledOnce();
  },
);

function encodedPicture() {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 17, 31]);
  const blob = new Blob([bytes], { type: 'image/png' });
  const arrayBuffer = vi.spyOn(blob, 'arrayBuffer');
  const bitmap = { width: 1, height: 1, close: vi.fn() };
  const encode = vi.fn((_options?: ImageEncodeOptions) => Promise.resolve(blob));
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => Promise.resolve(bitmap)),
  );
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return {
          drawImage: () => undefined,
          getImageData: () => ({ data: Uint8ClampedArray.from([1, 2, 3, 255]) }),
          putImageData: () => undefined,
        };
      }
      convertToBlob(options?: ImageEncodeOptions) {
        return encode(options);
      }
    },
  );
  return { bytes, blob, arrayBuffer, bitmap, encode };
}

it('keeps the ordinary sharpen producer’s exact encoded byte-array result', async () => {
  const t = encodedPicture();
  const result = await makePictureCopy(job());
  expect(result).toBeInstanceOf(Uint8Array);
  expect(result).toEqual(t.bytes);
  expect(t.arrayBuffer).toHaveBeenCalledOnce();
  expect(t.encode).toHaveBeenCalledWith({ type: 'image/png', quality: 0.95 });
  expect(t.bitmap.close).toHaveBeenCalledOnce();
});

it('hands the new display route the encoder’s same Blob without materializing a byte array', async () => {
  const t = encodedPicture();
  const result = await makePictureBlob(job());
  expect(result).toBe(t.blob);
  expect(result.type).toBe('image/png');
  expect(result.size).toBe(t.bytes.length);
  expect(t.arrayBuffer).not.toHaveBeenCalled();
  expect(t.encode).toHaveBeenCalledOnce();
  expect(t.encode).toHaveBeenCalledWith({ type: 'image/png', quality: 0.95 });
  expect(t.bitmap.close).toHaveBeenCalledOnce();
});
