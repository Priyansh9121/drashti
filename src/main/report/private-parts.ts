import type { CapturedPicture } from '../../shared/pdf-copy';

/** The page's viewport (CSS pixels) and each marked element's box in it: [left, top, width, height]. */
export interface PrivateParts {
  width: number;
  height: number;
  rects: [number, number, number, number][];
}

export const PRIVATE_PARTS_SCRIPT = '';

export function readPrivateParts(_raw: unknown): PrivateParts | null {
  return null;
}

export function blankPrivateParts(picture: CapturedPicture, _parts: readonly PrivateParts[]): CapturedPicture {
  return picture;
}

export function takePrivately<T>(
  _read: () => Promise<unknown>,
  _take: () => Promise<T | null>,
): Promise<{ taken: T; parts: PrivateParts[] } | null> {
  return Promise.resolve(null);
}
