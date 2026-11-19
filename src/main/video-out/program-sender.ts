import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { setPriority } from 'node:os';
import { cutText } from '../../shared/text';
import type { RawFormat, RawFrame, Sender } from './frames';

/*
 * In the video-out process (x30): Drashti's own small program for this computer's way (drashti-video-out: Syphon on a
 * Mac, Spout on Windows; tools/video-out/, built by scripts/fetch-video-out.mjs), fed each frame on its input
 * (tools/video-out/frame-input.h: a 16-byte header, then the frame). One frame at a time: a frame that comes while
 * the one before is still being taken is let go, so nothing waits in memory. It runs below the show's priority, and
 * whatever goes wrong in it ends that program alone, never Drashti.
 */

export const FORMAT_CODES: Record<RawFormat, number> = { I420: 1, NV12: 2, BGRA: 3, RGBA: 4 };

/** The 16-byte header before a frame's bytes. */
export function frameHeader(frame: Pick<RawFrame, 'format' | 'width' | 'height'>): Buffer {
  const header = Buffer.alloc(16);
  header.write('DVO1', 0, 'latin1');
  header.writeUInt32LE(FORMAT_CODES[frame.format], 4);
  header.writeUInt32LE(frame.width, 8);
  header.writeUInt32LE(frame.height, 12);
  return header;
}

/** A program that ends (or never starts), said in plain words. */
export const PROGRAM_ENDED = 'The program that sends the picture stopped.';

export class ProgramSender implements Sender {
  private readonly child: ChildProcessWithoutNullStreams;
  private busy = false;
  private failure: string | null = null;
  private stopped = false;

  constructor(
    program: string,
    name: string,
    private readonly log: (level: 'info' | 'warn', message: string) => void,
    private readonly ended: (message: string) => void,
    start: typeof spawn = spawn,
  ) {
    this.child = start(program, ['--name', name], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    // Below the show: a slide change never waits for a frame going out.
    try {
      if (this.child.pid !== undefined) setPriority(this.child.pid, 10);
    } catch {
      // Not allowed here: it runs at normal priority.
    }
    const lines = (level: 'info' | 'warn') => (data: Buffer) => {
      for (const line of data.toString().split(/\r?\n/u))
        if (line.trim()) this.log(level, cutText(line.trim(), 300));
    };
    this.child.stdout.on('data', lines('info'));
    this.child.stderr.on('data', lines('warn'));
    // A program gone mid-write: its input's error is the same ending, said once below.
    this.child.stdin.on('error', () => undefined);
    // What went wrong goes to the log; what people see says it in plain words.
    this.child.on('error', (error) => {
      this.log('warn', `The program could not start or stopped: ${error.message}`);
      this.fail();
    });
    this.child.on('exit', (code, signal) => {
      this.log('warn', `The program ended (${code !== null ? `exit ${String(code)}` : String(signal)})`);
      this.fail();
    });
  }

  private fail(): void {
    if (this.failure) return;
    this.failure = PROGRAM_ENDED;
    if (!this.stopped) this.ended(PROGRAM_ENDED);
  }

  frame(frame: RawFrame): boolean {
    if (this.failure || this.stopped || this.busy) return false;
    this.busy = true;
    this.child.stdin.write(frameHeader(frame));
    this.child.stdin.write(frame.data, () => {
      this.busy = false;
    });
    return true;
  }

  error(): string | null {
    return this.failure;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    // Its input's end stops it; if it has not gone a moment later, it is ended.
    this.child.stdin.end();
    setTimeout(() => {
      if (this.child.exitCode === null) this.child.kill();
    }, 2000).unref();
  }
}
