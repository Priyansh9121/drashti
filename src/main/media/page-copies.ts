import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConvertService, ReadWords } from '../convert/convert-service';
import { STREAM_PRESETS } from '../../shared/stream';
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
export function pageCopyArgs(source: string, tmp: string, _info: MediaInfo, plan: PageCopyPlan): string[] {
  // The stream's copy (720p) at twice the bitrate of the presets that stream it, so the stream's own encoding, not the
  // copy, decides its picture (a22-review-fadecopies S8; a22-fadeprep's measure: at 1.5 Mbps libvpx's fastest VP8 came
  // out below what the weak preset then encodes; at twice its bitrate, VP8 and H.264 alike, clearly above). VP9 is made
  // as VP8: libvpx's fastest VP9 was below the stream's even at 6 Mbps. LIVE's (540p) is never streamed.
  const streamed = Math.max(
    ...Object.values(STREAM_PRESETS)
      .filter((p) => p.height <= plan.height)
      .map((p) => p.videoKbps),
    0,
  );
  const kbps = plan.height >= 720 ? Math.max(2 * streamed, 1500) : 900;
  const picture =
    plan.ext === 'webm'
      ? ['-c:v', 'libvpx', '-b:v', `${String(kbps)}k`, '-deadline', 'realtime', '-cpu-used', '8']
      : plan.height >= 720
        ? [
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-b:v',
            `${String(kbps)}k`,
            '-maxrate',
            `${String(Math.round(kbps * 1.5))}k`,
            '-bufsize',
            `${String(kbps * 2)}k`,
            '-pix_fmt',
            'yuv420p',
            '-sc_threshold',
            '0',
          ]
        : [
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '21',
            '-pix_fmt',
            'yuv420p',
            '-sc_threshold',
            '0',
          ];
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    // The source's own times, each frame kept at its own (no frame added or dropped), keyframes where it has them
    // and nowhere else (the encoder's own turned off), and its sound's packets copied as they are.
    '-copyts',
    // One thread for the decoding and the filters too, given before the input (as the lighter copies are: one before
    // it limits only the encoders, a22-review-fadecopies S2).
    '-threads',
    '1',
    '-filter_threads',
    '1',
    '-i',
    source,
    // The first real video, never an attached cover picture.
    '-map',
    '0:V:0',
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

/**
 * Whether the worker makes a copy once it has read the source (saveCopy's `inspect`): not of a video turned by its
 * display matrix (most phone videos), since FFmpeg turns it upright before the scale and the copy comes out squashed
 * (a22-review-fadecopies M2). Such a video plays its original everywhere.
 */
export function pageCopyInspect(_info: MediaInfo, read: ReadWords): false | undefined {
  for (const m of read.words.matchAll(/rotation of (-?\d+(?:\.\d+)?) degrees/gu))
    if (Number(m[1]) !== 0) return false;
  return undefined;
}

/** How far a copy's length may be from its source's: within a frame. */
const LENGTH_WITHIN_MS = 50;

/**
 * The check of a finished copy, as FFmpeg reads it back before it is published (saveCopy's `validate`; M1): the size
 * planned, the source's length within a frame, and its sound if the source has sound. Says what is wrong, or nothing.
 */
export function pageCopyCheck(
  source: MediaInfo,
  plan: PageCopyPlan,
): (copy: MediaInfo) => string | undefined {
  return (copy) => {
    if (!copy.video) return 'The page copy has no picture.';
    if (copy.video.width !== plan.width || copy.video.height !== plan.height)
      return 'The page copy is not the size it was made at.';
    if (
      source.durationMs != null &&
      (copy.durationMs == null || Math.abs(copy.durationMs - source.durationMs) > LENGTH_WITHIN_MS)
    )
      return 'The page copy is not as long as its video.';
    if (source.audio && !copy.audio) return 'The page copy lost its video’s sound.';
    return undefined;
  };
}

/**
 * Whether copies may be made now: nothing up, not on air or recording, and no cue waiting for its Go, since every page
 * warms its decoder for an armed cue (a22-review-fadecopies S11).
 */
export function pageCopiesMayWork(now: {
  streamInUse: boolean;
  onAir: boolean;
  layersUp: boolean;
  cueArmed: boolean;
}): boolean {
  return !now.streamInUse && !now.onAir && !now.layersUp && !now.cueArmed;
}

/**
 * What the engine plays for a playlist's video, so the copy is made of that (a22-review-fadecopies S1): its Edit
 * Video version, then that one's lighter playing copy. None while either is preparing (the engine shows no original
 * in their place).
 */
export function pageCopySource(
  listed: string,
  how: {
    edit(id: string): { readyMediaId: string | null } | null;
    proxy(id: string): { mediaId: string | null };
  },
): string | null {
  const edited = how.edit(listed);
  const shown = edited === null ? listed : edited.readyMediaId;
  return shown === null ? null : how.proxy(shown).mediaId;
}

const removeFile = (file: string) => rm(file, { force: true });

/** An error's code or message, for a log line. */
function problem(e: unknown): string {
  if (e instanceof Error) return (e as Error & { code?: string }).code ?? e.message;
  return String(e);
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
export async function sweepPageCopies(
  mediaDir: string,
  liveShas: ReadonlySet<string>,
  remove: (file: string) => Promise<void> = removeFile,
): Promise<string[]> {
  const gone: string[] = [];
  for (const c of copiesOf(await filesIn(mediaDir))) {
    if (liveShas.has(c.sha256)) continue;
    // One another program holds (a scan, on Windows) is left for the next start; the rest go on (M4).
    const removed = await remove(join(mediaDir, PAGE_COPIES_DIR, c.name)).then(
      () => true,
      () => false,
    );
    if (removed) gone.push(c.name);
  }
  return gone;
}

/** Deletes one source's copies, as its own file goes (media-removal.ts). */
export async function removePageCopiesOf(
  mediaDir: string,
  sha256: string,
  remove: (file: string) => Promise<void> = removeFile,
): Promise<void> {
  // One that cannot be deleted now is swept at a later start, its source gone (M4): the purge goes on.
  for (const c of copiesOf(await filesIn(mediaDir)))
    if (c.sha256 === sha256) await remove(join(mediaDir, PAGE_COPIES_DIR, c.name)).catch(() => undefined);
}

/** A video a page copy may be made of: in a playlist that crossfades (index.ts). */
export interface PageCopyCandidate {
  mediaId: string;
  sha256: string;
  /** Relative to the media folder. */
  path: string;
}

export interface PageCopiesDeps {
  mediaDir: string;
  /** A two-core computer, or one that draws and decodes video in software: the only ones copies are made on. */
  slow(): boolean;
  /** Nothing up, not on air, not recording: copies are made only then (and saveCopy waits while a show is up). */
  idle(): boolean;
  candidates(): PageCopyCandidate[];
  /** Every media row's sha256 now: a copy named by any other is its source's no more. */
  liveShas(): ReadonlySet<string>;
  info(file: string): Promise<MediaInfo>;
  conversions: Pick<ConvertService, 'saveCopy'>;
  /** The copies ready changed: the pages are told (media:page-copies-changed). */
  changed(): void;
  log(line: string): void;
  /** Deleting a file (tests: one another program holds). */
  remove?: (file: string) => Promise<void>;
  /** RED STUB (lead 2's option B, S8): not used yet. */
  heights?: readonly PageCopyHeight[];
}

/** RED STUB (lead 2's option B, S8): no-op body, filled in by the next commit. */
export function pageCopyHeightsFor(_value: string | undefined): readonly PageCopyHeight[] {
  return PAGE_COPY_HEIGHTS;
}

/** Makes the page copies, one at a time while idle, and says which are there. */
export class PageCopies {
  /** By source sha256: the copies there, height to file name. */
  private readonly there = new Map<string, Map<PageCopyHeight, string>>();
  /** By source sha256: what FFmpeg read of it (null: none made of it, after a failure or an unreadable file). */
  private readonly infos = new Map<string, MediaInfo | null>();
  private working = false;
  private closed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly deps: PageCopiesDeps) {}
  /** Sweeps once (a copy whose source is gone or changed), reads what is there, then looks every 2 s. */
  async start(): Promise<void> {
    // Nothing here may throw: a rejection would be written to the crash journal (a22-review-fadecopies M4).
    try {
      const gone = await sweepPageCopies(this.deps.mediaDir, this.deps.liveShas(), this.deps.remove);
      if (gone.length > 0)
        this.deps.log(`Page copies: ${String(gone.length)} whose video is gone or changed removed`);
      const names = await filesIn(this.deps.mediaDir);
      for (const c of copiesOf(names)) {
        const byHeight = this.there.get(c.sha256) ?? new Map<PageCopyHeight, string>();
        byHeight.set(c.height, c.name);
        this.there.set(c.sha256, byHeight);
      }
    } catch (e) {
      this.warn(
        `Page copies: could not look at the copies already made (${problem(e)}); none are used until then`,
      );
    }
    if (this.closed || this.timer) return;
    this.timer = setInterval(() => {
      void this.step();
    }, 2000);
    this.timer.unref();
  }
  /** One step: the next copy wanted, made (or nothing). Never throws. */
  async step(): Promise<void> {
    if (this.working || this.closed || !this.deps.slow() || !this.deps.idle()) return;
    this.working = true;
    let sha: string | null = null;
    try {
      for (const c of this.deps.candidates()) {
        sha = c.sha256;
        const source = join(this.deps.mediaDir, c.path);
        let info = this.infos.get(c.sha256);
        if (info === undefined) {
          info = await this.deps.info(source).catch(() => null);
          this.infos.set(c.sha256, info);
        }
        if (!info) continue;
        for (const height of PAGE_COPY_HEIGHTS) {
          const plan = pageCopyPlan(info, height);
          if (!plan || this.there.get(c.sha256)?.has(height)) continue;
          if (this.isClosed() || !this.deps.idle()) return;
          const name = pageCopyName(c.sha256, height, plan.ext);
          const dest = join(this.deps.mediaDir, PAGE_COPIES_DIR, name);
          await mkdir(join(this.deps.mediaDir, PAGE_COPIES_DIR), { recursive: true });
          const done = await this.deps.conversions.saveCopy(source, dest, info, {
            args: (tmp) => pageCopyArgs(source, tmp, info, plan),
            lengthMs: info.durationMs ?? 0,
            waitForShow: true,
            background: true,
            // A turned video: none (M2); the copy read back before it is published (M1); stopped outright as a
            // show starts (S9); and it gives way to an operator's save (S10, by its kind).
            inspect: pageCopyInspect,
            validate: pageCopyCheck(info, plan),
            stopAtOnce: true,
            kind: 'page-copy',
          }).done;
          // Published under exactly its own name, or not at all (a file there already gets a free name: not a copy).
          if (done.ok && done.copy === dest) {
            const byHeight = this.there.get(c.sha256) ?? new Map<PageCopyHeight, string>();
            byHeight.set(height, name);
            this.there.set(c.sha256, byHeight);
            this.deps.log(`Page copies: ${name} made`);
            this.deps.changed();
          } else {
            // Not again and again: this video gets no more copies until Drashti starts again.
            this.infos.set(c.sha256, null);
            this.deps.log(
              `Page copies: ${name} not made${done.ok ? (done.copy === null ? ' (a turned video plays its original)' : '') : ` (${done.message})`}`,
            );
          }
          return;
        }
      }
    } catch (e) {
      // A folder it cannot make, a library it cannot read: said once, and that video is not tried again (M4).
      if (sha) this.infos.set(sha, null);
      this.warn(`Page copies: could not make a copy (${problem(e)}); the videos play their originals`);
    } finally {
      this.working = false;
    }
  }
  /** A problem said once a run, not every 2 s. */
  private readonly said = new Set<string>();
  private warn(line: string): void {
    if (this.said.has(line)) return;
    this.said.add(line);
    this.deps.log(line);
  }
  /** The copy of these bytes at this height, relative to the media folder, if it is there. */
  relativePath(sha256: string, height: PageCopyHeight): string | null {
    const name = this.there.get(sha256)?.get(height);
    return name ? join(PAGE_COPIES_DIR, name) : null;
  }
  /** The heights ready for each candidate video now, by its media id (what the pages are told). */
  ready(): Record<string, PageCopyHeight[]> {
    const out: Record<string, PageCopyHeight[]> = {};
    try {
      for (const c of this.deps.candidates()) {
        const heights = [...(this.there.get(c.sha256)?.keys() ?? [])].sort((a, b) => a - b);
        if (heights.length > 0) out[c.mediaId] = heights;
      }
    } catch (e) {
      // The library unreadable for a moment: no copies said, every page plays the originals (M4).
      this.warn(`Page copies: could not read which videos have copies (${problem(e)})`);
      return {};
    }
    return out;
  }
  /** Closed meanwhile (a read or a copy awaited in between). */
  private isClosed(): boolean {
    return this.closed;
  }
  close(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
