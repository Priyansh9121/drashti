import { useLayoutEffect, useRef } from 'react';
import type { Size } from '../../../shared/scaling';
import type { ScreenBlend, ScreenPart } from '../../../shared/screen-geometry';
import { rampAlphas } from '../../../shared/screen-geometry';

/*
 * The edge blend's ramps (x27): over each overlap at the sides of this screen's part of one wide picture, black whose
 * alpha falls from the screen's outer edge inwards, one value a canvas pixel (shared/screen-geometry.ts rampAlphas):
 * the picture's values multiplied by the light's share to the power 1/gamma, so the two projectors' light adds up to
 * the picture's own across the overlap. Drawn once, in the canvas's own pixels, over everything the screen shows and
 * warped with it; nothing changes it while the show runs.
 */

/** Over every layer of the show (render/ uses at most 5), under the adjusting grid. */
const RAMP_Z = 10;

function Ramp({
  side,
  x,
  width,
  height,
  blend,
}: {
  side: 'left' | 'right';
  x: number;
  width: number;
  height: number;
  blend: ScreenBlend;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const columns = Math.max(1, Math.round(width));
  useLayoutEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const alphas = rampAlphas(columns, blend.curve, blend.gamma);
    const image = ctx.createImageData(columns, 1);
    // Black, its alpha the ramp's: the outer edge is this screen's own edge (the left's first, the right's last).
    for (let j = 0; j < columns; j++)
      image.data[j * 4 + 3] = alphas[side === 'left' ? j : columns - 1 - j] ?? 0;
    ctx.putImageData(image, 0, 0);
  }, [columns, side, blend.curve, blend.gamma]);
  return (
    <canvas
      ref={ref}
      width={columns}
      height={1}
      data-testid="blend-ramp"
      data-side={side}
      // A canvas clips at its own edge (a replaced element's overflow: clip), and under a screen's warp out of square
      // that clip made Chromium draw the ramp again into a surface of its own every frame (x27's clip finder): its
      // picture fills its box exactly, so nothing changes by drawing it unclipped.
      style={{
        position: 'absolute',
        left: x,
        top: 0,
        width,
        height,
        zIndex: RAMP_Z,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    />
  );
}

/** A screen's ramps, at the inner edges of its part (the whole canvas without one). */
export function BlendRamps({
  canvas,
  part,
  blend,
}: {
  canvas: Size;
  part: ScreenPart | null;
  blend: ScreenBlend;
}) {
  const from = part?.x ?? 0;
  const width = part?.width ?? canvas.width;
  return (
    <>
      {blend.left > 0 && (
        <Ramp side="left" x={from} width={blend.left} height={canvas.height} blend={blend} />
      )}
      {blend.right > 0 && (
        <Ramp
          side="right"
          x={from + width - blend.right}
          width={blend.right}
          height={canvas.height}
          blend={blend}
        />
      )}
    </>
  );
}
