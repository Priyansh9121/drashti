import type { PixelSize } from '../../shared/picture-look';

export interface PictureHeader {
  size: PixelSize;
  type: 'jpg' | 'png';
  animated: boolean;
}

/** Read bounded header bytes, never picture pixels. */
export function pictureHeader(_bytes: Uint8Array): PictureHeader | null {
  return null;
}
