import type { Size } from '../../../shared/scaling';
import type { Corners } from '../../../shared/screen-geometry';
import { frameBands } from '../../../shared/screen-geometry';

/** A number as an SVG path takes it, to a hundredth of a pixel. */
const n = (v: number) => String(Math.round(v * 100) / 100);

/*
 * Black over the window outside a pinned picture (x27, the owner's Q60-20): a screen warped out of square draws no clip
 * at its picture's edges (each would cost a surface drawn again every frame: render/canvas-clip.ts), so whatever the
 * show draws past its canvas (a picture filling a screen of another shape, a slide moving in) is covered here instead.
 * Four bands along the window's edges, each an SVG of the window less the picture's quad (even-odd), in the window's own
 * pixels: drawn once, unwarped, over the picture, small enough to cost nothing while the show moves under them.
 */
export function PictureFrame({ quad, box }: { quad: Corners; box: Size }) {
  const [tl, tr, br, bl] = quad;
  const d =
    `M0 0H${n(box.width)}V${n(box.height)}H0Z ` +
    `M${n(tl.x)} ${n(tl.y)}L${n(tr.x)} ${n(tr.y)}L${n(br.x)} ${n(br.y)}L${n(bl.x)} ${n(bl.y)}Z`;
  return (
    <>
      {frameBands(quad, box).map((b) => (
        <svg
          key={`${n(b.x)},${n(b.y)},${n(b.width)},${n(b.height)}`}
          aria-hidden="true"
          data-testid="picture-frame"
          width={b.width}
          height={b.height}
          viewBox={`${n(b.x)} ${n(b.y)} ${n(b.width)} ${n(b.height)}`}
          style={{ position: 'absolute', left: b.x, top: b.y, pointerEvents: 'none' }}
        >
          <path d={d} fill="#000000" fillRule="evenodd" />
        </svg>
      ))}
    </>
  );
}
