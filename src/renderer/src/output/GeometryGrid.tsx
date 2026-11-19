import type { ReactNode } from 'react';
import type { Size } from '../../../shared/scaling';
import type { ScreenBlend, ScreenPart } from '../../../shared/screen-geometry';

/*
 * The grid over a screen's picture while it is adjusted in Screens (x27): square cells, sixteen across this screen's
 * part (the whole canvas without one), in the canvas's own pixels, so it is warped with the picture and two projectors
 * of one wide picture draw the same lines in their overlap; its part's edge, its centre's cross and a circle (out of
 * round when the picture is stretched), and the overlaps' inner edges dashed. White lines over black ones, seen on any
 * picture. Drawn over the show, which keeps going under it: the screen is never blank while it is adjusted.
 */

/** Over the show and the blend's ramps. */
const GRID_Z = 11;
const CELLS_ACROSS = 16;

interface Stroke {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** In thin lines. */
  weight: number;
  dashed?: true;
}

export function GeometryGrid({
  canvas,
  part,
  blend,
}: {
  canvas: Size;
  part: ScreenPart | null;
  blend: ScreenBlend | null;
}) {
  const left = part?.x ?? 0;
  const width = part?.width ?? canvas.width;
  const { height } = canvas;
  const cell = width / CELLS_ACROSS;
  // Thicker on a larger canvas, so a 4K canvas's grid shows as an HD one's does.
  const thin = Math.max(1, Math.round(height / 540));
  const strokes: Stroke[] = [];
  // Every cell across the whole canvas, so the lines meet a neighbour's in the overlap.
  for (let i = Math.ceil(-left / cell - 1e-9); left + i * cell <= canvas.width + 0.5; i++) {
    const x = left + i * cell;
    strokes.push({ key: `v${String(i)}`, x1: x, y1: 0, x2: x, y2: height, weight: i % 4 === 0 ? 2 : 1 });
  }
  for (let j = 0; j * cell <= height + 0.5; j++)
    strokes.push({
      key: `h${String(j)}`,
      x1: 0,
      y1: j * cell,
      x2: canvas.width,
      y2: j * cell,
      weight: j % 4 === 0 ? 2 : 1,
    });
  const cx = left + width / 2;
  const cy = height / 2;
  strokes.push({ key: 'cx', x1: cx, y1: 0, x2: cx, y2: height, weight: 3 });
  strokes.push({ key: 'cy', x1: left, y1: cy, x2: left + width, y2: cy, weight: 3 });
  if (blend && blend.left > 0) {
    const x = left + blend.left;
    strokes.push({ key: 'ol', x1: x, y1: 0, x2: x, y2: height, weight: 3, dashed: true });
  }
  if (blend && blend.right > 0) {
    const x = left + width - blend.right;
    strokes.push({ key: 'or', x1: x, y1: 0, x2: x, y2: height, weight: 3, dashed: true });
  }
  const r = Math.min(width, height) * 0.4;
  const dash = `${String(12 * thin)} ${String(8 * thin)}`;
  /** Every shape, each line `extra` thin lines wider (the black outline under the white). */
  const shapes = (extra: number): ReactNode => (
    <>
      {strokes.map((s) => (
        <line
          key={s.key}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          strokeWidth={(s.weight + extra) * thin}
          strokeDasharray={s.dashed ? dash : undefined}
        />
      ))}
      <rect x={left} y={0} width={width} height={height} fill="none" strokeWidth={(4 + extra) * thin} />
      <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={(3 + extra) * thin} />
    </>
  );
  return (
    <svg
      data-testid="geometry-grid"
      width={canvas.width}
      height={height}
      viewBox={`0 0 ${String(canvas.width)} ${String(height)}`}
      // Unclipped at its own edge (an svg's viewport clips), as the ramps (BlendRamps): under a warp out of square a clip
      // there is a surface drawn again every frame. Its lines lie inside the canvas.
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        zIndex: GRID_Z,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      aria-hidden="true"
    >
      <g stroke="#000000" strokeOpacity={0.8}>
        {shapes(2)}
      </g>
      <g stroke="#ffffff">{shapes(0)}</g>
    </svg>
  );
}
