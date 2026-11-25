import { afterEach, expect, it, vi } from 'vitest';
import { PLAIN_VIDEO_EDIT, type VideoEditSnapshot } from '../../shared/video-edit';
import type { ClipExportRequest } from '../../shared/video-copies';
import { copyFixture, copyFf, copyFfmpeg } from './video-copy-fixtures';
import { join } from 'node:path';
import { editPlan } from './edit-plan';
import { ClipExports } from './clip-export-service';
import { readTrimInfo } from './trim-copy';
import { sha256File } from '../import/media-store';
import { editedClipSource, type EditedClipPlanner } from './clip-edited-source';
let close: () => void = () => undefined;
afterEach(() => close());
it('captures the saved recipe and full-quality source, then uses the supplied S2 planner exactly once', async () => {
  const fixture = await copyFixture();
  close = () => fixture.cleanup();
  const edit: VideoEditSnapshot = {
    mediaId: 'source',
    revision: 2,
    state: 'ready',
    readyMediaId: 'prepared',
    message: null,
    recipe: { ...structuredClone(PLAIN_VIDEO_EDIT), speed: 2, noiseReduction: true, audioTrack: 1 },
  };
  const plan = vi.fn<EditedClipPlanner>(() => ({
    durationMs: 700,
    target: 'mp4',
    args: (output) => [
      '-filter_complex',
      '[0:V:0]null[picture]',
      '-map',
      '[picture]',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-f',
      'mp4',
      output,
    ],
  }));
  const request: ClipExportRequest = {
    mediaId: 'proxy',
    revision: 2,
    startMs: 350,
    endMs: 1750,
    frame: 'edited',
    shape: 'vertical',
    container: 'webm',
    addToLibrary: false,
  };
  const result = editedClipSource(request, {
    mediaDir: fixture.dir,
    sourceId: () => 'source',
    row: (id) => fixture.media.about(id),
    read: () => edit,
    plan,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.source).toMatchObject({ mediaId: 'source', path: fixture.source, outputLengthMs: 700 });
  edit.recipe.speed = 1;
  const args = result.source.args?.(fixture.info, 'placeholder output.webm');
  expect(plan).toHaveBeenCalledOnce();
  expect(plan.mock.calls[0]?.[0]).toMatchObject({
    file: fixture.source,
    recipe: { speed: 2, noiseReduction: true, audioTrack: 1 },
    range: { startMs: 350, endMs: 1750 },
    frame: '9:16',
    fit: 'cover',
  });
  expect(args).toContain('libvpx-vp9');
  expect(args).not.toContain('-movflags');
  expect(args?.[args.indexOf('-filter_complex') + 1]).toContain('scale=1080:1920');
  expect(args?.slice(-2)).toEqual(['webm', 'placeholder output.webm']);
  expect(result.source.identity.length).toBeLessThanOrEqual(512);
  const unknownDuration = editedClipSource(request, {
    mediaDir: fixture.dir,
    sourceId: () => 'source',
    read: () => edit,
    plan,
    row: (id) => {
      const row = fixture.media.about(id);
      return row ? { ...row, durationMs: null } : null;
    },
  });
  expect(unknownDuration).toMatchObject({ ok: true, source: { durationMs: null } });
});

it('renders the real S2 picture and speed once from the original into a WebM clip', async () => {
  const fixture = await copyFixture();
  const recipe = structuredClone(PLAIN_VIDEO_EDIT);
  recipe.speed = 2;
  recipe.picture.brightness = -0.25;
  const edit: VideoEditSnapshot = {
    mediaId: 'source',
    revision: 2,
    state: 'ready',
    readyMediaId: 'prepared',
    message: null,
    recipe,
  };
  const request: ClipExportRequest = {
    mediaId: 'source',
    revision: 2,
    startMs: 350,
    endMs: 1750,
    frame: 'edited',
    shape: 'source',
    container: 'webm',
    addToLibrary: false,
  };
  const output = join(fixture.dir, 'placeholder edited.webm');
  const clips = new ClipExports({
    conversions: fixture.conversions,
    resolve: (request) =>
      editedClipSource(request, {
        mediaDir: fixture.dir,
        sourceId: (id) => id,
        row: (id) => fixture.media.about(id),
        read: () => edit,
        plan: editPlan,
      }),
    current: () => true,
    pickDest: () => Promise.resolve(output),
    kept: { load: () => [], save: () => undefined },
    prepareImport: () => Promise.resolve('unused'),
    publishImport: () => Promise.resolve(false),
    discardUnlisted: () => Promise.resolve(0),
    quiet: () => true,
    left: { load: () => [], save: () => undefined },
    leftFrom: () => 0,
  });
  close = () => {
    clips.close();
    fixture.cleanup();
  };
  expect((await clips.start(request)).ok).toBe(true);
  await vi.waitFor(
    () => {
      const job = clips.list()[0];
      if (job?.state === 'failed') throw new Error(job.message ?? 'The edited export failed.');
      expect(job?.state).toBe('done');
    },
    { timeout: 10_000 },
  );
  const info = await readTrimInfo(copyFfmpeg, output);
  expect(info.video).toMatchObject({ codec: 'vp9', width: 160, height: 90 });
  expect(Math.abs((info.durationMs ?? 0) - 700)).toBeLessThanOrEqual(80);
  const pixels = (file: string, at: string) =>
    copyFf([
      '-ss',
      at,
      '-i',
      file,
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
  const original = pixels(fixture.source, '0.350');
  const actual = pixels(output, '0');
  expect(actual.length).toBe(original.length);
  const error =
    original.reduce((total, value, index) => total + Math.abs(value * 0.75 - (actual[index] ?? 0)), 0) /
    original.length;
  expect(error).toBeLessThan(6);
  expect((await sha256File(fixture.source)).sha256).toBe(fixture.sha);
  expect(fixture.maxActive()).toBe(1);
}, 15_000);
