import type { ReactNode } from 'react';
import { useRef } from 'react';
import type { Size } from '../../../shared/scaling';
import { placeContent, placementTransform } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import { useElementSize } from './useElementSize';

/** Draw `children` at `content` size, scaled into a box of known size. */
export function Placed({
  content,
  box,
  mode,
  children,
}: {
  content: Size;
  box: Size;
  mode: ScalingMode;
  children: ReactNode;
}) {
  const p = placeContent(content, box, mode);
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
      }}
    >
      {children}
    </div>
  );
}

/**
 * Like Placed, but the box is this element's own size. `className` must give
 * it a position (relative or absolute) and a size, for example
 * "relative aspect-video w-full" or "absolute inset-0".
 */
export function PlacedInParent({
  content,
  mode,
  className,
  children,
}: {
  content: Size;
  mode: ScalingMode;
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useElementSize(ref);
  return (
    <div ref={ref} className={`overflow-hidden ${className}`} data-box={`${box.width}x${box.height}`}>
      {box.width > 0 && (
        <Placed content={content} box={box} mode={mode}>
          {children}
        </Placed>
      )}
    </div>
  );
}
