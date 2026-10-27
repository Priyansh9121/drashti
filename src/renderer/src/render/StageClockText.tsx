import type { ClockStyle } from '../../../shared/format';
import type { StageBox } from '../../../shared/stage-layouts';
import { stageClockText } from '../../../shared/stage-timer';
import { useNow } from './useNow';

/**
 * A stage layout's clock box's time (Part A's review): as the box writes it (12 or 24 hours, the seconds;
 * otherwise as Drashti's computer writes the time), from the engine's time, redrawn ten times a second as a timer
 * box is (StageTimerText), so every screen turns over within a tenth of a second of the others, its seconds too.
 * It was the layout's own four times a second, a quarter of a second apart at worst.
 */
export function StageClockText({
  box,
  style,
}: {
  box: Pick<StageBox, 'hours' | 'seconds'>;
  /** Main's way of writing the time (Sessions 31–36, I18N-8), as the layout is given it. */
  style: ClockStyle | null | undefined;
}) {
  const now = useNow(100);
  return (
    <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
      {stageClockText(now, style, box)}
    </span>
  );
}
