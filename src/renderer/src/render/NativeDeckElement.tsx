import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { DeckEffect } from '../../../shared/deck';
import {
  deckEffectsByTarget,
  deckElementTargets,
  type DeckMotionFrame,
  deckMotionFrame,
  deckTargetBounds,
  deckWipeClip,
} from '../../../shared/deck-motion';
import type { NativeStepTiming } from '../../../shared/deck-show';
import type { Rect, RenderSlide, SlideElement } from '../../../shared/model';
import { clockHeld, engineFrameNow, engineNow, onClockJump } from './clock';
import { wakeAt } from './wake-at';

interface Target {
  bounds: Rect;
  effects: readonly DeckEffect[];
}

interface Mounted {
  target: Target;
  element: Rect;
}

interface MotionContext {
  timing: NativeStepTiming;
  targets: ReadonlyMap<string, Target>;
  mounted: RefObject<Map<HTMLDivElement, Mounted>>;
}

const DeckMotionContext = createContext<MotionContext | null>(null);

export function useNativeDeckTiming(): NativeStepTiming | null {
  return useContext(DeckMotionContext)?.timing ?? null;
}

function paint(element: HTMLDivElement, mounted: Mounted, frame: DeckMotionFrame): void {
  const rotation = frame.rotation % 360;
  const transform =
    frame.x || frame.y || rotation || frame.scale !== 1
      ? `translate(${String(frame.x)}px, ${String(frame.y)}px) rotate(${String(rotation)}deg) scale(${String(frame.scale)})`
      : '';
  const opacity = frame.opacity === 1 ? '' : String(frame.opacity);
  const clip = deckWipeClip(frame.wipe, mounted.target.bounds, mounted.element);
  if (element.style.transform !== transform) element.style.transform = transform;
  if (element.style.opacity !== opacity) element.style.opacity = opacity;
  if (element.style.clipPath !== clip) element.style.clipPath = clip;
}

/** One engine-clock frame loop for a whole slide, sleeping until its next effect when nothing moves. */
export function NativeDeckMotion({
  slide,
  timing,
  children,
}: {
  slide: RenderSlide;
  timing: NativeStepTiming | null;
  children: ReactNode;
}) {
  const mounted = useRef(new Map<HTMLDivElement, Mounted>());
  const effects = timing?.motion.effects;
  const targets = useMemo(() => {
    const byTarget = deckEffectsByTarget(effects ?? []);
    const found = new Map<string, Target>();
    for (const [id, bounds] of deckTargetBounds(slide.elements, byTarget)) {
      const own = byTarget.get(id);
      if (own) found.set(id, { bounds, effects: own });
    }
    return found;
  }, [effects, slide.elements]);
  const { width, height } = slide;
  useLayoutEffect(() => {
    if (!timing || targets.size === 0) return;
    let frameId = 0;
    let cancelWake: (() => void) | undefined;
    const settled = timing.still || timing.drashti?.mode === 'instead';
    const frames = new Map<Target, DeckMotionFrame>();
    const size = { width, height };
    const draw = (now = engineNow()) => {
      cancelAnimationFrame(frameId);
      cancelWake?.();
      const elapsed = settled ? Infinity : now - timing.clipAt;
      let moving = false;
      let nextAt = Infinity;
      for (const target of targets.values()) {
        const frame = deckMotionFrame(target.effects, timing.index, elapsed, target.bounds, size);
        frames.set(target, frame);
        moving ||= frame.moving;
        nextAt = Math.min(nextAt, frame.nextAt ?? Infinity);
      }
      for (const [element, registration] of mounted.current) {
        const frame = frames.get(registration.target);
        if (frame) paint(element, registration, frame);
      }
      if (clockHeld()) return;
      if (moving)
        frameId = requestAnimationFrame(() => {
          draw(engineFrameNow());
        });
      else if (Number.isFinite(nextAt)) cancelWake = wakeAt(timing.clipAt + nextAt, engineNow, draw);
    };
    draw();
    const off = onClockJump(draw);
    return () => {
      off();
      cancelAnimationFrame(frameId);
      cancelWake?.();
    };
  }, [height, mounted, targets, timing, width]);
  if (!timing) return <>{children}</>;
  return (
    <DeckMotionContext.Provider value={{ timing, targets, mounted }}>
      <div data-native-deck-step={timing.index} style={{ position: 'absolute', inset: 0 }}>
        {children}
      </div>
    </DeckMotionContext.Provider>
  );
}

function DeckTarget({
  id,
  target,
  element,
  outer,
  mounted,
  children,
}: {
  id: string;
  target: Target;
  element: Rect;
  outer: boolean;
  mounted: RefObject<Map<HTMLDivElement, Mounted>>;
  children: ReactNode;
}) {
  const previous = useRef<HTMLDivElement | null>(null);
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (previous.current) mounted.current.delete(previous.current);
      if (node) mounted.current.set(node, { target, element });
      previous.current = node;
    },
    [element, mounted, target],
  );
  const { bounds } = target;
  const x = bounds.x + bounds.width / 2 - element.x;
  const y = bounds.y + bounds.height / 2 - element.y;
  return (
    <div
      ref={ref}
      data-deck-motion-target={id}
      style={{
        position: 'absolute',
        left: outer ? element.x : 0,
        top: outer ? element.y : 0,
        width: element.width,
        height: element.height,
        transformOrigin: `${String(x)}px ${String(y)}px`,
      }}
    >
      {children}
    </div>
  );
}

/** Wrap each animated shape outside its own rotation, opacity and crop. */
export function NativeDeckElement({
  element,
  children,
}: {
  element: SlideElement;
  children: (element: SlideElement) => ReactNode;
}) {
  const motion = useContext(DeckMotionContext);
  if (!motion) return children(element);
  const found = deckElementTargets(element).flatMap((id) => {
    const target = motion.targets.get(id);
    return target ? [{ id, target }] : [];
  });
  if (found.length === 0) return children(element);
  const local = { ...element, frame: { ...element.frame, x: 0, y: 0 } };
  return found.reduceRight<ReactNode>(
    (body, { id, target }, index) => (
      <DeckTarget
        key={id}
        id={id}
        target={target}
        element={element.frame}
        outer={index === 0}
        mounted={motion.mounted}
      >
        {body}
      </DeckTarget>
    ),
    children(local),
  );
}
