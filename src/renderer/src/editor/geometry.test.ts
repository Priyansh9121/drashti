import { describe, expect, it } from 'vitest';
import {
  alignMoves,
  boundsOf,
  contains,
  cornersOf,
  distributeMoves,
  hitTest,
  resizeFrame,
  rotatePoint,
  rotationToward,
  snapLines,
  snapMove,
  snapResize,
} from './geometry';

const close = (a: object, b: object) => {
  const got = a as Record<string, number>;
  for (const [k, v] of Object.entries(b as Record<string, number>)) expect(got[k], k).toBeCloseTo(v, 6);
};

describe('turned frames', () => {
  it('turns points clockwise (y grows downwards)', () => {
    close(rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90), { x: 0, y: 10 });
    close(rotatePoint({ x: 0, y: 10 }, { x: 0, y: 0 }, 90), { x: -10, y: 0 });
  });

  it('knows a turned frame’s corners, bounds and what is on it', () => {
    const p = { frame: { x: 0, y: 0, width: 200, height: 100 }, rotation: 90 };
    const [tl] = cornersOf(p);
    // The top left corner swings round to the top right of the upright bounds.
    close(tl ?? { x: 0, y: 0 }, { x: 150, y: -50 });
    close(boundsOf(p), { x: 50, y: -50, width: 100, height: 200 });
    expect(contains(p, { x: 100, y: 120 })).toBe(true);
    expect(contains(p, { x: 10, y: 50 })).toBe(false);
    // A thin line can still be picked within a few pixels.
    const line = { frame: { x: 0, y: 49, width: 300, height: 2 } };
    expect(contains(line, { x: 150, y: 56 })).toBe(false);
    expect(contains(line, { x: 150, y: 56 }, 6)).toBe(true);
  });

  it('picks the topmost element under the pointer', () => {
    const els = [
      { id: 'under', frame: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'over', frame: { x: 50, y: 50, width: 100, height: 100 } },
    ];
    expect(hitTest(els, { x: 75, y: 75 })).toBe('over');
    expect(hitTest(els, { x: 10, y: 10 })).toBe('under');
    expect(hitTest(els, { x: 500, y: 500 })).toBeNull();
  });
});

describe('resizing', () => {
  const frame = { x: 100, y: 100, width: 200, height: 100 };

  it('keeps the opposite corner or edge where it is', () => {
    expect(resizeFrame({ frame }, 'se', { x: 350, y: 260 })).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 160,
    });
    expect(resizeFrame({ frame }, 'nw', { x: 50, y: 80 })).toEqual({ x: 50, y: 80, width: 250, height: 120 });
    // An edge handle changes one side only.
    expect(resizeFrame({ frame }, 'e', { x: 400, y: 999 })).toEqual({
      x: 100,
      y: 100,
      width: 300,
      height: 100,
    });
    expect(resizeFrame({ frame }, 'n', { x: 0, y: 60 })).toEqual({ x: 100, y: 60, width: 200, height: 140 });
  });

  it('never goes below the smallest size, and can keep the proportions', () => {
    expect(resizeFrame({ frame }, 'se', { x: 0, y: 0 }, { min: 10 })).toEqual({
      x: 100,
      y: 100,
      width: 10,
      height: 10,
    });
    expect(resizeFrame({ frame }, 'se', { x: 500, y: 150 }, { keepRatio: true })).toEqual({
      x: 100,
      y: 100,
      width: 400,
      height: 200,
    });
  });

  it('keeps the fixed corner of a turned frame where it was on the slide', () => {
    const p = { frame, rotation: 30 };
    const fixedBefore = cornersOf(p)[0];
    // Drag the bottom right corner somewhere further out.
    const after = resizeFrame(p, 'se', { x: 420, y: 330 });
    const fixedAfter = cornersOf({ frame: after, rotation: 30 })[0];
    close(fixedAfter ?? { x: 0, y: 0 }, fixedBefore ?? { x: 0, y: 0 });
    // And the dragged corner is where the pointer is.
    close(cornersOf({ frame: after, rotation: 30 })[2] ?? { x: 0, y: 0 }, { x: 420, y: 330 });
  });

  it('turns towards the pointer, in steps, or held at a quarter turn', () => {
    const f = { x: 0, y: 0, width: 100, height: 100 };
    expect(rotationToward(f, { x: 50, y: -100 })).toBe(0);
    expect(rotationToward(f, { x: 200, y: 50 })).toBe(90);
    expect(rotationToward(f, { x: 150, y: -40 }, { step: true })).toBe(45);
    expect(rotationToward(f, { x: 200, y: 52 }, { snapWithin: 3 })).toBe(90);
    expect(rotationToward(f, { x: 200, y: 70 }, { snapWithin: 3 })).not.toBe(90);
  });
});

describe('snapping', () => {
  const slide = { width: 1920, height: 1080 };

  it('snaps a moving box’s edges and middle to the slide and other elements, and shows guides', () => {
    const lines = snapLines(slide, [{ x: 300, y: 300, width: 200, height: 100 }]);
    // Its left edge is 4 px from the other box's right edge; its middle 3 px off the slide's middle.
    const moved = snapMove({ x: 504, y: 489, width: 100, height: 100 }, lines, 8);
    expect([moved.dx, moved.dy]).toEqual([-4, 1]);
    expect(moved.guides).toEqual({ x: [500], y: [540] });
    // Too far from anything: no snap.
    expect(snapMove({ x: 700, y: 700, width: 10, height: 10 }, lines, 8)).toEqual({
      dx: 0,
      dy: 0,
      guides: { x: [], y: [] },
    });
  });

  it('snaps the edges a resize moves', () => {
    const lines = snapLines(slide, []);
    const r = snapResize({ x: 100, y: 100, width: 1815, height: 200 }, 'e', lines, 8);
    expect(r.frame).toEqual({ x: 100, y: 100, width: 1820, height: 200 });
    expect(r.guides).toEqual({ x: [1920], y: [] });
  });
});

describe('lining up and spacing out', () => {
  const boxes = [
    { x: 100, y: 100, width: 100, height: 50 },
    { x: 400, y: 300, width: 200, height: 50 },
  ];

  it('lines boxes up with each other, or one box with the slide', () => {
    expect(alignMoves(boxes, 'left', { width: 1920, height: 1080 })).toEqual([
      { x: 0, y: 0 },
      { x: -300, y: 0 },
    ]);
    expect(alignMoves(boxes, 'bottom', { width: 1920, height: 1080 })).toEqual([
      { x: 0, y: 200 },
      { x: 0, y: 0 },
    ]);
    expect(alignMoves(boxes.slice(0, 1), 'center', { width: 1920, height: 1080 })).toEqual([
      { x: 810, y: 0 },
    ]);
  });

  it('spaces three or more boxes out evenly, the outer ones staying', () => {
    const three = [
      { x: 0, y: 0, width: 100, height: 10 },
      { x: 600, y: 0, width: 100, height: 10 },
      { x: 150, y: 0, width: 100, height: 10 },
    ];
    expect(distributeMoves(three, 'x')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 150, y: 0 },
    ]);
    expect(distributeMoves(three.slice(0, 2), 'x')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
  });
});
