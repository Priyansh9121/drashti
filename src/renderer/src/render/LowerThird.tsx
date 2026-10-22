import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { SlideLayer } from '../../../shared/engine/state';
import type { Movement } from '../../../shared/looks';
import type { Lang } from '../../../shared/model';
import { type LowerThirdLine, lowerThird } from '../../../shared/program';
import type { Size } from '../../../shared/scaling';
import { engineNow, onClockJump } from './clock';
import { fontFamilyFor } from './fonts';
import { htmlLang } from './lang';
import {
  type LowerThirdRun,
  lowerThirdAt,
  lowerThirdFrame,
  lowerThirdRunLength,
  nextLowerThirdRun,
} from './lower-third-motion';
import type { UnitFrame } from './reveal';

/*
 * A slide's words as a lower third: the stream's Camera and words layout
 * draws it over the camera, and a screen group whose Look draws slides as a
 * lower third draws it over its own picture (a key and fill pair keys it over
 * a camera in a video switcher). It moves (Session 27): in, its words
 * changing as its box holds, and out after its slide is taken off on its own.
 */

/** A lower third's text size, by how many lines it has. */
const lineSize = (canvas: Size, count: number) =>
  canvas.height * (count <= 2 ? 0.05 : count === 3 ? 0.044 : 0.037);

function Lines({ lines }: { lines: LowerThirdLine[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <div
          key={i}
          data-lang={line.lang ?? ''}
          data-lt-line=""
          lang={line.lang ? htmlLang(line.lang, line.translitOf ?? null) : undefined}
          style={{ position: 'relative', fontFamily: fontFamilyFor(null, line.lang) }}
        >
          {line.runs.map((run, j) => (
            // Words typed in a legacy font keep their font; everything else takes the lower third's look.
            <span
              key={j}
              style={
                run.legacy ? { fontFamily: fontFamilyFor(run.font ?? line.boxFont, line.lang) } : undefined
              }
            >
              {run.text}
            </span>
          ))}
        </div>
      ))}
    </>
  );
}

/**
 * A slide's words as a lower third that moves (Session 27): in as it goes up, its box holding while its
 * words change to the next slide's, and out with a short fade when the slide is taken off on its own, all
 * by the engine's clock (render/lower-third-motion.ts). Clear all takes it off at once. `shownKey` names
 * what is up (a new one moves in); `leaving` says when the slide was taken off on its own (state.slideOff).
 * Each drawing works out from the engine's time what it draws (Session 51, lowerThirdAt), the moment its
 * motion is over too, so a key and its fill draw the same at the same moment whatever frames their windows get.
 */
export function MovingLowerThird({
  lines,
  shownKey,
  shownAt,
  leaving,
  canvas,
  lift = 0,
  movement = 'calm',
}: {
  lines: LowerThirdLine[];
  shownKey: string | null;
  shownAt: number;
  leaving: { at: number } | null;
  canvas: Size;
  lift?: number;
  movement?: Movement;
}) {
  const key = lines.length > 0 ? shownKey : null;
  // A screen that comes along later draws what is up, still.
  const [run, setRun] = useState<LowerThirdRun>(() => ({
    key,
    lines,
    prev: null,
    phase: key === null ? 'gone' : 'still',
    start: 0,
  }));
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setRun((was) => nextLowerThirdRun(was, key, lines, shownAt, leaving, movement, engineNow()));
  }
  // Drawn again when the clock jumps (a test holding it, the warm-up, a node's or a phone's clock set) and at the
  // frame its motion is over (below). Every drawing, whatever asked for it, draws what the engine's time says now.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onClockJump(redraw), []);
  const now = engineNow();
  const drawn = lowerThirdAt(run, movement, now);
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const oldRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const { phase, start } = drawn;
  const going = phase === 'out' ? (drawn.prev ?? []) : null;
  const shown = going ?? lines;
  const old = phase === 'change' ? drawn.prev : going;
  const size = lineSize(canvas, Math.max(shown.length, old?.length ?? 0));
  const radius = size * 0.3;
  const scale = canvas.height / 1080;
  const length = lowerThirdRunLength(drawn, movement);
  const paint = useCallback(
    (t: number) => {
      const root = rootRef.current;
      const box = boxRef.current;
      if (!root || !box) return;
      const lineOf = (el: HTMLDivElement | null) =>
        el ? [...el.querySelectorAll<HTMLElement>('[data-lt-line]')] : [];
      const place = (el: HTMLElement, f: UnitFrame) => {
        el.style.opacity = f.opacity === 1 ? '' : String(f.opacity);
        el.style.top = f.rise === 0 ? '' : `${String(f.rise * scale)}px`;
      };
      // How far into its motion it was drawn (ms), for tests (a held clock) and diagnostics.
      root.dataset['ltAt'] = phase === 'still' || phase === 'gone' ? '' : String(Math.round(t));
      if (phase === 'still' || phase === 'gone') {
        root.style.opacity = '';
        box.style.clipPath = '';
        for (const el of lineOf(newRef.current)) place(el, { opacity: 1, rise: 0 });
        return;
      }
      const f = lowerThirdFrame(phase, movement, t);
      root.style.opacity = f.whole === 1 ? '' : String(f.whole);
      box.style.clipPath =
        f.side === null
          ? ''
          : `inset(0 ${f.side.toFixed(2)}% 0 ${f.side.toFixed(2)}% round ${radius.toFixed(1)}px)`;
      if (oldRef.current) oldRef.current.style.opacity = String(f.oldWords);
      lineOf(oldRef.current).forEach((el, i) => {
        place(el, f.oldLine(i));
      });
      if (phase !== 'out')
        lineOf(newRef.current).forEach((el, i) => {
          place(el, f.newLine(i));
        });
    },
    [phase, movement, radius, scale],
  );
  // Frame by frame, from the engine's clock, while it moves. At the frame it is over, drawn again at once, still
  // (or gone), before that frame is shown: never its motion's last frame left up a frame longer. Started and
  // stopped as each drawing is put on the page, so no frame paints a motion it no longer draws.
  useLayoutEffect(() => {
    if (phase === 'still' || phase === 'gone') return;
    let frame = 0;
    const tick = () => {
      const t = engineNow() - start;
      if (t >= length) {
        flushSync(redraw);
        return;
      }
      paint(t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [phase, start, length, paint]);
  // After every drawing, before it is shown: as at the moment it was worked out for.
  useLayoutEffect(() => {
    paint(now - start);
  });
  if (phase === 'gone') return null;
  return (
    <div
      ref={rootRef}
      data-testid="lower-third"
      data-lt-phase={phase}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: canvas.height * 0.06 + lift,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        ref={boxRef}
        data-lt-box=""
        style={{
          display: 'grid',
          maxWidth: canvas.width * 0.88,
          padding: `${size * 0.35}px ${size * 0.9}px`,
          borderRadius: radius,
          background: 'rgba(0, 0, 0, 0.62)',
          color: '#ffffff',
          textAlign: 'center',
          fontWeight: 600,
          lineHeight: 1.3,
          textShadow: '0 2px 6px rgba(0, 0, 0, 0.6)',
        }}
      >
        {/* The box holds while its words change: the old and the new in the same place. */}
        {old && (
          <div
            ref={oldRef}
            data-lt-words="old"
            style={{ gridArea: '1 / 1', fontSize: lineSize(canvas, old.length) }}
          >
            <Lines lines={old} />
          </div>
        )}
        {!going && (
          <div
            ref={newRef}
            data-lt-words="new"
            style={{ gridArea: '1 / 1', fontSize: lineSize(canvas, lines.length) }}
          >
            <Lines lines={lines} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A Look's lower third (Session 27): the live slide's words in a moving box, drawn apart from the slide
 * layer so it can come in, change and leave by itself (a slide with no words but a picture is drawn as
 * designed by the slide layer).
 */
export function SlideLowerThird({
  layer,
  slideOff,
  languages,
  canvas,
  lift,
  movement,
}: {
  layer: SlideLayer | null;
  slideOff: { at: number } | null;
  languages: readonly Lang[] | null;
  canvas: Size;
  lift: number;
  movement: Movement;
}) {
  const lines = useMemo(() => (layer ? lowerThird(layer.slide, languages) : []), [layer, languages]);
  return (
    <MovingLowerThird
      lines={lines}
      shownKey={layer ? `${layer.slide.id}@${String(layer.shownAt)}` : null}
      shownAt={layer?.shownAt ?? 0}
      leaving={slideOff}
      canvas={canvas}
      lift={lift}
      movement={movement}
    />
  );
}
