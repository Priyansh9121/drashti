import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { MediaRepo } from '../db/media';
import { VideoEditsRepo } from '../db/video-edits';
import { sourceWrite } from '../documents/source-write';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';
import { testFfmpeg } from '../testing/ffmpeg-here';
import { initialEngineState } from '../../shared/engine/state';
import { PLAIN_VIDEO_EDIT, type VideoEditSnapshot } from '../../shared/video-edit';
import { prepareVideoEdits } from '../engine/video-edit-ready';
import { ConvertService } from './convert-service';
import { EditService } from './edit-service';
import { registerEditedFile } from './edit-files';

const ffmpeg = testFfmpeg({ linux: true });
let directory = '';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

it('prepares and registers one real rendition through the idle worker, then resolves it for a new showing', async () => {
  directory = mkdtempSync(join(tmpdir(), 'drashti-edit-service-real-'));
  const file = join(directory, 'Source placeholder.mp4');
  const made = spawnSync(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=160x90:r=25:d=4',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-threads:v',
      '1',
      file,
    ],
    { env: ffmpegEnv(), windowsHide: true },
  );
  expect(made.status).toBe(0);
  const original = hash(file);
  const db = openDatabase(':memory:');
  cleanup.push(() => db.close());
  db.prepare(
    "INSERT INTO media (id,kind,name,path,sha256,duration_ms,playable) VALUES ('video','video','Source placeholder.mp4','Source placeholder.mp4',?,4000,1)",
  ).run(original);
  const media = new MediaRepo(db);
  const repo = new VideoEditsRepo(db);
  const recipe = {
    ...PLAIN_VIDEO_EDIT,
    trim: { startMs: 1000, endMs: 3000 },
    speed: 2,
    picture: { ...PLAIN_VIDEO_EDIT.picture, frame: '1:1' as const, flipX: true },
  };
  expect(repo.save({ mediaId: 'video', revision: 0, recipe })).toMatchObject({
    ok: true,
    edit: { state: 'preparing', readyMediaId: null },
  });
  const active = new Set<number>();
  let maximum = 0;
  const conversions = new ConvertService({
    db,
    mediaDir: directory,
    ffmpegPath: () => ffmpeg,
    busy: () => null,
    showBusy: () => false,
    freeBytes: () => 100 * 1024 ** 3,
    changed: () => undefined,
    libraryChanged: () => undefined,
    log: () => undefined,
    children: {
      started: (pid) => {
        if (pid !== undefined) active.add(pid);
        maximum = Math.max(maximum, active.size);
      },
      ended: (pid) => {
        if (pid !== undefined) active.delete(pid);
      },
    },
  });
  cleanup.push(() => conversions.close());
  let finished: (snapshot: VideoEditSnapshot) => void = () => undefined;
  const completion = new Promise<VideoEditSnapshot>((resolve) => {
    finished = resolve;
  });
  const write = sourceWrite(db);
  const service = new EditService({
    repo,
    mediaDir: directory,
    source: () => ({ path: file, name: 'Source placeholder' }),
    idle: () => true,
    conversions,
    write,
    register: (temporary, info, name, signal) =>
      registerEditedFile({
        db,
        mediaDir: directory,
        file: temporary,
        info,
        name,
        signal,
        idle: () => true,
        freeBytes: () => 100 * 1024 ** 3,
        write,
      }),
    changed: finished,
  });
  cleanup.push(() => service.close());
  service.wake();
  const ready = await completion;
  expect(ready.state, ready.message ?? 'Expected the prepared file to become ready').toBe('ready');
  expect(ready.readyMediaId).not.toBe('video');
  expect(ready.readyMediaId).not.toBeNull();
  if (!ready.readyMediaId) throw new Error('No prepared ID');
  expect(media.lengthOf(ready.readyMediaId)).toBe(1000);
  expect(repo.renditionOf(ready.readyMediaId)).toEqual({ sourceId: 'video', revision: 1, recipe });
  expect(hash(file)).toBe(original);
  expect(maximum).toBe(1);
  const next = initialEngineState();
  next.layers.background = {
    kind: 'media',
    mediaId: 'video',
    media: 'video',
    fit: 'fit',
    loop: false,
    startedAt: 1000,
  };
  const resolved = prepareVideoEdits(initialEngineState(), next, (id) => repo.read(id), false, {
    sourceId: (id) => repo.sourceId(id),
    renditionOf: (id) => repo.renditionOf(id),
    lengthOf: (id) => media.lengthOf(id),
  });
  expect(resolved.state?.layers.background).toMatchObject({ mediaId: ready.readyMediaId, durationMs: 1000 });
}, 20_000);
