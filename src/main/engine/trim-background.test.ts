import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { rowVideoLive } from '../../shared/engine/state';
import type { MediaMarkers } from '../../shared/markers';
import { savedFrom, toRestore } from '../recovery/live-state';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';

function fixture() {
  const source = makeSource();
  source.set('words', [textSlide('slide', 'Placeholder words')], []);
  const playlists = new MemoryPlaylistSource();
  playlists.set('show', [
    {
      id: 'reset',
      kind: 'media',
      mediaId: 'video',
      media: 'video',
      label: 'Placeholder clip',
      whenEnds: 'freeze',
    },
    { id: 'words-row', kind: 'presentation', presentationId: 'words', arrangementId: undefined },
  ]);
  const markers: MediaMarkers = { startMs: 2000, endMs: 6000, markers: [] };
  const engine = () =>
    new ShowEngine(source, new RecordingTransport(), () => 1000, playlists, {
      mediaMarkers: (id, itemId) =>
        id !== 'video' ? null : itemId === 'reset' ? { ...markers, startMs: null, endMs: null } : markers,
    });
  const play = (engine: ShowEngine, itemId: string) =>
    engine.dispatch({ type: 'playItem', playlistId: 'show', itemId });
  return { engine, play, markers };
}

it('refreshes a retained background using its video row after LIVE moves to a slide', () => {
  const x = fixture();
  const engine = x.engine();
  expect(x.play(engine, 'reset').ok).toBe(true);
  expect(engine.current.layers.background).not.toHaveProperty('clip');
  expect(x.play(engine, 'words-row').ok).toBe(true);
  expect(engine.current.live.playlist?.itemId).toBe('words-row');
  x.markers.markers.push({ id: 'cue', name: 'Placeholder cue', atMs: 3000 });
  engine.refreshMarkers('video');
  expect(engine.current.layers.background).toMatchObject({ sourceItemId: 'reset', marks: x.markers.markers });
  expect(engine.current.layers.background).not.toHaveProperty('clip');
});

it('uses the file’s points when a video is chosen directly over a reset row', () => {
  const x = fixture();
  const engine = x.engine();
  expect(x.play(engine, 'reset').ok).toBe(true);
  engine.dispatch({
    type: 'setBackground',
    background: { kind: 'media', mediaId: 'video', media: 'video', fit: 'fit', loop: false },
  });
  engine.refreshMarkers('video');
  expect(engine.current.layers.background).toMatchObject({
    sourceItemId: null,
    clip: { startMs: 2000, endMs: 6000 },
  });
});

it.each(['legacy', 'current'] as const)('restores the reset background from a %s save', (version) => {
  const x = fixture();
  const before = x.engine();
  expect(x.play(before, 'reset').ok).toBe(true);
  if (version === 'current') expect(x.play(before, 'words-row').ok).toBe(true);
  const saved = savedFrom(before.current, 'placeholder-run');
  const bg = saved.background;
  if (bg?.kind !== 'media') throw new Error('The background was not put up.');
  const { sourceItemId: _origin, ...legacy } = bg;

  const dir = mkdtempSync(join(tmpdir(), 'drashti-trim-background-'));
  try {
    const files = { state: join(dir, 'state.json'), cleanMark: join(dir, 'clean.json') };
    writeFileSync(files.state, JSON.stringify({ ...saved, background: version === 'legacy' ? legacy : bg }));
    const request = toRestore(files);
    if (!request) throw new Error('The saved show could not be read.');
    if (version === 'current') expect(request.background).toMatchObject({ sourceItemId: 'reset' });
    else expect(request.background).not.toHaveProperty('sourceItemId');
    const after = x.engine();
    expect(after.restore(request).background).toBe(true);
    expect(after.current.layers.background).not.toHaveProperty('clip');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('restores a save from before TR-6 with LIVE on the slide row exactly as before: the LIVE row’s points', () => {
  // Review LOW-7 of d487b875 (TM-9): a save with no sourceItemId falls back to the LIVE row, here the slide's, so the
  // reset row's video comes back between the file's points, as the code before TR-6 put it back.
  const x = fixture();
  const before = x.engine();
  expect(x.play(before, 'reset').ok).toBe(true);
  expect(x.play(before, 'words-row').ok).toBe(true);
  const saved = savedFrom(before.current, 'placeholder-run');
  const bg = saved.background;
  if (bg?.kind !== 'media') throw new Error('The background was not put up.');
  expect(bg).toMatchObject({ sourceItemId: 'reset' });
  const { sourceItemId: _origin, ...legacy } = bg;

  const dir = mkdtempSync(join(tmpdir(), 'drashti-trim-background-'));
  try {
    const files = { state: join(dir, 'state.json'), cleanMark: join(dir, 'clean.json') };
    writeFileSync(files.state, JSON.stringify({ ...saved, background: legacy }));
    const request = toRestore(files);
    if (!request) throw new Error('The saved show could not be read.');
    expect(request.playlist).toMatchObject({ itemId: 'words-row' });
    expect(request.background).not.toHaveProperty('sourceItemId');
    const after = x.engine();
    expect(after.restore(request).background).toBe(true);
    expect(after.current.layers.background).toMatchObject({
      mediaId: 'video',
      sourceItemId: 'words-row',
      clip: { startMs: x.markers.startMs, endMs: x.markers.endMs },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('counts a row’s video as live from its row, or while that row is LIVE and the same video is chosen again', () => {
  const x = fixture();
  const engine = x.engine();
  expect(x.play(engine, 'reset').ok).toBe(true);
  expect(rowVideoLive(engine.current, 'reset', 'video')).toBe(true);
  expect(rowVideoLive(engine.current, 'reset', 'another video')).toBe(false);
  // Chosen again straight from Media: the same file carries on, with no row of its own.
  engine.dispatch({
    type: 'setBackground',
    background: { kind: 'media', mediaId: 'video', media: 'video', fit: 'fit', loop: false },
  });
  expect(engine.current.layers.background).toMatchObject({ mediaId: 'video', sourceItemId: null });
  expect(rowVideoLive(engine.current, 'reset', 'video')).toBe(true);

  // Left under another row's slide, the video is still its own row's.
  const under = x.engine();
  expect(x.play(under, 'reset').ok).toBe(true);
  expect(x.play(under, 'words-row').ok).toBe(true);
  expect(rowVideoLive(under.current, 'reset', 'video')).toBe(true);
  under.dispatch({ type: 'clearAll' });
  expect(rowVideoLive(under.current, 'reset', 'video')).toBe(false);
});
