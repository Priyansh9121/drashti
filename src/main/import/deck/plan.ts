import type { PptxSlide } from '../pictures';
import type { PptxGroup } from './pptx-deck';

/*
 * When each step of a deck's movie happens (Session 54, C2, from C1's trial: assister/session-54-deck-trial.md,
 * "Way 2"). The cut (./cut.ts) finds each slide in the movie by its transition, then cuts each step at its planned
 * moment, and checks the moments it can see against the plan.
 *
 * - PowerPoint plays the timed copy (./timed-copy.ts): each click group runs by itself, GAP_MS after the group
 *   before it ends, and the slide moves on TAIL_MS after its last group. A group after which something repeats
 *   until the slide ends (a spin) waits one turn more, so a one-turn hold can be cut from the stillness around it.
 *   A slide's own timeline starts about 60 ms after its transition ends (SETTLE_MS, as measured).
 * - Keynote plays the deck itself at its own fixed timing: each click comes 2.0 s after the build before it ends,
 *   automatic builds keep their own delays, the next slide's transition comes 5.0 s after the last build ends (or
 *   after the transition, on a slide with no builds), and there is no transition into the first slide. Builds that
 *   only started a video or sound are gone (Drashti deleted those from Keynote's copy first).
 * - The stand-in (tests) plays the plan PowerPoint's copy has, exactly.
 */

/** Stillness before each click in PowerPoint's timed copy: a step is cut in it. */
export const GAP_MS = 400;
/** Stillness after a slide's last step in the timed copy, before it moves on. */
export const TAIL_MS = 800;
/** PowerPoint starts a slide's own timeline this long after its transition ends (C1 measured about 60 ms). */
export const POWERPOINT_SETTLE_MS = 60;
/** After a step that ends with something turning for ever: its own effects' last moment, before its hold. */
export const HOLD_SETTLE_MS = 100;
/** Keynote's movie: each click this long after the build before it ends. */
export const KEYNOTE_CLICK_MS = 2000;
/** Keynote's movie: the next slide this long after the last build ends. */
export const KEYNOTE_NEXT_MS = 5000;

export type Baker = 'powerpoint' | 'keynote' | 'stand-in';

export interface PlannedStep {
  /** Step 0 comes with the slide; the rest each wait for a click. */
  byClick: boolean;
  /** When its motion starts and ends, ms from the slide's own timeline start (after its transition). */
  startMs: number;
  endMs: number;
  /** One turn of what repeats until the slide ends, cut after this step and looped while it waits; or null. */
  holdMs: number | null;
  /** Nothing in it moves (it only starts a video or sound, or it is step 0 of a slide with no builds). */
  still: boolean;
}

export interface PlannedSlide {
  /** Its index among the deck's slides as the file orders them (hidden ones counted). */
  index: number;
  /** Its transition's name in the file, or '' for none. */
  transitionName: string;
  /** How long its transition takes in the movie (0 for none). */
  transitionMs: number;
  /** Each of the file's groups (in order): when it starts and ends, from the slide's timeline start. */
  groups: { startMs: number; endMs: number }[];
  /** Step 0 (coming in), then one per click. */
  steps: PlannedStep[];
  /** From the slide's timeline start to the next slide's transition (the copy's advTm). */
  advanceMs: number;
  /**
   * PowerPoint's timed copy: what repeats until the slide ends turns until this moment of its timeline instead
   * (the last step's hold cut), then stops, so the slide is still before the next one comes in; null for nothing.
   */
  endlessUntilMs: number | null;
}

export interface MoviePlan {
  baker: Baker;
  /** From the end of a slide's transition to the start of its own timeline. */
  settleMs: number;
  /** The shown slides, in order. */
  slides: PlannedSlide[];
}

/** The steps of a slide whose groups are planned: step 0 is the first group when it needs no click. */
function stepsOf(
  groups: readonly PptxGroup[],
  times: readonly { startMs: number; endMs: number }[],
  holdAfter: readonly (number | null)[],
): PlannedStep[] {
  const steps: PlannedStep[] = [{ byClick: false, startMs: 0, endMs: 0, holdMs: null, still: true }];
  groups.forEach((g, i) => {
    const t = times[i] ?? { startMs: 0, endMs: 0 };
    const last = steps[steps.length - 1];
    if (g.byClick || !last)
      steps.push({ byClick: true, ...t, holdMs: holdAfter[i] ?? null, still: g.mediaOnly });
    else {
      // A group that needs no click runs on in the step before it (step 0, for a slide's first).
      if (last.still && last.endMs === 0 && !last.byClick) last.startMs = t.startMs;
      last.endMs = Math.max(last.endMs, t.endMs);
      last.holdMs = holdAfter[i] ?? null;
      last.still &&= g.mediaOnly;
    }
  });
  return steps;
}

/** The plan of PowerPoint's timed copy (./timed-copy.ts writes it into the deck): its shown slides. */
export function powerPointPlan(slides: readonly PptxSlide[], baker: Baker = 'powerpoint'): MoviePlan {
  const planned: PlannedSlide[] = [];
  for (const [index, slide] of slides.entries()) {
    if (slide.hidden) continue;
    const groups = slide.deck?.groups ?? [];
    let at = 0;
    let turn: number | null = null;
    const times: { startMs: number; endMs: number }[] = [];
    const holdAfter: (number | null)[] = [];
    for (const [i, g] of groups.entries()) {
      // A first group that needs no click starts with the slide; every other one after the one before, with a
      // still gap to cut in (and, after something turning for ever, one turn of it as well).
      const wait = turn === null ? GAP_MS : HOLD_SETTLE_MS + turn + GAP_MS;
      const startMs = i === 0 && !g.byClick ? 0 : at + wait;
      const endMs = startMs + g.lengthMs;
      if (g.repeatsMs !== null) turn = Math.max(turn ?? 0, g.repeatsMs);
      times.push({ startMs, endMs });
      holdAfter.push(turn);
      at = endMs;
    }
    const transition = slide.deck?.transition;
    // Something turning for ever turns until the last step's hold has been cut (whole turns, so up to one more),
    // then the slide is still for TAIL_MS.
    const until = turn === null ? null : at + HOLD_SETTLE_MS + turn;
    planned.push({
      index,
      transitionName: transition?.name ?? '',
      transitionMs: transition?.name ? transition.durationMs : 0,
      groups: times,
      steps: stepsOf(groups, times, holdAfter),
      advanceMs: Math.round(until === null || turn === null ? at + TAIL_MS : until + turn + TAIL_MS),
      endlessUntilMs: until === null ? null : Math.round(until),
    });
  }
  return { baker, settleMs: POWERPOINT_SETTLE_MS, slides: planned };
}

/**
 * The plan of Keynote's own movie of a deck, from what its own PowerPoint copy says (its builds' structure and
 * lengths, and its transitions' lengths): its shown slides.
 */
export function keynotePlan(slides: readonly PptxSlide[]): MoviePlan {
  const planned: PlannedSlide[] = [];
  for (const [index, slide] of slides.entries()) {
    if (slide.hidden) continue;
    const groups = slide.deck?.groups ?? [];
    let at = 0;
    let built = false;
    const times: { startMs: number; endMs: number }[] = [];
    for (const [i, g] of groups.entries()) {
      // A build that only started a video or sound is gone from Keynote's copy: no time in its movie.
      if (g.mediaOnly) {
        times.push({ startMs: at, endMs: at });
        continue;
      }
      const startMs = i === 0 && !g.byClick ? 0 : g.byClick ? at + KEYNOTE_CLICK_MS : at;
      const endMs = startMs + g.lengthMs;
      times.push({ startMs, endMs });
      at = endMs;
      built = true;
    }
    const transition = slide.deck?.transition;
    planned.push({
      index,
      transitionName: transition?.name ?? '',
      // No transition into the first slide.
      transitionMs: planned.length === 0 || !transition?.name ? 0 : transition.durationMs,
      groups: times,
      // Keynote's movie keeps nothing turning for ever (C1: a spin repeating until the slide ends turned once).
      steps: stepsOf(
        groups,
        times,
        groups.map(() => null),
      ),
      advanceMs: (built ? at : 0) + KEYNOTE_NEXT_MS,
      endlessUntilMs: null,
    });
  }
  return { baker: 'keynote', settleMs: 0, slides: planned };
}

/** Where each shown slide's transition should start in the movie, by the plan alone (ms). */
export function plannedStarts(plan: MoviePlan): number[] {
  const out: number[] = [];
  let at = 0;
  for (const s of plan.slides) {
    out.push(at);
    at += s.transitionMs + plan.settleMs + s.advanceMs;
  }
  return out;
}

/** How long the whole movie should be, by the plan (ms). */
export function plannedLength(plan: MoviePlan): number {
  return plan.slides.reduce((sum, s) => sum + s.transitionMs + plan.settleMs + s.advanceMs, 0);
}
