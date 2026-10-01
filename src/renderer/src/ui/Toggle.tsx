import type { InputHTMLAttributes, ReactNode } from 'react';
import type { DataAttributes } from './cx';
import { cx } from './cx';

/** An on/off switch with its label beside it (role "switch"). */
export function Toggle({
  checked,
  onChange,
  label,
  hideLabel = false,
  disabled,
  size = 'md',
  className,
  ...data
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Keep the label for screen readers only. */
  hideLabel?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
  className?: string;
} & DataAttributes) {
  const track = size === 'lg' ? 'h-7 w-12' : 'h-5 w-9';
  const knob = size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5';
  const travel = size === 'lg' ? 'translate-x-5' : 'translate-x-4';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={hideLabel ? label : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'inline-flex items-center gap-2 rounded-md text-sm text-fg disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...data}
    >
      <span
        aria-hidden="true"
        className={cx(
          'relative inline-flex shrink-0 items-center rounded-full border p-0.5 transition-colors',
          track,
          checked ? 'border-accent-strong bg-accent-strong' : 'border-field bg-panel-3',
        )}
      >
        <span
          className={cx(
            'rounded-full bg-white shadow transition-transform',
            knob,
            checked ? travel : 'translate-x-0',
          )}
        />
      </span>
      {!hideLabel && <span>{label}</span>}
    </button>
  );
}

/** A tick box with its label (a native checkbox, so it works everywhere a form does). */
export function Checkbox({
  label,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-sm text-fg', className)}>
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 rounded-sm border-field accent-accent-strong"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}
