import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { CalendarDay } from '../../../shared/calendar';
import { festivalsLine, samvatLine } from '../../../shared/calendar';
import type { MessageItem } from '../../../shared/engine/state';
import {
  animationFrame,
  animationLength,
  cutIntoUnits,
  type LowerThirdAnimation,
  type Pose,
  REST,
} from '../../../shared/lower-third-animations';
import {
  isDragged,
  type MessageLook,
  messageAnimation,
  messageBoxStyle,
  messageTextAlign,
  messageTextPx,
  withOpacity,
} from '../../../shared/message-look';
import type { Size } from '../../../shared/scaling';
import { detectLang } from '../../../shared/text-runs';
import type { TimerState } from '../../../shared/timers';
import { engineNow, onClockJump } from './clock';
import { fontFamilyFor } from './fonts';
import { textLang } from './lang';
import { TimerText } from './TimerText';

/*
 * The hall's messages with a look of their own (Session 55, Part 15, shared/message-look.ts): each where its look puts
 * it (one of nine places, or where it was dragged; several in one place one above another), in its font, size,
 * colour and weight, with a band across or a box round its words, or nothing, behind them; coming in from when it
 * went up and going out from when it was taken off (or its time was up), each frame worked out from the engine's
 * clock by its animation (the Lower Thirds', shared/lower-third-animations.ts), so every screen draws the same frame;
 * only opacity, transform and clip-path move. A slide in from an edge of the picture travels from just past that edge,
 * measured on this picture. Messages with the standard look stay in the band along the bottom (Scene.tsx's
 * MessageBanner), as every message did before. The Messages panel's small picture draws the same.
 */

type Phase = 'in' | 'still' | 'out' | 'gone';

/** What a message's words move as: its lines, words or letters (a timer or a date is one unit each). */
interface Piece {
  node: ReactNode;
  unit: number | null;
}

function samvat(calendar: CalendarDay | null, lang: 'gu' | 'en'): string {
  if (!calendar) return '';
  const festivals = festivalsLine(calendar, lang);
  return festivals ? `${samvatLine(calendar, lang)} · ${festivals}` : samvatLine(calendar, lang);
}

/** The message's words, live timers and today's Samvat date, cut into what its animation moves. */
function piecesOf(
  message: MessageItem,
  a: LowerThirdAnimation,
  timers: readonly TimerState[],
  calendar: CalendarDay | null,
): { pieces: Piece[]; units: number } {
  const parts = message.parts ?? [{ kind: 'text' as const, text: message.text }];
  let units = 0;
  const pieces: Piece[] = [];
  parts.forEach((part, i) => {
    if (part.kind === 'text') {
      const cut = cutIntoUnits([part.text], a);
      for (const p of cut.pieces[0] ?? [])
        pieces.push({ node: p.text, unit: p.unit === null ? null : units + p.unit });
      units += cut.units;
      return;
    }
    const node =
      part.kind === 'timer' ? (
        <TimerText key={`t${String(i)}`} timer={timers.find((t) => t.id === part.timerId)} />
      ) : (
        <span key={`s${String(i)}`} lang={part.lang} data-samvat={part.lang}>
          {samvat(calendar, part.lang)}
        </span>
      );
    pieces.push({ node, unit: a.unit === 'box' ? null : units++ });
  });
  return { pieces, units };
}

/** Set a pose on an element (an empty value leaves it as it is). */
function put(el: HTMLElement, pose: Pose): void {
  el.style.opacity = pose.opacity === 1 ? '' : String(pose.opacity);
  el.style.transform = pose.transform;
  el.style.clipPath = pose.clip;
  el.style.transformOrigin = pose.origin;
  // The Lower Thirds studio's blurs (Session 55, Part 16).
  el.style.filter = pose.filter ?? '';
}

/** The message `t` ms into its in or out (else at rest), set straight on its band and units. */
function paint(
  band: HTMLElement | null,
  phase: Phase,
  a: LowerThirdAnimation,
  units: number,
  t: number,
  length: number,
): void {
  if (!band) return;
  const unitEls = [...band.querySelectorAll<HTMLElement>('[data-message-unit]')];
  band.dataset['messageAt'] =
    phase === 'in' || phase === 'out' ? String(Math.round(Math.min(t, length))) : '';
  if (phase !== 'in' && phase !== 'out') {
    put(band, REST);
    for (const el of unitEls) put(el, REST);
    return;
  }
  const frame = animationFrame(a, phase, t, units);
  put(band, frame.box);
  for (const el of unitEls) put(el, frame.unit(Number(el.dataset['messageUnit'])));
}

/** How far the band is from each edge of the picture, for a slide in from an edge (canvas pixels). */
function measureEdges(band: HTMLElement, canvas: Size): void {
  const slot = band.parentElement;
  const root = band.closest('[data-messages-canvas]');
  if (!slot || !root) return;
  const r = root.getBoundingClientRect();
  const s = slot.getBoundingClientRect();
  const k = r.width > 0 ? r.width / canvas.width : 1;
  const left = (s.left - r.left) / k;
  const top = (s.top - r.top) / k;
  const width = s.width / k;
  const height = s.height / k;
  band.style.setProperty('--from-left', `${String(Math.round(left + width))}px`);
  band.style.setProperty('--from-right', `${String(Math.round(canvas.width - left))}px`);
  band.style.setProperty('--from-top', `${String(Math.round(top + height))}px`);
  band.style.setProperty('--from-bottom', `${String(Math.round(canvas.height - top))}px`);
}

/** A place as the screens name it: "top-left", "bottom-centre", or "dragged". */
const placeName = (look: MessageLook): string =>
  isDragged(look.place) ? 'dragged' : `${look.place.row}-${look.place.column}`;

/** One message in its look: coming in, still, or going out (`off`: when it was taken off). */
function MessageView({
  message,
  look,
  off,
  timers,
  calendar,
  canvas,
}: {
  message: MessageItem;
  look: MessageLook;
  off: number | null;
  timers: readonly TimerState[];
  calendar: CalendarDay | null;
  canvas: Size;
}) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onClockJump(redraw), []);
  const bandRef = useRef<HTMLDivElement>(null);
  const a = messageAnimation(look);
  const { pieces, units } = piecesOf(message, a, timers, calendar);
  const now = engineNow();
  let phase: Phase;
  let start: number;
  if (off !== null) {
    phase = now - off < animationLength(a, 'out', units) ? 'out' : 'gone';
    start = off;
  } else {
    // Put back after a restart (no time): simply there.
    start = message.shownAt ?? -Infinity;
    phase = now - start < animationLength(a, 'in', units) ? 'in' : 'still';
  }
  const length = phase === 'in' || phase === 'out' ? animationLength(a, phase, units) : 0;
  // Frame by frame from the engine's clock while it moves; at the frame it is over, drawn again at once.
  useLayoutEffect(() => {
    if (phase !== 'in' && phase !== 'out') return;
    let frame = 0;
    const tick = () => {
      const t = engineNow() - start;
      if (t >= length) {
        flushSync(redraw);
        return;
      }
      paint(bandRef.current, phase, a, units, t, length);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [phase, start, length, a, units]);
  // Where its edges are, for a slide in from one; then, before it is shown, as at the moment worked out for.
  useLayoutEffect(() => {
    const band = bandRef.current;
    if (!band) return;
    measureEdges(band, canvas);
    paint(band, phase, a, units, now - start, length);
  });
  if (phase === 'gone') return null;
  const size = messageTextPx(look, canvas.height);
  const behind = look.behind;
  const band: CSSProperties = {
    fontFamily: fontFamilyFor(look.font, detectLang(message.text)),
    fontSize: size,
    fontWeight: look.weight,
    color: look.color,
    lineHeight: 1.25,
    textAlign: messageTextAlign(look.place),
    overflowWrap: 'anywhere',
    ...(behind === 'none'
      ? { textShadow: '0 0.04em 0.18em rgba(0, 0, 0, 0.85)' }
      : {
          background: withOpacity(look.behindColor, look.behindOpacity),
          padding:
            behind === 'band'
              ? `${String(size * 0.5)}px ${String(size)}px`
              : `${String(size * 0.3)}px ${String(size * 0.6)}px`,
          ...(behind === 'box' ? { borderRadius: size * 0.2 } : {}),
        }),
  };
  return (
    <div
      data-message-box=""
      data-message={message.id}
      data-place={placeName(look)}
      data-animation={a.id}
      data-phase={phase}
      style={{ display: 'flex', justifyContent: behind === 'band' ? 'stretch' : 'center' }}
    >
      <div
        ref={bandRef}
        data-message-band=""
        lang={textLang(message.text)}
        style={{ ...band, flex: behind === 'band' ? 1 : undefined }}
      >
        {pieces.map((p, i): ReactNode =>
          p.unit === null ? (
            <span key={i}>{p.node}</span>
          ) : (
            <span
              key={i}
              data-message-unit={p.unit}
              style={{ display: a.unit === 'line' ? 'block' : 'inline-block', whiteSpace: 'pre' }}
            >
              {p.node}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

interface Shown {
  message: MessageItem;
  look: MessageLook;
  off: number | null;
}

/** Messages in one place go one above another: from the edge inwards at the top and bottom, a column in the middle. */
const groupKey = (look: MessageLook): string =>
  isDragged(look.place)
    ? `dragged:${String(look.place.x)},${String(look.place.y)}`
    : `${look.place.row}-${look.place.column}-${look.behind === 'band' ? 'band' : 'box'}`;

/**
 * Every message with a look of its own, up or going out, in its place. `lift`: canvas pixels kept clear at the bottom
 * (the ticker's band).
 */
export function HallMessages({
  messages,
  leaving,
  timers,
  calendar = null,
  canvas,
  lift = 0,
}: {
  messages: readonly MessageItem[];
  /** The engine's messagesOff: the ones just taken off, whose outs play from then. */
  leaving: readonly { message: MessageItem; at: number }[] | undefined;
  timers: readonly TimerState[];
  calendar?: CalendarDay | null;
  canvas: Size;
  lift?: number;
}) {
  const shown: Shown[] = [];
  for (const m of messages) if (m.look) shown.push({ message: m, look: m.look, off: null });
  for (const o of leaving ?? [])
    if (o.message.look && !messages.some((m) => m.id === o.message.id))
      shown.push({ message: o.message, look: o.message.look, off: o.at });
  if (shown.length === 0) return null;
  const groups = new Map<string, Shown[]>();
  for (const s of shown) {
    const key = groupKey(s.look);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return (
    <div data-messages-canvas="" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {[...groups.entries()].map(([key, group]) => {
        const first = group[0];
        if (!first) return null;
        const place = first.look.place;
        const bottom = !isDragged(place) && place.row === 'bottom';
        return (
          <div
            key={key}
            data-message-group={key}
            style={{
              ...messageBoxStyle(first.look, canvas, lift),
              display: 'flex',
              flexDirection: bottom ? 'column-reverse' : 'column',
              alignItems:
                first.look.behind === 'band'
                  ? 'stretch'
                  : isDragged(place) || place.column === 'centre'
                    ? 'center'
                    : place.column === 'left'
                      ? 'flex-start'
                      : 'flex-end',
              gap: messageTextPx(first.look, canvas.height) * 0.3,
            }}
          >
            {group.map((s) => (
              <MessageView
                key={s.message.id}
                message={s.message}
                look={s.look}
                off={s.off}
                timers={timers}
                calendar={calendar}
                canvas={canvas}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
