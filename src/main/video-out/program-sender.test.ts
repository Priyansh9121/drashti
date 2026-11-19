import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { frameBytes, type RawFrame } from './frames';
import { FORMAT_CODES, frameHeader, PROGRAM_ENDED, ProgramSender } from './program-sender';

/*
 * The video-out process's side of Drashti's small program (x30): each frame on its input, one at a time, and what it
 * says and how it ends. The program is stood in for: nothing is started, nothing sent anywhere.
 */

/** A stand-in program: its input keeps what is written, each write finishing only when `finish()` is called. */
class FakeProgram extends EventEmitter {
  readonly written: Buffer[] = [];
  readonly pending: (() => void)[] = [];
  ended = false;
  exitCode: number | null = null;
  pid = undefined;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn();
  readonly stdin = new Writable({
    highWaterMark: 1,
    write: (chunk: Buffer, _encoding, done) => {
      this.written.push(Buffer.from(chunk));
      this.pending.push(() => {
        done();
      });
    },
    final: (done) => {
      this.ended = true;
      done();
    },
  });

  finish(): void {
    for (const f of this.pending.splice(0)) f();
  }
}

function rig() {
  const program = new FakeProgram();
  const start = vi.fn(() => program) as unknown as typeof spawn;
  const logs: string[] = [];
  const endings: string[] = [];
  const sender = new ProgramSender(
    '/somewhere/drashti-video-out',
    'Hall',
    (level, message) => logs.push(`${level} ${message}`),
    (message) => endings.push(message),
    start,
  );
  return { program, start, sender, logs, endings };
}

const frame = (format: RawFrame['format'] = 'NV12', width = 4, height = 2): RawFrame => ({
  format,
  width,
  height,
  data: new Uint8Array(frameBytes(format, width, height)).fill(7),
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('Drashti’s small program for this computer’s way (x30)', () => {
  it('is started with the name, and each frame goes on its input after a 16-byte header', async () => {
    const r = rig();
    expect(r.start).toHaveBeenCalledWith('/somewhere/drashti-video-out', ['--name', 'Hall'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    expect(r.sender.frame(frame('I420', 6, 4))).toBe(true);
    await flush();
    const header = r.program.written[0];
    expect(header?.toString('latin1', 0, 4)).toBe('DVO1');
    expect([header?.readUInt32LE(4), header?.readUInt32LE(8), header?.readUInt32LE(12)]).toEqual([1, 6, 4]);
    expect(frameHeader({ format: 'RGBA', width: 1920, height: 1080 }).readUInt32LE(4)).toBe(
      FORMAT_CODES.RGBA,
    );
    r.program.finish();
    await flush();
    expect(Buffer.concat(r.program.written.slice(1)).length).toBe(frameBytes('I420', 6, 4));
  });

  it('lets go of a frame that comes while the one before is still being taken', async () => {
    const r = rig();
    expect(r.sender.frame(frame())).toBe(true);
    expect(r.sender.frame(frame())).toBe(false);
    await flush();
    r.program.finish();
    await flush();
    r.program.finish();
    await flush();
    expect(r.sender.frame(frame())).toBe(true);
  });

  it('says what the program says, its errors as warnings', () => {
    const r = rig();
    r.program.stdout.emit('data', Buffer.from('ready\n'));
    r.program.stderr.emit('data', Buffer.from('Stopping after 3 frames\r\n'));
    expect(r.logs).toEqual(['info ready', 'warn Stopping after 3 frames']);
  });

  it('a program that ends: said once, as the sender’s trouble, and no frame taken after', () => {
    const r = rig();
    r.program.emit('exit', 3, null);
    r.program.emit('error', new Error('again'));
    expect(r.endings).toEqual([`${PROGRAM_ENDED} (exit 3)`]);
    expect(r.sender.error()).toBe(`${PROGRAM_ENDED} (exit 3)`);
    expect(r.sender.frame(frame())).toBe(false);
  });

  it('a program that cannot start: said in plain words', () => {
    const r = rig();
    r.program.emit('error', new Error('spawn ENOENT'));
    expect(r.endings).toEqual([`${PROGRAM_ENDED} (spawn ENOENT)`]);
  });

  it('stopped: its input ends (it stops by itself), and its ending then is not trouble', async () => {
    vi.useFakeTimers();
    try {
      const r = rig();
      r.sender.stop();
      await vi.advanceTimersByTimeAsync(10);
      expect(r.program.ended).toBe(true);
      r.program.exitCode = 0;
      r.program.emit('exit', 0, null);
      expect(r.endings).toEqual([]);
      await vi.advanceTimersByTimeAsync(2500);
      expect(r.program.kill).not.toHaveBeenCalled();
      expect(r.sender.frame(frame())).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stopped but still running 2 s later: ended', async () => {
    vi.useFakeTimers();
    try {
      const r = rig();
      r.sender.stop();
      await vi.advanceTimersByTimeAsync(2001);
      expect(r.program.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
