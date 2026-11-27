/*
 * Where each generated clip actually played in the stream's own audio graph (alpha.25, cap-realc; QA23-REALC-3, the
 * owner: "By when it played (Rec.)"): through the stream-clock seam the clip plays on the graph's clock,
 * which on CI's Mac ran slower than real time (run 45401342094), so the file's positions on the wall clock no longer
 * say when each clip was heard. The stream page's level reports (body data-level: the loudest of each 100 ms, with this
 * computer's clock) do. A clip's latency is taken from the end of its sound there, with the meter's step added.
 */

/** The stream page reports its level every 100 ms (the loudest of that step). */
export const METER_STEP_MS = 100;
/** Loud: over -45 dBFS (silence reads -100). */
const LOUD_DB = -45;
/** A pause between words is shorter than this; a clip's own silence after it is longer (the spec leaves seconds). */
const JOIN_MS = 1_000;

export interface LevelReport {
  at: number;
  db: number;
}

/** The runs of loud reports, a run going on across pauses shorter than a second: each clip's sound in the graph. */
export function loudRuns(levels: readonly LevelReport[]): { first: number; last: number }[] {
  const runs: { first: number; last: number }[] = [];
  for (const { at, db } of levels) {
    if (db <= LOUD_DB) continue;
    const run = runs.at(-1);
    if (run && at - run.last < JOIN_MS) run.last = at;
    else runs.push({ first: at, last: at });
  }
  return runs;
}

/**
 * Each clip where it played in the graph, in order: from its first loud report to a meter step before the report just
 * before its last loud one (review MUST-1). A report is the loudest of 4 looks 25 ms apart, each seeing the graph's
 * last 43 ms, so it reaches back about 118 ms (more when timers fire late or the graph plays slow): the sound may have
 * ended anywhere from the step before it on. Counted from there, the end is never after the sound really ended, so a
 * latency from it is never less than the truth. Null when the graph did not play as many clips as the file holds.
 */
export function placeByGraph(
  levels: readonly LevelReport[],
  count: number,
): { startAt: number; endAt: number }[] | null {
  const runs = loudRuns(levels);
  if (runs.length !== count) return null;
  return runs.map((r) => {
    const at = levels.findIndex((l) => l.at === r.last);
    const before = levels[at - 1]?.at ?? r.last - METER_STEP_MS;
    return { startAt: r.first, endAt: Math.min(r.last, before) - METER_STEP_MS };
  });
}

/**
 * Nothing may be heard before the first clip (review MUST-2): from the later of where the file holds it on the wall
 * clock and where the graph played it, so a phrase settled between the two is never left out of every check.
 */
export function firstSoundAt(placedStart: number | undefined, fileStart: number): number {
  return placedStart === undefined ? fileStart : Math.max(placedStart, fileStart);
}

/** From the end of a clip's sound in the graph to its words on a screen (ms). */
export function latencyFromGraph(shownAt: number, clip: { endAt: number }): number {
  return shownAt - clip.endAt;
}
