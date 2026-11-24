import { describe, expect, it } from 'vitest';
import { cueClock, fadeClock, type SilentGraph } from './cue-clock';

/*
 * A crossfade's playing picture on the page's silent graph (the owner's QA23-FADE-6, "Try B in parallel (Rec.)"):
 * taken in mid-play, only into a graph that already runs (its crossfade's cue keeps it running), never one started for
 * it (QA22-CUE-2: no output held while idle), never a picture the graph already pulls, and kept until it is let go.
 */

class Source {
  connected: unknown[] = [];
  connect(node: unknown): unknown {
    this.connected.push(node);
    return node;
  }
  disconnect(): void {
    this.connected = [];
  }
}

class Context extends EventTarget {
  state: AudioContextState = 'running';
  made: Source[] = [];
  suspended = 0;
  resumed = 0;
  /** As Chromium does, a rest asked may still say 'running' a moment (its device stops later). */
  slowRest = false;
  createMediaElementSource(): Source {
    const source = new Source();
    this.made.push(source);
    return source;
  }
  suspend(): Promise<void> {
    this.suspended++;
    if (!this.slowRest) {
      this.state = 'suspended';
      this.dispatchEvent(new Event('statechange'));
    }
    return Promise.resolve();
  }
  resume(): Promise<void> {
    this.resumed++;
    return Promise.resolve();
  }
}

class Element {
  muted = true;
  paused = false;
  playbackRate = 1;
  dataset: Record<string, string> = {};
  media(): HTMLMediaElement {
    return this as unknown as HTMLMediaElement;
  }
}

const sink = { name: 'silent sink' };
const graphOf = (context: Context): (() => SilentGraph) => {
  const graph = { context: context as unknown as AudioContext, sink: sink as unknown as AudioNode };
  return () => graph;
};

describe("a crossfade's playing picture on the page's silent graph", () => {
  it('is taken in mid-play into a graph that runs: its sound pulled there, unmuted only then, marked', () => {
    const context = new Context(),
      outgoing = new Element();
    const stop = fadeClock(outgoing.media(), graphOf(context));
    expect(stop, 'taken').not.toBeNull();
    expect(context.made).toHaveLength(1);
    expect(context.made[0]?.connected).toEqual([sink]);
    expect(outgoing.muted, 'its sound goes into the graph, nowhere else').toBe(false);
    expect(outgoing.dataset['cueClock']).toBe('fade');
    expect(context.resumed, 'a running graph is not asked to run').toBe(0);
    stop?.();
    expect(outgoing.muted).toBe(true);
    expect(outgoing.dataset['cueClock']).toBeUndefined();
    expect(context.made[0]?.connected).toEqual([]);
  });

  it('keeps the graph running while it is there, though its crossfade’s cued picture is let go first; rests after', () => {
    const context = new Context(),
      incoming = new Element(),
      outgoing = new Element();
    incoming.paused = true;
    incoming.playbackRate = 0;
    const unclock = cueClock(incoming.media(), graphOf(context));
    const stop = fadeClock(outgoing.media(), graphOf(context));
    unclock();
    expect(context.suspended, 'the outgoing picture still uses it').toBe(0);
    stop?.();
    expect(context.suspended, 'nothing uses it: it rests (no output held while idle)').toBe(1);
  });

  it('never starts a graph for itself: one that does not run, or is resting, or none, takes nothing', () => {
    const suspended = new Context();
    suspended.state = 'suspended';
    const picture = new Element();
    expect(fadeClock(picture.media(), graphOf(suspended))).toBeNull();
    expect(suspended.resumed, 'never asked to run').toBe(0);
    expect(suspended.made).toHaveLength(0);
    expect(picture.muted).toBe(true);
    // A cue let go just now: its graph asked to rest, still saying 'running' a moment.
    const resting = new Context();
    resting.slowRest = true;
    const cued = new Element();
    cued.paused = true;
    cued.playbackRate = 0;
    cueClock(cued.media(), graphOf(resting))();
    expect(resting.state).toBe('running');
    expect(fadeClock(picture.media(), graphOf(resting)), 'a resting graph').toBeNull();
    expect(resting.made, 'only the cue’s source').toHaveLength(1);
    expect(
      fadeClock(picture.media(), () => null),
      'no graph on this page',
    ).toBeNull();
    expect(picture.muted).toBe(true);
  });

  it('never takes a picture the graph already pulls (its own cue’s): one source, one route, its cue’s stop alone', () => {
    const context = new Context(),
      incoming = new Element();
    incoming.paused = true;
    incoming.playbackRate = 0;
    const unclock = cueClock(incoming.media(), graphOf(context));
    expect(incoming.dataset['cueClock']).toBe('graph');
    incoming.paused = false;
    incoming.playbackRate = 1;
    expect(fadeClock(incoming.media(), graphOf(context))).toBeNull();
    expect(context.made).toHaveLength(1);
    expect(context.made[0]?.connected).toEqual([sink]);
    unclock();
  });
});
