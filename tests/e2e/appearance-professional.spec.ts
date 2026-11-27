import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { builtIn } from '../../src/shared/appearance/appearances';
import { settled } from './a11y';
import {
  chooseMenuItem,
  launchApp,
  operatorPage,
  operatorReady,
  OWN_APPEARANCE,
  relaunchApp,
} from './helpers';
import { PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

const DESKS = [
  ['broadcast', 'Broadcast'],
  ['stage-desk', 'Stage desk'],
  ['daylight', 'Daylight'],
  ['signal', 'Signal'],
] as const;

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((at) => String(parseInt(hex.slice(at, at + 2), 16))).join(', ')})`;

/** Compare with an existing named appearance: the same flat layout and six-pixel band. */
async function controls(win: Page) {
  await settled(win);
  return win.locator('[data-show-control]:visible').evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-testid'),
        words: el.textContent,
        box: [box.x, box.y, box.width, box.height],
        font: getComputedStyle(el).fontFamily,
      };
    }),
  );
}

const forced = (win: Page) =>
  win.evaluate(() => {
    const header = document.querySelector('[data-testid="app-header"]');
    return {
      words: getComputedStyle(document.body).color,
      ground: getComputedStyle(document.body).backgroundColor,
      header: header ? getComputedStyle(header).backgroundColor : null,
    };
  });

for (const [id, name] of DESKS) {
  test(`${name}: its own preview, selected by keyboard, flat controls in place, system colours and restart`, async () => {
    const a = builtIn(id);
    if (!a) throw new Error(`Missing professional appearance: ${id}`);
    const { app, userData } = await launchApp(OWN_APPEARANCE);
    const win = await operatorPage(app);
    await win.setViewportSize({ width: 1024, height: 645 });
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await operatorReady(win);
    await setUpPlaceholderShow(win);
    await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
    await chooseMenuItem(app, 'appearance-dhaja');
    await expect(win.locator('html')).toHaveAttribute('data-window-look', 'flat');
    const before = await controls(win);
    expect(before.length).toBeGreaterThan(0);

    await chooseMenuItem(app, 'appearance-window');
    const dialog = win.getByTestId('appearance-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('searchbox', { name: 'Find an appearance' }).fill('Show tools');
    await expect(dialog.getByTestId('appearance-choice')).toHaveCount(4);
    const choice = dialog.locator(`[data-choice="${id}"]`);
    await expect(choice).toContainText(name);
    const preview = choice.getByTestId('appearance-preview');
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute('aria-hidden', 'true');
    await expect(preview.locator(':scope > div').first()).toHaveCSS(
      'background-color',
      rgb(a.decoration.header),
    );
    await expect(preview.getByText('Next', { exact: true })).toHaveCSS(
      'background-color',
      rgb(a.colours.primary),
    );
    await choice.focus();
    await win.keyboard.press('Space');
    await expect(choice).toHaveAttribute('aria-checked', 'true');
    await expect(win.locator('html')).toHaveAttribute('data-appearance', id);
    await expect(dialog.getByTestId('appearance-moving-words')).toContainText(`${name} is still.`);
    await win.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await controls(win)).toEqual(before);
    await expect(win.locator('html')).toHaveAttribute('data-window-look', 'flat');
    await expect(win.locator('html')).toHaveAttribute('data-look-motion', '');
    await expect(win.locator('[data-touch-layer]')).toHaveCount(0);

    // Compare each base with the existing system-colour drawing, including the hidden decoration.
    await win.emulateMedia({ forcedColors: 'active' });
    await chooseMenuItem(app, a.base === 'dark' ? 'appearance-black' : 'appearance-white');
    await expect(win.locator('html')).toHaveAttribute(
      'data-appearance',
      a.base === 'dark' ? 'black' : 'white',
    );
    const system = await forced(win);
    await chooseMenuItem(app, `appearance-${id}`);
    await expect(win.locator('[data-band]')).toBeHidden();
    await expect.poll(() => forced(win)).toEqual(system);
    await win.emulateMedia({ forcedColors: 'none' });
    await app.close();

    const again = await relaunchApp(userData, OWN_APPEARANCE);
    const next = await operatorPage(again.app);
    await operatorReady(next);
    await expect(next.locator('html')).toHaveAttribute('data-appearance', id);
    await expect(next.locator('html')).toHaveAttribute('data-window-look', 'flat');
    await again.app.close();
  });
}
