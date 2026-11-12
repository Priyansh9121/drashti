import type { DeckEffect, DeckEffectDirection, DeckMotion } from './deck';
import type { Rect, RenderSlide, SlideElement } from './model';
import { fitElements } from './slide-size';

type Size = Pick<RenderSlide, 'width' | 'height'>;
export function deckElementTargets(element: SlideElement): readonly string[] {
  const groups = element.sourceGroupIds ?? [];
  return element.sourceShapeId ? [...groups, element.sourceShapeId] : groups;
}

/** One source shape may have several rendered parts. A group's effects apply to their combined bounds. */
export function deckTargetBounds(
  elements: readonly SlideElement[],
  effects: ReadonlyMap<string, readonly DeckEffect[]>,
): Map<string, Rect> {
  const bounds = new Map<string, Rect>();
  for (const element of elements) {
    const frame = element.frame;
    for (const id of deckElementTargets(element)) {
      if (!effects.has(id)) continue;
      const previous = bounds.get(id);
      if (!previous) {
        bounds.set(id, frame);
        continue;
      }
      const x = Math.min(previous.x, frame.x);
      const y = Math.min(previous.y, frame.y);
      const right = Math.max(previous.x + previous.width, frame.x + frame.width);
      const bottom = Math.max(previous.y + previous.height, frame.y + frame.height);
      bounds.set(id, { x, y, width: right - x, height: bottom - y });
    }
  }
  return bounds;
}

export function deckEffectsByTarget(effects: readonly DeckEffect[]): Map<string, DeckEffect[]> {
  const byTarget = new Map<string, DeckEffect[]>();
  for (const effect of effects) {
    const group = byTarget.get(effect.shapeId);
    if (group) group.push(effect);
    else byTarget.set(effect.shapeId, [effect]);
  }
  for (const group of byTarget.values()) group.sort((a, b) => a.step - b.step || a.delayMs - b.delayMs);
  return byTarget;
}

type DeckWipe = { edge: DeckEffectDirection; fraction: number } | { axis: 'x' | 'y'; fraction: number };

export interface DeckMotionFrame {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  wipe: DeckWipe | null;
  moving: boolean;
  /** Relative to the current step, as its effects' delays are. */
  nextAt: number | null;
}

const opposite = { left: 'right', right: 'left', up: 'down', down: 'up' } as const;
const travel = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as const;

function outsideSlide(edge: DeckEffectDirection, bounds: Rect, slide: Size): [number, number] {
  switch (edge) {
    case 'left':
      return [-Math.max(0, bounds.x + bounds.width), 0];
    case 'right':
      return [Math.max(0, slide.width - bounds.x), 0];
    case 'up':
      return [0, -Math.max(0, bounds.y + bounds.height)];
    case 'down':
      return [0, Math.max(0, slide.height - bounds.y)];
  }
}

/** A frame of one shape or group. Earlier steps are settled even when Next interrupted their motion. */
export function deckMotionFrame(
  effects: readonly DeckEffect[],
  step: number,
  elapsedMs: number,
  bounds: Rect,
  slide: Size,
): DeckMotionFrame {
  const firstVisibility = effects.find((effect) => effect.phase !== 'emphasis');
  const frame: DeckMotionFrame = {
    opacity: firstVisibility?.phase === 'in' ? 0 : 1,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    wipe: null,
    moving: false,
    nextAt: null,
  };

  let opacity = 1;
  for (const effect of effects) {
    if (effect.step > step) break;
    const local = effect.step < step ? Infinity : elapsedMs - effect.delayMs;
    if (local < 0) {
      frame.nextAt = Math.min(frame.nextAt ?? Infinity, effect.delayMs);
      continue;
    }
    const progress = effect.durationMs === 0 ? 1 : Math.min(1, local / effect.durationMs);
    frame.moving ||= progress < 1;
    if (effect.phase === 'emphasis') {
      if (effect.kind === 'spin') frame.rotation += (effect.degrees ?? 360) * progress;
      if (effect.kind === 'pulse' && progress < 1) frame.scale *= 1 + 0.12 * Math.sin(Math.PI * progress);
      if (effect.kind === 'grow-shrink') frame.scale *= 1 + ((effect.scale ?? 1) - 1) * progress;
      continue;
    }

    const entering = effect.phase === 'in';
    const amount = entering ? progress : 1 - progress;
    frame.opacity = entering || progress < 1 ? 1 : 0;
    if (progress >= 1) continue;
    if (effect.kind === 'fade' || effect.kind === 'float' || effect.fade) opacity *= amount;
    const direction = effect.direction ?? 'left';
    if (effect.kind === 'fly') {
      const edge = entering ? opposite[direction] : direction;
      const [x, y] = outsideSlide(edge, bounds, slide);
      frame.x += x * (1 - amount);
      frame.y += y * (1 - amount);
      if (effect.verticalDirection) {
        const verticalEdge = entering ? opposite[effect.verticalDirection] : effect.verticalDirection;
        frame.y += outsideSlide(verticalEdge, bounds, slide)[1] * (1 - amount);
      }
    }
    if (effect.kind === 'float') {
      const [x, y] = travel[direction];
      const shift = (effect.distance ?? 0) * (entering ? -1 : 1) * (1 - amount);
      frame.x += slide.width * x * shift;
      frame.y += slide.height * y * shift;
    }
    if (effect.kind === 'wipe')
      frame.wipe = { edge: direction, fraction: 1 - amount };
    if (effect.kind === 'split') frame.wipe = { axis: effect.splitAxis ?? 'x', fraction: 1 - amount };
    if (effect.kind === 'zoom') frame.scale *= amount + (effect.scale ?? 0) * (1 - amount);
  }
  frame.opacity *= opacity;
  return frame;
}

const percentage = (part: number, total: number): number =>
  total > 0 ? 100 * Math.min(1, Math.max(0, part / total)) : 0;

/** Clip all of a group's rendered parts at the same slide position. */
export function deckWipeClip(wipe: DeckWipe | null, target: Rect, frame: Rect): string {
  if (!wipe) return '';
  const { fraction } = wipe;
  if ('axis' in wipe) {
    const half = fraction / 2;
    if (wipe.axis === 'x') {
      const left = percentage(target.x + target.width * half - frame.x, frame.width);
      const right = percentage(frame.x + frame.width - target.x - target.width * (1 - half), frame.width);
      return `inset(0% ${String(right)}% 0% ${String(left)}%)`;
    }
    const top = percentage(target.y + target.height * half - frame.y, frame.height);
    const bottom = percentage(frame.y + frame.height - target.y - target.height * (1 - half), frame.height);
    return `inset(${String(top)}% 0% ${String(bottom)}% 0%)`;
  }
  const { edge } = wipe;
  const top = edge === 'up' ? percentage(target.y + target.height * fraction - frame.y, frame.height) : 0;
  const right =
    edge === 'right'
      ? percentage(frame.x + frame.width - target.x - target.width * (1 - fraction), frame.width)
      : 0;
  const bottom =
    edge === 'down'
      ? percentage(frame.y + frame.height - target.y - target.height * (1 - fraction), frame.height)
      : 0;
  const left = edge === 'left' ? percentage(target.x + target.width * fraction - frame.x, frame.width) : 0;
  return `inset(${String(top)}% ${String(right)}% ${String(bottom)}% ${String(left)}%)`;
}

function turnedAbout(element: SlideElement, target: Rect, degrees: number): SlideElement {
  const radians = (degrees * Math.PI) / 180;
  const centerX = target.x + target.width / 2;
  const centerY = target.y + target.height / 2;
  const dx = element.frame.x + element.frame.width / 2 - centerX;
  const dy = element.frame.y + element.frame.height / 2 - centerY;
  return {
    ...element,
    frame: {
      ...element.frame,
      x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians) - element.frame.width / 2,
      y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians) - element.frame.height / 2,
    },
    rotation: (element.rotation ?? 0) + degrees,
  };
}

function scaledAbout(element: SlideElement, target: Rect, scale: number): SlideElement {
  const span = Math.max(1, target.width, target.height);
  const size = { width: span, height: span };
  const [scaled] = fitElements([element], size, { width: span * scale, height: span * scale });
  if (!scaled) return element;
  return {
    ...scaled,
    frame: {
      ...scaled.frame,
      x: scaled.frame.x + (target.x + target.width / 2) * (1 - scale),
      y: scaled.frame.y + (target.y + target.height / 2) * (1 - scale),
    },
  };
}

/** A still at the end of a click, for Next on LIVE, a phone or a stage screen. */
export function settledDeckElements(slide: RenderSlide, motion: DeckMotion, step: number): SlideElement[] {
  const effects = deckEffectsByTarget(motion.effects);
  const bounds = deckTargetBounds(slide.elements, effects);
  const poses = new Map<string, DeckMotionFrame>();
  for (const [id, target] of bounds) {
    const own = effects.get(id);
    if (own) poses.set(id, deckMotionFrame(own, step, Infinity, target, slide));
  }
  return slide.elements.flatMap((element) => {
    let drawn = element;
    const ids = deckElementTargets(element);
    // The innermost target moves first, then the groups that contain it.
    for (const id of [...ids].reverse()) {
      const pose = poses.get(id);
      if (!pose) continue;
      if (pose.opacity === 0) return [];
      const degrees = pose.rotation % 360;
      const target = bounds.get(id);
      if (degrees !== 0 && target) drawn = turnedAbout(drawn, target, degrees);
      if (pose.scale !== 1 && target) drawn = scaledAbout(drawn, target, pose.scale);
    }
    return [drawn];
  });
}
