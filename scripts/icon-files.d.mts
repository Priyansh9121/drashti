export function pngSize(bytes: Buffer): { width: number; height: number } | null;
export function pngPixels(bytes: Buffer): { width: number; height: number; rgba: Buffer };
export const ICNS_TYPES: Record<string, number>;
export function icnsEntries(
  bytes: Buffer,
): { type: string; size: number | null; png: boolean; data: Buffer }[];
export function icoEntries(
  bytes: Buffer,
): { width: number; height: number; bits: number; png: boolean; data: Buffer }[];
export function writeIco(
  pictures: ({ size: number; rgba: Buffer } | { size: number; png: Buffer })[],
): Buffer;
export function programIcons(file: string): Buffer[];
export function carriedPictures(icoBytes: Buffer, programPictures: Buffer[]): number;
