import { expect, it } from 'vitest';
import { playbackAtMs } from '../../shared/media';
import { videoCueReady, videoFadeProgress } from '../../shared/video-cue';
import { savedFrom } from '../recovery/live-state';
import { ShowEngine } from './show-engine';
import { MemoryPlaylistSource } from './playlist-source';
import { makeSource, RecordingTransport } from './testing';

function setup(crossfadeMs = 2000) {
  let now = 10_000;
  let participants = ['hall', 'audio'];
  const waits: { at: number; run: () => void; canceled: boolean }[] = [];
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
    () => now,
    {
      items: (id) => lists.items(id),
      repeatAll: (id) => lists.repeatAll(id),
      crossfadeMs: () => crossfadeMs,
    },
    {
      mediaKind: () => 'video',
      mediaLength: () => 10_000,
      mediaMarkers: () => ({ startMs: 500, endMs: 8000, markers: [] }),
      videoCueParticipants: () => participants,
      schedule: (ms, run) => {
        const job = { at: now + ms, run, canceled: false };
        waits.push(job);
        return () => {
          job.canceled = true;
        };
      },
    },
  );
  const advance = (to: number) => {
    for (let n = 0; n < 100; n++) {
      const job = waits.filter((j) => !j.canceled && j.at <= to).sort((a, b) => a.at - b.at)[0];
      if (!job) {
        now = to;
        return;
      }
      job.canceled = true;
      now = Math.max(now, job.at);
      job.run();
    }
    throw new Error('The engine repeatedly scheduled an already due transition');
  };
  const ready = () => {
    const cue = engine.current.videoCue;
    if (!cue) throw new Error('No cue');
    for (const p of participants) engine.reportVideoCue(cue.id, p, true);
  };
  const play = () => engine.dispatch({ type: 'playItem', playlistId: 'pl', itemId: 'a' });
  return {
    engine,
    lists,
    play,
    ready,
    advance,
    wakeEarly: () => {
      const job = waits.filter((j) => !j.canceled && j.at > now).sort((a, b) => a.at - b.at)[0];
      if (!job) throw new Error('No completion timer to wake early');
      job.canceled = true;
      job.run();
    },
    addPage: () => {
      participants = [...participants, 'new-page'];
      engine.videoCuePageJoined('new-page');
    },
  };
}

it('prepares the next row silently and uses one exact overlap moment, then releases the outgoing showing', () => {
  const x = setup();
  x.play();
  expect(x.engine.current.videoCue?.playlist?.itemId).toBe('b');
  expect(x.engine.current.live.playlist?.itemId).toBe('a');
  x.ready();
  x.advance(15_380);
  const pair = x.engine.current.videoCrossfade;
  expect(pair).toMatchObject({ at: 15_500, durationMs: 2000 });
  if (!pair) throw new Error('No overlap');
  expect(videoFadeProgress(pair, 16_000)).toBe(0.25);
  expect(playbackAtMs(pair.from, 10_000, 16_000)).toBe(6500);
  const incoming = x.engine.current.layers.background;
  if (incoming?.kind !== 'media') throw new Error('No incoming showing');
  expect(playbackAtMs(incoming, 10_000, 16_000)).toBe(1000);
  x.advance(17_500);
  expect(x.engine.current.videoCrossfade).toBeNull();
  expect(x.engine.current.live.playlist?.itemId).toBe('b');
});

it('sends an automatic crossfade’s Go a second before its moment, its moment unchanged (QA23-FADE-9)', () => {
  // The owner, QA23-FADE-9 QFP-4: "Start it early, unheard (Rec.)". On CI's two-core Windows the stream's sound page
  // did nothing for 0.77 s from a fade's start, so a Go that reached it one Go lead (120 ms) ahead started the incoming
  // sound 0.44 s late. A second ahead, each page starts it before that, behind its lead, heard from the moment itself.
  const x = setup();
  x.play();
  x.ready();
  x.advance(14_499);
  expect(x.engine.current.videoCrossfade, 'not yet, more than a second before').toBeFalsy();
  x.advance(14_500);
  expect(x.engine.current.videoCrossfade).toMatchObject({ at: 15_500, durationMs: 2000 });
  const incoming = x.engine.current.layers.background;
  expect(incoming?.kind === 'media' ? incoming.seek : null).toEqual({ at: 15_500, toMs: 500 });
});

it('a cue ready under a second before its automatic crossfade goes at once, at the playlist’s own moment, never later', () => {
  const x = setup();
  x.play();
  x.advance(15_200);
  x.ready();
  x.advance(15_200);
  expect(x.engine.current.videoCrossfade).toMatchObject({ at: 15_500, durationMs: 2000 });
});

it('holds on the current video when the next first frame failed, with no cut or black fallback', () => {
  const x = setup();
  x.play();
  const cue = x.engine.current.videoCue;
  if (!cue) throw new Error('No cue');
  x.engine.reportVideoCue(cue.id, 'hall', false);
  x.advance(25_000);
  expect(x.engine.current.live.playlist?.itemId).toBe('a');
  expect(x.engine.current.videoCue?.error).toBeTruthy();
});

it('Pause and Play hold and reanchor both source clocks and the same curve', () => {
  const x = setup();
  x.play();
  x.ready();
  x.advance(16_000);
  x.engine.dispatch({ type: 'pausePlaying', playing: { layer: 'background' } });
  x.advance(19_000);
  const held = x.engine.current.videoCrossfade;
  if (!held) throw new Error('No held overlap');
  expect(videoFadeProgress(held, 19_000)).toBe(0.25);
  expect(held.from.seek).toEqual({ at: 16_000, toMs: 6500, paused: true });
  x.engine.dispatch({ type: 'resumePlaying', playing: { layer: 'background' } });
  const resumed = x.engine.current.videoCrossfade;
  if (!resumed) throw new Error('No resumed overlap');
  expect(resumed.at).toBe(18_500);
  expect(videoFadeProgress(resumed, 19_000)).toBe(0.25);
  x.advance(20_500);
  expect(x.engine.current.videoCrossfade).toBeNull();
});

it('an early Next uses the prepared pair at once, never a third decoder', () => {
  const x = setup();
  x.play();
  x.ready();
  x.advance(11_000);
  x.engine.dispatch({ type: 'next' });
  expect(x.engine.current.videoCrossfade).toMatchObject({ at: 11_120, durationMs: 2000 });
  expect(x.engine.current.videoCue).toBeNull();
  expect(x.engine.dispatch({ type: 'cueVideo', mediaId: 'first' }).ok).toBe(false);
});

it('Cancel holds this showing through its end until an explicit Next', () => {
  const x = setup();
  x.play();
  x.ready();
  x.engine.dispatch({ type: 'cancelVideoCue' });
  x.advance(25_000);
  expect(x.engine.current.videoCue).toBeNull();
  expect(x.engine.current.live.playlist?.itemId).toBe('a');
  x.engine.dispatch({ type: 'next' });
  expect(x.engine.current.live.playlist?.itemId).toBe('b');
});

it('a newly opened page or reload needs its own fresh first-frame acknowledgement', () => {
  const x = setup();
  x.play();
  x.ready();
  x.addPage();
  const cue = x.engine.current.videoCue;
  if (!cue) throw new Error('No cue');
  expect(videoCueReady(cue)).toBe(false);
  expect(x.engine.dispatch({ type: 'goVideoCue', cueId: cue.id }).ok).toBe(false);
  x.ready();
  expect(videoCueReady(x.engine.current.videoCue ?? cue)).toBe(true);
  x.engine.videoCuePageJoined('hall');
  expect(videoCueReady(x.engine.current.videoCue ?? cue)).toBe(false);
});

it('a same-file cue has a distinct decoder identity from the video already playing', () => {
  const x = setup(0);
  x.play();
  const live = x.engine.current.layers.background;
  x.engine.dispatch({ type: 'cueVideo', mediaId: 'first' });
  expect(x.engine.current.videoCue?.background.startedAt).not.toBe(
    live?.kind === 'media' ? live.startedAt : 0,
  );
});

it('recovery brings a manual cue back paused with new participant identities and pins its points', () => {
  const x = setup();
  x.engine.dispatch({ type: 'cueVideo', mediaId: 'second' });
  x.ready();
  const before = x.engine.current.videoCue;
  const saved = savedFrom(x.engine.current, 'placeholder-run', new Date(10_000));
  const next = setup();
  next.advance(20_000);
  next.engine.restore(saved);
  const cue = next.engine.current.videoCue;
  expect(cue?.id).not.toBe(before?.id);
  expect(cue?.ready).toEqual([]);
  expect(cue?.background.seek).toEqual({ at: 20_000, toMs: 500, paused: true });
  expect(next.engine.current.layers.background).toBeNull();
});

it('takes a failed outgoing showing off with its sound while the playable incoming video carries on', () => {
  const x = setup();
  x.play();
  x.ready();
  x.advance(16_000);
  expect(x.engine.cannotPlay('first')).toEqual({ background: true, slide: false, box: false });
  expect(x.engine.current.videoCrossfade).toBeNull();
  expect(x.engine.current.layers.background).toMatchObject({ mediaId: 'second' });
});

it('takes an outgoing video with no picture off without removing the incoming showing', () => {
  const x = setup();
  x.play();
  x.ready();
  x.advance(16_000);
  expect(x.engine.noPicture('first')).toBe(true);
  expect(x.engine.current.videoCrossfade).toBeNull();
  expect(x.engine.current.layers.background).toMatchObject({ mediaId: 'second' });
});

it('Go on an automatic crossfade cue keeps the playlist blend instead of cutting', () => {
  const x = setup();
  x.play();
  x.ready();
  x.advance(11_000);
  const cue = x.engine.current.videoCue;
  if (!cue) throw new Error('No automatic cue');
  x.engine.dispatch({ type: 'goVideoCue', cueId: cue.id });
  expect(x.engine.current.videoCrossfade).toMatchObject({ at: 11_120, durationMs: 2000 });
});

it('rearms a completion timer that wakes early instead of leaving an ended pair in the engine', () => {
  const x = setup();
  x.play();
  x.ready();
  x.advance(17_499);
  expect(x.engine.current.videoCrossfade).toBeTruthy();
  x.wakeEarly();
  expect(x.engine.current.videoCrossfade, 'it must not finish before the shared end').toBeTruthy();
  x.advance(17_500);
  expect(
    x.engine.current.videoCrossfade,
    'it must release at the end even after an early callback',
  ).toBeNull();
});

it('keeps the future Go marker until its engine moment when the start timer wakes early', () => {
  const x = setup();
  x.play();
  x.ready();
  x.advance(15_499);
  expect(x.engine.current.videoStart?.at).toBe(15_500);
  x.wakeEarly();
  expect(x.engine.current.videoStart?.at, 'a timer cannot clear the old-scene hold before Go').toBe(15_500);
  x.advance(15_500);
  expect(x.engine.current.videoStart).toBeNull();
});
