import { soundWindowFixture } from './sound-window-fixture';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPEECH_RATE } from '../../shared/speech';
import { StreamService, type MediaAccess, type StreamServiceDeps } from './stream-service';

/*
 * Record sound in the stream service (Session 58, X2: the alpha.16 review's L1 and L2), off air, with a stand-in for
 * the stream's page: its speech port is where the sound input's timed PCM comes in, generated here (a tone, or
 * digital silence), never a real microphone. No sound counts quiet over 2 s here, not 20 (as DRASHTI_TEST_NO_SOUND_MS
 * does for the e2e tests).
 */

vi.mock('electron', () => ({
  dialog: {},
  MessageChannelMain: class {
    port1 = Object.assign(new EventEmitter(), { close: vi.fn(), start: vi.fn() });
    port2 = { incoming: this.port1 };
  },
}));

const TONE = Int16Array.from({ length: SPEECH_RATE / 10 }, (_, i) =>
  Math.round(12_000 * Math.sin((i * 2 * Math.PI * 440) / SPEECH_RATE)),
);
const SILENCE = new Int16Array(SPEECH_RATE / 10);
const QUIET_MS = 2000;
const profile = {
  id: 'test-profile',
  preset: 'good',
  camera: null,
  sound: { id: 'generated-sound', label: 'Generated sound' },
  soundDelayMs: 0,
  mixOwnSound: false,
};

describe('Record sound in the stream service (Session 58, X2)', () => {
  let folder: string;
  const services: StreamService[] = [];
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'drashti-record-sound-'));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  });
  afterEach(async () => {
    for (const stream of services.splice(0)) {
      await stream.quitting();
      stream.close();
    }
    vi.useRealTimers();
    await rm(folder, { recursive: true, force: true });
  });

  function service(more: Record<string, unknown> = {}) {
    const webContents = Object.assign(new EventEmitter(), {
      id: 7,
      isDestroyed: () => false,
      postMessage:
        vi.fn<(channel: string, payload: { role: string }, ports: { incoming: EventEmitter }[]) => void>(),
      send: vi.fn(),
    });
    const program = Object.assign(new EventEmitter(), {
      webContents,
      isDestroyed: () => false,
      getContentSize: () => [1920, 1080],
      destroy: vi.fn(),
    });
    const createStreamSound = vi.fn(() => program as unknown as BrowserWindow);
    const createProgram = vi.fn(soundWindowFixture);
    const notice = vi.fn<(text: string) => void>();
    const stream = new StreamService({
      profiles: { get: () => profile },
      settings: {
        get: (key: string) =>
          key === 'stream.profileId' ? profile.id : key === 'stream.recordingFolder' ? folder : undefined,
        set: vi.fn(),
      },
      screens: { streamGroup: () => null },
      createProgram,
      createStreamSound,
      sendToOperator: vi.fn(),
      platform: 'darwin',
      mediaAccess: () => 'granted',
      askMediaAccess: () => Promise.resolve(true),
      fakeDevices: true,
      ffmpegPath: () => null,
      now: () => Date.now(),
      log: vi.fn(),
      notice,
      noSoundMs: QUIET_MS,
      ...more,
    } as unknown as StreamServiceDeps);
    services.push(stream);
    /** The sound input's next 100 ms, as the stream's page sends it (after its page loaded). */
    const send = (samples: Int16Array) => {
      const speech = webContents.postMessage.mock.calls
        .filter((call) => call[1].role === 'speech')
        .at(-1)?.[2][0]?.incoming;
      speech?.emit('message', {
        data: { kind: 'pcm', samples, startAt: Date.now() - 100, endAt: Date.now() },
      });
    };
    /** `ms` of time passing, the page sending `samples` every 100 ms (or nothing). */
    const pass = async (ms: number, samples: Int16Array | null = null) => {
      for (let t = 0; t < ms; t += 100) {
        await vi.advanceTimersByTimeAsync(100);
        if (samples) send(samples);
      }
    };
    /**
     * At least `seconds` of the sound sent so far written to its WAV on disk (X15: here the time passes in a moment, and
     * a recording with more than 4 s waiting for the disk stops, "the disk could not keep up"; in a show the sound
     * comes in real time and the disk keeps up, as it does here once this has waited for it).
     */
    const onDisk = async (seconds: number) => {
      await vi.waitFor(
        async () => {
          const wav = (await readdir(folder)).find((f) => f.endsWith('.wav'));
          const size = wav ? (await stat(join(folder, wav))).size : 0;
          expect(size).toBeGreaterThanOrEqual(44 + seconds * SPEECH_RATE * 2);
        },
        { timeout: 10_000 },
      );
    };
    return { stream, webContents, createStreamSound, notice, pass, onDisk };
  }

  it('off air, its quiet raises No sound in the sound recording’s own words, and sound clears it', async () => {
    const { stream, webContents, createStreamSound, pass, onDisk } = service();
    expect(stream.startSoundRecording()).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(createStreamSound).toHaveBeenCalledOnce());
    webContents.emit('did-finish-load');
    await pass(1000, TONE);
    await vi.waitFor(() =>
      expect(stream.status().recording).toMatchObject({ kind: 'sound', state: 'recording' }),
    );
    expect(stream.status().noSound).toBeNull();
    await onDisk(0.9);
    await pass(QUIET_MS + 1500, SILENCE);
    await onDisk(4.3);
    expect(stream.status().live.state).toBe('off');
    expect(stream.status().noSound).toMatchObject({
      why: 'quiet',
      message:
        'The sound recording has had no sound for 2 seconds. Check the microphone, its cable and the sound desk.',
    });
    await pass(1500, TONE);
    expect(stream.status().noSound).toBeNull();
    // Still recording: its sound cleared No sound, not a recording that stopped.
    expect(stream.status().recording).toMatchObject({ kind: 'sound', state: 'recording' });
  });

  it('with its sound input unplugged, No sound says so after 3 s, and the recording warns before it gives up', async () => {
    // No sound's own 20 s for quiet here: the unplugged input's 3 s grace comes first, as in a show.
    const { stream, webContents, createStreamSound, notice, pass } = service({ noSoundMs: 20_000 });
    expect(stream.startSoundRecording()).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(createStreamSound).toHaveBeenCalledOnce());
    webContents.emit('did-finish-load');
    const soundPage = stream.soundContents();
    if (!soundPage) throw new Error('The generated sound page did not open');
    stream.reportInputs(soundPage, {
      cameras: [],
      microphones: [],
      camera: 'none',
      sound: 'missing',
      message: null,
    });
    await pass(2000);
    expect(stream.status().noSound).toBeNull();
    // Judged each second: within the second after the 3 s.
    await pass(2500);
    expect(stream.status().noSound).toMatchObject({
      why: 'input',
      message:
        'The sound input “Generated sound” is not connected. Connect it, or choose another in Stream settings. Until then the sound recording gets no sound.',
    });
    await pass(2000);
    expect(stream.status().recording.warning).toMatch(
      /^Nothing has come from the sound input for 5 seconds\./u,
    );
    expect(notice).toHaveBeenCalledWith(stream.status().recording.warning);
  });

  it('a macOS question still open, and then the stream’s page opening, never count against the sound input’s wait', async () => {
    let access: MediaAccess = 'not-determined';
    let answer = (_allowed: boolean): void => undefined;
    const asked = new Promise<boolean>((resolve) => {
      answer = resolve;
    });
    const { stream, webContents, createStreamSound, pass } = service({
      fakeDevices: false,
      mediaAccess: () => access,
      askMediaAccess: vi.fn(() => asked),
    });
    expect(stream.startSoundRecording()).toMatchObject({ ok: true });
    await pass(40_000);
    expect(createStreamSound).not.toHaveBeenCalled();
    expect(stream.status().recording).toMatchObject({ kind: 'sound', state: 'starting', warning: null });
    access = 'granted';
    answer(true);
    await vi.waitFor(() => expect(createStreamSound).toHaveBeenCalledOnce());
    await pass(10_000);
    expect(stream.status().recording).toMatchObject({ kind: 'sound', state: 'starting', warning: null });
    webContents.emit('did-finish-load');
    await pass(1000, TONE);
    await vi.waitFor(() =>
      expect(stream.status().recording).toMatchObject({ kind: 'sound', state: 'recording' }),
    );
  });

  it('says nothing about FAT32 for a sound recording on such a drive (a WAV part holds 32 hours)', async () => {
    const drive = vi.fn(() => Promise.resolve(true));
    const { stream, webContents, createStreamSound, notice, pass } = service({ recordingDrive: drive });
    expect(stream.startSoundRecording()).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(createStreamSound).toHaveBeenCalledOnce());
    webContents.emit('did-finish-load');
    await pass(3500, TONE);
    await vi.waitFor(() =>
      expect(stream.status().recording).toMatchObject({ kind: 'sound', state: 'recording' }),
    );
    expect(stream.status().recording.warning ?? '').not.toContain('FAT32');
    expect(notice).not.toHaveBeenCalledWith(expect.stringContaining('FAT32'));
  });
});
