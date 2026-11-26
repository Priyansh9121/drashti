import { expect, test, type Page } from '@playwright/test';
import { CHAT_API } from '../../src/shared/chat';
import { apiCall, NETWORK_ENV, networkOn, pairToken } from './devices';
import {
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  setUpScreen,
  type PageGlobals,
} from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

const engine = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

for (const simple of [false, true]) {
  test(`chat popup: centred over show controls, focus and show keys kept, dismiss and open (${simple ? 'Simple' : 'Pro'})`, async () => {
    test.setTimeout(120_000);
    const { app } = await launchApp({
      ...NETWORK_ENV,
      DRASHTI_WINDOWED_OUTPUTS: '1',
      DRASHTI_EXTRA_DISPLAYS: '1',
    });
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    await setUpScreen(win, 'Main Hall', 0);
    const stage = await setUpScreen(win, 'Stage', 1);
    await win.evaluate(async (screenId) => {
      const d = (globalThis as PageGlobals).drashti;
      const group = (await d.screens.get()).groups.find((g) =>
        g.screens.some((screen) => screen.id === screenId),
      );
      const result = await d.screens.setGroupRole(group?.id ?? '', 'stage');
      if (!result.ok) throw new Error(result.message);
    }, stage);
    await expect.poll(() => outputPages(app).length).toBe(2);
    for (const output of outputPages(app)) await outputReady(output);
    const { port } = await networkOn(win);
    const token = await pairToken(win, port, 'remote', 'Placeholder phone');
    expect(
      (await apiCall(port, CHAT_API.name, { method: 'POST', token, body: { name: 'Placeholder Sender' } }))
        .status,
    ).toBe(200);
    if (simple) {
      await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
      await expect(win.getByTestId('simple-mode')).toHaveCount(1);
    }
    const bar = win.getByTestId(simple ? 'simple-buttons' : 'layer-bar');
    await bar.locator('button:enabled').first().focus();
    const focused = await win.evaluate(() => {
      const el = document.activeElement;
      if (el) el.setAttribute('data-popup-focus', '');
      return !!el;
    });
    expect(focused).toBe(true);
    const send = async (text: string) =>
      expect((await apiCall(port, CHAT_API.send, { method: 'POST', token, body: { text } })).status).toBe(
        200,
      );
    await send('Placeholder incoming message');
    const pop = win.getByTestId('chat-pop');
    await expect(pop).toContainText('Chat from Placeholder Sender:');
    await expect(pop).toContainText('Placeholder incoming message');
    await expect(win.locator('[data-popup-focus]')).toBeFocused();
    const box = await pop.boundingBox();
    const controls = await bar.boundingBox();
    const viewport = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(box).not.toBeNull();
    expect(controls).not.toBeNull();
    if (!box || !controls) throw new Error('Popup or controls missing');
    expect(box.y + box.height).toBeLessThanOrEqual(controls.y);
    expect(controls.y - box.y - box.height).toBeLessThanOrEqual(12);
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    // A show key still reaches the engine while the popup is showing.
    const black = (await engine(win)).state.blackout;
    await win.keyboard.press('b');
    await expect.poll(async () => (await engine(win)).state.blackout).toBe(!black);
    await win.keyboard.press('b');
    await expect.poll(async () => (await engine(win)).state.blackout).toBe(black);
    // Audience and stage use their own renderer, with no popup or chat words.
    expect(outputPages(app).length).toBeGreaterThanOrEqual(2);
    for (const output of outputPages(app)) {
      await expect(output.getByTestId('chat-pop')).toHaveCount(0);
      await expect(output.locator('body')).not.toContainText('Placeholder incoming message');
    }
    await send('Placeholder newer message');
    await expect(pop).toContainText('Placeholder newer message');
    await expect(pop).toContainText('and 1 more');
    await win.getByTestId('chat-pop-dismiss').click();
    await expect(pop).toHaveCount(0);
    await expect(win.locator('[data-popup-focus]')).toBeFocused();
    await send('Placeholder open the chat');
    await expect(pop).toBeVisible();
    await win.getByTestId('chat-pop-open').click();
    await expect(pop).toHaveCount(0);
    await expect(win.getByTestId('group-chat-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(win.getByTestId('chat-text-box')).toBeVisible();
    await win.getByTestId('chat-text-box').fill('Placeholder operator reply');
    await win.getByTestId('chat-text-box').press('Enter');
    await expect(win.getByTestId('chat-text-box')).toHaveValue('');
    await expect(pop).toHaveCount(0);
    // The real lifetime and reduced-motion rule; no change to the engine or chat clock.
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await send('Placeholder no fade');
    await expect(pop).toBeVisible();
    expect(await pop.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
    const appeared = Date.now();
    await expect(pop).toHaveCount(0, { timeout: 12_000 });
    expect(Date.now() - appeared).toBeGreaterThanOrEqual(9_000);
    await app.close();
  });
}
