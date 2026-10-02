import { describe, expect, it } from 'vitest';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import { MemorySlideSource } from './slide-source';
import { RecordingTransport, textSlide } from './testing';

/*
 * Auto-advance in the engine: a slide that says so moves on by itself in
 * play order, loops at the end when its presentation does (never on into
 * the next playlist item), and anything that puts another slide up starts
 * that slide's own count. Black-out and the logo leave it be.
 */

function setup(options: { loop?: boolean; times?: (number | null)[] } = {}) {
  const source = new MemorySlideSource();
  source.set('p', [textSlide('a', 'One'), textSlide('b', 'Two'), textSlide('c', 'Three')], [], {
    autoAdvance: options.times ?? [4000, 5000, 6000],
    loop: options.loop ?? false,
  });
  source.set('q', [textSlide('x', 'Next item')]);
  let clock = 100_000;
  const waiting: { delay: number; run: () => void; cancelled: boolean }[] = [];
  const playlists = new MemoryPlaylistSource();
  playlists.set('list', [
    { id: 'i1', kind: 'presentation', presentationId: 'p', arrangementId: null },
    { id: 'i2', kind: 'presentation', presentationId: 'q', arrangementId: null },
  ]);
  const engine = new ShowEngine(source, new RecordingTransport(), () => clock, playlists, {
    schedule: (delay, run) => {
      const job = { delay, run, cancelled: false };
      waiting.push(job);
      return () => {
        job.cancelled = true;
      };
    },
  });
  /** Let time pass and run what came due (each wait once). */
  const elapse = (ms: number) => {
    clock += ms;
    for (const job of [...waiting]) {
      if (job.cancelled || job.delay > ms) continue;
      waiting.splice(waiting.indexOf(job), 1);
      job.run();
    }
  };
  const pending = () => waiting.filter((j) => !j.cancelled);
  return { engine, elapse, pending, now: () => clock, source };
}

const slideId = (e: ShowEngine) => e.current.layers.slide?.slide.id;

describe('auto-advance', () => {
  it('moves on in play order when the time is up, each slide counting its own time', () => {
    const { engine, elapse, now, pending } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p', slideIndex: 0 });
    expect(engine.current.autoAdvance).toEqual({ startedAt: now(), durationMs: 4000 });
    expect(pending().map((j) => j.delay)).toEqual([4000]);
    elapse(4000);
    expect(slideId(engine)).toBe('b');
    expect(engine.current.autoAdvance).toEqual({ startedAt: now(), durationMs: 5000 });
    elapse(5000);
    expect(slideId(engine)).toBe('c');
    // The last slide: nowhere to go, so no count (and nothing happens).
    expect(engine.current.autoAdvance).toBeNull();
    expect(pending()).toHaveLength(0);
  });

  it('loops from the last slide to the first when the presentation says so', () => {
    const { engine, elapse } = setup({ loop: true });
    engine.dispatch({ type: 'goLive', presentationId: 'p', slideIndex: 2 });
    expect(engine.current.autoAdvance?.durationMs).toBe(6000);
    elapse(6000);
    expect(slideId(engine)).toBe('a');
  });

  it('never goes on into the next playlist item', () => {
    const { engine, elapse } = setup();
    engine.dispatch({ type: 'playItem', playlistId: 'list', itemId: 'i1' });
    elapse(4000);
    elapse(5000);
    expect(slideId(engine)).toBe('c');
    expect(engine.current.autoAdvance).toBeNull();
    elapse(60_000);
    expect(slideId(engine)).toBe('c');
  });

  it('starts again when the operator puts another slide up, and stops when the slide comes down', () => {
    const { engine, elapse, now, pending } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p', slideIndex: 0 });
    elapse(3000);
    engine.dispatch({ type: 'next' });
    // The old wait is cancelled; the new slide counts from now.
    expect(engine.current.autoAdvance).toEqual({ startedAt: now(), durationMs: 5000 });
    expect(pending().map((j) => j.delay)).toEqual([5000]);
    engine.dispatch({ type: 'clearLayer', layer: 'slide' });
    expect(engine.current.autoAdvance).toBeNull();
    expect(pending()).toHaveLength(0);
    // Put it back: the slide is up again, and counts afresh.
    engine.dispatch({ type: 'goLive', presentationId: 'p', slideIndex: 1 });
    engine.dispatch({ type: 'clearAll' });
    engine.dispatch({ type: 'putBack' });
    expect(engine.current.autoAdvance).toEqual({ startedAt: now(), durationMs: 5000 });
  });

  it('carries on through black-out and the logo', () => {
    const { engine, elapse } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p', slideIndex: 0 });
    const count = engine.current.autoAdvance;
    engine.dispatch({ type: 'setBlackout', on: true });
    engine.dispatch({ type: 'showLogo', prop: { id: 'logo', name: 'Placeholder logo', elements: [] } });
    expect(engine.current.autoAdvance).toEqual(count);
    elapse(4000);
    expect(slideId(engine)).toBe('b');
    expect(engine.current.blackout).toBe(true);
  });

  it('keeps its start when the slide on the screens is edited, with the new time', () => {
    const { engine, elapse, source } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p', slideIndex: 0 });
    const started = engine.current.autoAdvance?.startedAt;
    elapse(1000);
    source.set('p', [textSlide('a', 'One, edited'), textSlide('b', 'Two'), textSlide('c', 'Three')], [], {
      autoAdvance: [9000, 5000, 6000],
    });
    engine.refreshLive('p');
    expect(engine.current.autoAdvance).toEqual({ startedAt: started, durationMs: 9000 });
  });

  it('counts from the very moment its slide went up, however the clock moves while it does', () => {
    const source = new MemorySlideSource();
    source.set('p', [textSlide('a', 'One'), textSlide('b', 'Two'), textSlide('c', 'Three')], [], {
      autoAdvance: [4000, 5000, 6000],
    });
    // A clock that moves on a millisecond every time anything reads it.
    let clock = 100_000;
    const transport = new RecordingTransport();
    const engine = new ShowEngine(source, transport, () => clock++, undefined, {
      schedule: () => () => undefined,
    });
    const sentAt = () => {
      const last = transport.last;
      return last?.kind === 'patch' ? last.sentAt : null;
    };
    engine.dispatch({ type: 'goLive', presentationId: 'p', slideIndex: 0 });
    const first = engine.current;
    expect(first.autoAdvance?.startedAt).toBe(first.layers.slide?.shownAt);
    engine.dispatch({ type: 'next' });
    const shownAt = engine.current.layers.slide?.shownAt;
    expect(engine.current.autoAdvance?.startedAt).toBe(shownAt);
    expect(shownAt).toBe(sentAt());
    // Put it back brings the slide back as it was (its videos carry on), but its count starts afresh.
    engine.dispatch({ type: 'clearAll' });
    clock += 30_000;
    engine.dispatch({ type: 'putBack' });
    expect(engine.current.layers.slide?.shownAt).toBe(shownAt);
    expect(engine.current.autoAdvance).toEqual({ startedAt: sentAt(), durationMs: 5000 });
    expect(engine.current.autoAdvance?.startedAt).toBeGreaterThan((shownAt ?? 0) + 30_000);
  });

  it('carries on after a restart with the time it had left', () => {
    const { engine, now, pending } = setup();
    engine.restore({
      slide: { presentationId: 'p', slideIndex: 0 },
      background: null,
      blackout: false,
      autoAdvance: { leftMs: 1500, durationMs: 4000 },
    });
    expect(engine.current.autoAdvance).toEqual({ startedAt: now() - 2500, durationMs: 4000 });
    expect(pending().map((j) => j.delay)).toEqual([1500]);
  });
});
