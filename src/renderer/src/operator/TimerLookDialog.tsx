import { useState } from 'react';
import { LOWER_THIRD_FONTS, type LowerThirdFont } from '../../../shared/lower-thirds';
import { STAGE_TIMER_FORMATS, type StageTimerFormat } from '../../../shared/stage-layouts';
import {
  AT_ZERO_NAMES,
  AUDIENCE_TIMER_AT_ZERO,
  AUDIENCE_TIMER_OVER,
  AUDIENCE_TIMER_PLACES,
  AUDIENCE_TIMER_SIZE,
  type AudienceTimerAtZero,
  type AudienceTimerLook,
  type AudienceTimerOver,
  type AudienceTimerPlace,
  LABEL_MAX,
  OVER_NAMES,
  PLACE_NAMES,
  SHAPE_NAMES,
  TIME_LEFT_SHAPES,
  type TimeLeftShape,
  ZERO_TEXT_MAX,
} from '../../../shared/timer-look';
import { lookOf } from '../../../shared/audience-timer';
import type { TimerState } from '../../../shared/timers';
import { AudienceTimerView } from '../render/AudienceTimer';
import { engineNow } from '../render/clock';
import { PlacedInParent } from '../render/Placed';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ColorInput, Field, NumberInput, Select, TextInput } from '../ui/Field';
import { Minus, Plus } from '../ui/icons';
import { Checkbox } from '../ui/Toggle';

/*
 * A timer's look for the audience (Session 55, Part 15, shared/timer-look.ts), beside a small picture of it as the
 * hall's screens draw it: where it goes (full screen or a corner), over the wallpaper or over what is up, its size,
 * font and colours, a label above it, how it writes the time, a ring or a bar of the time left, a warning colour and a
 * flash near the end, what it does at zero, and whether the stage screens show it too. Kept with the timer.
 */

const CANVAS = { width: 1920, height: 1080 };

const FORMAT_NAMES: Record<StageTimerFormat, string> = {
  auto: 'As needed (5:00, 1:05:00)',
  mss: 'Minutes and seconds (65:00)',
  hmmss: 'Hours too (0:05:00)',
};

const sizeWords = (n: number): string =>
  n === 0
    ? 'Standard'
    : `${String(Math.abs(n))} ${Math.abs(n) === 1 ? 'step' : 'steps'} ${n > 0 ? 'bigger' : 'smaller'}`;

export function TimerLookDialog({ timer, onClose }: { timer: TimerState; onClose: () => void }) {
  const [look, setLook] = useState<AudienceTimerLook>(lookOf(timer));
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<AudienceTimerLook>) => {
    setLook((l) => ({ ...l, ...patch }));
  };
  // The small picture shows it as it is now, in this look, from when the dialog opened.
  const [shownAt] = useState(() => engineNow());
  const save = async () => {
    const { name, kind, durationMs, targetTime, allowsOverrun } = timer;
    const result = await window.drashti.timers.update(timer.id, {
      name,
      kind,
      durationMs,
      targetTime,
      allowsOverrun,
      look,
    });
    if (result.ok) onClose();
    else setProblem(result.message);
  };
  const countsDown = timer.kind === 'countdown' || timer.kind === 'countdown_to_time';
  return (
    <Dialog
      title={`How it looks for the audience: ${timer.name}`}
      subtitle="How this timer shows on the hall’s screens when it is up for the audience."
      size="lg"
      onClose={onClose}
      closeLabel="Close the timer’s look"
      testId="timer-look"
      bodyClassName="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <div
          data-testid="timer-look-preview"
          data-a11y-picture
          aria-hidden="true"
          className="relative aspect-video w-full overflow-hidden rounded-md border border-line-strong bg-[#24324a]"
        >
          <PlacedInParent content={CANVAS} mode="fit" className="absolute inset-0">
            <div className="relative h-[1080px] w-[1920px]">
              <AudienceTimerView
                layer={{ timerId: timer.id, shownAt }}
                off={null}
                timers={[{ ...timer, look }]}
                canvas={CANVAS}
              />
            </div>
          </PlacedInParent>
        </div>
        <p className="text-xs text-faint">
          The blue stands for what is up on the screens; over the wallpaper, the wallpaper shows instead.
        </p>
        <Field label="Label above it" hint="Placeholder words only, for example “Activity ends in”.">
          <TextInput
            aria-label="Label above it"
            value={look.label}
            maxLength={LABEL_MAX}
            placeholder="Activity ends in"
            onChange={(e) => {
              set({ label: e.target.value });
            }}
          />
        </Field>
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Where">
            <Select
              aria-label="Where"
              value={look.place}
              onChange={(e) => {
                set({ place: e.target.value as AudienceTimerPlace });
              }}
            >
              {AUDIENCE_TIMER_PLACES.map((p) => (
                <option key={p} value={p}>
                  {PLACE_NAMES[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Behind it">
            <Select
              aria-label="Behind it"
              value={look.over}
              onChange={(e) => {
                set({ over: e.target.value as AudienceTimerOver });
              }}
            >
              {AUDIENCE_TIMER_OVER.map((o) => (
                <option key={o} value={o}>
                  {OVER_NAMES[o]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Font">
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
          <Field label="Format">
            <Select
              aria-label="Format"
              value={look.format}
              onChange={(e) => {
                set({ format: e.target.value as StageTimerFormat });
              }}
            >
              {STAGE_TIMER_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_NAMES[f]}
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
            disabled={look.size <= AUDIENCE_TIMER_SIZE.min}
            onClick={() => {
              set({ size: Math.max(AUDIENCE_TIMER_SIZE.min, look.size - 1) });
            }}
          />
          <span aria-live="polite" className="min-w-24 text-center text-xs text-fg">
            {sizeWords(look.size)}
          </span>
          <IconButton
            size="sm"
            variant="secondary"
            icon={Plus}
            label="Bigger"
            disabled={look.size >= AUDIENCE_TIMER_SIZE.max}
            onClick={() => {
              set({ size: Math.min(AUDIENCE_TIMER_SIZE.max, look.size + 1) });
            }}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Field label="Time colour" layout="inline">
            <ColorInput
              aria-label="Time colour"
              value={look.color}
              onChange={(e) => {
                set({ color: e.target.value });
              }}
            />
          </Field>
          <Field label="Label colour" layout="inline">
            <ColorInput
              aria-label="Label colour"
              value={look.labelColor}
              onChange={(e) => {
                set({ labelColor: e.target.value });
              }}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Time left">
            <Select
              aria-label="Time left"
              value={look.timeLeft}
              onChange={(e) => {
                set({ timeLeft: e.target.value as TimeLeftShape });
              }}
            >
              {TIME_LEFT_SHAPES.map((t) => (
                <option key={t} value={t}>
                  {SHAPE_NAMES[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Its colour" layout="inline">
            <ColorInput
              aria-label="Ring or bar colour"
              value={look.timeLeftColor}
              disabled={look.timeLeft === 'none'}
              onChange={(e) => {
                set({ timeLeftColor: e.target.value });
              }}
            />
          </Field>
        </div>
        {!countsDown && (
          <p className="text-xs text-faint">
            A count up or a clock has no end: no ring or bar, warning, flash or zero.
          </p>
        )}
        <Checkbox
          label="A warning colour near the end"
          checked={look.warn !== null}
          onChange={(e) => {
            set({ warn: e.target.checked ? { fromMs: 60_000, color: '#f5a524' } : null });
          }}
        />
        {look.warn && (
          <div className="flex flex-wrap items-center gap-3 pl-6">
            <Field label="From (seconds left)" layout="inline">
              <NumberInput
                aria-label="Warning from, in seconds left"
                min={1}
                max={3600}
                value={Math.round(look.warn.fromMs / 1000)}
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (Number.isFinite(v) && v >= 1 && v <= 3600 && look.warn)
                    set({ warn: { ...look.warn, fromMs: v * 1000 } });
                }}
              />
            </Field>
            <ColorInput
              aria-label="Warning colour"
              value={look.warn.color}
              onChange={(e) => {
                if (look.warn) set({ warn: { ...look.warn, color: e.target.value } });
              }}
            />
          </div>
        )}
        <Checkbox
          label="Flash near the end"
          checked={look.flash}
          onChange={(e) => {
            set({ flash: e.target.checked });
          }}
        />
        <Field label="At zero">
          <Select
            aria-label="At zero"
            value={look.atZero}
            onChange={(e) => {
              set({ atZero: e.target.value as AudienceTimerAtZero });
            }}
          >
            {AUDIENCE_TIMER_AT_ZERO.map((z) => (
              <option key={z} value={z}>
                {AT_ZERO_NAMES[z]}
              </option>
            ))}
          </Select>
        </Field>
        {look.atZero === 'message' && (
          <Field label="Message at zero">
            <TextInput
              aria-label="Message at zero"
              value={look.zeroText}
              maxLength={ZERO_TEXT_MAX}
              placeholder="Time is up"
              onChange={(e) => {
                set({ zeroText: e.target.value });
              }}
            />
          </Field>
        )}
        <Checkbox
          label="On the stage screens too"
          checked={look.stage}
          onChange={(e) => {
            set({ stage: e.target.checked });
          }}
        />
        {problem && (
          <p role="alert" className="text-xs text-warning-fg">
            {problem}
          </p>
        )}
      </div>
    </Dialog>
  );
}
