import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sha256File } from '../import/media-store';
import { CombineVideos } from './combine-service';
import { readTrimInfo } from './trim-copy';
import { copyFf, copyFfmpeg, copyFixture } from './video-copy-fixtures';
import { registerProxyFile } from './video-copy-files';

/*
 * Combine videos… (alpha.22): two generated placeholder videos, of different sizes, rates and sound (the fixture's
 * 160 × 90 at 25 fps with no sound, then a 320 × 240 one at 30 fps with a tone), joined by the one idle worker.
 */
let fixture: Awaited<ReturnType<typeof copyFixture>>;
let combines: CombineVideos;
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});

async function setUp() {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  const second = join(fixture.dir, 'second.mp4');
  copyFf([
    '-f',
    'lavfi',
    '-i',
    'color=c=0x336699:s=320x240:r=30:d=1',
    '-f',
    'lavfi',
    '-i',
    'sine=f=440:r=44100:d=1',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    second,
  ]);
  const hashed = await sha256File(second);
  const info = await readTrimInfo(copyFfmpeg, second);
  fixture.db
    .prepare(
      "INSERT INTO media(id,kind,name,path,sha256,bytes,duration_ms,playable) VALUES ('second','video','Placeholder second.mp4','second.mp4',?,?,?,1)",
    )
    .run(hashed.sha256, hashed.bytes, info.durationMs);
  fixture.db.prepare("UPDATE media SET name='Placeholder source.mp4' WHERE id='source'").run();
  fixture.db
    .prepare(
      "INSERT INTO media(id,kind,name,path,playable) VALUES ('still','image','Placeholder picture.png','x.png',1)",
    )
    .run();
  const hashes = { source: fixture.sha, second: hashed.sha256 };
  const work = join(fixture.dir, 'video-combine-work');
  // The system's save dialog: what it was offered, and the file it answers with (null: cancelled).
  const saving = { offered: [] as string[], answer: null as string | null };
  combines = new CombineVideos({
    pickCopy: (name) => {
      saving.offered.push(name);
      return Promise.resolve(saving.answer);
    },
    mediaDir: fixture.dir,
    workDir: work,
    row: (id) => fixture.media.about(id),
    conversions: fixture.conversions,
    idle: () => fixture.idle(),
    prepareImport: (file, read, name, signal) =>
      registerProxyFile({
        db: fixture.db,
        mediaDir: fixture.dir,
        file,
        info: read,
        name,
        signal,
        idle: () => fixture.idle(),
        freeBytes: () => 100 * 1024 ** 3,
      }),
    publishImport: (id) =>
      Promise.resolve(fixture.db.prepare('UPDATE media SET listed=1 WHERE id=?').run(id).changes > 0),
  });
  cleanup.push(() => combines.close());
  return { second, hashes, work, saving };
}
/** Two or more videos, with a transition between them (Cut unless given), and no copy saved to a file. */
const ask = (
  mediaIds: string[],
  more: Partial<{
    transition: 'dissolve' | 'fade-black' | 'cut';
    transitionMs: number;
    saveCopy: boolean;
  }> = {},
) => ({ mediaIds, transition: 'cut' as const, transitionMs: 1000, saveCopy: false, ...more });
async function started(raw: unknown) {
  const result = await combines.start(raw);
  if (!result.ok) throw new Error(result.message);
  if (!result.job) throw new Error('Nothing was queued.');
  return result.job;
}

async function settled(id: string) {
  await vi.waitFor(
    () => {
      const job = combines.list().find((j) => j.id === id);
      if (job?.state === 'failed') throw new Error(job.message ?? 'The combine failed.');
      expect(job?.state).toBe('done');
    },
    { timeout: 20_000 },
  );
  const job = combines.list().find((j) => j.id === id);
  if (!job?.mediaId) throw new Error('The combined video is not in Media.');
  return job;
}

it('joins two videos of different sizes, rates and sound into one new video in Media; the originals unchanged', async () => {
  const { second, hashes, work } = await setUp();
  const queued = { job: await started(ask(['source', 'second'])) };
  expect(queued.job).toMatchObject({
    name: 'Placeholder source + Placeholder second.mp4',
    state: 'waiting',
  });
  const job = await settled(queued.job.id);
  const row = fixture.media.about(job.mediaId ?? '');
  expect(row).toMatchObject({
    kind: 'video',
    name: 'Placeholder source + Placeholder second.mp4',
    deleted: false,
  });
  expect(
    (fixture.db.prepare('SELECT listed FROM media WHERE id=?').get(job.mediaId) as { listed: number }).listed,
  ).toBe(1);
  const made = await readTrimInfo(copyFfmpeg, join(fixture.dir, row?.path ?? ''));
  // The sum of the two (2 s + 1 s), within 0.2 s; the first one's picture; sound throughout (silence for the first).
  expect(Math.abs((made.durationMs ?? 0) - 3000)).toBeLessThanOrEqual(200);
  expect(made.video).toMatchObject({ width: 160, height: 90 });
  expect(made.audio).not.toBeNull();
  // The second video's blue shows after the first's 2 s (letterboxed into 160 × 90: its middle is blue).
  const middle = copyFf([
    '-ss',
    '2.5',
    '-i',
    join(fixture.dir, row?.path ?? ''),
    '-frames:v',
    '1',
    '-vf',
    'crop=2:2:79:44',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
  expect(middle[2] ?? 0).toBeGreaterThan(middle[0] ?? 0);
  expect((await sha256File(fixture.source)).sha256).toBe(hashes.source);
  expect((await sha256File(second)).sha256).toBe(hashes.second);
  expect(fixture.maxActive()).toBe(1);
  // Nothing left behind in the work folder.
  expect(readdirSync(work)).toEqual([]);
}, 30_000);

it('waits while on air and only then combines; Stop leaves nothing behind', async () => {
  const { work } = await setUp();
  fixture.activity.stream = true;
  const waiting = { job: await started(ask(['second', 'source'])) };
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(combines.list().find((j) => j.id === waiting.job.id)).toMatchObject({
    state: 'waiting',
    mediaId: null,
  });
  expect(combines.list()[0]?.note).toMatch(/Waits while the stream or recording is on/u);
  expect(fixture.media.list()).toHaveLength(3);
  const stopped = { job: await started(ask(['source', 'second'])) };
  expect(combines.stop(stopped.job.id)).toBe(true);
  expect(combines.list().find((j) => j.id === stopped.job.id)?.state).toBe('stopped');
  fixture.activity.stream = false;
  const job = await settled(waiting.job.id);
  expect(job.name).toBe('Placeholder second + Placeholder source.mp4');
  expect(combines.list().find((j) => j.id === stopped.job.id)?.state).toBe('stopped');
  expect(fixture.media.list()).toHaveLength(4);
  expect(readdirSync(work)).toEqual([]);
}, 30_000);

it('refuses one video, the same video twice, a picture and a missing file, with words for each', async () => {
  await setUp();
  expect(await combines.start(ask(['source']))).toMatchObject({
    ok: false,
    message: /two or more videos/u,
  });
  expect(await combines.start(ask(['source', 'source']))).toMatchObject({ ok: false });
  expect(await combines.start(ask(['source', 'still']))).toMatchObject({
    ok: false,
    message: /“Placeholder picture.png” is not a video/u,
  });
  expect(await combines.start(ask(['source', 'gone']))).toMatchObject({
    ok: false,
    message: /no longer in Media/u,
  });
  fixture.db.prepare("UPDATE media SET missing=1 WHERE id='second'").run();
  expect(await combines.start(ask(['source', 'second']))).toMatchObject({
    ok: false,
    message: /“Placeholder second.mp4”’s file is missing/u,
  });
  expect(combines.list()).toEqual([]);
  expect(existsSync(join(fixture.dir, 'video-combine-work'))).toBe(true);
});

/*
 * The owner, 24 Nov 2026: "transition between 2 merged videos" and "export button as well to download".
 */
it('dissolves between them: the sum less the overlap; one too short for it is cut, and the job says which', async () => {
  await setUp();
  const dissolve = await started(ask(['source', 'second'], { transition: 'dissolve', transitionMs: 500 }));
  const dissolved = await settled(dissolve.id);
  expect(dissolved.short).toEqual([]);
  const made = await readTrimInfo(
    copyFfmpeg,
    join(fixture.dir, fixture.media.about(dissolved.mediaId ?? '')?.path ?? ''),
  );
  // 2 s + 1 s, less the 0.5 s they overlap.
  expect(Math.abs((made.durationMs ?? 0) - 2500)).toBeLessThanOrEqual(200);
  expect(made.audio).not.toBeNull();
  // A 1.5 s transition is longer than the 1 s second video: a plain cut, the sum, and its name said.
  const fade = await started(ask(['source', 'second'], { transition: 'fade-black', transitionMs: 1500 }));
  expect(fade.short).toEqual(['Placeholder second.mp4']);
  const cut = await settled(fade.id);
  const plain = await readTrimInfo(
    copyFfmpeg,
    join(fixture.dir, fixture.media.about(cut.mediaId ?? '')?.path ?? ''),
  );
  expect(Math.abs((plain.durationMs ?? 0) - 3000)).toBeLessThanOrEqual(200);
}, 40_000);

it('also saves a copy to the file chosen first, with Export…’s own helper: one encode, the very bytes', async () => {
  const { saving } = await setUp();
  // Cancelled: nothing combined.
  expect(await combines.start(ask(['source', 'second'], { saveCopy: true }))).toEqual({
    ok: true,
    job: null,
  });
  expect(combines.list()).toEqual([]);
  expect(saving.offered).toEqual(['Placeholder source + Placeholder second.mp4']);
  const chosen = join(fixture.dir, 'chosen copy.mp4');
  saving.answer = chosen;
  const job = await settled((await started(ask(['source', 'second'], { saveCopy: true }))).id);
  expect(job.savedTo).toBe(chosen);
  const stored = join(fixture.dir, fixture.media.about(job.mediaId ?? '')?.path ?? '');
  expect((await sha256File(chosen)).sha256).toBe((await sha256File(stored)).sha256);
  expect(fixture.maxActive()).toBe(1);
}, 40_000);
