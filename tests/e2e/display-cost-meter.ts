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

/** The existing callback meter, extracted unchanged so actual retained presentation misses can be replayed. */
export function nativeCostPair(control: NativeCostTrial, imported: NativeCostTrial) {
  const before = periods(control.main.frames);
  const after = periods(imported.main.frames, before.period);
  return {
    control: before,
    imported: after,
    worse: after.p95 - before.p95 > 1 || after.longest - before.longest > 1 || after.over15 > before.over15,
  };
}
