import { describe, expect, it } from 'vitest';
import type { Corners, Matrix3, Point, ScreenGeometry } from './screen-geometry';
import {
  applyMatrix,
  blendFactor,
  blendLight,
  cornersProblem,
  DEFAULT_CURVE,
  drawnWithoutChip,
  frameBands,
  DEFAULT_GAMMA,
  NO_GEOMETRY,
  nothingSet,
  partClip,
  pinnedCorners,
  placePart,
  rampAlphas,
  shownQuad,
  squareToQuad,
  warpKeepsAxes,
  warpMatrix,
  warpTransform,
  widePicture,
} from './screen-geometry';
import { placeContent } from './scaling';

const box = { width: 1920, height: 1080 };
const ZERO: Point = { x: 0, y: 0 };

const near = (a: Point, b: Point, digits = 6) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
const pinned = (corners: Corners): ScreenGeometry => ({ ...NO_GEOMETRY, corners });
const must = (m: Matrix3 | null): Matrix3 => {
  if (!m) throw new Error('no matrix');
  return m;
};

/** A browser's matrix3d(...) applied to a point of the plane (column-major, as CSS writes it). */
function cssApply(transform: string, p: Point): Point {
  const inner = /^matrix3d\((.*)\)$/u.exec(transform)?.[1];
  if (inner === undefined) throw new Error(`not a matrix3d: ${transform}`);
  const m = inner.split(',').map(Number);
  expect(m).toHaveLength(16);
  const at = (i: number) => m[i] ?? Number.NaN;
  // Column-major: x' = m0 x + m4 y + m12, y' = m1 x + m5 y + m13, w' = m3 x + m7 y + m15 (z = 0).
  const w = at(3) * p.x + at(7) * p.y + at(15);
  return {
    x: (at(0) * p.x + at(4) * p.y + at(12)) / w,
    y: (at(1) * p.x + at(5) * p.y + at(13)) / w,
  };
}

/** Where two lines through a, b and c, d cross. */
function crossing(a: Point, b: Point, c: Point, d: Point): Point {
  const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  const s = a.x * b.y - a.y * b.x;
  const t = c.x * d.y - c.y * d.x;
  return {
    x: (s * (c.x - d.x) - (a.x - b.x) * t) / den,
    y: (s * (c.y - d.y) - (a.y - b.y) * t) / den,
  };
}

const KEYSTONE: Corners = [
  { x: 0.05, y: 0.1 },
  { x: -0.02, y: 0 },
  { x: 0, y: -0.04 },
  { x: 0.1, y: 0 },
];

describe('nothing set', () => {
  it('null, undefined and the plain geometry set nothing and warp nothing: the screen draws as before', () => {
    expect(nothingSet(null)).toBe(true);
    expect(nothingSet(undefined)).toBe(true);
    expect(nothingSet(NO_GEOMETRY)).toBe(true);
    expect(warpTransform(null, box)).toBeNull();
    expect(warpTransform(undefined, box)).toBeNull();
    expect(warpTransform(NO_GEOMETRY, box)).toBeNull();
    expect(warpMatrix(NO_GEOMETRY, box)).toBeNull();
  });

  it('a part or a blend is something set, yet warps nothing', () => {
    const part = { ...NO_GEOMETRY, part: { x: 0, width: 1920 } };
    const blend = {
      ...NO_GEOMETRY,
      blend: { left: 0, right: 256, gamma: DEFAULT_GAMMA, curve: DEFAULT_CURVE },
    };
    expect(nothingSet(part)).toBe(false);
    expect(nothingSet(blend)).toBe(false);
    expect(warpTransform(part, box)).toBeNull();
    expect(warpTransform(blend, box)).toBeNull();
  });

  it('a zoom, a move or one corner moved warps', () => {
    expect(warpTransform({ ...NO_GEOMETRY, zoom: 0.95 }, box)).not.toBeNull();
    expect(warpTransform({ ...NO_GEOMETRY, offsetY: 0.01 }, box)).not.toBeNull();
    expect(warpTransform(pinned([ZERO, ZERO, { x: 0, y: -0.01 }, ZERO]), box)).not.toBeNull();
  });

  it('warps nothing in a box with no size (a window not laid out yet)', () => {
    expect(warpTransform(pinned(KEYSTONE), { width: 0, height: 1080 })).toBeNull();
  });
});

describe('squareToQuad', () => {
  it('maps the unit square onto itself as the identity', () => {
    const m = must(
      squareToQuad([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]),
    );
    for (const p of [ZERO, { x: 0.3, y: 0.7 }, { x: 1, y: 1 }]) near(applyMatrix(m, p), p);
  });

  it('puts each corner of the square exactly on its corner of the quad, a parallelogram and a keystone', () => {
    const quads: Corners[] = [
      [
        { x: 10, y: 20 },
        { x: 110, y: 30 },
        { x: 120, y: 90 },
        { x: 20, y: 80 },
      ],
      [
        { x: 96, y: 108 },
        { x: 1881.6, y: 0 },
        { x: 1920, y: 1036.8 },
        { x: 192, y: 1080 },
      ],
    ];
    const square: Corners = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    for (const q of quads) {
      const m = must(squareToQuad(q));
      square.forEach((s, i) => {
        near(applyMatrix(m, s), q[i] ?? ZERO);
      });
    }
  });

  it('is null for a quad with three corners on one line', () => {
    expect(
      squareToQuad([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 1 },
      ]),
    ).toBeNull();
  });
});

describe('warpMatrix', () => {
  it('puts each corner of the box where its pin says, the moves as shares of the box', () => {
    const m = must(warpMatrix(pinned(KEYSTONE), box));
    near(applyMatrix(m, { x: 0, y: 0 }), { x: 96, y: 108 });
    near(applyMatrix(m, { x: 1920, y: 0 }), { x: 1920 - 38.4, y: 0 });
    near(applyMatrix(m, { x: 1920, y: 1080 }), { x: 1920, y: 1080 - 43.2 });
    near(applyMatrix(m, { x: 0, y: 1080 }), { x: 192, y: 1080 });
    expect(pinnedCorners(pinned(KEYSTONE), box)).toEqual([
      { x: 96, y: 108 },
      { x: 1920 - 38.4, y: 0 },
      { x: 1920, y: 1080 - 43.2 },
      { x: 192, y: 1080 },
    ]);
  });

  it('keeps straight lines straight: the box centre goes where the pinned diagonals cross', () => {
    const m = must(warpMatrix(pinned(KEYSTONE), box));
    const [tl, tr, br, bl] = pinnedCorners(pinned(KEYSTONE), box);
    near(applyMatrix(m, { x: 960, y: 540 }), crossing(tl, br, tr, bl), 4);
    // A point along the top edge stays on the pinned top edge.
    const top = applyMatrix(m, { x: 480, y: 0 });
    const cross = (tr.x - tl.x) * (top.y - tl.y) - (tr.y - tl.y) * (top.x - tl.x);
    expect(Math.abs(cross)).toBeLessThan(1e-6);
  });

  it('zooms about the centre and moves by shares of the box', () => {
    const m = must(warpMatrix({ ...NO_GEOMETRY, zoom: 0.9, offsetX: 0.01, offsetY: -0.02 }, box));
    near(applyMatrix(m, { x: 0, y: 0 }), { x: 96 + 19.2, y: 54 - 21.6 });
    near(applyMatrix(m, { x: 960, y: 540 }), { x: 960 + 19.2, y: 540 - 21.6 });
    near(applyMatrix(m, { x: 1920, y: 1080 }), { x: 1824 + 19.2, y: 1026 - 21.6 });
  });

  it('zooms and moves first, then pins the whole box: a zoomed corner lands inside the pinned picture', () => {
    const g: ScreenGeometry = { ...pinned(KEYSTONE), zoom: 0.5 };
    const m = must(warpMatrix(g, box));
    const pin = must(warpMatrix(pinned(KEYSTONE), box));
    // The zoomed picture's top left corner, at (480, 270) of the box, is then pinned as the box's (480, 270) is.
    near(applyMatrix(m, { x: 0, y: 0 }), applyMatrix(pin, { x: 480, y: 270 }));
  });
});

describe('warpTransform', () => {
  it('is a matrix3d a browser applies exactly as the matrix does', () => {
    for (const g of [
      pinned(KEYSTONE),
      { ...NO_GEOMETRY, zoom: 1.1, offsetX: -0.03 },
      { ...pinned(KEYSTONE), zoom: 0.8 },
    ]) {
      const css = warpTransform(g, box);
      const m = must(warpMatrix(g, box));
      expect(css).not.toBeNull();
      for (const p of [ZERO, { x: 1920, y: 0 }, { x: 700, y: 900 }, { x: 1920, y: 1080 }])
        near(cssApply(css ?? '', p), applyMatrix(m, p), 3);
    }
  });
});

describe('cornersProblem', () => {
  it('accepts no move, and moves that keep a four-sided picture the same way round', () => {
    expect(cornersProblem(NO_GEOMETRY.corners)).toBeNull();
    expect(cornersProblem(KEYSTONE)).toBeNull();
  });

  it('refuses a corner moved more than half the display', () => {
    expect(cornersProblem([{ x: 0.51, y: 0 }, ZERO, ZERO, ZERO])).not.toBeNull();
    expect(cornersProblem([ZERO, ZERO, { x: 0, y: -0.6 }, ZERO])).not.toBeNull();
  });

  it('refuses corners that fold the picture or turn it inside out', () => {
    // The top left corner pulled past the diagonal: not convex.
    expect(cornersProblem([{ x: 0.45, y: 0.45 }, { x: -0.3, y: 0 }, ZERO, { x: 0, y: -0.3 }])).not.toBeNull();
    // Left and right swapped: inside out.
    expect(
      cornersProblem([
        { x: 0.5, y: 0 },
        { x: -0.5, y: 0 },
        { x: -0.5, y: 0 },
        { x: 0.5, y: 0 },
      ]),
    ).not.toBeNull();
  });

  it('refuses a side shorter than an eighth of the display', () => {
    expect(cornersProblem([{ x: 0.45, y: 0 }, { x: -0.45, y: 0 }, ZERO, ZERO])).not.toBeNull();
  });

  it('refuses numbers that are not numbers', () => {
    expect(cornersProblem([{ x: Number.NaN, y: 0 }, ZERO, ZERO, ZERO])).not.toBeNull();
  });
});

describe('the blend ramp', () => {
  it('gives no light at the outer edge, all of it inside, half in the middle', () => {
    for (const curve of [1, 2, 3.5]) {
      expect(blendLight(0, curve)).toBe(0);
      expect(blendLight(1, curve)).toBe(1);
      expect(blendLight(0.5, curve)).toBeCloseTo(0.5, 12);
    }
  });

  it("adds the two screens' light up to the whole picture's all across the overlap, at any curve", () => {
    for (const curve of [1, 1.5, 2, 4])
      for (let t = 0; t <= 1; t += 0.05)
        expect(blendLight(t, curve) + blendLight(1 - t, curve)).toBeCloseTo(1, 12);
  });

  it('is smooth at its ends with a curve over 1, and a straight line at 1', () => {
    expect(blendLight(0.1, 1)).toBeCloseTo(0.1, 12);
    expect(blendLight(0.1, 2)).toBeCloseTo(0.02, 12);
    expect(blendLight(0.25, 2)).toBeCloseTo(0.125, 12);
  });

  it('is gamma-correct: the pixel multiplier raised to the gamma is the light', () => {
    for (const gamma of [1.8, 2.2, 2.6])
      for (const t of [0.1, 0.3, 0.5, 0.9])
        expect(blendFactor(t, 2, gamma) ** gamma).toBeCloseTo(blendLight(t, 2), 12);
    // Half the light is far more than half the value: 0.5^(1/2.2).
    expect(blendFactor(0.5, 2, 2.2)).toBeCloseTo(0.7297, 4);
  });

  it('rampAlphas: one alpha a column, outer edge first, black over the picture by 1 - the multiplier', () => {
    const alphas = rampAlphas(256, 2, 2.2);
    expect(alphas).toHaveLength(256);
    alphas.forEach((a, j) => {
      expect(a).toBe(Math.round((1 - blendFactor((j + 0.5) / 256, 2, 2.2)) * 255));
    });
    expect(alphas[0]).toBeGreaterThan(240);
    expect(alphas[255]).toBe(0);
    for (let j = 1; j < 256; j++) expect(alphas[j] ?? 0).toBeLessThanOrEqual(alphas[j - 1] ?? 0);
    expect(rampAlphas(0, 2, 2.2)).toHaveLength(0);
  });
});

describe('placePart', () => {
  it('without a part, places the canvas as placeContent does', () => {
    for (const mode of ['fit', 'fill', 'stretch'] as const) {
      const window = { width: 944, height: 540 };
      expect(placePart(box, null, window, mode)).toEqual(placeContent(box, window, mode));
    }
  });

  it("shows the part filling the box, the part's left edge at the box's", () => {
    const wide = { width: 3584, height: 1080 };
    const right = placePart(wide, { x: 1664, width: 1920 }, box, 'fit');
    expect(right).toEqual({ scaleX: 1, scaleY: 1, x: -1664, y: 0 });
    const left = placePart(wide, { x: 0, width: 1920 }, { width: 960, height: 540 }, 'fit');
    expect(left).toEqual({ scaleX: 0.5, scaleY: 0.5, x: 0, y: 0 });
  });

  it("clips the canvas to the part, in the canvas's own pixels", () => {
    expect(partClip({ width: 3584, height: 1080 }, { x: 1664, width: 1920 })).toBe(
      'inset(0px 0px 0px 1664px)',
    );
    expect(partClip({ width: 3584, height: 1080 }, { x: 0, width: 1920 })).toBe('inset(0px 1664px 0px 0px)');
    expect(partClip({ width: 3584, height: 1080 }, null)).toBeUndefined();
  });
});

describe('widePicture', () => {
  it('two 1920 screens overlapping by 256: a 3584 canvas, parts from 0 and 1664, ramps on the inner edges', () => {
    expect(widePicture(2, box, 256)).toEqual({
      canvas: { width: 3584, height: 1080 },
      screens: [
        {
          part: { x: 0, width: 1920 },
          blend: { left: 0, right: 256, gamma: DEFAULT_GAMMA, curve: DEFAULT_CURVE },
        },
        {
          part: { x: 1664, width: 1920 },
          blend: { left: 256, right: 0, gamma: DEFAULT_GAMMA, curve: DEFAULT_CURVE },
        },
      ],
    });
  });

  it('three screens: the middle one blends on both sides', () => {
    const wide = widePicture(3, box, 200);
    expect(wide.canvas).toEqual({ width: 5360, height: 1080 });
    expect(wide.screens.map((s) => s.part)).toEqual([
      { x: 0, width: 1920 },
      { x: 1720, width: 1920 },
      { x: 3440, width: 1920 },
    ]);
    expect(wide.screens.map((s) => [s.blend.left, s.blend.right])).toEqual([
      [0, 200],
      [200, 200],
      [200, 0],
    ]);
  });
});

describe("the warp's cost (x27, Q60-20): which warps keep their clips, and the black outside the picture", () => {
  const keystone = pinned([
    { x: 0.04, y: 0.03 },
    { x: -0.03, y: 0.01 },
    { x: -0.01, y: -0.03 },
    { x: 0.02, y: -0.01 },
  ]);
  /** A slant: every corner moved across by the same share, the top more than the bottom (a parallelogram). */
  const slant = pinned([
    { x: 0.05, y: 0 },
    { x: 0.05, y: 0 },
    { x: -0.05, y: 0 },
    { x: -0.05, y: 0 },
  ]);

  it('keeps the axes with nothing set, a zoom, a move, or a part and a blend alone', () => {
    expect(warpKeepsAxes(null, box)).toBe(true);
    expect(warpKeepsAxes(undefined, box)).toBe(true);
    expect(warpKeepsAxes(NO_GEOMETRY, box)).toBe(true);
    expect(warpKeepsAxes({ ...NO_GEOMETRY, zoom: 0.97, offsetX: 0.02, offsetY: -0.01 }, box)).toBe(true);
    expect(
      warpKeepsAxes(
        {
          ...NO_GEOMETRY,
          part: { x: 0, width: 1920 },
          blend: { left: 0, right: 288, gamma: DEFAULT_GAMMA, curve: DEFAULT_CURVE },
        },
        box,
      ),
    ).toBe(true);
    // All four corners moved the same way: the picture moved, still square to the window.
    const moved = pinned([
      { x: 0.02, y: 0.01 },
      { x: 0.02, y: 0.01 },
      { x: 0.02, y: 0.01 },
      { x: 0.02, y: 0.01 },
    ]);
    expect(warpKeepsAxes(moved, box)).toBe(true);
  });

  it('does not keep them with a corner pinned: a keystone, a slant, one corner alone', () => {
    expect(warpKeepsAxes(keystone, box)).toBe(false);
    expect(warpKeepsAxes(slant, box)).toBe(false);
    expect(warpKeepsAxes(pinned([{ x: 0.01, y: 0 }, ZERO, ZERO, ZERO]), box)).toBe(false);
    expect(warpKeepsAxes({ ...keystone, zoom: 0.97 }, { width: 1024, height: 768 })).toBe(false);
  });

  it('shownQuad: nothing warped gives none; else the placed canvas, cut to the window, warped corner by corner', () => {
    const window = { width: 1024, height: 768 };
    expect(shownQuad(box, window, 'fit', null)).toBeNull();
    expect(shownQuad(box, window, 'fit', NO_GEOMETRY)).toBeNull();
    const quad = shownQuad(box, window, 'fit', keystone);
    if (!quad) throw new Error('no quad');
    // Fit puts the 1920 x 1080 canvas at 1024 x 576, 96 pixels down: its corners, warped as the window is.
    const m = must(warpMatrix(keystone, window));
    const want: Point[] = [
      applyMatrix(m, { x: 0, y: 96 }),
      applyMatrix(m, { x: 1024, y: 96 }),
      applyMatrix(m, { x: 1024, y: 672 }),
      applyMatrix(m, { x: 0, y: 672 }),
    ];
    quad.forEach((p, i) => {
      near(p, want[i] ?? ZERO);
    });
  });

  it('shownQuad: Fill cuts the canvas to the window; a part shows its own slice only', () => {
    const window = { width: 1024, height: 768 };
    const fill = shownQuad(box, window, 'fill', keystone);
    if (!fill) throw new Error('no quad');
    // Fill draws the canvas wider than the window: the window's own corners, warped.
    const m = must(warpMatrix(keystone, window));
    near(fill[0], applyMatrix(m, ZERO));
    near(fill[2], applyMatrix(m, { x: 1024, y: 768 }));
    // A part 1920 wide of a 3584 canvas, Fit into a 1920 x 1080 window: the part fills the window.
    const wide = { width: 3584, height: 1080 };
    const g = { ...keystone, part: { x: 1664, width: 1920 } };
    const part = shownQuad(wide, box, 'fit', g);
    if (!part) throw new Error('no quad');
    const mp = must(warpMatrix(g, box));
    near(part[0], applyMatrix(mp, ZERO));
    near(part[1], applyMatrix(mp, { x: 1920, y: 0 }));
    near(part[2], applyMatrix(mp, { x: 1920, y: 1080 }));
  });

  it('frameBands: four bands along the edges, whole pixels, each just past the quad on its side', () => {
    const window = { width: 1000, height: 800 };
    const quad: Corners = [
      { x: 40.2, y: 30.6 },
      { x: 970.5, y: 10.1 },
      { x: 990, y: 780.3 },
      { x: 20.5, y: 760.7 },
    ];
    expect(frameBands(quad, window)).toEqual([
      { x: 0, y: 0, width: 1000, height: 31 },
      { x: 970, y: 0, width: 30, height: 800 },
      { x: 0, y: 760, width: 1000, height: 40 },
      { x: 0, y: 0, width: 41, height: 800 },
    ]);
  });

  it('frameBands: every window pixel outside the quad is in a band; none past a quad corner beyond the window', () => {
    const window = { width: 1000, height: 800 };
    // The top right corner pinned out past the window: no right band above it is needed there, none is negative.
    const quad: Corners = [
      { x: 60, y: 50 },
      { x: 1040, y: -20 },
      { x: 950, y: 760 },
      { x: 30, y: 790 },
    ];
    const bands = frameBands(quad, window);
    for (const b of bands) {
      expect(b.width).toBeGreaterThan(0);
      expect(b.height).toBeGreaterThan(0);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(1000);
      expect(b.y + b.height).toBeLessThanOrEqual(800);
    }
    const inside = (p: Point) => {
      for (let i = 0; i < 4; i++) {
        const a = quad[i] ?? ZERO;
        const b = quad[(i + 1) % 4] ?? ZERO;
        if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0) return false;
      }
      return true;
    };
    for (let y = 0.5; y < 800; y += 7)
      for (let x = 0.5; x < 1000; x += 7) {
        const p = { x, y };
        if (inside(p)) continue;
        const covered = bands.some((b) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height);
        if (!covered) throw new Error(`outside the quad, in no band: ${String(x)}, ${String(y)}`);
      }
  });
});

describe('drawnWithoutChip (x27): whether a screen draws without a graphics chip, for Adjust the picture…', () => {
  const nodes = [{ id: 'placeholder-node-a', noGpu: true as const }, { id: 'placeholder-node-b' }];
  it("a node's screen as its node says; this computer's as it says itself", () => {
    expect(drawnWithoutChip({ nodeId: 'placeholder-node-a' }, nodes, false)).toBe(true);
    expect(drawnWithoutChip({ nodeId: 'placeholder-node-b' }, nodes, true)).toBe(false);
    expect(drawnWithoutChip({ nodeId: null }, nodes, true)).toBe(true);
    expect(drawnWithoutChip({ nodeId: null }, nodes, false)).toBe(false);
  });
  it('a node not in the list (gone, or not yet heard from) is not taken to draw without one', () => {
    expect(drawnWithoutChip({ nodeId: 'placeholder-node-gone' }, nodes, true)).toBe(false);
  });
});
