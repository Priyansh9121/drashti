/* A video's profile and level from its own codec record (alpha.20, Media information…). Red (x47): still to be written. */

export interface CodecLevel {
  codec: 'h264' | 'hevc';
  profileIdc: number;
  level: string;
}

export const h264Level = (_levelIdc: number): string | null => null;
export const hevcLevel = (_levelIdc: number): string | null => null;
export const fromAvcC = (_record: Uint8Array): CodecLevel | null => null;
export const fromHvcC = (_record: Uint8Array): CodecLevel | null => null;
export const readCodecLevel = (_path: string): Promise<CodecLevel | null> => Promise.resolve(null);
