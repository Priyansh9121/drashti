import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';

/*
 * Small pictures of media for the remote's thumbnails, so a phone on slow
 * Wi-Fi never downloads a full picture or a video: a picture becomes a
 * 320-pixel JPEG and a video one still frame, made once by the bundled
 * FFmpeg (one at a time, at the lowest priority) and kept for next time.
 * The phone asks for them only when a thumbnail is on its screen.
 */

export const PREVIEW_WIDTH = 320;
/** Most a preview may be (FFmpeg's quality setting keeps them far smaller). */
export const PREVIEW_MAX_BYTES = 400 * 1024;
const QUEUE_MAX = 30;
const TIMEOUT_MS = 15_000;

export interface PreviewSource {
  /** The media file, inside Drashti's media folder (the main process checked it). */
  path: string;
  kind: 'image' | 'video';
}

export class PreviewMaker {
  private queue: (() => Promise<void>)[] = [];
  private running = false;
  private readonly pending = new Map<string, Promise<string | null>>();

  constructor(
    private readonly dir: string,
    private readonly ffmpeg: string | null,
  ) {}

  /** The preview's file (made now if need be), or null when it cannot be made. */
  get(mediaId: string, source: PreviewSource): Promise<string | null> {
    const file = join(this.dir, `${mediaId}-${PREVIEW_WIDTH}.jpg`);
    if (existsSync(file)) return Promise.resolve(file);
    const already = this.pending.get(mediaId);
    if (already) return already;
    if (!this.ffmpeg || this.queue.length >= QUEUE_MAX) return Promise.resolve(null);
    const made = new Promise<string | null>((resolve) => {
      this.queue.push(async () => {
        resolve(await this.make(source, file));
      });
      void this.drain();
    }).finally(() => this.pending.delete(mediaId));
    this.pending.set(mediaId, made);
    return made;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) await job();
    } finally {
      this.running = false;
    }
  }

  private make(source: PreviewSource, file: string): Promise<string | null> {
    const ffmpeg = this.ffmpeg;
    if (!ffmpeg) return Promise.resolve(null);
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.part.jpg`;
    const scale = `scale=${PREVIEW_WIDTH}:-2`;
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      // A video's frame from a moment in, past any fade from black.
      ...(source.kind === 'video' ? ['-ss', '0.5'] : []),
      '-i',
      source.path,
      '-frames:v',
      '1',
      '-vf',
      scale,
      '-q:v',
      '6',
      tmp,
    ];
    return new Promise((resolve) => {
      const child = spawn(ffmpeg, args, { windowsHide: true, stdio: 'ignore' });
      try {
        if (child.pid !== undefined) setPriority(child.pid, constants.priority.PRIORITY_LOW);
      } catch {
        // Not allowed here: it runs at normal priority.
      }
      const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        try {
          if (code === 0 && existsSync(tmp) && statSync(tmp).size <= PREVIEW_MAX_BYTES) {
            renameSync(tmp, file);
            resolve(file);
            return;
          }
        } catch {
          // Fall through: no preview.
        }
        rmSync(tmp, { force: true });
        resolve(null);
      });
    });
  }
}
