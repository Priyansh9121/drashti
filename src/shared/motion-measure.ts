/*
 * Item 6 (Session 57, the owner: slide transitions, PowerPoint clicks, lower thirds, the covers and the opening each
 * start on the press and run their exact length, smoothly, on Mac and Windows): how the Performance check's animations
 * scenario (main/perf-animations.ts) judges a case from the motion probe's record of a screen's frames
 * (render/motion-probe.ts, a test switch's only).
 *
 * The probe keeps when each frame the page drew began (ms since the epoch, this computer's clock) and, for each part it
 * watches (a track: the slide layer, a deck's step, a lower third, Black-out, the Wallpaper, the opening), the frames
 * at which that part looked different from the frame before. One run of a case is then:
 * - its delay: from the press to the first frame that moved;
 * - its length: from that frame to the last that moved, counting the first one's own frame, so a run that starts and
 *   ends exactly on time measures its set length (to within a frame); a cut (one frame changed) has none;
 * - its evenness: each interval between the frames drawn from the first moving frame to the last.
 * A case's row is its runs together: the delay's median and p95, the length's median against its set length, and the
 * intervals pooled (median, p95, the longest, and how many are over one and a half frame periods). It is late when its
 * median delay is over a frame period and 16 ms, and uneven when one interval is over two frame periods or the p95 is
 * over one and a half (the lead's brief for the measuring, 12 Nov 2026).
 */

/** A screen's frames, and those at which a part of it (a track) looked different from the frame before. */
export interface MotionRecord {
  /** When each frame began, ms since the epoch, in order. */
  frames: readonly number[];
  /** The frames (indexes into `frames`, in order) at which the track looked different from the frame before. */
  changes: readonly number[];
}

/** One run of a case: its press, and when the next case's begins (ms since the epoch). */
export interface CaseWindow {
  pressAt: number;
  until: number;
}

export interface MotionRun {
  /** From the press to the first frame that moved (ms); null when nothing moved. */
  delay: number | null;
  /** From the first moving frame to the last, counting the first one's own frame (ms); 0 for a cut; null: nothing. */
  length: number | null;
  /** How many frames moved. */
  moved: number;
  /** The intervals between the frames drawn from the first moving frame to the last (ms). */
  intervals: number[];
  /** When the first and the last moving frames began (ms since the epoch). */
  firstAt: number | null;
  lastAt: number | null;
}

export interface CaseRow {
  name: string;
  /** The length it is set to (ms; 0 for a cut). */
  setMs: number;
  runs: number;
  /** The runs in which it moved at all. */
  seen: number;
  delay: { median: number; p95: number } | null;
  /** The length's median, and how far that is from the set length (ms, + longer). */
  length: { median: number; off: number } | null;
  /** Every run's intervals together: median, p95, the longest, how many, and how many over 1.5 frame periods. */
  intervals: { median: number; p95: number; max: number; count: number; over: number } | null;
  late: boolean;
  uneven: boolean;
}

/** A 60 Hz frame, when a screen's own frames cannot tell. */
const SIXTY = 1000 / 60;
/** A gap longer than this is a screen with nothing to draw, or a stall: never the display's rate. */
const NOT_A_FRAME_MS = 250;

/** The nearest-rank percentile the Performance check uses everywhere (perftest.ts): Infinity for none. */
export const percentileOf = (values: readonly number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? Infinity;
};

/** The display's frame period as a screen drew it: the median gap between its frames, its long waits left out. */
export function framePeriod(frames: readonly number[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const gap = (frames[i] ?? 0) - (frames[i - 1] ?? 0);
    if (gap > 0 && gap < NOT_A_FRAME_MS) gaps.push(gap);
  }
  return gaps.length > 0 ? percentileOf(gaps, 0.5) : SIXTY;
}

/**
 * One run of a case: the frames that moved from a frame before its press (one that began a moment before it may show
 * it) until the next case's, its delay, its length and the intervals between its frames.
 */
export function measureRun(record: MotionRecord, window: CaseWindow, periodMs: number): MotionRun {
  const { frames } = record;
  const from = window.pressAt - periodMs;
  const own = record.changes.filter((i) => {
    const at = frames[i];
    return at !== undefined && at >= from && at < window.until;
  });
  const first = own[0];
  const last = own.at(-1);
  if (first === undefined || last === undefined)
    return { delay: null, length: null, moved: 0, intervals: [], firstAt: null, lastAt: null };
  const firstAt = frames[first] ?? 0;
  const lastAt = frames[last] ?? 0;
  const intervals: number[] = [];
  for (let i = first + 1; i <= last; i++) intervals.push((frames[i] ?? 0) - (frames[i - 1] ?? 0));
  return {
    delay: firstAt - window.pressAt,
    length: last === first ? 0 : lastAt - firstAt + periodMs,
    moved: own.length,
    intervals,
    firstAt,
    lastAt,
  };
}

/** Intervals summed up as a case's row has them: median, p95, the longest, how many, and how many over 1.5 periods. */
export function intervalStats(intervals: readonly number[], periodMs: number): CaseRow['intervals'] {
  if (intervals.length === 0) return null;
  return {
    median: percentileOf(intervals, 0.5),
    p95: percentileOf(intervals, 0.95),
    max: Math.max(...intervals),
    count: intervals.length,
    over: intervals.filter((i) => i > periodMs * 1.5).length,
  };
}

/**
 * The intervals between the frames a screen drew from `from` until `until` (ms since the epoch): between the cases,
 * where nothing watched moves, how evenly the screen draws anyway (a virtual machine's own unevenness, say).
 */
export function stillIntervals(frames: readonly number[], from: number, until: number): number[] {
  const within = frames.filter((at) => at >= from && at < until);
  return within.slice(1).map((at, i) => at - (within[i] ?? at));
}

/** A case's runs together, and whether it is late or uneven at this frame period. */
export function caseRow(name: string, setMs: number, runs: readonly MotionRun[], periodMs: number): CaseRow {
  const seen = runs.filter((r) => r.delay !== null);
  const delays = seen.map((r) => r.delay ?? 0);
  const lengths = seen.map((r) => r.length ?? 0);
  const intervals = seen.flatMap((r) => r.intervals);
  const delay =
    delays.length > 0 ? { median: percentileOf(delays, 0.5), p95: percentileOf(delays, 0.95) } : null;
  const lengthMedian = lengths.length > 0 ? percentileOf(lengths, 0.5) : null;
  const frames = intervalStats(intervals, periodMs);
  return {
    name,
    setMs,
    runs: runs.length,
    seen: seen.length,
    delay,
    length: lengthMedian === null ? null : { median: lengthMedian, off: lengthMedian - setMs },
    intervals: frames,
    late: delay !== null && delay.median > periodMs + 16,
    uneven: frames !== null && (frames.max > periodMs * 2 || frames.p95 > periodMs * 1.5),
  };
}

const ms = (v: number) => String(Math.round(v));
const tenth = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
/** Rounded first, so a hair under nothing reads +0. */
const signed = (v: number) => {
  const r = Math.round(v);
  return `${r >= 0 ? '+' : ''}${String(r === 0 ? 0 : r)}`;
};

/** Intervals in words: median, p95, the longest, and how many over 1.5 frame periods. */
const framesText = (i: NonNullable<CaseRow['intervals']>) =>
  `median ${tenth(i.median)}, p95 ${tenth(i.p95)}, longest ${tenth(i.max)} ms, ${String(i.over)} of ${String(i.count)} over 1.5×`;

/** The still frames between the cases in one line, beside the cases'. */
export function stillLine(stats: CaseRow['intervals']): string {
  return `still frames (nothing moving, between the cases): ${stats ? framesText(stats) : 'none'}`;
}

/** A case's row in one line, as the check's summary says it. */
export function caseLine(row: CaseRow): string {
  const head = `${row.name} (${row.setMs > 0 ? `${ms(row.setMs)} ms` : 'a cut'}, ${String(row.runs)} run${row.runs === 1 ? '' : 's'})`;
  if (!row.delay) return `${head}: never seen moving`;
  const seen = row.seen < row.runs ? `, seen in ${String(row.seen)}` : '';
  const length = row.length
    ? row.setMs > 0 || row.length.median > 0
      ? `length ${ms(row.length.median)} ms (${signed(row.length.off)})`
      : 'length one frame'
    : 'length -';
  const frames = row.intervals ? `frames ${framesText(row.intervals)}` : 'no frames between';
  const marks = [row.late ? 'LATE' : '', row.uneven ? 'UNEVEN' : ''].filter((m) => m !== '').join(' ');
  return `${head}${seen}: delay median ${ms(row.delay.median)} ms, p95 ${ms(row.delay.p95)} ms; ${length}; ${frames}${marks ? ` ${marks}` : ''}`;
}
