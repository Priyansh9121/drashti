import { basename, extname } from 'node:path';
import { COMBINE_MOST } from '../../shared/video-copies';
import { hasAlpha, PLAYER, type MediaInfo } from './plan';

/*
 * Combine videos… (alpha.22; the owner, 24 Nov 2026: "new feature, combine 2 videos", "Yes, one after other"): the
 * chosen videos joined end to end into ONE new MP4, by the bundled FFmpeg's concat FILTER over one `-i` per chosen file
 * (only files may be opened: never the concat protocol, and never a list naming other places). Each is made the first
 * one's picture size (letterboxed, never stretched), at the first one's frame rate, with its sound resampled to 48 kHz
 * stereo; one with no sound gets silence for its length, so the new video always has picture and sound throughout.
 * H.264 and AAC in MP4, the format Drashti plays everywhere.
 */

/** A chosen video as the idle worker read it: its file, what FFmpeg found, and FFmpeg's own words about it. */
export interface CombineInput {
  file: string;
  info: MediaInfo;
  /** What `ffmpeg -i` said reading it: its frame rate, its pixels' shape and a phone's turn are read from it. */
  words: string;
}
export interface CombinePlan {
  /** The new video's picture: the first one's (upright, square pixels), no larger than Drashti draws everywhere. */
  width: number;
  height: number;
  /** Its frames per second, as FFmpeg's fps filter takes it ("25", "30000/1001"). */
  rate: string;
  /** The lengths added up. */
  lengthMs: number;
  args(dest: string): string[];
}
/** The fastest frame rate a combined video keeps. */
const RATE_MOST = 60;
/** The rates players write rounded, kept exactly. */
const NTSC: Record<string, string> = {
  '23.98': '24000/1001',
  '23.976': '24000/1001',
  '29.97': '30000/1001',
  '59.94': '60000/1001',
};

/** The first picture's frame rate, its pixels' shape (1: square) and whether a phone held it turned on its side. */
export function frameFacts(words: string): { rate: string | null; sar: number; turned: boolean } {
  const line = words
    .split(/\r?\n/u)
    .find((l) => /Stream #\S+: Video: /u.test(l) && !l.includes('attached pic'));
  const fps = line ? (/, (\d+(?:\.\d+)?) fps/u.exec(line) ?? /, (\d+(?:\.\d+)?) tbr/u.exec(line)) : null;
  const rate = fps?.[1] ? (NTSC[fps[1]] ?? (Number(fps[1]) > 0 ? fps[1] : null)) : null;
  const ratio = line ? /\[SAR (\d+):(\d+) /u.exec(line) : null;
  const sar = ratio && Number(ratio[1]) > 0 && Number(ratio[2]) > 0 ? Number(ratio[1]) / Number(ratio[2]) : 1;
  const turn = /rotation of (-?\d+(?:\.\d+)?) degrees/u.exec(words);
  const turned = turn ? Math.abs(Math.round(Number(turn[1]))) % 180 === 90 : false;
  return { rate, sar, turned };
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const seconds = (ms: number) => (ms / 1000).toFixed(3);

/** The first one's picture, upright with square pixels, made no larger than the H.264 Drashti draws everywhere. */
function pictureOf(input: CombineInput): { width: number; height: number; rate: string } {
  const video = input.info.video;
  if (!video) throw new Error('The first video has no picture.');
  const facts = frameFacts(input.words);
  let width = video.width * facts.sar;
  let height = video.height;
  if (facts.turned) [width, height] = [height, width];
  const { pixels, side } = PLAYER.h264Largest;
  const shrink = Math.min(1, side / width, side / height, Math.sqrt(pixels / (width * height)));
  let rate = facts.rate ?? '30';
  const [top = 0, bottom = 1] = rate.split('/').map(Number);
  if (top / bottom > RATE_MOST) rate = String(RATE_MOST);
  return { width: even(width * shrink), height: even(height * shrink), rate };
}

/** Refuse what cannot be joined, in the operator's words; else the one FFmpeg command that joins them. */
export function combinePlan(inputs: readonly CombineInput[]): CombinePlan {
  if (inputs.length < 2) throw new Error('Choose two or more videos to combine.');
  if (inputs.length > COMBINE_MOST)
    throw new Error(`Combine takes at most ${String(COMBINE_MOST)} videos at once. Choose fewer.`);
  for (const [at, input] of inputs.entries()) {
    const which = `Video ${String(at + 1)}`;
    if (!input.info.video || input.info.video.still)
      throw new Error(`${which} is not a video Drashti can combine. Choose videos only.`);
    if (hasAlpha(input.info))
      throw new Error(
        `${which} has transparency, which a combined video cannot keep. Choose videos without it.`,
      );
    if (!input.info.durationMs || input.info.durationMs <= 0)
      throw new Error(`${which}’s length could not be read. Check that it plays, then combine again.`);
  }
  const [first] = inputs;
  if (!first) throw new Error('Choose two or more videos to combine.');
  const { width, height, rate } = pictureOf(first);
  const size = `${String(width)}:${String(height)}`;
  const branches: string[] = [];
  const joined: string[] = [];
  for (const [at, input] of inputs.entries()) {
    const n = String(at);
    const length = seconds(input.info.durationMs ?? 0);
    // Square pixels first (as Export does), then fitted inside the first one's picture and centred on black, each
    // frame at the first one's rate, held to exactly its length (its last frame kept if its picture ends early).
    branches.push(
      `[${n}:V:0]setpts=PTS-STARTPTS,${input.info.video?.interlaced ? 'bwdif=mode=send_frame:deint=interlaced,' : ''}` +
        "scale=w='trunc(iw*if(gt(sar,0),sar,1)/2)*2':h=trunc(ih/2)*2,setsar=1," +
        `scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,` +
        `fps=${rate},format=yuv420p,tpad=stop_mode=clone:stop_duration=${length},trim=duration=${length}[v${n}]`,
    );
    branches.push(
      input.info.audio
        ? `[${n}:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${length}[a${n}]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${length}[a${n}]`,
    );
    joined.push(`[v${n}][a${n}]`);
  }
  const filter = `${branches.join(';')};${joined.join('')}concat=n=${String(inputs.length)}:v=1:a=1[v][a]`;
  const lengthMs = inputs.reduce((sum, input) => sum + (input.info.durationMs ?? 0), 0);
  return {
    width,
    height,
    rate,
    lengthMs,
    args: (dest) => [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-loglevel',
      'error',
      '-nostats',
      '-progress',
      'pipe:2',
      '-threads',
      '1',
      '-filter_threads',
      '1',
      '-protocol_whitelist',
      'file',
      ...inputs.flatMap((input) => ['-i', input.file]),
      '-filter_complex',
      filter,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-sn',
      '-dn',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '1',
      '-map_metadata',
      '-1',
      '-f',
      'mp4',
      dest,
    ],
  };
}

/** The new video's name: the ones it joins, in order ("Opening + Talk.mp4"), or the first and how many more. */
export function combinedName(names: readonly string[]): string {
  const titles = names.map((name) => basename(name, extname(name)).trim() || 'Video');
  const all = titles.join(' + ');
  return `${all.length <= 80 ? all : `${titles[0] ?? 'Video'} + ${String(titles.length - 1)} more`}.mp4`;
}
