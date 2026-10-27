import { useState } from 'react';
import { Field, NumberInput } from '../ui/Field';

/**
 * A number in the stage layout editor: a box's place and size, its words' size, how many items it lists, its
 * line's width. What is typed shows while the field has the keyboard, and the box takes it at once, kept within
 * what it allows by `onChange`; leaving the field shows what the box took. Session 53 made it for the place and
 * size (each figure was taken as it came, so a size begun below the smallest was made the smallest before its next
 * figure); Session 54 for the Text size (G4: "4" became 8) and, in Part A's review, a line's width and how many
 * items (Backspace then 8 gave 38, the figure before put back between the two).
 */
export function TypedNumberField({
  label,
  value,
  min,
  max,
  step,
  unit,
  testId,
  onChange,
}: {
  label: string;
  value: number;
  /** The smallest it takes: its arrows stop there. */
  min?: number;
  /** The largest it takes: its arrows stop there. */
  max?: number;
  /** How far its arrows step (1 unless given: 0.5 for a line's width). */
  step?: number;
  /** Written after it ("px"), or nothing. */
  unit?: string;
  testId?: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Field label={label}>
      <NumberInput
        value={draft ?? String(value)}
        min={min}
        max={max}
        step={step}
        unit={unit}
        data-testid={testId}
        onFocus={() => {
          setDraft(String(value));
        }}
        onBlur={() => {
          setDraft(null);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = e.target.valueAsNumber;
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </Field>
  );
}
