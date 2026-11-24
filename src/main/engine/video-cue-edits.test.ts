import { expect, it } from 'vitest';
import type { EngineState } from '../../shared/engine/state';
import { PLAIN_VIDEO_EDIT } from '../../shared/video-edit';
import { ShowEngine } from './show-engine';
import { MemoryPlaylistSource } from './playlist-source';
import { makeSource, RecordingTransport } from './testing';
import { prepareVideoEdits } from './video-edit-ready';
import { prepareVideoProxies } from '../convert/proxy-showing';

it('Cue refuses a preparing saved edit before loading an unedited private frame and preserves LIVE', () => {
  const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => 1000, undefined, {
    mediaKind: () => 'video',
    prepareVideoEdits: (previous, next, historic) =>
      prepareVideoEdits(
        previous,
        next,
        (id) =>
          id === 'second'
            ? {
                mediaId: id,
                revision: 1,
                recipe: { ...PLAIN_VIDEO_EDIT, speed: 2 },
                state: 'preparing',
                readyMediaId: null,
                message: null,
              }
            : null,
        historic,
      ),
  });
  engine.dispatch({ type: 'setBackground', background: { kind: 'color', color: '#205020' } });
  const live = engine.current.layers;
  expect(engine.dispatch({ type: 'cueVideo', mediaId: 'second' })).toMatchObject({
    ok: false,
    error: 'preparing',
  });
  expect(engine.current.videoCue).toBeFalsy();
  expect(engine.current.layers).toBe(live);
});

it('Cue pins the resolved copy once, caps overlap using its output time, and Go accepts its source row', () => {
  const lists = new MemoryPlaylistSource();
  lists.set('pl', [
    {
      id: 'a',
      kind: 'media',
      mediaId: 'first',
      media: 'video',
      label: 'Placeholder first',
      whenEnds: 'next',
    },
    {
      id: 'b',
      kind: 'media',
      mediaId: 'second',
      media: 'video',
      label: 'Placeholder second',
      whenEnds: 'freeze',
    },
  ]);
  const options = {
    schedule: () => () => undefined,
    mediaKind: () => 'video' as const,
    mediaLength: () => 10_000,
    mediaMarkers: () => ({ startMs: 500, endMs: 8000, markers: [] }),
    sourceMediaId: (id: string) => (id === 'edited-second' ? 'second' : id),
    prepareVideoEdits: (_previous: EngineState, next: EngineState) => {
      const bg = next.layers.background;
      if (bg?.kind !== 'media' || bg.media !== 'video' || bg.mediaId !== 'second') return { state: next };
      return {
        state: {
          ...next,
          layers: {
            ...next.layers,
            background: {
              ...bg,
              mediaId: 'edited-second',
              durationMs: 4000,
              clip: { startMs: 250, endMs: 3000 },
              seek: { at: bg.seek?.at ?? 1000, toMs: 250, ...(bg.seek?.paused ? { paused: true } : {}) },
            },
          },
        },
      };
    },
  };
  const engine = new ShowEngine(
    makeSource(),
    new RecordingTransport(),
    () => 1000,
    {
      items: (id) => lists.items(id),
      crossfadeMs: () => 2000,
    },
    options,
  );
  engine.dispatch({ type: 'playItem', playlistId: 'pl', itemId: 'a' });
  const cue = engine.current.videoCue;
  expect(cue?.background.mediaId).toBe('edited-second');
  expect(cue?.background.seek).toMatchObject({ toMs: 250, paused: true });
  expect(cue?.automatic?.durationMs).toBe(1375);
  if (!cue) throw new Error('No resolved cue');
  engine.videoCuePageJoined('');
  expect(engine.current.videoCue?.id).toBe(cue.id);
  expect(engine.dispatch({ type: 'goVideoCue', cueId: cue.id })).toMatchObject({ ok: true });
  expect(engine.current.layers.background).toMatchObject({
    mediaId: 'edited-second',
    startedAt: cue.background.startedAt,
    // Go on a ready automatic crossfade blends a second after the press (QA23-FADE-9 QFP-5, the owner: "Blend 1 s after
    // the press (Rec.)"; was one Go lead, 1,120).
    seek: { at: 2000, toMs: 250 },
  });
  expect(engine.current.videoCrossfade?.durationMs).toBe(1375);
});

it('keeps a preparing automatic edit visibly unavailable and holds the current video without a source fallback', () => {
  const lists = new MemoryPlaylistSource();
  lists.set('pl', [
    {
      id: 'a',
      kind: 'media',
      mediaId: 'first',
      media: 'video',
      label: 'Placeholder first',
      whenEnds: 'next',
    },
    {
      id: 'b',
      kind: 'media',
      mediaId: 'second',
      media: 'video',
      label: 'Placeholder second',
      whenEnds: 'freeze',
    },
  ]);
  const engine = new ShowEngine(
    makeSource(),
    new RecordingTransport(),
    () => 1000,
    {
      items: (id) => lists.items(id),
      crossfadeMs: () => 2000,
    },
    {
      schedule: () => () => undefined,
      mediaKind: () => 'video',
      mediaLength: () => 10_000,
      prepareVideoEdits: (previous, next, historic) =>
        prepareVideoEdits(
          previous,
          next,
          (id) =>
            id === 'second'
              ? {
                  mediaId: id,
                  revision: 1,
                  recipe: { ...PLAIN_VIDEO_EDIT, speed: 2 },
                  state: 'preparing',
                  readyMediaId: null,
                  message: null,
                }
              : null,
          historic,
        ),
    },
  );
  engine.dispatch({ type: 'playItem', playlistId: 'pl', itemId: 'a' });
  expect(engine.current.videoCue?.error).toContain('preparing');
  const cue = engine.current.videoCue;
  if (!cue) throw new Error('No visible preparing reason');
  expect(engine.dispatch({ type: 'goVideoCue', cueId: cue.id })).toMatchObject({ ok: false });
  expect(engine.current.layers.background).toMatchObject({ mediaId: 'first' });
});

it('repeated Cue readiness through Main’s edit and lighter-copy hooks sends no new state while LIVE video continues', () => {
  const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => 1000, undefined, {
    schedule: () => () => undefined,
    mediaKind: () => 'video',
    mediaLength: () => 10_000,
    videoCueParticipants: () => ['hall'],
    prepareVideoEdits: (previous, next, historic) => {
      const edited = prepareVideoEdits(previous, next, () => null, historic);
      return edited.state
        ? prepareVideoProxies(previous, edited.state, (id) => ({ mediaId: id, message: null }), historic)
        : edited;
    },
  });
  engine.dispatch({
    type: 'setBackground',
    background: { kind: 'media', mediaId: 'first', media: 'video', fit: 'fit', loop: true },
  });
  engine.dispatch({ type: 'cueVideo', mediaId: 'second' });
  const cue = engine.current.videoCue;
  if (!cue) throw new Error('No private cue');
  expect(engine.reportVideoCue(cue.id, 'hall', true)).toMatchObject({ ok: true, changed: true });
  const before = engine.current;
  const revision = engine.rev;
  let broadcasts = 0;
  const stop = engine.onChange(() => broadcasts++);
  try {
    for (let n = 0; n < 3; n++) engine.reportVideoCue(cue.id, 'hall', true);
    expect(broadcasts, 'a renderer re-acknowledging its loaded frame must not sustain an IPC loop').toBe(0);
    expect(engine.rev).toBe(revision);
    expect(engine.current).toBe(before);
    expect(engine.current.layers.background).toMatchObject({ mediaId: 'first' });
  } finally {
    stop();
  }
});
