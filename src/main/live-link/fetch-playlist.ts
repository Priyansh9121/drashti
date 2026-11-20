/* Red (x54, slice 8): a stream link's playlist, asked for by the main process: not built yet. */

export type PlaylistFetch =
  | { ok: true; text: string; url: string }
  | { ok: false; reason: 'status'; status: number }
  | { ok: false; reason: 'network' | 'too-big' | 'redirects' | 'not-web' | 'guard' };

export const guardAllows = (_url: URL): boolean => false;
