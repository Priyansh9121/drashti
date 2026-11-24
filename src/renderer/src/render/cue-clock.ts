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
 *
 * The stream's picture page (a22-x86sync, QA23-X86SYNC-1, StreamPictureClock below): while it captures for the
 * encoder, every picture it plays is pulled by this graph too. Since x86 that page plays no sound of its own, and on
 * CI's Mac its muted pictures' stand-in clocks lost time and were jumped, so the stream's pictures wandered 0.1-0.4 s
 * from its sound (played, and pulled, on the sound page). One graph and one route per picture whoever asks for it (a
 * cue, a crossfade, the stream): a cue's or a crossfade's stop never takes a picture the stream still holds off it.
 */

/** About -150 dB: below half a 24-bit step (2^-24), so no output can make a sound of it. */
export const KEEP_OUTPUT_LEVEL = 2 ** -25;

/** The one silent graph of this page that a cued picture's sound is pulled by (made on first use). */
export interface SilentGraph {
  readonly context: AudioContext;
  /** Where each routed picture's sound goes: a gain of nothing before the context's destination. */
  readonly sink: AudioNode;
  /**
   * Its inaudible constant to the output (on) or off it (a22-x86sync): off, the output hears exact zeros and Chromium
   * gives it to its stand-in 30 s later, so nothing holds the output open. On as it is made.
   */
  awake?(on: boolean): void;
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
    let kept = true;
    const awake = (on: boolean) => {
      if (on === kept) return;
      kept = on;
      if (on) keep.connect(context.destination);
      else keep.disconnect();
    };
    return { context, sink, awake };
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
/** How many pictures use (or wait for) each graph: with none, it rests (suspended) until the next cue. */
const users = new WeakMap<AudioContext, number>();
/** How many of them want its output awake: a cue, a crossfade, the stream while it captures. */
const waking = new WeakMap<AudioContext, number>();
/** A graph asked to rest whose rest may still be on the way (it can still say it runs). */
const resting = new WeakSet<AudioContext>();

/** Who holds a picture on the graph: a cue ('graph'), a crossfade ('fade'), the stream's picture page ('stream'). */
type Holder = 'graph' | 'fade' | 'stream';
/** The marker a picture shows (data-cue-clock): a cue's before a crossfade's before the stream's. */
const SHOWN: readonly Holder[] = ['graph', 'fade', 'stream'];
/** Each picture on a graph now: its one connection, and who holds it there. */
const routes = new WeakMap<HTMLMediaElement, { source: MediaElementAudioSourceNode; holders: Holder[] }>();

/**
 * `v`'s sound into `silent`'s sink for `holder`, once whoever else holds it there, and unmuted only then (its sound
 * going there and nowhere else). Returns its release (the last one lets go of the sound and mutes the picture again),
 * or null when its sound cannot be taken (it stays muted, on its own clock).
 */
function hold(v: HTMLMediaElement, silent: SilentGraph, holder: Holder): (() => void) | null {
  let route = routes.get(v);
  if (!route) {
    try {
      const source = sources.get(v) ?? silent.context.createMediaElementSource(v);
      sources.set(v, source);
      source.connect(silent.sink);
      route = { source, holders: [] };
    } catch {
      return null;
    }
    routes.set(v, route);
    // Only now, its sound going into the graph and nowhere else.
    v.muted = false;
  }
  const held = route;
  held.holders.push(holder);
  const show = () => {
    v.dataset['cueClock'] = SHOWN.find((h) => held.holders.includes(h)) ?? holder;
  };
  show();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const at = held.holders.indexOf(holder);
    if (at >= 0) held.holders.splice(at, 1);
    if (held.holders.length > 0) {
      show();
      return;
    }
    routes.delete(v);
    v.muted = true;
    delete v.dataset['cueClock'];
    held.source.disconnect();
  };
}

/** Its constant on while anyone wants the output awake (or nothing uses it: it rests, and wakes with it on). */
function keepAwake(silent: SilentGraph): void {
  const { context } = silent;
  silent.awake?.((users.get(context) ?? 0) === 0 || (waking.get(context) ?? 0) > 0);
}

function addUser(silent: SilentGraph, awake: boolean): void {
  const { context } = silent;
  users.set(context, (users.get(context) ?? 0) + 1);
  if (awake) waking.set(context, (waking.get(context) ?? 0) + 1);
  keepAwake(silent);
}

function setAwake(silent: SilentGraph, on: boolean): void {
  const { context } = silent;
  waking.set(context, (waking.get(context) ?? 0) + (on ? 1 : -1));
  keepAwake(silent);
}

function dropUser(silent: SilentGraph, awake: boolean): void {
  const { context } = silent;
  if (awake) waking.set(context, (waking.get(context) ?? 0) - 1);
  const left = (users.get(context) ?? 1) - 1;
  users.set(context, left);
  // Nothing uses it now: no device time spent on silence, and its constant off the output, until the next use.
  // Asked whatever it says now: a graph still starting would otherwise run on, holding the output (a21-review).
  if (left === 0 && context.state !== 'closed') {
    resting.add(context);
    void context.suspend().catch(() => undefined);
  }
  keepAwake(silent);
}

/**
 * Resting since its last use, or its rest still on the way (a21-review, a22-cue): asked to run again (it does a
 * moment later). Asked to rest once more first (a22-review-cue2 M1): a cue cancelled just as its graph's start
 * finished leaves Chromium saying 'running' with its device stopped, and resume() on a context that says 'running'
 * starts nothing; suspend() stops the device whatever it says and makes it say 'suspended', so the resume after it
 * really starts the device and a route waits for it.
 */
function wake(context: AudioContext): void {
  if (context.state === 'suspended' || resting.has(context)) {
    if (resting.has(context)) void context.suspend().catch(() => undefined);
    resting.delete(context);
    void context.resume().catch(() => undefined);
  }
}

/**
 * Pull a cued picture's sound through the page's silent graph and unmute it there (its clock then starts with its
 * rate). Routed only while the picture is held (paused, or at rate 0 for its Go): never mid-play, where its sound would
 * change clocks as the picture moves. Returns its stop: the sound let go of and the picture muted again (unless the
 * stream's picture page still holds it there).
 */
export function cueClock(v: HTMLMediaElement, graph: () => SilentGraph | null = pageSilentGraph): () => void {
  const silent = graph();
  if (!silent) return () => undefined;
  const { context } = silent;
  addUser(silent, true);
  wake(context);
  let stopped = false;
  let release: (() => void) | null = null;
  const route = () => {
    if (stopped || release || context.state !== 'running' || !(v.paused || v.playbackRate === 0)) return;
    release = hold(v, silent, 'graph');
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
    release?.();
    release = null;
    dropUser(silent, true);
  };
}

/** This page's silent graph, made and running (not resting): a crossfade's picture never starts one for itself. */
function runningPageGraph(): SilentGraph | null {
  if (page?.context.state !== 'running' || resting.has(page.context)) return null;
  return page;
}

/**
 * A crossfade's playing picture on the page's silent graph (the owner's QA23-FADE-6, "Try B in parallel (Rec.)"): its
 * sound pulled by the graph from its crossfade's state on, so its clock is the graph's steady one. On CI's two-core
 * Windows a fade's muted outgoing picture ran on its sound's stand-in sink, pulled late on its page's busy media thread
 * with the late pulls skipped, and lost its time (0.3 to 0.8 of real time), so it fell behind and was jumped; the cued
 * incoming one, pulled by this graph, ran at 1 (a22-fade-1124-103850-84620). Taken mid-play, unlike a cue: its time may
 * step by the two sinks' delays (tens of ms), never a jump. Only into a graph that already runs, as its crossfade's cue
 * keeps it (never one started for it: no output held for this, QA22-CUE-2), never a picture the graph already pulls
 * (its own cue's, or the stream's), and kept until the picture is let go: a source can never be taken back, and one
 * left unpulled would stop its picture. It counts as a user of the graph meanwhile, so the graph rests only once both
 * are let go. Returns its stop, or null when it was not taken.
 */
export function fadeClock(
  v: HTMLMediaElement,
  graph: () => SilentGraph | null = runningPageGraph,
): (() => void) | null {
  if (v.dataset['cueClock'] !== undefined) return null;
  const silent = graph();
  if (silent?.context.state !== 'running' || resting.has(silent.context)) return null;
  const release = hold(v, silent, 'fade');
  if (!release) return null;
  addUser(silent, true);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    release();
    dropUser(silent, true);
  };
}

/** A picture the stream's picture page plays, as StreamPictureClock holds it. */
interface PictureHold {
  readonly v: HTMLMediaElement;
  /** The graph it uses or waits for (counted as one of its users), or null. */
  silent: SilentGraph | null;
  /** Whether it wants that graph's output awake (while capturing). */
  awake: boolean;
  /** Its route, once taken. */
  release: (() => void) | null;
  /** Waiting for the graph to run. */
  started: (() => void) | null;
}

/**
 * The stream's picture page's pictures on its silent graph while it captures for the encoder (live or recording;
 * a22-x86sync, QA23-X86SYNC-1, lead 2's design A). Each picture the page plays is given here as it starts
 * (render/playback.ts setPictureClock, set by program/main.tsx alone) and let go after it stops. While capturing, its
 * sound is pulled by the graph, so its clock is the output device's own, as the stream's sound page's players are: taken
 * only once the graph runs, mid-play if it must (its time may step by tens of ms, never a jump). Nothing is heard and
 * nothing goes into the stream: the graph's gain of nothing, then the page's own output.
 *
 * While capturing the graph is kept up from its first picture on, even between pictures (a22-review-x86sync S1): a
 * slide with a video, one without, then one with again on air neither stops nor starts its device, and the next picture
 * is taken as its playback starts, before it plays.
 *
 * Capturing stops: the output is no longer kept awake for it (QA22-CUE-2: an idle stream page holds no output open; the
 * output hears exact zeros, and Chromium gives it to its stand-in 30 s later), but a picture already taken stays pulled:
 * its sound can never be given back to its own clock, and unpulled it runs on the graph's idle pace (0.18 of real time
 * locally, throttled). So a picture whose sound it once took is taken again whenever it plays again, capturing or not
 * (a22-review-x86sync M1: DeckStep's StepVideo replays one element on Previous then Next, SlideView's video on a retry),
 * its output not kept awake. A picture never taken is not taken while not capturing, and one still waiting for the graph
 * then is let be. Capturing again keeps the output awake again and takes the rest.
 */
export class StreamPictureClock {
  private capturing = false;
  private readonly held = new Set<PictureHold>();
  /** The graph it keeps up while capturing, from its first picture (counted as one awake user of it), or null. */
  private kept: SilentGraph | null = null;

  constructor(private readonly graph: () => SilentGraph | null = pageSilentGraph) {}

  /** How many pictures it is given now (tests). */
  get holding(): number {
    return this.held.size;
  }

  /** Whether the encoder takes this page's pictures now (the page's context: live or recording). */
  setCapturing(on: boolean): void {
    if (on === this.capturing) return;
    this.capturing = on;
    for (const h of this.held) {
      if (on) this.engage(h);
      else this.rest(h);
    }
    if (!on && this.kept) {
      const kept = this.kept;
      this.kept = null;
      dropUser(kept, true);
    }
  }

  /** A picture that plays on this page: on the graph while capturing, until the returned let-go (after it stops). */
  take(v: HTMLMediaElement): () => void {
    const h: PictureHold = { v, silent: null, awake: false, release: null, started: null };
    this.held.add(h);
    // Its sound once taken (M1): pulled again whether or not the page captures now.
    if (this.capturing || sources.has(v)) this.engage(h);
    return () => {
      if (!this.held.delete(h)) return;
      this.unwait(h);
      h.release?.();
      h.release = null;
      this.leave(h);
    };
  }

  /** Its graph woken (and its output kept awake while capturing), and the picture taken into it once it runs. */
  private engage(h: PictureHold): void {
    const awake = this.capturing;
    const silent = h.silent ?? this.graph();
    if (!silent) return;
    if (awake && !this.kept) {
      this.kept = silent;
      addUser(silent, true);
    }
    if (!h.silent) {
      h.silent = silent;
      h.awake = awake;
      addUser(silent, awake);
    } else if (h.awake !== awake) {
      h.awake = awake;
      setAwake(silent, awake);
    }
    if (h.release) return;
    const { context } = silent;
    wake(context);
    const route = () => {
      if (
        h.release ||
        !this.held.has(h) ||
        !(this.capturing || sources.has(h.v)) ||
        context.state !== 'running'
      )
        return;
      h.release = hold(h.v, silent, 'stream');
      // Its sound cannot be taken: on its own clock, as before, and no use of the graph.
      if (!h.release) this.leave(h);
    };
    if (context.state === 'running') {
      route();
      return;
    }
    if (h.started) return;
    const started = () => {
      if (context.state !== 'running') return;
      this.unwait(h);
      route();
    };
    h.started = started;
    context.addEventListener('statechange', started);
  }

  /**
   * Capturing stopped: a picture on the graph, or one whose sound it took before and waits for it, stays (its output no
   * longer kept awake); one never taken that still waits is let be, on its own clock.
   */
  private rest(h: PictureHold): void {
    if (h.release || sources.has(h.v)) {
      if (h.silent && h.awake) {
        h.awake = false;
        setAwake(h.silent, false);
      }
      return;
    }
    this.unwait(h);
    this.leave(h);
  }

  private unwait(h: PictureHold): void {
    if (h.started && h.silent) h.silent.context.removeEventListener('statechange', h.started);
    h.started = null;
  }

  /** No longer a user of its graph (it rests after the last). */
  private leave(h: PictureHold): void {
    if (h.silent) dropUser(h.silent, h.awake);
    h.silent = null;
    h.awake = false;
  }
}
