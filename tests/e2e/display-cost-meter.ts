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
