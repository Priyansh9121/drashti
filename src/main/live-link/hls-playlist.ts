/* Red (x54, slice 8): a stream link's playlist, read: not built yet. */

export interface HlsVariant {
  index: number;
  url: string;
  bandwidth: number | null;
  height: number | null;
  codecs: string | null;
}

export type ReadPlaylist =
  | { kind: 'master'; variants: HlsVariant[] }
  | { kind: 'media'; ended: boolean; segments: number; targetSeconds: number | null }
  | { kind: 'not-hls' };

export function readPlaylist(_text: string, _base: string): ReadPlaylist {
  return { kind: 'not-hls' };
}

export function playableCodecs(_codecs: string | null): boolean {
  return false;
}

export function chooseVariant(_variants: readonly HlsVariant[], _maxHeight = 1080): HlsVariant | null {
  return null;
}
