import { describe, expect, it } from 'vitest';
import {
  LEAD_MS,
  MAX_OFFSET_MS,
  type Motion,
  type MotionFrame,
  motionRuns,
  onPlan,
  parseMotion,
  parseMovieInfo,
  planCuts,
} from './cut';
import { HOLD_SETTLE_MS, type MoviePlan, plannedLength, plannedStarts, POWERPOINT_SETTLE_MS } from './plan';

/*
 * Cutting a deck's movie (Session 54, C2): each slide found by its transition, each step cut just before its
 * motion, measured where it can be seen, a hold cut where something turns for ever, and a step more than 0.2 s off
 * its plan sending the deck back to pictures. The movies here are made of numbers: what FFmpeg would say of each
 * frame of a movie that plays the plan (shifted where a test asks).
 */

const FPS = 30;
const FRAME = 1000 / FPS;

/** A plan of three slides: one with two clicks, one with a spin and a click, one with a sound only. */
const PLAN: MoviePlan = {
  baker: 'powerpoint',
  settleMs: POWERPOINT_SETTLE_MS,
  slides: [
    {
      index: 0,
      transitionName: 'p:fade',
      transitionMs: 700,
      groups: [
        { startMs: 400, endMs: 900 },
        { startMs: 1300, endMs: 1800 },
      ],
      steps: [
        { byClick: false, startMs: 0, endMs: 0, holdMs: null, still: true },
        { byClick: true, startMs: 400, endMs: 900, holdMs: null, still: false },
        { byClick: true, startMs: 1300, endMs: 1800, holdMs: null, still: false },
      ],
      advanceMs: 2600,
      endlessUntilMs: null,
    },
    {
      index: 1,
      transitionName: 'p:wipe',
      transitionMs: 800,
      groups: [
        { startMs: 0, endMs: 2000 },
        { startMs: 4500, endMs: 5200 },
      ],
      steps: [
        { byClick: false, startMs: 0, endMs: 2000, holdMs: 2000, still: false },
        { byClick: true, startMs: 4500, endMs: 5200, holdMs: 2000, still: false },
      ],
      advanceMs: 10100,
      endlessUntilMs: 7300,
    },
    {
      index: 3,
      transitionName: 'p14:vortex',
      transitionMs: 1500,
      groups: [
        { startMs: 0, endMs: 0 },
        { startMs: 400, endMs: 400 },
      ],
      steps: [
        { byClick: false, startMs: 0, endMs: 0, holdMs: null, still: true },
        { byClick: true, startMs: 400, endMs: 400, holdMs: null, still: true },
      ],
      advanceMs: 1200,
      endlessUntilMs: null,
    },
  ],
};

/**
 * What FFmpeg says of each frame of a movie that plays `plan`: a big change through each transition, a small one
 * through each step's motion (a bullet fading in), something turning for ever from a holding step on, nothing
 * otherwise. `shift` moves a step's motion (by shown slide and step) by so many ms.
 */
function motionOf(plan: MoviePlan, shift: Record<string, number> = {}, lose: number[] = []): Motion {
  const starts = plannedStarts(plan);
  const total = plannedLength(plan);
  const frames: MotionFrame[] = [];
  for (let t = FRAME; t <= total; t += FRAME) {
    let avg = 0;
    let max = 0;
    plan.slides.forEach((s, i) => {
      const start = starts[i] ?? 0;
      const next = starts[i + 1] ?? total;
      if (t <= start || t > next) return;
      if (t <= start + s.transitionMs && !lose.includes(i)) {
        avg = Math.max(avg, 6);
        max = 255;
      }
      const timeline = start + s.transitionMs + plan.settleMs;
      s.steps.forEach((step, k) => {
        if (step.still || step.endMs === step.startMs) return;
        const by = shift[`${String(i)}:${String(k)}`] ?? 0;
        if (t > timeline + step.startMs + by && t <= timeline + step.endMs + by) {
          avg = Math.max(avg, 0.1);
          max = Math.max(max, 40);
        }
        // It turns until the last hold is cut, in whole turns, as the timed copy has it.
        const stops =
          step.holdMs && s.endlessUntilMs !== null
            ? step.startMs + Math.ceil((s.endlessUntilMs - step.startMs) / step.holdMs) * step.holdMs
            : 0;
        if (step.holdMs && t > timeline + step.startMs && t <= timeline + stops) {
          avg = Math.max(avg, 0.3);
          max = Math.max(max, 90);
        }
      });
    });
    frames.push({ t: Math.round(t), avg, max });
  }
  return { frames, durationMs: total, width: 1920, height: 1080, fps: FPS };
}

describe('reading what FFmpeg says of a movie', () => {
  it('reads each frame’s time and difference, and the movie’s size, rate and length', () => {
    const out = [
      'frame:0    pts:1       pts_time:0.0333333',
      'lavfi.signalstats.YMIN=0',
      'lavfi.signalstats.YAVG=0.000000',
      'lavfi.signalstats.YMAX=0',
      'frame:1    pts:2       pts_time:0.0666667',
      'lavfi.signalstats.YAVG=4.25',
      'lavfi.signalstats.YMAX=231',
      // A still frame's tiny difference, as FFmpeg writes it (PowerPoint's movie, measured).
      'frame:220  pts:4376    pts_time:7.293333',
      'lavfi.signalstats.YAVG=9.64506e-05',
      'lavfi.signalstats.YMAX=1',
    ].join('\n');
    expect(parseMotion(out)).toEqual([
      { t: 33, avg: 0, max: 0 },
      { t: 67, avg: 4.25, max: 231 },
      { t: 7293, avg: 0.0000964506, max: 1 },
    ]);
    const err =
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'movie.mov':\n  Duration: 00:01:28.03, start: 0.000000, bitrate: 6043 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080, 6000 kb/s, 30 fps, 30 tbr, 30k tbn (default)";
    expect(parseMovieInfo(err)).toEqual({ durationMs: 88_030, width: 1920, height: 1080, fps: 30 });
  });

  it('runs of moving frames bridge one still frame, and a lone flicker is a run of one', () => {
    const f = (t: number, avg: number) => ({ t, avg, max: 0 });
    expect(motionRuns([f(33, 0), f(67, 1), f(100, 0), f(133, 2), f(167, 0), f(200, 0), f(233, 0.5)])).toEqual(
      [
        { startMs: 67, endMs: 133, peak: 2, frames: 2 },
        { startMs: 233, endMs: 233, peak: 0.5, frames: 1 },
      ],
    );
  });
});

describe('cutting a movie into its steps', () => {
  it('finds each slide by its transition and each step at its moment, cutting just before each motion', () => {
    const cuts = planCuts(PLAN, motionOf(PLAN));
    expect(onPlan(cuts)).toBe(true);
    expect(cuts.lostSlides).toEqual([]);
    const starts = plannedStarts(PLAN);
    // Slide 1: its transition from the movie's start, then each click just before its motion.
    const one = cuts.slides[0]?.steps ?? [];
    const timeline = (starts[0] ?? 0) + 700 + POWERPOINT_SETTLE_MS;
    const want = [0, timeline + 400 - LEAD_MS, timeline + 1300 - LEAD_MS];
    // Within a frame (the movie's frames are 33 ms apart), and never after the motion's moment.
    one.forEach((s, k) => {
      expect(Math.abs(s.fromMs - (want[k] ?? 0))).toBeLessThanOrEqual(FRAME);
      expect(s.fromMs).toBeLessThanOrEqual((want[k] ?? 0) + 1);
    });
    // Each clip runs to the next one's start; the last to the next slide.
    expect(one[0]?.toMs).toBe(one[1]?.fromMs);
    expect(Math.abs((one[2]?.toMs ?? 0) - ((starts[1] ?? 0) - FRAME))).toBeLessThanOrEqual(FRAME);
    expect(one[0]?.transitionMs).toBe(700);
    // Every step it could see was found within a frame of its moment.
    const seen = cuts.offsets.filter((o) => o.offsetMs !== null);
    expect(seen.map((o) => [o.slide, o.step])).toEqual([
      [0, 1],
      [0, 2],
    ]);
    expect(seen.every((o) => Math.abs(o.offsetMs ?? 0) <= FRAME)).toBe(true);
  });

  it('cuts a one-turn hold after a step that ends with something turning for ever', () => {
    const cuts = planCuts(PLAN, motionOf(PLAN));
    const starts = plannedStarts(PLAN);
    const timeline = (starts[1] ?? 0) + 800 + POWERPOINT_SETTLE_MS;
    const [enter, click] = cuts.slides[1]?.steps ?? [];
    // Its own effects done, then one turn (2 s) of the spin, before the next click's clip (the slide found within a
    // frame of its moment).
    expect(Math.abs((enter?.toMs ?? 0) - (timeline + 2000 + HOLD_SETTLE_MS))).toBeLessThanOrEqual(FRAME);
    expect(enter?.hold).toEqual({ fromMs: enter?.toMs, toMs: (enter?.toMs ?? 0) + 2000 });
    expect(click?.hold?.toMs).toBe((click?.hold?.fromMs ?? 0) + 2000);
    // The spin hides when a step starts there: its plan, as it is (not measured).
    expect(cuts.offsets.find((o) => o.slide === 1 && o.step === 1)?.offsetMs).toBeNull();
    expect(Math.abs((click?.fromMs ?? 0) - (timeline + 4500 - LEAD_MS))).toBeLessThanOrEqual(FRAME);
  });

  it('gives a step with nothing to see (it only starts a video or sound) a clip after the step before', () => {
    const cuts = planCuts(PLAN, motionOf(PLAN));
    const [enter, click] = cuts.slides[2]?.steps ?? [];
    expect(enter?.transitionMs).toBe(1500);
    expect((click?.fromMs ?? 0) > (enter?.fromMs ?? 0)).toBe(true);
    expect(cuts.offsets.find((o) => o.slide === 2 && o.step === 1)?.offsetMs).toBeNull();
  });

  it('a step 0.3 s off its plan sends the deck back to pictures; one 0.1 s off is cut at its own moment', () => {
    const late = planCuts(PLAN, motionOf(PLAN, { '0:2': 300 }));
    expect(onPlan(late)).toBe(false);
    expect(late.worst).toMatchObject({ slide: 0, step: 2 });
    expect(Math.abs((late.worst?.offsetMs ?? 0) - 300)).toBeLessThanOrEqual(FRAME);
    expect(Math.abs(late.worst?.offsetMs ?? 0)).toBeGreaterThan(MAX_OFFSET_MS);
    const early = planCuts(PLAN, motionOf(PLAN, { '0:1': -100 }));
    expect(onPlan(early)).toBe(true);
    const starts = plannedStarts(PLAN);
    const timeline = (starts[0] ?? 0) + 700 + POWERPOINT_SETTLE_MS;
    // A step that starts early is cut before it, not in it.
    expect((early.slides[0]?.steps[1]?.fromMs ?? 0) <= timeline + 300 - LEAD_MS + FRAME).toBe(true);
  });

  it('a slide whose transition is nowhere near its moment sends the deck back to pictures', () => {
    const cuts = planCuts(PLAN, motionOf(PLAN, {}, [2]));
    expect(cuts.lostSlides).toEqual([2]);
    expect(onPlan(cuts)).toBe(false);
  });
});
