/*
 * A cued picture's clock (S5, QA21-S5-1, the owner's "A, measure the start"). Chromium plays a file that has sound on
 * its sound renderer's clock, even muted on a screen: that clock starts once its sink has started and played out its
 * delay, 34-79 ms after the rate goes to 1 on CI's Mac and Windows (x69's native records, the first moving frame less
 * its media time past the trim), so a cued video began that late on every screen. Pulled by a Web Audio graph instead,
 * its sound is taken as the graph renders and its clock starts with its rate: hall and LIVE within about 11 ms.
 *
 * Nothing is heard: the picture's sound goes only into the graph (that is what a media element source does), and the
 * graph multiplies it by nothing before its destination. The graph renders on the default output's own audio thread:
 * a context with no device (sinkId 'none') is paced by a thread-pool timer instead, which ran at a quarter to a half
 * of real time on CI's Mac (a21-s5-1123-121533-19312), so the picture's sound was pulled late and slow. Where no graph
 * can be had (no Web Audio, a page whose graph never runs, a source that cannot be taken) the picture stays muted, on
 * its own clock, as before.
 *
 * Never silent to Chromium (QA21-S5-3, the owner: A): an output that has rendered only zeros for 30 s is moved to a
 * stand-in sink paced by a thread-pool timer (SilentSinkSuspender), as slow as sinkId 'none' was, so a cue held past
 * that started 45-102 ms late on CI's Mac (a21-s5-1123-152334-44457). The graph sends its output a constant below half a
 * 24-bit output's step: not zeros to that check, yet every 16- or 24-bit output receives exactly 0. The graph runs only
 * while a cued picture uses or waits for it (it rests otherwise), so the output is kept only then.
 */

/** About -150 dB: below half a 24-bit step (2^-24), so no output can make a sound of it. */
export const KEEP_OUTPUT_LEVEL = 2 ** -25;

/** The one silent graph of this page that a cued picture's sound is pulled by (made on first use). */
export interface SilentGraph {
  readonly context: AudioContext;
  /** Where each routed picture's sound goes: a gain of nothing before the context's destination. */
  readonly sink: AudioNode;
}

/** A graph on the default output whose every input is multiplied by nothing; null where none can be had. */
export function createSilentGraph(make: (options: AudioContextOptions) => AudioContext): SilentGraph | null {
  try {
    const context = make({ latencyHint: 'interactive' });
    const sink = context.createGain();
    sink.gain.value = 0;
    sink.connect(context.destination);
    const keep = context.createConstantSource();
    keep.offset.value = KEEP_OUTPUT_LEVEL;
    keep.connect(context.destination);
    keep.start();
    void context.resume().catch(() => undefined);
    return { context, sink };
  } catch {
    return null;
  }
}

let page: SilentGraph | null | undefined;

/** This page's silent graph, made the first time a cued picture asks. */
export function pageSilentGraph(): SilentGraph | null {
  if (page === undefined)
    page = typeof AudioContext === 'undefined' ? null : createSilentGraph((o) => new AudioContext(o));
  return page;
}

/** An element can be a media element source once only, ever: it is kept for a later cue of the same element. */
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
/** How many cued pictures use (or wait for) each graph: with none, it rests (suspended) until the next cue. */
const users = new WeakMap<AudioContext, number>();
/** A graph asked to rest whose rest may still be on the way (it can still say it runs). */
const resting = new WeakSet<AudioContext>();

/**
 * Pull a cued picture's sound through the page's silent graph and unmute it there (its clock then starts with its
 * rate). Routed only while the picture is held (paused, or at rate 0 for its Go): never mid-play, where its sound would
 * change clocks as the picture moves. Returns its stop: the sound let go of and the picture muted again.
 */
export function cueClock(v: HTMLMediaElement, graph: () => SilentGraph | null = pageSilentGraph): () => void {
  const silent = graph();
  if (!silent) return () => undefined;
  const { context, sink } = silent;
  users.set(context, (users.get(context) ?? 0) + 1);
  // Resting since its last cue, or its rest still on the way (a21-review, a22-cue): asked to run again (it does a
  // moment later: the route waits for that, below). Asked to rest once more first (a22-review-cue2 M1): a cue cancelled
  // just as its graph's start finished leaves Chromium saying 'running' with its device stopped, and resume() on a
  // context that says 'running' starts nothing; suspend() stops the device whatever it says and makes it say
  // 'suspended', so the resume after it really starts the device and the route waits for it.
  if (context.state === 'suspended' || resting.has(context)) {
    if (resting.has(context)) void context.suspend().catch(() => undefined);
    resting.delete(context);
    void context.resume().catch(() => undefined);
  }
  let stopped = false;
  let routed: MediaElementAudioSourceNode | null = null;
  const route = () => {
    if (stopped || routed || context.state !== 'running' || !(v.paused || v.playbackRate === 0)) return;
    try {
      const source = sources.get(v) ?? context.createMediaElementSource(v);
      sources.set(v, source);
      source.connect(sink);
      routed = source;
    } catch {
      return;
    }
    // Only now, its sound going into the graph and nowhere else.
    v.muted = false;
    v.dataset['cueClock'] = 'graph';
  };
  const started = () => {
    if (context.state !== 'running') return;
    context.removeEventListener('statechange', started);
    route();
  };
  if (context.state === 'running') route();
  else context.addEventListener('statechange', started);
  return () => {
    if (stopped) return;
    stopped = true;
    context.removeEventListener('statechange', started);
    if (routed) {
      v.muted = true;
      delete v.dataset['cueClock'];
      routed.disconnect();
      routed = null;
    }
    const left = (users.get(context) ?? 1) - 1;
    users.set(context, left);
    // Nothing cued uses it now: no device time spent on silence, and its constant off the output, until the next cue.
    // Asked whatever it says now: a graph still starting would otherwise run on, holding the output (a21-review).
    if (left === 0 && context.state !== 'closed') {
      resting.add(context);
      void context.suspend().catch(() => undefined);
    }
  };
}
