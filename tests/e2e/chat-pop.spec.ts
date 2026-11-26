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
      // Chat chosen for Simple Mode, so a click opens it there too (QA24-CHATPOP-2 = B); without it: the last test.
      expect(
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setSimpleFeature('chat', true)),
      ).toEqual({ ok: true, chosen: ['chat'] });
      await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
      await expect(win.getByTestId('simple-mode')).toHaveCount(1);
    } else {
      // The quick bar's one row full of pinned show buttons (Pro Mode's only): the popup lies over none of them.
      const pinned = await win.evaluate(async () => {
        const d = (globalThis as PageGlobals).drashti;
        const pins: { kind: 'message'; templateId: string; label: string }[] = [];
        for (let i = 1; i <= 8; i++) {
          const made = await d.messages.create({
            name: `Placeholder pin ${String(i)}`,
            template: `Placeholder pinned words ${String(i)}`,
            fields: {},
          });
          if (!made.ok) throw new Error(made.message);
          pins.push({ kind: 'message', templateId: made.id, label: `Placeholder pin ${String(i)}` });
        }
        return d.quickBar.set(pins);
      });
      expect(pinned.ok).toBe(true);
      await expect(win.getByTestId('quick-pin')).toHaveCount(8);
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
    // Just above the show controls the window has at its foot: Pro Mode's quick bar over its bar of clears, together.
    const controls = await (simple ? bar : win.getByTestId('quick-bar')).boundingBox();
    const middle = await win.getByTestId('column-middle').boundingBox();
    const viewport = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(box).not.toBeNull();
    expect(controls).not.toBeNull();
    expect(middle).not.toBeNull();
    if (!box || !controls || !middle) throw new Error('Popup, controls or middle column missing');
    expect(box.y + box.height).toBeLessThanOrEqual(controls.y);
    expect(controls.y - box.y - box.height).toBeLessThanOrEqual(12);
    // Centred over the middle of the window (the owner's "in middle screen"), inside the middle column.
    expect(Math.abs(box.x + box.width / 2 - (middle.x + middle.width / 2))).toBeLessThanOrEqual(1);
    expect(box.x).toBeGreaterThanOrEqual(middle.x);
    expect(box.x + box.width).toBeLessThanOrEqual(middle.x + middle.width);
    // Over nothing the operator presses: no pin, no show button, neither side column (the left one's Undo at its foot,
    // the live column's notices at its).
    expect(
      await win.evaluate(() => {
        const card = document.querySelector('[data-testid="chat-pop"]')?.getBoundingClientRect();
        if (!card) return ['no popup'];
        const parts = document.querySelectorAll(
          '[data-testid="quick-pin"], [data-testid="layer-bar"] button, [data-testid="simple-buttons"] button, [data-testid="column-left"], [data-testid="column-right"]',
        );
        return [...parts]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.width > 0 &&
              r.left < card.right &&
              card.left < r.right &&
              r.top < card.bottom &&
              card.top < r.bottom
            );
          })
          .map((el) => `${el.getAttribute('data-testid') ?? 'a button'} ${el.textContent.trim()}`);
      }),
    ).toEqual([]);
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
    if (!simple) {
      // While a popup is up, the pin nearest its middle still takes a click and puts its message up; Chat stays folded.
      await send('Placeholder over the pins');
      await expect(pop).toBeVisible();
      const nearest = await win.evaluate(() => {
        const card = document.querySelector('[data-testid="chat-pop"]')?.getBoundingClientRect();
        if (!card) return -1;
        const mid = card.left + card.width / 2;
        let best = -1;
        let far = Infinity;
        document.querySelectorAll('[data-testid="quick-pin"]').forEach((pin, i) => {
          const r = pin.getBoundingClientRect();
          const d = Math.abs(r.left + r.width / 2 - mid);
          if (d < far) [best, far] = [i, d];
        });
        return best;
      });
      expect(nearest).toBeGreaterThanOrEqual(0);
      await win.getByTestId('quick-pin').nth(nearest).click();
      await expect
        .poll(async () => (await engine(win)).state.layers.messages.map((m) => m.text))
        .toEqual([`Placeholder pinned words ${String(nearest + 1)}`]);
      await expect(win.getByTestId('group-chat-toggle')).toHaveAttribute('aria-expanded', 'false');
    }
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
    // The real lifetime and reduced-motion rule; no change to the engine or chat clock. Timed inside the page, on the
    // app's own clock (review S1): when the popup comes and goes there, against the time Main gave the message.
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await win.evaluate(() => {
      const times: { shown?: number; gone?: number } = {};
      (globalThis as typeof globalThis & { popTimes?: typeof times }).popTimes = times;
      const up = () => document.querySelector('[data-testid="chat-pop"]') !== null;
      new MutationObserver((_, watching) => {
        if (times.shown === undefined) {
          if (up()) times.shown = Date.now();
        } else if (!up()) {
          times.gone = Date.now();
          watching.disconnect();
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await send('Placeholder no fade');
    await expect(pop).toBeVisible();
    expect(await pop.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
    await expect(pop).toHaveCount(0, { timeout: 12_000 });
    const times = await win.evaluate(async () => {
      const { shown, gone } =
        (globalThis as typeof globalThis & { popTimes?: { shown?: number; gone?: number } }).popTimes ?? {};
      const view = await (globalThis as PageGlobals).drashti.chat.view();
      const sent = view.messages.find((m) => m.text === 'Placeholder no fade')?.at;
      return { shown, gone, sent: sent === undefined ? undefined : Date.parse(sent) };
    });
    if (times.shown === undefined || times.gone === undefined || times.sent === undefined)
      throw new Error(`The popup's times were not all seen: ${JSON.stringify(times)}`);
    // Never gone before 10 s from the message's arrival (with no fade, gone at once then), and up on screen for 9 s
    // of it at least, however late the page drew it.
    expect(times.gone - times.sent).toBeGreaterThanOrEqual(10_000);
    expect(times.gone - times.shown).toBeGreaterThanOrEqual(9_000);
    await app.close();
  });
}

/** Two frames on: what a change set off (its effects) has happened, so a thing not there now is not coming. */
const settled = (win: Page) =>
  win.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );

test('a popup click opens Chat only where it is this mode’s: in Simple Mode without Chat it only closes, a click never carries over to the other mode, and an old click never unfolds Chat again', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const { port } = await networkOn(win);
  const token = await pairToken(win, port, 'remote', 'Placeholder phone');
  expect(
    (await apiCall(port, CHAT_API.name, { method: 'POST', token, body: { name: 'Placeholder Sender' } }))
      .status,
  ).toBe(200);
  const pop = win.getByTestId('chat-pop');
  const chat = win.getByTestId('section-chat');
  const send = async (text: string) =>
    expect((await apiCall(port, CHAT_API.send, { method: 'POST', token, body: { text } })).status).toBe(200);
  const setMode = async (mode: 'pro' | 'simple') => {
    await win.evaluate((m) => (globalThis as PageGlobals).drashti.app.setMode(m), mode);
    await expect(win.getByTestId('simple-mode')).toHaveCount(mode === 'simple' ? 1 : 0);
    await expect(win.getByTestId(mode === 'simple' ? 'simple-buttons' : 'layer-bar')).toBeVisible();
  };
  // Simple Mode with Chat not chosen: the popup comes as in Pro Mode, and a click only closes it.
  await setMode('simple');
  await expect(chat).toHaveCount(0);
  await send('Placeholder in Simple Mode');
  await expect(pop).toContainText('Placeholder in Simple Mode');
  await win.getByTestId('chat-pop-open').click();
  await expect(pop).toHaveCount(0);
  await settled(win);
  await expect(chat).toHaveCount(0);
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.simpleFeatures())).toEqual([]);
  // Pro Mode: Chat folded as at each start (nothing from Simple Mode's click), and a click opens it.
  await setMode('pro');
  const toggle = win.getByTestId('group-chat-toggle');
  await settled(win);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await send('Placeholder in Pro Mode');
  await expect(pop).toContainText('Placeholder in Pro Mode');
  await win.getByTestId('chat-pop-open').click();
  await expect(pop).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // The operator folds it again.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // Back in Simple Mode, that click never adds Chat there.
  await setMode('simple');
  await settled(win);
  await expect(chat).toHaveCount(0);
  // And in Pro Mode again Chat is as the operator left it, folded: an old click never unfolds it again.
  await setMode('pro');
  await settled(win);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await app.close();
});
