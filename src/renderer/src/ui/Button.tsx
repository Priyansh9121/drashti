import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './cx';
import type { Icon } from './icons';
import { Kbd } from './Kbd';
import { Tooltip } from './Tooltip';

/*
 * Buttons. A button always says what it does in words: with text, or (an
 * IconButton) with an aria-label that also shows as its tooltip.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'live' | 'warning';
/** sm and md for panels; lg for dialogs and the live controls; xl and xxl for Simple Mode. */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent-strong text-white border-accent-strong hover:brightness-110',
  secondary: 'bg-panel-2 text-fg border-field/60 hover:bg-panel-3 hover:border-field',
  ghost: 'bg-transparent text-muted border-transparent hover:bg-panel-2 hover:text-fg',
  danger: 'bg-transparent text-danger border-danger/50 hover:bg-danger-bg hover:border-danger',
  // On the screens now, or "on" (black-out): the live colour, always with words saying so.
  live: 'bg-live text-white border-live hover:brightness-110',
  warning: 'bg-warning-bg text-warning-fg border-warning/60 hover:border-warning',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1 px-2 text-xs rounded-md',
  md: 'h-8 gap-1.5 px-3 text-sm rounded-md',
  lg: 'h-10 gap-2 px-4 text-base rounded-lg',
  xl: 'min-h-16 gap-3 px-5 py-2 text-xl rounded-xl',
  xxl: 'min-h-24 gap-4 px-6 py-3 text-3xl rounded-xl',
};

const iconSizes: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18, xl: 26, xxl: 36 };
const squareSizes: Record<ButtonSize, string> = {
  sm: 'h-7 w-7 rounded-md',
  md: 'h-8 w-8 rounded-md',
  lg: 'h-10 w-10 rounded-lg',
  xl: 'h-16 w-16 rounded-xl',
  xxl: 'h-24 w-24 rounded-xl',
};

const base =
  'inline-flex shrink-0 select-none items-center justify-center border font-medium whitespace-nowrap transition-[background-color,border-color,color,filter] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100';

/** The class names of a button, for the odd element that must look like one. */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string {
  return cx(base, variants[variant], sizes[size]);
}

/** Before Session 6 buttons took a `tone` and sized themselves with classes; kept while panels move over. */
type LegacyTone = 'default' | 'primary' | 'danger' | 'live' | 'ghost';
const legacyVariant: Record<LegacyTone, ButtonVariant> = {
  default: 'secondary',
  primary: 'primary',
  danger: 'danger',
  live: 'live',
  ghost: 'ghost',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** An icon before the words (decorative: the words are the label). */
  icon?: Icon;
  /** An icon after the words. */
  iconEnd?: Icon;
  /** The keyboard shortcut, shown as a key hint after the words. */
  kbd?: string;
  /** The old way (until every panel uses variant and size). */
  tone?: LegacyTone;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
}

export function Button({
  variant,
  size,
  icon: IconBefore,
  iconEnd: IconAfter,
  kbd,
  tone,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const legacy = tone !== undefined && variant === undefined && size === undefined;
  const v = variant ?? legacyVariant[tone ?? 'default'];
  const s = size ?? 'md';
  const iconPx = iconSizes[s];
  return (
    <button
      type={type}
      className={cx(
        base,
        variants[v],
        legacy ? 'gap-1.5 rounded-md px-3 py-1.5 text-sm' : sizes[s],
        className,
      )}
      {...props}
    >
      {IconBefore && <IconBefore size={iconPx} aria-hidden="true" className="shrink-0" />}
      {children}
      {IconAfter && <IconAfter size={iconPx} aria-hidden="true" className="shrink-0" />}
      {kbd && <Kbd className="ml-1">{kbd}</Kbd>}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: Icon;
  /** What it does, for screen readers and the tooltip ("Close", "More for Ravi Sabha"). */
  label: string;
  /** The keyboard shortcut, shown in the tooltip. */
  kbd?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Where the tooltip goes. */
  tooltipSide?: 'top' | 'bottom';
  ref?: Ref<HTMLButtonElement>;
}

/** A button that is only an icon: its label is read out and shown as a tooltip. */
export function IconButton({
  icon: IconShape,
  label,
  kbd,
  variant = 'ghost',
  size = 'md',
  tooltipSide = 'top',
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <Tooltip content={label} kbd={kbd} side={tooltipSide} describes={false}>
      <button
        type={type}
        aria-label={label}
        className={cx(base, variants[variant], squareSizes[size], 'px-0', className)}
        {...props}
      >
        <IconShape size={iconSizes[size]} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
