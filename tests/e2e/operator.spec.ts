import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage } from './helpers';
import { KIRTAN, setUpPlaceholderShow } from './placeholder-show';

async function outputPage(app: ElectronApplication): Promise<Page> {
  const existing = app.windows().find((w) => w.url().includes('output.html'));
  if (existing) return existing;
  return app.waitForEvent('window', { predicate: (w) => w.url().includes('output.html') });
}

async function oneScreen(win: Page): Promise<void> {
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const created = await d.screens.createGroup('Main Hall');
    if (!created.ok) throw new Error(created.message);
    const assigned = await d.screens.assignDisplay(
      created.snapshot.groups[0]?.id ?? '',
      created.snapshot.displays[0]?.id ?? -1,
      { coverOperator: true },
    );
    if (!assigned.ok) throw new Error(assigned.message);
  });
}

const engineRev = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).rev);

test('operator: pick a presentation, go live by click and keyboard, clear layers, black-out', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const list = win.getByTestId('presentation-list');
  await expect(list.getByRole('button')).toHaveCount(2);
  await oneScreen(win);
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');

  const latencies: number[] = [];
  /** Wait until the output has painted the engine's current revision, and note how long it took. */
  const outputCaughtUp = async () => {
    const rev = await engineRev(win);
    await expect(output.getByTestId('output-root')).toHaveAttribute('data-painted-rev', String(rev));
    latencies.push(Number(await output.getByTestId('output-root').getAttribute('data-latency-ms')));
  };

  // The first presentation is selected; its three slides are shown as thumbnails.
  await list.getByRole('button', { name: /Language test slides/ }).click();
  const thumbs = win.getByTestId('slide-thumb');
  await expect(thumbs).toHaveCount(3);

  // Click slide 2: it goes live everywhere.
  await thumbs.nth(1).click();
  await expect(win.getByTestId('live-text')).toHaveText('Live: Language test slides · slide 2 of 3');
  await expect(thumbs.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(output.locator('[data-lang="en"]')).toHaveText('Second test slide');
  await outputCaughtUp();

  // Arrow keys and space move through the slides, and stop at the end.
  await win.keyboard.press('ArrowRight');
  await expect(output.locator('[data-lang="en"]')).toHaveText('Third test slide');
  await outputCaughtUp();
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('Space');
  await expect(win.getByTestId('live-text')).toHaveText('Live: Language test slides · slide 3 of 3');
  await win.keyboard.press('ArrowLeft');
  await expect(win.getByTestId('live-text')).toHaveText('Live: Language test slides · slide 2 of 3');
  await outputCaughtUp();

  // Clear the slide (F2): the output empties but the cursor stays, so Next continues.
  await win.keyboard.press('F2');
  await expect(win.getByTestId('live-text')).toHaveText(
    'Live: Language test slides · slide 2 of 3 (cleared)',
  );
  await expect(output.locator('[data-layer="slide"]')).toHaveCount(0);
  await outputCaughtUp();
  await win.keyboard.press('ArrowRight');
  await expect(output.locator('[data-lang="en"]')).toHaveText('Third test slide');

  // Black-out (B) covers everything and comes off again without losing the slide.
  await win.keyboard.press('b');
  await expect(output.getByTestId('blackout')).toHaveCount(1);
  await expect(win.getByTestId('blackout-button')).toHaveAttribute('aria-pressed', 'true');
  await outputCaughtUp();
  await win.getByTestId('blackout-button').click();
  await expect(output.getByTestId('blackout')).toHaveCount(0);
  await expect(output.locator('[data-lang="en"]')).toHaveText('Third test slide');

  // Choosing another presentation and pressing Space starts it at slide 1.
  await list.getByRole('button', { name: /Sample kirtan/ }).click();
  await expect(thumbs).toHaveCount(3);
  await win.keyboard.press('Space');
  await expect(win.getByTestId('live-text')).toHaveText('Live: Sample kirtan (placeholder) · slide 1 of 3');
  await expect(output.locator('[data-lang="translit"]')).toHaveText('Namūnānī pahelī paṅkti');

  // A message and Clear all (F1) through the buttons and keys.
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'showMessage',
      message: { id: 'm', text: 'Car 123 please move' },
    }),
  );
  await expect(output.locator('[data-layer="messages"]')).toHaveText('Car 123 please move');
  await win.getByRole('button', { name: 'Clear messages' }).click();
  await expect(output.locator('[data-layer="messages"]')).toHaveCount(0);
  await win.keyboard.press('F1');
  await expect(output.locator('[data-layer]')).toHaveCount(0);
  // With nothing left to clear, Put it back takes Clear all's place until something goes up again.
  await expect(win.getByRole('button', { name: /Clear all/ })).toHaveCount(0);
  await win.getByTestId('put-back').click();
  await expect(output.locator('[data-layer="slide"]')).toBeVisible();
  await expect(win.getByRole('button', { name: /Clear all/ })).toBeEnabled();
  await win.keyboard.press('F1');
  await expect(output.locator('[data-layer]')).toHaveCount(0);

  // Keys typed into a field (here the Screens dialog) never drive the show.
  const before = await engineRev(win);
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await win.getByLabel('New group name').pressSequentially('B. F2 ');
  await win.getByLabel('New group name').press('ArrowRight');
  expect(await engineRev(win)).toBe(before);
  await win.getByRole('button', { name: 'Close screens' }).click();

  // Updates reach a painted frame on the output within one 60 Hz frame (16.7 ms) of leaving
  // the main process. The median must meet that; a rare scheduling hiccup is tolerated, a stall is not.
  const sorted = [...latencies].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? Infinity;
  const worst = sorted.at(-1) ?? Infinity;
  console.log(`output paint latency (ms): ${latencies.join(', ')}; median ${median}, worst ${worst}`);
  expect(median).toBeLessThanOrEqual(17);
  expect(worst).toBeLessThan(250);
  test.info().annotations.push({ type: 'output paint latency (ms)', description: latencies.join(', ') });
  await app.close();
});

/** The engine's messages reach the operator window 300 ms late, as on a busy machine. */
async function hearLate(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.webContents.getURL().includes('index.html')) continue;
      const contents = w.webContents;
      const send = contents.send.bind(contents);
      contents.send = (channel: string, ...args: unknown[]) => {
        if (channel === 'engine:message') setTimeout(() => send(channel, ...args), 300);
        else send(channel, ...args);
      };
    }
  });
}

test('Next pressed quickly goes on through what is live, even when the window hears of it late', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await setUpPlaceholderShow(win);
  await hearLate(app);
  // Space starts the kirtan; the arrows that follow at once go on through it, not back to its start.
  await win.getByTestId('presentation-list').getByRole('button', { name: KIRTAN }).click();
  await expect(win.getByTestId('slide-thumb')).toHaveCount(5);
  await win.keyboard.press('Space');
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('ArrowRight');
  await expect(win.getByTestId('live-text')).toContainText(`${KIRTAN} · slide 3 of 5`);
  await app.close();
});

test('in Simple Mode, the first quick Next starts the playlist and the ones after it go on through it', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await setUpPlaceholderShow(win);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-items').getByTestId('simple-item')).toHaveCount(3);
  await hearLate(app);
  // The welcome slide, then the kirtan's first and second slides.
  for (let i = 0; i < 3; i++) await win.keyboard.press('ArrowRight');
  await expect(win.getByTestId('live-text')).toContainText(`${KIRTAN} · slide 2 of 5`);
  await app.close();
});
