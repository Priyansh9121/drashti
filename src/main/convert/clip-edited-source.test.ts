import { afterEach, expect, it, vi } from 'vitest';
import { PLAIN_VIDEO_EDIT, type VideoEditSnapshot } from '../../shared/video-edit';
import type { ClipExportRequest } from '../../shared/video-copies';
import { copyFixture } from './video-copy-fixtures';
import { editedClipSource, type EditedClipPlanner } from './clip-edited-source';
let fixture: Awaited<ReturnType<typeof copyFixture>>;
afterEach(() => fixture?.cleanup());
it('captures the saved recipe and full-quality source, then uses the supplied S2 planner exactly once', async () => {
  fixture = await copyFixture();
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
});
