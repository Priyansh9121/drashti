import type { ElementMotion } from './model';

export interface ElementFrame {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  moving: boolean;
  nextAt: number | null;
}

export function hasElementMotion(motion: ElementMotion | undefined): boolean {
  return motion?.in !== undefined || motion?.emphasis !== undefined || motion?.out !== undefined;
}

/** A pure frame: late joins, reloads and a clock correction draw the same point in the slide. */
export function motionFrame(motion: ElementMotion | undefined, elapsedMs: number): ElementFrame {
  const frame: ElementFrame = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0, moving: false, nextAt: null };
  if (!motion) return frame;
  for (const phase of ['in', 'emphasis', 'out'] as const) {
    const step = motion[phase];
    if (!step) continue;
    if (elapsedMs < step.delayMs) {
      frame.nextAt = Math.min(frame.nextAt ?? Infinity, step.delayMs);
      if (phase === 'in') frame.opacity = 0;
      continue;
    }
    const p = Math.min(1, Math.max(0, (elapsedMs - step.delayMs) / step.durationMs));
    frame.moving ||= p < 1;
    if (phase === 'in') {
      frame.opacity *= p;
      const remaining = (1 - p) ** 3;
      if (step.kind === 'rise') frame.y += 48 * remaining;
      if (step.kind === 'zoom') frame.scale *= 1 - 0.15 * remaining;
    } else if (phase === 'out') {
      frame.opacity *= 1 - p;
      if (step.kind === 'sink') frame.y += 48 * p ** 3;
      if (step.kind === 'shrink') frame.scale *= 1 - 0.15 * p ** 3;
    } else if (p < 1) {
      if (step.kind === 'pulse') frame.scale *= 1 + 0.08 * Math.sin(Math.PI * p);
      if (step.kind === 'turn') frame.rotate += 6 * Math.sin(2 * Math.PI * p);
    }
  }
  return frame;
}
