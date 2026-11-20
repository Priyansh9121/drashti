import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ANALYSIS_VERSION,
  STORY_FRAMES,
  WAVEFORM_BUCKETS,
  type VideoAnalysis,
  type VideoAnalysisResult,
} from '../../shared/video-analysis';
import type { DetailsRow } from '../media/media-details';
import type { ConvertService, CopyOptions } from './convert-service';
import type { MediaInfo } from './plan';
import { SceneReducer, WaveformReducer } from './video-analysis-reducers';

const MAX_ARTIFACT_BYTES = 2 * 1024 ** 2;
const CACHE_BYTES = 128 * 1024 ** 2;
const point = z.number().min(-1).max(1);
const artifactSchema = z.object({
  version: z.literal(ANALYSIS_VERSION),
  durationMs: z.number().int().positive().max(86_400_000),
  waveform: z
    .object({
      durationMs: z.number().int().positive(),
      peaks: z
        .array(z.tuple([point, point]))
        .min(1)
        .max(WAVEFORM_BUCKETS),
    })
    .nullable(),
  scenes: z.array(z.number().int().positive().max(86_400_000)).max(50),
  storyboard: z.string().max(MAX_ARTIFACT_BYTES).startsWith('data:image/jpeg;base64,'),
});
const visualSchema = artifactSchema.omit({ waveform: true }).extend({ hasAudio: z.boolean() });
type Visual = z.infer<typeof visualSchema>;
type Queue = (suffix: string, options: CopyOptions) => Promise<string>;
const keptSchema = z
  .array(
    z.object({
      mediaId: z.string().min(1).max(100),
      audioStream: z.number().int().min(0).max(255).nullable(),
    }),
  )
  .max(200);
type Kept = z.infer<typeof keptSchema>[number];
class AnalysisFailure extends Error {
  constructor(readonly words: string) {
    super(words);
  }
}
interface Entry {
  source: string;
  sha: string;
  request: Kept;
  job: string | null;
  state: VideoAnalysis['state'];
  note: string | null;
  message: string | null;
  durationMs: number;
}
export interface VideoAnalysisDeps {
  mediaDir: string;
  row(mediaId: string): DetailsRow | null;
  conversions: Pick<ConvertService, 'saveCopy' | 'cancelFile'>;
}

/** Operator-only derived data. All FFmpeg work is owned by conversion's single idle worker. */
export class VideoAnalysisService {
  private readonly dir: string;
  private readonly parts: string;
  private readonly entries = new Map<string, Entry>();
  private readonly visualGoing = new Map<string, Promise<Visual>>();
  private readonly requested = new Map<string, Kept>();
  private closed = false;
  constructor(private readonly deps: VideoAnalysisDeps) {
    this.dir = join(deps.mediaDir, 'video-analysis');
    this.parts = join(this.dir, 'parts');
    mkdirSync(this.parts, { recursive: true });
  }
  /** Called after startup recovery; conversions still enforce show/stream/recording gates. */
  resume(): void {
    try {
      const text = this.readSmall(join(this.dir, 'requests.json'));
      for (const request of keptSchema.parse(JSON.parse(text)))
        this.get(request.mediaId, request.audioStream);
    } catch {
      /* No previous requests, or a damaged cache. The source and markers are unaffected. */
    }
  }
  private key(sha: string, audioStream: number | null): string {
    return `${sha}-${audioStream === null ? 'silent' : String(audioStream)}-v${String(ANALYSIS_VERSION)}`;
  }
  private readSmall(file: string): string {
    if (statSync(file).size > MAX_ARTIFACT_BYTES) throw new Error('Analysis cache is too large.');
    return readFileSync(file, 'utf8');
  }
  private cached(key: string): z.infer<typeof artifactSchema> | null {
    try {
      return artifactSchema.parse(JSON.parse(this.readSmall(join(this.dir, `${key}.json`))));
    } catch {
      return null;
    }
  }
  private keep(): void {
    const tmp = join(this.dir, 'requests.part');
    writeFileSync(tmp, JSON.stringify([...this.requested.values()].slice(-200)));
    renameSync(tmp, join(this.dir, 'requests.json'));
  }
  /** Audio stream is the source's zero-based audio ordinal (0:a:N), null explicitly requests no audio. */
  get(mediaId: string, audioStream: number | null = 0, retry = false): VideoAnalysisResult {
    if (this.closed)
      return { ok: false, message: 'Drashti is closing. Open the video again after restarting.' };
    const row = this.deps.row(mediaId);
    if (
      !row ||
      row.deleted ||
      row.missing ||
      row.kind !== 'video' ||
      !row.path ||
      !row.sha256 ||
      !/^[a-f0-9]{64}$/u.test(row.sha256)
    )
      return {
        ok: false,
        message: 'This video’s original is unavailable. Restore its file, then try again.',
      };
    if (audioStream !== null && (!Number.isInteger(audioStream) || audioStream < 0 || audioStream > 255))
      return { ok: false, message: 'Choose an audio track from this video, then try again.' };
    const key = this.key(row.sha256, audioStream);
    let entry = this.entries.get(key);
    const cached = this.cached(key);
    if (cached)
      return {
        ok: true,
        analysis: {
          mediaId,
          audioStream,
          state: 'ready',
          note: null,
          message: null,
          durationMs: cached.durationMs,
          waveform: cached.waveform,
          scenes: cached.scenes,
          storyboard: cached.storyboard,
        },
      };
    if (entry?.state === 'ready') {
      this.entries.delete(key);
      entry = undefined;
    }
    if (retry && entry?.state === 'failed') {
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      if (this.entries.size >= 200) {
        const removable = [...this.entries].find(
          ([, value]) => value.state === 'ready' || value.state === 'failed',
        );
        if (removable) {
          this.entries.delete(removable[0]);
          this.requested.delete(removable[0]);
        } else
          return {
            ok: false,
            message: 'Many videos are waiting to prepare. Let some finish, then try again.',
          };
      }
      entry = {
        source: join(this.deps.mediaDir, row.path),
        sha: row.sha256,
        request: { mediaId, audioStream },
        job: null,
        state: 'waiting',
        note: 'Waiting for an idle moment.',
        message: null,
        durationMs: row.durationMs ?? 0,
      };
      this.entries.set(key, entry);
      this.requested.set(key, entry.request);
      try {
        this.keep();
      } catch {
        entry.state = 'failed';
        entry.message =
          'Drashti could not keep this preparation request. Free some disk space, then try again.';
      }
      if (entry.state !== 'failed') void this.run(key, entry);
    }
    return {
      ok: true,
      analysis: {
        mediaId,
        audioStream,
        state: entry.state,
        note: entry.note,
        message: entry.message,
        durationMs: entry.durationMs,
        waveform: null,
        scenes: [],
        storyboard: null,
      },
    };
  }
  private current(entry: Entry): boolean {
    const row = this.deps.row(entry.request.mediaId);
    return (
      !this.closed &&
      !!row &&
      !row.deleted &&
      !row.missing &&
      row.sha256 === entry.sha &&
      join(this.deps.mediaDir, row.path) === entry.source
    );
  }
  private async run(key: string, entry: Entry): Promise<void> {
    const info: MediaInfo = { durationMs: entry.durationMs || null, video: null, audio: null };
    const base = [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-threads',
      '1',
      '-filter_threads',
      '1',
      '-protocol_whitelist',
      'file,pipe',
      '-i',
      entry.source,
    ];
    const queue = async (suffix: string, options: CopyOptions): Promise<string> => {
      if (!this.current(entry))
        throw new AnalysisFailure('The video changed or was removed. Open its editor again.');
      entry.note = null;
      entry.state = 'waiting';
      const queued = this.deps.conversions.saveCopy(
        entry.source,
        join(this.parts, `${key}.${suffix}`),
        info,
        {
          ...options,
          lengthMs: info.durationMs ?? 0,
          waitForShow: true,
          strictPriority: true,
          estimatedBytes: MAX_ARTIFACT_BYTES,
          kind: 'analysis',
          waiting: (note) => {
            entry.note = note;
            entry.state = note ? 'waiting' : 'preparing';
          },
          progress: () => {
            if (!entry.note) entry.state = 'preparing';
          },
          beforePublish: () => {
            if (!this.current(entry)) throw new Error('Source changed.');
          },
        },
      );
      entry.job = queued.id;
      const result = await queued.done;
      entry.job = null;
      if (!result.ok) throw new AnalysisFailure(result.message);
      if (!result.copy)
        throw new AnalysisFailure('No prepared file was kept. Check the video, then try again.');
      return result.copy;
    };
    try {
      const visual = await this.visual(entry, info, queue, base);
      info.durationMs = visual.durationMs;
      info.audio = visual.hasAudio ? { codec: 'source audio' } : null;
      entry.durationMs = visual.durationMs;
      let waveform: VideoAnalysis['waveform'] = null;
      if (info.audio && entry.request.audioStream !== null) {
        let peaks = new WaveformReducer(entry.durationMs, 48000);
        const waveformFile = await queue('waveform.json', {
          lengthMs: entry.durationMs,
          args: () => {
            peaks = new WaveformReducer(entry.durationMs, 48000);
            return [
              ...base,
              '-map',
              `0:a:${String(entry.request.audioStream)}`,
              '-vn',
              '-sn',
              '-dn',
              '-ac',
              '1',
              '-ar',
              '48000',
              '-c:a',
              'pcm_s16le',
              '-f',
              's16le',
              'pipe:1',
            ];
          },
          stdout: (chunk) => peaks.push(chunk),
          finish: (tmp) => {
            writeFileSync(tmp, JSON.stringify(peaks.finish()));
          },
        });
        waveform = JSON.parse(this.readThenRemove(waveformFile)) as VideoAnalysis['waveform'];
      }
      const artifact = artifactSchema.parse({ ...visual, waveform });
      if (!this.current(entry))
        throw new AnalysisFailure('The video changed or was removed. Open its editor again.');
      const tmp = join(this.dir, `${key}.part`);
      writeFileSync(tmp, JSON.stringify(artifact));
      renameSync(tmp, join(this.dir, `${key}.json`));
      entry.state = 'ready';
      entry.note = null;
      this.requested.delete(key);
      this.keep();
      this.prune(key);
    } catch (error) {
      entry.state = 'failed';
      entry.note = null;
      entry.message =
        error instanceof AnalysisFailure
          ? error.words
          : 'The video could not be prepared. Check its file, then try again.';
    }
  }
  private readThenRemove(file: string): string {
    try {
      return this.readSmall(file);
    } finally {
      rmSync(file, { force: true });
    }
  }
  private async visual(entry: Entry, info: MediaInfo, queue: Queue, base: string[]): Promise<Visual> {
    const key = `${entry.sha}-visual-v${String(ANALYSIS_VERSION)}`;
    try {
      return visualSchema.parse(JSON.parse(this.readSmall(join(this.dir, `${key}.json`))));
    } catch {
      /* Rebuild a missing visual cache once per source. */
    }
    const going = this.visualGoing.get(key);
    if (going) return going;
    const make = async (): Promise<Visual> => {
      let cuts = new SceneReducer(1);
      const scenesFile = await queue('scenes.json', {
        lengthMs: 0,
        inspect: (read) => {
          if (!read.durationMs || read.durationMs > 86_400_000 || !read.video || read.video.still)
            throw new Error('Unknown length.');
          Object.assign(info, read);
          entry.durationMs = read.durationMs;
        },
        args: () => {
          cuts = new SceneReducer(entry.durationMs);
          return [
            ...base,
            '-map',
            '0:V:0',
            '-an',
            '-sn',
            '-dn',
            '-vf',
            "scale=320:-2,select='gt(scene,0.3)',metadata=mode=print:file=-",
            '-f',
            'null',
            '-',
          ];
        },
        stdout: (chunk) => cuts.push(chunk),
        finish: (tmp) => {
          writeFileSync(tmp, JSON.stringify(cuts.finish()));
        },
      });
      const scenes = z
        .array(z.number().int().positive())
        .max(50)
        .parse(JSON.parse(this.readThenRemove(scenesFile)));
      const sheet = await queue('sheet.jpg', {
        lengthMs: entry.durationMs,
        args: (tmp) => [
          ...base,
          '-map',
          '0:V:0',
          '-an',
          '-sn',
          '-dn',
          '-vf',
          `fps=${String(STORY_FRAMES * 1000)}/${String(entry.durationMs)}:round=up,scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,tile=20x1`,
          '-frames:v',
          '1',
          '-q:v',
          '4',
          '-threads',
          '1',
          '-f',
          'image2',
          '-update',
          '1',
          tmp,
        ],
      });
      let storyboard: string;
      try {
        if (statSync(sheet).size > 1024 ** 2)
          throw new AnalysisFailure('The generated preview is too large. Try again.');
        const data = readFileSync(sheet);
        if (data[0] !== 0xff || data[1] !== 0xd8)
          throw new AnalysisFailure('The generated preview is unreadable. Try again.');
        storyboard = `data:image/jpeg;base64,${data.toString('base64')}`;
      } finally {
        rmSync(sheet, { force: true });
      }
      const visual = visualSchema.parse({
        version: ANALYSIS_VERSION,
        durationMs: entry.durationMs,
        hasAudio: info.audio !== null,
        scenes,
        storyboard,
      });
      if (!this.current(entry))
        throw new AnalysisFailure('The video changed or was removed. Open its editor again.');
      const tmp = join(this.dir, `${key}.part`);
      writeFileSync(tmp, JSON.stringify(visual));
      renameSync(tmp, join(this.dir, `${key}.json`));
      return visual;
    };
    const promise = make();
    this.visualGoing.set(key, promise);
    try {
      return await promise;
    } finally {
      this.visualGoing.delete(key);
    }
  }
  private prune(keep: string): void {
    try {
      const files = readdirSync(this.dir)
        .filter((name) => /^[a-f0-9]{64}-(?:silent|visual|\d+)-v\d+\.json$/u.test(name))
        .map((name) => {
          const stat = statSync(join(this.dir, name));
          return { name, size: stat.size, mtimeMs: stat.mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      let bytes = 0;
      for (const [at, file] of files.entries()) {
        bytes += file.size;
        if ((at >= 200 || bytes > CACHE_BYTES) && file.name !== `${keep}.json`)
          rmSync(join(this.dir, file.name), { force: true });
      }
    } catch {
      /* Cache trimming can wait; source media is never removed here. */
    }
  }
  close(): void {
    this.closed = true;
    for (const entry of this.entries.values()) if (entry.job) this.deps.conversions.cancelFile(entry.job);
  }
}
