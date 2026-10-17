import { createContext, useCallback, useContext, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle } from '../ui/icons';

/*
 * A text box's measure, where it is drawn (Sessions 31–36, SLD-1): whether its words run past it, and the
 * fit they are drawn at (shrink-to-fit's, 1 without it). Each box marks itself (data-overset) and tells
 * whoever asked: a thumbnail marks its slide, the slide editor's inspector warns.
 */

export interface Measured {
  /** The words run past the box (shrunk as far as shrink-to-fit goes, if it is on). */
  over: boolean;
  /** The fit they are drawn at, 0.1 to 1. */
  fit: number;
}

/** Told each box's measure as it is drawn, and null when it goes. */
export type MeasureReport = (id: string, measured: Measured | null) => void;

export const MeasureContext = createContext<MeasureReport | null>(null);

export const useMeasureReport = (): MeasureReport | null => useContext(MeasureContext);

/**
 * Whether any of a slide's boxes runs over, for a thumbnail's mark. Its report stays the same whatever
 * `onChange` is given (the newest is called): a new one each render must not measure the boxes again.
 */
export function OversetWatch({
  onChange,
  children,
}: {
  onChange: (over: boolean) => void;
  children: ReactNode;
}) {
  const over = useRef(new Set<string>());
  const latest = useRef(onChange);
  useLayoutEffect(() => {
    latest.current = onChange;
  });
  const report = useCallback<MeasureReport>((id, measured) => {
    const had = over.current.size > 0;
    if (measured?.over) over.current.add(id);
    else over.current.delete(id);
    if (had !== over.current.size > 0) latest.current(!had);
  }, []);
  return <MeasureContext.Provider value={report}>{children}</MeasureContext.Provider>;
}

/** A thumbnail's mark, in its picture's corner, when words run past a box on the slide. */
export function OversetMark() {
  return (
    <span
      data-testid="thumb-overset"
      title="Words run past a box on this slide"
      className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-sm bg-warning-bg text-warning-fg"
    >
      <AlertTriangle size={12} aria-hidden="true" strokeWidth={2.5} />
    </span>
  );
}
