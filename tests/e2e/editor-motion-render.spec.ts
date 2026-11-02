import { expect, test, type Page } from '@playwright/test';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import {
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  outputPages,
  type PageGlobals,
  setUpScreen,
  windowShowing,
} from './helpers';
import { launchMain, launchNode, pairNode } from './nodes';
import { goLive, holdClock, makeSlides } from './placeholder-slides';

async function animatedWords(win: Page, motion: Record<string, unknown>): Promise<string> {
  const id = await makeSlides(
    win,
    'Placeholder shared element motion',
    [{ words: 'Placeholder moving words', wordsColor: '#ffffff', background: '#123456' }],
    { kind: 'cut', durationMs: 0 },
  );
  await win.evaluate(
    async ({ id, motion }) => {
      const d = (globalThis as PageGlobals).drashti;
      const opened = await d.library.slidesForEdit(id);
      if (!opened.ok) throw new Error(opened.message);
      for (const slide of opened.doc.groups.flatMap((g) => g.slides))
        for (const el of slide.elements) Object.assign(el, { motion });
      const saved = await d.library.saveSlides(id, opened.doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
    },
    { id, motion },
  );
  return id;
}

const phases = {
  in: { kind: 'fade', delayMs: 0, durationMs: 1000 },
  emphasis: { kind: 'pulse', delayMs: 1000, durationMs: 1000 },
  out: { kind: 'fade', delayMs: 3000, durationMs: 1000 },
};
const moving = (page: Page) => page.locator('[data-layer="slide"] [data-element-motion]').first();

test('element motion uses the same held engine frame on the hall and the stream, including Camera layout and a reload', async () => {
  const { app } = await launchApp({ DRASHTI_TEST_CLOCK_HOLD: '1', DRASHTI_TEST_FAKE_DEVICES: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  try {
    const id = await animatedWords(win, phases);
    await setUpScreen(win);
    const hall = await outputPage(app);
    await outputReady(hall);
    await win.getByTestId('open-stream').click();
    const program = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
    await expect(program.getByTestId('program-root')).toBeVisible();
    await goLive(win, id, 0);
    const shownAt = await win.evaluate(
      async () =>
        (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide?.shownAt ?? 0,
    );
    for (const [elapsed, opacity] of [
      [500, 0.5],
      [1000, 1],
      [3500, 0.5],
      [4500, 0],
    ] as const) {
      expect(await holdClock(app, shownAt + elapsed)).toBeGreaterThanOrEqual(2);
      for (const page of [hall, program]) {
        await expect(moving(page)).toHaveCount(1);
        await expect(moving(page)).toHaveAttribute('data-motion-at', String(elapsed));
        await expect(moving(page)).toHaveCSS('opacity', String(opacity));
      }
    }
    await holdClock(app, shownAt + 1500);
    for (const page of [hall, program])
      await expect
        .poll(() => moving(page).evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a))
        .toBeGreaterThan(1.05);
    await program.reload();
    await expect(program.getByTestId('program-root')).toBeVisible();
    await holdClock(app, shownAt + 3500);
    await expect(moving(program)).toHaveCSS('opacity', '0.5');
    const status = await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
    expect(status.live.since).toBeNull();
    expect(status.recording.since).toBeNull();
  } finally {
    await app.close();
  }
});

test('a node keeps the element timeline and draws its held entrance and exit like Main', async () => {
  test.setTimeout(180_000);
  const main = await launchMain({ DRASHTI_TEST_CLOCK_HOLD: '1' });
  const node = await launchNode({ DRASHTI_TEST_CLOCK_HOLD: '1', DRASHTI_TEST_CLOCK_SKEW_MS: '4000' });
  try {
    const nodeId = await pairNode(main, node);
    await setUpScreen(main.win, 'Placeholder motion hall', 1);
    const groupId = await main.win.evaluate(
      async () =>
        (await (globalThis as PageGlobals).drashti.screens.get()).groups.find(
          (g) => g.name === 'Placeholder motion hall',
        )?.id ?? '',
    );
    const displays = () =>
      main.win.evaluate(
        async (id) =>
          (
            (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((n) => n.id === id)
              ?.displays ?? []
          ).map((d) => d.id),
        nodeId,
      );
    await expect.poll(async () => (await displays()).length).toBeGreaterThanOrEqual(2);
    const displayId = (await displays())[1] ?? -1;
    const assigned = await main.win.evaluate(
      ({ groupId, nodeId, displayId }) =>
        (globalThis as PageGlobals).drashti.screens.assignNodeDisplay(groupId, nodeId, displayId),
      { groupId, nodeId, displayId },
    );
    expect(assigned.ok).toBe(true);
    await expect.poll(() => outputPages(node.app).length).toBeGreaterThan(0);
    const outputs = [await outputPage(main.app), await outputPage(node.app)];
    for (const page of outputs) await outputReady(page);
    const id = await animatedWords(main.win, phases);
    await goLive(main.win, id, 0);
    for (const page of outputs) await expect(moving(page)).toHaveCount(1);
    const shownAt = await main.win.evaluate(
      async () =>
        (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide?.shownAt ?? 0,
    );
    for (const [elapsed, opacity] of [
      [500, 0.5],
      [3500, 0.5],
      [4500, 0],
    ] as const) {
      await holdClock(main.app, shownAt + elapsed);
      await holdClock(node.app, shownAt + elapsed);
      for (const page of outputs) {
        await expect(moving(page)).toHaveAttribute('data-motion-at', String(elapsed));
        await expect(moving(page)).toHaveCSS('opacity', String(opacity));
      }
    }
  } finally {
    await node.app.close();
    await main.app.close();
  }
});

for (const engine of ['webkit', 'chromium'] as const)
  test(`the phone paints the slide’s fade from Main’s timestamp, with the same progress (${engine})`, async () => {
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const phone = await device(engine);
    try {
      const id = await animatedWords(win, { in: { kind: 'fade', delayMs: 0, durationMs: 60_000 } });
      await setUpScreen(win);
      const hall = await outputPage(app);
      await outputReady(hall);
      const { base } = await networkOn(win);
      await pairByQr(
        phone.page,
        base,
        await pairingCode(win, 'remote', 'Placeholder motion phone'),
        '/remote',
      );
      await expect(phone.page.getByTestId('remote-live')).toBeVisible();
      await goLive(win, id, 0);
      for (const page of [hall, phone.page]) await expect(moving(page)).toHaveCount(1);
      await expect
        .poll(async () => Number(await moving(hall).getAttribute('data-motion-at')))
        .toBeGreaterThanOrEqual(2000);
      const read = (page: Page) =>
        moving(page).evaluate((el) => ({
          at: Number(el.getAttribute('data-motion-at')),
          opacity: Number(getComputedStyle(el).opacity),
        }));
      const [a, b] = await Promise.all([read(hall), read(phone.page)]);
      for (const frame of [a, b]) {
        expect(frame.at).toBeGreaterThanOrEqual(0);
        expect(frame.at).toBeLessThan(60_000);
        expect(frame.opacity).toBeCloseTo(frame.at / 60_000, 4);
      }
      expect(Math.abs(a.at - b.at)).toBeLessThan(1000);
      expect(Math.abs(a.opacity - b.opacity)).toBeLessThan(0.02);
    } finally {
      await phone.close();
      await app.close();
    }
  });
