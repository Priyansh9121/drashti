/*
 * A stream link's HLS playlist, as the main process reads it before its FFmpeg starts receiving (alpha.20, the playback
 * set's slice 8): a master playlist (its variants: which one to take), a media playlist still going (live), or one that
 * has ended (#EXT-X-ENDLIST, or a VOD playlist: a stream that finished). Drashti never receives an ended one, so its
 * FFmpeg can never play a finished stream again from its start. Plain text, read line by line; nothing in it is run.
 */

/** One of a master playlist's variants, in its order (FFmpeg numbers its programs so: 0, 1, …). */
export interface HlsVariant {
  /** Its place in the master playlist (FFmpeg's program for it). */
  index: number;
  /** Its own playlist's address, made whole from the master's. */
  url: string;
  bandwidth: number | null;
  height: number | null;
  /** Its CODECS attribute as written (e.g. "avc1.64001f,mp4a.40.2"), or null when it gives none. */
  codecs: string | null;
}

export type ReadPlaylist =
  | { kind: 'master'; variants: HlsVariant[] }
  | { kind: 'media'; ended: boolean; segments: number; targetSeconds: number | null }
  | { kind: 'not-hls' };

/** The value of one attribute in an #EXT-X-… line's list (A=1,B="x,y"). */
function attribute(list: string, name: string): string | null {
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gu;
  for (const m of list.matchAll(re)) {
    if (m[1] !== name) continue;
    const value = m[2] ?? '';
    return value.startsWith('"') ? value.slice(1, -1) : value;
  }
  return null;
}

const positive = (s: string | null): number | null => {
  const n = s === null ? NaN : Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Read a playlist's words, its own address `base` (for its variants' addresses). */
export function readPlaylist(text: string, base: string): ReadPlaylist {
  const lines = text
    .replace(/^\uFEFF/u, '')
    .split(/\r?\n/u)
    .map((l) => l.trim());
  if (lines[0] !== '#EXTM3U') return { kind: 'not-hls' };
  const variants: HlsVariant[] = [];
  let pending: string | null = null;
  let ended = false;
  let segments = 0;
  let targetSeconds: number | null = null;
  for (const line of lines.slice(1)) {
    if (line === '') continue;
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pending = line.slice('#EXT-X-STREAM-INF:'.length);
      continue;
    }
    if (line === '#EXT-X-ENDLIST' || line === '#EXT-X-PLAYLIST-TYPE:VOD') ended = true;
    if (line.startsWith('#EXT-X-TARGETDURATION:'))
      targetSeconds = positive(line.slice('#EXT-X-TARGETDURATION:'.length));
    if (line.startsWith('#')) continue;
    if (pending !== null) {
      let url: string;
      try {
        url = new URL(line, base).toString();
      } catch {
        pending = null;
        continue;
      }
      const resolution = attribute(pending, 'RESOLUTION');
      const height = resolution === null ? null : positive(resolution.split('x')[1] ?? null);
      variants.push({
        index: variants.length,
        url,
        bandwidth: positive(attribute(pending, 'BANDWIDTH')),
        height,
        codecs: attribute(pending, 'CODECS'),
      });
      pending = null;
    } else segments++;
  }
  if (variants.length > 0) return { kind: 'master', variants };
  return { kind: 'media', ended, segments, targetSeconds };
}

/** Whether every codec a variant names is one this computer's screens play (H.264 and AAC or MP3); true when unnamed. */
export function playableCodecs(codecs: string | null): boolean {
  if (codecs === null || codecs.trim() === '') return true;
  return codecs
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .every((c) => /^(avc1|avc3)\./u.test(c) || c.startsWith('mp4a.') || c === 'mp3');
}

/**
 * Which variant to receive: H.264 where the master offers it (every screen plays it, a computer without a graphics chip
 * too), the tallest no taller than `maxHeight` (1080 lines: never a 4K picture for each screen to decode), the higher
 * bandwidth of two the same; if every variant is taller, the shortest. Variants that give no height count as the
 * tallest allowed only when nothing gives one. Null when there is none.
 */
export function chooseVariant(variants: readonly HlsVariant[], maxHeight = 1080): HlsVariant | null {
  const web = variants.filter((v) => v.url.startsWith('https:') || v.url.startsWith('http:'));
  const playable = web.filter((v) => playableCodecs(v.codecs));
  const pool = playable.length > 0 ? playable : web;
  if (pool.length === 0) return null;
  const sized = pool.filter((v) => v.height !== null);
  if (sized.length === 0)
    return [...pool].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0) || a.index - b.index)[0] ?? null;
  const fits = sized.filter((v) => (v.height ?? 0) <= maxHeight);
  const ranked = (fits.length > 0 ? fits : sized).sort((a, b) =>
    fits.length > 0
      ? (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0) || a.index - b.index
      : (a.height ?? 0) - (b.height ?? 0) || (a.bandwidth ?? 0) - (b.bandwidth ?? 0) || a.index - b.index,
  );
  return ranked[0] ?? null;
}
