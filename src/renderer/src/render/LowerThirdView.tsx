import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { LowerThirdLayer } from '../../../shared/engine/state';
import type { AnimationFrame, LowerThirdAnimation } from '../../../shared/lower-third-animations';
import {
  animationById,
  animationFrame,
  animationLength,
  cutIntoUnits as cut,
  REST,
} from '../../../shared/lower-third-animations';
import {
  type Css,
  DEFAULT_ACCENT,
  type LowerThirdMotion,
  motionAt,
  motionIsFill,
  motionPieces,
  type StyleDrawing,
  styleDrawing,
} from '../../../shared/lower-third-styles';
import { type LowerThirdLook, shownLines, showsOn } from '../../../shared/lower-thirds';
import type { Size } from '../../../shared/scaling';
import { engineNow, onClockJump } from './clock';
import { fontFamilyFor } from './fonts';
import { paintLowerThirdPose } from './lower-third-paint';
import { detectLang } from '../../../shared/text-runs';
import { textLang } from './lang';

/*
 * A lower third from the Lower Thirds panel (Session 44, shared/lower-thirds.ts), on the picture it is for: the
 * hall's screens, the stream (and a key and fill pair) or both. It comes in from when it went up and goes out
 * from when it was hidden, each frame worked out from the engine's clock by its animation
 * (shared/lower-third-animations.ts), so every screen, key and fill and the stream draw the same frame; only
 * opacity, transform and clip-path move (and a blur, the studio's blurs). Clear all takes it off at once; Black-out
 * and the Logo cover it, as they cover the slide. The editor's preview draws the same, on the window's own clock.
 * Each drawing works out what it draws from the engine's time (Session 51), the moment its in or out is over too,
 * whatever frames its window gets.
 *
 * The Lower Thirds studio (Session 55, Part 16): the style its words sit in (shared/lower-third-styles.ts), drawn as
 * a shape behind the band (or behind each line), a moving background inside it, its pieces moved frame by frame by
 * the time since it went up while it is up, a font of the studio's, and an out of its own, played backwards. One
 * made before the studio is a box with no moving background, going out the way it came: drawn as before.
 */

type Phase = 'in' | 'still' | 'out' | 'gone';
interface Run {
  layer: LowerThirdLayer | null;
  phase: Phase;
  start: number;
}

/** How a lower third goes out: its own out, or its in played backwards. */
export const outAnimationOf = (
  layer: Pick<LowerThirdLayer, 'animation' | 'outAnimation'>,
): LowerThirdAnimation => animationById(layer.outAnimation ?? layer.animation);

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
    const a = outAnimationOf(off.layer);
    const { units } = cut(shownLines(off.layer.lines), a);
    if (now - off.at < animationLength(a, 'out', units))
      return { layer: off.layer, phase: 'out', start: off.at };
  }
  return { layer: null, phase: 'gone', start: 0 };
}

/** How a lower third is drawn: what it is doing, its animation, how many units its words have, and its length. */
interface Drawing {
  phase: Phase;
  animation: LowerThirdAnimation;
  units: number;
  length: number;
  motion: LowerThirdMotion;
  /** When it went up (its moving background's time starts then). */
  shownAt: number;
}

/** A moving background's pieces `t` ms after the lower third went up (each only when it moved). */
function paintMotion(root: HTMLElement, motion: LowerThirdMotion, t: number): void {
  if (motion === 'none') return;
  root.dataset['ltMotionAt'] = String(Math.round(t));
  const pieces = [...root.querySelectorAll<HTMLElement>('[data-lt-piece]')];
  // Each panel (the band's shape, or each line's) has the same pieces: the same pose for each one's own.
  const per = pieces.filter((p) => p.dataset['ltPanel'] === '0').length;
  const poses = motionAt(motion, t, per);
  for (const el of pieces) {
    const pose = poses[Number(el.dataset['ltPiece'])];
    if (!pose) continue;
    if (el.style.transform !== pose.transform) el.style.transform = pose.transform;
    const opacity = pose.opacity >= 0.9995 ? '' : String(Math.round(pose.opacity * 1000) / 1000);
    if (el.style.opacity !== opacity) el.style.opacity = opacity;
  }
}

function paintDesign(band: HTMLElement, frame?: AnimationFrame): void {
  const accent = band.querySelector<HTMLElement>('[data-lt-accent]');
  if (accent) paintLowerThirdPose(accent.style, frame?.accent ?? REST);
  const panel = band.querySelector<HTMLElement>('[data-lt-design-panel]');
  if (panel) paintLowerThirdPose(panel.style, frame?.panel ?? REST);
  for (const line of band.querySelectorAll<HTMLElement>('[data-lt-design-line]'))
    paintLowerThirdPose(line.style, frame?.unit(Number(line.dataset['ltDesignLine'])) ?? REST);
}

/**
 * A lower third `t` ms into its in or out (still: at rest), set straight on its band and units: frame by frame,
 * and after every drawing; its moving background by the time since it went up.
 */
function paintBand(
  root: HTMLDivElement | null,
  band: HTMLDivElement | null,
  { phase, animation, units, length, motion, shownAt }: Drawing,
  t: number,
  now: number,
): void {
  if (!band || !root) return;
  const unitEls = [...band.querySelectorAll<HTMLElement>('[data-lt-unit]')];
  root.dataset['ltAt'] = phase === 'in' || phase === 'out' ? String(Math.round(Math.min(t, length))) : '';
  if (phase !== 'gone') paintMotion(root, motion, now - shownAt);
  if (phase !== 'in' && phase !== 'out') {
    paintLowerThirdPose(band.style, REST);
    for (const el of unitEls) paintLowerThirdPose(el.style, REST);
    if (animation.composition) paintDesign(band);
    return;
  }
  const frame = animationFrame(animation, phase, t, units);
  paintLowerThirdPose(band.style, frame.box);
  if (animation.composition) paintDesign(band, frame);
  for (const el of unitEls) paintLowerThirdPose(el.style, frame.unit(Number(el.dataset['ltUnit'])));
}

/** A shape of colour (the band's, or a line's), with the moving background's pieces inside it. */
function Shape({ css, pieces, index }: { css: Css; pieces: Css[]; index: number }) {
  return (
    <div
      aria-hidden="true"
      data-lt-shape=""
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', ...(css as CSSProperties) }}
    >
      {pieces.map((piece, i) => (
        <div
          key={i}
          data-lt-piece={i}
          data-lt-panel={index}
          style={{ ...(piece as CSSProperties), pointerEvents: 'none' }}
        />
      ))}
    </div>
  );
}

function designRule(look: LowerThirdLook, style: StyleDrawing, size: number): Css {
  const right = look.align === 'right';
  const centre = look.align === 'centre';
  return {
    position: 'absolute',
    bottom: style.style === 'underline' ? 0 : -size * 0.14,
    left: centre ? (style.fullWidth ? '42%' : '23%') : right ? 'auto' : 0,
    right: right ? 0 : 'auto',
    width: style.fullWidth ? '16%' : centre ? '54%' : '72%',
    height: Math.max(1, size * 0.055),
    borderRadius: 999,
    background: look.accent ?? DEFAULT_ACCENT,
  };
}

export function LowerThirdView({
  layer,
  off,
  canvas,
  place,
  lift = 0,
  frozenAt,
}: {
  layer: LowerThirdLayer | null;
  /** The one just hidden, and when (state.lowerThirdOff): its out plays from then. */
  off: { layer: LowerThirdLayer; at: number } | null;
  canvas: Size;
  /** Which picture this is: a hall screen, or the stream (a key and fill pair is the stream's). */
  place: 'hall' | 'stream';
  /** Canvas pixels to keep clear at the bottom (the ticker's band). */
  lift?: number;
  /** A template thumbnail paints one frame at this clock time. */
  frozenAt?: number | undefined;
}) {
  // Drawn again when the clock jumps (a test holding it, the warm-up, a node's or a phone's clock set) and at the
  // frame its in or out is over (below). Every drawing, whatever asked for it, draws what the engine's time says now.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => (frozenAt === undefined ? onClockJump(redraw) : undefined), [frozenAt]);
  const now = frozenAt ?? engineNow();
  const run = runFor(layer, off, place, now);
  // The words and look follow the layer (one changed while up keeps its time).
  const shown = run.layer;
  const { phase, start } = run;
  // Going out: its own out (the studio's), or its in played backwards.
  const animation = shown && phase === 'out' ? outAnimationOf(shown) : animationById(shown?.animation ?? '');
  const { pieces, units } = cut(shownLines(shown?.lines ?? []), animation);
  const composing = animation.composition !== undefined;
  const designed =
    composing ||
    (phase === 'out' && shown !== null && animationById(shown.animation).composition !== undefined);
  const bandRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const length = phase === 'in' || phase === 'out' ? animationLength(animation, phase, units) : 0;
  const motion: LowerThirdMotion = shown?.look.motion ?? 'none';
  const shownAt = shown?.shownAt ?? 0;
  // Frame by frame from the engine's clock, while it moves (and, with a moving background, while it is up). At the
  // frame its in or out is over, drawn again at once, still (or gone), before that frame is shown. Started and
  // stopped as each drawing is put on the page, so no frame paints a move it no longer draws.
  useLayoutEffect(() => {
    if (frozenAt !== undefined) return;
    const moving = phase === 'in' || phase === 'out';
    if (!moving && (phase === 'gone' || motion === 'none')) return;
    const drawing = { phase, animation, units, length, motion, shownAt };
    let frame = 0;
    const tick = () => {
      const at = engineNow();
      const t = at - start;
      if (moving && t >= length) {
        flushSync(redraw);
        return;
      }
      // Still, with a moving background: only its pieces move.
      if (moving) paintBand(rootRef.current, bandRef.current, drawing, t, at);
      else if (rootRef.current) paintMotion(rootRef.current, motion, at - shownAt);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [phase, start, length, animation, units, motion, shownAt, frozenAt]);
  // After every drawing, before it is shown: as at the moment it was worked out for.
  useLayoutEffect(() => {
    // A design keeps its layout when it leaves with a different animation.
    if (designed && !composing && bandRef.current) paintDesign(bandRef.current);
    paintBand(
      rootRef.current,
      bandRef.current,
      { phase, animation, units, length, motion, shownAt },
      now - start,
      now,
    );
  });
  if (!shown || phase === 'gone') return null;
  const look = shown.look;
  const size = (canvas.height * look.size) / 100;
  const justify = look.align === 'left' ? 'flex-start' : look.align === 'right' ? 'flex-end' : 'center';
  const style = styleDrawing(look, size);
  const accent = style.accent ?? (designed ? designRule(look, style, size) : null);
  const motionPiecesCss = motionPieces(motion, look);
  // The sweep is the colour itself: under it, its panel has none of its own.
  const panelCss = (css: Css): Css => (motionIsFill(motion) ? { ...css, background: 'transparent' } : css);
  const side = canvas.width * 0.05;
  return (
    <div
      ref={rootRef}
      data-testid="lower-third-layer"
      data-lt-id={shown.id}
      data-lt-phase={phase}
      data-lt-animation={animation.id}
      data-lt-style={style.style}
      data-lt-motion={motion}
      data-lt-font={look.font}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: (canvas.height * look.bottom) / 100 + lift,
        display: 'flex',
        justifyContent: justify,
        padding: style.fullWidth ? 0 : `0 ${String(side)}px`,
        pointerEvents: 'none',
      }}
    >
      <div
        ref={bandRef}
        data-lt-band=""
        style={{
          position: 'relative',
          ...(style.fullWidth
            ? { width: '100%', padding: `${String(size * 0.3)}px ${String(side + size * 0.6)}px` }
            : { ...(style.band as CSSProperties), maxWidth: canvas.width * 0.9 }),
          fontSize: size,
          color: look.text,
          fontWeight: look.weight,
          textAlign: look.align === 'centre' ? 'center' : look.align,
          lineHeight: 1.25,
        }}
      >
        {style.fill !== 'lines' &&
          (designed ? (
            <div data-lt-design-panel="" style={{ position: 'absolute', inset: 0 }}>
              <Shape css={panelCss(style.shape)} pieces={motionPiecesCss} index={0} />
            </div>
          ) : (
            <Shape css={panelCss(style.shape)} pieces={motionPiecesCss} index={0} />
          ))}
        {accent && <div aria-hidden="true" data-lt-accent="" style={accent} />}
        {pieces.map((line, i) => {
          const text = line.map((p) => p.text).join('');
          const lang = detectLang(text);
          const own = style.line(i);
          const words = line.map((p, j): ReactNode =>
            p.unit === null ? (
              <span key={j}>{p.text}</span>
            ) : (
              <span
                key={j}
                data-lt-unit={p.unit}
                style={{
                  display: animation.unit === 'line' ? 'block' : 'inline-block',
                  whiteSpace: designed ? 'pre-wrap' : 'pre',
                  ...(designed ? { overflowWrap: 'anywhere' } : {}),
                }}
              >
                {p.text}
              </span>
            ),
          );
          return (
            <div
              key={i}
              data-lt-line=""
              lang={textLang(text)}
              style={{
                position: 'relative',
                fontFamily: fontFamilyFor(look.font, lang),
                fontSize: i === 0 ? size : size * 0.7,
                ...(style.textShadow ? { textShadow: style.textShadow } : {}),
                ...(own as CSSProperties),
                ...(style.fill === 'lines' && (designed || motionIsFill(motion))
                  ? { background: 'transparent' }
                  : {}),
                ...(designed && style.style === 'underline' ? { borderBottomColor: 'transparent' } : {}),
              }}
            >
              {designed ? (
                <>
                  {style.fill === 'lines' && (
                    <div data-lt-design-line={i} style={{ position: 'absolute', inset: 0 }}>
                      <Shape
                        css={panelCss({
                          background: own['background'] ?? 'transparent',
                          borderRadius: own['borderRadius'] ?? 0,
                        })}
                        pieces={motionPiecesCss}
                        index={i}
                      />
                    </div>
                  )}
                  <div
                    style={{
                      position: 'relative',
                      overflow: 'hidden',
                      ...(!composing ? { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } : {}),
                    }}
                  >
                    {words}
                  </div>
                </>
              ) : style.fill === 'lines' ? (
                <>
                  {/* Each line its own block of colour: the moving background in each, under its words. */}
                  <Shape
                    css={{ borderRadius: own['borderRadius'] ?? 0 }}
                    pieces={motionPiecesCss}
                    index={i}
                  />
                  <div style={{ position: 'relative' }}>{words}</div>
                </>
              ) : (
                words
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
