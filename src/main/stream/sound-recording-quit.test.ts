import type * as FsPromises from 'node:fs/promises';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPEECH_RATE } from '../../shared/speech';
import { SoundRecording } from './sound-recording';

/*
 * Record sound as Drashti quits (Session 58, X2: the alpha.16 review's L3). A disk that stops answering (a network
 * share gone away, a USB stick that hangs) is stood in for here: once `disk.stuck`, every write and sync of the
 * recording's file waits for ever, as such a disk's do.
 */

const disk = vi.hoisted(() => ({ stuck: false, files: [] as { close(): Promise<void> }[] }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const never = () => new Promise<never>(() => undefined);
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      disk.files.push(file);
      const write = file.write.bind(file) as (...a: unknown[]) => Promise<unknown>;
      const datasync = file.datasync.bind(file);
      return Object.assign(file, {
        write: (...a: unknown[]) => (disk.stuck ? never() : write(...a)),
        datasync: () => (disk.stuck ? never() : datasync()),
      });
    },
  };
});

const START = Date.UTC(2026, 10, 4, 12, 0, 0);
const TONE = Int16Array.from({ length: SPEECH_RATE / 10 }, (_, i) =>
  Math.round(12_000 * Math.sin((i * 2 * Math.PI * 440) / SPEECH_RATE)),
);

describe('Record sound as Drashti quits (Session 58, X2: the alpha.16 review’s L3)', () => {
  let dir: string;
  let clock = START;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'drashti-sound-quit-'));
    clock = START;
    disk.stuck = false;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  });
  afterEach(async () => {
    vi.useRealTimers();
    disk.stuck = false;
    await Promise.all(disk.files.splice(0).map((file) => file.close().catch(() => undefined)));
    await rm(dir, { recursive: true, force: true });
  });

  function recording(): SoundRecording {
    const rec = new SoundRecording({
      now: () => clock,
      freeBytes: () => Promise.resolve(100 * 1024 ** 3),
      onFat: () => Promise.resolve(false),
      keepFree: 2 * 1024 ** 3,
      changed: () => undefined,
      notice: () => undefined,
    });
    rec.start(dir);
    return rec;
  }

  /** 100 ms of sound ending now, as the stream's page sends it. */
  const heard = (rec: SoundRecording) => {
    clock += 100;
    rec.chunk(TONE, clock, clock - 100);
  };

  async function theFile(): Promise<string> {
    await vi.waitFor(async () => {
      expect(await readdir(dir)).toHaveLength(1);
    });
    const [file] = await readdir(dir);
    return join(dir, file ?? '');
  }

  it('finishes the WAV before the quit goes on while its disk answers', async () => {
    const rec = recording();
    for (let i = 0; i < 15; i++) heard(rec);
    const quit = rec.quitting();
    expect(quit).not.toBeNull();
    await expect(quit).resolves.toBe('finished');
    // Asked again (the quit's next before-quit): nothing is left to wait for.
    expect(rec.quitting()).toBeNull();
    const wave = await readFile(await theFile());
    expect(wave.readUInt32LE(40)).toBe(15 * TONE.byteLength);
    expect(wave.length).toBe(44 + 15 * TONE.byteLength);
  });

  it('lets the quit go on after 5 s when the disk stops answering, the WAV playable up to its last whole second, and never holds the quit again', async () => {
    const rec = recording();
    for (let i = 0; i < 25; i++) heard(rec);
    const path = await theFile();
    await vi.waitFor(async () => {
      expect((await readFile(path)).length).toBe(44 + 25 * TONE.byteLength);
    });
    disk.stuck = true;
    heard(rec);
    let how: string | null = null;
    const quit = rec.quitting();
    expect(quit).not.toBeNull();
    void quit?.then((said) => {
      how = said;
    });
    await vi.advanceTimersByTimeAsync(4900);
    expect(how).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    expect(how).toBe('late');
    // The quit's next before-quit is not held again: the stuck write is left behind.
    expect(rec.quitting()).toBeNull();
    // What reached the disk before it stopped answering plays: its header says 2 of the 2.5 s written.
    const wave = await readFile(path);
    expect(wave.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wave.readUInt32LE(40)).toBe(2 * SPEECH_RATE * 2);
  });
});
