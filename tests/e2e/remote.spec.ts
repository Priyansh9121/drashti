import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, type Engine, networkOn, NETWORK_ENV, pairByQr, pairingCode, TABLET } from './devices';
import { launchApp, operatorPage, operatorReady, outputPage, type PageGlobals, setUpScreen } from './helpers';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow, WELCOME } from './placeholder-show';

/*
 * The phone remote runs a sabha, each step seen on a real output: a slide
 * tapped, Next and Back, Clear, black-out, the logo, Put it back, a timer
 * and a message. Next twice quickly goes on, never restarting an item. The
 * remote comes back by itself after the server stops and starts again.
 * Placeholder content; codes and tokens are made at run time.
 */

const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

/** Where the show is, as the engine says: the live presentation and slide position. */
async function where(win: Page) {
  const { state } = await snapshot(win);
  return { presentationId: state.live.presentationId, slideIndex: state.layers.slide?.slideIndex ?? null };
}

for (const engine of ['chromium', 'webkit'] as Engine[]) {
  test(`the remote runs a sabha on a real output (${engine})`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win);
    await win.evaluate((id) => (globalThis as PageGlobals).drashti.props.setLogo(id), show.logoPropId);
    await setUpScreen(win);
    const output = await outputPage(app);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      await expect(p.getByTestId('remote')).toBeVisible();
      await expectNoSeriousA11yIssues(p, `the remote on a phone (${engine})`);
      const size = p.viewportSize();
      await p.setViewportSize({ width: 375, height: 812 });
      await expectNoSeriousA11yIssues(p, `the remote at 375 x 812 (${engine})`);
      if (size) await p.setViewportSize(size);

      // Next twice quickly with nothing live: the first starts the playlist, the second goes on (never restarts it).
      await p.getByTestId('remote-tab-playlist').click();
      await expect(p.getByTestId('remote-playlist')).toHaveValue(show.playlistId);
      await expect(p.getByTestId('remote-item').filter({ hasText: KIRTAN })).toBeVisible();
      const nextButton = p.getByTestId('remote-next-button');
      await nextButton.click();
      await nextButton.click();
      await expect.poll(() => where(win)).toEqual({ presentationId: show.kirtanId, slideIndex: 0 });
      await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder chorus line');

      // A slide tapped goes up; Next and Back.
      await p.getByTestId('remote-tab-show').click();
      await p.getByTestId('remote-slide').nth(3).click();
      await expect.poll(() => where(win)).toEqual({ presentationId: show.kirtanId, slideIndex: 3 });
      await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder second verse');
      await expect(p.getByTestId('remote-slide').nth(3)).toHaveAttribute('data-live', 'true');
      await nextButton.click();
      await expect.poll(async () => (await where(win)).slideIndex).toBe(4);
      await p.getByTestId('remote-back').click();
      await expect.poll(async () => (await where(win)).slideIndex).toBe(3);

      // Clear the slide; Clear all, then Put it back.
      const actions = p.getByTestId('remote-actions');
      await actions.getByRole('button', { name: 'Clear slide' }).click();
      await expect(
        output.locator('[data-layer="slide"]', { hasText: 'Placeholder second verse' }),
      ).toHaveCount(0);
      await p.getByTestId('remote-slide').nth(2).click();
      await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder chorus line');
      await actions.getByRole('button', { name: 'Clear all' }).click();
      await expect.poll(async () => (await snapshot(win)).state.canPutBack).toBe(true);
      await actions.getByRole('button', { name: 'Put it back' }).click();
      await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder chorus line');

      // Black-out and the logo, on and off.
      await actions.getByRole('button', { name: 'Black-out' }).click();
      await expect(output.getByTestId('blackout')).toBeVisible();
      await expect(actions.getByRole('button', { name: 'Black-out' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await actions.getByRole('button', { name: 'Black-out' }).click();
      await expect(output.getByTestId('blackout')).toHaveCount(0);
      await actions.getByRole('button', { name: 'Logo' }).click();
      await expect(output.getByTestId('logo')).toContainText('Placeholder Mandir Logo');
      await actions.getByRole('button', { name: 'Logo' }).click();
      await expect(output.getByTestId('logo')).toHaveCount(0);

      // A timer started, paused and reset; a message filled in, shown and taken off.
      await p.getByTestId('remote-tab-more').click();
      const timer = p.getByTestId('remote-timer').first();
      await timer.getByRole('button', { name: 'Start' }).click();
      await expect.poll(async () => (await snapshot(win)).state.timers[0]?.startedAt ?? null).not.toBeNull();
      await timer.getByRole('button', { name: 'Pause' }).click();
      await expect.poll(async () => (await snapshot(win)).state.timers[0]?.startedAt).toBeNull();
      await timer.getByRole('button', { name: 'Reset' }).click();
      await expect.poll(async () => (await snapshot(win)).state.timers[0]?.elapsedMs ?? -1).toBe(0);
      const message = p.getByTestId('remote-message').first();
      await message.getByRole('button', { name: 'Show' }).click();
      await expect(p.getByRole('alert')).toContainText('Fill in {plate} first');
      await message.getByRole('textbox').fill('12');
      await message.getByRole('button', { name: 'Show' }).click();
      await expect(output.locator('[data-layer="messages"]')).toContainText('Car 12 please move');
      await message.getByRole('button', { name: 'Take off' }).click();
      await expect(output.locator('[data-layer="messages"]')).toHaveCount(0);

      // The server stops and starts again: the remote says so, comes back by itself and works.
      await win.evaluate(() => (globalThis as PageGlobals).drashti.network.setOn(false));
      await expect(p.getByTestId('connection')).toHaveAttribute('data-state', 'offline');
      await win.evaluate(() => (globalThis as PageGlobals).drashti.network.setOn(true));
      await expect(p.getByTestId('connection')).toHaveText('Connected', { timeout: 20_000 });
      await p.getByTestId('remote-tab-show').click();
      await nextButton.click();
      await expect.poll(async () => (await where(win)).slideIndex).toBe(3);
      expect(await win.evaluate(() => document.title)).not.toContain(code);
    } finally {
      await phone.close();
    }
    await app.close();
  });
}

test('the remote on a tablet shows the playlist beside the show, and an item tapped shows its slides', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder tablet');
  const tablet = await device('webkit', TABLET);
  try {
    await pairByQr(tablet.page, base, code, '/remote');
    const t = tablet.page;
    await expect(t.getByTestId('connection')).toHaveText('Connected');
    // Wide: no tabs; the playlist and the show side by side.
    await expect(t.getByTestId('remote-tab-show')).toHaveCount(0);
    await expect(t.getByTestId('remote-items')).toBeVisible();
    await t.getByTestId('remote-item').filter({ hasText: WELCOME }).click();
    await expect(t.getByTestId('remote-slides')).toBeVisible();
    await expect(t.getByRole('button', { name: 'Start this item' })).toBeVisible();
    await expect(t.getByTestId('remote-playlist')).toHaveText(new RegExp(PLAYLIST, 'u'));
    await expectNoSeriousA11yIssues(t, 'the remote on a tablet');
  } finally {
    await tablet.close();
  }
  await app.close();
});
