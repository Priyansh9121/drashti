import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileStamp } from '../../shared/format';
import { SPEECH_RATE, type Heard } from '../../shared/speech';
import { SoundRecording } from './sound-recording';

const START = Date.UTC(2026, 10, 4, 12, 0, 0);
const KEEP_FREE = 2 * 1024 ** 3;
const TONE = Int16Array.from({ length: SPEECH_RATE / 10 }, (_, i) =>
  Math.round(12_000 * Math.sin((i * 2 * Math.PI * 440) / SPEECH_RATE)),
);

function phrase(text: string, startAt: number, endAt: number, final = true): Heard {
  return {
    id: 's1',
    text,
    startAt,
    endAt,
    final,
    heardAt: endAt + 100,
    language: 'en',
    languageConfidence: null,
    words: [{ text, startAt, endAt, confidence: null }],
  };
}

describe('Record sound from generated input', () => {
  let dir: string;
  const active: SoundRecording[] = [];
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'drashti-sound-test-'));
  });
  afterEach(async () => {
    await Promise.all(
      active.splice(0).map(async (rec) => {
        await rec.stop();
      }),
    );
    await rm(dir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  function setup(overrides: Partial<ConstructorParameters<typeof SoundRecording>[0]> = {}) {
    const notice = vi.fn();
    const rec = new SoundRecording({
      now: () => START,
      freeBytes: () => Promise.resolve(100 * 1024 ** 3),
      onFat: () => Promise.resolve(false),
      keepFree: KEEP_FREE,
      changed: () => undefined,
      notice,
      ...overrides,
    });
    active.push(rec);
    rec.start(dir);
    return { rec, notice };
  }

  it('saves only the selected input while recording, as playable PCM, without a caption draft', async () => {
    const { rec } = setup();
    rec.chunk(TONE, START - 100, START - 200);
    rec.chunk(TONE, START + 50, START - 50);
    rec.chunk(TONE, START + 150, START + 50);
    const stopping = rec.stop();
    rec.chunk(TONE, START + 250, START + 150);
    await stopping;

    const [file, ...extra] = await readdir(dir);
    expect(file).toMatch(/\.wav$/u);
    expect(extra).toEqual([]);
    const wave = await readFile(join(dir, file ?? ''));
    const samples = TONE.length / 2 + TONE.length;
    expect(wave.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wave.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wave.readUInt16LE(20)).toBe(1);
    expect(wave.readUInt16LE(22)).toBe(1);
    expect(wave.readUInt32LE(24)).toBe(SPEECH_RATE);
    expect(wave.readUInt16LE(34)).toBe(16);
    expect(wave.readUInt32LE(40)).toBe(samples * 2);
    expect(wave.length).toBe(44 + samples * 2);
    expect(wave.readInt16LE(44 + 2)).toBe(TONE[TONE.length / 2 + 1]);
  });

  it('writes settled phrases as a timed draft against recorded samples, including after a capture gap', async () => {
    const { rec } = setup();
    rec.chunk(TONE, START + 100, START);
    rec.chunk(TONE, START + 900, START + 800);
    rec.caption(phrase('Before', START - 90, START - 40));
    rec.caption(phrase('Partial', START + 810, START + 830, false));
    rec.caption(phrase('Test & <tone>', START + 810, START + 850));
    rec.caption(phrase('Outside', START + 910, START + 930));
    await rec.stop();

    const files = await readdir(dir);
    expect(files).toHaveLength(2);
    const draft = files.find((f) => f.endsWith('.draft.vtt'));
    expect(files).toContain(draft?.replace(/\.draft\.vtt$/u, '.wav'));
    expect(await readFile(join(dir, draft ?? ''), 'utf8')).toBe(
      'WEBVTT\n\nNOTE Draft from Live captions\n\n00:00:00.110 --> 00:00:00.150\nTest &amp; &lt;tone&gt;\n\n',
    );
  });

  it('keeps the first word of a long phrase that settles late', async () => {
    const { rec } = setup();
    rec.chunk(TONE, START + 100, START);
    rec.chunk(TONE, START + 12_000, START + 11_900);
    rec.chunk(TONE, START + 19_800, START + 19_700);
    const first = phrase('First', START + 20, START + 60);
    const last = phrase('last', START + 11_930, START + 11_980);
    rec.caption({
      ...phrase('First last', first.startAt, last.endAt),
      heardAt: START + 19_800,
      words: [...first.words, ...last.words],
    });
    await rec.stop();

    const draft = (await readdir(dir)).find((file) => file.endsWith('.draft.vtt'));
    expect(await readFile(join(dir, draft ?? ''), 'utf8')).toContain(
      '00:00:00.020 --> 00:00:00.180\nFirst last',
    );
  });

  it('rolls over at the part limit, with a valid file and its own caption times for each part', async () => {
    const { rec } = setup({ partBytes: TONE.byteLength + 44 });
    rec.chunk(TONE, START + 100, START);
    rec.chunk(TONE, START + 200, START + 100);
    rec.caption(phrase('First tone', START + 20, START + 40));
    rec.caption(phrase('Second tone', START + 120, START + 140));
    await rec.stop();

    const files = await readdir(dir);
    const waves = files.filter((file) => file.endsWith('.wav'));
    expect(waves).toHaveLength(2);
    for (const file of waves) {
      const wave = await readFile(join(dir, file));
      expect(wave.readUInt32LE(40)).toBe(TONE.byteLength);
      const draft = await readFile(join(dir, file.replace(/\.wav$/u, '.draft.vtt')), 'utf8');
      expect(draft).toContain('00:00:00.020 --> 00:00:00.040');
    }
  });

  it('keeps an existing draft and creates a new recording on retry', async () => {
    const stem = `Drashti sound ${fileStamp(new Date(START))}`;
    await writeFile(join(dir, `${stem}.draft.vtt`), 'Existing draft\n', 'utf8');
    const { rec } = setup();
    rec.chunk(TONE, START + 100, START);
    await rec.stop();
    rec.start(dir);
    rec.chunk(TONE, START + 100, START);
    await rec.stop();
    expect(await readdir(dir)).toEqual(
      expect.arrayContaining([`${stem}.draft.vtt`, `${stem} (2).wav`, `${stem} (3).wav`]),
    );
    expect(await readFile(join(dir, `${stem}.draft.vtt`), 'utf8')).toBe('Existing draft\n');
  });

  it('refuses to write under the reserved disk space and tells the operator', async () => {
    const { rec, notice } = setup({ freeBytes: () => Promise.resolve(KEEP_FREE - 1) });
    rec.chunk(TONE, START + 100, START);
    await rec.stop();
    expect(await readdir(dir)).toEqual([]);
    expect(rec.view(dir).state).toBe('off');
    expect(notice).toHaveBeenCalledWith(expect.stringContaining('Drashti keeps 2 GB free'));
  });

  it('warns about the drive and stops with a playable file if the disk fills later', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let free = KEEP_FREE + 58 * 1024 ** 2;
    const { rec, notice } = setup({
      freeBytes: () => Promise.resolve(free),
      onFat: () => Promise.resolve(true),
    });
    rec.chunk(TONE, START + 100, START);
    await vi.waitFor(() => expect(rec.view(dir).state).toBe('recording'));
    expect(rec.view(dir).warning).toContain('FAT32');
    expect(rec.view(dir).warning).toContain('minutes of recording');
    free = KEEP_FREE - 1;
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.waitFor(() => expect(rec.view(dir).state).toBe('off'));
    expect(notice).toHaveBeenCalledWith(expect.stringContaining('Drashti keeps 2 GB free'));
    const file = rec.view(dir).file;
    expect(file).toMatch(/\.wav$/u);
    expect((await readFile(join(dir, file ?? ''))).readUInt32LE(40)).toBe(TONE.byteLength);
  });
});
