export function periods(frames: readonly number[], reference?: number) {
  const gaps = frames.slice(1).map((t, i) => t - (frames[i] ?? t));
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const period = reference ?? median;
  return {
    frames: frames.length,
    period,
    longest: sorted.at(-1) ?? 0,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    over15: gaps.filter((ms) => ms > period * 1.5).length,
    gaps,
  };
}

interface NativeCostTrial {
  main: { frames: readonly number[] };
  nativeTimesUs?: readonly number[];
}

/** Retain original callback math and add an independent native feedback guard; either cost fails the pair. */
export function nativeCostPair(control: NativeCostTrial, imported: NativeCostTrial) {
  const before = periods(control.main.frames);
  const after = periods(imported.main.frames, before.period);
  const callbackWorse =
    after.p95 - before.p95 > 1 || after.longest - before.longest > 1 || after.over15 > before.over15;
  const beforeTimes = control.nativeTimesUs;
  const afterTimes = imported.nativeTimesUs;
  if (!beforeTimes || !afterTimes) throw new Error('Native presentation evidence is missing.');
  for (const frames of [beforeTimes, afterTimes]) {
    if (
      frames.length <= 2 ||
      frames.some((t, index) => !Number.isSafeInteger(t) || (index > 0 && t <= (frames[index - 1] ?? t)))
    )
      throw new Error('Native presentation evidence is incomplete or unordered.');
  }
  const presentationControlUs = periods(beforeTimes);
  const presentationImportUs = periods(afterTimes, presentationControlUs.period);
  const presentationWorse =
    presentationImportUs.p95 - presentationControlUs.p95 > 1000 ||
    presentationImportUs.longest - presentationControlUs.longest > 1000 ||
    presentationImportUs.over15 > presentationControlUs.over15;
  return {
    control: before,
    imported: after,
    callbackWorse,
    presentationWorse,
    presentationControlUs,
    presentationImportUs,
    worse: callbackWorse || presentationWorse,
  };
}

/**
 * QA22-L8-3 B (the owner, 24 Nov 2026): a trial's dropped presented frames, the native presentation gaps over 1.5 of
 * the trial's own median period, split at `splitMs` (1 s) after the dissolve's start (`startMs`, the page's clock).
 */
export function droppedFrames(frameTimesMs: readonly number[], startMs: number, splitMs = 1000) {
  const gaps = frameTimesMs.slice(1).map((t, i) => t - (frameTimesMs[i] ?? t));
  const period = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
  let first = 0;
  let after = 0;
  gaps.forEach((gap, i) => {
    if (gap <= period * 1.5) return;
    if ((frameTimesMs[i] ?? startMs) - startMs < splitMs) first++;
    else after++;
  });
  return { first, after };
}

/**
 * The margin over the controls, set from the 24 attempts of L8 on record on CI's Mac (23-24 Nov 2026) where the import
 * does no work during the dissolve: the largest import excess was 13 frames in a first second (15 against 2: the
 * import's own call) and 29 after it (63 against 34: the runner's own swing). In the first second the import trials
 * may drop at most 15 frames more than the controls (5 per trial); after it, at most half as many again plus 15.
 */
export const MAC_DROP_MARGIN = { first: 15, afterRatio: 1.5, after: 15 } as const;

/** The Mac's verdict of one attempt: its import trials' dropped frames against its control trials'. */
export function macDropVerdict(
  trials: readonly { importing: boolean; dropped: { first: number; after: number } }[],
) {
  const sum = (importing: boolean, key: 'first' | 'after') =>
    trials.filter((t) => t.importing === importing).reduce((n, t) => n + t.dropped[key], 0);
  const importFirst = sum(true, 'first');
  const controlFirst = sum(false, 'first');
  const importAfter = sum(true, 'after');
  const controlAfter = sum(false, 'after');
  const firstWorse = importFirst > controlFirst + MAC_DROP_MARGIN.first;
  const afterWorse = importAfter > controlAfter * MAC_DROP_MARGIN.afterRatio + MAC_DROP_MARGIN.after;
  return {
    importFirst,
    controlFirst,
    importAfter,
    controlAfter,
    firstWorse,
    afterWorse,
    worse: firstWorse || afterWorse,
  };
}
