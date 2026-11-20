/* Red (x54, slice 8): a YouTube live link from yt-dlp's look: not built yet. */

export type YoutubeLiveProblem = 'not-live' | 'upcoming' | 'ended' | 'no-stream' | 'changed';

export function youtubeLiveStream(
  _json: string,
  _maxHeight = 1080,
): { ok: true; url: string; title: string } | { ok: false; problem: YoutubeLiveProblem; message: string } {
  return { ok: false, problem: 'changed', message: '' };
}
