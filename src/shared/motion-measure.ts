/*
 * Item 6 (Session 57, the owner: slide transitions, PowerPoint clicks, lower thirds, the covers and the opening each
 * start on the press and run their exact length, smoothly): how the Performance check's animations scenario judges a
 * case from the motion probe's record of a screen's frames (render/motion-probe.ts). Not built yet.
 */

/** A screen's frames, and those at which a part of it (a track) looked different from the frame before. */
export interface MotionRecord {
  frames: readonly number[];
  changes: readonly number[];
}

/** One run of a case: its press, and when the next case's begins. */
export interface CaseWindow {
  pressAt: number;
  until: number;
}

export interface MotionRun {
  delay: number | null;
  length: number | null;
  moved: number;
  intervals: number[];
  firstAt: number | null;
  lastAt: number | null;
}

export interface CaseRow {
  name: string;
  setMs: number;
  runs: number;
  seen: number;
  delay: { median: number; p95: number } | null;
  length: { median: number; off: number } | null;
  intervals: { median: number; p95: number; max: number; count: number; over: number } | null;
  late: boolean;
  uneven: boolean;
}

export function framePeriod(_frames: readonly number[]): number {
  return 0;
}

export function measureRun(_record: MotionRecord, _window: CaseWindow, _periodMs: number): MotionRun {
  return { delay: null, length: null, moved: 0, intervals: [], firstAt: null, lastAt: null };
}

export function caseRow(name: string, setMs: number, runs: readonly MotionRun[], _periodMs: number): CaseRow {
  return {
    name,
    setMs,
    runs: runs.length,
    seen: 0,
    delay: null,
    length: null,
    intervals: null,
    late: false,
    uneven: false,
  };
}

export function caseLine(row: CaseRow): string {
  return row.name;
}
