import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { launchApp, openLibrary, operatorPage, operatorReady, slidesOf } from './helpers';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

/*
 * LIVE said once (alpha.24, uitop; the owner's "too congested"; the release lead's review S3): with a slide up from
 * the playlist, the word LIVE is seen once, in the top bar beside what is live. The LIVE column's heading is the quiet
 * word with no badge beside it, and the playlist's rows that are up (the presentation's name row and the slide's) have
 * a red edge and a dot, moving with the show at once. Placeholder content only.
 */

/** Every LIVE badge that is seen: whether it is in the top bar's states. */
const liveWordsSeen = (win: Page) =>
  win.locator('[data-badge]').evaluateAll((badges) =>
    badges
      .filter((b) => b.textContent.trim() === 'Live')
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden';
      })
      .map((b) => b.closest('[data-testid="header-states"]') !== null),
  );

test('LIVE is said once, in the top bar; the LIVE column has no badge; the rows that are up have the red edge and the dot, moving with Next (uitop)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  const slides = slidesOf(win, KIRTAN);
  await slides.nth(1).click();
  await expect(slides.nth(1)).toHaveAttribute('aria-current', 'true');

  // The word LIVE, seen once: the top bar's.
  expect(await liveWordsSeen(win)).toEqual([true]);
  // The LIVE column: its heading, the quiet word, and no badge beside it.
  const column = win.getByRole('complementary', { name: 'Live', exact: true });
  await expect(win.locator('#live-preview-title')).toHaveText('LIVE');
  await expect(column.locator('[data-badge]').filter({ hasText: /^Live$/u })).toHaveCount(0);

  // The rows: the presentation's name row has the edge and the dot, its slide's row the dot; no other row either.
  const open = win.getByTestId('open-playlist');
  const nameRow = open.getByTestId('playlist-item').filter({ hasText: KIRTAN });
  await expect(open.locator('[data-live-dot]')).toHaveCount(2);
  await expect(open.locator('[data-live-edge]')).toHaveCount(1);
  await expect(nameRow.locator('[data-live-dot]')).toHaveCount(1);
  await expect(nameRow.locator('[data-live-edge]')).toHaveCount(1);
  await expect(slides.nth(1).locator('[data-live-dot]')).toHaveCount(1);
  await expect(slides.nth(2).locator('[data-live-dot]')).toHaveCount(0);
  // The name row still reads Live to a screen reader, as it did with the badge.
  await expect(nameRow).toContainText('Live');

  // Next: the dot moves to the next slide's row at once; the name row keeps its edge and dot.
  await win.getByTestId('show-next').click();
  await expect(slides.nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(slides.nth(2).locator('[data-live-dot]')).toHaveCount(1);
  await expect(slides.nth(1).locator('[data-live-dot]')).toHaveCount(0);
  await expect(open.locator('[data-live-dot]')).toHaveCount(2);
  expect(await liveWordsSeen(win)).toEqual([true]);

  // The library's sheet open (lead 2's hands-on pass): its presentation that is up says so as the playlist's rows do,
  // its red edge and dot, Live to a screen reader, and no badge: the word LIVE is still seen once.
  await openLibrary(win);
  const kirtan = win
    .getByTestId('presentation-list')
    .getByTestId('presentation-row')
    .filter({ hasText: KIRTAN });
  await expect(kirtan).toBeVisible();
  await expect(kirtan.locator('[data-live-dot]')).toHaveCount(1);
  await expect(kirtan.locator('xpath=..').locator('[data-live-edge]')).toHaveCount(1);
  await expect(kirtan).toContainText('Live');
  expect(await liveWordsSeen(win)).toEqual([true]);
  await app.close();
});
