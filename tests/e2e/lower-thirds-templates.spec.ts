import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { MORE_LOWER_THIRD_DESIGNS } from '../../src/shared/lower-third-designs-more';
import type { LowerThirdTemplate } from '../../src/shared/lower-third-templates';
import { LOWER_THIRD_TEMPLATES } from '../../src/shared/lower-third-templates';
import { shownLines } from '../../src/shared/lower-thirds';
import {
  launchApp,
  openMoreTools,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
  windowShowing,
} from './helpers';
import { CI_WINDOW } from './window-size';

/*
 * The templates made since alpha.17 (Session 58, C14): every one in the Lower Thirds studio's gallery, under All
 * templates, by its name; and each layout new to the gallery made into a lower third as designed, saved and shown on
 * a placeholder hall screen: three lines, one line, a Gujarati name, and a moving background moving while it is up.
 * The studio at CI's 1024 × 645. Placeholder words only.
 */

const isStudio = (p: Page) => p.url().includes('lower-thirds.html');

async function start(): Promise<{ app: ElectronApplication; win: Page; out: Page }> {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1440, height: 900 });
  await setUpScreen(win, 'Main Hall', 0);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 30_000 });
  return { app, win, out };
}

/** The studio, opened from the Lower Thirds panel as the operator would (More tools), at CI's window size. */
async function openStudio(app: ElectronApplication, win: Page): Promise<Page> {
  await openMoreTools(win);
  const panel = win.getByTestId('lower-thirds-panel');
  await panel.scrollIntoViewIfNeeded();
  await panel.getByTestId('lower-third-studio').click();
  const studio = await windowShowing(app, isStudio, 'the Lower Thirds studio');
  await expect(studio.getByTestId('lt-studio')).toBeVisible({ timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }, want) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('lower-thirds.html'))
      ?.setContentSize(want.width, want.height);
  }, CI_WINDOW);
  await studio.setViewportSize(CI_WINDOW);
  await expect
    .poll(() => studio.evaluate(() => [innerWidth, innerHeight]))
    .toEqual([CI_WINDOW.width, CI_WINDOW.height]);
  return studio;
}

/** The gallery's All templates, open. */
async function allTemplates(studio: Page) {
  await studio.getByTestId('studio-templates').click();
  const picker = studio.getByRole('dialog', { name: 'Lower third templates' });
  await picker.getByRole('button', { name: 'All templates' }).click();
  return picker;
}

const made = LOWER_THIRD_TEMPLATES.filter((t) => MORE_LOWER_THIRD_DESIGNS.some((d) => d.id === t.id));

/** The first template made since alpha.17 that `fits` picks (one the Performance run leaves out is not offered). */
function first(what: string, fits: (t: LowerThirdTemplate) => boolean): LowerThirdTemplate {
  const found = made.find(fits);
  if (!found) throw new Error(`No template made since alpha.17 with ${what}`);
  return found;
}

test('All templates lists every template made since alpha.17 by its name, after alpha.17’s 50', async () => {
  const { app, win } = await start();
  const studio = await openStudio(app, win);
  const picker = await allTemplates(studio);
  const tiles = picker.getByTestId('studio-template');
  await expect(tiles).toHaveCount(LOWER_THIRD_TEMPLATES.length);
  expect(made.length).toBeGreaterThanOrEqual(18);
  for (const t of made) {
    const tile = picker.locator(`[data-testid="studio-template"][data-template="${t.id}"]`);
    await expect(tile, t.id).toHaveCount(1);
    await expect(tile, t.id).toHaveAccessibleName(t.name);
    await expect(tile, t.id).toHaveAttribute('data-style', t.input.look.style ?? 'box');
  }
  await app.close();
});

test('each new layout makes a lower third as designed, saved and shown on the hall screen: three lines, one line, a Gujarati name, a moving background moving', async () => {
  test.setTimeout(240_000);
  const { app, win, out } = await start();
  const studio = await openStudio(app, win);
  const chosen = [
    first('three lines', (t) => shownLines(t.input.lines).length === 3),
    first('one line', (t) => shownLines(t.input.lines).length === 1),
    first('a Gujarati name', (t) => shownLines(t.input.lines)[0]?.startsWith('નમૂના') === true),
    first('a moving background', (t) => (t.input.look.motion ?? 'none') !== 'none'),
  ];
  const onScreen = out.getByTestId('lower-third-layer');
  for (const t of chosen) {
    const picker = await allTemplates(studio);
    await picker.locator(`[data-testid="studio-template"][data-template="${t.id}"]`).click();
    await expect(picker).toHaveCount(0);
    // Its words in the studio, placeholder words only, and its look in the live preview.
    const words = shownLines(t.input.lines);
    const lines = studio.getByTestId('lower-third-line');
    for (const [i, line] of t.input.lines.entries()) await expect(lines.nth(i), t.id).toHaveValue(line);
    const drawn = studio.getByTestId('lower-third-preview').getByTestId('lower-third-layer');
    await expect(drawn, t.id).toHaveAttribute('data-lt-style', t.input.look.style ?? 'box');
    await expect(drawn, t.id).toHaveAttribute('data-lt-motion', t.input.look.motion ?? 'none');

    // Saved, then shown from the studio: on the hall screen as designed, every line of it.
    await studio.getByTestId('lower-third-save').click();
    await expect(
      studio
        .getByTestId('studio-row')
        .filter({ hasText: words[0] ?? '' })
        .first(),
    ).toHaveAttribute('data-saved', 'true');
    await studio.getByTestId('studio-show').click();
    await expect(onScreen, t.id).toHaveAttribute('data-lt-animation', t.input.animation);
    await expect(onScreen, t.id).toHaveAttribute('data-lt-style', t.input.look.style ?? 'box');
    await expect(onScreen, t.id).toHaveAttribute('data-lt-motion', t.input.look.motion ?? 'none');
    await expect(onScreen, t.id).toHaveAttribute('data-lt-font', t.input.look.font);
    await expect(onScreen.locator('[data-lt-line]'), t.id).toHaveCount(words.length);
    for (const word of words) await expect(onScreen, t.id).toContainText(word);
    await expect(onScreen, t.id).toHaveAttribute('data-lt-phase', 'still');
    if ((t.input.look.motion ?? 'none') !== 'none') {
      // Its moving background runs while it is up.
      const movedAt = await onScreen.getAttribute('data-lt-motion-at');
      await expect.poll(() => onScreen.getAttribute('data-lt-motion-at')).not.toBe(movedAt);
    }

    // Hidden: it goes out, then it is gone.
    await studio.getByTestId('studio-show').click();
    await expect(onScreen, t.id).toHaveCount(0);
  }
  await app.close();
});
