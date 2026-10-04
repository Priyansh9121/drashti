import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from './cx';
import type { Icon } from './icons';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: Icon;
  /** A count or badge after the label. */
  extra?: ReactNode;
}

/** The id of a tab's panel, for TabPanel. */
export const tabPanelId = (group: string, id: string) => `${group}-panel-${id}`;
const tabId = (group: string, id: string) => `${group}-tab-${id}`;

/**
 * Tabs: one is chosen; the arrow keys, Home and End move between them
 * (only the chosen one is in the Tab order).
 */
export function Tabs<T extends string>({
  group,
  label,
  items,
  value,
  onChange,
  size = 'md',
  shrink = false,
  className,
}: {
  /** A name unique in the window, for the ids that tie tabs to panels. */
  group: string;
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: 'sm' | 'md';
  /** In a narrow row the tabs narrow too, their words cut off (whole in their tooltip). */
  shrink?: boolean;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const move = (e: KeyboardEvent) => {
    const i = items.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    const item = items[next];
    if (!item) return;
    e.preventDefault();
    onChange(item.id);
    list.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(group, item.id))}`)?.focus();
  };
  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      onKeyDown={move}
      className={cx('flex items-center gap-0.5', shrink && 'min-w-0', className)}
    >
      {items.map((t) => {
        const selected = t.id === value;
        const IconShape = t.icon;
        return (
          <button
            key={t.id}
            id={tabId(group, t.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tabPanelId(group, t.id)}
            tabIndex={selected ? 0 : -1}
            data-testid={`${group}-tab-${t.id}`}
            title={shrink ? t.label : undefined}
            onClick={() => onChange(t.id)}
            className={cx(
              'relative inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
              shrink && 'min-w-0',
              size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm',
              selected ? 'bg-panel-3 text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg',
            )}
          >
            {IconShape && (
              <IconShape size={size === 'sm' ? 14 : 16} aria-hidden="true" className="shrink-0" />
            )}
            {shrink ? <span className="min-w-0 truncate">{t.label}</span> : t.label}
            {t.extra}
            {selected && (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The panel a tab shows. */
export function TabPanel({
  group,
  id,
  children,
  className,
}: {
  group: string;
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="tabpanel" id={tabPanelId(group, id)} aria-labelledby={tabId(group, id)} className={className}>
      {children}
    </div>
  );
}
