import { useState } from 'react';
import type { TransitionKind } from '../../../shared/model';
import { TRANSITION_NAMES } from '../../../shared/model';
import type { RepeatSettings } from '../../../shared/repeat';
import { REPEAT_SECONDS, REPEAT_TRANSITION_MS, REPEAT_TRANSITIONS } from '../../../shared/repeat';
import { useEngine } from '../engine/engine-store';
import { Button } from '../ui/Button';
import { Field, NumberInput, Select } from '../ui/Field';
import { Play, Square } from '../ui/icons';
import { saveRepeatSettings } from './playlist-store';
import { startRepeat, stopRepeat } from './repeat-actions';

/*
 * A Repeat Slides playlist's line under its name (Session 26d): how long
 * each slide is up, how it comes on and how long that takes, and Start or
 * Stop. A change takes effect from the next slide; a transition never takes
 * more than half the seconds each (it is shortened to fit).
 */

/** The settings with the transition's length fitted: 0.3 to 3 s, at most half the seconds each; none for a cut. */
export function fitted(settings: RepeatSettings): RepeatSettings {
  const { kind } = settings.transition;
  if (kind === 'cut') return { secondsEach: settings.secondsEach, transition: { kind, durationMs: 0 } };
  const half = Math.floor((settings.secondsEach * 1000) / 2);
  const wanted = settings.transition.durationMs > 0 ? settings.transition.durationMs : 1000;
  const durationMs = Math.min(Math.max(wanted, REPEAT_TRANSITION_MS.min), REPEAT_TRANSITION_MS.max, half);
  return { secondsEach: settings.secondsEach, transition: { kind, durationMs } };
}

/** A number typed in a field: what is typed while it is, saved when it reads (clamped). */
function useDraft(shown: string): [string, (typed: string | null) => void] {
  const [draft, setDraft] = useState<string | null>(null);
  return [draft ?? shown, setDraft];
}

export function RepeatBar({ playlistId, settings }: { playlistId: string; settings: RepeatSettings }) {
  const going = useEngine((s) => s.state?.repeat?.playlistId === playlistId);
  const [seconds, setSeconds] = useDraft(String(settings.secondsEach));
  const [length, setLength] = useDraft(String(settings.transition.durationMs / 1000));
  const save = (next: RepeatSettings) => {
    void saveRepeatSettings(playlistId, fitted(next));
  };
  const kind = settings.transition.kind;
  return (
    <div
      data-testid="repeat-bar"
      className="flex shrink-0 flex-wrap items-end gap-x-3 gap-y-2 border-b border-line px-3 py-2"
    >
      <Field label="Seconds each" className="w-28">
        <NumberInput
          data-testid="repeat-seconds"
          unit="s"
          min={REPEAT_SECONDS.min}
          max={REPEAT_SECONDS.max}
          step={1}
          value={seconds}
          onChange={(e) => {
            setSeconds(e.target.value);
            const n = Number(e.target.value);
            if (
              e.target.value.trim() !== '' &&
              Number.isFinite(n) &&
              n >= REPEAT_SECONDS.min &&
              n <= REPEAT_SECONDS.max
            )
              save({ ...settings, secondsEach: Math.round(n) });
          }}
          onBlur={() => {
            setSeconds(null);
          }}
        />
      </Field>
      <Field label="Transition" className="w-44">
        <Select
          data-testid="repeat-transition"
          className="w-full"
          value={kind}
          onChange={(e) => {
            save({
              ...settings,
              transition: {
                kind: e.target.value as TransitionKind,
                durationMs: settings.transition.durationMs,
              },
            });
          }}
        >
          {REPEAT_TRANSITIONS.map((k) => (
            <option key={k} value={k}>
              {TRANSITION_NAMES[k]}
            </option>
          ))}
        </Select>
      </Field>
      {kind !== 'cut' && (
        <Field label="Taking" className="w-28">
          <NumberInput
            data-testid="repeat-transition-seconds"
            unit="s"
            min={REPEAT_TRANSITION_MS.min / 1000}
            max={Math.min(REPEAT_TRANSITION_MS.max, (settings.secondsEach * 1000) / 2) / 1000}
            step={0.1}
            value={length}
            onChange={(e) => {
              setLength(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value.trim() !== '' && Number.isFinite(n) && n > 0)
                save({ ...settings, transition: { kind, durationMs: Math.round(n * 1000) } });
            }}
            onBlur={() => {
              setLength(null);
            }}
          />
        </Field>
      )}
      <span className="flex-1" />
      {going ? (
        <Button icon={Square} data-testid="repeat-stop" onClick={() => void stopRepeat()}>
          Stop (Esc)
        </Button>
      ) : (
        <Button
          variant="primary"
          icon={Play}
          data-testid="repeat-start"
          onClick={() => void startRepeat(playlistId)}
        >
          Start
        </Button>
      )}
    </div>
  );
}
