import { afterEach, expect, it, vi } from 'vitest';
import { initialEngineState, nothingUp, type EngineState, type SlideLayer } from '../../shared/engine/state';
import { saveWaitsFor } from '../../shared/save-waits';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sha256File } from '../import/media-store';
import { CombineVideos } from './combine-service';
import { readTrimInfo } from './trim-copy';
import { copyFf, copyFfmpeg, copyFixture } from './video-copy-fixtures';
import { discardUnlisted, registerProxyFile } from './video-copy-files';
import { openDatabase } from '../db/database';
import { MediaStore } from '../import/media-store';

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

async function setUp(gate: Parameters<typeof copyFixture>[0] = {}) {
  fixture = await copyFixture(gate);
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
  // As the app has it: the save gate when given (alpha.22), else nothing up, on air or recording.
  const idle = () => (gate.saveBusy ? gate.saveBusy() === null : fixture.idle());
  // The system's save dialog: what it was offered, and the file it answers with (null: cancelled).
  const saving = { offered: [] as string[], answer: null as string | null };
  // Moments a test may act at (a22-review-combine S4): once FFmpeg's arguments are made (the encode starts), once the
  // new video is copied into Media (not listed yet), and whether listing it succeeds.
  const hooks: {
    encoding?: () => void;
    imported?: (mediaId: string) => void;
    publish: boolean;
    /** Each removal of a combine's own work file's copy, as it was asked (a22-review-combine2). */
    discards: Promise<unknown>[];
    /** Each start sweep of the work folder, as it was asked. */
    sweeps: Promise<unknown>[];
    /** Holds a removal asked for once the new video is listed, until the test lets it go (S3). */
    holdKept?: Promise<void>;
    /** An import or a deck's preparation is going (a22-review-combine2 R-S1). */
    importing: boolean;
  } = {
    publish: true,
    discards: [],
    sweeps: [],
    importing: false,
  };
  const deps = {
    pickCopy: (name: string) => {
      saving.offered.push(name);
      return Promise.resolve(saving.answer);
    },
    mediaDir: fixture.dir,
    workDir: work,
    row: (id: string) => fixture.media.about(id),
    conversions: {
      saveCopy: (...[source, dest, info, options]: Parameters<typeof fixture.conversions.saveCopy>) => {
        const args = options.args.bind(options);
        options.args = (temporary) => {
          const made = args(temporary);
          hooks.encoding?.();
          return made;
        };
        return fixture.conversions.saveCopy(source, dest, info, options);
      },
      cancelFile: (id: string) => fixture.conversions.cancelFile(id),
    },
    idle: () => idle(),
    prepareImport: async (
      file: string,
      read: Parameters<typeof registerProxyFile>[0]['info'],
      name: string,
      signal: AbortSignal,
    ) => {
      const id = await registerProxyFile({
        db: fixture.db,
        mediaDir: fixture.dir,
        file,
        info: read,
        name,
        signal,
        idle: () => idle(),
        freeBytes: () => 100 * 1024 ** 3,
        mayRemove: () => !hooks.importing,
      });
      hooks.imported?.(id);
      return id;
    },
    publishImport: (id: string) =>
      Promise.resolve(
        hooks.publish && fixture.db.prepare('UPDATE media SET listed=1 WHERE id=?').run(id).changes > 0,
      ),
    // As the app has it (video-copies-ipc.ts): what a combine copied into Media and never listed, removed.
    discardUnlisted: (
      made: { file: string } | { folder: string },
      keep?: string | null | ReadonlySet<string>,
      allowed?: () => boolean,
    ) => {
      const listed = typeof keep === 'string' || (keep instanceof Set && keep.size > 0);
      const held = listed ? hooks.holdKept : undefined;
      const asked = (held ?? Promise.resolve()).then(() =>
        discardUnlisted({
          db: fixture.db,
          mediaDir: fixture.dir,
          ...made,
          keep: keep ?? null,
          ...(allowed ? { allowed } : {}),
        }),
      );
      ('file' in made ? hooks.discards : hooks.sweeps).push(asked.catch(() => undefined));
      return asked;
    },
    importing: () => hooks.importing,
    // As the app wires it (video-copies-ipc.ts): a file it renamed into Media is never removed while an import goes.
  };
  combines = new CombineVideos(deps);
  cleanup.push(() => combines.close());
  return { second, hashes, work, saving, hooks, deps };
}
/** Every row in Media, listed or not (the fixture's source, second and a picture to begin with). */
const rows = () => (fixture.db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number }).n;
/** The files kept in Media's own hashed folders (`ab/<sha256>.mp4`). */
const stored = () =>
  readdirSync(fixture.dir)
    .filter((folder) => /^[0-9a-f]{2}$/u.test(folder))
    .flatMap((folder) => readdirSync(join(fixture.dir, folder)).map((file) => `${folder}/${file}`));
/** The files renamed into Media's hashed folders, not a copy still going (`….part-<uuid>`). */
const renamed = () => stored().filter((file) => !file.includes('.part-'));
/** A job that ended without a new video in Media: failed or stopped, with its words. */
async function ended(id: string, state: 'failed' | 'stopped') {
  await vi.waitFor(
    () => {
      expect(combines.list().find((j) => j.id === id)?.state).toBe(state);
    },
    { timeout: 20_000 },
  );
  return combines.list().find((j) => j.id === id);
}
/** A changed video, as Media sees it: its file replaced by other bytes (another sha256). */
const change = (mediaId: string) => {
  fixture.db.prepare('UPDATE media SET sha256=? WHERE id=?').run('0'.repeat(64), mediaId);
};
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

/*
 * The owner's save fault (a22-save-trim, 24 Nov 2026): the Wallpaper over a still slide held every save for ever under
 * the old "nothing up" rule. A combine waits only while a video or sound plays, the stream is on air or a recording runs.
 */
it('combines with the Wallpaper over a still slide up, and waits only while a video plays', async () => {
  const still = {
    ...initialEngineState(),
    wallpaper: true,
    layers: {
      ...initialEngineState().layers,
      slide: {
        presentationId: 'placeholder-presentation',
        slideIndex: 0,
        shownAt: 1000,
        slide: { id: 'placeholder-slide', elements: [] },
      } as unknown as SlideLayer,
    },
  };
  const shown: { state: EngineState } = { state: still };
  const off = { onAir: false, recording: false };
  await setUp({ saveBusy: () => saveWaitsFor(shown.state, off, Date.now()) });
  // Something is up (the old rule's "show busy"), and nothing plays.
  fixture.activity.show = true;
  expect(nothingUp(still.layers)).toBe(false);
  expect(saveWaitsFor(still, off, Date.now())).toBeNull();
  const job = await settled((await started(ask(['source', 'second']))).id);
  expect(job.mediaId).not.toBeNull();
  // A video playing holds the next one, in the save gate's words.
  shown.state = {
    ...still,
    layers: {
      ...still.layers,
      background: {
        kind: 'media',
        mediaId: 'placeholder-video',
        media: 'video',
        fit: 'fit',
        loop: true,
        startedAt: 1000,
      },
    },
  };
  const held = await started(ask(['second', 'source']));
  expect(held.note).toBe('Waiting: a video is playing');
  shown.state = still;
  await settled(held.id);
}, 40_000);

it('joins a short video with a cut and then dissolves into the next: three videos, one encode (a22-review-combine MUST-2)', async () => {
  await setUp();
  const third = join(fixture.dir, 'third.mp4');
  copyFf([
    '-f',
    'lavfi',
    '-i',
    'color=c=0x993333:s=320x240:r=25:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=f=660:r=48000:d=2',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    third,
  ]);
  const hashed = await sha256File(third);
  const info = await readTrimInfo(copyFfmpeg, third);
  fixture.db
    .prepare(
      "INSERT INTO media(id,kind,name,path,sha256,bytes,duration_ms,playable) VALUES ('third','video','Placeholder third.mp4','third.mp4',?,?,?,1)",
    )
    .run(hashed.sha256, hashed.bytes, info.durationMs);
  // 1 s, 2 s and 2 s with a 1.5 s dissolve: the first join a cut (the 1 s video is too short), the second a dissolve.
  const queued = await started(
    ask(['second', 'source', 'third'], { transition: 'dissolve', transitionMs: 1500 }),
  );
  expect(queued.short).toEqual(['Placeholder second.mp4']);
  const job = await settled(queued.id);
  const file = join(fixture.dir, fixture.media.about(job.mediaId ?? '')?.path ?? '');
  const made = await readTrimInfo(copyFfmpeg, file);
  expect(Math.abs((made.durationMs ?? 0) - 3500)).toBeLessThanOrEqual(200);
  expect(made.video).toMatchObject({ width: 320, height: 240 });
  expect(made.audio).not.toBeNull();
  // It plays: every frame and its sound decode to the end.
  copyFf(['-i', file, '-f', 'null', '-']);
}, 40_000);

/*
 * a22-review-combine S4: a combine failing late leaves nothing behind (no unlisted row in Media, no file in Media's
 * folders, nothing in the work folder), and a video changed while it was made is said to have changed.
 */
it('a video changed during the encode: the job says so, not "free disk space", and nothing is left', async () => {
  const { hooks, work } = await setUp();
  hooks.encoding = () => {
    change('second');
  };
  const job = await ended((await started(ask(['source', 'second']))).id, 'failed');
  expect(job?.message).toBe('One of the videos changed in Media. Choose them again, then Combine.');
  expect(job?.mediaId).toBeNull();
  expect(rows()).toBe(3);
  expect(stored()).toEqual([]);
  expect(readdirSync(work)).toEqual([]);
}, 30_000);

it('a video changed just after the new video was copied into Media: its row and file are removed, and it says why', async () => {
  const { hooks, work } = await setUp();
  const copied: string[] = [];
  hooks.imported = (id) => {
    copied.push(id);
    change('second');
  };
  const job = await ended((await started(ask(['source', 'second']))).id, 'failed');
  // It was copied into Media (not listed) before the change was seen.
  expect(copied).toHaveLength(1);
  expect(job?.message).toBe('One of the videos changed in Media. Choose them again, then Combine.');
  expect(rows()).toBe(3);
  expect(stored()).toEqual([]);
  expect(readdirSync(work)).toEqual([]);
}, 30_000);

it('Stop just after the new video was copied into Media leaves nothing in Media', async () => {
  const { hooks, work } = await setUp();
  const queued = { id: '' };
  hooks.imported = () => {
    expect(combines.stop(queued.id)).toBe(true);
  };
  queued.id = (await started(ask(['source', 'second']))).id;
  const job = await ended(queued.id, 'stopped');
  expect(job?.message).toBe('Stopped. Nothing was added to Media.');
  await vi.waitFor(
    () => {
      expect(rows()).toBe(3);
    },
    { timeout: 20_000 },
  );
  expect(stored()).toEqual([]);
  expect(readdirSync(work)).toEqual([]);
}, 30_000);

it('Media refusing to list the new video leaves no unlisted row or file', async () => {
  const { hooks, work } = await setUp();
  hooks.publish = false;
  const job = await ended((await started(ask(['source', 'second']))).id, 'failed');
  expect(job?.message).toMatch(/could not be added to Media/u);
  expect(rows()).toBe(3);
  expect(stored()).toEqual([]);
  expect(readdirSync(work)).toEqual([]);
}, 30_000);

it('a wait just after the copy into Media starts again and keeps exactly one new video', async () => {
  const { hooks } = await setUp();
  const copied: string[] = [];
  hooks.imported = (id) => {
    copied.push(id);
    // The stream goes on air once, at that very moment; off again a little later.
    if (copied.length === 1) {
      fixture.activity.stream = true;
      setTimeout(() => {
        fixture.activity.stream = false;
      }, 1500);
    }
  };
  const job = await settled((await started(ask(['source', 'second']))).id);
  expect(copied.length).toBeGreaterThanOrEqual(2);
  expect(rows()).toBe(4);
  const row = fixture.media.about(job.mediaId ?? '');
  expect(stored()).toEqual([row?.path]);
  expect(
    (fixture.db.prepare('SELECT listed FROM media WHERE id=?').get(job.mediaId) as { listed: number }).listed,
  ).toBe(1);
}, 40_000);

it('never removes a video already in Media: the same combine again, refused its listing, leaves the first one whole', async () => {
  const { hooks } = await setUp();
  const first = await settled((await started(ask(['source', 'second']))).id);
  const kept = fixture.media.about(first.mediaId ?? '');
  const bytes = await sha256File(join(fixture.dir, kept?.path ?? ''));
  hooks.publish = false;
  await ended((await started(ask(['source', 'second']))).id, 'failed');
  // The same bytes again (or other ones): the first video stays listed with its file; nothing else is left.
  expect(fixture.media.about(first.mediaId ?? '')).toMatchObject({ deleted: false, missing: false });
  expect(
    (fixture.db.prepare('SELECT listed FROM media WHERE id=?').get(first.mediaId) as { listed: number })
      .listed,
  ).toBe(1);
  expect((await sha256File(join(fixture.dir, kept?.path ?? ''))).sha256).toBe(bytes.sha256);
  expect(rows()).toBe(4);
  expect(stored()).toEqual([kept?.path]);
}, 40_000);

it('at the start, removes what a quit or a crash left of a combine, and nothing else', async () => {
  const { work, deps } = await setUp();
  combines.close();
  const made = (name: string, colour: string, folder: string, label?: string) =>
    (async () => {
      const file = join(folder, name);
      copyFf([
        '-f',
        'lavfi',
        '-i',
        `color=c=${colour}:s=64x36:r=25:d=0.4`,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        file,
      ]);
      return registerProxyFile({
        db: fixture.db,
        mediaDir: fixture.dir,
        file,
        info: await readTrimInfo(copyFfmpeg, file),
        ...(label ? { name: label } : {}),
        signal: new AbortController().signal,
        idle: () => true,
        freeBytes: () => 100 * 1024 ** 3,
      });
    })();
  // Left by a combine cut short (copied into Media, never listed); a finished combine (listed); a lighter playing copy
  // (unlisted, but not a combine's).
  const left = await made('.left.mp4', 'red', work, 'Placeholder left.mp4');
  const finished = await made('.finished.mp4', 'green', work, 'Placeholder finished.mp4');
  fixture.db.prepare('UPDATE media SET listed=1 WHERE id=?').run(finished);
  const lighter = await made('lighter.mp4', 'blue', fixture.dir);
  const before = {
    finished: fixture.media.about(finished)?.path,
    lighter: fixture.media.about(lighter)?.path,
  };
  expect(stored()).toHaveLength(3);
  combines = new CombineVideos(deps);
  // Chosen at the start, removed shortly (never waiting on the library's write lock).
  await vi.waitFor(() => {
    expect(fixture.db.prepare('SELECT id FROM media WHERE id=?').get(left)).toBeUndefined();
  });
  expect(fixture.media.about(finished)).not.toBeNull();
  expect(fixture.media.about(lighter)).not.toBeNull();
  expect(stored().sort()).toEqual([before.finished, before.lighter].sort());
  expect(readdirSync(work)).toEqual([]);
}, 30_000);

/*
 * a22-review-combine2: MUST-1 through the service (a row another import took up is kept), S1 (no file without a row),
 * S3 (done without waiting for a removal) and S4 (the copy goes while it waits).
 */
/** Every removal asked for so far has run. */
async function removalsDone(hooks: { discards: Promise<unknown>[] }, atLeast: number) {
  await vi.waitFor(() => {
    expect(hooks.discards.length).toBeGreaterThanOrEqual(atLeast);
  });
  await Promise.all(hooks.discards);
}

it('Stop just after the copy into Media keeps a copy a PowerPoint video took up meanwhile, with its file', async () => {
  const { hooks } = await setUp();
  const queued = { id: '' };
  const taken: { id: string | null; path: string } = { id: null, path: '' };
  hooks.imported = (id) => {
    const row = fixture.db.prepare('SELECT path, sha256, bytes FROM media WHERE id = ?').get(id) as {
      path: string;
      sha256: string;
      bytes: number;
    };
    // An imported deck's video, kept as an editable document object, has the very same bytes.
    taken.id = new MediaStore(fixture.db, { dir: fixture.dir }).addStaged(
      {
        kind: 'video',
        name: 'Placeholder object.mp4',
        rel: row.path,
        sha256: row.sha256,
        bytes: row.bytes,
        probe: { kind: 'video', playable: true, format: 'H.264 video (MP4)' },
      },
      { kind: 'drashti', path: 'Editable document object' },
    ).mediaId;
    taken.path = row.path;
    fixture.db
      .prepare("INSERT INTO app_meta(key, value) VALUES ('setting.placeholderDeckVideo', ?)")
      .run(JSON.stringify({ mediaId: taken.id }));
    expect(combines.stop(queued.id)).toBe(true);
  };
  queued.id = (await started(ask(['source', 'second']))).id;
  await ended(queued.id, 'stopped');
  await removalsDone(hooks, 1);
  expect(taken.id).not.toBeNull();
  expect(fixture.db.prepare('SELECT 1 FROM media WHERE id = ?').get(taken.id)).toBeDefined();
  expect(stored()).toEqual([taken.path]);
}, 30_000);

it("Stop while the copy into Media waits for the library's write lock leaves no file in Media", async () => {
  const { hooks } = await setUp();
  // The import worker's connection takes the write lock while the combine encodes.
  const other = openDatabase(join(fixture.dir, 'library.sqlite'));
  cleanup.push(() => {
    if (other.inTransaction) other.exec('ROLLBACK');
    other.close();
  });
  hooks.encoding = () => {
    if (!other.inTransaction) other.exec('BEGIN IMMEDIATE');
  };
  const queued = await started(ask(['source', 'second']));
  // The file is in Media's folder (renamed, not a copy still going), its row waiting for the lock: Stop then.
  await vi.waitFor(
    () => {
      expect(renamed()).toHaveLength(1);
      expect(stored()).toHaveLength(1);
    },
    { timeout: 20_000 },
  );
  expect(combines.stop(queued.id)).toBe(true);
  await ended(queued.id, 'stopped');
  other.exec('ROLLBACK');
  await removalsDone(hooks, 1);
  await vi.waitFor(() => {
    expect(stored()).toEqual([]);
  });
  expect(rows()).toBe(3);
}, 30_000);

it('a finished combine says done without waiting for the removal of what an earlier attempt left', async () => {
  const { hooks } = await setUp();
  const release: { go: () => void } = { go: () => undefined };
  hooks.holdKept = new Promise<void>((resolve) => {
    release.go = resolve;
  });
  const queued = await started(ask(['source', 'second']));
  await vi.waitFor(
    () => {
      expect(combines.list().find((j) => j.id === queued.id)?.state).toBe('done');
    },
    { timeout: 15_000 },
  );
  release.go();
  await removalsDone(hooks, 1);
  expect(rows()).toBe(4);
}, 30_000);

it('a wait just after the copy into Media removes that copy only once the gate opens again, then keeps one new video', async () => {
  const { hooks } = await setUp();
  const copied: string[] = [];
  hooks.imported = (id) => {
    copied.push(id);
    if (copied.length === 1) fixture.activity.stream = true;
  };
  const queued = await started(ask(['source', 'second']));
  await vi.waitFor(
    () => {
      expect(combines.list().find((j) => j.id === queued.id)?.state).toBe('waiting');
      expect(copied).toHaveLength(1);
    },
    { timeout: 20_000 },
  );
  // a22-review-combine2 R-S2: nothing is removed (no library-wide scan on Main) as the stream goes on air.
  expect(hooks.discards).toHaveLength(0);
  expect(rows()).toBe(4);
  fixture.activity.stream = false;
  const job = await settled(queued.id);
  // Removed as the next attempt began (the gate open), before its own copy: that copy is a new row.
  expect(copied).toHaveLength(2);
  expect(copied[1]).not.toBe(copied[0]);
  expect(fixture.db.prepare('SELECT 1 FROM media WHERE id = ?').get(copied[0])).toBeUndefined();
  const row = fixture.media.about(job.mediaId ?? '');
  expect(rows()).toBe(4);
  expect(stored()).toEqual([row?.path]);
}, 40_000);

/*
 * a22-review-combine2 re-review: R-S1, an import reuses a file or a row by its bytes in two steps without the lock, so
 * nothing unlisted is removed while an import or a deck's preparation goes (left for the next start); R-S2, nothing is
 * removed while a video or sound plays, the stream is on air or a recording goes on.
 */
it('an import going: Media refusing the listing leaves the copy for the next start, which removes it', async () => {
  const { hooks, deps } = await setUp();
  hooks.importing = true;
  hooks.publish = false;
  const queued = await started(ask(['source', 'second']));
  await ended(queued.id, 'failed');
  await removalsDone(hooks, 1);
  expect(rows()).toBe(4);
  expect(stored()).toHaveLength(1);
  // The next start, with no import going.
  combines.close();
  hooks.importing = false;
  combines = new CombineVideos(deps);
  await vi.waitFor(() => {
    expect(hooks.sweeps).toHaveLength(2);
  });
  await Promise.all(hooks.sweeps);
  expect(rows()).toBe(3);
  expect(stored()).toEqual([]);
}, 30_000);

it('Stop while the copy into Media waits for the write lock, with an import going, keeps the file (when in doubt)', async () => {
  const { hooks } = await setUp();
  const other = openDatabase(join(fixture.dir, 'library.sqlite'));
  cleanup.push(() => {
    if (other.inTransaction) other.exec('ROLLBACK');
    other.close();
  });
  hooks.encoding = () => {
    if (!other.inTransaction) other.exec('BEGIN IMMEDIATE');
  };
  const queued = await started(ask(['source', 'second']));
  await vi.waitFor(
    () => {
      expect(renamed()).toHaveLength(1);
      expect(stored()).toHaveLength(1);
    },
    { timeout: 20_000 },
  );
  // An import has just seen that file and will write its own row for it.
  hooks.importing = true;
  expect(combines.stop(queued.id)).toBe(true);
  await ended(queued.id, 'stopped');
  other.exec('ROLLBACK');
  await removalsDone(hooks, 1);
  expect(stored()).toHaveLength(1);
  expect(rows()).toBe(3);
}, 30_000);

it('Stop on air after the copy into Media removes nothing on air; the next start removes it', async () => {
  const { hooks, deps } = await setUp();
  const copied: string[] = [];
  hooks.imported = (id) => {
    copied.push(id);
    fixture.activity.stream = true;
  };
  const queued = await started(ask(['source', 'second']));
  // Waiting again, after its copy into Media (not its first wait, before anything was made).
  await vi.waitFor(
    () => {
      expect(copied).toHaveLength(1);
      expect(combines.list().find((j) => j.id === queued.id)?.state).toBe('waiting');
    },
    { timeout: 20_000 },
  );
  expect(combines.stop(queued.id)).toBe(true);
  await removalsDone(hooks, 1);
  // Still on air: the copy stays.
  expect(rows()).toBe(4);
  expect(stored()).toHaveLength(1);
  combines.close();
  fixture.activity.stream = false;
  combines = new CombineVideos(deps);
  await vi.waitFor(() => {
    expect(rows()).toBe(3);
    expect(stored()).toEqual([]);
  });
}, 30_000);

it("Stop just after the copy into Media keeps a copy a deck's preparation took up, though its editor has not saved it", async () => {
  const { hooks } = await setUp();
  const queued = { id: '' };
  const taken: { id: string | null; path: string } = { id: null, path: '' };
  hooks.imported = (id) => {
    const row = fixture.db.prepare('SELECT path, sha256, bytes FROM media WHERE id = ?').get(id) as {
      path: string;
      sha256: string;
      bytes: number;
    };
    // The deck's preparation takes the same bytes up and ends; nothing names the row until its editor saves.
    taken.id = new MediaStore(fixture.db, { dir: fixture.dir }).addStaged(
      {
        kind: 'video',
        name: 'Placeholder object.mp4',
        rel: row.path,
        sha256: row.sha256,
        bytes: row.bytes,
        probe: { kind: 'video', playable: true, format: 'H.264 video (MP4)' },
      },
      { kind: 'drashti', path: 'Editable document object' },
    ).mediaId;
    taken.path = row.path;
    expect(combines.stop(queued.id)).toBe(true);
  };
  queued.id = (await started(ask(['source', 'second']))).id;
  await ended(queued.id, 'stopped');
  await removalsDone(hooks, 1);
  expect(taken.id).not.toBeNull();
  expect(fixture.db.prepare('SELECT 1 FROM media WHERE id = ?').get(taken.id)).toBeDefined();
  expect(stored()).toEqual([taken.path]);
}, 30_000);
