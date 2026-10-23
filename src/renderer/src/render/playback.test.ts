import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackClip, PlaybackSeek } from '../../../shared/media';
import { PICTURE_LIMITS, playbackOffset, playbackPosition, SOUND_LIMITS } from '../../../shared/media';
import { startPlayback } from './playback';

/*
 * A file played once with an end point stops there (Session 15): within two
 * frames of it, whatever the quarter-second checks are doing. A file that
 * loops goes round in step, and a sound that starts late is brought into step
 * at once (Sessions 31–36). A sound the engine sends somewhere new (a skip or a
 * jump to a marker) lands in step there, and is aimed again if it lands off
 * (Session 51), and so does a screen's picture (Session 52). A stand-in media
 * element plays on the test's clock (fake timers drive Date.now,
 * performance.now and the timers alike); at its own end it pauses and is
 * `ended`, as a real one is (Session 51).
 */

const FRAME = 1 / 60;

class FakeMedia extends EventTarget {
  duration = NaN;
  seeking = false;
  readyState = 0;
  loop = false;
  muted = false;
  /** How many seeks it has been sent (Session 52: how many times it was aimed). */
  seeks = 0;
  private rate = 1;
  /** Where it was at `since` (Date.now()). */
  private base = 0;
  private since = 0;
  /** Paused by pause(), or by playing to its own end (Session 51: as a real element is, there). */
  private stopped = true;

  /**
   * `restart`: its own loop comes round this late (seconds), as a real element's does. `startLate`: it
   * plays this long (ms) after play() is called, as a busy computer's sound device does. `landOff`: each
   * seek in turn lands this far from where it was aimed (seconds, + ahead), as CI's Mac's sometimes do.
   * `seekMs`: how long a seek takes to land (5 ms when left out; about 0.1 s for CI's Windows's sound).
   */
  constructor(
    private readonly length: number,
    private readonly lags: { restart?: number; startLate?: number; landOff?: number[]; seekMs?: number } = {},
  ) {
    super();
  }

  /** Where it plays on to from `base`, before its own end stops it. */
  private running(): number {
    return this.base + (Math.max(0, Date.now() - this.since) / 1000) * this.rate;
  }

  /** Played on to its own end, not looping: stopped there, as a real element is the moment it gets there. */
  private stopAtEnd(): void {
    if (!this.stopped && !this.seeking && !this.loop && this.running() >= this.length) {
      this.base = this.length;
      this.stopped = true;
    }
  }

  /** A real element playing once to its own end pauses there, and stays paused after a seek away. */
  get paused(): boolean {
    this.stopAtEnd();
    return this.stopped;
  }

  /** At its own end, played once: a seek away clears it at once (Chromium's position is the seek's). */
  get ended(): boolean {
    return !this.loop && this.readyState >= 1 && this.currentTime >= this.length;
  }

  get currentTime(): number {
    if (this.paused || this.seeking) return this.base;
    const at = this.running();
    if (!this.loop || at < this.length) return Math.min(this.length, at);
    // Its own loop: back to the start, `restart` late each time round.
    const late = this.lags.restart ?? 0;
    const lap = this.length + late;
    const into = (at - this.length) % lap;
    return into < late ? 0 : into - late;
  }

  set currentTime(value: number) {
    // A seek finds it as it is: stopped at its own end if it got there meanwhile (and it stays paused).
    this.stopAtEnd();
    this.seeks++;
    this.base = Math.max(0, Math.min(this.length, value + (this.lags.landOff?.shift() ?? 0)));
    this.seeking = true;
    setTimeout(() => {
      this.seeking = false;
      this.since = Date.now();
      this.dispatchEvent(new Event('seeked'));
    }, this.lags.seekMs ?? 5);
  }

  get playbackRate(): number {
    return this.rate;
  }

  set playbackRate(value: number) {
    this.base = this.currentTime;
    this.since = Date.now();
    this.rate = value;
    this.dispatchEvent(new Event('ratechange'));
  }

  set src(_url: string) {
    setTimeout(() => {
      this.duration = this.length;
      this.readyState = 4;
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('loadeddata'));
    }, 10);
  }

  play(): Promise<void> {
    if (this.paused) {
      // At its own end, a real element starts again from the top.
      if (this.ended) this.currentTime = 0;
      this.since = Date.now() + (this.lags.startLate ?? 0);
      this.stopped = false;
      setTimeout(() => this.dispatchEvent(new Event('playing')), 0);
    }
    return Promise.resolve();
  }

  pause(): void {
    if (this.paused) return;
    this.base = this.currentTime;
    this.stopped = true;
  }

  /** Letting go of the file: nothing to let go of here. */
  load(): void {
    this.readyState = 0;
  }

  removeAttribute(): void {
    this.duration = NaN;
  }
}

/** Run the clock on in 1 ms steps, noting the furthest the file got. */
function runFor(v: FakeMedia, ms: number): number {
  let furthest = 0;
  for (let i = 0; i < ms; i++) {
    vi.advanceTimersByTime(1);
    furthest = Math.max(furthest, v.currentTime);
  }
  return furthest;
}

describe('a file played once to an end point', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    });
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const play = (v: FakeMedia, timing: { clip: PlaybackClip; seek?: PlaybackSeek }) =>
    startPlayback(v as unknown as HTMLMediaElement, {
      mediaId: 'clip',
      startedAt: Date.now(),
      timing: () => ({ loop: false, ...timing }),
    });

  it('stops within a frame of its end point, between the checks', () => {
    // 2.137 s falls between two quarter-second checks: the next one would come 0.11 s past it.
    const v = new FakeMedia(6);
    const stop = play(v, { clip: { startMs: 0, endMs: 2137 } });
    const furthest = runFor(v, 3000);
    expect(furthest).toBeLessThanOrEqual(2.137 + 2 * FRAME);
    expect(v.paused).toBe(true);
    expect(Math.abs(v.currentTime - 2.137)).toBeLessThanOrEqual(FRAME);
    stop();
  });

  it('holds there while the clock catches up, and plays again after a jump back', () => {
    const v = new FakeMedia(6);
    const timing: { clip: PlaybackClip; seek?: PlaybackSeek } = { clip: { startMs: 0, endMs: 1630 } };
    const stop = play(v, timing);
    expect(runFor(v, 2500)).toBeLessThanOrEqual(1.63 + 2 * FRAME);
    expect(v.paused).toBe(true);
    // A jump to a marker at 1.0 s: it plays from there and stops at the end point again.
    timing.seek = { at: Date.now(), toMs: 1000 };
    stop.resync();
    runFor(v, 300);
    expect(v.paused).toBe(false);
    expect(v.currentTime).toBeGreaterThan(1.0);
    expect(v.currentTime).toBeLessThan(1.5);
    expect(runFor(v, 1500)).toBeLessThanOrEqual(1.63 + 2 * FRAME);
    expect(v.paused).toBe(true);
    expect(Math.abs(v.currentTime - 1.63)).toBeLessThanOrEqual(FRAME);
    stop();
  });

  it('held at its end point, a sound or a picture sent a little way back plays that last stretch, in step', () => {
    // Session 51: a marker 0.3 s before its end point. Short of the 0.5 s that makes a sound jump, it was taken for
    // one that got to its end point a moment before the clock, and held there: silent while the clock played on.
    // Session 52: a screen's picture too, 0.2 s back (short of its quarter of a second), held frozen meanwhile.
    for (const [what, limits, backMs] of [
      ['a sound', SOUND_LIMITS, 300],
      ['a picture', undefined, 200],
    ] as const) {
      const v = new FakeMedia(30);
      const timing: { clip: PlaybackClip; seek?: PlaybackSeek } = { clip: { startMs: 0, endMs: 10_000 } };
      const stop = startPlayback(v as unknown as HTMLMediaElement, {
        mediaId: 'clip',
        startedAt: Date.now(),
        audible: limits !== undefined,
        ...(limits ? { limits } : {}),
        timing: () => ({ loop: false, ...timing }),
      });
      runFor(v, 11_000);
      expect(v.paused, `${what}: held at its end point`).toBe(true);
      const back = { at: Date.now(), toMs: 10_000 - backMs };
      timing.seek = back;
      stop.resync();
      runFor(v, 150);
      const off = v.currentTime - (back.toMs + Date.now() - back.at) / 1000;
      expect(v.paused, `${what}: playing its last ${String(backMs / 1000)} s`).toBe(false);
      expect(Math.abs(off), `${what}: ${off.toFixed(3)} s off the clock`).toBeLessThan(2 / 30);
      // And held at its end point again.
      runFor(v, 500);
      expect(v.paused, what).toBe(true);
      expect(Math.abs(v.currentTime - 10), what).toBeLessThanOrEqual(FRAME);
      stop();
    }
  });

  it('starts held when it joins after the end point', () => {
    const v = new FakeMedia(6);
    const stop = startPlayback(v as unknown as HTMLMediaElement, {
      mediaId: 'clip',
      startedAt: Date.now() - 4000,
      timing: () => ({ loop: false, clip: { startMs: 0, endMs: 1500 } }),
    });
    expect(runFor(v, 600)).toBeLessThanOrEqual(1.5 + FRAME);
    expect(v.paused).toBe(true);
    expect(Math.abs(v.currentTime - 1.5)).toBeLessThanOrEqual(FRAME);
    stop();
  });

  it('goes straight to its own end when a jump takes it there, holds it, and plays again from a jump back', () => {
    // Session 50: Forward 15 s within the last 15 s of a 30 s sound, 2 s in; then Back 15 s from the end.
    for (const limits of [undefined, SOUND_LIMITS]) {
      const v = new FakeMedia(30);
      const timing: { seek?: PlaybackSeek } = {};
      const stop = startPlayback(v as unknown as HTMLMediaElement, {
        mediaId: 'once',
        startedAt: Date.now(),
        audible: limits !== undefined,
        ...(limits ? { limits } : {}),
        timing: () => ({ loop: false, ...timing }),
      });
      runFor(v, 2000);
      timing.seek = { at: Date.now(), toMs: 30_000 };
      stop.resync();
      runFor(v, 300);
      expect(Math.abs(v.currentTime - 30), 'at its end at once, not playing on to it').toBeLessThanOrEqual(
        FRAME,
      );
      expect(runFor(v, 2000)).toBeLessThanOrEqual(30);
      expect(Math.abs(v.currentTime - 30)).toBeLessThanOrEqual(FRAME);
      timing.seek = { at: Date.now(), toMs: 15_000 };
      stop.resync();
      runFor(v, 600);
      expect(v.paused).toBe(false);
      expect(v.currentTime).toBeGreaterThan(15.2);
      expect(v.currentTime).toBeLessThan(16);
      stop();
    }
  });

  it('held at its own end, plays again from a jump back in step from the moment it lands, not a check later', () => {
    // Session 51 (S6-1): held at its own end, a real element is `ended`, and play() there starts it again from
    // the top, so it waited for the next quarter-second check: it froze up to a quarter of a second more, at a
    // different moment on each screen, and then had to catch up.
    for (const limits of [undefined, SOUND_LIMITS])
      for (const how of ['played to its end', 'Forward 15 s to its end'] as const) {
        const what = `${limits ? 'a sound' : 'a picture'}, ${how}`;
        const v = new FakeMedia(20);
        const timing: { seek?: PlaybackSeek } = {};
        const stop = startPlayback(v as unknown as HTMLMediaElement, {
          mediaId: 'once',
          startedAt: Date.now(),
          audible: limits !== undefined,
          ...(limits ? { limits } : {}),
          timing: () => ({ loop: false, ...timing }),
        });
        if (how === 'played to its end') runFor(v, 21_000);
        else {
          runFor(v, 2000);
          timing.seek = { at: Date.now(), toMs: 20_000 };
          stop.resync();
          runFor(v, 1000);
        }
        expect(v.paused && v.ended, `${what}: held there`).toBe(true);
        // Back 15 s: to 0:05, from now. A seek takes 5 ms here; from then on it is where the clock says.
        const back = { at: Date.now(), toMs: 5000 };
        timing.seek = back;
        stop.resync();
        vi.advanceTimersByTime(10);
        let furthest = 0;
        for (let i = 0; i < 1500; i++) {
          vi.advanceTimersByTime(1);
          const clock = (back.toMs + Date.now() - back.at) / 1000;
          furthest = Math.max(furthest, Math.abs(v.currentTime - clock));
        }
        expect(furthest, `${what}: furthest from the clock after Back (s)`).toBeLessThan(1 / 30);
        expect(v.paused, what).toBe(false);
        stop();
      }
  });
});

describe('a file that loops, and a sound that starts late', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    });
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** How far it is from where the clock says (seconds, + ahead), a loop's end and start being near. */
  const offset = (v: FakeMedia, startedAt: number, length: number, loop: boolean) =>
    playbackOffset(
      v.currentTime,
      loop ? ((Date.now() - startedAt) / 1000) % length : (Date.now() - startedAt) / 1000,
      length,
      loop,
    );

  it('a looping sound goes round in step each time: by a jump aimed from the clock, not its own loop, which comes round late', () => {
    // A 2 s file whose element's own loop comes round 0.25 s late (a sound, on a Mac: 0.2 to 0.3 s).
    const v = new FakeMedia(2, { restart: 0.25 });
    v.loop = true;
    const startedAt = Date.now();
    const stop = startPlayback(v as unknown as HTMLMediaElement, {
      mediaId: 'loop',
      startedAt,
      audible: true,
      limits: SOUND_LIMITS,
      timing: () => ({ loop: true }),
    });
    runFor(v, 1000);
    // Half a second after each of three times round: within two frames of the clock.
    const seen: number[] = [];
    for (let turn = 0; turn < 3; turn++) {
      runFor(v, 2000);
      seen.push(offset(v, startedAt, 2, true));
    }
    expect(
      seen.every((o) => Math.abs(o) < 2 / 30),
      `offsets after each loop: ${seen.map((o) => o.toFixed(3)).join(' ')}`,
    ).toBe(true);
    stop();
  });

  it('a loop that lands off is aimed again, whatever the landings before it used up', () => {
    // A 2 s sound already 0.5 s in: its first landing and the two aimed again after it all land 0.2 s ahead,
    // and the loop comes round before the last of them is measured; that loop's landing is 0.2 s ahead too.
    const v = new FakeMedia(2, { landOff: [0.2, 0.2, 0.2, 0.2] });
    v.loop = true;
    const startedAt = Date.now() - 500;
    const stop = startPlayback(v as unknown as HTMLMediaElement, {
      mediaId: 'lands-off',
      startedAt,
      audible: true,
      limits: SOUND_LIMITS,
      timing: () => ({ loop: true }),
    });
    runFor(v, 2600);
    // About 1.3 s after it went round: in step, not left 0.2 s off to come back at 2% a second.
    const off = offset(v, startedAt, 2, true);
    expect(Math.abs(off), `${off.toFixed(3)} s off the clock after the loop`).toBeLessThan(2 / 30);
    stop();
  });

  it('a sound that starts 0.3 s late is in step within a second, not left to catch up at 2% a second', () => {
    const v = new FakeMedia(30, { startLate: 300 });
    const startedAt = Date.now();
    const stop = startPlayback(v as unknown as HTMLMediaElement, {
      mediaId: 'late',
      startedAt,
      audible: true,
      limits: SOUND_LIMITS,
      timing: () => ({ loop: false }),
    });
    runFor(v, 1500);
    const off = offset(v, startedAt, 30, false);
    expect(Math.abs(off), `${off.toFixed(3)} s off the clock`).toBeLessThan(2 / 30);
    stop();
  });

  it('a loop to the file’s own end whose turn round comes late plays on from its start at once, not a check later', () => {
    // Session 51: with start and end points the element's own loop is off, so a turn round held up past the
    // file's own end (a busy moment) found it stopped there, and its jump left it paused until the next check:
    // up to a quarter of a second frozen, and silent in the audio player.
    for (const limits of [undefined, SOUND_LIMITS]) {
      const what = limits ? 'a sound' : 'a picture';
      const v = new FakeMedia(4);
      v.loop = true;
      const startedAt = Date.now();
      const clip = { startMs: 1000, endMs: null };
      const stop = startPlayback(v as unknown as HTMLMediaElement, {
        mediaId: 'loop-to-its-end',
        startedAt,
        audible: limits !== undefined,
        ...(limits ? { limits } : {}),
        timing: () => ({ loop: true, clip }),
      });
      // A moment before the file's own end (0:04), its turn round waiting.
      for (let i = 0; i < 10_000 && v.currentTime < 3.98; i++) vi.advanceTimersByTime(1);
      // Busy for 40 ms: the turn round comes once the file has stopped at its end.
      vi.setSystemTime(Date.now() + 40);
      vi.advanceTimersByTime(30);
      let furthest = 0;
      for (let i = 0; i < 400; i++) {
        vi.advanceTimersByTime(1);
        const clock = playbackPosition({ startedAt, loop: true, clip }, 4, Date.now());
        furthest = Math.max(furthest, Math.abs(playbackOffset(v.currentTime, clock, 3, true)));
      }
      expect(furthest, `${what}: furthest from the clock after its turn round (s)`).toBeLessThan(1 / 30);
      expect(v.paused, what).toBe(false);
      stop();
    }
  });
});

describe('a sound or a picture the engine sends somewhere new: a skip or a jump to a marker (Sessions 51 and 52)', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    });
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** In step: within two frames (at 30 a second) of the clock. */
  const IN_STEP = 2 / 30;

  /**
   * The audio player's sound, and a screen's picture (Session 52: it was left as it was, after a quick skip up to
   * 0.45 s ahead for a moment, or a seek's time behind, easing back). `shortMs`: a jump less far than the one that
   * makes it jump (half a second for a sound, a quarter for a picture).
   */
  const KINDS = [
    { what: 'a sound', audible: true, limits: SOUND_LIMITS, shortMs: 300 },
    { what: 'a picture', audible: false, limits: PICTURE_LIMITS, shortMs: 200 },
  ] as const;
  type Kind = (typeof KINDS)[number];

  /** A 40 s file played once, which the engine sends somewhere new as a skip or a jump to a marker does. */
  const played = (v: FakeMedia, kind: Kind) => {
    const timing: { seek?: PlaybackSeek } = {};
    const startedAt = Date.now();
    const playback = startPlayback(v as unknown as HTMLMediaElement, {
      mediaId: 'skipped',
      startedAt,
      audible: kind.audible,
      limits: kind.limits,
      timing: () => ({ loop: false, ...timing }),
    });
    /** Where the clock says it is (ms into it). */
    const clockMs = () => playbackPosition({ startedAt, loop: false, ...timing }, 40, Date.now()) * 1000;
    return {
      stop: playback,
      clockMs,
      /** How far it is from the clock (seconds, + ahead). */
      offset: () => v.currentTime - clockMs() / 1000,
      /**
       * The engine sends it to `toMs` from now, and its window checks it at once (as audio/main.ts does for a
       * sound, and BackgroundMedia.tsx for a screen's video).
       */
      jumpTo: (toMs: number) => {
        timing.seek = { at: Date.now(), toMs };
        playback.resync();
      },
    };
  };

  it('a skip pressed a moment after the last one landed lands in step, not 0.4 s ahead (the skips spec on Windows)', () => {
    // Its seeks take 0.1 s to land. Pressed as quickly as CI pressed them, each skip came before the last landing
    // was measured (300 ms after it), which was then measured from the new place: 15 or 30 s off, a lead learned
    // from that reached its 0.5 s cap, and the next jump landed 0.4 s ahead, a sound eased back at 2% a second
    // (Session 51), a picture aimed again at its next check (Session 52).
    for (const kind of KINDS) {
      const v = new FakeMedia(40, { seekMs: 100 });
      const s = played(v, kind);
      runFor(v, 2000);
      // Back 15 s to the start, Last 10 s, Back 15 s and Forward 15 s, as far apart as CI's trace has them (ms).
      const skips: [string, (ms: number) => number, number][] = [
        ['Back 15 s', (ms) => Math.max(0, ms - 15_000), 472],
        ['Last 10 s', () => 30_000, 888],
        ['Back 15 s', (ms) => Math.max(0, ms - 15_000), 464],
        ['Forward 15 s', (ms) => ms + 15_000, 1500],
      ];
      const landed: number[] = [];
      const seen: string[] = [];
      for (const [name, to, apart] of skips) {
        s.jumpTo(to(s.clockMs()));
        // Landed, and not yet measured or aimed again.
        runFor(v, 250);
        const off = s.offset();
        landed.push(off);
        seen.push(`${name} ${off.toFixed(3)}`);
        runFor(v, apart - 250);
      }
      // The first, aimed by nothing learned yet, lands a seek's time behind; each after it lands in step.
      expect(
        landed.slice(1).every((o) => Math.abs(o) < IN_STEP),
        `${kind.what}: offsets as each landed: ${seen.join(', ')}`,
      ).toBe(true);
      const off = s.offset();
      expect(
        Math.abs(off),
        `${kind.what}: ${off.toFixed(3)} s off the clock 1.5 s after Forward 15 s`,
      ).toBeLessThan(IN_STEP);
      s.stop();
    }
  });

  it('a skip that lands off is aimed again, whatever the landings before it used up', () => {
    // Every landing until the fifth is 0.2 s ahead of where it was aimed: a jump to a marker at 0:20 and the two
    // aimed again after it (as many as there are in a row), then Back 15 s, pressed before the last of those was
    // measured. Its own landing, 0.2 s off too, is aimed again, not left to come back at 2% a second (a sound) or
    // 5% (a picture, Session 52).
    for (const kind of KINDS) {
      const v = new FakeMedia(40, { landOff: [0.2, 0.2, 0.2, 0.2] });
      const s = played(v, kind);
      runFor(v, 2000);
      s.jumpTo(20_000);
      runFor(v, 1100);
      s.jumpTo(s.clockMs() - 15_000);
      runFor(v, 1500);
      const off = s.offset();
      expect(
        Math.abs(off),
        `${kind.what}: ${off.toFixed(3)} s off the clock 1.5 s after Back 15 s`,
      ).toBeLessThan(IN_STEP);
      s.stop();
    }
  });

  it('a skip pressed again while its seek is still landing lands in step: that landing is not measured', () => {
    // Its seeks take 0.1 s to land, which a skip a while before has taught it. Forward 15 s pressed twice, 50 ms
    // apart: the first one's seek lands after the second press, aimed at the place before it. Measured from the
    // new place, 15 s off, it taught a lead at its 0.5 s cap, and the second jump landed 0.4 s ahead.
    for (const kind of KINDS) {
      const v = new FakeMedia(40, { seekMs: 100 });
      const s = played(v, kind);
      runFor(v, 2000);
      s.jumpTo(0);
      runFor(v, 2000);
      s.jumpTo(s.clockMs() + 15_000);
      runFor(v, 50);
      s.jumpTo(s.clockMs() + 15_000);
      // Both seeks landed (the second made at the next check), and not yet measured or aimed again.
      runFor(v, 400);
      const off = s.offset();
      expect(Math.abs(off), `${kind.what}: ${off.toFixed(3)} s off the clock as it landed`).toBeLessThan(
        IN_STEP,
      );
      s.stop();
    }
  });

  it('a jump shorter than the one that makes it jump lands by a jump too, not eased at 2% a second (or 5%)', () => {
    // A jump to a marker 0.3 s before where a sound plays: short of the 0.5 s that makes a sound jump, it was left
    // to come back at 2% a second, 15 s. A picture 0.2 s (short of its quarter of a second, Session 52): 4 s at 5%.
    for (const kind of KINDS) {
      const v = new FakeMedia(40);
      const s = played(v, kind);
      runFor(v, 2000);
      s.jumpTo(s.clockMs() - kind.shortMs);
      runFor(v, 1000);
      const off = s.offset();
      expect(
        Math.abs(off),
        `${kind.what}: ${off.toFixed(3)} s off the clock a second after the jump`,
      ).toBeLessThan(IN_STEP);
      s.stop();
    }
  });

  it('asked to check before its first frame (as BackgroundMedia.tsx asks as it mounts), it starts just as it would have', () => {
    // Session 52: what a jump starts afresh (its re-aims, a short jump landed by a jump) is not for a file still
    // loading: its start is aimed by the clock and measured as a start is, on every screen, whenever it mounts.
    for (const kind of KINDS) {
      const landings = [false, true].map((asked) => {
        // Joined 2 s in (a screen that opens late): it starts by a seek there, which takes 0.1 s.
        const v = new FakeMedia(40, { seekMs: 100 });
        const startedAt = Date.now();
        const playback = startPlayback(v as unknown as HTMLMediaElement, {
          mediaId: 'joined',
          startedAt: startedAt - 2000,
          audible: kind.audible,
          limits: kind.limits,
          timing: () => ({ loop: false }),
        });
        if (asked) playback.resync();
        // When each seek lands (ms), and where.
        const seen: string[] = [];
        v.addEventListener('seeked', () => {
          seen.push(`${String(Date.now() - startedAt)} ${v.currentTime.toFixed(3)}`);
        });
        runFor(v, 2000);
        playback();
        return seen;
      });
      expect(landings[1], `${kind.what}: its landings, asked and not`).toEqual(landings[0]);
    }
  });

  it('a picture whose seeks land 0.15 s off, either way, stops jumping a moment after a skip: no hunting', () => {
    // Sessions 31–36: CI's Mac, short of time, landed its seeks 0.1 to 0.2 s off either way, and aiming a picture
    // again whenever it drifted made a loop test worse. A skip (Session 52) lands by a jump and may be aimed again
    // twice in a row, as a start and each time round a loop may, and jumps once more only if it is then more than
    // a quarter of a second off: then it is left to its speed, however far off it landed.
    const v = new FakeMedia(40, {
      landOff: Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 0.15 : -0.15)),
    });
    const s = played(v, KINDS[1]);
    runFor(v, 2000);
    const before = v.seeks;
    s.jumpTo(20_000);
    runFor(v, 2000);
    const jumped = v.seeks - before;
    runFor(v, 3000);
    expect(jumped, 'seeks in the 2 s after the skip').toBeLessThanOrEqual(4);
    expect(v.seeks - before - jumped, 'seeks from then on, for 3 s').toBe(0);
    s.stop();
  });
});
