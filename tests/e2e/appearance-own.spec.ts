import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  chooseMenuItem,
  launchApp,
  OWN_APPEARANCE,
  operatorPage,
  operatorReady,
  relaunchApp,
  type PageGlobals,
} from './helpers';

/*
 * One's own appearance (Session 40): made in the Appearance window as a copy, with a name, a base and an accent;
 * every rule checked as the accent is chosen, an accent too close to LIVE refused in words with the nearest that
 * works offered; saved, it is used at once and kept over a restart; deleted (asked first), the computer follows
 * its own setting again. A built-in one can't be deleted, and Simple Mode refuses both. Placeholder names only.
 */

const kept = (userData: string) =>
  JSON.parse(readFileSync(join(userData, 'drashti-appearance.json'), 'utf8')) as {
    choice: string;
    own: { id: string; name: string; base: string; accent: string }[];
  };

test('make one’s own, use it, keep it over a restart, then delete it', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchApp(OWN_APPEARANCE);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1440, height: 900 });
  await operatorReady(win);
  await chooseMenuItem(app, 'appearance-black');
  await chooseMenuItem(app, 'appearance-window');
  const dialog = win.getByTestId('appearance-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('appearance-copy').click();
  const form = dialog.getByTestId('appearance-make');
  await expect(form).toBeVisible();
  await expect(form.getByTestId('appearance-make-name')).toHaveValue('Black (mine)');
  await form.getByTestId('appearance-make-name').fill('Placeholder own');
  await form.getByTestId('appearance-make-light').click();
  // Too close to LIVE: refused in words, Save waits, and the nearest that works is offered.
  await form.getByTestId('appearance-make-accent').fill('#d0302f');
  const refused = form.getByTestId('appearance-make-refused');
  await expect(refused).toContainText('LIVE’s red');
  await expect(form.getByTestId('appearance-make-save')).toBeDisabled();
  await expectNoSeriousA11yIssues(win, 'making one’s own appearance, refused');
  await form.getByTestId('appearance-make-nearest').click();
  await expect(form.getByTestId('appearance-make-ok')).toBeVisible();
  await expect(form.getByTestId('appearance-make-accent')).not.toHaveValue('#d0302f');
  // A colour that works as it is.
  await form.getByTestId('appearance-make-accent').fill('#0b5c7a');
  await expect(form.getByTestId('appearance-make-ok')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'making one’s own appearance');
  await form.getByTestId('appearance-make-save').click();
  await expect(form).toHaveCount(0);

  // Used at once: the window, the menu and the file.
  const own = kept(userData).own;
  expect(own).toEqual([
    {
      id: expect.stringMatching(/^own-[0-9a-f]{12}$/u) as unknown,
      name: 'Placeholder own',
      base: 'light',
      accent: '#0b5c7a',
    },
  ]);
  const id = own[0]?.id ?? '';
  expect(kept(userData).choice).toBe(id);
  await expect(win.locator('html')).toHaveAttribute('data-appearance', id);
  await expect(win.locator('html')).toHaveAttribute('data-base', 'light');
  expect(
    await win.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim(),
    ),
  ).toBe('#0b5c7a');
  const ticked = () =>
    app.evaluate(
      ({ Menu }, ownId) => Menu.getApplicationMenu()?.getMenuItemById(`appearance-${ownId}`)?.checked ?? null,
      id,
    );
  expect(await ticked()).toBe(true);
  await expect(dialog.locator(`[data-testid="appearance-choice"][data-choice="${id}"]`)).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // A built-in one can't be deleted.
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.appearance.remove('black'))).toEqual({
    ok: false,
    message: 'Only an appearance of your own can be deleted.',
  });
  await app.close();

  // Kept over a restart.
  const again = await relaunchApp(userData, OWN_APPEARANCE);
  const next = await operatorPage(again.app);
  await expect(next.locator('html')).toHaveAttribute('data-appearance', id);
  await operatorReady(next);
  // Deleted, asked first: the computer's own setting again.
  await chooseMenuItem(again.app, 'appearance-window');
  const sheet = next.getByTestId('appearance-dialog');
  await sheet.getByTestId('appearance-own').getByRole('button', { name: 'Delete “Placeholder own”' }).click();
  const confirm = next.getByTestId('appearance-delete-confirm');
  await expect(confirm).toContainText('Drashti follows the computer again');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(next.locator('html')).toHaveAttribute('data-appearance', /^(black|white)$/u);
  expect(kept(userData)).toMatchObject({ choice: 'follow', own: [] });
  await expect(sheet.getByTestId('appearance-own')).toHaveCount(0);
  expect(
    await again.app.evaluate(
      ({ Menu }, ownId) => Menu.getApplicationMenu()?.getMenuItemById(`appearance-${ownId}`) ?? null,
      id,
    ),
  ).toBeNull();
  await again.app.close();
});

test('one’s own gets a header and band from its accent, and a second colour of its own, checked as it is chosen (Session 42)', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchApp(OWN_APPEARANCE);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1440, height: 900 });
  await operatorReady(win);
  await chooseMenuItem(app, 'appearance-black');
  await chooseMenuItem(app, 'appearance-window');
  const dialog = win.getByTestId('appearance-dialog');
  await dialog.getByTestId('appearance-copy').click();
  const form = dialog.getByTestId('appearance-make');
  await form.getByTestId('appearance-make-name').fill('Placeholder marks');
  await form.getByTestId('appearance-make-accent').fill('#16a3a0');
  await expect(form.getByTestId('appearance-make-ok')).toBeVisible();
  // Worked out from the accent until chosen.
  await expect(form.getByTestId('appearance-make-second-worked')).toBeVisible();
  await form.getByTestId('appearance-make-own-second').click();
  // Marks too near a state are refused in words, with the nearest that works.
  await form.getByTestId('appearance-make-second').fill('#d0302f');
  await expect(form.getByTestId('appearance-make-refused')).toContainText(
    'This second colour is too close to',
  );
  await expect(form.getByTestId('appearance-make-save')).toBeDisabled();
  await form.getByTestId('appearance-make-nearest').click();
  await expect(form.getByTestId('appearance-make-ok')).toBeVisible();
  await form.getByTestId('appearance-make-second').fill('#3aa0d8');
  await expect(form.getByTestId('appearance-make-ok')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'making one’s own appearance with a second colour');
  await form.getByTestId('appearance-make-save').click();
  await expect(form).toHaveCount(0);
  const file = JSON.parse(readFileSync(join(userData, 'drashti-appearance.json'), 'utf8')) as {
    own: { id: string }[];
    seconds: Record<string, string>;
  };
  const id = file.own[0]?.id ?? '';
  expect(file.seconds).toEqual({ [id]: '#3aa0d8' });
  await expect(win.locator('html')).toHaveAttribute('data-appearance', id);
  // Its own header and band, worked out from the accent.
  const vars = await win.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return ['--color-header', '--color-panel', '--band-height', '--band-3', '--band-4'].map((v) =>
      css.getPropertyValue(v).trim(),
    );
  });
  expect(vars[0]).not.toBe(vars[1]);
  expect(vars.slice(2)).toEqual(['6px', '1', '0']);
  await app.close();
});

test('Simple Mode refuses making or deleting an appearance', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const answers = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti.appearance;
    return [
      await d.make({ name: 'Placeholder own', base: 'dark', accent: '#5aa2ff' }),
      await d.remove('own-000000000000'),
    ];
  });
  expect(answers).toEqual([
    { ok: false, message: SIMPLE_MODE_REFUSAL },
    { ok: false, message: SIMPLE_MODE_REFUSAL },
  ]);
  await app.close();
});
