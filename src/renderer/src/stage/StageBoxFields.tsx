import { useId, useState } from 'react';
import type { BoxOrder, StageBox, StageTimerFormat, StageVAlign } from '../../../shared/stage-layouts';
import { arrangeBoxes, MAX_OUTLINE, STAGE_TIMER_FORMATS, STAGE_VALIGNS } from '../../../shared/stage-layouts';
import { FLASH_FOR_MS } from '../../../shared/stage-timer';
import { parseDuration, timerDuration } from '../../../shared/timers';
import { IconButton } from '../ui/Button';
import { ColorInput, Field, Select, Slider, TextInput } from '../ui/Field';
import { ArrowDown, ArrowUp, BringToFront, SendToBack } from '../ui/icons';
import { Checkbox, Toggle } from '../ui/Toggle';
import { change } from './stage-layouts-store';
import { TypedNumberField } from './TypedNumberField';

/*
 * A stage layout box's own settings in the layout editor (Session 54, Part A2), beside its place, size, colour and
 * label (stage/StageLayoutEditor.tsx): which box is over which; up and down, bold, a fill behind it and how
 * see-through it is, a line round the letters and a soft shadow; a timer box's way of writing the time, its
 * colour from a warning time and when over, and its flash at 0:00; a clock box's 12 or 24 hours and seconds.
 * Each is left out of the box until it is set, so a layout saved before is saved as it was.
 */

/** A box's settings changed: the layout shown, with this box as `fn` makes it. */
function changeBox(id: string, fn: (box: StageBox) => StageBox): void {
  change((e) => ({ ...e, boxes: e.boxes.map((b) => (b.id === id ? fn(b) : b)) }));
}

/** The box without these settings (left out, as a box saved before has none). */
function without(box: StageBox, ...keys: (keyof StageBox)[]): StageBox {
  const left: string[] = keys;
  return Object.fromEntries(
    Object.entries(box).filter(([key]) => !left.includes(key)),
  ) as unknown as StageBox;
}

const VALIGN_NAMES: Record<StageVAlign, string> = { top: 'Top', middle: 'Middle', bottom: 'Bottom' };

const FORMAT_NAMES: Record<StageTimerFormat, string> = {
  auto: 'As needed (5:00, then 1:05:00)',
  mss: 'Minutes and seconds (65:00)',
  hmmss: 'Hours, minutes and seconds (0:05:00)',
};

/** The colours a box's settings start with until another is chosen. */
const FILL_COLOR = '#000000';
const FILL_SEE_THROUGH = 0.4;
const OUTLINE_COLOR = '#000000';
const WARN_COLOR = '#f5a524';
const WARN_FROM_MS = 60_000;
export const OVER_COLOR = '#ef4444';

/** Which box is over which (the list is bottom to top): to the front or the back, or one step. */
export function BoxOrderButtons({ box }: { box: StageBox }) {
  const move = (how: BoxOrder) => {
    change((e) => ({ ...e, boxes: arrangeBoxes(e.boxes, box.id, how) }));
  };
  const buttons: [BoxOrder, string, typeof ArrowUp][] = [
    ['front', 'Bring to the front', BringToFront],
    ['forward', 'Bring forward', ArrowUp],
    ['backward', 'Send backward', ArrowDown],
    ['back', 'Send to the back', SendToBack],
  ];
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted">In front or behind</p>
      <div className="flex flex-wrap gap-1" data-testid="stage-box-order">
        {buttons.map(([how, label, icon]) => (
          <IconButton
            key={how}
            icon={icon}
            size="sm"
            label={label}
            data-testid={`stage-box-${how}`}
            onClick={() => {
              move(how);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Up and down, bold, a fill and how see-through it is, a line round the letters, and a soft shadow. */
export function BoxLookFields({ box }: { box: StageBox }) {
  const fill = box.fill;
  const outline = box.outline;
  return (
    <div className="space-y-3" data-testid="stage-box-look">
      <Field label="Up and down">
        <Select
          value={box.valign ?? 'top'}
          data-testid="stage-box-valign"
          onChange={(e) => {
            const v = STAGE_VALIGNS.find((a) => a === e.target.value) ?? 'top';
            changeBox(box.id, (b) => (v === 'top' ? without(b, 'valign') : { ...b, valign: v }));
          }}
        >
          {STAGE_VALIGNS.map((a) => (
            <option key={a} value={a}>
              {VALIGN_NAMES[a]}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox
        label="Bold"
        checked={box.bold === true}
        data-testid="stage-box-bold"
        onChange={(e) => {
          const on = e.target.checked;
          changeBox(box.id, (b) => (on ? { ...b, bold: true } : without(b, 'bold')));
        }}
      />
      <Toggle
        label="A fill behind it"
        checked={fill !== undefined}
        data-testid="stage-box-fill"
        onChange={(on) => {
          changeBox(box.id, (b) =>
            on ? { ...b, fill: { color: FILL_COLOR, seeThrough: FILL_SEE_THROUGH } } : without(b, 'fill'),
          );
        }}
      />
      {fill && (
        <div className="space-y-2 pl-2">
          <Field label="Fill colour">
            <ColorInput
              value={fill.color}
              data-testid="stage-box-fill-color"
              onChange={(e) => {
                const color = e.target.value;
                changeBox(box.id, (b) => ({
                  ...b,
                  fill: { seeThrough: FILL_SEE_THROUGH, ...b.fill, color },
                }));
              }}
            />
          </Field>
          <Field label="See-through">
            <Slider
              min={0}
              max={95}
              step={5}
              value={Math.round(fill.seeThrough * 100)}
              format={(v) => `${String(v)}%`}
              data-testid="stage-box-see-through"
              onChange={(e) => {
                const seeThrough = Math.min(0.95, Math.max(0, e.target.valueAsNumber / 100));
                changeBox(box.id, (b) => ({ ...b, fill: { color: FILL_COLOR, ...b.fill, seeThrough } }));
              }}
            />
          </Field>
        </div>
      )}
      <Toggle
        label="A line round the letters"
        checked={outline !== undefined}
        data-testid="stage-box-outline"
        onChange={(on) => {
          changeBox(box.id, (b) =>
            on ? { ...b, outline: { color: OUTLINE_COLOR, width: 3 } } : without(b, 'outline'),
          );
        }}
      />
      {outline && (
        <div className="flex flex-wrap items-end gap-3 pl-2">
          <Field label="Line colour">
            <ColorInput
              value={outline.color}
              data-testid="stage-box-outline-color"
              onChange={(e) => {
                const color = e.target.value;
                changeBox(box.id, (b) => ({ ...b, outline: { width: 3, ...b.outline, color } }));
              }}
            />
          </Field>
          {/* As typed, the box taking it in half pixels (Part A's review: Backspace then 8 gave 38). */}
          <TypedNumberField
            label="Line width"
            value={outline.width}
            min={0.5}
            max={MAX_OUTLINE}
            step={0.5}
            unit="px"
            testId="stage-box-outline-width"
            onChange={(v) => {
              const width = Math.min(MAX_OUTLINE, Math.max(0.5, Math.round(v * 2) / 2));
              changeBox(box.id, (b) => ({ ...b, outline: { color: OUTLINE_COLOR, ...b.outline, width } }));
            }}
          />
        </div>
      )}
      <Checkbox
        label="A soft shadow under the words"
        checked={box.shadow === true}
        data-testid="stage-box-shadow"
        onChange={(e) => {
          const on = e.target.checked;
          changeBox(box.id, (b) => (on ? { ...b, shadow: true } : without(b, 'shadow')));
        }}
      />
    </div>
  );
}

/**
 * A time left typed as minutes and seconds ("1:00"): what is typed shows while the field has the keyboard, and the
 * box takes it once it reads as a time of one second or more; leaving the field shows what the box took.
 */
function TimeLeftField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (ms: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Field label={label}>
      <TextInput
        className="w-24"
        value={draft ?? timerDuration(value, false)}
        placeholder="1:00"
        data-testid="stage-box-warn-from"
        onFocus={() => {
          setDraft(timerDuration(value, false));
        }}
        onBlur={() => {
          setDraft(null);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const ms = parseDuration(e.target.value);
          if (ms !== null && ms >= 1000 && ms <= 24 * 3600 * 1000) onChange(ms);
        }}
      />
    </Field>
  );
}

/** A timer box's way of writing the time; for a countdown, its warning colour, its colour when over, and a flash. */
export function TimerBoxFields({ box, countsDown }: { box: StageBox; countsDown: boolean }) {
  const note = useId();
  return (
    <div className="space-y-3" data-testid="stage-box-timer-look">
      <Field label="Write the time">
        <Select
          value={box.format ?? 'auto'}
          data-testid="stage-box-format"
          onChange={(e) => {
            const v = STAGE_TIMER_FORMATS.find((f) => f === e.target.value) ?? 'auto';
            changeBox(box.id, (b) => (v === 'auto' ? without(b, 'format') : { ...b, format: v }));
          }}
        >
          {STAGE_TIMER_FORMATS.map((f) => (
            <option key={f} value={f}>
              {FORMAT_NAMES[f]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="space-y-2 border-t border-line pt-2" role="group" aria-labelledby={note}>
        <p id={note} className="text-xs text-muted" data-testid="stage-box-countdown-note">
          {countsDown
            ? 'For a countdown:'
            : 'For a countdown (this timer does not count down, so these change nothing):'}
        </p>
        <Toggle
          label="Another colour from a time left"
          checked={box.warn !== undefined}
          data-testid="stage-box-warn"
          onChange={(on) => {
            changeBox(box.id, (b) =>
              on ? { ...b, warn: { color: WARN_COLOR, fromMs: WARN_FROM_MS } } : without(b, 'warn'),
            );
          }}
        />
        {box.warn && (
          <div className="flex flex-wrap items-end gap-3 pl-2">
            <TimeLeftField
              label="From this much left"
              value={box.warn.fromMs}
              onChange={(fromMs) => {
                changeBox(box.id, (b) => ({ ...b, warn: { color: WARN_COLOR, ...b.warn, fromMs } }));
              }}
            />
            <Field label="Warning colour">
              <ColorInput
                value={box.warn.color}
                data-testid="stage-box-warn-color"
                onChange={(e) => {
                  const color = e.target.value;
                  changeBox(box.id, (b) => ({ ...b, warn: { fromMs: WARN_FROM_MS, ...b.warn, color } }));
                }}
              />
            </Field>
          </div>
        )}
        <Toggle
          label="Another colour at 0:00 and past it"
          checked={box.overColor !== undefined}
          data-testid="stage-box-over"
          onChange={(on) => {
            changeBox(box.id, (b) => (on ? { ...b, overColor: OVER_COLOR } : without(b, 'overColor')));
          }}
        />
        {box.overColor !== undefined && (
          <Field label="Colour when over" className="pl-2">
            <ColorInput
              value={box.overColor}
              data-testid="stage-box-over-color"
              onChange={(e) => {
                const overColor = e.target.value;
                changeBox(box.id, (b) => ({ ...b, overColor }));
              }}
            />
          </Field>
        )}
        <Toggle
          label="Flash at 0:00"
          checked={box.flash === true}
          data-testid="stage-box-flash"
          onChange={(on) => {
            changeBox(box.id, (b) => (on ? { ...b, flash: true } : without(b, 'flash')));
          }}
        />
        {box.flash === true && (
          <p className="pl-2 text-xs text-muted">
            Slowly, a second dim and a second bright, for {String(FLASH_FOR_MS / 1000)} seconds from 0:00, in
            step with any other timer flashing.
          </p>
        )}
      </div>
    </div>
  );
}

/** A clock box's hours, 12 or 24 (or as Drashti's computer writes the time), and its seconds. */
export function ClockBoxFields({ box }: { box: StageBox }) {
  return (
    <div className="space-y-3" data-testid="stage-box-clock-look">
      <Field label="Hours">
        <Select
          value={box.hours === undefined ? 'computer' : String(box.hours)}
          data-testid="stage-box-hours"
          onChange={(e) => {
            const v = e.target.value;
            changeBox(box.id, (b) =>
              v === '12' || v === '24' ? { ...b, hours: v === '12' ? 12 : 24 } : without(b, 'hours'),
            );
          }}
        >
          <option value="computer">As Drashti’s computer writes the time</option>
          <option value="12">12 hours (7:30 pm)</option>
          <option value="24">24 hours (19:30)</option>
        </Select>
      </Field>
      <Checkbox
        label="Seconds"
        checked={box.seconds === true}
        data-testid="stage-box-seconds"
        onChange={(e) => {
          const on = e.target.checked;
          changeBox(box.id, (b) => (on ? { ...b, seconds: true } : without(b, 'seconds')));
        }}
      />
    </div>
  );
}
