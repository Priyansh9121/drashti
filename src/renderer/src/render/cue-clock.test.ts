import { describe, expect, it } from 'vitest';
import { createSilentGraph, cueClock, type SilentGraph } from './cue-clock';

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
  refuse = false;
  createMediaElementSource(): Source {
    if (this.refuse) throw new Error('Generated refusal');
    const source = new Source();
    this.made.push(source);
    return source;
  }
  start(): void {
    this.state = 'running';
    this.dispatchEvent(new Event('statechange'));
  }
  suspended = 0;
  resumed = 0;
  suspend(): Promise<void> {
    this.suspended++;
    this.state = 'suspended';
    this.dispatchEvent(new Event('statechange'));
    return Promise.resolve();
  }
  /** As a real context does, it runs a moment later (start()). */
  resume(): Promise<void> {
    this.resumed++;
    return Promise.resolve();
  }
}

/**
 * A context as Chromium 152 runs one (audio_context.cc, AudioContextAsyncStateTransitions off; a22-review-cue2 M1):
 * resume() starts the device and parks its promise; the device's first render posts a main-thread task that says
 * 'running' while any resume is parked, whether or not the device still renders; suspend() stops the device whatever
 * the state, and says 'suspended' only from 'running'; resume() on a context that says 'running' starts nothing.
 */
class Chromium152Context extends EventTarget {
  state: AudioContextState = 'suspended';
  /** Whether its device really renders. */
  rendering = false;
  made: Source[] = [];
  private parked = 0;
  private posted = false;
  createMediaElementSource(): Source {
    const source = new Source();
    this.made.push(source);
    return source;
  }
  resume(): Promise<void> {
    if (this.state === 'running') return Promise.resolve();
    this.rendering = true;
    this.parked++;
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.rendering = false;
    if (this.state === 'running') {
      this.state = 'suspended';
      this.dispatchEvent(new Event('statechange'));
    }
    return Promise.resolve();
  }
  /** The audio thread's first quantum: posts the task that settles the parked resumes. */
  firstRender(): void {
    if (this.rendering && this.parked > 0) this.posted = true;
  }
  /** That task, on the main thread. */
  runPostedTask(): void {
    if (!this.posted) return;
    this.posted = false;
    if (this.parked > 0) {
      this.parked = 0;
      this.state = 'running';
      this.dispatchEvent(new Event('statechange'));
    }
  }
}

class Element {
  muted = true;
  paused = true;
  playbackRate = 0;
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

describe("a cued picture's clock", () => {
  it('is its sound pulled by the silent graph, unmuted only once that sound goes there', () => {
    const context = new Context(),
      v = new Element();
    cueClock(v.media(), graphOf(context));
    expect(context.made).toHaveLength(1);
    expect(context.made[0]?.connected).toEqual([sink]);
    expect(v.muted).toBe(false);
    expect(v.dataset['cueClock']).toBe('graph');
  });

  it('is put back as it stops: its sound let go of and the picture muted again', () => {
    const context = new Context(),
      v = new Element();
    const stop = cueClock(v.media(), graphOf(context));
    stop();
    expect(context.made[0]?.connected).toEqual([]);
    expect(v.muted).toBe(true);
    expect(v.dataset['cueClock']).toBeUndefined();
  });

  it('reuses the one source an element can have when the same element is cued again', () => {
    const context = new Context(),
      v = new Element();
    cueClock(v.media(), graphOf(context))();
    v.muted = true;
    cueClock(v.media(), graphOf(context));
    // It rested between the two cues; it runs again a moment later.
    context.start();
    expect(context.made).toHaveLength(1);
    expect(context.made[0]?.connected).toEqual([sink]);
    expect(v.muted).toBe(false);
  });

  it('stays muted on its own clock where no graph can be had or its sound cannot be taken', () => {
    const none = new Element();
    cueClock(none.media(), () => null);
    expect(none.muted).toBe(true);
    expect(none.dataset['cueClock']).toBeUndefined();
    const context = new Context(),
      refused = new Element();
    context.refuse = true;
    expect(() => cueClock(refused.media(), graphOf(context))).not.toThrow();
    expect(refused.muted).toBe(true);
    expect(refused.dataset['cueClock']).toBeUndefined();
  });

  it('waits for a graph that is not yet running, and is routed then only while the picture is still held', () => {
    const context = new Context(),
      held = new Element(),
      playing = new Element();
    context.state = 'suspended';
    cueClock(held.media(), graphOf(context));
    cueClock(playing.media(), graphOf(context));
    expect(context.made).toHaveLength(0);
    expect(held.muted).toBe(true);
    // Routed mid-play, its sound would move to another clock while the picture moves: never.
    playing.paused = false;
    playing.playbackRate = 1;
    context.start();
    expect(context.made).toHaveLength(1);
    expect(held.muted).toBe(false);
    expect(playing.muted).toBe(true);
  });

  it('is never routed once stopped, even if the graph starts after', () => {
    const context = new Context(),
      v = new Element();
    context.state = 'suspended';
    cueClock(v.media(), graphOf(context))();
    context.start();
    expect(context.made).toHaveLength(0);
    expect(v.muted).toBe(true);
  });
});

describe("the page's silent graph at rest", () => {
  it('rests once no cued picture uses it, and is asked to run again for the next cue', () => {
    const context = new Context(),
      first = new Element(),
      next = new Element();
    cueClock(first.media(), graphOf(context))();
    expect(context.suspended).toBe(1);
    cueClock(next.media(), graphOf(context));
    expect(context.resumed).toBe(1);
    expect(next.muted).toBe(true);
    context.start();
    expect(next.muted).toBe(false);
  });

  it('keeps running while another cued picture still uses it or waits for it, and rests after the last', () => {
    const context = new Context(),
      one = new Element(),
      two = new Element();
    const stopOne = cueClock(one.media(), graphOf(context));
    const stopTwo = cueClock(two.media(), graphOf(context));
    stopOne();
    stopOne();
    expect(context.suspended).toBe(0);
    stopTwo();
    expect(context.suspended).toBe(1);
  });
});

describe("the page's silent graph while it starts or rests (a21-review, a22-cue)", () => {
  it('is asked to rest when its last cue stops while it is still starting, so it never runs on with its constant', () => {
    const context = new Context(),
      v = new Element();
    // Resting since an earlier cue: this cue asks it to run, and it is still starting when the cue is cancelled.
    context.state = 'suspended';
    const stop = cueClock(v.media(), graphOf(context));
    expect(context.resumed).toBe(1);
    stop();
    // Its start-up finishes after the stop: it must already have been asked to rest again.
    context.start();
    expect(context.suspended).toBe(1);
    expect(v.muted).toBe(true);
  });

  it("routes the next cue only into a graph that really renders, after a cue cancelled as its graph's start finished (a22-review-cue2 M1)", () => {
    const context = new Chromium152Context(),
      first = new Element(),
      next = new Element();
    // The first cue wakes the resting graph: its device starts, and renders its first quantum, which posts the task
    // that will say 'running'.
    const stop = cueClock(first.media(), graphOf(context as unknown as Context));
    context.firstRender();
    // Cancelled before that task runs: the device stops and the graph still says 'suspended'.
    stop();
    expect(context.rendering).toBe(false);
    // Then the task runs, and says 'running' though the device has stopped (Chromium 152 checks neither).
    context.runPostedTask();
    expect(context.state).toBe('running');
    // The next cue on this page: its picture's sound must go only into a graph that renders, or the picture never
    // moves at Go on this screen.
    cueClock(next.media(), graphOf(context as unknown as Context));
    expect(next.muted || context.rendering).toBe(true);
    context.firstRender();
    context.runPostedTask();
    expect(context.rendering).toBe(true);
    expect(next.muted).toBe(false);
  });

  it('is asked to run again by a new cue that comes while its rest is still on the way', () => {
    const context = new Context(),
      first = new Element(),
      next = new Element();
    cueClock(first.media(), graphOf(context))();
    expect(context.suspended).toBe(1);
    // The rest has been asked but not taken effect yet: the graph still says it runs.
    context.state = 'running';
    cueClock(next.media(), graphOf(context));
    expect(context.resumed).toBe(1);
  });
});

describe("the page's silent graph", () => {
  it("renders on the output device's own audio thread, with a gain of nothing before its destination, and is asked to run", () => {
    const made: AudioContextOptions[] = [];
    const nodes: { gain: number; to: unknown[] }[] = [];
    let resumed = 0;
    const destination = { name: 'destination' };
    const graph = createSilentGraph((options) => {
      made.push(options);
      return {
        state: 'suspended',
        destination,
        createGain: () => {
          const node = {
            gain: { value: 1 },
            to: [] as unknown[],
            connect(to: unknown) {
              node.to.push(to);
              return to;
            },
          };
          nodes.push({
            get gain() {
              return node.gain.value;
            },
            to: node.to,
          });
          return node;
        },
        createConstantSource: () => ({
          offset: { value: 1 },
          connect: (to: unknown) => to,
          start: () => undefined,
        }),
        resume: () => {
          resumed++;
          return Promise.resolve();
        },
      } as unknown as AudioContext;
    });
    expect(graph).not.toBeNull();
    // No sinkId 'none': that context is paced by a thread-pool timer, which ran at 0.24-0.49 of real time on CI's Mac
    // (a21-s5-1123-121533-19312), so the picture's sound was pulled late and slow. The default output's own thread.
    expect(made).toEqual([{ latencyHint: 'interactive' }]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.gain).toBe(0);
    expect(nodes[0]?.to).toEqual([destination]);
    expect(resumed).toBe(1);
  });

  it('never counts as silent: an inaudible constant goes to its output while it runs (QA21-S5-3, the owner: A)', () => {
    // Chromium moves an output that has rendered nothing but zeros for 30 s to a stand-in sink paced by a thread-pool
    // timer (SilentSinkSuspender), as slow as sinkId 'none' was on CI's Mac: a cue held over 30 s then started 45-102 ms
    // late there (a21-s5-1123-152334-44457). A constant below half a 24-bit output's step is not silence to that check,
    // yet every 16- or 24-bit output still receives exactly 0: nothing can be heard.
    const constants: { offset: number; to: unknown[]; started: number }[] = [];
    const destination = { name: 'destination' };
    const graph = createSilentGraph(
      () =>
        ({
          state: 'running',
          destination,
          createGain: () => ({ gain: { value: 1 }, connect: (to: unknown) => to }),
          createConstantSource: () => {
            const made = { offset: 1, to: [] as unknown[], started: 0 };
            constants.push(made);
            return {
              offset: {
                get value() {
                  return made.offset;
                },
                set value(v: number) {
                  made.offset = v;
                },
              },
              connect(to: unknown) {
                made.to.push(to);
                return to;
              },
              start() {
                made.started++;
              },
            };
          },
          resume: () => Promise.resolve(),
        }) as unknown as AudioContext,
    );
    expect(graph).not.toBeNull();
    expect(constants).toHaveLength(1);
    const level = constants[0]?.offset ?? 0;
    expect(level).toBeGreaterThan(0);
    expect(level).toBeLessThan(2 ** -24);
    expect(constants[0]?.to).toEqual([destination]);
    expect(constants[0]?.started).toBe(1);
  });

  it('is none where Web Audio cannot be had', () => {
    expect(
      createSilentGraph(() => {
        throw new Error('Generated: no audio here');
      }),
    ).toBeNull();
  });
});
