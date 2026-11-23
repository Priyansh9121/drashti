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

describe("the page's silent graph", () => {
  it('has no device and a gain of nothing before its destination, and is asked to run', () => {
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
        resume: () => {
          resumed++;
          return Promise.resolve();
        },
      } as unknown as AudioContext;
    });
    expect(graph).not.toBeNull();
    expect(made).toEqual([{ latencyHint: 'interactive', sinkId: { type: 'none' } }]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.gain).toBe(0);
    expect(nodes[0]?.to).toEqual([destination]);
    expect(resumed).toBe(1);
  });

  it('is none where Web Audio cannot be had', () => {
    expect(
      createSilentGraph(() => {
        throw new Error('Generated: no audio here');
      }),
    ).toBeNull();
  });
});
