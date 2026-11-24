import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import type { SimpleFeature } from '../../src/shared/simple-features';
import { SIMPLE_FEATURES, SIMPLE_FEATURES_FULL } from '../../src/shared/simple-features';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, relaunchApp } from './helpers';
import { engineState } from './placeholder-slides';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Edit › Simple Mode Features… (alpha.22; the owner, 24 Nov 2026: "put a control of features for users who have access
 * to pro and simple mode. in edit, saying that the features can be brought to simple mode, only 1-2 and max 3. so that
 * the meaning of simple mode doesnt go away, the features can be toggled and can be brought to simple mode, like an on
 * and off button"): in Pro Mode only, an on/off switch for each of Pro Mode's tools under LIVE that Simple Mode lacks,
 * none on to begin with, up to three. In Simple Mode each chosen tool is its own folding section under Audio, folded
 * to begin with, with only what runs the show: its settings stay Pro Mode's, in the window and the main process.
 * Placeholder words only.
 */

const chosen = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.app.simpleFeatures());

const set = (win: Page, feature: SimpleFeature, on: boolean) =>
  win.evaluate(
    ([f, o]) => (globalThis as PageGlobals).drashti.app.setSimpleFeature(f, o),
    [feature, on] as const,
  );

async function setMode(win: Page, mode: 'pro' | 'simple'): Promise<void> {
  await win.evaluate((m) => (globalThis as PageGlobals).drashti.app.setMode(m), mode);
  await expect
    .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode()))
    .toBe(mode);
  await expect(win.getByTestId('simple-mode')).toHaveCount(mode === 'simple' ? 1 : 0);
}

const menuLabel = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, item) => Menu.getApplicationMenu()?.getMenuItemById(item)?.label ?? null, id);

/** Every section's fold button under LIVE, in the column's order, by its id. */
const sectionsIn = (live: Locator) =>
  live
    .getByTestId('live-rest')
    .locator('[data-testid^="group-"][data-testid$="-toggle"]')
    .evaluateAll((all) => all.map((el) => el.getAttribute('data-testid')));

test('Edit › Simple Mode Features… in Pro Mode: a line saying to keep it to a few, an on/off switch for each tool, none on to begin with, at most three; Simple Mode has no such item and cannot change it', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  expect(await chosen(win)).toEqual([]);
  // The item is Pro Mode's Edit menu's.
  expect(await menuLabel(app, 'simple-features')).toBe('Simple Mode Features…');
  await chooseMenuItem(app, 'simple-features');
  const dialog = win.getByTestId('simple-features-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Bring up to 3 of Pro Mode’s tools into Simple Mode.');
  await expect(dialog).toContainText('Keeping it to one or two keeps Simple Mode simple.');
  const switchOf = (id: SimpleFeature) => dialog.getByTestId(`simple-feature-${id}`);
  for (const f of SIMPLE_FEATURES) {
    await expect(dialog.getByRole('switch', { name: f.name, exact: true })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(switchOf(f.id)).toBeEnabled();
    await expect(dialog.getByText(f.line, { exact: true })).toBeVisible();
  }
  await expect(dialog.getByTestId('simple-features-full')).toHaveCount(0);
  await expectNoSeriousA11yIssues(win, 'Simple Mode Features, none on', '[data-testid="simple-features-dialog"]');

  // Two on, then a third: the rest then wait, saying why.
  await switchOf('messages').click();
  await expect(switchOf('messages')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => chosen(win)).toEqual(['messages']);
  await switchOf('picture-in-picture').click();
  await switchOf('timers').click();
  await expect.poll(() => chosen(win)).toEqual(['messages', 'timers', 'picture-in-picture']);
  await expect(dialog.getByTestId('simple-features-full')).toHaveText(SIMPLE_FEATURES_FULL);
  for (const f of SIMPLE_FEATURES) {
    const on = ['messages', 'timers', 'picture-in-picture'].includes(f.id);
    await expect(switchOf(f.id), f.id).toHaveAttribute('aria-checked', on ? 'true' : 'false');
    if (on) await expect(switchOf(f.id), f.id).toBeEnabled();
    else await expect(switchOf(f.id), f.id).toBeDisabled();
  }
  await expectNoSeriousA11yIssues(win, 'Simple Mode Features, three on', '[data-testid="simple-features-dialog"]');
  // A fourth asked for anyway (the main process keeps the rule too): refused, saying why.
  expect(await set(win, 'stage', true)).toEqual({ ok: false, message: SIMPLE_FEATURES_FULL });
  expect(await chosen(win)).toEqual(['messages', 'timers', 'picture-in-picture']);
  // One off: another can come on again.
  await switchOf('timers').click();
  await expect(switchOf('timers')).toHaveAttribute('aria-checked', 'false');
  await expect(switchOf('stage')).toBeEnabled();
  await expect(dialog.getByTestId('simple-features-full')).toHaveCount(0);
  await expect.poll(() => chosen(win)).toEqual(['messages', 'picture-in-picture']);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);

  // Simple Mode: no such item, and the choice is not its to change.
  await setMode(win, 'simple');
  await expect.poll(() => menuLabel(app, 'simple-features')).toBeNull();
  expect(await set(win, 'timers', true)).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  expect(await chosen(win)).toEqual(['messages', 'picture-in-picture']);
  await setMode(win, 'pro');
  await expect.poll(() => menuLabel(app, 'simple-features')).toBe('Simple Mode Features…');
  await app.close();
});

test('in Simple Mode each chosen tool is its own section under Audio, folded to begin with, in Pro Mode’s order, with only what runs the show; turned off in Pro Mode, gone; kept over a restart', async () => {
  test.setTimeout(150_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const live = win.getByRole('complementary', { name: 'Live', exact: true });
  const toggleOf = (id: string) => live.getByTestId(`group-${id}-toggle`);
  // A message made in Pro Mode, to show from Simple Mode.
  await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.messages.create({
      name: 'Placeholder notice',
      template: 'Placeholder notice words',
      fields: {},
    });
    if (!made.ok) throw new Error('could not make the placeholder message');
  });

  // Before anything is chosen, Simple Mode is as it was: Audio alone under LIVE.
  await setMode(win, 'simple');
  await expect(toggleOf('audio')).toBeVisible();
  expect(await sectionsIn(live)).toEqual(['group-audio-toggle']);
  await setMode(win, 'pro');

  // Two chosen in Pro Mode (Picture in Picture first: Simple Mode shows them in Pro Mode's order).
  expect(await set(win, 'picture-in-picture', true)).toEqual({ ok: true, chosen: ['picture-in-picture'] });
  expect(await set(win, 'messages', true)).toEqual({ ok: true, chosen: ['messages', 'picture-in-picture'] });
  await setMode(win, 'simple');
  await expect(toggleOf('messages')).toBeVisible();
  expect(await sectionsIn(live)).toEqual([
    'group-audio-toggle',
    'group-messages-toggle',
    'group-picture-in-picture-toggle',
  ]);
  for (const id of ['messages', 'picture-in-picture'])
    await expect(toggleOf(id), id).toHaveAttribute('aria-expanded', 'false');
  await expectNoSeriousA11yIssues(win, 'Simple Mode with two tools, folded', '[data-testid="live-rest"]');

  // Messages: Show and Take off; nothing to make, change, delete or pin.
  await toggleOf('messages').click();
  const messages = live.getByTestId('messages');
  const row = messages.getByTestId('message-row').filter({ hasText: 'Placeholder notice' });
  await expect(row).toBeVisible();
  await expect(messages.getByRole('button', { name: 'New message' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(row.getByTestId('message-pin')).toHaveCount(0);
  await row.getByRole('button', { name: 'Show', exact: true }).click();
  await expect.poll(async () => (await engineState(win)).layers.messages.length).toBe(1);
  await row.getByRole('button', { name: 'Take off' }).click();
  await expect.poll(async () => (await engineState(win)).layers.messages.length).toBe(0);
  // Its settings stay Pro Mode's in the main process too.
  expect(
    await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.messages.create({
        name: 'Placeholder other',
        template: 'Placeholder other words',
        fields: {},
      }),
    ),
  ).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });

  // Picture in Picture: its window from its section, the slides in the box, Swap and Take off under LIVE.
  await toggleOf('picture-in-picture').click();
  await live.getByTestId('pip-open').click();
  const pip = win.getByTestId('pip-dialog');
  await expect(pip).toBeVisible();
  await pip.getByTestId('pip-kind-slides').click();
  await expect(pip.getByTestId('pip-kind-slides')).toHaveAttribute('aria-checked', 'true');
  await pip.getByTestId('pip-show').click();
  await expect(pip).toHaveCount(0);
  await expect.poll(async () => (await engineState(win)).layers.pip?.source ?? null).toEqual({ kind: 'slides' });
  await win.getByTestId('live-pip-swap').click();
  await expect.poll(async () => (await engineState(win)).layers.pip?.swapped ?? null).toBe(true);
  await win.getByTestId('live-pip-take-off').click();
  await expect.poll(async () => (await engineState(win)).layers.pip ?? null).toBeNull();
  await expectNoSeriousA11yIssues(win, 'Simple Mode with two tools, open', '[data-testid="live-rest"]');

  // What was not chosen stays Pro Mode's.
  const refused = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    return {
      link: await d.liveLink.show('https://example.invalid/placeholder-live'),
      input: await d.engine.dispatch({ type: 'toggleInput', inputId: 'placeholder-input' }),
    };
  });
  expect(refused.link).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  expect(refused.input.ok).toBe(false);

  // Turned off in Pro Mode: gone from Simple Mode, and its box refused again.
  await setMode(win, 'pro');
  expect(await set(win, 'picture-in-picture', false)).toEqual({ ok: true, chosen: ['messages'] });
  await setMode(win, 'simple');
  await expect(toggleOf('messages')).toBeVisible();
  expect(await sectionsIn(live)).toEqual(['group-audio-toggle', 'group-messages-toggle']);
  const box = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'showPip', source: { kind: 'slides' } }),
  );
  expect(box.ok).toBe(false);
  await setMode(win, 'pro');
  await app.close();

  // Kept with this computer's library over a restart.
  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  expect(await chosen(win2)).toEqual(['messages']);
  await again.app.close();
});
