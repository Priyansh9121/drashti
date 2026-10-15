import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useElementSize } from '../render/useElementSize';
import { usePersistentState } from '../ui/persist';
import { Splitter } from '../ui/Splitter';

/*
 * The operator window's columns (Session 26a): the playlists and the library
 * on the left, the open playlist and the chosen item's slides in the middle,
 * and what is live on the right, with splitters between them. Sizes are
 * remembered on this computer, and kept so the middle always has room (down
 * to a 1024-wide window).
 */

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const LEFT = { initial: 300, min: 220, max: 520 };
const RIGHT = { initial: 380, min: 300, max: 620 };
const MIDDLE_MIN = 400;
const PLAYLISTS = { initial: 0.42, min: 0.15, max: 0.8 };
/** The open playlist's share of the centre, above the chosen item's slides (Session 26a). */
const OPEN_PLAYLIST = { initial: 0.45, min: 0.2, max: 0.75 };

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
      <div
        style={{ width: leftWidth }}
        className="flex min-h-0 shrink-0 flex-col bg-panel"
        data-testid="column-left"
      >
        {left}
      </div>
      <Splitter
        value={leftWidth}
        onChange={setLeft}
        min={LEFT.min}
        max={Math.max(LEFT.min, leftMax)}
        defaultValue={LEFT.initial}
        label="Resize the library and playlists"
      />
      {/* No surface of its own: the window's ink, with the lamp's light falling across it. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="column-middle">
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
      >
        {right}
      </div>
    </div>
  );
}

/** The left column: playlists above, the library below, with a splitter between (as a share of the height). */
export function LeftColumn({ top, bottom, foot }: { top: ReactNode; bottom: ReactNode; foot: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { height } = useElementSize(ref);
  const [share, setShare] = usePersistentState('layout.playlists', PLAYLISTS.initial, isNumber);
  const usable = Math.max(1, height);
  const topHeight = Math.round(clamp(share, PLAYLISTS.min, PLAYLISTS.max) * usable);
  return (
    <>
      <div ref={ref} className="flex min-h-0 flex-1 flex-col">
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
          label="Resize the playlists and the library"
        />
        <div className="flex min-h-0 flex-1 flex-col">{bottom}</div>
      </div>
      {foot}
    </>
  );
}

/**
 * The centre (Session 26a): the open playlist above, the chosen item's slides below, with a splitter
 * between (remembered, as a share of the height). With no playlist open, the slides have it all.
 */
export function CentreColumn({ top, bottom }: { top: ReactNode | null; bottom: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { height } = useElementSize(ref);
  const [share, setShare] = usePersistentState('layout.centre', OPEN_PLAYLIST.initial, isNumber);
  const usable = Math.max(1, height);
  const topHeight = Math.round(clamp(share, OPEN_PLAYLIST.min, OPEN_PLAYLIST.max) * usable);
  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      {top !== null && (
        <>
          <div
            style={{ height: height > 0 ? topHeight : `${OPEN_PLAYLIST.initial * 100}%` }}
            className="flex min-h-0 shrink-0 flex-col bg-panel"
            data-testid="centre-playlist"
          >
            {top}
          </div>
          <Splitter
            orientation="horizontal"
            value={topHeight}
            onChange={(px) => {
              setShare(px / usable);
            }}
            min={Math.round(OPEN_PLAYLIST.min * usable)}
            max={Math.round(OPEN_PLAYLIST.max * usable)}
            defaultValue={Math.round(OPEN_PLAYLIST.initial * usable)}
            label="Resize the playlist and the slides"
          />
        </>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{bottom}</div>
    </div>
  );
}
