import { useState } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import type { LiveGroupLook } from '../../../shared/looks';
import type { Size } from '../../../shared/scaling';
import { useEngine } from '../engine/engine-store';
import { useMedia } from '../library/library-store';
import { usePractice } from '../practice/practice-store';
import { droppedPlace, pipRect, pipShownFor } from '../render/pip';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { ArrowLeftRight, PictureInPicture2, Settings, X } from '../ui/icons';
import { dispatch, useNotice } from './actions';
import { boxName, openPipDialog, placeBox } from './pip-store';

/*
 * The picture-in-picture box under LIVE (Session 50, Pro Mode): what is in it, in words, with Swap and Take off a
 * click away and its settings (Picture in Picture…); and over the LIVE picture, the box itself to drag anywhere
 * on the screen, let go near a corner to put it there. Dragging is never the only way: the dialog's corners do it
 * from the keyboard. The practice show has no box.
 */

/** What is in the box, with Swap and Take off, while one is up. */
export function PipLiveStrip() {
  const box = useEngine((s) => s.state?.layers.pip ?? null);
  const media = useMedia((s) => s.media);
  const practising = usePractice((s) => s.on);
  if (!box || practising) return null;
  const name = boxName(box.source, media);
  return (
    <div
      role="status"
      data-testid="live-pip"
      data-swapped={box.swapped ? 'true' : 'false'}
      className="flex min-h-9 items-center gap-1.5 rounded-md border border-line bg-panel-2 py-1 pr-1 pl-2 text-xs"
    >
      <PictureInPicture2 size={14} aria-hidden="true" className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate" title={name}>
        <span className="font-bold">Picture in picture</span> · {name}
        {box.swapped ? ' · swapped' : ''}
      </span>
      <Button
        size="sm"
        instant
        icon={ArrowLeftRight}
        data-testid="live-pip-swap"
        onClick={() => void dispatch({ type: 'swapPip' })}
      >
        Swap
      </Button>
      <Button
        size="sm"
        instant
        icon={X}
        data-testid="live-pip-take-off"
        onClick={() => void dispatch({ type: 'hidePip' })}
      >
        Take off
      </Button>
      <IconButton
        icon={Settings}
        size="sm"
        label="Picture in Picture settings"
        data-testid="live-pip-settings"
        onClick={openPipDialog}
      />
    </div>
  );
}

/** Its edge, two screen pixels wide however small LIVE draws the picture. */
function Edge({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cx(
        'pointer-events-none absolute inset-0 h-full w-full overflow-visible text-accent',
        className,
      )}
    >
      <rect
        x="0"
        y="0"
        width="100"
        height="100"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Dragged less than this far (CSS pixels), it was a click: the box stays where it is. */
const CLICK = 4;

/**
 * The box in LIVE, to drag (inside the LIVE picture, on its canvas): its edge shows under the pointer, and while
 * it is dragged, where it will land. Let go, the screens move it there by its motion, and the library remembers
 * it. Only where LIVE draws the box (the first audience group's Look).
 */
export function PipDragHandle({
  state,
  canvas,
  look,
}: {
  state: EngineState;
  canvas: Size;
  look: LiveGroupLook;
}) {
  const [drag, setDrag] = useState<{ x: number; y: number; scale: number; dx: number; dy: number } | null>(
    null,
  );
  const box = state.layers.pip;
  if (!box || !pipShownFor(look) || (box.source.kind === 'slides' && !look.layers.includes('slide')))
    return null;
  const rect = pipRect(box.place, canvas);
  const landing = drag ? droppedPlace(box.place, canvas, drag.dx / drag.scale, drag.dy / drag.scale) : null;
  const ghost = landing ? pipRect(landing, canvas) : null;
  return (
    <>
      <div
        data-testid="live-pip-handle"
        title="Drag to move the box; let go near a corner to put it there"
        className="group absolute cursor-move touch-none"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // The box's own drag, never the live zoom's (LiveZoom.tsx) under it.
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          const shown = e.currentTarget.getBoundingClientRect();
          setDrag({
            x: e.clientX,
            y: e.clientY,
            scale: shown.width > 0 ? shown.width / rect.width : 1,
            dx: 0,
            dy: 0,
          });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          setDrag({ ...drag, dx: e.clientX - drag.x, dy: e.clientY - drag.y });
        }}
        onPointerUp={(e) => {
          setDrag(null);
          if (!drag) return;
          // Where it was let go (not the last move drawn).
          const dx = e.clientX - drag.x;
          const dy = e.clientY - drag.y;
          if (Math.hypot(dx, dy) < CLICK) return;
          void placeBox(droppedPlace(box.place, canvas, dx / drag.scale, dy / drag.scale)).then((problem) => {
            if (problem) useNotice.setState({ text: problem });
          });
        }}
        onPointerCancel={() => {
          setDrag(null);
        }}
      >
        <Edge className={drag ? 'opacity-40' : 'opacity-0 group-hover:opacity-100'} />
      </div>
      {ghost && (
        <div
          data-testid="live-pip-landing"
          className="pointer-events-none absolute"
          style={{ left: ghost.x, top: ghost.y, width: ghost.width, height: ghost.height }}
        >
          <Edge />
        </div>
      )}
    </>
  );
}
