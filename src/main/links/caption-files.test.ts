import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LinkService, type LinkWorker } from './link-service';
import type { FromWorker, ToWorker } from './protocol';

const LINK = 'https://www.youtube.com/watch?v=AAAAAAAAAAA';
const TRACKS = [
  { language: 'en', source: 'en', kind: 'creator' as const },
  { language: 'en', source: 'en-orig', kind: 'automatic' as const },
];
const SRT = '1\n00:00:00,000 --> 00:00:01,000\nPlaceholder caption\n';

function setup(learning?: string) {
  const root = mkdtempSync(join(tmpdir(), 'drashti-caption-files-'));
  const folder = join(root, 'Saved');
  mkdirSync(folder);
  const workers: { messages: ToWorker[]; send(message: FromWorker): void }[] = [];
  const imported: string[][] = [];
  const logs: string[] = [];
  const prefs = { enabled: true, folder: learning ?? null };
  const service = new LinkService({
    spawn: (): LinkWorker => {
      let hear = (_message: FromWorker): void => undefined;
      const messages: ToWorker[] = [];
      workers.push({ messages, send: (message) => hear(message) });
      return {
        post: (message) => messages.push(message),
        onMessage: (fn) => {
          hear = fn;
        },
        onExit: () => undefined,
        kill: () => undefined,
      };
    },
    onAir: () => false,
    freeBytes: () => 100 * 1024 ** 3,
    freeBytesAsync: () => Promise.resolve(100 * 1024 ** 3),
    defaultFolder: folder,
    lastFolder: { get: () => folder, set: () => undefined },
    captionPreferences: { get: () => prefs, set: (value) => Object.assign(prefs, value) },
    pickFolder: () => Promise.resolve(join(root, 'Chosen captions')),
    importFiles: (paths) => {
      imported.push(paths);
      return Promise.resolve({ ok: true, runId: 'placeholder-run' });
    },
    changed: () => undefined,
    log: (_level, message) => logs.push(message),
    record: join(root, 'record.json'),
    workDir: join(root, 'work'),
    maxHeight: { get: () => 1080, set: () => undefined },
    youtubeLaunch: () => ({
      ok: true,
      launch: { command: 'placeholder', prefix: [], env: {}, deno: 'placeholder', ffmpeg: 'placeholder' },
    }),
    route: { testOrigin: null, guard: true },
  });
  return { root, folder, workers, imported, logs, prefs, service };
}

async function until(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
}

async function start(h: ReturnType<typeof setup>, audio = false, captions = true) {
  h.service.look('youtube', LINK);
  const details = {
    title: 'Placeholder title',
    id: 'AAAAAAAAAAA',
    channel: 'Placeholder channel',
    uploadDate: '20261119',
    duration: 12,
    heights: [{ height: 1080, bytes: 1000 }],
    soundBytes: 1000,
    captions: TRACKS,
  };
  h.workers[0]?.send({ type: 'yt-looked', details });
  expect(h.service.start(LINK, audio, false, { name: 'Chosen', captions }).ok).toBe(true);
  await until(() => h.workers.some((w) => w.messages.some((m) => m.type === 'yt-download')));
  const worker = h.workers.find((w) => w.messages.some((m) => m.type === 'yt-download'));
  const command = worker?.messages.find((m) => m.type === 'yt-download');
  if (command?.type !== 'yt-download' || !worker) throw new Error('No YouTube download');
  mkdirSync(command.workDir, { recursive: true });
  const file = join(command.workDir, audio ? 'download.mp3' : 'download.mp4');
  writeFileSync(file, 'placeholder media');
  const files = TRACKS.map((track, i) => {
    const caption = join(command.workDir, `placeholder-${String(i)}.srt`);
    writeFileSync(caption, SRT);
    return { ...track, file: caption };
  });
  return { worker, command, file, files };
}

function finish(run: Awaited<ReturnType<typeof start>>, failed = false) {
  run.worker.send({
    type: 'yt-downloaded',
    file: run.file,
    bytes: 17,
    captions: failed ? run.files.slice(0, 1) : run.files,
    captionFailures: failed ? TRACKS.slice(1) : [],
  } as FromWorker);
}

describe('caption files and the learning copy', () => {
  it.each([false, true])(
    'saves captions beside the media and a manifest in the learning folder (audio %s)',
    async (audio) => {
      const h = setup();
      try {
        const run = await start(h, audio);
        expect(run.command).toMatchObject({ captions: TRACKS });
        finish(run);
        await until(() => h.service.view().phase === 'done');
        const media = join(h.folder, audio ? 'Chosen.mp3' : 'Chosen.mp4');
        const learning = join(h.folder, 'Captions', 'Chosen [AAAAAAAAAAA]');
        expect(readFileSync(join(h.folder, 'Chosen.en.srt'), 'utf8')).toBe(SRT);
        expect(readFileSync(join(h.folder, 'Chosen.en.auto.srt'), 'utf8')).toBe(SRT);
        expect(readFileSync(join(learning, 'Chosen.en.srt'), 'utf8')).toBe(SRT);
        expect(readFileSync(join(learning, 'Chosen.en.auto.srt'), 'utf8')).toBe(SRT);
        expect(JSON.parse(readFileSync(join(learning, 'captions.json'), 'utf8'))).toMatchObject({
          id: 'AAAAAAAAAAA',
          link: LINK,
          title: 'Placeholder title',
          channel: 'Placeholder channel',
          uploadDate: '20261119',
          duration: 12,
          files: [
            { file: 'Chosen.en.srt', language: 'en', kind: 'creator' },
            { file: 'Chosen.en.auto.srt', language: 'en', kind: 'automatic' },
          ],
        });
        expect(h.imported).toEqual([[media]]);
        expect(h.logs.join('\n')).not.toContain('Chosen');
        expect(h.logs.join('\n')).not.toContain(LINK);
        expect(h.logs.join('\n')).not.toContain('Placeholder title');
      } finally {
        h.service.close();
      }
    },
  );

  it('keeps the video and adjacent captions when the chosen learning folder is gone, without recreating it', async () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'drashti-missing-captions-')), 'Disconnected');
    const h = setup(missing);
    try {
      finish(await start(h));
      await until(() => h.service.view().phase === 'done');
      expect(existsSync(join(h.folder, 'Chosen.en.srt'))).toBe(true);
      expect(existsSync(missing)).toBe(false);
      expect(h.service.view()).toMatchObject({ captions: { learningSkipped: true } });
    } finally {
      h.service.close();
    }
  });

  it('chooses a new media stem when a sidecar exists, and never replaces that sidecar', async () => {
    const h = setup();
    writeFileSync(join(h.folder, 'Chosen.en.srt'), 'existing placeholder');
    try {
      finish(await start(h));
      await until(() => h.service.view().phase === 'done');
      expect(readFileSync(join(h.folder, 'Chosen.en.srt'), 'utf8')).toBe('existing placeholder');
      expect(existsSync(join(h.folder, 'Chosen (2).mp4'))).toBe(true);
      expect(readFileSync(join(h.folder, 'Chosen (2).en.auto.srt'), 'utf8')).toBe(SRT);
    } finally {
      h.service.close();
    }
  });

  it('reports a failed language while the video and other captions succeed', async () => {
    const h = setup();
    try {
      finish(await start(h), true);
      await until(() => h.service.view().phase === 'done');
      expect(existsSync(join(h.folder, 'Chosen.mp4'))).toBe(true);
      expect(h.service.view()).toMatchObject({ captions: { failed: ['en (automatic)'] } });
    } finally {
      h.service.close();
    }
  });

  it('Stop removes every hidden media/caption file and creates no learning copy', async () => {
    const h = setup();
    try {
      await start(h);
      expect(h.service.stop().ok).toBe(true);
      await until(() => readdirSync(h.folder).length === 0);
      expect(h.imported).toEqual([]);
      expect(h.service.view()).toMatchObject({ phase: 'stopped', saved: null });
    } finally {
      h.service.close();
    }
  });
});
