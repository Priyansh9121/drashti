import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Corners, Point, ScreenBlend, ScreenGeometry } from '../../../shared/screen-geometry';
import {
  applyMatrix,
  cornersProblem,
  DEFAULT_CURVE,
  DEFAULT_GAMMA,
  drawnWithoutChip,
  GEOMETRY_LIMITS,
  NO_GEOMETRY,
  nothingSet,
  pinnedCorners,
  warpMatrix,
} from '../../../shared/screen-geometry';
import type { NodeDisplays, ScalingMode, ScreenConfig } from '../../../shared/screens';
import { SCALING_MODES, SCALING_WORDS } from '../../../shared/screens';
import { connectDrawingMode, useDrawingMode } from '../operator/drawing-mode';
import { isTyping, shortcutKey } from '../operator/useKeymap';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Select, TextInput } from '../ui/Field';
import { Redo2, RotateCcw, Undo2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { Checkbox } from '../ui/Toggle';
import { screensAction, useScreens } from './screens-store';

/*
 * Adjust the picture… (x27, the owner's Q-x27-3 A): one screen's output scaling and corner-pin, and its ramps when it
 * is part of one wide picture. A picture of the display with the picture's four corners to drag (Tab to one, the
 * arrow keys move it a pixel of the display, with Shift ten), the numbers for each, Undo and Redo (Cmd/Ctrl+Z and
 * Shift+Cmd/Ctrl+Z, and buttons), Start again (as it was when this opened) and Reset (nothing set). Each change shows
 * on the screen as it is made, about ten a second while a corner is dragged, and is saved as it is made; meanwhile
 * the screen draws a grid over the show (Show a grid on this screen), never instead of it.
 */

const CORNERS = ['Top left', 'Top right', 'Bottom right', 'Bottom left'] as const;
/** The picture of the display, at most this wide (CSS pixels), with a margin round it for corners moved out. */
const PREVIEW_WIDTH = 420;
const MARGIN = 0.08;
/** While a corner is dragged, the screen gets its new picture at most this often. */
const SEND_EVERY_MS = 100;

interface Pixels {
  width: number;
  height: number;
}

const round = (n: number, places = 0) => Number(n.toFixed(places));

/** No nodes (kept one, so the store's selector gives the same list each time). */
const NO_NODES: readonly NodeDisplays[] = [];

/** The corners with one of them moved. */
const withCorner = (c: Corners, i: number, p: Point): Corners => [
  i === 0 ? p : c[0],
  i === 1 ? p : c[1],
  i === 2 ? p : c[2],
  i === 3 ? p : c[3],
];

/** A geometry as sent: nothing set is null. */
const asSent = (g: ScreenGeometry): ScreenGeometry | null => (nothingSet(g) ? null : g);

/**
 * Sends a screen its geometry: the newest only, at most every SEND_EVERY_MS and one at a time, so the screen follows a
 * drag closely and its last step always arrives (finish, as the dialog closes, sends what is waiting at once).
 */
class GeometrySender {
  private latest: ScreenGeometry | null = null;
  private sending = false;
  private timer: number | null = null;
  private lastAt = 0;

  constructor(
    private readonly screenId: string,
    private readonly answer: (problem: string | null) => void,
  ) {}

  send(g: ScreenGeometry): void {
    this.latest = g;
    this.schedule();
  }

  finish(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    void this.flush();
  }

  private waiting(): boolean {
    return this.latest !== null;
  }

  private schedule(): void {
    if (this.timer !== null) return;
    const wait = Math.max(0, SEND_EVERY_MS - (performance.now() - this.lastAt));
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  private async flush(): Promise<void> {
    const g = this.latest;
    if (this.sending || g === null) return;
    this.latest = null;
    this.sending = true;
    this.lastAt = performance.now();
    try {
      const result = await window.drashti.screens.updateScreen(this.screenId, { geometry: asSent(g) });
      if (result.ok) {
        useScreens.setState({ snapshot: result.snapshot });
        this.answer(null);
      } else this.answer(result.message);
    } catch (e) {
      this.answer(e instanceof Error ? e.message : String(e));
    } finally {
      this.sending = false;
    }
    if (this.waiting()) this.schedule();
  }
}

/** A number typed, kept until Enter or leaving the field; a number out of bounds puts back the one there was. */
function NumberBox({
  label,
  value,
  min,
  max,
  places = 0,
  unit,
  testId,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  places?: number;
  unit?: string;
  testId: string;
  onCommit: (n: number) => void;
}) {
  const shownValue = round(value, places);
  const [text, setText] = useState(String(shownValue));
  const [shown, setShown] = useState(shownValue);
  if (shown !== shownValue) {
    setShown(shownValue);
    setText(String(shownValue));
  }
  const commit = () => {
    const n = Number(text.replace(',', '.'));
    if (text.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) {
      if (round(n, places) !== shownValue) onCommit(round(n, places));
    } else setText(String(shownValue));
  };
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <TextInput
        className="w-16 tabular-nums"
        inputMode="decimal"
        data-testid={testId}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      {unit}
    </label>
  );
}

/** The picture of the display: the display's edge, the picture as it is warped (its grid), and the four corners. */
function Preview({
  g,
  pixels,
  onCorners,
  onDragStart,
}: {
  g: ScreenGeometry;
  pixels: Pixels;
  /** New corners (already checked), as a corner is dragged or moved by the keys. */
  onCorners: (corners: Corners, record: boolean) => void;
  onDragStart: () => void;
}) {
  const box = { width: PREVIEW_WIDTH, height: (PREVIEW_WIDTH * pixels.height) / pixels.width };
  const pad = { x: box.width * MARGIN, y: box.height * MARGIN };
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const m = warpMatrix(g, box);
  const warp = (p: Point) => (m ? applyMatrix(m, p) : p);
  const handles = pinnedCorners(g, box);
  // The picture's own lines, eight across and four down, warped as the screen warps them (straight lines stay straight).
  const lines: [Point, Point][] = [];
  for (let i = 0; i <= 8; i++)
    lines.push([warp({ x: (box.width * i) / 8, y: 0 }), warp({ x: (box.width * i) / 8, y: box.height })]);
  for (let j = 0; j <= 4; j++)
    lines.push([warp({ x: 0, y: (box.height * j) / 4 }), warp({ x: box.width, y: (box.height * j) / 4 })]);
  const outline = [
    warp({ x: 0, y: 0 }),
    warp({ x: box.width, y: 0 }),
    warp({ x: box.width, y: box.height }),
    warp({ x: 0, y: box.height }),
  ];
  const moveCorner = (i: number, to: Point, record: boolean) => {
    const base = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ][i] ?? { x: 0, y: 0 };
    const clamp = (v: number) => Math.max(-GEOMETRY_LIMITS.move, Math.min(GEOMETRY_LIMITS.move, v));
    const next = withCorner(g.corners, i, {
      x: clamp(to.x / box.width - base.x),
      y: clamp(to.y / box.height - base.y),
    });
    if (cornersProblem(next) === null) onCorners(next, record);
  };
  const local = (e: ReactPointerEvent): Point => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || r.width === 0) return { x: 0, y: 0 };
    const vw = box.width + 2 * pad.x;
    const vh = box.height + 2 * pad.y;
    return {
      x: ((e.clientX - r.left) * vw) / r.width - pad.x,
      y: ((e.clientY - r.top) * vh) / r.height - pad.y,
    };
  };
  const onKey = (i: number) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const by: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const d = by[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const h = handles[i as 0 | 1 | 2 | 3];
    // A pixel of the display, in the preview's own units.
    moveCorner(
      i,
      { x: h.x + (d.x * box.width) / pixels.width, y: h.y + (d.y * box.height) / pixels.height },
      true,
    );
  };
  return (
    <svg
      ref={svg}
      data-testid="adjust-preview"
      className="w-full max-w-[420px] touch-none select-none rounded-md bg-black"
      viewBox={`${String(-pad.x)} ${String(-pad.y)} ${String(box.width + 2 * pad.x)} ${String(box.height + 2 * pad.y)}`}
      onPointerMove={(e) => {
        if (dragging.current === null) return;
        moveCorner(dragging.current, local(e), false);
      }}
      onPointerUp={(e) => {
        if (dragging.current === null) return;
        dragging.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    >
      <title>The display, with the picture’s corners</title>
      <rect
        x={0}
        y={0}
        width={box.width}
        height={box.height}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.35}
        strokeDasharray="6 4"
      />
      <polygon
        points={outline.map((p) => `${String(p.x)},${String(p.y)}`).join(' ')}
        className="fill-primary/25 stroke-primary"
        strokeWidth={2}
      />
      {lines.map(([a, b], i) => (
        <line
          key={i}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          className="stroke-fg"
          strokeOpacity={0.45}
          strokeWidth={1}
        />
      ))}
      {handles.map((h, i) => (
        <circle
          key={CORNERS[i]}
          data-testid="adjust-handle"
          data-corner={i}
          role="button"
          tabIndex={0}
          aria-label={`${CORNERS[i] ?? ''} corner: drag it, or move it with the arrow keys (Shift for ten pixels)`}
          cx={h.x}
          cy={h.y}
          r={9}
          className="cursor-grab fill-panel stroke-primary focus:outline-none focus-visible:stroke-fg"
          strokeWidth={3}
          onPointerDown={(e) => {
            e.preventDefault();
            dragging.current = i;
            svg.current?.setPointerCapture(e.pointerId);
            onDragStart();
          }}
          onKeyDown={onKey(i)}
        />
      ))}
    </svg>
  );
}

export function AdjustPicture({
  screen,
  pixels,
  onClose,
}: {
  screen: ScreenConfig;
  /** Its display's own pixels (a node's display's for a screen on a node), for the numbers. */
  pixels: Pixels;
  onClose: () => void;
}) {
  // As it was when this opened: Start again puts it back.
  const [opened] = useState<ScreenGeometry>(() => screen.geometry ?? NO_GEOMETRY);
  const [g, setG] = useState<ScreenGeometry>(opened);
  const [past, setPast] = useState<ScreenGeometry[]>([]);
  const [future, setFuture] = useState<ScreenGeometry[]>([]);
  const [grid, setGrid] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [sender] = useState(() => new GeometrySender(screen.id, setProblem));
  // Whether this screen draws without a graphics chip (its node's word, or this computer's): a video on a picture
  // pinned by its corners plays unevenly there, which the dialog says once a corner is moved (the owner's Q60-24 A).
  useEffect(() => {
    connectDrawingMode();
  }, []);
  const hereChipless = useDrawingMode((s) => s.chipless);
  const nodes = useScreens((s) => s.snapshot?.nodes ?? NO_NODES);
  const noChip = drawnWithoutChip(screen, nodes, hereChipless);
  useEffect(
    () => () => {
      sender.finish();
    },
    [sender],
  );
  const send = (next: ScreenGeometry) => {
    sender.send(next);
  };
  // The grid on the screen while this is open, as ticked; gone as it closes.
  useEffect(() => {
    void window.drashti.screens.adjusting(screen.id, grid);
  }, [screen.id, grid]);
  useEffect(
    () => () => {
      void window.drashti.screens.adjusting(screen.id, false);
    },
    [screen.id],
  );
  /** A change: drawn on the screen and saved; `record` makes it one step for Undo (a drag is one, from its start). */
  const change = (next: ScreenGeometry, record = true) => {
    if (record) {
      setPast((p) => [...p, g]);
      setFuture([]);
    }
    setG(next);
    send(next);
  };
  const undo = () => {
    const before = past.at(-1);
    if (!before) return;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [g, ...f]);
    setG(before);
    send(before);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, g]);
    setG(next);
    send(next);
  };
  // Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z while this is open (typing in a field undoes the typing): taken here, so the Edit
  // menu's own Undo never acts on something else meanwhile.
  const steps = useRef({ undo, redo });
  useEffect(() => {
    steps.current = { undo, redo };
  });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      // With a Gujarati or Hindi layout, the Z key's place (hunt S3-3): else the Edit menu's Undo would act elsewhere.
      if (isTyping(e.target) || !(e.metaKey || e.ctrlKey) || shortcutKey(e).toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) steps.current.redo();
      else steps.current.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  const px = (share: number, of: 'width' | 'height') => share * pixels[of];
  const share = (n: number, of: 'width' | 'height') => n / pixels[of];
  const setCorner = (i: number, axis: 'x' | 'y', n: number) => {
    const was = g.corners[i as 0 | 1 | 2 | 3];
    const corners = withCorner(
      g.corners,
      i,
      axis === 'x' ? { ...was, x: share(n, 'width') } : { ...was, y: share(n, 'height') },
    );
    const why = cornersProblem(corners);
    if (why) setProblem(why);
    else change({ ...g, corners });
  };
  const blend: ScreenBlend | null = g.blend;
  const setBlend = (patch: Partial<ScreenBlend>) => {
    change({
      ...g,
      blend: { ...(blend ?? { left: 0, right: 0, gamma: DEFAULT_GAMMA, curve: DEFAULT_CURVE }), ...patch },
    });
  };
  const partWidth = g.part?.width ?? screen.canvasWidth;
  const moveMost = Math.round(GEOMETRY_LIMITS.move * Math.max(pixels.width, pixels.height));
  return (
    <Dialog
      title={`Adjust the picture: ${screen.name}`}
      subtitle="Drag a corner, or type its move in the display’s pixels. The screen shows each change as you make it."
      size="lg"
      onClose={onClose}
      closeLabel="Close Adjust the picture"
      testId="adjust-picture"
      footer={
        <>
          <Button icon={Undo2} data-testid="adjust-undo" disabled={past.length === 0} onClick={undo}>
            Undo
          </Button>
          <Button icon={Redo2} data-testid="adjust-redo" disabled={future.length === 0} onClick={redo}>
            Redo
          </Button>
          <Button
            data-testid="adjust-start-again"
            disabled={JSON.stringify(g) === JSON.stringify(opened)}
            onClick={() => {
              change(opened);
            }}
          >
            Start again
          </Button>
          <Button
            icon={RotateCcw}
            data-testid="adjust-reset"
            disabled={nothingSet(g)}
            onClick={() => {
              // The corner-pin, the zoom and the move off; a part of one wide picture stays its (Separate pictures in
              // the group ends that).
              change({ ...NO_GEOMETRY, part: g.part, blend: g.blend });
            }}
          >
            Reset
          </Button>
          <Button variant="primary" data-testid="adjust-done" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {problem && <Notice tone="danger">{problem}</Notice>}
        {noChip && g.corners.some((c) => c.x !== 0 || c.y !== 0) && (
          <Notice tone="warning" data-testid="adjust-no-chip">
            This screen’s computer draws without a graphics chip, so a video on a picture pinned by its
            corners plays unevenly here. Use the projector’s own keystone, or a computer with a graphics chip.
          </Notice>
        )}
        <div className="flex flex-wrap items-start gap-4">
          <Preview
            g={g}
            pixels={pixels}
            onDragStart={() => {
              setPast((p) => [...p, g]);
              setFuture([]);
            }}
            onCorners={(corners, record) => {
              change({ ...g, corners }, record);
            }}
          />
          <div className="min-w-56 flex-1 space-y-3">
            <Checkbox
              label="Show a grid on this screen"
              data-testid="adjust-grid"
              checked={grid}
              onChange={(e) => {
                setGrid(e.target.checked);
              }}
            />
            <p className="text-xs text-muted">
              The grid goes over the show, which goes on under it: line the grid up with the wall, then close
              this.
            </p>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              Scaling
              <Select
                value={screen.scaling}
                onChange={(e) => {
                  const scaling = e.target.value as ScalingMode;
                  void screensAction(() => window.drashti.screens.updateScreen(screen.id, { scaling }));
                }}
              >
                {SCALING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {SCALING_WORDS[m]}
                  </option>
                ))}
              </Select>
            </label>
            <div className="flex flex-wrap gap-3">
              <NumberBox
                label="Zoom"
                unit="%"
                testId="adjust-zoom"
                value={g.zoom * 100}
                min={GEOMETRY_LIMITS.zoom.min * 100}
                max={GEOMETRY_LIMITS.zoom.max * 100}
                places={1}
                onCommit={(n) => {
                  change({ ...g, zoom: n / 100 });
                }}
              />
              <NumberBox
                label="Move across"
                testId="adjust-move-x"
                value={px(g.offsetX, 'width')}
                min={-moveMost}
                max={moveMost}
                onCommit={(n) => {
                  change({ ...g, offsetX: Math.max(-0.5, Math.min(0.5, share(n, 'width'))) });
                }}
              />
              <NumberBox
                label="down"
                testId="adjust-move-y"
                value={px(g.offsetY, 'height')}
                min={-moveMost}
                max={moveMost}
                onCommit={(n) => {
                  change({ ...g, offsetY: Math.max(-0.5, Math.min(0.5, share(n, 'height'))) });
                }}
              />
            </div>
          </div>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-xs font-bold text-muted">
            Each corner’s move, in the display’s pixels ({pixels.width} × {pixels.height})
          </legend>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {CORNERS.map((name, i) => (
              <div
                key={name}
                className="flex flex-wrap items-center gap-2"
                data-testid="adjust-corner"
                data-corner={i}
              >
                <span className="w-24 text-xs">{name}</span>
                <NumberBox
                  label="across"
                  testId={`adjust-corner-${String(i)}-x`}
                  value={px(g.corners[i as 0 | 1 | 2 | 3].x, 'width')}
                  min={-Math.round(pixels.width / 2)}
                  max={Math.round(pixels.width / 2)}
                  onCommit={(n) => {
                    setCorner(i, 'x', n);
                  }}
                />
                <NumberBox
                  label="down"
                  testId={`adjust-corner-${String(i)}-y`}
                  value={px(g.corners[i as 0 | 1 | 2 | 3].y, 'height')}
                  min={-Math.round(pixels.height / 2)}
                  max={Math.round(pixels.height / 2)}
                  onCommit={(n) => {
                    setCorner(i, 'y', n);
                  }}
                />
              </div>
            ))}
          </div>
        </fieldset>
        {(g.part !== null || blend !== null) && (
          <fieldset className="space-y-2" data-testid="adjust-blend">
            <legend className="text-xs font-bold text-muted">
              Edge blend: where this screen’s picture overlaps the next one’s, in the canvas’s pixels
            </legend>
            <div className="flex flex-wrap gap-3">
              <NumberBox
                label="Overlap at the left"
                testId="adjust-blend-left"
                value={blend?.left ?? 0}
                min={0}
                max={Math.floor(partWidth / 2)}
                onCommit={(n) => {
                  setBlend({ left: n });
                }}
              />
              <NumberBox
                label="at the right"
                testId="adjust-blend-right"
                value={blend?.right ?? 0}
                min={0}
                max={Math.floor(partWidth / 2)}
                onCommit={(n) => {
                  setBlend({ right: n });
                }}
              />
              <NumberBox
                label="Gamma"
                testId="adjust-blend-gamma"
                value={blend?.gamma ?? DEFAULT_GAMMA}
                min={GEOMETRY_LIMITS.gamma.min}
                max={GEOMETRY_LIMITS.gamma.max}
                places={2}
                onCommit={(n) => {
                  setBlend({ gamma: n });
                }}
              />
              <NumberBox
                label="Curve"
                testId="adjust-blend-curve"
                value={blend?.curve ?? DEFAULT_CURVE}
                min={GEOMETRY_LIMITS.curve.min}
                max={GEOMETRY_LIMITS.curve.max}
                places={2}
                onCommit={(n) => {
                  setBlend({ curve: n });
                }}
              />
            </div>
            <p className="text-xs text-muted">
              Gamma is the projector’s (2.2 for most). A larger curve makes the middle of the overlap steeper.
            </p>
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
