import { playableCodecs } from './hls-playlist';

/*
 * A YouTube live link (alpha.20, the playback set's slice 8): Drashti's own yt-dlp looks at the video's page
 * (--dump-single-json, the same look From a Link… makes: nothing of the user's, never signed in), and this reads its
 * answer: whether it is live now, and which of its HLS streams (picture and sound together) the main process's FFmpeg
 * receives. Nothing is downloaded by the look. What yt-dlp printed is never logged (it names the video).
 */

export type YoutubeLiveProblem = 'not-live' | 'upcoming' | 'ended' | 'no-stream' | 'changed';

const PROBLEMS: Record<YoutubeLiveProblem, string> = {
  'not-live':
    'That YouTube video is not a live stream going now. To show a video, download it with File › Import from a Link….',
  upcoming: 'That YouTube live stream has not started yet. Show it again once it is live.',
  ended:
    'That YouTube live stream has ended. To show it now, download it with File › Import from a Link… once YouTube has it ready.',
  'no-stream':
    'YouTube gave no stream of that live video that Drashti can show. Try again in a moment; if it happens again, a newer Drashti may be needed (Help › Check for Updates…).',
  changed:
    'YouTube did not give that live stream. YouTube changes often; if this keeps happening with streams that play on YouTube, a newer Drashti may be needed (Help › Check for Updates…).',
};

export const youtubeLiveMessage = (problem: YoutubeLiveProblem): string => PROBLEMS[problem];

interface Format {
  url?: unknown;
  protocol?: unknown;
  height?: unknown;
  vcodec?: unknown;
  acodec?: unknown;
  tbr?: unknown;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * Read yt-dlp's look at a YouTube link: the HLS stream to receive (picture and sound in one, H.264 where offered, the
 * tallest no taller than `maxHeight`), or why there is none, in plain words.
 */
export function youtubeLiveStream(
  json: string,
  maxHeight = 1080,
): { ok: true; url: string; title: string } | { ok: false; problem: YoutubeLiveProblem; message: string } {
  const refuse = (problem: YoutubeLiveProblem) => ({
    ok: false as const,
    problem,
    message: PROBLEMS[problem],
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return refuse('changed');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return refuse('changed');
  const info = parsed as Record<string, unknown>;
  const live = info['live_status'];
  if (live === 'is_upcoming') return refuse('upcoming');
  if (live === 'was_live' || live === 'post_live') return refuse('ended');
  if (live !== 'is_live' && info['is_live'] !== true) return refuse('not-live');
  const formats = (Array.isArray(info['formats']) ? info['formats'] : []) as Format[];
  const streams = formats.filter((f) => {
    const url = text(f.url);
    return (
      text(f.protocol).startsWith('m3u8') &&
      /^https?:\/\//u.test(url) &&
      text(f.vcodec) !== '' &&
      text(f.vcodec) !== 'none' &&
      text(f.acodec) !== '' &&
      text(f.acodec) !== 'none'
    );
  });
  const playable = streams.filter((f) => playableCodecs(`${text(f.vcodec)},${text(f.acodec)}`));
  const pool = playable.length > 0 ? playable : streams;
  const fits = pool.filter((f) => (num(f.height) ?? 0) <= maxHeight);
  const ranked = (fits.length > 0 ? fits : pool).sort((a, b) =>
    fits.length > 0
      ? (num(b.height) ?? 0) - (num(a.height) ?? 0) || (num(b.tbr) ?? 0) - (num(a.tbr) ?? 0)
      : (num(a.height) ?? 0) - (num(b.height) ?? 0),
  );
  const best = ranked[0];
  if (!best) return refuse('no-stream');
  return { ok: true, url: text(best.url), title: text(info['title']).trim() || 'YouTube live' };
}
