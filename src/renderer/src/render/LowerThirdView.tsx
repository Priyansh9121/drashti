import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { LowerThirdLayer } from '../../../shared/engine/state';
import type { LowerThirdAnimation, Pose } from '../../../shared/lower-third-animations';
import {
  animationById,
  animationFrame,
  animationLength,
  cutIntoUnits as cut,
  REST,
} from '../../../shared/lower-third-animations';
import { shownLines, showsOn } from '../../../shared/lower-thirds';
import type { Size } from '../../../shared/scaling';
import { engineNow, onClockJump } from './clock';
import { fontFamilyFor } from './fonts';
import { detectLang } from '../../../shared/text-runs';
import { textLang } from './lang';

/*
 * A lower third from the Lower Thirds panel (Session 44, shared/lower-thirds.ts), on the picture it is for: the
 * hall's screens, the stream (and a key and fill pair) or both. It comes in from when it went up and goes out
 * from when it was hidden, each frame worked out from the engine's clock by its animation
 * (shared/lower-third-animations.ts), so every screen, key and fill and the stream draw the same frame; only
 * opacity, transform and clip-path move. Clear all takes it off at once; Black-out and the Logo cover it, as
 * they cover the slide. The editor's preview draws the same, on the window's own clock. Each drawing works out
 * what it draws from the engine's time (Session 51), the moment its in or out is over too, whatever frames its
 * window gets.
 */

type Phase = 'in' | 'still' | 'out' | 'gone';
interface Run {
  layer: LowerThirdLayer | null;
  phase: Phase;
  start: number;
}

/** How many units of its kind (lines, words or letters) a lower third's words have, for its animation's length. */
export const unitCount = (lines: readonly string[], a: LowerThirdAnimation): number =>
  cut(shownLines(lines), a).units;

/** What to draw at `now`: one up (coming in, or still), one going (out), or nothing. */
function runFor(
  layer: LowerThirdLayer | null,
  off: { layer: LowerThirdLayer; at: number } | null,
  place: 'hall' | 'stream',
  now: number,
): Run {
  if (layer && showsOn(layer.where, place)) {
    const a = animationById(layer.animation);
    const { units } = cut(shownLines(layer.lines), a);
    const phase = now - layer.shownAt >= animationLength(a, 'in', units) ? 'still' : 'in';
    return { layer, phase, start: layer.shownAt };
  }
  if (off && showsOn(off.layer.where, place)) {
    const a = animationById(off.layer.animation);
    const { units } = cut(shownLines(off.layer.lines), a);
    if (now - off.at < animationLength(a, 'out', units))
      return { layer: off.layer, phase: 'out', start: off.at };
  }
  return { layer: null, phase: 'gone', start: 0 };
}

const hexAlpha = (hex: string, alpha: number) =>
  `${hex}${Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')}`;

/** Set a pose on an element (an empty value leaves it as it is). */
function put(el: HTMLElement, pose: Pose): void {
  el.style.opacity = pose.opacity === 1 ? '' : String(pose.opacity);
  el.style.transform = pose.transform;
  el.style.clipPath = pose.clip;
  el.style.transformOrigin = pose.origin;
}

/** How a lower third is drawn: what it is doing, its animation, how many units its words have, and its length. */
interface Drawing {
  phase: Phase;
  animation: LowerThirdAnimation;
  units: number;
  length: number;
}

/**
 * A lower third `t` ms into its in or out (still: at rest), set straight on its band and units: frame by frame,
 * and after every drawing.
 */
function paintBand(
  root: HTMLDivElement | null,
  band: HTMLDivElement | null,
  { phase, animation, units, length }: Drawing,
  t: number,
): void {
  if (!band || !root) return;
  const unitEls = [...band.querySelectorAll<HTMLElement>('[data-lt-unit]')];
  root.dataset['ltAt'] = phase === 'in' || phase === 'out' ? String(Math.round(Math.min(t, length))) : '';
  if (phase !== 'in' && phase !== 'out') {
    put(band, REST);
    for (const el of unitEls) put(el, REST);
    return;
  }
  const frame = animationFrame(animation, phase, t, units);
  put(band, frame.box);
  for (const el of unitEls) put(el, frame.unit(Number(el.dataset['ltUnit'])));
}

export function LowerThirdView({
  layer,
  off,
  canvas,
  place,
  lift = 0,
}: {
  layer: LowerThirdLayer | null;
  /** The one just hidden, and when (state.lowerThirdOff): its out plays from then. */
  off: { layer: LowerThirdLayer; at: number } | null;
  canvas: Size;
  /** Which picture this is: a hall screen, or the stream (a key and fill pair is the stream's). */
  place: 'hall' | 'stream';
  /** Canvas pixels to keep clear at the bottom (the ticker's band). */
  lift?: number;
}) {
  // Drawn again when the clock jumps (a test holding it, the warm-up, a node's or a phone's clock set) and at the
  // frame its in or out is over (below). Every drawing, whatever asked for it, draws what the engine's time says now.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onClockJump(redraw), []);
  const now = engineNow();
  const run = runFor(layer, off, place, now);
  // The words and look follow the layer (one changed while up keeps its time).
  const shown = run.layer;
  const animation = animationById(shown?.animation ?? '');
  const { pieces, units } = cut(shownLines(shown?.lines ?? []), animation);
  const bandRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { phase, start } = run;
  const length = phase === 'in' || phase === 'out' ? animationLength(animation, phase, units) : 0;
  // Frame by frame from the engine's clock, while it moves. At the frame it is over, drawn again at once, still (or
  // gone), before that frame is shown. Started and stopped as each drawing is put on the page, so no frame paints
  // a move it no longer draws.
  useLayoutEffect(() => {
    if (phase !== 'in' && phase !== 'out') return;
    const drawing = { phase, animation, units, length };
    let frame = 0;
    const tick = () => {
      const t = engineNow() - start;
      if (t >= length) {
        flushSync(redraw);
        return;
      }
      paintBand(rootRef.current, bandRef.current, drawing, t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [phase, start, length, animation, units]);
  // After every drawing, before it is shown: as at the moment it was worked out for.
  useLayoutEffect(() => {
    paintBand(rootRef.current, bandRef.current, { phase, animation, units, length }, now - start);
  });
  if (!shown || phase === 'gone') return null;
  const look = shown.look;
  const size = (canvas.height * look.size) / 100;
  const justify = look.align === 'left' ? 'flex-start' : look.align === 'right' ? 'flex-end' : 'center';
  return (
    <div
      ref={rootRef}
      data-testid="lower-third-layer"
      data-lt-id={shown.id}
      data-lt-phase={phase}
      data-lt-animation={animation.id}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: (canvas.height * look.bottom) / 100 + lift,
        display: 'flex',
        justifyContent: justify,
        padding: `0 ${String(canvas.width * 0.05)}px`,
        pointerEvents: 'none',
      }}
    >
      <div
        ref={bandRef}
        data-lt-band=""
        style={{
          maxWidth: canvas.width * 0.9,
          padding: `${String(size * 0.3)}px ${String(size * 0.6)}px`,
          borderRadius: size * 0.12,
          background: hexAlpha(look.band, look.bandOpacity),
          color: look.text,
          fontWeight: look.weight,
          textAlign: look.align === 'centre' ? 'center' : look.align,
          lineHeight: 1.25,
        }}
      >
        {pieces.map((line, i) => {
          const text = line.map((p) => p.text).join('');
          const lang = detectLang(text);
          return (
            <div
              key={i}
              data-lt-line=""
              lang={textLang(text)}
              style={{
                fontFamily: fontFamilyFor(look.font, lang),
                fontSize: i === 0 ? size : size * 0.7,
              }}
            >
              {line.map((p, j): ReactNode =>
                p.unit === null ? (
                  <span key={j}>{p.text}</span>
                ) : (
                  <span
                    key={j}
                    data-lt-unit={p.unit}
                    style={{
                      display: animation.unit === 'line' ? 'block' : 'inline-block',
                      whiteSpace: 'pre',
                    }}
                  >
                    {p.text}
                  </span>
                ),
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
