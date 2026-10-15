import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { Movement } from '../../src/shared/looks';
import { apiCall, NETWORK_ENV, networkOn, pairToken } from './devices';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, outputPage, setUpScreen } from './helpers';
import { engineState, holdClock } from './placeholder-slides';

/*
 * A message banner's and the ticker band's entrance (Session 27, the design lab's): Calm fades in in place,
 * Bold rises in from its edge, both timed by the engine's clock from when it went up. Changing a message's
 * words, another message joining, or another announcement joining the ticker never plays it again. Outputs
 * held at moments (a test switch) show it part-way. Placeholder words only.
 */

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

const setMovement = (win: Page, movement: Movement) =>
  win.evaluate(async (movement) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.role === 'audience')?.id ?? '';
    const set = await d.looks.setGroup((await d.engine.snapshot()).state.look.id, group, { movement });
    if (!set.ok) throw new Error(set.message);
  }, movement);

/** An element's entrance as it is drawn now: how far in (ms; '' when in place), its opacity and transform. */
const entering = (out: Page, selector: string) =>
  out.locator(selector).evaluate((el) => ({
    at: el.getAttribute('data-entrance-at') ?? '',
    opacity: (el as HTMLElement).style.opacity,
    transform: (el as HTMLElement).style.transform,
  }));

test('a message banner comes in from when it went up, Calm and Bold; an update or another message never plays it again', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_TEST_CLOCK_HOLD: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  const banner = '[data-layer="messages"]';
  for (const movement of ['calm', 'bold'] as const) {
    await setMovement(win, movement);
    await expect(out.getByTestId('output-root')).toHaveAttribute('data-movement', movement);
    await holdClock(app, Date.now() - 60_000);
    await dispatch(win, { type: 'showMessage', message: { id: 'm1', text: 'Placeholder message one' } });
    const shownAt = (await engineState(win)).layers.messages[0]?.shownAt ?? 0;
    expect(shownAt).toBeGreaterThan(0);
    await holdClock(app, shownAt + 100);
    await expect.poll(async () => (await entering(out, banner)).at).toBe('100');
    const part = await entering(out, banner);
    expect(Number(part.opacity)).toBeGreaterThan(0);
    expect(Number(part.opacity)).toBeLessThan(1);
    if (movement === 'bold') expect(part.transform, 'Bold rises in from below').toMatch(/^translateY\(\d/u);
    else expect(part.transform, 'Calm fades in place').toBe('');
    await holdClock(app, shownAt + 1000);
    await expect.poll(async () => (await entering(out, banner)).at).toBe('');
    // New words for it, and a second message joining, well after its entrance (real time): nothing comes in
    // again (a replay would show, 100 ms in).
    await win.waitForTimeout(400);
    await dispatch(win, { type: 'showMessage', message: { id: 'm1', text: 'Placeholder message changed' } });
    await dispatch(win, { type: 'showMessage', message: { id: 'm2', text: 'Placeholder message two' } });
    const messages = (await engineState(win)).layers.messages;
    expect(messages.find((m) => m.id === 'm1')?.shownAt).toBe(shownAt);
    const joined = messages.find((m) => m.id === 'm2')?.shownAt ?? 0;
    await holdClock(app, joined + 100);
    await expect(out.locator(banner)).toContainText('Placeholder message changed');
    expect(await entering(out, banner)).toEqual({ at: '', opacity: '', transform: '' });
    await holdClock(app, null);
    await dispatch(win, { type: 'hideMessage', messageId: 'm1' });
    await dispatch(win, { type: 'hideMessage', messageId: 'm2' });
    await expect(out.locator(banner)).toHaveCount(0);
  }
  await app.close();
});

test('the ticker’s band comes in once, from its own time; another announcement starts the words again but not the band', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({
    ...NETWORK_ENV,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_TEST_CLOCK_HOLD: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  await setMovement(win, 'bold');
  const { port } = await networkOn(win);
  const token = await pairToken(win, port, 'announcements', 'Placeholder poster');
  const announce = async (text: string) => {
    const sent = await apiCall(port, '/api/v1/announcements', {
      method: 'POST',
      token,
      body: { text, from: 'Placeholder poster', minutes: 10 },
    });
    expect(sent.status).toBe(202);
    const id = (sent.json['announcement'] as { id: string }).id;
    const approved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.announcements.approve({ id, as: 'ticker' }),
      id,
    );
    expect(approved.ok).toBe(true);
  };
  await holdClock(app, Date.now() - 60_000);
  await announce('Placeholder announcement one');
  const first = (await engineState(win)).layers.ticker;
  expect(first?.shownAt).toBe(first?.startedAt);
  await holdClock(app, (first?.shownAt ?? 0) + 120);
  await expect.poll(async () => (await entering(out, '[data-layer="ticker"]')).at).toBe('120');
  const part = await entering(out, '[data-layer="ticker"]');
  expect(Number(part.opacity)).toBeLessThan(1);
  expect(part.transform, 'Bold rises in from below').toMatch(/^translateY\(\d/u);
  // Another joins: the words start again from the right, the band stays where it is.
  await holdClock(app, (first?.shownAt ?? 0) + 2000);
  await win.waitForTimeout(400);
  await announce('Placeholder announcement two');
  const second = (await engineState(win)).layers.ticker;
  expect(second?.startedAt).toBeGreaterThan(first?.startedAt ?? 0);
  expect(second?.shownAt).toBe(first?.shownAt);
  await holdClock(app, (second?.startedAt ?? 0) + 120);
  await expect(out.getByTestId('ticker-words')).toHaveAttribute('data-started-at', String(second?.startedAt));
  expect(await entering(out, '[data-layer="ticker"]')).toEqual({ at: '', opacity: '', transform: '' });
  await holdClock(app, null);
  await app.close();
});
