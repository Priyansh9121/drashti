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
  builtParagraphEffects,
  deckEffectsByTarget,
  deckElementTargets,
  type DeckMotionFrame,
  deckMotionFrame,
  deckParagraphEffects,
  deckParagraphRuns,
  deckTargetBounds,
  deckWipeClip,
} from '../../../shared/deck-motion';
import type { NativeStepTiming } from '../../../shared/deck-show';
import type { Rect, RenderSlide, SlideElement, TextElement } from '../../../shared/model';
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

/** One paragraph of a paragraph build: its own entrances and exits, and how much of it shows now. */
interface Paragraph {
  effects: readonly DeckEffect[];
  opacity: number;
}

interface MotionContext {
  timing: NativeStepTiming;
  targets: ReadonlyMap<string, Target>;
  mounted: RefObject<Map<HTMLDivElement, Mounted>>;
  /** A paragraph build's paragraphs, by shape and then by paragraph (from 0). */
  paragraphs: ReadonlyMap<string, ReadonlyMap<number, Paragraph>>;
  /** Each drawn piece of a built paragraph (a run of its words, its list mark), with its paragraph. */
  pieces: RefObject<Map<HTMLElement, Paragraph>>;
}

const NOWHERE: Rect = { x: 0, y: 0, width: 0, height: 0 };

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

function paintPiece(node: HTMLElement, paragraph: Paragraph): void {
  const opacity = paragraph.opacity >= 1 ? '' : String(paragraph.opacity);
  if (node.style.opacity !== opacity) node.style.opacity = opacity;
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
  const paragraphs = useMemo(() => {
    const byShape = deckParagraphEffects(effects ?? []);
    const found = new Map<string, Map<number, Paragraph>>();
    for (const element of slide.elements) {
      const shapeId = element.kind === 'text' ? element.sourceShapeId : undefined;
      const own = shapeId === undefined ? undefined : byShape.get(shapeId);
      if (!own || !shapeId || element.kind !== 'text') continue;
      const built = found.get(shapeId) ?? new Map<number, Paragraph>();
      for (const index of new Set(deckParagraphRuns(element).paragraphs)) {
        // A paragraph with no effect of its own (added after an edit) comes in with the built one before it.
        const list = built.has(index) ? [] : builtParagraphEffects(own, index);
        // Hidden until it is drawn when it comes in: a later paragraph never shows before its click.
        if (list.length > 0)
          built.set(index, {
            effects: list,
            opacity: list.find((effect) => effect.phase !== 'emphasis')?.phase === 'in' ? 0 : 1,
          });
      }
      found.set(shapeId, built);
    }
    return found;
  }, [effects, slide.elements]);
  const pieces = useRef(new Map<HTMLElement, Paragraph>());
  const { width, height } = slide;
  useLayoutEffect(() => {
    if (!timing || (targets.size === 0 && paragraphs.size === 0)) return;
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
      for (const own of paragraphs.values())
        for (const paragraph of own.values()) {
          const frame = deckMotionFrame(paragraph.effects, timing.index, elapsed, NOWHERE, size);
          paragraph.opacity = frame.opacity;
          moving ||= frame.moving;
          nextAt = Math.min(nextAt, frame.nextAt ?? Infinity);
        }
      for (const [element, registration] of mounted.current) {
        const frame = frames.get(registration.target);
        if (frame) paint(element, registration, frame);
      }
      for (const [node, paragraph] of pieces.current) paintPiece(node, paragraph);
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
  }, [height, mounted, paragraphs, targets, timing, width]);
  if (!timing) return <>{children}</>;
  return (
    <DeckMotionContext.Provider value={{ timing, targets, mounted, paragraphs, pieces }}>
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

/**
 * A paragraph build's text box, drawn as it is with its runs cut where its paragraphs end: each paragraph's runs and
 * list marks are shown and hidden by themselves, so nothing moves and a later paragraph never shows before its click.
 */
function ParagraphBuild({
  element,
  paragraphs,
  pieces,
  children,
}: {
  element: TextElement;
  paragraphs: ReadonlyMap<number, Paragraph>;
  pieces: RefObject<Map<HTMLElement, Paragraph>>;
  children: (element: SlideElement) => ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cut = useMemo(() => deckParagraphRuns(element), [element]);
  const drawn = useMemo(() => ({ ...element, runs: cut.runs }), [element, cut]);
  // After every commit: the words' own nodes may have been drawn again.
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const own = new Map<HTMLElement, Paragraph>();
    const paragraphOf = (node: Element | null | undefined): Paragraph | undefined => {
      const run = Number(node?.getAttribute('data-run') ?? Number.NaN);
      const index = Number.isInteger(run) ? cut.paragraphs[run] : undefined;
      return index === undefined ? undefined : paragraphs.get(index);
    };
    for (const node of root.querySelectorAll<HTMLElement>('[data-run]')) {
      const paragraph = paragraphOf(node);
      if (paragraph) own.set(node, paragraph);
    }
    // A list's mark goes with the paragraph of the words on its line.
    for (const mark of root.querySelectorAll<HTMLElement>('[data-list-marker]')) {
      const paragraph = paragraphOf(mark.closest('[data-line]')?.querySelector('[data-run]'));
      if (paragraph) own.set(mark, paragraph);
    }
    const all = pieces.current;
    for (const [node, paragraph] of own) {
      all.set(node, paragraph);
      paintPiece(node, paragraph);
    }
    return () => {
      for (const node of own.keys()) all.delete(node);
    };
  });
  return (
    <div ref={box} data-deck-paragraph-build={element.sourceShapeId} style={{ display: 'contents' }}>
      {children(drawn)}
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
  const built =
    element.kind === 'text' && element.sourceShapeId
      ? motion.paragraphs.get(element.sourceShapeId)
      : undefined;
  const draw = (el: SlideElement): ReactNode =>
    built && el.kind === 'text' ? (
      <ParagraphBuild element={el} paragraphs={built} pieces={motion.pieces}>
        {children}
      </ParagraphBuild>
    ) : (
      children(el)
    );
  const found = deckElementTargets(element).flatMap((id) => {
    const target = motion.targets.get(id);
    return target ? [{ id, target }] : [];
  });
  if (found.length === 0) return draw(element);
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
    draw(local),
  );
}
