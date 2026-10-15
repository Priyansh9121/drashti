import type { ReactNode } from 'react';
import type { DataAttributes } from './cx';
import { cx } from './cx';
import type { Icon } from './icons';
import { AlertTriangle, CircleAlert, CircleCheck, Info, X } from './icons';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

/*
 * Each tone fills its box and has a rail of its colour down the left (Session 26g): a warning is a
 * filled amber rail with an icon and words, so the lamp's warm light, which is only ever a gradient
 * on a surface, is never taken for one.
 */
const tones: Record<NoticeTone, { box: string; icon: Icon; iconClass: string }> = {
  info: {
    box: 'border-line-strong border-l-accent bg-panel-2 text-fg',
    icon: Info,
    iconClass: 'text-accent',
  },
  success: {
    box: 'border-success/50 border-l-success bg-success-bg text-success-fg',
    icon: CircleCheck,
    iconClass: '',
  },
  warning: {
    box: 'border-warning/60 border-l-warning bg-warning-bg text-warning-fg',
    icon: AlertTriangle,
    iconClass: '',
  },
  danger: {
    box: 'border-danger/60 border-l-danger bg-danger-bg text-danger-fg',
    icon: CircleAlert,
    iconClass: '',
  },
};

/**
 * A message in the page: something to know (info), something done
 * (success), something to look at (warning) or something that failed
 * (danger). Warnings and failures are announced at once (role "alert").
 */
export function Notice({
  tone = 'info',
  title,
  children,
  actions,
  onDismiss,
  role,
  compact = false,
  className,
  ...data
}: {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  role?: 'alert' | 'status' | 'none';
  compact?: boolean;
  className?: string;
} & DataAttributes) {
  const look = tones[tone];
  const IconShape = look.icon;
  const announce = role ?? (tone === 'warning' || tone === 'danger' ? 'alert' : 'status');
  return (
    <div
      role={announce === 'none' ? undefined : announce}
      className={cx(
        'flex items-start gap-2 rounded-md border border-l-4',
        compact ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm',
        look.box,
        className,
      )}
      {...data}
    >
      <IconShape
        size={compact ? 14 : 16}
        aria-hidden="true"
        className={cx('mt-0.5 shrink-0', look.iconClass)}
      />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className="break-words">{children}</div>}
        {actions && <div className="flex flex-wrap items-center gap-1.5 pt-0.5">{actions}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          // 24 × 24 at least (WCAG 2.5.8); on the phones' pages 44 (app.css).
          className="-mt-1 -mr-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm hover:bg-black/20"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
