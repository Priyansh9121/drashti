import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DataAttributes } from './cx';
import { cx } from './cx';
import type { Icon } from './icons';
import { CircleAlert, Loader } from './icons';
import { UnlitLamp } from './Mark';
import { useArrival } from './motion';

/** Nothing here yet: what this place is for, and how to fill it. */
export function EmptyState({
  icon: IconShape,
  title,
  children,
  action,
  compact = false,
  lamp = false,
  className,
  ...data
}: {
  icon?: Icon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  /** One of the window's places (the library, the playlists, the slides): the unlit lamp. */
  lamp?: boolean;
  className?: string;
} & DataAttributes) {
  const arriving = useArrival(lamp ? 'empty' : null);
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center text-center text-muted',
        compact ? 'gap-1 px-3 py-4' : 'gap-2 px-6 py-10',
        lamp && 'lamp-empty',
        className,
      )}
      // An empty place settles 14 px as it arrives, once (with its lamp's one wisp of smoke).
      data-motion={arriving}
      {...data}
    >
      {lamp ? (
        <UnlitLamp size={compact ? 44 : 64} wisp={arriving !== undefined} />
      ) : (
        IconShape && (
          <IconShape size={compact ? 20 : 32} aria-hidden="true" strokeWidth={1.5} className="text-faint" />
        )
      )}
      <p className={cx('font-medium text-fg', compact ? 'text-sm' : 'text-base')}>{title}</p>
      {children && <div className={cx('max-w-sm', compact ? 'text-xs' : 'text-sm')}>{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/**
 * The whole of a place, for what it holds while it has nothing else to show (Session 51): centred while it fits,
 * and from its top, scrolling, when it does not (a small window, a notice or the open playlist above it), so none
 * of it is ever cut off or drawn under the show controls and the status bar below. The middle's empty places use
 * it: Start here, a playlist item's note and a presentation that could not be opened. Centred with nothing to
 * scroll, Start here's third step ran under the status bar in a 1024 × 645 window, out of reach.
 */
export function CentredPlace({ children, ...data }: { children: ReactNode } & DataAttributes) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" {...data}>
      {/* Auto margins centre it while there is room, and give way to its top when there is not. */}
      <div className="my-auto">{children}</div>
    </div>
  );
}

/** How long a wait goes unsaid: most answers come sooner, and a word that flashes up and away is noise. */
export const LOADING_AFTER_MS = 500;

/**
 * Waiting for something to arrive (Sessions 31–36): said only after half a second, or at once where the
 * wait is known to be long (`immediate`: starting the stream's picture, asking for an update). Its status
 * box is there from the start, its words hidden until then (keeping their room), so a screen reader hears
 * them as they come. The box says when it came and when its words showed (`data-since`, `data-shown-at`:
 * performance.now() as each reached the page, Session 37), so the half second can be checked on any machine.
 */
export function Loading({
  label = 'Loading…',
  className,
  immediate = false,
}: {
  label?: string;
  className?: string;
  immediate?: boolean;
}) {
  const [shown, setShown] = useState(immediate);
  const box = useRef<HTMLDivElement>(null);
  // Written as the page takes each in, before the half second's timer is even set (layout effects run first).
  useLayoutEffect(() => {
    box.current?.setAttribute('data-since', performance.now().toFixed(1));
  }, []);
  useLayoutEffect(() => {
    if (shown) box.current?.setAttribute('data-shown-at', performance.now().toFixed(1));
  }, [shown]);
  useEffect(() => {
    if (shown) return;
    const timer = setTimeout(() => {
      setShown(true);
    }, LOADING_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [shown]);
  return (
    <div
      ref={box}
      role="status"
      className={cx('flex items-center justify-center gap-2 p-4 text-sm text-muted', className)}
    >
      <span
        className={cx('flex items-center gap-2', !shown && 'invisible')}
        data-shown={shown ? 'true' : undefined}
      >
        <Loader size={16} aria-hidden="true" className="animate-spin" />
        {label}
      </span>
    </div>
  );
}

/** Something could not be done or shown: what happened, and a way on. */
export function ErrorState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cx('flex flex-col items-center gap-2 px-6 py-8 text-center', className)}>
      <CircleAlert size={28} aria-hidden="true" className="text-danger" />
      <p className="text-base font-medium text-fg">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
      {action}
    </div>
  );
}
