import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { hasAlpha, type MediaInfo } from '../convert/plan';

/*
 * Page copies (QA23-FADE-9, candidate 1; lead 2, answered by lead, owner away): a smaller copy of a video for a page
 * that draws it smaller than it is, so that page decodes no more than it shows. The stream's picture page takes a copy
 * at its preset's height (720p for the weak preset), the operator window (LIVE and its other previews) a 540p one; the
 * hall's screens always play the original. On CI's two-core Windows a crossfade has six 1080p software decodes at once
 * (two on each of the hall, LIVE and the stream page) and every page's decoding waits for a core
 * (a22-fadeprep-1125-134233-68030).
 *
 * A copy is kept beside the library's media, in Media/page-copies, named by its source's sha256 and its height
 * (`<sha256>-720p.webm`), so it belongs to exactly those bytes. It keeps the source's timeline exactly: every frame at
 * the same time, the same keyframes, the same length, and the source's own sound packets, copied (the stream page's
 * pictures are clocked by their own sound). It is used only if it is there when a showing starts, and never in place
 * of one mid-showing. It is deleted only with its source, or when its source's bytes change: nothing else.
 */

export const PAGE_COPIES_DIR = 'page-copies';
/** The heights a page copy is made at: the stream's weak preset, and the operator window's previews. */
export const PAGE_COPY_HEIGHTS = [720, 540] as const;
export type PageCopyHeight = (typeof PAGE_COPY_HEIGHTS)[number];

export interface PageCopyPlan {
  width: number;
  height: PageCopyHeight;
  ext: 'webm' | 'mp4';
}

/** The copy a source can have at a height: none for a video not taller than it, a still, or one this can't keep exact. */
export function pageCopyPlan(info: MediaInfo, height: PageCopyHeight): PageCopyPlan | null {
  const v = info.video;
  if (!v || v.still || v.interlaced === true || hasAlpha(info) || v.width < 2 || v.height < 2) return null;
  // Landscape only: the pages draw 16:9.
  if (v.width < v.height || v.height <= height) return null;
  const container = info.container ?? '';
  const ext = container.includes('webm') ? 'webm' : container.includes('mp4') ? 'mp4' : null;
  if (ext === 'webm' && v.codec !== 'vp8' && v.codec !== 'vp9') return null;
  if (ext === 'mp4' && v.codec !== 'h264') return null;
  if (!ext) return null;
  return { width: Math.max(2, Math.round((v.width * height) / v.height / 2) * 2), height, ext };
}

/** A copy's file name: its source's sha256 and its height. */
export function pageCopyName(sha256: string, height: PageCopyHeight, ext: 'webm' | 'mp4'): string {
  return `${sha256}-${String(height)}p.${ext}`;
}

/** FFmpeg's arguments for a copy written to `tmp`: the source's timeline kept exactly, only the picture smaller. */
export function pageCopyArgs(source: string, tmp: string, info: MediaInfo, plan: PageCopyPlan): string[] {
  const picture =
    plan.ext === 'webm'
      ? [
          '-c:v',
          info.video?.codec === 'vp9' ? 'libvpx-vp9' : 'libvpx',
          '-b:v',
          plan.height >= 720 ? '1500k' : '900k',
          '-deadline',
          'good',
          '-cpu-used',
          '4',
        ]
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-sc_threshold', '0'];
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    // The source's own times, each frame kept at its own (no frame added or dropped), keyframes where it has them
    // and nowhere else (the encoder's own turned off), and its sound's packets copied as they are.
    '-copyts',
    '-i',
    source,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-vf',
    `scale=${String(plan.width)}:${String(plan.height)}`,
    '-fps_mode',
    'passthrough',
    '-force_key_frames',
    'source',
    '-g',
    '100000',
    '-keyint_min',
    '100000',
    ...picture,
    '-c:a',
    'copy',
    '-threads',
    '1',
    ...(plan.ext === 'mp4' ? ['-movflags', '+faststart', '-f', 'mp4'] : ['-f', 'webm']),
    tmp,
  ];
}

/** A copy's name, and nothing else: its source's sha256, a height made, and its container. */
const NAME = /^([a-f0-9]{64})-(720|540)p\.(webm|mp4)$/u;

/** The copies in a list of names, each with its source's sha256 and height. */
function copiesOf(names: readonly string[]): { name: string; sha256: string; height: PageCopyHeight }[] {
  return names.flatMap((name) => {
    const m = NAME.exec(name);
    return m?.[1] && m[2] ? [{ name, sha256: m[1], height: Number(m[2]) as PageCopyHeight }] : [];
  });
}

/** The names of the plain files in the copies' folder (none when there is no folder). */
async function filesIn(mediaDir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(mediaDir, PAGE_COPIES_DIR), { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** The copies in the folder, by their source's sha256 (each with its heights). Any other file is not a copy. */
export async function pageCopiesIn(mediaDir: string): Promise<Map<string, PageCopyHeight[]>> {
  const found = new Map<string, PageCopyHeight[]>();
  for (const c of copiesOf(await filesIn(mediaDir)))
    found.set(c.sha256, [...(found.get(c.sha256) ?? []), c.height]);
  return found;
}

/**
 * Deletes the copies whose source is gone or changed: those named by a sha256 no media row has now. Only files named
 * exactly as copies are in the folder are looked at; nothing else is ever touched. Says which it deleted.
 */
export async function sweepPageCopies(mediaDir: string, liveShas: ReadonlySet<string>): Promise<string[]> {
  const gone: string[] = [];
  for (const c of copiesOf(await filesIn(mediaDir))) {
    if (liveShas.has(c.sha256)) continue;
    await rm(join(mediaDir, PAGE_COPIES_DIR, c.name), { force: true });
    gone.push(c.name);
  }
  return gone;
}

/** Deletes one source's copies, as its own file goes (media-removal.ts). */
export async function removePageCopiesOf(mediaDir: string, sha256: string): Promise<void> {
  for (const c of copiesOf(await filesIn(mediaDir)))
    if (c.sha256 === sha256) await rm(join(mediaDir, PAGE_COPIES_DIR, c.name), { force: true });
}
