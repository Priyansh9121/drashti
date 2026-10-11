import { heightLabel, type VideoDetails, type YouTubeType } from '../../shared/links';

/*
 * YouTube in Import from a Link (Session 25c): what Drashti asks of yt-dlp
 * 2026.08.19, and how it reads the answers. Each option was read in
 * yt-dlp's own source at that tag (yt_dlp/options.py). Drashti holds no
 * YouTube downloading code of its own: yt-dlp does the downloading, and
 * starts Deno to run YouTube's player JavaScript.
 *
 * Nothing of the user's: no settings files, plugins, browser cookies, cache,
 * playlists, updates, remote components or proxy (direct, never through a
 * proxy of the user's or the system's). No SponsorBlock or other outside
 * service is asked about a video. A file holds only the video: YouTube
 * sends its ads apart from it, and yt-dlp takes the video's own streams.
 */

/** Where Drashti's own programs are. */
export interface YoutubeProgramPaths {
  deno: string;
  ffmpeg: string;
}

/** What starts each progress line yt-dlp prints for Drashti (--progress-template). */
export const PROGRESS_MARK = 'DRASHTI-PROGRESS';

/** The name yt-dlp gives the download in its work folder (Drashti names it afterwards, from the title). */
export const DOWNLOAD_STEM = 'download';

/** The options every run takes. */
function common(p: YoutubeProgramPaths): string[] {
  return [
    // Nothing of the user's: no settings files, plugins, cookies, cache or proxy.
    '--ignore-config',
    '--no-plugin-dirs',
    '--no-cookies',
    '--no-cookies-from-browser',
    '--no-cache-dir',
    '--proxy',
    '',
    // One video, never a playlist; never an update or a component fetched from elsewhere.
    '--no-playlist',
    '--no-update',
    '--no-remote-components',
    // No SponsorBlock (it is off unless asked for; this says so).
    '--no-sponsorblock',
    // Drashti's own Deno (and no other JavaScript runtime) and its own FFmpeg.
    '--no-js-runtimes',
    '--js-runtimes',
    `deno:${p.deno}`,
    '--ffmpeg-location',
    p.ffmpeg,
    '--color',
    'never',
  ];
}

/** Ask for the video's details only (nothing is downloaded): its title, length and qualities. */
export function lookArgs(p: YoutubeProgramPaths, link: string): string[] {
  return [...common(p), '--dump-single-json', '--', link];
}

/**
 * Download the video into `workDir` as download.mp4 (MP4: the height chosen at most, H.264 and AAC
 * where the video offers them at that height) or download.mp3 (the best sound). A stopped download
 * carries on from its part-file when the same command runs again.
 */
export function downloadArgs(
  p: YoutubeProgramPaths,
  link: string,
  choice: { type: YouTubeType; height: number | null },
  workDir: string,
): string[] {
  const format =
    choice.type === 'mp3'
      ? ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
      : [
          '-f',
          `bv*[height<=${String(choice.height)}]+ba/b[height<=${String(choice.height)}]`,
          '-S',
          `res:${String(choice.height)},vcodec:h264,acodec:aac`,
          '--merge-output-format',
          'mp4',
          '--remux-video',
          'mp4',
        ];
  return [
    ...common(p),
    ...format,
    '--newline',
    '--progress-template',
    `download:${PROGRESS_MARK} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s`,
    '--continue',
    '--no-overwrites',
    '--no-mtime',
    '-P',
    workDir,
    '-o',
    `${DOWNLOAD_STEM}.%(ext)s`,
    '--',
    link,
  ];
}

/** A progress line yt-dlp printed for Drashti: bytes so far, and of how many (null: not known). */
export function parseProgress(line: string): { done: number; total: number | null } | null {
  if (!line.startsWith(`${PROGRESS_MARK} `)) return null;
  const [done, total, estimate] = line
    .slice(PROGRESS_MARK.length + 1)
    .trim()
    .split(/\s+/u);
  const num = (s: string | undefined) => {
    const n = Number(s);
    return s !== undefined && s !== 'NA' && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const got = num(done);
  if (got === null) return null;
  return { done: got, total: num(total) ?? num(estimate) };
}

export type YoutubeProblemCode =
  | 'changed'
  | 'sign-in'
  | 'not-a-robot'
  | 'blocked'
  | 'removed'
  | 'live'
  | 'upcoming'
  | 'processing'
  | 'playlist'
  | 'network'
  | 'space';

export interface YoutubeProblem {
  code: YoutubeProblemCode;
  message: string;
}

const PROBLEMS: Record<YoutubeProblemCode, string> = {
  changed:
    'YouTube did not give this video. YouTube changes often; if this keeps happening with videos that play on YouTube, a newer Drashti may be needed (Help › Check for Updates…).',
  'sign-in':
    'YouTube gives this video only to someone signed in (it may be private, for members, or age-restricted). Drashti never signs in to YouTube. For the mandir’s own videos, download them in YouTube Studio, then import the file.',
  'not-a-robot':
    'YouTube asked for a sign-in to show this computer is not a robot. Drashti never signs in to YouTube. Try again later; for the mandir’s own videos, download them in YouTube Studio, then import the file.',
  blocked: 'YouTube does not show this video in this country, so Drashti cannot download it.',
  removed: 'This video is not on YouTube any more (it was removed or made unavailable).',
  live: 'That is a live stream still going. Download it after it ends.',
  upcoming: 'That live stream or premiere has not started yet. Download it after it ends.',
  processing:
    'That live stream has only just ended, and YouTube is still getting it ready. Try again in a little while.',
  playlist:
    'That is a playlist. Drashti downloads one video at a time: open a video in it, use Share, and paste that link here.',
  network: 'Drashti could not reach YouTube. Check the internet connection, then try again.',
  space:
    'The disk is nearly full: Drashti keeps 2 GB free for the show. Free up some space, or choose another folder.',
};

export const youtubeProblemMessage = (code: YoutubeProblemCode): string => PROBLEMS[code];

/**
 * What went wrong, from what yt-dlp printed on its error output: in plain words, with what to do next.
 * Its own words are never shown or logged (they can name the video).
 */
export function youtubeProblem(errors: string): YoutubeProblem {
  const text = errors.toLowerCase();
  const has = (...words: string[]) => words.some((w) => text.includes(w));
  let code: YoutubeProblemCode = 'changed';
  if (has('not a bot', 'not a robot')) code = 'not-a-robot';
  else if (
    has(
      'sign in to confirm your age',
      'age-restricted',
      'age restricted',
      'private video',
      'members-only',
      'members only',
      'join this channel',
      'requires payment',
      'sign in to confirm',
      'login required',
      'use --cookies',
    )
  )
    code = 'sign-in';
  else if (has('in your country', 'geo restrict', 'geo-restrict', 'not available in your location'))
    code = 'blocked';
  else if (
    has(
      'video unavailable',
      'has been removed',
      'removed by the uploader',
      'account associated with this video has been terminated',
      'no longer available',
      'this video is unavailable',
      'does not exist',
    )
  )
    code = 'removed';
  else if (has('this live event will begin', 'premieres in')) code = 'upcoming';
  else if (
    has(
      'unable to download webpage',
      'getaddrinfo',
      'name or service not known',
      'nodename nor servname',
      'temporary failure in name resolution',
      'connection refused',
      'connection reset',
      'network is unreachable',
      'timed out',
      'no route to host',
    )
  )
    code = 'network';
  else if (has('no space left on device', 'not enough space')) code = 'space';
  return { code, message: PROBLEMS[code] };
}

interface Format {
  height?: unknown;
  vcodec?: unknown;
  acodec?: unknown;
  filesize?: unknown;
  filesize_approx?: unknown;
  tbr?: unknown;
  abr?: unknown;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** About how many bytes a format is: what YouTube says, else its bitrate over the video's length. */
function bytesOf(f: Format, duration: number | null): number | null {
  const said = num(f.filesize) ?? num(f.filesize_approx);
  if (said !== null) return said;
  const kbps = num(f.tbr) ?? num(f.abr);
  return kbps !== null && duration !== null ? Math.round((kbps * 1000 * duration) / 8) : null;
}

/** The MP3 of the best sound at yt-dlp's best quality (about 245 kbps): about this many bytes. */
const MP3_BYTES_PER_SECOND = 245_000 / 8;

/**
 * Read yt-dlp's details of a video (--dump-single-json): its title, length, the heights it offers with
 * about how big each MP4 would be, and how big its MP3. A live stream still going, one not started yet
 * and a playlist are refused here, in plain words.
 */
export function parseDetails(
  json: string,
): { ok: true; details: VideoDetails } | { ok: false; problem: YoutubeProblem } {
  let info: Record<string, unknown>;
  try {
    info = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { ok: false, problem: { code: 'changed', message: PROBLEMS.changed } };
  }
  const refuse = (code: YoutubeProblemCode) => ({
    ok: false as const,
    problem: { code, message: PROBLEMS[code] },
  });
  if (info['_type'] === 'playlist') return refuse('playlist');
  const live = info['live_status'];
  if (live === 'is_live' || info['is_live'] === true) return refuse('live');
  if (live === 'is_upcoming') return refuse('upcoming');
  if (live === 'post_live') return refuse('processing');
  const duration = num(info['duration']);
  const formats = (Array.isArray(info['formats']) ? info['formats'] : []) as Format[];
  const video = formats.filter(
    (f) => num(f.height) !== null && text(f.vcodec) !== 'none' && text(f.vcodec) !== '',
  );
  const sound = formats.filter(
    (f) => text(f.vcodec) === 'none' && text(f.acodec) !== 'none' && text(f.acodec) !== '',
  );
  // The sound an MP4 takes: AAC where offered (as -S acodec:aac prefers), the biggest of those.
  const aac = sound.filter((f) => text(f.acodec).startsWith('mp4a'));
  const bestSound = (aac.length > 0 ? aac : sound)
    .map((f) => bytesOf(f, duration))
    .reduce<number | null>((best, b) => (b !== null && (best === null || b > best) ? b : best), null);
  const heights = [...new Set(video.map((f) => num(f.height) ?? 0))].sort((a, b) => b - a);
  const detailsHeights = heights.map((height) => {
    const at = video.filter((f) => num(f.height) === height);
    // H.264 where the video offers it at that height (as -S vcodec:h264 prefers), else the biggest.
    const h264 = at.filter((f) => text(f.vcodec).startsWith('avc1'));
    const pick = (h264.length > 0 ? h264 : at)
      .map((f) => bytesOf(f, duration))
      .reduce<number | null>((best, b) => (b !== null && (best === null || b > best) ? b : best), null);
    return { height, bytes: pick === null ? null : pick + (bestSound ?? 0) };
  });
  const title = text(info['title']).trim() || 'YouTube video';
  return {
    ok: true,
    details: {
      title,
      duration,
      heights: detailsHeights,
      soundBytes: duration === null ? null : Math.round(duration * MP3_BYTES_PER_SECOND),
    },
  };
}

/** A choice in words, for the log and the status bar: "MP4, 1080p" or "MP3". */
export const choiceWords = (choice: { type: YouTubeType; height: number | null }): string =>
  choice.type === 'mp3' ? 'MP3' : `MP4, ${heightLabel(choice.height ?? 0)}`;
