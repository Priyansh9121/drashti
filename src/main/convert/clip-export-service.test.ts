import { afterEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { ClipExports } from './clip-export-service';
import type { ClipExportRequest } from '../../shared/video-copies';
import { sha256File } from '../import/media-store';
import { copyFf, copyFixture, copyFfmpeg } from './video-copy-fixtures';
import { readTrimInfo } from './trim-copy';
import { discardUnlisted, registerProxyFile, unlistedMadeFrom } from './video-copy-files';
import { MediaStore } from '../import/media-store';
import { forgetTaken } from '../library/media-taken';

let fixture: Awaited<ReturnType<typeof copyFixture>>;
let clips: ClipExports;
/*
 * Moments a test may act at (a22-exportclip): once the clip is copied into Media (not listed yet), whether the source
 * is still the one chosen, whether listing it succeeds, and whether removing what was not listed works (it fails as
 * when the library closes before it).
 */
let hooks: {
  imported?: (mediaId: string) => void;
  current: boolean;
  publish: boolean;
  discard: boolean;
  /** Each removal asked for, as it was asked. */
  discards: Promise<unknown>[];
  /** An import or a deck's preparation is going (a22-review-combine2 R-S1). */
  importing: boolean;
  /** The copy's file is held (Windows): a removal removes nothing and keeps its row, as discardUnlisted does then. */
  held: boolean;
} = {
  current: true,
  publish: true,
  discard: true,
  discards: [],
  importing: false,
  held: false,
};
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
function service(destination: string) {
  let kept: unknown = [];
  // What is left to remove across a restart (a22-exportclip: video-clip-left.json).
  let left: unknown = [];
  hooks = { current: true, publish: true, discard: true, discards: [], importing: false, held: false };
  const deps = {
    conversions: fixture.conversions,
    resolve: (request: ClipExportRequest) => ({
      ok: true as const,
      source: {
        mediaId: 'source',
        sha256: fixture.sha,
        path: fixture.source,
        name: 'Placeholder source',
        identity: fixture.sha,
        durationMs: fixture.info.durationMs,
        startMs: request.startMs,
        endMs: request.endMs,
      },
    }),
    current: () => hooks.current,
    pickDest: () => Promise.resolve(destination),
    kept: {
      load: () => kept,
      save: (value: unknown) => {
        kept = value;
      },
    },
    prepareImport: async (file: string, info: typeof fixture.info, name: string, signal: AbortSignal) => {
      const id = await registerProxyFile({
        db: fixture.db,
        mediaDir: fixture.dir,
        file,
        info,
        name,
        signal,
        idle: () => fixture.idle(),
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
    // As the app has it (video-copies-ipc.ts): what an export copied into Media from its own file and never listed.
    discardUnlisted: (
      files: string | readonly string[],
      keep: ReadonlySet<string>,
      allowed: () => boolean,
    ) => {
      const made = typeof files === 'string' ? { file: files } : { files };
      const asked = !hooks.discard
        ? Promise.reject(new Error('The library is closed.'))
        : hooks.held
          ? Promise.resolve(0)
          : discardUnlisted({ db: fixture.db, mediaDir: fixture.dir, ...made, keep, allowed });
      hooks.discards.push(asked.catch(() => undefined));
      return asked;
    },
    // As the app has it: nothing playing, off air, not recording, and no import or deck preparation going.
    quiet: () => fixture.idle() && !hooks.importing,
    left: {
      load: () => left,
      save: (value: unknown) => {
        left = value;
      },
    },
    leftFrom: (file: string) => unlistedMadeFrom(fixture.db, file),
  };
  clips = new ClipExports(deps);
  cleanup.push(() => clips.close());
  return deps;
}
const request: ClipExportRequest = {
  mediaId: 'source',
  startMs: 350,
  endMs: 1750,
  frame: 'original',
  shape: 'source',
  container: 'mp4',
  addToLibrary: false,
  revision: null,
};
/** Every row in Media, listed or not (the fixture's source to begin with). */
const rows = () => (fixture.db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number }).n;
/** The files kept in Media's own hashed folders (`ab/<sha256>.mp4`). */
const stored = () =>
  readdirSync(fixture.dir)
    .filter((folder) => /^[0-9a-f]{2}$/u.test(folder))
    .flatMap((folder) => readdirSync(join(fixture.dir, folder)).map((file) => `${folder}/${file}`));
async function ended(state: 'failed' | 'stopped') {
  await vi.waitFor(
    () => {
      expect(clips.list().at(-1)?.state).toBe(state);
    },
    { timeout: 10_000 },
  );
  return clips.list().at(-1);
}
async function done() {
  await vi.waitFor(
    () => {
      const job = clips.list().at(-1);
      if (job?.state === 'failed') throw new Error(job.message ?? 'Export failed.');
      expect(job?.state).toBe('done');
    },
    { timeout: 10_000 },
  );
  const job = clips.list().at(-1);
  if (!job?.path) throw new Error('The export path is missing.');
  return job;
}
function pixels(file: string, at: string) {
  return copyFf([
    '-ss',
    at,
    '-i',
    file,
    '-an',
    '-frames:v',
    '1',
    '-vf',
    'scale=16:9',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
}
it('exports a non-keyframe cut accurately without overwriting the source, through one worker', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  service(fixture.source);
  expect(await clips.start(request)).toMatchObject({ ok: true });
  const job = await done();
  expect(job.path).not.toBe(fixture.source);
  const info = await readTrimInfo(copyFfmpeg, job.path ?? '');
  expect(Math.abs((info.durationMs ?? 0) - 1400)).toBeLessThanOrEqual(80);
  const expected = pixels(fixture.source, '0.350');
  const actual = pixels(job.path ?? '', '0');
  expect(actual.length).toBe(expected.length);
  const error =
    expected.reduce((sum, value, i) => sum + Math.abs(value - (actual[i] ?? 0)), 0) / expected.length;
  expect(error).toBeLessThan(4);
  expect((await sha256File(fixture.source)).sha256).toBe(fixture.sha);
  expect(fixture.maxActive()).toBe(1);
}, 15_000);
it('saves a 1080 by 1920 vertical clip and registers it only after validation', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  service(join(fixture.dir, 'vertical.mp4'));
  await clips.start({ ...request, shape: 'vertical', addToLibrary: true });
  const job = await done();
  const info = await readTrimInfo(copyFfmpeg, job.path ?? '');
  expect(info.video).toMatchObject({ width: 1080, height: 1920 });
  expect(job.added).toBe(true);
  expect(fixture.media.list()).toHaveLength(2);
  expect((await sha256File(fixture.source)).sha256).toBe(fixture.sha);
}, 15_000);
it('keeps a queued request across a close and resumes it only when idle; Stop removes its partial output', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  fixture.activity.stream = true;
  const dest = join(fixture.dir, 'queued.mp4');
  const deps = service(dest);
  const result = await clips.start(request);
  expect(result).toMatchObject({ ok: true, job: { state: 'waiting' } });
  expect(existsSync(dest)).toBe(false);
  clips.close();
  clips = new ClipExports(deps);
  clips.resume();
  clips.resume();
  expect(clips.list()).toHaveLength(1);
  expect(clips.list()[0]?.state).toBe('waiting');
  fixture.activity.stream = false;
  await done();
  expect(existsSync(dest)).toBe(true);
  fixture.activity.stream = true;
  const stopped = join(fixture.dir, 'stopped.mp4');
  clips.close();
  service(stopped);
  await clips.start(request);
  const pending = clips.list().at(-1);
  expect(clips.stop(pending?.id ?? '')).toBe(true);
  expect(clips.list().at(-1)?.state).toBe('stopped');
  expect(existsSync(stopped)).toBe(false);
}, 15_000);

it('keeps real WebM transparency in the exported file without replacing the source', async () => {
  fixture = await copyFixture({ alpha: true });
  cleanup.push(() => fixture.cleanup());
  service(join(fixture.dir, 'transparent clip.webm'));
  await clips.start({ ...request, startMs: 80, endMs: 320, container: 'webm' });
  const job = await done();
  const rgba = copyFf([
    '-c:V:0',
    'libvpx-vp9',
    '-i',
    job.path ?? '',
    '-frames:v',
    '1',
    '-vf',
    'scale=2:2,format=rgba',
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
  expect(rgba).toHaveLength(16);
  for (const at of [3, 7, 11, 15]) expect(rgba[at]).toBeGreaterThan(110);
  for (const at of [3, 7, 11, 15]) expect(rgba[at]).toBeLessThan(145);
  expect((await sha256File(fixture.source)).sha256).toBe(fixture.sha);
}, 15_000);

/*
 * a22-exportclip (lead 2, after a22-review-combine S4): Export clip's Also add the clip to Media, failing, stopped or
 * let go of after its copy into Media, leaves no unlisted row and no file in Media's folders; a video already in Media
 * is never touched.
 */
const adding = { ...request, addToLibrary: true };
it('the video changing just after the clip was copied into Media: no row or file is left in Media', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  const dest = join(fixture.dir, 'changed clip.mp4');
  service(dest);
  const copied: string[] = [];
  hooks.imported = (id) => {
    copied.push(id);
    hooks.current = false;
  };
  expect(await clips.start(adding)).toMatchObject({ ok: true });
  await ended('failed');
  expect(copied).toHaveLength(1);
  expect(rows()).toBe(1);
  expect(stored()).toEqual([]);
  expect(existsSync(dest)).toBe(false);
}, 15_000);

it('Stop just after the clip was copied into Media leaves no row or file in Media', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  const dest = join(fixture.dir, 'stopped clip.mp4');
  service(dest);
  hooks.imported = () => {
    expect(clips.stop(clips.list().at(-1)?.id ?? '')).toBe(true);
  };
  expect(await clips.start(adding)).toMatchObject({ ok: true });
  await ended('stopped');
  await vi.waitFor(() => {
    expect(rows()).toBe(1);
  });
  expect(stored()).toEqual([]);
  expect(existsSync(dest)).toBe(false);
}, 15_000);

it('Media refusing to list the clip keeps the saved file and leaves no unlisted row or file in Media', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  const dest = join(fixture.dir, 'refused clip.mp4');
  service(dest);
  hooks.publish = false;
  expect(await clips.start(adding)).toMatchObject({ ok: true });
  const job = await done();
  expect(job.added).toBe(false);
  expect(job.message).toMatch(/could not be added to Media/u);
  expect(existsSync(dest)).toBe(true);
  expect(rows()).toBe(1);
  expect(stored()).toEqual([]);
}, 15_000);

it('Drashti closing just after the copy into Media: the next start removes what was left before it exports again', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  const dest = join(fixture.dir, 'closed clip.mp4');
  const deps = service(dest);
  // The library closes before the removal can run, as at a quit or a crash.
  hooks.discard = false;
  hooks.imported = () => {
    clips.close();
  };
  expect(await clips.start(adding)).toMatchObject({ ok: true });
  await vi.waitFor(() => {
    expect(rows()).toBe(2);
  });
  expect(stored()).toHaveLength(1);
  const before = fixture.db.prepare("SELECT id FROM media WHERE id <> 'source'").get() as { id: string };
  // The next start, quiet: what was left goes before the export, kept as asked, runs again.
  hooks = { current: true, publish: true, discard: true, discards: [], importing: false, held: false };
  const atCopy: { id: string | null; earlier: unknown } = { id: null, earlier: undefined };
  hooks.imported = (id) => {
    atCopy.id = id;
    atCopy.earlier = fixture.db.prepare('SELECT 1 FROM media WHERE id = ?').get(before.id);
  };
  clips = new ClipExports(deps);
  clips.resume();
  const job = await done();
  // Gone before the export copied again: its copy is a row of its own.
  expect(atCopy.earlier).toBeUndefined();
  expect(atCopy.id).not.toBe(before.id);
  expect(job.added).toBe(true);
  expect(rows()).toBe(2);
  expect(stored()).toHaveLength(1);
}, 20_000);

it('never touches a clip already in Media: the same clip again, refused its listing, leaves the first one whole', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  service(join(fixture.dir, 'first clip.mp4'));
  expect(await clips.start(adding)).toMatchObject({ ok: true });
  expect((await done()).added).toBe(true);
  const first = fixture.db.prepare("SELECT id, path FROM media WHERE id <> 'source'").get() as {
    id: string;
    path: string;
  };
  const bytes = await sha256File(join(fixture.dir, first.path));
  clips.close();
  service(join(fixture.dir, 'second clip.mp4'));
  hooks.publish = false;
  expect(await clips.start(adding)).toMatchObject({ ok: true });
  expect((await done()).added).toBe(false);
  expect(
    (fixture.db.prepare('SELECT listed FROM media WHERE id=?').get(first.id) as { listed: number }).listed,
  ).toBe(1);
  expect((await sha256File(join(fixture.dir, first.path))).sha256).toBe(bytes.sha256);
  expect(rows()).toBe(2);
  expect(stored()).toEqual([first.path]);
}, 20_000);

it('Stop just after the copy into Media keeps a copy a PowerPoint video took up meanwhile, with its file', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  service(join(fixture.dir, 'taken clip.mp4'));
  const taken: { id: string | null; path: string } = { id: null, path: '' };
  hooks.imported = (id) => {
    const row = fixture.db.prepare('SELECT path, sha256, bytes FROM media WHERE id = ?').get(id) as {
      path: string;
      sha256: string;
      bytes: number;
    };
    // An imported deck's video, kept as an editable document object, has the very same bytes (a22-review-combine2).
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
    expect(clips.stop(clips.list().at(-1)?.id ?? '')).toBe(true);
  };
  expect(await clips.start(adding)).toMatchObject({ ok: true });
  await ended('stopped');
  // The end of the run asked for its removal, and it has run.
  await vi.waitFor(() => {
    expect(hooks.discards.length).toBeGreaterThanOrEqual(1);
  });
  await Promise.all(hooks.discards);
  expect(taken.id).not.toBeNull();
  expect(fixture.db.prepare('SELECT 1 FROM media WHERE id = ?').get(taken.id)).toBeDefined();
  expect(stored()).toEqual([taken.path]);
}, 15_000);

/*
 * a22-review-combine2 re-review, the same rules for Export clip: R-S1, nothing unlisted is removed while an import or a
 * deck's preparation goes; R-S2, nothing while a video or sound plays, the stream is on air or a recording goes on.
 * What is left is kept in a list across a restart and removed at the next start.
 */
it('an import going: Media refusing the listing leaves the copy for the next start, which removes it', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  const deps = service(join(fixture.dir, 'importing clip.mp4'));
  hooks.importing = true;
  hooks.publish = false;
  expect(await clips.start(adding)).toMatchObject({ ok: true });
  expect((await done()).added).toBe(false);
  await Promise.all(hooks.discards);
  expect(rows()).toBe(2);
  expect(stored()).toHaveLength(1);
  // The next start, with no import going.
  clips.close();
  hooks.importing = false;
  clips = new ClipExports(deps);
  clips.resume();
  await vi.waitFor(() => {
    expect(rows()).toBe(1);
    expect(stored()).toEqual([]);
  });
}, 20_000);

it('Stop on air after the copy into Media removes nothing on air; the next start removes it', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  const deps = service(join(fixture.dir, 'on air clip.mp4'));
  const copied: string[] = [];
  hooks.imported = (id) => {
    copied.push(id);
    fixture.activity.stream = true;
  };
  expect(await clips.start(adding)).toMatchObject({ ok: true });
  // Waiting again, after its copy into Media.
  await vi.waitFor(() => {
    expect(copied).toHaveLength(1);
    expect(clips.list().at(-1)?.state).toBe('waiting');
  });
  expect(clips.stop(clips.list().at(-1)?.id ?? '')).toBe(true);
  await vi.waitFor(() => {
    expect(hooks.discards.length).toBeGreaterThanOrEqual(1);
  });
  await Promise.all(hooks.discards);
  expect(rows()).toBe(2);
  expect(stored()).toHaveLength(1);
  clips.close();
  fixture.activity.stream = false;
  clips = new ClipExports(deps);
  clips.resume();
  await vi.waitFor(() => {
    expect(rows()).toBe(1);
    expect(stored()).toEqual([]);
  });
}, 20_000);

it('an import going at the next start keeps what was left for a later start', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  const deps = service(join(fixture.dir, 'later clip.mp4'));
  hooks.publish = false;
  hooks.importing = true;
  expect(await clips.start(adding)).toMatchObject({ ok: true });
  await done();
  await Promise.all(hooks.discards);
  clips.close();
  // A start with an import going: still left.
  clips = new ClipExports(deps);
  clips.resume();
  await Promise.all(hooks.discards);
  expect(rows()).toBe(2);
  expect(stored()).toHaveLength(1);
  clips.close();
  // A later start, quiet.
  hooks.importing = false;
  clips = new ClipExports(deps);
  clips.resume();
  await vi.waitFor(() => {
    expect(rows()).toBe(1);
    expect(stored()).toEqual([]);
  });
}, 20_000);

/*
 * a22-review-combine2 short look, L-E1: a leftover kept only for now (its file still held on Windows, or its row taken
 * up by its bytes in this run) stays in the list of what is left, so a later start tries it again, by the same rules.
 */
it('a copy whose file is still held stays in the list, and a later start removes it', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  const deps = service(join(fixture.dir, 'held clip.mp4'));
  hooks.publish = false;
  hooks.held = true;
  expect(await clips.start(adding)).toMatchObject({ ok: true });
  await done();
  await Promise.all(hooks.discards);
  expect(rows()).toBe(2);
  // The next start: no longer held.
  clips.close();
  hooks.held = false;
  clips = new ClipExports(deps);
  clips.resume();
  await vi.waitFor(() => {
    expect(rows()).toBe(1);
    expect(stored()).toEqual([]);
  });
}, 20_000);

it('a copy taken up by its bytes in this run stays in the list, and the next run removes it if nothing uses it', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  const deps = service(join(fixture.dir, 'taken clip.mp4'));
  hooks.publish = false;
  hooks.imported = (id) => {
    const row = fixture.db.prepare('SELECT path, sha256, bytes FROM media WHERE id = ?').get(id) as {
      path: string;
      sha256: string;
      bytes: number;
    };
    // A deck's preparation takes the same bytes up and ends; its editor is closed without saving.
    new MediaStore(fixture.db, { dir: fixture.dir }).addStaged(
      {
        kind: 'video',
        name: 'Placeholder object.mp4',
        rel: row.path,
        sha256: row.sha256,
        bytes: row.bytes,
        probe: { kind: 'video', playable: true, format: 'H.264 video (MP4)' },
      },
      { kind: 'drashti', path: 'Editable document object' },
    );
  };
  expect(await clips.start(adding)).toMatchObject({ ok: true });
  await done();
  await Promise.all(hooks.discards);
  expect(rows()).toBe(2);
  // The next run of Drashti: nothing took it up in this one, and nothing uses it.
  clips.close();
  forgetTaken();
  hooks.imported = undefined;
  clips = new ClipExports(deps);
  clips.resume();
  await vi.waitFor(() => {
    expect(rows()).toBe(1);
    expect(stored()).toEqual([]);
  });
}, 20_000);

/*
 * The leaks the reviews left (a22-combineleaks), for the list of what is left: every file there is tried at a start in
 * ONE removal (one library-wide scan, however long the list: a copy something uses stays listed for good); a list
 * longer than its cap is not dropped whole (the extra entries are, the newest kept).
 */
/** A copy into Media an earlier run's export left (never listed), its row and its file, from its own temporary file. */
function seeded(n: number) {
  const sha = `${String(n).padStart(2, '0')}cd`.padEnd(64, 'e');
  const path = `${sha.slice(0, 2)}/${sha}.mp4`;
  mkdirSync(join(fixture.dir, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(fixture.dir, path), 'placeholder clip copy');
  const source = join(fixture.dir, `.placeholder-${String(n)}.mp4`);
  fixture.db
    .prepare(
      `INSERT INTO media(id,kind,name,path,sha256,bytes,playable,source_kind,source_path,listed)
       VALUES (?,'video','Placeholder clip.mp4',?,?,21,1,'drashti',?,0)`,
    )
    .run(`placeholder-${String(n)}`, path, sha, source);
  return { id: `placeholder-${String(n)}`, source, file: join(fixture.dir, path) };
}

it('at a start, every file left from earlier runs is tried in one removal', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  const deps = service(join(fixture.dir, 'unused clip.mp4'));
  clips.close();
  const left = [seeded(1), seeded(2), seeded(3)];
  deps.left.save(left.map((one) => one.source));
  clips = new ClipExports(deps);
  clips.resume();
  await vi.waitFor(() => {
    expect(rows()).toBe(1);
  });
  await Promise.all(hooks.discards);
  expect(hooks.discards).toHaveLength(1);
  for (const one of left) expect(existsSync(one.file)).toBe(false);
}, 20_000);

it('a list of what is left longer than its cap is not dropped whole', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  const deps = service(join(fixture.dir, 'unused clip.mp4'));
  clips.close();
  const real = seeded(1);
  const others = Array.from({ length: 600 }, (_, at) =>
    join(fixture.dir, `.placeholder-gone-${String(at)}.mp4`),
  );
  deps.left.save([...others, real.source]);
  clips = new ClipExports(deps);
  clips.resume();
  await vi.waitFor(() => {
    expect(rows()).toBe(1);
  });
  expect(existsSync(real.file)).toBe(false);
}, 20_000);
