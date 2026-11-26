import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useElementSize } from '../render/useElementSize';
import { usePersistentState } from '../ui/persist';
import { Splitter } from '../ui/Splitter';
import { FLOW_SHARE, flowAreaHeight } from './flow-area';

/*
 * The operator window's columns (Session 26a): the playlists on the left (Session 44: the whole column, the
 * library in a sheet over it, the open folder playlist's folders below them), the open playlist in the middle
 * (Session 55: the whole middle, its presentations' slides as rows; operator/Middle.tsx), and what is live on the
 * right, with splitters between them. Sizes are remembered on this computer, and kept so the middle always has room
 * (down to a 1024-wide window).
 */

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const LEFT = { initial: 300, min: 220, max: 520 };
const RIGHT = { initial: 380, min: 300, max: 620 };
const MIDDLE_MIN = 400;
const PLAYLISTS = { initial: 0.42, min: 0.15, max: 0.8 };
/** The Sabha flow panel's share of the column's height while it is open (alpha.23), the playlists' the rest. */
const FLOW = FLOW_SHARE;
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

function useWindowWidth(): number {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => {
      setWidth(window.innerWidth);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return width;
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));

export function Columns({ left, middle, right }: { left: ReactNode; middle: ReactNode; right: ReactNode }) {
  const width = useWindowWidth();
  const [leftWant, setLeft] = usePersistentState('layout.left', LEFT.initial, isNumber);
  const [rightWant, setRight] = usePersistentState('layout.right', RIGHT.initial, isNumber);
  const rightMax = Math.min(RIGHT.max, width - MIDDLE_MIN - LEFT.min);
  const rightWidth = clamp(rightWant, RIGHT.min, rightMax);
  const leftMax = Math.min(LEFT.max, width - MIDDLE_MIN - rightWidth);
  const leftWidth = clamp(leftWant, LEFT.min, leftMax);
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {/* Nothing in it draws outside it, over the layer bar (Session 44): its parts scroll their own, and
          the column clips whatever is left as a last guard. */}
      <div
        style={{ width: leftWidth }}
        className="flex min-h-0 shrink-0 flex-col overflow-hidden bg-panel"
        data-testid="column-left"
        data-zone="left"
      >
        {left}
      </div>
      <Splitter
        value={leftWidth}
        onChange={setLeft}
        min={LEFT.min}
        max={Math.max(LEFT.min, leftMax)}
        defaultValue={LEFT.initial}
        label="Resize the playlists"
      />
      {/* The window's ink, in the middle's own colour (Session 44: its zone; Black and White their own ink). */}
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-ink"
        data-testid="column-middle"
        data-zone="middle"
      >
        {middle}
      </div>
      <Splitter
        value={rightWidth}
        onChange={setRight}
        min={RIGHT.min}
        max={Math.max(RIGHT.min, rightMax)}
        defaultValue={RIGHT.initial}
        label="Resize the live column"
        grow={-1}
      />
      <div
        style={{ width: rightWidth }}
        className="flex min-h-0 shrink-0 flex-col bg-panel"
        data-testid="column-right"
        data-zone="right"
      >
        {right}
      </div>
    </div>
  );
}

/**
 * The left column (Session 44): the Library button, then the playlists, which have it all; with a folder
 * playlist open, its folders below them, with a splitter between (as a share of the height). The library's
 * sheet lies over the playlists and folders when it is open, between the button and the notices at its foot,
 * which stay in view.
 */
export function LeftColumn({
  head,
  flow = null,
  flowOpen = false,
  flowNeed = 0,
  top,
  bottom,
  wallpapers = null,
  over,
  covered,
  foot,
}: {
  head: ReactNode;
  /**
   * The Sabha flow panel (alpha.23), or null: at the top, under the head, its heading the toggle that folds it; open,
   * it has a share of the column's height (remembered), with a splitter between it and the playlists.
   */
  flow?: ReactNode;
  /** Whether the Sabha flow panel is open. */
  flowOpen?: boolean;
  /** What the open panel needs for Now and Next up whole (px; 0: nothing), given it when it may (flow-area.ts). */
  flowNeed?: number;
  top: ReactNode;
  /** The open folder playlist's folders, or null. */
  bottom: ReactNode | null;
  /**
   * The wallpapers (Session 55, Part 6): under the playlists and the folders, just above the bar of clears, in the
   * place the library's sheet covers too.
   */
  wallpapers?: ReactNode;
  /** Laid over the playlists and folders (the library's sheet); null when shut. */
  over: ReactNode;
  /** The sheet covers them: they take no keyboard or pointer meanwhile (inert), so nothing hidden is reached. */
  covered: boolean;
  foot: ReactNode;
}) {
  // The playlists' and the folders' own height (the wallpapers under them have theirs).
  const split = useRef<HTMLDivElement>(null);
  const { height } = useElementSize(split);
  const [share, setShare] = usePersistentState('layout.playlists', PLAYLISTS.initial, isNumber);
  const usable = Math.max(1, height);
  const topHeight = Math.round(clamp(share, PLAYLISTS.min, PLAYLISTS.max) * usable);
  // The Sabha flow's, of all the column has under the head (the playlists, folders and wallpapers share the rest).
  const area = useRef<HTMLDivElement>(null);
  const { height: areaHeight } = useElementSize(area);
  const [flowShare, setFlowShare] = usePersistentState('layout.flow', FLOW.initial, isNumber);
  // Set by the operator (the splitter moved, not put back): their setting wins over Now and Next up's need.
  const [flowSet, setFlowSet] = usePersistentState('layout.flow.set', false, isBoolean);
  const areaUsable = Math.max(1, areaHeight);
  const flowHeight = flowAreaHeight({ area: areaUsable, share: flowShare, need: flowNeed, dragged: flowSet });
  const flowDefault = Math.round(FLOW.initial * areaUsable);
  return (
    // One landmark for the column (Session 44): the Library button, the playlists, the open playlist's folders
    // and the library's sheet over them. The Undo line at its foot keeps its room while the pointer is over it
    // (library/UndoBar.tsx, data-left-column).
    <section aria-label="Playlists" data-left-column className="flex min-h-0 flex-1 flex-col">
      {head}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={area} className="flex min-h-0 flex-1 flex-col" inert={covered}>
          {flow !== null && (
            // One element, open or folded, so the panel is never drawn afresh as it folds.
            <div
              style={
                flowOpen ? { height: areaHeight > 0 ? flowHeight : `${FLOW.initial * 100}%` } : undefined
              }
              className="flex min-h-0 shrink-0 flex-col border-b border-line"
              data-testid="flow-area"
            >
              {flow}
            </div>
          )}
          {flow !== null && flowOpen && (
            <Splitter
              orientation="horizontal"
              value={flowHeight}
              onChange={(px) => {
                setFlowShare(px / areaUsable);
                // Put back (Enter or a double-click): the panel fits Now and Next up again.
                setFlowSet(px !== flowDefault);
              }}
              min={Math.round(FLOW.min * areaUsable)}
              max={Math.round(FLOW.max * areaUsable)}
              defaultValue={flowDefault}
              label="Resize the Sabha flow and the playlists"
            />
          )}
          <div ref={split} className="flex min-h-0 flex-1 flex-col">
            {bottom === null ? (
              <div className="flex min-h-0 flex-1 flex-col">{top}</div>
            ) : (
              <>
                <div
                  style={{ height: height > 0 ? topHeight : `${PLAYLISTS.initial * 100}%` }}
                  className="flex min-h-0 shrink-0 flex-col"
                >
                  {top}
                </div>
                <Splitter
                  orientation="horizontal"
                  value={topHeight}
                  onChange={(px) => {
                    setShare(px / usable);
                  }}
                  min={Math.round(PLAYLISTS.min * usable)}
                  max={Math.round(PLAYLISTS.max * usable)}
                  defaultValue={Math.round(PLAYLISTS.initial * usable)}
                  label="Resize the playlists and the folders"
                />
                <div className="flex min-h-0 flex-1 flex-col">{bottom}</div>
              </>
            )}
          </div>
          {wallpapers}
        </div>
        {over}
      </div>
      {foot}
    </section>
  );
}
