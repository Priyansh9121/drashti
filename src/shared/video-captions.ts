import type { PlaybackClip } from './media';
import type { CaptionPlace, CaptionSize } from './captions';

/** Files are read once, outside playback. No file, HTML or styling reaches a screen. */
export const MAX_CAPTION_CHARS = 2 * 1024 * 1024;
export const MAX_CAPTION_CUES = 20_000;
export const MAX_CAPTION_TRACKS = 12;

export interface VideoCaptionCue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface VideoCaptionTrack {
  id: string;
  language: string;
  automatic: boolean;
  name: string;
  /** Sorted, non-overlapping source-file intervals. */
  cues: VideoCaptionCue[];
}

export type VideoCaptionSummary = Omit<VideoCaptionTrack, 'cues'>;

export interface VideoCaptionChoice {
  tracks: VideoCaptionSummary[];
  selected: string | null;
}

/** Only selected tracks for videos that are up; these may travel to output nodes. */
export interface VideoCaptionsShown {
  track: VideoCaptionTrack;
  size: CaptionSize;
  place: CaptionPlace;
}

export type VideoCaptionResult =
  { ok: true; view: VideoCaptionChoice; notice?: string } | { ok: false; message: string };

export function captionFileInfo(
  video: string,
  file: string,
): { language: string; automatic: boolean } | null {
  const name =
    video
      .split(/[\\/]/u)
      .at(-1)
      ?.replace(/\.[^.]+$/u, '') ?? '';
  const caption = file.split(/[\\/]/u).at(-1) ?? '';
  if (!/\.(srt|vtt)$/iu.test(caption)) return null;
  const stem = caption.replace(/\.(srt|vtt)$/iu, '');
  if (stem.toLowerCase() === name.toLowerCase()) return { language: 'und', automatic: false };
  if (!stem.toLowerCase().startsWith(`${name.toLowerCase()}.`)) return null;
  let language = stem.slice(name.length + 1);
  const automatic = /\.auto$/iu.test(language);
  if (automatic) language = language.replace(/\.auto$/iu, '');
  return /^[a-z]{2,3}(?:-[a-z\d]{2,8}){0,3}$/iu.test(language)
    ? { language: language.toLowerCase(), automatic }
    : null;
}

/** A file chosen explicitly need not share the video's name. */
export function addedCaptionInfo(file: string): { language: string; automatic: boolean } {
  const stem = file.replace(/\.(srt|vtt)$/iu, '');
  const match = /\.([a-z]{2,3}(?:-[a-z\d]{2,8}){0,3})(\.auto)?$/iu.exec(stem);
  return { language: match?.[1]?.toLowerCase() ?? 'und', automatic: match?.[2] !== undefined };
}

export function captionTrackLabel(
  track: Pick<VideoCaptionSummary, 'language' | 'automatic' | 'name'>,
): string {
  const names: Record<string, string> = {
    en: 'English',
    gu: 'Gujarati',
    hi: 'Hindi',
    sa: 'Sanskrit',
    und: 'Caption file',
  };
  const language = names[track.language] ?? track.language;
  return `${language}${track.automatic ? ' (automatic)' : ''}${track.language === 'und' ? ` — ${track.name}` : ''}`;
}

function timestamp(value: string): number | null {
  const m = /^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/u.exec(value);
  if (!m || Number(m[2]) > 59 || Number(m[3]) > 59) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

function plain(value: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return (
    value
      .replace(/<!--[^]*?-->/gu, '')
      .replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/giu, '')
      .replace(/<br\s*\/?\s*>/giu, '\n')
      .replace(/<[^>]*>/gu, '')
      .replace(/\{\\[^}]*\}/gu, '')
      .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (whole: string, key: string) => {
        if (!key.startsWith('#')) return entities[key.toLowerCase()] ?? whole;
        const n = key[1]?.toLowerCase() === 'x' ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
      })
      // eslint-disable-next-line no-control-regex -- discard nonprinting control bytes from caption files
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
      .split('\n')
      .map((line) => line.replace(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .join('\n')
  );
}

/** Newer rolling lines replace their earlier prefix; repeated lines are drawn once. */
function combined(cues: VideoCaptionCue[]): string {
  const lines: string[] = [];
  for (const cue of cues) {
    for (const line of cue.text.split('\n')) {
      if (lines.some((old) => old === line || old.startsWith(`${line} `))) continue;
      for (let i = lines.length - 1; i >= 0; i--) {
        const old = lines[i];
        if (old && line.startsWith(`${old} `)) lines.splice(i, 1);
      }
      lines.push(line);
    }
  }
  return lines.slice(-2).join('\n');
}

/** Dependency-free SRT/WebVTT, bounded before splitting or sorting. Malformed input is a notice, never a throw. */
export function readVideoCaptions(source: string): { cues: VideoCaptionCue[]; problem: string | null } {
  if (source.length > MAX_CAPTION_CHARS)
    return { cues: [], problem: 'The caption file is too large (over 2 MB).' };
  const cues: VideoCaptionCue[] = [];
  let damaged = 0;
  const blocks = source
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .trim()
    .split(/\n[ \t]*\n/gu);
  for (const block of blocks) {
    const lines = block.split('\n');
    if (/^(WEBVTT(?:\s|$)|NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/u.test(lines[0] ?? '')) continue;
    const timing = lines.findIndex((line) => line.includes('-->'));
    if (timing < 0 || timing > 1) {
      if (block.trim()) damaged++;
      continue;
    }
    const match = /^\s*(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/u.exec(lines[timing] ?? '');
    const startMs = timestamp(match?.[1] ?? '');
    const endMs = timestamp(match?.[2] ?? '');
    const raw = lines.slice(timing + 1).join('\n');
    if (startMs === null || endMs === null || endMs <= startMs || raw.length > 4096) {
      damaged++;
      continue;
    }
    const text = plain(raw);
    if (!text || text.includes('\uFFFD')) {
      damaged++;
      continue;
    }
    cues.push({ startMs, endMs, text });
    if (cues.length > MAX_CAPTION_CUES)
      return { cues: [], problem: 'The caption file has too many captions (over 20,000).' };
  }
  if (cues.length === 0)
    return { cues: [], problem: 'No readable captions were found. Choose an SRT or WebVTT file.' };
  cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const events = cues.flatMap((cue, i) => [
    { at: cue.startMs, i, start: true },
    { at: cue.endMs, i, start: false },
  ]);
  events.sort((a, b) => a.at - b.at || Number(a.start) - Number(b.start));
  const active = new Map<number, VideoCaptionCue>();
  const result: VideoCaptionCue[] = [];
  let timelineChars = 0;
  for (let e = 0; e < events.length;) {
    const at = events[e]?.at ?? 0;
    while (events[e]?.at === at) {
      const event = events[e];
      if (!event) break;
      const cue = cues[event.i];
      if (event.start && cue) active.set(event.i, cue);
      else active.delete(event.i);
      e++;
    }
    if (active.size > 32)
      return { cues: [], problem: 'The caption file has too many captions at the same time.' };
    const end = events[e]?.at;
    if (end === undefined || active.size === 0) continue;
    const text = combined([...active.values()]);
    const previous = result.at(-1);
    if (previous?.endMs === at && previous.text === text) previous.endMs = end;
    else {
      timelineChars += text.length;
      if (timelineChars > MAX_CAPTION_CHARS / 4)
        return {
          cues: [],
          problem:
            'The caption file makes too much caption text at once. Choose a smaller SRT or WebVTT file.',
        };
      result.push({ startMs: at, endMs: end, text });
    }
  }
  return { cues: result, problem: damaged ? 'Some damaged captions were left out of this file.' : null };
}

/** Read the actual video's source clock, including seeks/loops. No second elapsed-time clock is needed. */
export function captionAt(
  cues: readonly VideoCaptionCue[],
  sourceMs: number,
  clip?: PlaybackClip,
): VideoCaptionCue | null {
  if (
    !Number.isFinite(sourceMs) ||
    sourceMs < (clip?.startMs ?? 0) ||
    (clip?.endMs != null && sourceMs >= clip.endMs)
  )
    return null;
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((cues[mid]?.startMs ?? Infinity) <= sourceMs) lo = mid + 1;
    else hi = mid;
  }
  const cue = cues[lo - 1];
  return cue && sourceMs < cue.endMs ? cue : null;
}
