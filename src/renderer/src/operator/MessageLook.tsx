import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MessageItem } from '../../../shared/engine/state';
import { animationById } from '../../../shared/lower-third-animations';
import { isOffered, OFFERED_ANIMATIONS } from '../../../shared/lower-third-studio';
import { LOWER_THIRD_FONTS, type LowerThirdFont } from '../../../shared/lower-thirds';
import {
  BEHIND_NAMES,
  clampSize,
  COLUMN_NAMES,
  draggedTo,
  isDragged,
  MESSAGE_BEHIND,
  MESSAGE_COLUMNS,
  MESSAGE_FIRST_ANIMATIONS,
  MESSAGE_ROWS,
  MESSAGE_SIZE,
  MESSAGE_WEIGHTS,
  type MessageBehind,
  type MessageColumn,
  type MessageLook,
  type MessageRow,
  type MessageWeight,
  placeWords,
  ROW_NAMES,
  sizeWords,
  WEIGHT_NAMES,
} from '../../../shared/message-look';
import { engineNow } from '../render/clock';
import { HallMessages } from '../render/HallMessages';
import { PlacedInParent } from '../render/Placed';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { ColorInput, Field, Select, Slider } from '../ui/Field';
import { Minus, Play, Plus } from '../ui/icons';
import { radioKeys, radioTabIndex } from '../ui/radio';

/*
 * A message's look, in the Messages panel's form (Session 55, Part 15): where it sits (nine places, or dragged in the
 * small picture), how it comes in and goes out, how long it stays up, its font, size (the standard size with steps
 * bigger and smaller), weight and colour, and a band or a box behind it with its colour and how see-through it is;
 * beside a small picture of it, drawn as the screens draw it (render/HallMessages.tsx), which Play shows coming in.
 */

const CANVAS = { width: 1920, height: 1080 };

/** How long a message can stay up by itself, offered in its list (seconds); "until" is until taken off. */
const SECONDS = [5, 10, 15, 30, 60, 120, 300, 600] as const;

export const secondsWords = (s: number): string =>
  s < 60 ? `${String(s)} seconds` : s === 60 ? '1 minute' : `${String(s / 60)} minutes`;

/** The nine places, row by row, as one radio group. */
const PLACES = MESSAGE_ROWS.flatMap((row) => MESSAGE_COLUMNS.map((column) => ({ row, column })));
const placeKey = (p: { row: MessageRow; column: MessageColumn }) => `${p.row}-${p.column}`;

/** The words for the small picture: the message's own, or what it would say, its fields shown by name. */
function previewItem(words: string, look: MessageLook, shownAt: number): MessageItem {
  const text = words.trim() === '' ? 'Placeholder message' : words;
  return { id: 'preview', text, look, shownAt };
}

/** The small picture: the message in its look at its place; dragged, its middle goes where it is let go. */
function MessagePreview({
  words,
  look,
  onDrag,
}: {
  words: string;
  look: MessageLook;
  onDrag: (place: { x: number; y: number }) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  // Played again from now (Play), else at rest.
  const [shownAt, setShownAt] = useState(-Infinity);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const bandAt = (e: ReactPointerEvent): DOMRect | null => {
    const band = frame.current?.querySelector('[data-message-band]');
    const r = band?.getBoundingClientRect();
    return r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      ? r
      : null;
  };
  const placeFor = (e: ReactPointerEvent) => {
    const f = frame.current?.getBoundingClientRect();
    const d = drag.current;
    if (!f || !d || f.width === 0) return null;
    return draggedTo((e.clientX + d.dx - f.left) / f.width, (e.clientY + d.dy - f.top) / f.height);
  };
  return (
    <div className="space-y-1">
      <div
        ref={frame}
        data-testid="message-preview"
        data-a11y-picture
        aria-hidden="true"
        className="relative aspect-video w-full touch-none overflow-hidden rounded-md border border-line-strong bg-black select-none"
        onPointerDown={(e) => {
          const band = bandAt(e);
          if (!band) return;
          // Held by where it was taken, so it never jumps under the pointer.
          drag.current = {
            dx: band.left + band.width / 2 - e.clientX,
            dy: band.top + band.height / 2 - e.clientY,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const place = placeFor(e);
          if (place) onDrag(place);
        }}
        onPointerUp={(e) => {
          const place = placeFor(e);
          drag.current = null;
          if (place) onDrag(place);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <PlacedInParent content={CANVAS} mode="fit" className="absolute inset-0">
          <div className="relative h-[1080px] w-[1920px] cursor-grab">
            <HallMessages
              key={String(shownAt)}
              messages={[previewItem(words, look, shownAt)]}
              leaving={[]}
              timers={[]}
              canvas={CANVAS}
            />
          </div>
        </PlacedInParent>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-faint">Drag it in the picture to put it anywhere.</p>
        <Button
          size="sm"
          variant="ghost"
          icon={Play}
          data-testid="message-preview-play"
          onClick={() => {
            setShownAt(engineNow());
          }}
        >
          Play
        </Button>
      </div>
    </div>
  );
}

/**
 * The ones a message offers first, and every other the Lower Thirds studio offers (Session 55, Part 16: its one table,
 * OFFERED, of what is smooth on a two-core computer without a graphics chip).
 */
const FIRST_ANIMATIONS = MESSAGE_FIRST_ANIMATIONS.filter(isOffered);
const MORE_ANIMATIONS = OFFERED_ANIMATIONS.filter(
  (a) => !(MESSAGE_FIRST_ANIMATIONS as readonly string[]).includes(a.id),
);

export function MessageLookFields({
  words,
  look,
  seconds,
  onLook,
  onSeconds,
}: {
  /** The message's words, for the small picture. */
  words: string;
  look: MessageLook;
  /** How long it stays up by itself, or null until taken off. */
  seconds: number | null;
  onLook: (look: MessageLook) => void;
  onSeconds: (seconds: number | null) => void;
}) {
  const set = (patch: Partial<MessageLook>) => {
    onLook({ ...look, ...patch });
  };
  const place = look.place;
  const chosen = isDragged(place) ? null : placeKey(place);
  const keys = PLACES.map(placeKey);
  const offered =
    seconds === null || (SECONDS as readonly number[]).includes(seconds) ? SECONDS : [...SECONDS, seconds];
  return (
    <div data-testid="message-look" className="space-y-2 border-t border-line pt-2">
      <MessagePreview
        words={words}
        look={look}
        onDrag={(p) => {
          set({ place: p });
        }}
      />
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-1">
          <span id="message-place-label" className="text-xs font-medium text-muted">
            Where
          </span>
          <div
            role="radiogroup"
            aria-labelledby="message-place-label"
            className="grid w-max grid-cols-3 gap-0.5"
            onKeyDown={radioKeys(keys, chosen ?? '', (key) => {
              const p = PLACES[keys.indexOf(key)];
              if (p) set({ place: p });
            })}
          >
            {PLACES.map((p, i) => {
              const key = placeKey(p);
              const name = `${ROW_NAMES[p.row]} ${COLUMN_NAMES[p.column].toLowerCase()}`;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={key === chosen}
                  aria-label={name}
                  title={name}
                  tabIndex={radioTabIndex(key === chosen, i, chosen !== null)}
                  className={cx(
                    'grid size-6 place-items-center rounded-sm border',
                    key === chosen
                      ? 'border-accent bg-accent/30'
                      : 'border-field bg-panel-2 hover:border-muted',
                  )}
                  onClick={() => {
                    set({ place: p });
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={cx('size-1.5 rounded-full', key === chosen ? 'bg-fg' : 'bg-faint')}
                  />
                </button>
              );
            })}
          </div>
          <span data-testid="message-place-words" className="text-xs text-muted">
            {placeWords(place)}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Field label="Comes in and goes out">
            <Select
              aria-label="Comes in and goes out"
              value={look.animation}
              onChange={(e) => {
                set({ animation: e.target.value });
              }}
            >
              {FIRST_ANIMATIONS.map((id) => (
                <option key={id} value={id}>
                  {animationById(id).name}
                </option>
              ))}
              {/* One chosen before that is no longer offered: it is kept, and still listed. */}
              {!isOffered(look.animation) && (
                <option value={look.animation}>{animationById(look.animation).name}</option>
              )}
              <optgroup label="More, as the Lower Thirds have them">
                {MORE_ANIMATIONS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <Field label="How long">
            <Select
              aria-label="How long"
              value={seconds === null ? 'until' : String(seconds)}
              onChange={(e) => {
                onSeconds(e.target.value === 'until' ? null : Number(e.target.value));
              }}
            >
              <option value="until">Until it is taken off</option>
              {offered.map((s) => (
                <option key={s} value={String(s)}>
                  {secondsWords(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Font" className="min-w-0 flex-1">
          <Select
            aria-label="Font"
            value={look.font}
            onChange={(e) => {
              set({ font: e.target.value as LowerThirdFont });
            }}
          >
            {LOWER_THIRD_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Weight">
          <Select
            aria-label="Weight"
            value={String(look.weight)}
            onChange={(e) => {
              set({ weight: Number(e.target.value) as MessageWeight });
            }}
          >
            {MESSAGE_WEIGHTS.map((w) => (
              <option key={w} value={String(w)}>
                {WEIGHT_NAMES[w]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted">Size</span>
        <IconButton
          size="sm"
          variant="secondary"
          icon={Minus}
          label="Smaller"
          disabled={clampSize(look.size) <= MESSAGE_SIZE.min}
          onClick={() => {
            set({ size: clampSize(look.size - 1) });
          }}
        />
        <span data-testid="message-size" aria-live="polite" className="min-w-24 text-center text-xs text-fg">
          {sizeWords(look.size)}
        </span>
        <IconButton
          size="sm"
          variant="secondary"
          icon={Plus}
          label="Bigger"
          disabled={clampSize(look.size) >= MESSAGE_SIZE.max}
          onClick={() => {
            set({ size: clampSize(look.size + 1) });
          }}
        />
      </div>
      <Field label="Words colour" layout="inline">
        <ColorInput
          aria-label="Words colour"
          value={look.color}
          onChange={(e) => {
            set({ color: e.target.value });
          }}
        />
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Behind the words" className="min-w-0 flex-1">
          <Select
            aria-label="Behind the words"
            value={look.behind}
            onChange={(e) => {
              set({ behind: e.target.value as MessageBehind });
            }}
          >
            {MESSAGE_BEHIND.map((b) => (
              <option key={b} value={b}>
                {BEHIND_NAMES[b]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Its colour" layout="inline">
          <ColorInput
            aria-label="Behind colour"
            value={look.behindColor}
            disabled={look.behind === 'none'}
            onChange={(e) => {
              set({ behindColor: e.target.value });
            }}
          />
        </Field>
      </div>
      <Field label="See-through">
        <Slider
          aria-label="See-through"
          min={0}
          max={100}
          step={1}
          value={Math.round((1 - look.behindOpacity) * 100)}
          disabled={look.behind === 'none'}
          format={(v) => `${String(v)}%`}
          onChange={(e) => {
            set({ behindOpacity: Math.round(100 - Number(e.target.value)) / 100 });
          }}
        />
      </Field>
    </div>
  );
}
