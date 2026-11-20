import { afterEach, expect, it, vi } from 'vitest';
import type { SharpenJobView } from '../../../shared/pictures';
import { makePictureCopy } from './make-copy';

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
