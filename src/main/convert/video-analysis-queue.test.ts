import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants, getPriority, setPriority, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Db } from '../db/database';
import { ConvertService, type CopyOptions } from './convert-service';

vi.mock(import('node:child_process'), async (original) => ({ ...(await original()), spawn: vi.fn() }));
vi.mock(import('node:os'), async (original) => ({
  ...(await original()),
  setPriority: vi.fn(),
  getPriority: vi.fn(),
}));
let dir = '';
let db: Db;
let service: ConvertService;
let show = false;
let busy: string | null = null;
const children: {
  child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number };
  tmp: string;
  kill: ReturnType<typeof vi.fn>;
}[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  show = false;
  busy = null;
  children.length = 0;
  vi.mocked(getPriority).mockReturnValue(constants.priority.PRIORITY_LOW);
  vi.mocked(setPriority).mockReset();
  dir = mkdtempSync(join(tmpdir(), 'drashti-analysis-queue-'));
  db = openDatabase(join(dir, 'library.sqlite'));
  writeFileSync(join(dir, 'source.mp4'), 'Placeholder source');
  vi.mocked(spawn).mockImplementation((_command, rawArgs) => {
    const tmp: unknown = Array.isArray(rawArgs) ? rawArgs[0] : '';
    if (typeof tmp !== 'string') throw new Error('Expected a placeholder output path.');
    const kill = vi.fn(() => true);
    const child = Object.assign(new EventEmitter(), {
      pid: 1234,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill,
    });
    writeFileSync(tmp, 'Partial placeholder');
    children.push({ child, tmp, kill });
    return child as unknown as ReturnType<typeof spawn>;
  });
  service = new ConvertService({
    db,
    mediaDir: dir,
    ffmpegPath: () => 'placeholder',
    busy: () => busy,
    showBusy: () => show,
    freeBytes: () => 100 * 1024 ** 3,
    changed: () => undefined,
    libraryChanged: () => undefined,
    log: () => undefined,
  });
});
afterEach(() => {
  service.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});
function queued(options: Partial<CopyOptions> = {}) {
  return service.saveCopy(
    join(dir, 'source.mp4'),
    join(dir, 'complete.json'),
    { durationMs: 1000, video: null, audio: null },
    { args: (tmp) => [tmp], lengthMs: 1000, waitForShow: true, strictPriority: true, ...options },
  );
}
function finish(index: number) {
  const child = children[index]?.child;
  if (!child) throw new Error('Preparation did not start.');
  child.emit('exit', 0);
  child.emit('close', 0);
}

describe('one idle worker for analysis', () => {
  it.each(['show', 'stream', 'recording'])(
    'starts no preparation during a %s and removes/restarts an interrupted partial',
    async (activity) => {
      if (activity === 'show') show = true;
      else busy = `Waiting for ${activity}.`;
      const waiting = vi.fn();
      const job = queued({ waiting });
      await vi.advanceTimersByTimeAsync(1000);
      expect(children).toHaveLength(0);
      expect(waiting).toHaveBeenCalled();
      show = false;
      busy = null;
      await vi.advanceTimersByTimeAsync(1000);
      expect(children).toHaveLength(1);
      if (activity === 'show') show = true;
      else busy = `Waiting for ${activity}.`;
      service.activityChanged();
      expect(children[0]?.kill).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1000);
      expect(children).toHaveLength(1);
      finish(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(existsSync(children[0]?.tmp ?? '')).toBe(false);
      expect(existsSync(join(dir, 'complete.json'))).toBe(false);
      show = false;
      busy = null;
      await vi.advanceTimersByTimeAsync(1000);
      expect(children).toHaveLength(2);
      finish(1);
      await expect(job.done).resolves.toMatchObject({ ok: true });
      expect(readFileSync(join(dir, 'complete.json'), 'utf8')).toBe('Partial placeholder');
    },
  );
  it('drains stdout after exit before reducing/publishing, and serializes the next job until close', async () => {
    let text = '';
    const job = queued({
      stdout: (chunk) => {
        text += chunk.toString();
      },
      finish: (tmp) => {
        writeFileSync(tmp, text);
      },
    });
    const next = service.saveCopy(
      join(dir, 'source.mp4'),
      join(dir, 'second.json'),
      { durationMs: 1, video: null, audio: null },
      { args: (tmp) => [tmp], lengthMs: 1, waitForShow: true, strictPriority: true },
    );
    const child = children[0]?.child;
    if (!child) throw new Error('Preparation did not start.');
    child.emit('exit', 0);
    child.stdout.emit('data', Buffer.from('late waveform samples'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(children).toHaveLength(1);
    expect(existsSync(join(dir, 'complete.json'))).toBe(false);
    child.emit('close', 0);
    await expect(job.done).resolves.toMatchObject({ ok: true });
    expect(readFileSync(join(dir, 'complete.json'), 'utf8')).toBe('late waveform samples');
    expect(children).toHaveLength(2);
    finish(1);
    await expect(next.done).resolves.toMatchObject({ ok: true });
  });
  it.each(['denied', 'unchanged'])('refuses and cleans preparation when priority is %s', async (reason) => {
    if (reason === 'denied')
      vi.mocked(setPriority).mockImplementation(() => {
        throw new Error('Placeholder denied.');
      });
    else vi.mocked(getPriority).mockReturnValue(0);
    const job = queued();
    expect(children[0]?.kill).toHaveBeenCalledOnce();
    finish(0);
    const result = await job.done;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Preparation unexpectedly succeeded.');
    expect(result.message).toContain('priority');
    expect(existsSync(children[0]?.tmp ?? '')).toBe(false);
    expect(existsSync(join(dir, 'complete.json'))).toBe(false);
  });
});
