import { formatDuration } from '../../../shared/format';

/*
 * The time bar's arithmetic (Session 54, ui/TimeBar.tsx): where a time sits along a bar of the whole file, the time
 * under a point of it, kept between the file's start and end points, where a key moves it, and its time in words.
 */

/** A bar over a whole file (ms), and the part of it that plays: its start and end points. */
export interface BarSpan {
  durationMs: number;
  startMs: number;
  endMs: number;
}

/** How far a key moves it (ms): an arrow 5 s, Page Up or Page Down 30 s. */
export const KEY_STEP_MS = 5000;
export const PAGE_STEP_MS = 30_000;

/** A span as the bar draws it: the points kept inside the file, the end never before the start. */
export function barSpan(durationMs: number, startMs = 0, endMs: number | null = null): BarSpan {
  const length = Math.max(0, durationMs);
  const start = Math.min(length, Math.max(0, startMs));
  const end = endMs === null ? length : Math.min(length, Math.max(start, endMs));
  return { durationMs: length, startMs: start, endMs: end };
}

/** Where a time sits along the bar, from 0 (the file's start) to 1 (its end). */
export function barFraction(ms: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, ms / durationMs));
}

/** The time under a point `fraction` of the way along the bar (whole ms), kept between the start and end points. */
export function timeAt(fraction: number, span: BarSpan): number {
  const ms = Math.round(Math.min(1, Math.max(0, fraction)) * span.durationMs);
  return Math.min(span.endMs, Math.max(span.startMs, ms));
}

/**
 * Where a key moves it to (ms), between the points, or null for a key the bar leaves alone: the arrows 5 s either way
 * (Left and Down back, Right and Up on), Page Down and Page Up 30 s, Home its start point and End its end point.
 */
export function keyTarget(key: string, atMs: number, span: BarSpan): number | null {
  const by: Record<string, number> = {
    ArrowLeft: -KEY_STEP_MS,
    ArrowDown: -KEY_STEP_MS,
    ArrowRight: KEY_STEP_MS,
    ArrowUp: KEY_STEP_MS,
    PageDown: -PAGE_STEP_MS,
    PageUp: PAGE_STEP_MS,
  };
  const step = by[key];
  if (step !== undefined) return Math.min(span.endMs, Math.max(span.startMs, Math.round(atMs + step)));
  if (key === 'Home') return span.startMs;
  if (key === 'End') return span.endMs;
  return null;
}

/** How long is left to the end point (ms), never less than none. */
export const leftMs = (atMs: number, span: BarSpan): number => Math.max(0, span.endMs - atMs);

/** The time left as the bar writes it, counted down as a timer is (whole seconds up): "-1:03", "-0:00" at the end. */
export const leftText = (atMs: number, span: BarSpan): string =>
  `-${formatDuration(leftMs(atMs, span), { roundUp: true })}`;

/**
 * Its time in words, in whole seconds, for a screen reader (the slider's value text): "0:12 of 1:15, 1:03 left". Whole
 * seconds, so it changes once a second while it plays, not at every drawing.
 */
export function timeWords(atMs: number, span: BarSpan): string {
  return `${formatDuration(atMs)} of ${formatDuration(span.endMs)}, ${formatDuration(leftMs(atMs, span), { roundUp: true })} left`;
}
