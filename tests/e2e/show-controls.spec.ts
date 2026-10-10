import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';

/*
 * Show controls change at once (Session 25): Black-out, Logo, the layer clears and the live
 * slide's border take their new colour in the same frame as the screens, never fading. Each is
 * read the moment its class changes (a MutationObserver, which runs before the next frame): a
 * colour fade would still show the old colour there, and list a running transition.
 */

interface Seen {
  colour: string;
  running: number;
}

/** Watch `selector`'s `property` from its next class change: the colour then, and what was running. */
async function watch(
  win: Page,
  selector: string,
  property: 'backgroundColor' | 'borderTopColor',
): Promise<void> {
  await win.evaluate(
    ({ selector, property }) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`nothing matches ${selector}`);
      const g = globalThis as { seen?: Seen };
      delete g.seen;
      const observer = new MutationObserver(() => {
        g.seen = { colour: getComputedStyle(el)[property], running: el.getAnimations().length };
        observer.disconnect();
      });
      observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    },
    { selector, property },
  );
}

const seen = (win: Page) => win.evaluate(() => (globalThis as { seen?: Seen }).seen ?? null);

/** The colour a token gives, as a computed value (what the control should show at once). */
const tokenColour = (win: Page, className: string, property: 'backgroundColor' | 'borderTopColor') =>
  win.evaluate(
    ({ className, property }) => {
      const probe = document.createElement('div');
      probe.className = className;
      document.body.append(probe);
      const colour = getComputedStyle(probe)[property];
      probe.remove();
      return colour;
    },
    { className, property },
  );

async function changesAtOnce(
  win: Page,
  selector: string,
  property: 'backgroundColor' | 'borderTopColor',
  token: string,
  act: () => Promise<void>,
): Promise<void> {
  await watch(win, selector, property);
  await act();
  await expect.poll(() => seen(win)).not.toBeNull();
  expect(await seen(win)).toEqual({ colour: await tokenColour(win, token, property), running: 0 });
}

test('Black-out, the slide clear and the live border change in the same frame, in both modes', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);

  // Pro Mode: B turns Black-out live in the first frame (no fade), and says so once, in words.
  await changesAtOnce(win, '[data-testid="blackout-button"]', 'backgroundColor', 'bg-live', () =>
    win.keyboard.press('b'),
  );
  await expect(win.getByTestId('blackout-button')).toHaveAccessibleName(/^Black-out is on/u);
  await win.keyboard.press('b');
  await expect(win.getByTestId('blackout-button')).toHaveAccessibleName(/^Black-out(?! is on)/u);

  // A slide going up: its thumbnail's border, and the slide's clear, light up in the same frame.
  await win.getByTestId('presentation-list').getByRole('button').first().click();
  const thumb = win.getByTestId('slide-thumb').first();
  await expect(thumb).toBeVisible();
  await watch(win, '[data-testid="slide-thumb"]', 'borderTopColor');
  await thumb.click();
  await expect.poll(() => seen(win)).not.toBeNull();
  expect(await seen(win)).toEqual({
    colour: await tokenColour(win, 'border-2 border-live', 'borderTopColor'),
    running: 0,
  });
  const slideClear = win.getByRole('button', { name: 'Clear slide (on screen)' });
  await expect(slideClear).toBeVisible();
  await changesAtOnce(
    win,
    '[data-testid="layer-bar"] [data-lit]',
    'borderTopColor',
    'border border-line',
    () => win.keyboard.press('F2'),
  );

  // Simple Mode: the same Black-out, at once, in words.
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await changesAtOnce(win, '[data-testid="simple-blackout"]', 'backgroundColor', 'bg-live', () =>
    win.keyboard.press('b'),
  );
  await expect(win.getByTestId('simple-blackout')).toHaveAccessibleName('Black-out is on');
  await app.close();
});
