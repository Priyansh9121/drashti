import { WEEKDAY_NAMES, WEEKDAY_SHORT } from '../../../shared/schedule';
import { Checkbox } from './Toggle';

/** The days of the week to tick (0 Sunday … 6 Saturday), for a schedule. */
export function DaysPicker({
  days,
  onChange,
  label = 'Days of the week',
}: {
  days: number[];
  onChange: (days: number[]) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-x-3 gap-y-1">
      {WEEKDAY_NAMES.map((name, day) => (
        <Checkbox
          key={name}
          label={WEEKDAY_SHORT[day]}
          aria-label={name}
          checked={days.includes(day)}
          onChange={(e) => {
            onChange(e.target.checked ? [...days, day].sort((a, b) => a - b) : days.filter((d) => d !== day));
          }}
        />
      ))}
    </div>
  );
}
