import { expect, it } from 'vitest';
import { ShowEngine } from './show-engine';
import { MemoryPlaylistSource } from './playlist-source';
import { makeSource, RecordingTransport } from './testing';

/*
 * a22-review-x86 S1: a playlist's automatic crossfade whose cue waits on a page that is gone (the stream's sound page
 * at its sixth crash, with no successor to join) goes at its moment once Main works the cue's pages out again
 * (videoCuePageJoined(''), which index.ts now asks whenever the stream's sound or picture page goes). Until then it
 * waited for ever, and the hall's next video with it.
 */
it('an automatic cue waiting on a page that went away goes at its moment once its pages are worked out again', () => {
  let now = 10_000;
  let participants = ['picture:1', 'sound:2', 'sound:3'];
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
      crossfadeMs: () => 2000,
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
  engine.dispatch({ type: 'playItem', playlistId: 'pl', itemId: 'a' });
  const cue = engine.current.videoCue;
  if (!cue) throw new Error('No automatic cue for the next row');
  expect(cue.required).toEqual(['picture:1', 'sound:2', 'sound:3']);
  // The hall's pictures and the hall's sound say ready; the stream's sound page (sound:3) dies before it can.
  engine.reportVideoCue(cue.id, 'picture:1', true);
  engine.reportVideoCue(cue.id, 'sound:2', true);
  participants = ['picture:1', 'sound:2'];
  advance(15_380);
  expect(engine.current.videoCrossfade, 'it waits on the page that is gone').toBeFalsy();
  // Main says a page went: the cue's pages are worked out again, and the crossfade goes.
  engine.videoCuePageJoined('');
  advance(30_000);
  expect(engine.current.live.playlist?.itemId, 'the next row is on').toBe('b');
});
