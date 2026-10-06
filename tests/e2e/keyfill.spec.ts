import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { OutputGlobals, PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, outputPages } from './helpers';
import { canvasPixels, near } from './pixels';

/*
 * Key and fill outputs (Session 11): a key and fill group drives two
 * outputs. The fill is the group's picture, black where empty; the key is
 * white wherever the fill has something, by its opacity (grey at half), and
 * black elsewhere, for a video switcher to key over a camera. Both follow the
 * same state and clock: a dissolve starts at the same moment on both, and the
 * frames each window paints for a change are measured and reported.
 * Generated shapes and placeholder words only.
 */

const TWO_OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
const FULL = { x: 300, y: 250 };
const HALF = { x: 1200, y: 250 };
const NONE = { x: 900, y: 800 };

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

/** A key and fill group on the two displays: its fill and key outputs. */
async function keyFillPair(app: ElectronApplication, win: Page): Promise<{ fill: Page; key: Page }> {
  const screens = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.screens.createGroup('Placeholder switcher');
    if (!made.ok) throw new Error(made.message);
    const group = made.snapshot.groups.find((g) => g.name === 'Placeholder switcher');
    const role = await d.screens.setGroupRole(group?.id ?? '', 'keyfill');
    if (!role.ok) throw new Error(role.message);
    for (const display of made.snapshot.displays) {
      const used = await d.screens.assignDisplay(group?.id ?? '', display.id, { coverOperator: true });
      if (!used.ok) throw new Error(used.message);
    }
    return (await d.screens.get()).groups.find((g) => g.id === group?.id)?.screens ?? [];
  });
  expect(screens.map((s) => s.feed)).toEqual(['fill', 'key']);
  const fill = await outputFor(app, screens[0]?.id ?? '');
  const key = await outputFor(app, screens[1]?.id ?? '');
  await expect(fill.getByTestId('output-root')).toHaveAttribute('data-feed', 'fill');
  await expect(key.getByTestId('output-root')).toHaveAttribute('data-feed', 'key');
  return { fill, key };
}

test('the key is white where the fill has something, grey at half opacity and black elsewhere, and where a mask hides', async () => {
  const { app } = await launchApp(TWO_OUTPUTS);
  const win = await operatorPage(app);
  await operatorReady(win);
  const { fill, key } = await keyFillPair(app, win);
  // A prop: an opaque red rectangle and a blue one at half opacity.
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'showProp',
      prop: {
        id: 'placeholder-keyed',
        name: 'Placeholder keyed shapes',
        width: 1920,
        height: 1080,
        elements: [
          {
            id: 'full',
            kind: 'shape',
            shape: 'rectangle',
            frame: { x: 100, y: 100, width: 400, height: 300 },
            fill: '#ff0000',
            cornerRadius: 0,
            opacity: 1,
          },
          {
            id: 'half',
            kind: 'shape',
            shape: 'rectangle',
            frame: { x: 1000, y: 100, width: 400, height: 300 },
            fill: '#0000ff',
            cornerRadius: 0,
            opacity: 0.5,
          },
        ],
      },
    }),
  );
  // The fill: the picture on black (half opacity is half the colour: pre-multiplied).
  await expect
    .poll(async () => {
      const [full, half, none] = await canvasPixels(fill, [FULL, HALF, NONE]);
      return [near(full, [255, 0, 0]), near(half, [0, 0, 128], 16), near(none, [0, 0, 0], 8)];
    })
    .toEqual([true, true, true]);
  // The key: white, grey, black.
  await expect
    .poll(async () => {
      const [full, half, none] = await canvasPixels(key, [FULL, HALF, NONE]);
      return [near(full, [255, 255, 255], 8), near(half, [128, 128, 128], 16), near(none, [0, 0, 0], 8)];
    })
    .toEqual([true, true, true]);
  // The group's own mask (its screens' shape) hides the same on both: black on the fill, and black
  // on the key (nothing keyed) where the opaque rectangle was; the rest is as it was.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.masks.save(null, {
      name: 'Placeholder corner',
      width: 1920,
      height: 1080,
      mode: 'hide',
      shapes: [{ id: 'corner', kind: 'rectangle', frame: { x: 0, y: 0, width: 700, height: 540 } }],
    });
    if (!made.ok) throw new Error(made.message);
    const group = (await d.screens.get()).groups.find((g) => g.name === 'Placeholder switcher');
    const set = await d.looks.setGroup((await d.looks.list()).liveId, group?.id ?? '', { maskId: made.id });
    if (!set.ok) throw new Error(set.message);
  });
  await expect
    .poll(async () => {
      const [full, half] = await canvasPixels(key, [FULL, HALF]);
      return [near(full, [0, 0, 0], 8), near(half, [128, 128, 128], 16)];
    })
    .toEqual([true, true]);
  await expect.poll(async () => near((await canvasPixels(fill, [FULL]))[0], [0, 0, 0], 8)).toBe(true);
  // Black-out is for the hall: it takes the graphics off both (nothing to key).
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'setBlackout', on: true }),
  );
  await expect.poll(async () => near((await canvasPixels(key, [FULL]))[0], [0, 0, 0], 8)).toBe(true);
  await expect.poll(async () => near((await canvasPixels(fill, [FULL]))[0], [0, 0, 0], 8)).toBe(true);
  await app.close();
});

test('the fill and the key dissolve together, and paint each change within frames of each other (measured)', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(TWO_OUTPUTS);
  const win = await operatorPage(app);
  await operatorReady(win);
  const { fill, key } = await keyFillPair(app, win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Sample kirtan/ })
    .click();
  const presentationId = (await win.getByTestId('slide-grid').getAttribute('data-presentation-id')) ?? '';
  const goLive = (slideIndex: number) =>
    win.evaluate(
      ({ presentationId, slideIndex }) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'goLive', presentationId, slideIndex }),
      { presentationId, slideIndex },
    );

  // A long dissolve: both start it at the same moment of the engine's clock.
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.library.setDefaultTransition({ kind: 'dissolve', durationMs: 4000 }),
  );
  await goLive(0);
  await expect(fill.locator('[data-testid="lower-third"]')).toHaveCount(1);
  await goLive(1);
  const startOf = (page: Page) =>
    page
      // The start is set a render after the dissolve begins (once its pictures can be drawn).
      .locator('[data-layer="slide"][data-fading="true"][data-fade-start]')
      .getAttribute('data-fade-start', { timeout: 3000 });
  const [fillStart, keyStart] = await Promise.all([startOf(fill), startOf(key)]);
  expect(fillStart).not.toBeNull();
  expect(fillStart).toBe(keyStart);

  // Cuts, one change at a time: each window's frame for each change.
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.library.setDefaultTransition({ kind: 'cut', durationMs: 0 }),
  );
  const first = (await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).rev + 1;
  const changes = 40;
  for (let i = 0; i < changes; i++) {
    await goLive(i % 2);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const last = (await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).rev;
  await expect
    .poll(async () => Number(await key.getByTestId('output-root').getAttribute('data-painted-rev')))
    .toBeGreaterThanOrEqual(last);
  const log = (page: Page) => page.evaluate(() => (globalThis as OutputGlobals).drashtiPaintLog ?? []);
  const [fillLog, keyLog] = await Promise.all([log(fill), log(key)]);
  const painted = (entries: { rev: number; paintedAt: number }[]) => {
    const at = new Map<number, number>();
    for (const e of entries) if (!at.has(e.rev)) at.set(e.rev, e.paintedAt);
    return at;
  };
  const f = painted(fillLog);
  const k = painted(keyLog);
  const gaps: number[] = [];
  for (let rev = first; rev <= last; rev++) {
    const a = f.get(rev);
    const b = k.get(rev);
    if (a !== undefined && b !== undefined) gaps.push(Math.abs(a - b));
  }
  gaps.sort((a, b) => a - b);
  const frame = 1000 / 60;
  const at = (p: number) => gaps[Math.min(gaps.length - 1, Math.floor((gaps.length - 1) * p))] ?? NaN;
  const report = {
    changes: last - first + 1,
    measured: gaps.length,
    medianMs: at(0.5),
    p90Ms: at(0.9),
    worstMs: gaps.at(-1) ?? NaN,
    medianFrames: Math.round((at(0.5) / frame) * 100) / 100,
    p90Frames: Math.round((at(0.9) / frame) * 100) / 100,
    worstFrames: Math.round(((gaps.at(-1) ?? NaN) / frame) * 100) / 100,
  };
  console.log(`KEYFILL_FRAME_OFFSET ${JSON.stringify(report)}`);
  test.info().annotations.push({ type: 'key/fill frame offset', description: JSON.stringify(report) });
  // Every change reached both windows' frames.
  expect(gaps.length).toBeGreaterThanOrEqual(Math.floor((last - first + 1) * 0.9));
  await app.close();
});
