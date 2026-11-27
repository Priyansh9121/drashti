import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { EngineCommand } from '../../src/shared/engine/commands';
import type { Size } from '../../src/shared/scaling';
import type { Point, ScreenGeometry, ScreenPart } from '../../src/shared/screen-geometry';
import {
  applyMatrix,
  blendFactor,
  NO_GEOMETRY,
  placePart,
  warpMatrix,
} from '../../src/shared/screen-geometry';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  setUpScreen,
  testDisplays,
} from './helpers';
import { near, pixels } from './pixels';
import { drawPicture, makeSlides } from './placeholder-slides';
import { streamPage } from './stream-helpers';

/*
 * A screen's geometry (x27): output scaling, corner-pin and edge blend, on the output window's whole picture. Read in
 * real pixels, where the shared maths (src/shared/screen-geometry.ts) says each should be: a pinned picture's corners
 * where they were pinned and black outside it, the edge blend's two ramps adding their light up to the whole picture's
 * across the overlap (gamma-correct), a key and fill pair's halves aligned, the screen never blank while it is adjusted
 * (the grid over the show), and the stream never warped. Generated pictures and placeholder words only.
 */

const ONE_OUTPUT = {
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_EXTRA_DISPLAYS: '1',
  DRASHTI_TEST_FAKE_DEVICES: '1',
};
const HD: Size = { width: 1920, height: 1080 };

/** Four placeholder colours, one a quarter of the picture: top left, top right, bottom right, bottom left. */
const QUARTERS: [number, number, number][] = [
  [230, 30, 30],
  [30, 200, 60],
  [40, 60, 230],
  [230, 210, 40],
];

/** A projector a little off square: each corner moved inwards, by shares of the display. */
const KEYSTONE: ScreenGeometry = {
  ...NO_GEOMETRY,
  corners: [
    { x: 0.1, y: 0.08 },
    { x: -0.05, y: 0.02 },
    { x: -0.02, y: -0.06 },
    { x: 0.06, y: -0.03 },
  ],
};

/**
 * Pinned, zoomed and blended, as the Performance check pins its hall screen: the blend's ramp at its right edge is a
 * layer of its own under the warp (as a video or another canvas is), which a clip there makes Chromium draw again into
 * a surface of its own each frame (x27's first diagnostic: two such surfaces; with corners alone and only painted
 * pictures there was none to see).
 */
const PINNED_BLENDED: ScreenGeometry = {
  ...KEYSTONE,
  zoom: 0.97,
  blend: { left: 0, right: 288, gamma: 2.2, curve: 2 },
};

const bridge = (win: Page) => ({
  update: (screenId: string, geometry: ScreenGeometry | null) =>
    win.evaluate(
      async ({ screenId, geometry }) => {
        const r = await (globalThis as PageGlobals).drashti.screens.updateScreen(screenId, { geometry });
        return r.ok ? 'ok' : r.message;
      },
      { screenId, geometry },
    ),
  adjusting: (screenId: string, on: boolean) =>
    win.evaluate(
      async ({ screenId, on }) => {
        const r = await (globalThis as PageGlobals).drashti.screens.adjusting(screenId, on);
        return r.ok ? 'ok' : r.message;
      },
      { screenId, on },
    ),
});

async function outputFor(app: ElectronApplication, screenId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const p of outputPages(app))
        if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) found = p;
      return found !== undefined;
    })
    .toBe(true);
  if (!found) throw new Error(`no output for ${screenId}`);
  return found;
}

/** The output window's own box, in CSS pixels: what its picture is placed into and warped in. */
const boxOf = (out: Page): Promise<Size> =>
  out.getByTestId('output-root').evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight }));

/** Where a point of the canvas is on the output window, by the shared maths: placed (Fit), then warped. */
function onWindow(
  canvas: Size,
  part: ScreenPart | null,
  box: Size,
  geometry: ScreenGeometry | null,
  p: Point,
): Point {
  const placed = placePart(canvas, part, box, 'fit');
  const q = { x: p.x * placed.scaleX + placed.x, y: p.y * placed.scaleY + placed.y };
  const m = geometry ? warpMatrix(geometry, box) : null;
  return m ? applyMatrix(m, q) : q;
}

/** A slide of one generated picture, up on the screens at once. */
async function showPicture(
  win: Page,
  name: string,
  patches: Parameters<typeof drawPicture>[2],
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-geometry-'));
  const [picture = ''] = await importAndGetIds(win, [
    await drawPicture(win, join(dir, `${name}.png`), patches),
  ]);
  const presentationId = await makeSlides(win, name, [{ picture }], { kind: 'cut', durationMs: 0 });
  const command: EngineCommand = { type: 'goLive', presentationId, slideIndex: 0 };
  await win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
}

const quarters = (): Parameters<typeof drawPicture>[2] =>
  QUARTERS.map((rgb, i) => ({
    x: i === 1 || i === 2 ? 0.5 : 0,
    y: i >= 2 ? 0.5 : 0,
    width: 0.5,
    height: 0.5,
    rgb: rgb.join(','),
  }));

/** Canvas points well inside each quarter, and near each corner of the picture. */
const CENTRES: Point[] = [
  { x: 480, y: 270 },
  { x: 1440, y: 270 },
  { x: 1440, y: 810 },
  { x: 480, y: 810 },
];
const NEAR_CORNERS: Point[] = [
  { x: 70, y: 70 },
  { x: 1850, y: 70 },
  { x: 1850, y: 1010 },
  { x: 70, y: 1010 },
];

test('a pinned picture: each corner where it was pinned, the quarters where the maths puts them, black outside; the stream never warped', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(ONE_OUTPUT);
  const win = await operatorPage(app);
  await operatorReady(win);
  const screenId = await setUpScreen(win, 'Placeholder hall', 1);
  const out = await outputFor(app, screenId);
  await outputReady(out);
  await showPicture(win, 'Placeholder quarters', quarters());
  const box = await boxOf(out);
  // Nothing set: drawn as before, each quarter where Fit puts it, and no geometry said.
  await expect(out.getByTestId('output-root')).not.toHaveAttribute('data-geometry');
  await expect
    .poll(async () => {
      const got = await pixels(
        out,
        CENTRES.map((p) => onWindow(HD, null, box, null, p)),
      );
      return got.map((rgba, i) => near(rgba, QUARTERS[i] ?? [0, 0, 0]));
    })
    .toEqual([true, true, true, true]);

  expect(await bridge(win).update(screenId, KEYSTONE)).toBe('ok');
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-geometry', 'set');
  const warped = [...CENTRES, ...NEAR_CORNERS].map((p) => onWindow(HD, null, box, KEYSTONE, p));
  // The window's own corners are outside the pinned picture: black there.
  const outside: Point[] = [
    { x: 6, y: 6 },
    { x: box.width - 6, y: box.height - 6 },
  ];
  await expect
    .poll(async () => {
      const got = await pixels(out, [...warped, ...outside]);
      return got.map((rgba, i) => near(rgba, i < 8 ? (QUARTERS[i % 4] ?? [0, 0, 0]) : [0, 0, 0], 40));
    })
    .toEqual(Array.from({ length: 10 }, () => true));
  // A pinned corner moved the picture's own corner there: the top left quarter's colour at its pinned place, black
  // where that corner was before.
  const [beforeCorner] = await pixels(out, [onWindow(HD, null, box, null, { x: 30, y: 30 })]);
  expect(near(beforeCorner, [0, 0, 0], 40)).toBe(true);

  // The stream's picture is never warped: its page draws no warp and no grid.
  await win.getByTestId('open-stream').click();
  const stream = await streamPage(app);
  await expect
    .poll(() =>
      stream.evaluate(() => ({
        // A screen's warp is a matrix3d in its picture box's own style (output/main.tsx): none here.
        warped: document.querySelectorAll('[style*="matrix3d"]').length > 0,
        grids: document.querySelectorAll('[data-testid="geometry-grid"]').length,
        ramps: document.querySelectorAll('[data-testid="blend-ramp"]').length,
      })),
    )
    .toEqual({ warped: false, grids: 0, ramps: 0 });

  // Nothing set again: as before.
  expect(await bridge(win).update(screenId, null)).toBe('ok');
  await expect(out.getByTestId('output-root')).not.toHaveAttribute('data-geometry');
  await expect
    .poll(async () =>
      near(
        (await pixels(out, [onWindow(HD, null, box, null, { x: 30, y: 30 })]))[0],
        QUARTERS[0] ?? [0, 0, 0],
      ),
    )
    .toBe(true);
  await app.close();
});

/** A screen as the Performance check has it: one hall screen over the computer's own display, its motion probe on. */
const REAL_SCREEN = { DRASHTI_TEST_MOTION_PROBE: '1', DRASHTI_TEST_FAKE_DEVICES: '1' };

/** cc's events for a frame drawn (the threaded compositor's, or a single-threaded one's). */
const DRAWS = new Set(['ProxyImpl::ScheduledActionDraw', 'SingleThreadProxy::DoComposite']);

/**
 * How Chromium's compositor drew these pages over a stretch, by its own record (its 'cc' trace, kept beside the test's
 * report): the render surfaces it made and why, the frames it drew, and in how many of them it rastered tiles again.
 */
async function drawnWhile(
  app: ElectronApplication,
  pids: number[],
  name: string,
  during: () => Promise<void>,
): Promise<{ reasons: string[]; draws: number; rasters: number; rasterFrames: number }> {
  const file = join(test.info().outputDir, `${name}.json`);
  await app.evaluate(async ({ contentTracing }) => {
    await contentTracing.startRecording({
      included_categories: ['cc'],
      excluded_categories: ['*'],
      recording_mode: 'record-until-full',
    });
  });
  await during();
  await app.evaluate(async ({ contentTracing }, f) => {
    await contentTracing.stopRecording(f);
  }, file);
  const raw = readFileSync(file);
  await test.info().attach(`${name}.json.gz`, { body: gzipSync(raw), contentType: 'application/gzip' });
  const parsed = JSON.parse(raw.toString('utf8')) as {
    traceEvents?: { name?: string; pid?: number; ts?: number; args?: Record<string, unknown> }[];
  };
  const mine = (parsed.traceEvents ?? []).filter((e) => e.pid !== undefined && pids.includes(e.pid));
  const drawn = mine
    .filter((e) => DRAWS.has(e.name ?? ''))
    .map((e) => e.ts ?? 0)
    .sort((a, b) => a - b);
  const rastered = mine.filter((e) => e.name === 'RasterTask').map((e) => e.ts ?? 0);
  // The frame each tile went into: the first drawn at or after its raster.
  const frames = new Set(
    rastered.map((t) => {
      const i = drawn.findIndex((d) => d >= t);
      return i < 0 ? drawn.length : i;
    }),
  );
  return {
    // cc says, each frame it draws with more than its root, how many surfaces it made and why.
    reasons: [
      ...new Set(
        mine.filter((e) => e.name === 'RenderSurfaceReasonCount').flatMap((e) => Object.keys(e.args ?? {})),
      ),
    ].sort(),
    draws: drawn.length,
    rasters: rastered.length,
    rasterFrames: frames.size,
  };
}

/** The renderers of the output windows. */
const outputPids = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => (w.webContents.getURL().split('?')[0] ?? '').endsWith('output.html'))
      .map((w) => w.webContents.getOSProcessId()),
  );

test('a pinned picture is drawn straight through its warp: no clip under it makes Chromium draw it again each frame, and black stays outside it where the show is larger than the screen', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(REAL_SCREEN);
  const win = await operatorPage(app);
  await operatorReady(win);
  const screenId = await setUpScreen(win, 'Placeholder hall', 0);
  const out = await outputFor(app, screenId);
  await outputReady(out);
  // A 4:3 picture filling the 16:9 canvas as the background (drawn past its top and bottom), under two slides of
  // words that dissolve into each other.
  const dir = mkdtempSync(join(tmpdir(), 'drashti-geometry-'));
  const [tall = ''] = await importAndGetIds(win, [
    await drawPicture(win, join(dir, 'Placeholder tall quarters.png'), quarters(), {
      width: 1440,
      height: 1080,
    }),
  ]);
  // Words on each, so the dissolve draws (two slides with nothing on them draw no frame at all: cc's trace says so).
  const slides = await makeSlides(
    win,
    'Placeholder words',
    [{ backgroundCue: tall, words: 'Placeholder words one' }, { words: 'Placeholder words two' }],
    {
      kind: 'dissolve',
      durationMs: 800,
    },
  );
  const go = (slideIndex: number) =>
    win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), {
      type: 'goLive',
      presentationId: slides,
      slideIndex,
    } satisfies EngineCommand);
  await go(0);
  const box = await boxOf(out);
  // Fill draws the 1440 x 1080 picture 1920 x 1440 on the canvas, 180 above and below it: its top quarters' colours
  // near the canvas's top, as Fit places the canvas.
  const nearTop = [
    { x: 300, y: 40 },
    { x: 1500, y: 40 },
  ];
  await expect
    .poll(async () =>
      (
        await pixels(
          out,
          nearTop.map((p) => onWindow(HD, null, box, null, p)),
        )
      ).map((rgba, i) => near(rgba, QUARTERS[i] ?? [0, 0, 0], 40)),
    )
    .toEqual([true, true]);

  expect(await bridge(win).update(screenId, PINNED_BLENDED)).toBe('ok');
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-geometry', 'set');
  // Pinned: the picture inside, and black just outside its top and bottom edges, where the background is drawn past
  // the canvas, and at the window's own corners.
  const edge = (a: Point, b: Point, out: number): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + out });
  const [tl, tr, br, bl] = [
    { x: 0, y: 0 },
    { x: 1920, y: 0 },
    { x: 1920, y: 1080 },
    { x: 0, y: 1080 },
  ].map((p) => onWindow(HD, null, box, PINNED_BLENDED, p)) as [Point, Point, Point, Point];
  const outside: Point[] = [
    edge(tl, tr, -8),
    edge(bl, br, 8),
    { x: 6, y: 6 },
    { x: box.width - 6, y: box.height - 6 },
  ];
  await expect
    .poll(async () => {
      const got = await pixels(out, [
        ...nearTop.map((p) => onWindow(HD, null, box, PINNED_BLENDED, p)),
        ...outside,
      ]);
      return got.map((rgba, i) => near(rgba, i < 2 ? (QUARTERS[i] ?? [0, 0, 0]) : [0, 0, 0], 40));
    })
    .toEqual([true, true, true, true, true, true]);

  // Two dissolves under Chromium's own record of how it drew them: no clip under the warp (the picture box's, the
  // scene's) made it draw the picture into a surface of its own, again each frame, before warping it.
  const { reasons, draws } = await drawnWhile(app, await outputPids(app), 'surfaces', async () => {
    await go(1);
    await letTimePass(win, 1300, 'a dissolve, then still');
    await go(0);
    await letTimePass(win, 1300, 'a dissolve back, then still');
  });
  expect(draws, 'the hall screen drew its frames while traced').toBeGreaterThan(10);
  expect(
    reasons.filter((r) => r.includes('clip')),
    `the render surfaces' reasons: ${reasons.join(', ')}`,
  ).toEqual([]);
  await app.close();
});

test('a pinned picture keeps a dissolve’s frames: with a graphics chip its slides are layers of their own, rastered once, not again at every frame', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(REAL_SCREEN);
  const win = await operatorPage(app);
  await operatorReady(win);
  const screenId = await setUpScreen(win, 'Placeholder hall', 0);
  const out = await outputFor(app, screenId);
  await outputReady(out);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-geometry-'));
  const [picture = ''] = await importAndGetIds(win, [
    await drawPicture(win, join(dir, 'Placeholder quarters.png'), quarters(), HD),
  ]);
  const slides = await makeSlides(win, 'Placeholder pictures', [{ picture }, { picture }], {
    kind: 'dissolve',
    durationMs: 800,
  });
  const go = (slideIndex: number) =>
    win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), {
      type: 'goLive',
      presentationId: slides,
      slideIndex,
    } satisfies EngineCommand);
  await go(0);
  expect(await bridge(win).update(screenId, KEYSTONE)).toBe('ok');
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-geometry', 'set');
  // One dissolve there and back first: what is drawn for the first time is not counted.
  for (const slide of [1, 0]) {
    await go(slide);
    await letTimePass(win, 1300, 'a dissolve, then still');
  }
  const now = () => out.evaluate(() => Date.now());
  let from = 0;
  let until = 0;
  const { draws, rasters, rasterFrames } = await drawnWhile(
    app,
    await outputPids(app),
    'rasters',
    async () => {
      from = await now();
      for (const slide of [1, 0, 1, 0]) {
        await go(slide);
        await letTimePass(win, 1300, 'a dissolve, then still');
      }
      until = await now();
    },
  );
  // With a graphics chip, Chromium rasters a pinned picture at a whole pixel a canvas pixel at least (3.5 times the
  // plain picture's on a 1024 x 768 display), so a slide painted afresh at each frame of its dissolve was rastered again
  // at each: as layers of their own, the slides are rastered once, as each comes, and faded by the chip. Without a chip
  // (Chromium drawing in software) such layers cost more than the painting: there they are not made
  // (render/canvas-clip.ts).
  const chipless = (await out.getByTestId('output-root').getAttribute('data-chipless')) === 'true';
  expect(draws, 'the hall screen drew its frames while traced').toBeGreaterThan(100);
  if (!chipless)
    expect(
      rasterFrames,
      `tiles rastered in ${String(rasterFrames)} of ${String(draws)} frames (${String(rasters)} tiles)`,
    ).toBeLessThan(draws / 4);
  // The frames the screen drew meanwhile (its motion probe: every frame it drew), and how many were late.
  const frames = await out.evaluate(
    ({ from, until }) =>
      (
        globalThis as { drashtiMotionProbe?: { read(a: number, b: number): { frames: number[] } } }
      ).drashtiMotionProbe?.read(from, until).frames ?? [],
    { from, until },
  );
  const gaps = frames.slice(1).map((t, k) => t - (frames[k] ?? t));
  const late = gaps.filter((g) => g > 25).length;
  expect(gaps.length, 'the screen drew its frames').toBeGreaterThan(100);
  expect(late / gaps.length, `${String(late)} of ${String(gaps.length)} frames over 25 ms`).toBeLessThan(
    0.25,
  );
  await app.close();
});

test('One wide picture: the two projectors’ ramps add their light up to the whole picture across the overlap, gamma-correct', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(ONE_OUTPUT);
  const win = await operatorPage(app);
  await operatorReady(win);
  const on = (await testDisplays(win)).map((d) => d.id);
  const overlap = 480;
  const made = await win.evaluate(
    async ({ on, overlap }) => {
      const d = (globalThis as PageGlobals).drashti;
      const created = await d.screens.createGroup('Placeholder wide hall');
      if (!created.ok) return created.message;
      const group = created.snapshot.groups.find((g) => g.name === 'Placeholder wide hall');
      for (const id of on) {
        const used = await d.screens.assignDisplay(group?.id ?? '', id, { coverOperator: true });
        if (!used.ok) return used.message;
      }
      if ((await d.screens.pending()) !== null) await d.screens.keep();
      const wide = await d.screens.widePicture(group?.id ?? '', overlap);
      if (!wide.ok) return wide.message;
      return wide.snapshot.groups.find((g) => g.id === group?.id)?.screens.map((s) => s.id) ?? [];
    },
    { on, overlap },
  );
  if (typeof made === 'string') throw new Error(made);
  const [leftId = '', rightId = ''] = made;
  const left = await outputFor(app, leftId);
  const right = await outputFor(app, rightId);
  for (const p of [left, right]) await outputReady(p);
  // A white picture all over the slide (in the middle of the 3360-wide canvas: 720 to 2640, the overlap inside).
  await showPicture(win, 'Placeholder white', [{ x: 0, y: 0, width: 1, height: 1, rgb: '255,255,255' }]);
  const canvas = { width: 2 * 1920 - overlap, height: 1080 };
  const leftPart = { x: 0, width: 1920 };
  const rightPart = { x: 1920 - overlap, width: 1920 };
  const [leftBox, rightBox] = [await boxOf(left), await boxOf(right)];
  // Across the overlap (canvas 1440 to 1920), and outside it on each.
  const columns = [1480, 1560, 1620, 1680, 1740, 1800, 1880];
  const y = 540;
  const read = async () => {
    const l = await pixels(left, [
      ...columns.map((x) => onWindow(canvas, leftPart, leftBox, null, { x, y })),
      onWindow(canvas, leftPart, leftBox, null, { x: 1000, y }),
    ]);
    const r = await pixels(right, [
      ...columns.map((x) => onWindow(canvas, rightPart, rightBox, null, { x, y })),
      onWindow(canvas, rightPart, rightBox, null, { x: 2400, y }),
    ]);
    return { l: l.map((p) => p[0] ?? 0), r: r.map((p) => p[0] ?? 0) };
  };
  await expect.poll(async () => (await read()).l.at(-1) ?? 0).toBeGreaterThan(245);
  await expect.poll(async () => (await read()).r.at(-1) ?? 0).toBeGreaterThan(245);
  const { l, r } = await read();
  const light = (v: number) => (v / 255) ** 2.2;
  columns.forEach((x, i) => {
    const vl = l[i] ?? 0;
    const vr = r[i] ?? 0;
    // Each ramp has its values: the left screen's falls to its right edge, the right's rises from its left edge.
    expect(
      Math.abs(vl - 255 * blendFactor((1920 - x) / overlap, 2, 2.2)),
      `left at ${String(x)}: ${String(vl)}`,
    ).toBeLessThan(14);
    expect(
      Math.abs(vr - 255 * blendFactor((x - 1440) / overlap, 2, 2.2)),
      `right at ${String(x)}: ${String(vr)}`,
    ).toBeLessThan(14);
    // Their light adds up to the white's own.
    expect(
      Math.abs(light(vl) + light(vr) - 1),
      `light at ${String(x)}: ${String(vl)} + ${String(vr)}`,
    ).toBeLessThan(0.08);
  });
  // Gamma-correct: half the light each in the middle is about 186 of 255, not 128.
  const middle = columns.indexOf(1680);
  expect(l[middle] ?? 0).toBeGreaterThan(170);
  expect(r[middle] ?? 0).toBeGreaterThan(170);
  await expect(left.getByTestId('blend-ramp')).toHaveAttribute('data-side', 'right');
  await expect(right.getByTestId('blend-ramp')).toHaveAttribute('data-side', 'left');
  await app.close();
});

test('a key and fill pair: the key draws its fill’s geometry, the two halves pixel-aligned', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(ONE_OUTPUT);
  const win = await operatorPage(app);
  await operatorReady(win);
  const on = (await testDisplays(win)).map((d) => d.id);
  const ids = await win.evaluate(async (on) => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.screens.createGroup('Placeholder switcher');
    if (!made.ok) throw new Error(made.message);
    const group = made.snapshot.groups.find((g) => g.name === 'Placeholder switcher');
    const role = await d.screens.setGroupRole(group?.id ?? '', 'keyfill');
    if (!role.ok) throw new Error(role.message);
    for (const id of on) {
      const used = await d.screens.assignDisplay(group?.id ?? '', id, { coverOperator: true });
      if (!used.ok) throw new Error(used.message);
    }
    if ((await d.screens.pending()) !== null) await d.screens.keep();
    return (await d.screens.get()).groups.find((g) => g.id === group?.id)?.screens.map((s) => s.id) ?? [];
  }, on);
  const [fillId = '', keyId = ''] = ids;
  const fill = await outputFor(app, fillId);
  const key = await outputFor(app, keyId);
  for (const p of [fill, key]) await outputReady(p);
  await showPicture(win, 'Placeholder keyed box', [
    { x: 0.25, y: 0.25, width: 0.5, height: 0.5, rgb: '255,0,0' },
  ]);
  // Only the fill is given one: the key follows it.
  expect(await bridge(win).update(fillId, KEYSTONE)).toBe('ok');
  for (const p of [fill, key])
    await expect(p.getByTestId('output-root')).toHaveAttribute('data-geometry', 'set');
  const box = await boxOf(fill);
  expect(await boxOf(key)).toEqual(box);
  // A grid of points over the window: wherever the fill is red, the key is white; wherever it is black, so is the key.
  const points: Point[] = [];
  for (let i = 1; i < 16; i++)
    for (let j = 1; j < 9; j++) points.push({ x: (box.width * i) / 16, y: (box.height * j) / 9 });
  await expect
    .poll(async () => {
      const f = await pixels(fill, points);
      const k = await pixels(key, points);
      let red = 0;
      let mismatched = 0;
      f.forEach((rgba, i) => {
        const isRed = near(rgba, [255, 0, 0], 40);
        const isBlack = near(rgba, [0, 0, 0], 40);
        if (isRed) red++;
        if (isRed && !near(k[i], [255, 255, 255], 40)) mismatched++;
        if (isBlack && !near(k[i], [0, 0, 0], 40)) mismatched++;
      });
      return { some: red > 10, mismatched };
    })
    .toEqual({ some: true, mismatched: 0 });
  // And where the maths says: the box's centre at its warped place on both.
  const centre = onWindow(HD, null, box, KEYSTONE, { x: 960, y: 540 });
  expect(near((await pixels(fill, [centre]))[0], [255, 0, 0], 40)).toBe(true);
  expect(near((await pixels(key, [centre]))[0], [255, 255, 255], 40)).toBe(true);
  await app.close();
});

test('adjusting: the grid over the show, which goes on; never blank, never loaded again, and the grid gone after', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(ONE_OUTPUT);
  const win = await operatorPage(app);
  await operatorReady(win);
  const screenId = await setUpScreen(win, 'Placeholder hall', 1);
  const out = await outputFor(app, screenId);
  await outputReady(out);
  await showPicture(win, 'Placeholder quarters', quarters());
  const box = await boxOf(out);
  await expect
    .poll(async () =>
      near(
        (await pixels(out, [onWindow(HD, null, box, null, CENTRES[0] ?? { x: 0, y: 0 })]))[0],
        QUARTERS[0] ?? [0, 0, 0],
      ),
    )
    .toBe(true);
  // This page and its scene, marked: the same ones all through.
  await out.evaluate(() => {
    (window as unknown as { x27Page?: number }).x27Page = 1;
    const scene = document.querySelector<HTMLElement & { x27Scene?: number }>('[data-testid="scene"]');
    if (scene) scene.x27Scene = 1;
  });
  expect(await bridge(win).adjusting(screenId, true)).toBe('ok');
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-grid', 'on');
  await expect(out.getByTestId('geometry-grid')).toBeVisible();
  // Between the grid's lines (every 120 canvas pixels), the show is still there.
  const between = (g: ScreenGeometry | null) =>
    [
      { x: 300, y: 300 },
      { x: 1620, y: 300 },
      { x: 1620, y: 780 },
      { x: 300, y: 780 },
    ].map((p) => onWindow(HD, null, box, g, p));
  const shows = async (g: ScreenGeometry | null) =>
    (await pixels(out, between(g))).map((rgba, i) => near(rgba, QUARTERS[i] ?? [0, 0, 0], 40));
  await expect.poll(() => shows(null)).toEqual([true, true, true, true]);
  // Corners moved step by step while the grid is up: the show is there after each, on the same page.
  const steps = [0.02, 0.04, 0.06, 0.08];
  for (const s of steps) {
    const g: ScreenGeometry = {
      ...NO_GEOMETRY,
      zoom: 1 - s / 2,
      corners: [
        { x: s, y: s / 2 },
        { x: -s / 2, y: 0 },
        { x: 0, y: -s },
        { x: s / 2, y: 0 },
      ],
    };
    expect(await bridge(win).update(screenId, g)).toBe('ok');
    await expect.poll(() => shows(g)).toEqual([true, true, true, true]);
    expect(
      await out.evaluate(() => ({
        page: (window as unknown as { x27Page?: number }).x27Page,
        scene: document.querySelector<HTMLElement & { x27Scene?: number }>('[data-testid="scene"]')?.x27Scene,
      })),
    ).toEqual({ page: 1, scene: 1 });
  }
  expect(await bridge(win).adjusting(screenId, false)).toBe('ok');
  await expect(out.getByTestId('output-root')).not.toHaveAttribute('data-grid');
  await expect(out.getByTestId('geometry-grid')).toHaveCount(0);
  // The operator window loading again ends any adjusting it left: the grid never stays on a screen.
  expect(await bridge(win).adjusting(screenId, true)).toBe('ok');
  await expect(out.getByTestId('geometry-grid')).toHaveCount(1);
  await win.reload();
  await operatorReady(win);
  await expect(out.getByTestId('geometry-grid')).toHaveCount(0);
  await app.close();
});

/** A screen's geometry as Screens has it now: null for nothing set. */
const savedGeometry = (win: Page, screenId: string) =>
  win.evaluate(
    async (id) =>
      (await (globalThis as PageGlobals).drashti.screens.get()).groups
        .flatMap((g) => g.screens)
        .find((s) => s.id === id)?.geometry ?? null,
    screenId,
  );

/** The words Adjust the picture… says on a screen drawn without a graphics chip once a corner is moved (Q60-24 A). */
const NO_CHIP_NOTE = /without a graphics chip.*video on a picture pinned by its corners plays unevenly/su;

test('Adjust the picture… says plainly, once a corner is moved on a screen drawn without a graphics chip, that a video on the pinned picture plays unevenly; never with a chip (the owner’s Q60-24 A)', async () => {
  test.setTimeout(240_000);
  // The same steps without a chip and with one, Chromium's word on how it draws made either (a test switch).
  for (const [compositing, warned] of [
    ['disabled_software', true],
    ['enabled_on', false],
  ] as const) {
    const { app } = await launchApp({ ...ONE_OUTPUT, DRASHTI_TEST_GPU_COMPOSITING: compositing });
    const win = await operatorPage(app);
    await operatorReady(win);
    const screenId = await setUpScreen(win, 'Placeholder hall', 1);
    await outputReady(await outputFor(app, screenId));
    await win.getByRole('button', { name: 'Screens', exact: true }).click();
    await win.getByTestId('screen-row').first().getByTestId('adjust-picture-open').click();
    const dialog = win.getByTestId('adjust-picture');
    await expect(dialog).toBeVisible();
    const note = dialog.getByTestId('adjust-no-chip');
    // Nothing pinned yet, or a zoom alone: no note either way.
    await expect(note).toHaveCount(0);
    await dialog.getByTestId('adjust-zoom').fill('97');
    await dialog.getByTestId('adjust-zoom').press('Enter');
    await expect.poll(async () => (await savedGeometry(win, screenId))?.zoom).toBe(0.97);
    await expect(note).toHaveCount(0);
    // A corner moved: the note without a chip, at once, in plain words; never with one.
    await dialog.getByTestId('adjust-corner-0-x').fill('40');
    await dialog.getByTestId('adjust-corner-0-x').press('Enter');
    await expect.poll(async () => (await savedGeometry(win, screenId))?.corners[0].x ?? 0).toBeGreaterThan(0);
    if (warned) {
      await expect(note).toBeVisible();
      await expect(note).toHaveText(NO_CHIP_NOTE);
      await expectNoSeriousA11yIssues(
        win,
        'Adjust the picture… with its note',
        '[data-testid="adjust-picture"]',
      );
      // The corner put back (Reset): the note goes with it.
      await dialog.getByTestId('adjust-reset').click();
      await expect.poll(async () => (await savedGeometry(win, screenId))?.corners[0].x ?? 0).toBe(0);
      await expect(note).toHaveCount(0);
    } else {
      await expect(dialog.getByTestId('adjust-corner-0-x')).toHaveValue('40');
      await expect(note).toHaveCount(0);
    }
    await app.close();
  }
});

test('Screens: Adjust the picture… moves a corner by its numbers, the keys and a drag, with Undo, Redo and Reset, the grid on the screen while open; One wide picture… and Separate pictures', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(ONE_OUTPUT);
  const win = await operatorPage(app);
  await operatorReady(win);
  const screenId = await setUpScreen(win, 'Placeholder hall', 1);
  const out = await outputFor(app, screenId);
  await outputReady(out);
  // The display's own pixels, which the numbers are in.
  const px = await win.evaluate(async (id) => {
    const snap = await (globalThis as PageGlobals).drashti.screens.get();
    const screen = snap.groups.flatMap((g) => g.screens).find((s) => s.id === id);
    const status = snap.status.find((st) => st.screenId === id);
    const d = snap.displays.find((x) => x.id === status?.displayId);
    return { width: d?.pixelWidth ?? screen?.displayKey?.pixelWidth ?? 0, height: d?.pixelHeight ?? 0 };
  }, screenId);
  expect(px.width).toBeGreaterThan(0);
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const row = win.getByTestId('screen-row').first();
  await row.getByTestId('adjust-picture-open').click();
  const dialog = win.getByTestId('adjust-picture');
  await expect(dialog).toBeVisible();
  // The grid over the show while it is open.
  await expect(out.getByTestId('geometry-grid')).toHaveCount(1);
  await expectNoSeriousA11yIssues(win, 'Adjust the picture…', '[data-testid="adjust-picture"]');
  // The top left corner moved by its numbers.
  const across = Math.round(px.width * 0.05);
  const down = Math.round(px.height * 0.04);
  await dialog.getByTestId('adjust-corner-0-x').fill(String(across));
  await dialog.getByTestId('adjust-corner-0-x').press('Enter');
  await dialog.getByTestId('adjust-corner-0-y').fill(String(down));
  await dialog.getByTestId('adjust-corner-0-y').press('Enter');
  await expect
    .poll(async () => (await savedGeometry(win, screenId))?.corners[0])
    .toEqual({ x: across / px.width, y: down / px.height });
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-geometry', 'set');
  // The top right corner by the keys: ten display pixels left with Shift.
  await dialog.getByTestId('adjust-handle').nth(1).focus();
  await win.keyboard.press('Shift+ArrowLeft');
  await expect
    .poll(async () => (await savedGeometry(win, screenId))?.corners[1].x ?? 0)
    .toBeCloseTo(-10 / px.width, 6);
  // The bottom right corner dragged up and to the left.
  const handle = dialog.getByTestId('adjust-handle').nth(2);
  const at = await handle.boundingBox();
  if (!at) throw new Error('no handle');
  await win.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await win.mouse.down();
  await win.mouse.move(at.x + at.width / 2 - 24, at.y + at.height / 2 - 16, { steps: 6 });
  await win.mouse.up();
  await expect
    .poll(async () => {
      const c = (await savedGeometry(win, screenId))?.corners[2];
      return (c?.x ?? 0) < 0 && (c?.y ?? 0) < 0;
    })
    .toBe(true);
  // Undo takes the drag back as one step; Redo puts it back; Cmd/Ctrl+Z undoes it again.
  await dialog.getByTestId('adjust-undo').click();
  await expect.poll(async () => (await savedGeometry(win, screenId))?.corners[2]).toEqual({ x: 0, y: 0 });
  await expect
    .poll(async () => (await savedGeometry(win, screenId))?.corners[1].x ?? 0)
    .toBeCloseTo(-10 / px.width, 6);
  await dialog.getByTestId('adjust-redo').click();
  await expect.poll(async () => ((await savedGeometry(win, screenId))?.corners[2].x ?? 0) < 0).toBe(true);
  await dialog.getByTestId('adjust-preview').click({ position: { x: 4, y: 4 } });
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect.poll(async () => (await savedGeometry(win, screenId))?.corners[2]).toEqual({ x: 0, y: 0 });
  // With a Gujarati or Hindi keyboard layout too, by the Z key's place, whose letter that layout names (hunt S3-3):
  // Shift with it redoes the drag, and it alone undoes it again.
  const layoutZ = (key: string, shiftKey: boolean) =>
    win.evaluate(
      ({ key: k, shiftKey: shift, mods }) =>
        document
          .querySelector('[data-testid="adjust-preview"]')
          ?.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: k,
              code: 'KeyZ',
              shiftKey: shift,
              bubbles: true,
              cancelable: true,
              ...mods,
            }),
          ),
      { key, shiftKey, mods: process.platform === 'darwin' ? { metaKey: true } : { ctrlKey: true } },
    );
  await layoutZ('ઍ', true);
  await expect.poll(async () => ((await savedGeometry(win, screenId))?.corners[2].x ?? 0) < 0).toBe(true);
  await layoutZ('ઝ', false);
  await expect.poll(async () => (await savedGeometry(win, screenId))?.corners[2]).toEqual({ x: 0, y: 0 });
  // Reset: nothing set, the screen as before.
  await dialog.getByTestId('adjust-reset').click();
  await expect.poll(() => savedGeometry(win, screenId)).toBeNull();
  await expect(out.getByTestId('output-root')).not.toHaveAttribute('data-geometry');
  // Done: the grid goes.
  await dialog.getByTestId('adjust-done').click();
  await expect(dialog).toHaveCount(0);
  await expect(out.getByTestId('geometry-grid')).toHaveCount(0);

  // One wide picture: the main display's screen joins the group, to its right.
  const groupId = await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const snap = await d.screens.get();
    const group = snap.groups.find((g) => g.screens.some((s) => s.id === id));
    const main = snap.displays.find((x) => x.primary);
    const used = await d.screens.assignDisplay(group?.id ?? '', main?.id ?? -1, { coverOperator: true });
    if (!used.ok) throw new Error(used.message);
    if ((await d.screens.pending()) !== null) await d.screens.keep();
    return group?.id ?? '';
  }, screenId);
  const card = win.locator(`#screen-group-${groupId}`);
  await card.getByTestId('wide-picture-open').click();
  const wide = win.getByTestId('wide-picture');
  await expectNoSeriousA11yIssues(win, 'One wide picture…', '[data-testid="wide-picture"]');
  await wide.getByTestId('wide-overlap').fill('300');
  await wide.getByTestId('wide-make').click();
  await expect(wide).toHaveCount(0);
  const canvases = () =>
    win.evaluate(
      async (gid) =>
        (await (globalThis as PageGlobals).drashti.screens.get()).groups
          .find((g) => g.id === gid)
          ?.screens.map((s) => [
            s.canvasWidth,
            s.geometry?.part?.x ?? null,
            s.geometry?.blend?.right ?? null,
          ]) ?? [],
      groupId,
    );
  await expect.poll(canvases).toEqual([
    [3540, 0, 300],
    [3540, 1620, 0],
  ]);
  await expect(out.getByTestId('blend-ramp')).toHaveAttribute('data-side', 'right');
  // Separate pictures: each its own canvas again, nothing set.
  await card.getByTestId('wide-picture-open').click();
  await wide.getByTestId('wide-separate').click();
  await expect.poll(canvases).toEqual([
    [1920, null, null],
    [1920, null, null],
  ]);
  await expect(out.getByTestId('blend-ramp')).toHaveCount(0);
  await app.close();
});
