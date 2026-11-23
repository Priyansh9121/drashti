import { useRef } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, RefObject } from 'react';
import type { CropRect, CropShape, PercentBox, PixelSize } from '../../../shared/picture-look';
import { CROP_SHAPES, dragCrop, FULL_CROP, shapedCrop } from '../../../shared/picture-look';
import { radioKeys, radioTabIndex } from '../ui/radio';

/*
 * The crop's box (the Picture editor's, Session 55, Part 5): a frame dragged over the whole picture, its sides and
 * corners, or moved with the arrows (Shift and the arrows change its size), darker outside the part kept. Since
 * alpha.21 the slide editor's Crop picture and Make a slide… use it too (the owner's "physical way to crop, like in a
 * photo"): one box, one name, wherever a picture is cropped.
 */

/** Its accessible name, wherever it is. */
export const CROP_BOX_NAME =
  'The part kept: drag it, or its sides and corners; the arrows move it, Shift and the arrows change its size';

/** What a crop's drag holds: its side or corner (or all of it), and where it started. */
type Edge = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: { edge: Edge; style: CSSProperties; cursor: string }[] = [
  { edge: 'nw', style: { left: 0, top: 0 }, cursor: 'nwse-resize' },
  { edge: 'n', style: { left: '50%', top: 0 }, cursor: 'ns-resize' },
  { edge: 'ne', style: { left: '100%', top: 0 }, cursor: 'nesw-resize' },
  { edge: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize' },
  { edge: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize' },
  { edge: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize' },
  { edge: 'sw', style: { left: 0, top: '100%' }, cursor: 'nesw-resize' },
  { edge: 'w', style: { left: 0, top: '50%' }, cursor: 'ew-resize' },
];

/** A part of the frame, in percent, as a style. */
const placed = (b: PercentBox): CSSProperties => ({
  position: 'absolute',
  left: `${String(b.left)}%`,
  top: `${String(b.top)}%`,
  width: `${String(b.width)}%`,
  height: `${String(b.height)}%`,
});

/** A change to the crop, from what it was (the arrows may come faster than the window draws). */
export type CropChange = (update: (was: CropRect) => CropRect) => void;

export function CropBox({
  frame,
  picture,
  crop,
  change,
  shape,
  turned,
  testId = 'pe-crop-box',
  describedBy,
}: {
  /** The element the box is drawn in (its percentages are of it). */
  frame: RefObject<HTMLElement | null>;
  /** Where the whole picture is drawn in the frame, in percent of it. */
  picture: PercentBox;
  /** The part kept, in shares of the whole picture as it is drawn. */
  crop: CropRect;
  change: CropChange;
  shape: CropShape;
  /** The picture's size as it is drawn (turned): what a shape's sides are measured on. */
  turned: PixelSize;
  testId?: string;
  /** The id of words that say where it is (a read-out), for a screen reader. */
  describedBy?: string;
}) {
  const drag = useRef<{ x: number; y: number; edge: Edge; from: CropRect } | null>(null);
  const box: PercentBox = {
    left: picture.left + crop.x * picture.width,
    top: picture.top + crop.y * picture.height,
    width: crop.w * picture.width,
    height: crop.h * picture.height,
  };
  // A side, a corner or the whole of it dragged: by fractions of the picture as it is drawn.
  const start = (e: PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Which side or corner (or the whole of it) is the element's own: its data-edge.
    const edge: Edge = HANDLES.find((h) => h.edge === e.currentTarget.dataset['edge'])?.edge ?? 'move';
    drag.current = { x: e.clientX, y: e.clientY, edge, from: crop };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const b = frame.current?.getBoundingClientRect();
    if (!d || !b || b.width === 0 || picture.width <= 0 || picture.height <= 0) return;
    const dx = (e.clientX - d.x) / ((b.width * picture.width) / 100);
    const dy = (e.clientY - d.y) / ((b.height * picture.height) / 100);
    change(() => dragCrop(d.from, d.edge, dx, dy, shape, turned));
  };
  const end = () => {
    drag.current = null;
  };
  /** The arrows move the crop by a hundredth; with Shift they change its size (its right side, or its bottom). */
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    const step = 0.01;
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = by[e.key];
    if (!d) return;
    e.preventDefault();
    change((was) => dragCrop(was, e.shiftKey ? (d[0] !== 0 ? 'e' : 's') : 'move', d[0], d[1], shape, turned));
  };
  const below = box.top + box.height;
  const after = box.left + box.width;
  // Outside the part kept, darker: four parts of the frame (no shadow), so a frame that shows the handles whole at
  // its edges (it clips nothing) is darkened only within itself.
  const outside: PercentBox[] = [
    { left: 0, top: 0, width: 100, height: box.top },
    { left: 0, top: below, width: 100, height: 100 - below },
    { left: 0, top: box.top, width: box.left, height: box.height },
    { left: after, top: box.top, width: 100 - after, height: box.height },
  ];
  return (
    <>
      {outside.map((part, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="pointer-events-none absolute bg-black/60"
          style={placed(part)}
        />
      ))}
      <div
        role="button"
        tabIndex={0}
        data-testid={testId}
        aria-label={CROP_BOX_NAME}
        aria-describedby={describedBy}
        className="absolute cursor-move touch-none border-2 border-white outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
        style={placed(box)}
        data-edge="move"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onKeyDown={keys}
      >
        {HANDLES.map((h) => (
          <span
            key={h.edge}
            aria-hidden="true"
            data-edge={h.edge}
            className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white bg-black/60"
            style={{ ...h.style, cursor: h.cursor }}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
          />
        ))}
      </div>
    </>
  );
}

const SHAPE_LABELS: Record<CropShape, string> = { free: 'Free', '16:9': '16:9', '4:3': '4:3', '1:1': '1:1' };

/** The crop's shapes (Free, 16:9, 4:3, 1:1): one chosen makes the part kept that shape, as large as it can stay. */
export function CropShapes({
  shape,
  choose,
  testId = 'pe-crop-shapes',
  idPrefix = 'pe-crop',
}: {
  shape: CropShape;
  choose: (next: CropShape) => void;
  testId?: string;
  /** Each shape's test id: `${idPrefix}-${shape}`. */
  idPrefix?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="The crop’s shape"
      className="inline-flex rounded-md border border-line"
      data-testid={testId}
      onKeyDown={radioKeys(CROP_SHAPES, shape, choose)}
    >
      {CROP_SHAPES.map((s, i) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={shape === s}
          tabIndex={radioTabIndex(shape === s, i, true)}
          data-testid={`${idPrefix}-${s}`}
          className={`px-2.5 py-1 text-sm ${shape === s ? 'bg-primary text-on-primary' : 'text-fg hover:bg-panel-3'}`}
          onClick={() => {
            choose(s);
          }}
        >
          {SHAPE_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

/** A shape chosen: the part kept made that shape about where it is (free leaves it as it is). */
export function cropForShape(next: CropShape, turned: PixelSize, was: CropRect = FULL_CROP): CropRect {
  return next === 'free' ? was : shapedCrop(next, turned, was);
}
