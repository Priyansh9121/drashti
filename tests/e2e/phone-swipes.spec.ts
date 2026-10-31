import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { device, type Engine, networkOn, NETWORK_ENV, pairByQr, pairingCode } from './devices';
import { holdStill, launchApp, letTimePass, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { setUpPlaceholderShow } from './placeholder-show';

/*
 * Swipes on the phone's live picture (Session 55, Part 9): the finger moving left is Next and moving right is Back,
 * like turning a page; two fingers (zooming) never count as a swipe, nor a drag up or down (the page scrolls); the
 * Back and Next buttons stay. In Chrome's engine the fingers are a touch screen's own (Chromium's input, so the page's
 * touch-action is as a phone's); in Safari's, the pointer events a phone's touches make (Playwright has no second
 * finger of its own there). Placeholder content only.
 */

const snapshot = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

const slideNow = async (win: Page) => (await snapshot(win)).layers.slide?.slideIndex ?? null;

/** The middle of the live picture, in the page's pixels. */
async function middle(p: Page): Promise<{ x: number; y: number; width: number }> {
  const box = await p.getByTestId('remote-live').boundingBox();
  if (!box) throw new Error('no live picture');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width };
}

/**
 * Fingers on the live picture, each from its start by (dx, dy) in eight moves over about 200 ms: a touch screen's own
 * in Chrome's engine, the pointer events a phone's touches make in Safari's.
 */
async function fingers(
  p: Page,
  engine: Engine,
  starts: { x: number; y: number }[],
  dx: number[],
  dy: number[],
): Promise<void> {
  const STEPS = 8;
  const at = (i: number, step: number) => ({
    x: (starts[i]?.x ?? 0) + ((dx[i] ?? 0) * step) / STEPS,
    y: (starts[i]?.y ?? 0) + ((dy[i] ?? 0) * step) / STEPS,
  });
  if (engine === 'chromium') {
    const cdp = await p.context().newCDPSession(p);
    const points = (step: number) => starts.map((_, i) => ({ ...at(i, step), id: i }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) });
    for (let step = 1; step <= STEPS; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(step) });
      await letTimePass(p, 25, 'a finger moves through its 200 ms swipe');
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    return;
  }
  const fire = (type: string, step: number) =>
    p.getByTestId('remote-live').evaluate(
      (el, { starts, dx, dy, steps, step, type }) => {
        starts.forEach((start, id) => {
          const clientX = start.x + ((dx[id] ?? 0) * step) / steps;
          const clientY = start.y + ((dy[id] ?? 0) * step) / steps;
          const target = document.elementFromPoint(clientX, clientY) ?? el;
          target.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 100 + id,
              pointerType: 'touch',
              isPrimary: id === 0,
              clientX,
              clientY,
              bubbles: true,
              cancelable: true,
            }),
          );
        });
      },
      { starts, dx, dy, steps: STEPS, step, type },
    );
  await fire('pointerdown', 0);
  for (let step = 1; step <= STEPS; step++) {
    await fire('pointermove', step);
    await letTimePass(p, 25, 'a finger moves through its 200 ms swipe');
  }
  await fire('pointerup', STEPS);
}

for (const engine of ['chromium', 'webkit'] as const satisfies readonly Engine[])
  test(`a swipe on the phone’s live picture turns the page (${engine === 'webkit' ? 'Safari’s' : 'Chrome’s'} engine): to the left is Next, to the right is Back; two fingers never, nor a drag up or down; the buttons stay`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    try {
      await p.setViewportSize({ width: 375, height: 812 });
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      // The kirtan up at its second slide, from its row.
      await win.evaluate(
        async ({ kirtanId, playlistId }) => {
          const d = (globalThis as PageGlobals).drashti;
          const item = (await d.playlists.items(playlistId)).find(
            (i) => i.kind === 'presentation' && i.presentationId === kirtanId,
          );
          await d.engine.dispatch({
            type: 'goLive',
            presentationId: kirtanId,
            slideIndex: 1,
            playlist: item ? { playlistId, itemId: item.id } : null,
          });
        },
        { kirtanId: show.kirtanId, playlistId: show.playlistId },
      );
      await expect.poll(() => slideNow(win)).toBe(1);
      const m = await middle(p);
      const reach = Math.round(m.width * 0.4);

      // The finger moving left: Next.
      await fingers(p, engine, [{ x: m.x + reach / 2, y: m.y }], [-reach], [0]);
      await expect.poll(() => slideNow(win)).toBe(2);
      // Moving right: Back.
      await fingers(p, engine, [{ x: m.x - reach / 2, y: m.y }], [reach], [0]);
      await expect.poll(() => slideNow(win)).toBe(1);

      // Two fingers coming together (zooming out, which a page already whole leaves as it is), the second moving well
      // to the left: never a swipe.
      await fingers(
        p,
        engine,
        [
          { x: m.x - 60, y: m.y },
          { x: m.x + 60, y: m.y },
        ],
        [0, -100],
        [0, 0],
      );
      // A drag mostly up or down: the page's own scroll, never a swipe.
      await fingers(p, engine, [{ x: m.x, y: m.y + 40 }], [-30], [-120]);
      // A moment for anything that would have gone through.
      await holdStill(
        async () => (await slideNow(win)) === 1,
        700,
        'two fingers and vertical gestures never turn the page',
      );
      expect(await slideNow(win)).toBe(1);

      // The buttons stay, and still turn it.
      await expect(p.getByTestId('remote-back')).toBeVisible();
      await expect(p.getByTestId('remote-next-button')).toBeVisible();
      await p.getByTestId('remote-next-button').click();
      await expect.poll(() => slideNow(win)).toBe(2);
      // And a tap on the picture still looks closer.
      await p.getByTestId('remote-live').tap();
      await expect(p.getByTestId('viewer')).toBeVisible();
    } finally {
      await phone.close();
    }
    await app.close();
  });
