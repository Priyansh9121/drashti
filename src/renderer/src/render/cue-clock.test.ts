import { describe, expect, it } from 'vitest';
import { createSilentGraph, cueClock, fadeClock, type SilentGraph, StreamPictureClock } from './cue-clock';

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

/** A picture playing on: every seek, pause, play or new speed it is given is written down (a jump would be one). */
class Picture {
  muted = true;
  dataset: Record<string, string> = {};
  readonly writes: string[] = [];
  private time = 3;
  private rate = 1;
  private stopped = false;
  get paused(): boolean {
    return this.stopped;
  }
  get currentTime(): number {
    return this.time;
  }
  set currentTime(t: number) {
    this.writes.push(`seek ${String(t)}`);
    this.time = t;
  }
  get playbackRate(): number {
    return this.rate;
  }
  set playbackRate(r: number) {
    this.writes.push(`rate ${String(r)}`);
    this.rate = r;
  }
  pause(): void {
    this.writes.push('pause');
    this.stopped = true;
  }
  play(): Promise<void> {
    this.writes.push('play');
    this.stopped = false;
    return Promise.resolve();
  }
  media(): HTMLMediaElement {
    return this as unknown as HTMLMediaElement;
  }
}

/** A stand-in graph that says when its inaudible constant goes to its output and when it comes off. */
function keptGraph(context: Context): { graph: () => SilentGraph; awake: () => boolean } {
  let kept = true;
  const graph: SilentGraph = {
    context: context as unknown as AudioContext,
    sink: sink as unknown as AudioNode,
    awake: (on) => {
      kept = on;
    },
  };
  return { graph: () => graph, awake: () => kept };
}

describe("the stream's picture page: its pictures on its silent graph while it captures (a22-x86sync, QA23-X86SYNC-1)", () => {
  /*
   * A muted picture with a sound track plays on its sound's clock, and muted that sound goes to Chromium's stand-in sink,
   * paced by a timer on the page's media thread: there late pulls are skipped and the picture loses time. Since x86 the
   * stream's picture page plays no sound of its own that kept that thread on time, and on CI's Mac its pictures fell
   * behind and were jumped (a22-fade2's S6: flashes 0.63-2.1 s apart, 8 of 29 skipped, the beeps exact). Pulled by the
   * page's silent graph (the device's own real-time thread) the picture keeps real time, as the sound page's players do.
   */
  it('takes a picture already playing into the graph as the stream starts capturing: mid-play, never a jump, a pause or a new speed', () => {
    const context = new Context(),
      kept = keptGraph(context),
      clock = new StreamPictureClock(kept.graph),
      v = new Picture();
    clock.take(v.media());
    // Not capturing (the operator's preview alone): on its own clock, as before.
    expect(context.made).toHaveLength(0);
    expect(v.muted).toBe(true);
    expect(v.dataset['cueClock']).toBeUndefined();
    clock.setCapturing(true);
    expect(context.made).toHaveLength(1);
    expect(context.made[0]?.connected).toEqual([sink]);
    expect(v.muted).toBe(false);
    expect(v.dataset['cueClock']).toBe('stream');
    expect(v.writes).toEqual([]);
    expect(kept.awake()).toBe(true);
  });

  it('sends its sound only into the gain of nothing before the output: nothing heard, nothing into the stream or the hall (condition 1)', () => {
    const destination = { name: 'destination' };
    const gains: { gain: { value: number }; to: unknown[] }[] = [];
    const sources: { to: unknown[] }[] = [];
    const made = {
      state: 'running',
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
        gains.push(node);
        return node;
      },
      createConstantSource: () => ({
        offset: { value: 1 },
        connect: (to: unknown) => to,
        disconnect: () => undefined,
        start: () => undefined,
      }),
      createMediaElementSource: () => {
        const source = {
          to: [] as unknown[],
          connect(to: unknown) {
            source.to.push(to);
            return to;
          },
          disconnect() {
            source.to = [];
          },
        };
        sources.push(source);
        return source;
      },
      resume: () => Promise.resolve(),
      suspend: () => Promise.resolve(),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    const graph = createSilentGraph(() => made as unknown as AudioContext);
    const clock = new StreamPictureClock(() => graph);
    clock.setCapturing(true);
    const v = new Picture();
    clock.take(v.media());
    expect(sources).toHaveLength(1);
    expect(gains).toHaveLength(1);
    // Into the graph's one gain, set to nothing, and from there only to the page's own output: the picture page has no
    // way to the stream's encoder (its sound comes only from the stream's sound page), and the hall hears its own player.
    expect(sources[0]?.to).toEqual([gains[0]]);
    expect(gains[0]?.gain.value).toBe(0);
    expect(gains[0]?.to).toEqual([destination]);
  });

  it("holds the output awake only while it captures: after, the picture stays pulled (no jump, no freeze) and only Chromium's 30 s stand-in has the output (condition 2)", () => {
    const context = new Context(),
      kept = keptGraph(context),
      clock = new StreamPictureClock(kept.graph),
      v = new Picture();
    clock.setCapturing(true);
    clock.take(v.media());
    expect(kept.awake()).toBe(true);
    clock.setCapturing(false);
    // Its constant off: the output now hears exact zeros, so 30 s on Chromium gives it to its stand-in (QA22-CUE-2).
    expect(kept.awake()).toBe(false);
    // A taken sound cannot be given back to the picture's own clock: left unpulled it would stop the picture.
    expect(context.made[0]?.connected).toEqual([sink]);
    expect(v.muted).toBe(false);
    expect(context.suspended).toBe(0);
    expect(v.writes).toEqual([]);
    // Capturing again (live, or the next recording): awake again.
    clock.setCapturing(true);
    expect(kept.awake()).toBe(true);
  });

  it('keeps the output awake after capturing stops while a cue still waits on the same page, and not after it', () => {
    const context = new Context(),
      kept = keptGraph(context),
      clock = new StreamPictureClock(kept.graph);
    clock.setCapturing(true);
    clock.take(new Picture().media());
    const stopCue = cueClock(new Element().media(), kept.graph);
    clock.setCapturing(false);
    expect(kept.awake()).toBe(true);
    stopCue();
    expect(kept.awake()).toBe(false);
  });

  it('lets go of each route as its picture is let go or replaced, and rests the graph after the last: nothing left behind across many cues (condition 4)', () => {
    const context = new Context(),
      kept = keptGraph(context),
      clock = new StreamPictureClock(kept.graph);
    clock.setCapturing(true);
    const pictures = Array.from({ length: 40 }, () => new Element());
    let previous: (() => void) | null = null;
    for (const v of pictures) {
      // A playlist's next video: taken as it plays here, cued, then the one before it let go and its cue's clock with it.
      const letGo = clock.take(v.media());
      const stopCue = cueClock(v.media(), kept.graph);
      previous?.();
      stopCue();
      expect(v.muted).toBe(false);
      expect(v.dataset['cueClock']).toBe('stream');
      previous = letGo;
    }
    previous?.();
    expect(clock.holding).toBe(0);
    expect(pictures.every((v) => v.muted && v.dataset['cueClock'] === undefined)).toBe(true);
    expect(context.made.every((s) => s.connected.length === 0)).toBe(true);
    // While it captures the graph stays up for the next picture (a22-review-x86sync S1); it rests once capturing stops.
    expect(context.state).toBe('running');
    clock.setCapturing(false);
    expect(context.state).toBe('suspended');
    // The same element taken again (its playback started afresh) has the one source it can ever have, and is pulled
    // again though capturing has stopped (a22-review-x86sync M1).
    const [again] = pictures;
    if (!again) throw new Error('Generated: no first picture');
    clock.take(again.media());
    // The resting graph asked to run again: it does a moment later.
    context.start();
    expect(context.made).toHaveLength(40);
    expect(again.muted).toBe(false);
  });

  it('pulls a picture whose sound it once took when it plays again after capturing stopped, its output not kept awake (a22-review-x86sync M1)', () => {
    // Chromium never gives a taken sound back to the picture's own clock: unpulled, it runs on the graph's own idle pace
    // (locally, throttled: 0.18 of real time, against 1.000 pulled again).
    const context = new Context(),
      kept = keptGraph(context),
      clock = new StreamPictureClock(kept.graph),
      v = new Picture();
    clock.setCapturing(true);
    clock.take(v.media())();
    clock.setCapturing(false);
    expect(context.state).toBe('suspended');
    const resumed = context.resumed;
    // Played again with the recording stopped (the preview, Video out, the window for Zoom).
    clock.take(v.media());
    expect(context.resumed).toBe(resumed + 1);
    context.start();
    expect(context.made).toHaveLength(1);
    expect(context.made[0]?.connected).toEqual([sink]);
    expect(v.muted).toBe(false);
    expect(v.dataset['cueClock']).toBe('stream');
    // Nothing keeps the output awake for it: exact zeros, so Chromium's stand-in has it 30 s on (QA22-CUE-2).
    expect(kept.awake()).toBe(false);
    expect(v.writes).toEqual([]);
    // A picture never taken still plays on its own clock with capturing stopped (the preview alone, as before).
    const fresh = new Picture();
    clock.take(fresh.media());
    expect(fresh.muted).toBe(true);
    expect(context.made).toHaveLength(1);
  });

  it("a deck's clip replayed by Previous then Next on the same element is pulled each time, and let go each time (DeckStep's StepVideo)", () => {
    const context = new Context(),
      kept = keptGraph(context),
      clock = new StreamPictureClock(kept.graph),
      clip = new Element();
    clock.setCapturing(true);
    // Click 2's clip plays while recording; Previous lets it go, Next plays the very element again.
    for (let round = 0; round < 3; round++) {
      const letGo = clock.take(clip.media());
      expect(clip.muted).toBe(false);
      letGo();
      expect(clip.muted).toBe(true);
    }
    clock.setCapturing(false);
    // The recording stopped: Previous, then Next, on the same element, three times more.
    for (let round = 0; round < 3; round++) {
      const letGo = clock.take(clip.media());
      if (context.state !== 'running') context.start();
      expect(clip.muted).toBe(false);
      expect(clip.dataset['cueClock']).toBe('stream');
      expect(kept.awake()).toBe(false);
      letGo();
      expect(clip.muted).toBe(true);
      expect(clip.dataset['cueClock']).toBeUndefined();
    }
    expect(context.made).toHaveLength(1);
    expect(clock.holding).toBe(0);
    expect(context.state).toBe('suspended');
  });

  it('keeps the graph up between pictures while it captures, so the next is taken at once, before it plays (a22-review-x86sync S1)', () => {
    const context = new Context(),
      kept = keptGraph(context),
      clock = new StreamPictureClock(kept.graph);
    clock.setCapturing(true);
    // Slide A's video, then slide B with none: the graph neither stops nor starts its device on air.
    clock.take(new Element().media())();
    expect(context.suspended).toBe(0);
    expect(kept.awake()).toBe(true);
    // Slide C's video: taken as its playback starts, still held, never switched to the graph mid-play.
    const next = new Element();
    const letGoNext = clock.take(next.media());
    expect(next.muted).toBe(false);
    expect(context.made).toHaveLength(2);
    letGoNext();
    expect(context.suspended).toBe(0);
    // Capturing stops with no picture on it: the graph rests.
    clock.setCapturing(false);
    expect(context.suspended).toBe(1);
  });

  it("is never taken off the graph by a cue's or a crossfade's stop, and never takes a cue's off by its own", () => {
    const context = new Context(),
      kept = keptGraph(context),
      clock = new StreamPictureClock(kept.graph);
    clock.setCapturing(true);
    const v = new Element();
    const letGo = clock.take(v.media());
    const stopCue = cueClock(v.media(), kept.graph);
    expect(v.dataset['cueClock']).toBe('graph');
    stopCue();
    expect(v.muted).toBe(false);
    expect(context.made[0]?.connected).toEqual([sink]);
    expect(v.dataset['cueClock']).toBe('stream');
    // Already pulled by the graph: a crossfade takes nothing more of it.
    expect(fadeClock(v.media(), kept.graph)).toBeNull();
    letGo();
    expect(v.muted).toBe(true);
    const w = new Element();
    const stopW = cueClock(w.media(), kept.graph);
    if (context.state !== 'running') context.start();
    const letGoW = clock.take(w.media());
    letGoW();
    expect(w.muted).toBe(false);
    expect(w.dataset['cueClock']).toBe('graph');
    stopW();
    expect(w.muted).toBe(true);
  });

  it('waits for a resting graph to run before it takes a picture, and takes none once capturing stopped first', () => {
    const context = new Context(),
      kept = keptGraph(context),
      clock = new StreamPictureClock(kept.graph),
      v = new Picture();
    context.state = 'suspended';
    clock.take(v.media());
    clock.setCapturing(true);
    expect(context.resumed).toBe(1);
    expect(context.made).toHaveLength(0);
    expect(v.muted).toBe(true);
    context.start();
    expect(context.made).toHaveLength(1);
    expect(v.muted).toBe(false);
    expect(v.writes).toEqual([]);

    const later = new Context(),
      keptLater = keptGraph(later),
      stopped = new StreamPictureClock(keptLater.graph),
      w = new Picture();
    later.state = 'suspended';
    stopped.take(w.media());
    stopped.setCapturing(true);
    stopped.setCapturing(false);
    expect(later.suspended).toBe(1);
    later.start();
    expect(later.made).toHaveLength(0);
    expect(w.muted).toBe(true);
  });

  it('leaves a picture on its own clock where no graph can be had or its sound cannot be taken', () => {
    const none = new StreamPictureClock(() => null),
      v = new Picture();
    none.setCapturing(true);
    const letGo = none.take(v.media());
    expect(v.muted).toBe(true);
    expect(() => {
      letGo();
    }).not.toThrow();
    const context = new Context(),
      kept = keptGraph(context),
      clock = new StreamPictureClock(kept.graph),
      refused = new Picture();
    context.refuse = true;
    clock.setCapturing(true);
    clock.take(refused.media());
    expect(refused.muted).toBe(true);
    expect(refused.dataset['cueClock']).toBeUndefined();
    expect(refused.writes).toEqual([]);
  });
});
