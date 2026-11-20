/* Red (x54, slice 8): the stream link's FFmpeg: not built yet. */

export const LOCAL_PLAYLIST = '';
export const LOCAL_SEGMENT = /^$/u;
export const RELAY_PROTOCOLS = '';

export interface RelayInput {
  url: string;
  program: number | null;
  dir: string;
  again: boolean;
  userAgent?: string | null;
}

export function relayArgs(_input: RelayInput): string[] {
  return [];
}
