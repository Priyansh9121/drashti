import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState } from '../../shared/engine/state';
import { type SnapshotDeps, snapshotName, takeSnapshot } from './snapshot';

/*
 * Snapshot (alpha.20, the time bar's ⋯): the frame the screens show, from the video's own file, named for its place,
 * into Media through the import; why not, in words. FFmpeg and the import are stand-ins here (the e2e has the real
 * ones). Placeholder names.
 */

function paused(atMs: number, durationMs: number | null = 5000): EngineState {
  const state = initialEngineState();
  return {
    ...state,
    layers: {
      ...state.layers,
      background: {
        kind: 'media',
        mediaId: 'v',
        media: 'video',
        fit: 'fit',
        loop: false,
        startedAt: 0,
        ...(durationMs === null ? {} : { durationMs }),
        seek: { at: 1000, toMs: atMs, paused: true },
      },
    },
  };
}

function deps(state: EngineState, over: Partial<SnapshotDeps> = {}) {
  const written: { file: string; atMs: number; out: string }[] = [];
  const imported: string[] = [];
  const d: SnapshotDeps = {
    state: () => state,
    now: () => 9000,
    file: (id) => (id === 'v' ? { path: '/library/v.mp4', name: 'Placeholder colours.mp4' } : null),
    ffmpeg: () => '/bundled/ffmpeg',
    importFile: (path) => {
      imported.push(path);
      return Promise.resolve({ ok: true, mediaId: 'picture' });
    },
    frameAt: (_ffmpeg, _file, atMs) => Promise.resolve(Math.floor(atMs / 40) * 40),
    writeFrame: (_ffmpeg, file, atMs, out) => {
      written.push({ file, atMs, out });
      return Promise.resolve(true);
    },
    ...over,
  };
  return { d, written, imported };
}

describe('Snapshot', () => {
  it('names the picture for the video and its place', () => {
    expect(snapshotName('Placeholder colours.mp4', 3200)).toBe('Placeholder colours at 0m03s.png');
    expect(snapshotName('Placeholder talk.mov', 754_900)).toBe('Placeholder talk at 12m34s.png');
    expect(snapshotName('Placeholder katha.mkv', 3_723_000)).toBe('Placeholder katha at 1h02m03s.png');
  });

  it('makes the frame shown (the one starting at or before its place) from its file, into Media', async () => {
    const { d, written, imported } = deps(paused(3230));
    expect(await takeSnapshot(d, { layer: 'background' })).toEqual({
      ok: true,
      mediaId: 'picture',
      name: 'Placeholder colours at 0m03s.png',
    });
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ file: '/library/v.mp4', atMs: 3200 });
    expect(written[0]?.out.endsWith('Placeholder colours at 0m03s.png')).toBe(true);
    expect(imported).toEqual([written[0]?.out]);
  });

  it('says why not, in words', async () => {
    expect(await takeSnapshot(deps(initialEngineState()).d, { layer: 'background' })).toEqual({
      ok: false,
      message: 'That video is not playing any more: put it up, then take its snapshot.',
    });
    expect(await takeSnapshot(deps(paused(3200, null)).d, { layer: 'background' })).toMatchObject({
      ok: false,
      message: 'Its length is not known yet: try again in a moment, once it has started playing.',
    });
    expect(
      await takeSnapshot(deps(paused(3200), { file: () => null }).d, { layer: 'background' }),
    ).toMatchObject({
      ok: false,
      message: 'Its file is missing, so there is nothing to make a snapshot from.',
    });
    expect(
      await takeSnapshot(deps(paused(3200), { ffmpeg: () => null }).d, { layer: 'background' }),
    ).toMatchObject({
      ok: false,
      message: 'Drashti’s own FFmpeg is missing, so it cannot make a snapshot: install Drashti again.',
    });
    const broken = deps(paused(3200), { writeFrame: () => Promise.resolve(false) });
    expect(await takeSnapshot(broken.d, { layer: 'background' })).toMatchObject({ ok: false });
    expect(broken.imported).toEqual([]);
    const refused = deps(paused(3200), {
      importFile: () => Promise.resolve({ ok: false, message: 'Placeholder import refusal.' }),
    });
    expect(await takeSnapshot(refused.d, { layer: 'background' })).toEqual({
      ok: false,
      message: 'Placeholder import refusal.',
    });
  });
});
