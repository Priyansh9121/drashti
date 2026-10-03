import { createContext, useContext, useId } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cx } from './cx';
import { ChevronDown } from './icons';

/*
 * Form fields. A Field gives a control its visible label, a hint and an
 * error, tied to it for screen readers; the controls inside pick that up.
 * A control with no visible label needs an aria-label instead.
 */

interface FieldInfo {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldInfo | null>(null);

export function Field({
  label,
  hint,
  error,
  layout = 'stack',
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** The label above the control (stack), or beside it (inline). */
  layout?: 'stack' | 'inline';
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div className={cx(layout === 'inline' ? 'flex items-center gap-2' : 'flex flex-col gap-1', className)}>
        <label
          htmlFor={id}
          className={cx('text-xs font-medium text-muted', layout === 'inline' && 'shrink-0')}
        >
          {label}
        </label>
        {children}
        {hint && (
          <p id={hintId} className="text-xs text-faint">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-xs text-danger-fg">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

/** The id, description and error state a control gets from its Field. */
function useField(own: { id?: string | undefined; 'aria-describedby'?: string | undefined }) {
  const field = useContext(FieldContext);
  return {
    id: own.id ?? field?.id,
    'aria-describedby': own['aria-describedby'] ?? field?.describedBy,
    'aria-invalid': field?.invalid ? true : undefined,
  };
}

export const controlClass =
  'h-8 rounded-md border border-field bg-panel-2 px-2 text-sm text-fg placeholder:text-faint hover:border-muted aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-50';

export function TextInput({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  const tie = useField(props);
  return (
    <input ref={ref} type="text" {...props} {...tie} className={cx(controlClass, 'min-w-0', className)} />
  );
}

/** A number, with an optional unit after it ("%", "px"). */
export function NumberInput({
  className,
  unit,
  ref,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { unit?: string; ref?: Ref<HTMLInputElement> }) {
  const tie = useField(props);
  const input = (
    <input
      ref={ref}
      type="number"
      {...props}
      {...tie}
      className={cx(controlClass, 'w-20 tabular-nums', className)}
    />
  );
  if (!unit) return input;
  return (
    <span className="inline-flex items-center gap-1">
      {input}
      <span className="text-xs text-muted">{unit}</span>
    </span>
  );
}

export function Select({
  className,
  children,
  ref,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  const tie = useField(props);
  return (
    <span className={cx('relative inline-flex min-w-0', className)}>
      <select
        ref={ref}
        {...props}
        {...tie}
        className={cx(controlClass, 'w-full min-w-0 appearance-none truncate pr-7')}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted"
      />
    </span>
  );
}

/** A colour: the system picker, with the colour written beside it. */
export function ColorInput({
  value,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & { value: string }) {
  const tie = useField(props);
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <input
        type="color"
        value={value}
        {...props}
        {...tie}
        className="h-8 w-10 cursor-pointer rounded-md border border-field bg-panel-2 p-0.5 hover:border-muted"
      />
      <span className="font-mono text-xs text-muted uppercase">{value}</span>
    </span>
  );
}

/** A value along a range, with the value shown beside it. */
export function Slider({
  value,
  format = String,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & {
  value: number;
  format?: (value: number) => string;
}) {
  const tie = useField(props);
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <input
        type="range"
        value={value}
        {...props}
        {...tie}
        aria-valuetext={format(value)}
        className="h-1.5 min-w-24 flex-1 cursor-pointer accent-accent-strong"
      />
      <output className="min-w-10 text-right text-xs whitespace-nowrap text-muted tabular-nums">
        {format(value)}
      </output>
    </span>
  );
}

export function Textarea({
  className,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  const tie = useField(props);
  return (
    <textarea
      ref={ref}
      {...props}
      {...tie}
      className={cx(
        'rounded-md border border-field bg-panel-2 p-3 text-sm text-fg placeholder:text-faint hover:border-muted aria-invalid:border-danger',
        className,
      )}
    />
  );
}
