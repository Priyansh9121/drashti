import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackSeek } from '../../../shared/media';
import {
  FADE_PICTURE_LIMITS,
  FADE_SOUND_LIMITS,
  playbackOffset,
  playbackPosition,
} from '../../../shared/media';
import type { CuedVideo, VideoCrossfade } from '../../../shared/video-cue';
import { slotKey } from './background-slots';
import type { SilentGraph } from './cue-clock';
import { fadeClock } from './cue-clock';
import { crossfadeClock, crossfadeOf, crossfadeOn, pictureEase } from './picture-fade';
import { startPlayback } from './playback';

/*
 * A crossfade's two pictures (lead 2's QF-1, a22-fade-picture), on every page: out of step, brought back by speed and
 * not by jumps, from the crossfade's state to its end, by the sound's numbers. On CI's two-core Windows
 * (a22-fade-1124-103850-84620) the outgoing picture's own time ran at 0.3 to 0.8 of the clock between jumps (its muted
 * sound's stand-in sink, pulled late on a busy thread), was jumped past a quarter of a second, landed 0.1 to 1 s later
 * still behind and was aimed again at once: frozen for most of each 2 s fade on the hall, LIVE and the stream. A
 * stand-in picture here plays on the test's clock (fake timers drive Date.now, performance.now and the timers alike).
 */

const START = new Date('2026-11-24T10:00:00Z').getTime();

/**
 * A muted picture as Chromium plays one: `own` is how fast its own time runs against its rate (below 1: losing time, as
 * a stand-in sink pulled late loses it), `seekMs` how long a jump takes to land (frozen meanwhile), `moveLateMs` how
 * long after its rate leaves 0 its time starts moving (a Go reaching a busy page late).
 */
class SlowPicture extends EventTarget {
  duration = NaN;
  seeking = false;
  readyState = 0;
  loop = false;
  muted = false;
  preservesPitch = true;
  dataset: Record<string, string> = {};
  /** Its sound pulled by a page's silent graph (QA23-FADE-6): its clock is that graph's steady one from then. */
  onGraph = false;
  /** It never plays to its own end here. */
  readonly ended = false;
  seeks = 0;
  /** Each jump: when it began and when it landed (Date.now()). */
  readonly jumps: { from: number; to: number | null }[] = [];
  own = 1;
  private rate = 1;
  private base = 0;
  private since = 0;
  private stopped = true;
  private source: string | null = null;
  private landing = 0;

  constructor(
    private readonly length: number,
    private readonly lags: { seekMs?: number; moveLateMs?: number } = {},
  ) {
    super();
  }

  private running(): number {
    return this.base + (Math.max(0, Date.now() - this.since) / 1000) * this.rate * this.own;
  }

  get paused(): boolean {
    return this.stopped;
  }

  get currentTime(): number {
    if (this.stopped || this.seeking) return this.base;
    return Math.min(this.length, this.running());
  }

  set currentTime(value: number) {
    this.base = Math.max(0, Math.min(this.length, value));
    this.seeks++;
    if (!this.seeking) this.jumps.push({ from: Date.now(), to: null });
    this.seeking = true;
    const mine = ++this.landing;
    setTimeout(() => {
      // A seek sent again while it lands replaces it: only the last one lands.
      if (mine !== this.landing) return;
      this.seeking = false;
      this.since = Date.now();
      const jump = this.jumps.at(-1);
      if (jump) jump.to = Date.now();
      this.dispatchEvent(new Event('seeked'));
    }, this.lags.seekMs ?? 5);
  }

  get playbackRate(): number {
    return this.rate;
  }

  set playbackRate(value: number) {
    this.base = this.currentTime;
    this.since = Date.now() + (this.rate === 0 && value > 0 ? (this.lags.moveLateMs ?? 0) : 0);
    this.rate = value;
    this.dispatchEvent(new Event('ratechange'));
  }

  /** Its own time, run on at a new pace from now (on a silent graph, always the graph's: 1). */
  setOwn(own: number): void {
    this.base = this.currentTime;
    this.since = Math.max(this.since, Date.now());
    this.own = this.onGraph ? 1 : own;
  }

  /** Its sound taken into a silent graph: its clock the graph's from now. */
  takenByGraph(): void {
    this.setOwn(1);
    this.onGraph = true;
  }

  set src(url: string) {
    this.source = url;
    setTimeout(() => {
      this.duration = this.length;
      this.readyState = 4;
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('loadeddata'));
    }, 10);
  }

  play(): Promise<void> {
    if (this.stopped) {
      this.since = Date.now();
      this.stopped = false;
      setTimeout(() => this.dispatchEvent(new Event('playing')), 0);
    }
    return Promise.resolve();
  }

  pause(): void {
    if (this.stopped) return;
    this.base = this.currentTime;
    this.stopped = true;
  }

  load(): void {
    this.readyState = 0;
  }

  getAttribute(name: string): string | null {
    return name === 'src' ? this.source : null;
  }

  removeAttribute(): void {
    this.source = null;
    this.duration = NaN;
  }

  /** How long it was frozen in jumps between `from` and `to` (ms). */
  frozenMs(from: number, to: number): number {
    return this.jumps.reduce(
      (sum, j) => sum + Math.max(0, Math.min(j.to ?? to, to) - Math.max(j.from, from)),
      0,
    );
  }
}

function runFor(ms: number): void {
  for (let i = 0; i < ms; i++) vi.advanceTimersByTime(1);
}

const video = (mediaId: string, startedAt: number, extra: Partial<CuedVideo> = {}): CuedVideo => ({
  kind: 'media',
  mediaId,
  media: 'video',
  fit: 'fit',
  loop: false,
  startedAt,
  ...extra,
});

const crossfade = (at: number, durationMs = 2000, extra: Partial<VideoCrossfade> = {}): VideoCrossfade => ({
  id: 'cue-2',
  from: video('outgoing', START),
  at,
  durationMs,
  ...extra,
});

describe('a crossfade’s two pictures: whether and when they are brought back by speed', () => {
  it('a real crossfade is on from its state (a Go lead before its start) to its end, and held while it is paused', () => {
    const fade = crossfade(START + 10_000);
    expect(crossfadeOn(fade, START + 10_000 - 120), 'its state, one Go lead before it starts').toBe(true);
    expect(crossfadeOn(fade, START + 11_000)).toBe(true);
    expect(crossfadeOn(fade, START + 12_000), 'at its end').toBe(false);
    expect(crossfadeOn({ ...fade, pausedAt: START + 11_000 }, START + 20_000), 'paused part-way').toBe(true);
  });

  it('a manual Go’s pair (0 ms: a cut) is no crossfade, nor is none', () => {
    expect(crossfadeOn(crossfade(START + 10_000, 0), START + 9_950)).toBe(false);
    expect(crossfadeOn(crossfade(START + 10_000, 0), START + 10_000)).toBe(false);
    expect(crossfadeOn(null, START)).toBe(false);
  });

  it('the two pictures of a crossfade are the outgoing one (its playback) and the incoming one (its cue), no other', () => {
    const fade = crossfade(START + 10_000);
    const outgoing = video('outgoing', START);
    const incoming = video('incoming', START + 9_000, { cueId: 'cue-2' });
    expect(crossfadeOf(fade, { key: slotKey(outgoing), layer: outgoing })).toBe(fade);
    expect(crossfadeOf(fade, { key: slotKey(incoming), layer: incoming })).toBe(fade);
    const other = video('outgoing', START + 5);
    expect(
      crossfadeOf(fade, { key: slotKey(other), layer: other }),
      'the same file, another playback',
    ).toBeNull();
    const earlier = video('earlier', START - 9_000, { cueId: 'cue-1' });
    expect(
      crossfadeOf(fade, { key: slotKey(earlier), layer: earlier }),
      'an earlier cue’s picture',
    ).toBeNull();
    expect(crossfadeOf(null, { key: slotKey(outgoing), layer: outgoing })).toBeNull();
    const input = {
      kind: 'input' as const,
      inputId: 'camera',
      name: 'Input 1',
      device: 'Placeholder camera',
      fit: 'fit' as const,
      startedAt: START,
    };
    expect(crossfadeOf(fade, { key: slotKey(input), layer: input })).toBeNull();
  });

  it('a picture already playing or prepared as its crossfade comes is eased by the sound’s numbers through it, then not', () => {
    expect(FADE_PICTURE_LIMITS).toEqual(FADE_SOUND_LIMITS);
    expect(FADE_PICTURE_LIMITS).toEqual({ jumpOver: 0.5, maxRateChange: 0.08 });
    let now = START;
    let pair: VideoCrossfade | null = null;
    const ease = pictureEase(
      () => pair,
      () => now,
    );
    expect(ease(), 'before any crossfade').toBeNull();
    pair = crossfade(START + 5_000);
    now = START + 4_900;
    expect(ease(), 'from its state').toEqual(FADE_PICTURE_LIMITS);
    now = START + 6_500;
    expect(ease()).toEqual(FADE_PICTURE_LIMITS);
    pair = { ...pair, pausedAt: START + 6_500 };
    now = START + 30_000;
    expect(ease(), 'held while the fade is paused').toEqual(FADE_PICTURE_LIMITS);
    pair = crossfade(START + 5_000);
    now = START + 7_000;
    expect(ease(), 'at its end').toBeNull();
    pair = crossfade(START + 5_000, 0);
    now = START + 5_000;
    expect(ease(), 'a manual Go’s 0 ms pair').toBeNull();
  });

  it('one made inside its crossfade (its page opened or started again in it) is put in place as ever, then eased in the next', () => {
    let now = START + 5_500;
    let pair: VideoCrossfade | null = crossfade(START + 5_000);
    const ease = pictureEase(
      () => pair,
      () => now,
    );
    expect(ease(), 'made inside this fade').toBeNull();
    now = START + 6_500;
    expect(ease()).toBeNull();
    pair = { ...crossfade(START + 20_000), id: 'cue-3' };
    now = START + 20_500;
    expect(ease(), 'the next crossfade, which it was there before').toEqual(FADE_PICTURE_LIMITS);
  });
});

describe('a crossfade’s picture on a slow computer, played by startPlayback with the picture’s ease', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(START));
    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const played = (v: SlowPicture, pair: { now: VideoCrossfade | null }, startedAt: number) => {
    const timing: { seek?: PlaybackSeek } = {};
    const rates: number[] = [];
    v.addEventListener('ratechange', () => rates.push(v.playbackRate));
    const playback = startPlayback(v as unknown as HTMLMediaElement, {
      mediaId: 'picture',
      startedAt,
      prepareScheduledStart: true,
      ease: pictureEase(() => pair.now),
      timing: () => ({ loop: false, ...timing }),
    });
    return {
      stop: playback,
      rates,
      timing,
      resync: () => playback.resync(),
      /** How far it is from the clock (seconds, + ahead). */
      offset: () =>
        playbackOffset(
          v.currentTime,
          playbackPosition({ startedAt, loop: false, ...timing }, 30, Date.now()),
          30,
          false,
        ),
    };
  };

  it('the outgoing one, its own time 25% short in the fade and its jumps 0.7 s long, is never frozen in a jump: up to 8% faster', () => {
    const v = new SlowPicture(30, { seekMs: 700 });
    const pair: { now: VideoCrossfade | null } = { now: null };
    const s = played(v, pair, START);
    runFor(3000);
    expect(Math.abs(s.offset()), 'in step before the fade').toBeLessThan(2 / 30);
    const at = Date.now() + 120;
    pair.now = crossfade(at);
    v.setOwn(0.75);
    runFor(2120);
    expect(v.frozenMs(at - 120, at + 2000), 'frozen in a jump during the fade (ms)').toBe(0);
    expect(Math.abs(s.offset()), `${s.offset().toFixed(3)} s off at the fade’s end`).toBeLessThan(0.5);
    const inFade = s.rates.filter((r) => r > 0);
    expect(Math.max(...inFade), 'faster than a picture’s own 5%').toBeGreaterThan(1.05);
    expect(inFade.every((r) => Math.abs(r - 1) <= FADE_PICTURE_LIMITS.maxRateChange + 1e-9)).toBe(true);
    s.stop();
  });

  it('the incoming one, sent on at its Go and moving 0.15 s late, is brought into step by speed, never jumped', () => {
    const v = new SlowPicture(30, { seekMs: 700, moveLateMs: 150 });
    const go = START + 3000;
    const pair: { now: VideoCrossfade | null } = { now: null };
    const s = played(v, pair, START);
    // Prepared before its fade: held at its first frame until its Go (render/BackgroundMedia.tsx's cue).
    s.timing.seek = { at: START, toMs: 0, paused: true };
    runFor(2880);
    // Its Go, one Go lead ahead: the crossfade's state, and the engine sends it on from its first frame at the fade's
    // moment; its page checks it at once (armed at rate 0 until then) and plays it from that moment.
    pair.now = crossfade(go);
    s.timing.seek = { at: go, toMs: 0 };
    s.resync();
    runFor(2120);
    expect(v.frozenMs(go - 120, go + 2000), 'frozen in a jump during the fade (ms)').toBe(0);
    expect(Math.abs(s.offset()), `${s.offset().toFixed(3)} s off at the fade’s end`).toBeLessThan(0.05);
    s.stop();
  });

  it('out of a crossfade, a picture 0.3 s behind is still put in place by a jump, as before', () => {
    const v = new SlowPicture(30, { seekMs: 100 });
    const pair: { now: VideoCrossfade | null } = { now: null };
    const s = played(v, pair, START);
    runFor(3000);
    v.setOwn(0.7);
    runFor(1500);
    v.setOwn(1);
    runFor(1500);
    expect(v.seeks, 'jumped back into step').toBeGreaterThanOrEqual(1);
    expect(Math.abs(s.offset())).toBeLessThan(2 / 30);
    s.stop();
  });
});

describe('a crossfade’s outgoing picture on the page’s silent graph (the owner’s QA23-FADE-6, "Try B in parallel")', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(START));
    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** The page's silent graph, running (its crossfade's cue keeps it so): a source taken in sets its picture's clock. */
  const runningGraph = () => {
    const context = {
      state: 'running' as AudioContextState,
      made: 0,
      suspended: 0,
      resumed: 0,
      createMediaElementSource(el: SlowPicture) {
        this.made++;
        return {
          connect: () => {
            el.takenByGraph();
          },
          disconnect: () => undefined,
        };
      },
      suspend() {
        this.suspended++;
        this.state = 'suspended';
        return Promise.resolve();
      },
      resume() {
        this.resumed++;
        return Promise.resolve();
      },
    };
    const graph = { context: context as unknown as AudioContext, sink: {} as AudioNode };
    return { context, graph: (): SilentGraph => graph };
  };

  const playedOn = (v: SlowPicture, pair: { now: VideoCrossfade | null }, graph: () => SilentGraph) => {
    const element = v as unknown as HTMLMediaElement;
    const playback = startPlayback(element, {
      mediaId: 'picture',
      startedAt: START,
      ease: pictureEase(() => pair.now),
      timing: () => ({ loop: false }),
    });
    // As render/BackgroundMedia.tsx's VideoSlot: told the crossfade it is one of as that changes, let go at the end.
    const clock = crossfadeClock(element, undefined, (el) => fadeClock(el, graph));
    return {
      stop: () => {
        playback();
        clock.letGo();
      },
      pair: (fade: VideoCrossfade | null) => {
        pair.now = fade;
        clock.pair(fade);
      },
      offset: () =>
        playbackOffset(
          v.currentTime,
          playbackPosition({ startedAt: START, loop: false }, 30, Date.now()),
          30,
          false,
        ),
    };
  };

  it('its own clock at 0.4x through a 2 s fade, it is never jumped nor still for 100 ms: on the graph it keeps time', () => {
    const v = new SlowPicture(30, { seekMs: 700 });
    const { context, graph } = runningGraph();
    const s = playedOn(v, { now: null }, graph);
    runFor(3000);
    expect(context.made, 'never taken before its crossfade').toBe(0);
    const before = v.seeks;
    const at = Date.now() + 120;
    s.pair(crossfade(at));
    // Two pictures decoding on a busy two-core PC: off the graph, its muted clock would run at 0.4 of real time.
    v.setOwn(0.4);
    let still = 0,
      longest = 0,
      last = v.currentTime;
    for (let ms = 0; ms < 2120; ms++) {
      runFor(1);
      still = !v.paused && v.currentTime === last ? still + 1 : 0;
      longest = Math.max(longest, still);
      last = v.currentTime;
    }
    expect(v.seeks - before, 'no jump in the fade').toBe(0);
    expect(longest, 'never still for 100 ms in the fade (ms)').toBeLessThan(100);
    expect(Math.abs(s.offset()), `${s.offset().toFixed(3)} s off at the fade’s end`).toBeLessThan(0.05);
    s.pair(null);
    s.stop();
    expect(context.suspended, 'let go with the fade: the graph rests (no output held while idle)').toBe(1);
  });

  it('outside a crossfade, and at a manual Go’s cut, its sound is never taken: it plays as before', () => {
    const v = new SlowPicture(30);
    const { context, graph } = runningGraph();
    const s = playedOn(v, { now: null }, graph);
    runFor(1000);
    s.pair(null);
    s.pair(crossfade(Date.now() + 120, 0));
    runFor(1000);
    expect(context.made).toBe(0);
    expect(v.muted, 'muted, as every picture plays').toBe(true);
    s.stop();
    expect(context.suspended).toBe(0);
  });
});
