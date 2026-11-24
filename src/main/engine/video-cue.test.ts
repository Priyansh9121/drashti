import { describe, expect, it } from 'vitest';
import {
  goOnStreamFrame,
  VIDEO_GO_LEAD_MS,
  videoCueReady,
  videoFadeProgress,
  type VideoCrossfade,
} from '../../shared/video-cue';
import { ShowEngine } from './show-engine';
import { MemoryPlaylistSource } from './playlist-source';
import { makeSource, RecordingTransport } from './testing';

function setup() {
  let now = 10_000;
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
  const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => now, lists, {
    schedule: () => () => undefined,
    mediaLength: () => 10_000,
    mediaKind: (id) => (id === 'missing' ? null : 'video'),
    mediaMarkers: () => ({ startMs: 500, endMs: 8000, markers: [] }),
    videoCueParticipants: () => ['hall', 'live', 'audio', 'stream'],
  });
  return {
    engine,
    lists,
    at: (t: number) => {
      now = t;
    },
  };
}

function prepare(engine: ShowEngine) {
  engine.dispatch({ type: 'cueVideo', mediaId: 'second', playlist: { playlistId: 'pl', itemId: 'b' } });
  const cue = engine.current.videoCue;
  expect(cue, 'Cue must publish a paused showing without replacing the live scene').toBeTruthy();
  if (!cue) throw new Error('No cued showing');
  return cue;
}

function ready(engine: ShowEngine, id: string) {
  for (const page of ['hall', 'live', 'audio', 'stream']) engine.reportVideoCue(id, page, true);
}

describe('S5 video cue in the show engine', () => {
  it('loads the first trimmed frame privately and keeps the live picture and sound', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'playItem', playlistId: 'pl', itemId: 'a' });
    const live = engine.current.layers;
    const cue = prepare(engine);
    expect(engine.current.layers).toBe(live);
    expect(cue.background.seek).toEqual({ at: 10_000, toMs: 500, paused: true });
    expect(cue.background.clip).toEqual({ startMs: 500, endMs: 8000 });
    expect(videoCueReady(cue)).toBe(false);
  });

  it('refuses Go until every required page has that showing, ignoring foreign and stale reports', () => {
    const { engine } = setup();
    const cue = prepare(engine);
    engine.reportVideoCue('old', 'hall', true);
    engine.reportVideoCue(cue.id, 'unknown', true);
    expect(engine.current.videoCue?.ready).toEqual([]);
    expect(engine.dispatch({ type: 'goVideoCue', cueId: cue.id }).ok).toBe(false);
    ready(engine, cue.id);
    const prepared = engine.current.videoCue;
    if (!prepared) throw new Error('No cue after readiness');
    expect(videoCueReady(prepared)).toBe(true);
  });

  it('Go reuses the prepared showing with one future engine moment', () => {
    const { engine, at } = setup();
    const cue = prepare(engine);
    ready(engine, cue.id);
    at(12_000);
    expect(engine.dispatch({ type: 'goVideoCue', cueId: cue.id }).ok).toBe(true);
    const bg = engine.current.layers.background;
    expect(bg?.kind).toBe('media');
    if (bg?.kind !== 'media') throw new Error('No video');
    expect(bg.startedAt).toBe(cue.background.startedAt);
    expect(bg.seek).toEqual({ at: 12_000 + VIDEO_GO_LEAD_MS, toMs: 500 });
    expect(engine.current.videoCue).toBeNull();
    expect(engine.current.live.playlist).toEqual({ playlistId: 'pl', itemId: 'b' });
  });

  it("Go is placed the margin before one of the stream's frames when the stream's page has told its grid", () => {
    const grid = { at: 11_990.5, periodMs: 1000 / 30 };
    let now = 10_000;
    const engine = new ShowEngine(
      makeSource(),
      new RecordingTransport(),
      () => now,
      new MemoryPlaylistSource(),
      {
        schedule: () => () => undefined,
        mediaLength: () => 10_000,
        mediaKind: () => 'video',
        mediaMarkers: () => ({ startMs: 500, endMs: 8000, markers: [] }),
        videoCueParticipants: () => ['hall', 'live', 'audio', 'stream'],
        videoGoFrames: () => grid,
      },
    );
    engine.dispatch({ type: 'cueVideo', mediaId: 'second' });
    const cue = engine.current.videoCue;
    if (!cue) throw new Error('No cue');
    ready(engine, cue.id);
    now = 12_000;
    expect(engine.dispatch({ type: 'goVideoCue', cueId: cue.id }).ok).toBe(true);
    const bg = engine.current.layers.background;
    if (bg?.kind !== 'media' || !bg.seek) throw new Error('No video');
    expect(bg.seek.at).toBe(goOnStreamFrame(12_000 + VIDEO_GO_LEAD_MS, grid));
    expect(bg.seek.at).not.toBe(12_000 + VIDEO_GO_LEAD_MS);
    expect(engine.current.videoStart?.at).toBe(bg.seek.at);
  });

  it('Cancel, Clear and a cover invalidate a future Go without changing what was cued into live', () => {
    for (const type of ['cancelVideoCue', 'clearAll', 'toggleBlackout'] as const) {
      const { engine } = setup();
      const cue = prepare(engine);
      ready(engine, cue.id);
      engine.dispatch({ type });
      expect(engine.current.videoCue).toBeNull();
      expect(engine.dispatch({ type: 'goVideoCue', cueId: cue.id }).ok).toBe(false);
    }
  });

  it('a failed cue stays unavailable while the live showing carries on', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'playItem', playlistId: 'pl', itemId: 'a' });
    const before = engine.current.layers;
    const cue = prepare(engine);
    engine.reportVideoCue(cue.id, 'hall', false);
    expect(engine.current.videoCue?.error).toBeTruthy();
    expect(engine.current.layers).toBe(before);
    ready(engine, cue.id);
    expect(engine.dispatch({ type: 'goVideoCue', cueId: cue.id }).ok).toBe(false);
  });

  it('refuses a missing video rather than making an empty ready cue', () => {
    const { engine } = setup();
    expect(engine.dispatch({ type: 'cueVideo', mediaId: 'missing' }).ok).toBe(false);
  });
});

describe('S5 engine-clock crossfade curve', () => {
  const fade: VideoCrossfade = {
    id: 'pair',
    from: { kind: 'media', mediaId: 'first', media: 'video', startedAt: 0, fit: 'fit', loop: false },
    at: 10_000,
    durationMs: 2000,
  };
  it('has complementary gains, exact endpoints and no discontinuity through its length', () => {
    expect([-1, 0, 250, 1000, 1750, 2000, 3000].map((t) => videoFadeProgress(fade, 10_000 + t))).toEqual([
      0, 0, 0.125, 0.5, 0.875, 1, 1,
    ]);
  });
  it('holds the same picture and sound curve while paused', () => {
    expect(videoFadeProgress({ ...fade, pausedAt: 10_500 }, 99_000)).toBe(0.25);
  });
});

it('repeated decoder readiness does not broadcast another revision or create a readiness feedback loop', () => {
  const { engine } = setup();
  const cue = prepare(engine);
  expect(engine.reportVideoCue(cue.id, 'hall', true)).toMatchObject({ ok: true, changed: true });
  const revision = engine.rev;
  expect(engine.reportVideoCue(cue.id, 'hall', true)).toMatchObject({ ok: true, changed: false });
  expect(engine.rev).toBe(revision);
  engine.reportVideoCue(cue.id, 'audio', false);
  const failedRevision = engine.rev;
  expect(engine.reportVideoCue(cue.id, 'audio', false)).toMatchObject({ ok: true, changed: false });
  expect(engine.rev).toBe(failedRevision);
});
