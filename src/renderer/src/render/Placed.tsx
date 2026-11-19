import type { CSSProperties, ReactNode } from 'react';
import { useRef } from 'react';
import type { Size } from '../../../shared/scaling';
import { placementTransform } from '../../../shared/scaling';
import type { ScreenPart } from '../../../shared/screen-geometry';
import { partClip, placePart } from '../../../shared/screen-geometry';
import type { ScalingMode } from '../../../shared/screens';
import { useElementSize } from './useElementSize';

/**
 * Draw `children` at `content` size, scaled into a box of known size. With a `part` (x27: a screen's share of one wide
 * picture), only that slice of the content, placed as the content would be, the rest clipped away; unless `clip` is
 * false (a picture warped out of square: render/canvas-clip.ts), when what covers the rest is the page's.
 */
export function Placed({
  content,
  box,
  mode,
  part = null,
  clip: clipped = true,
  children,
}: {
  content: Size;
  box: Size;
  mode: ScalingMode;
  part?: ScreenPart | null;
  clip?: boolean;
  children: ReactNode;
}) {
  const p = placePart(content, part, box, mode);
  const clip = clipped ? partClip(content, part) : undefined;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: content.width,
        height: content.height,
        transformOrigin: '0 0',
        transform: placementTransform(p),
        ...(clip === undefined ? {} : { clipPath: clip }),
      }}
    >
      {children}
    </div>
  );
}

/**
 * Like Placed, but the box is this element's own size. `className` must give
 * it a position (relative or absolute) and a size, for example
 * "relative aspect-video w-full" or "absolute inset-0". `style` goes on the box itself: an output's whole picture
 * warped (x27, output/main.tsx); its size is measured without it. `clip` false (a picture warped out of square,
 * render/canvas-clip.ts): the box clips nothing, nor the part.
 */
export function PlacedInParent({
  content,
  mode,
  className,
  children,
  fractional = false,
  part = null,
  style,
  clip = true,
}: {
  content: Size;
  mode: ScalingMode;
  className: string;
  children: ReactNode;
  fractional?: boolean;
  part?: ScreenPart | null;
  style?: CSSProperties;
  clip?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useElementSize(ref, fractional);
  return (
    <div
      ref={ref}
      className={clip ? `overflow-hidden ${className}` : className}
      data-box={`${box.width}x${box.height}`}
      style={style}
    >
      {box.width > 0 && (
        <Placed content={content} box={box} mode={mode} part={part} clip={clip}>
          {children}
        </Placed>
      )}
    </div>
  );
}
