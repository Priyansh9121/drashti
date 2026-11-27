import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { launchApp, openLibrary, operatorPage, operatorReady, type PageGlobals, slidesOf } from './helpers';
import { KIRTAN, PICTURE, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

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

function dispatch(win: Page, command: Parameters<PageGlobals['drashti']['engine']['dispatch']>[0]) {
  return win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
}

/** The top bar's live line: its first badge (LIVE or Off) and its words. */
function topBar(win: Page) {
  const status = win.getByTestId('header-states').getByTestId('live-status');
  return { status, badge: status.locator('[data-badge]').first(), text: status.getByTestId('live-text') };
}

test('with only a background or the picture-in-picture box up, the top bar still says LIVE in words and names it; nothing up, the wallpaper or Black-out alone, it says Nothing live; in Pro and Simple Mode (livesay)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const { pictureMediaId } = await setUpPlaceholderShow(win);
  const picture = {
    kind: 'media',
    mediaId: pictureMediaId,
    media: 'image',
    fit: 'fill',
    loop: false,
  } as const;
  const frame = win.getByTestId('live-preview');
  // As Media names the picture: its file's name, with its ending.
  const named = `${PICTURE}.png`;

  for (const mode of ['pro', 'simple'] as const) {
    await win.evaluate((m) => (globalThis as PageGlobals).drashti.app.setMode(m), mode);
    await expect(win.getByTestId('simple-mode')).toHaveCount(mode === 'simple' ? 1 : 0);
    const bar = topBar(win);

    // Nothing up (the chosen wallpaper, or black, shows): Off, and Nothing live.
    await expect(bar.badge, mode).toHaveText('Off');
    await expect(bar.text, mode).toHaveText('Nothing live');
    // Black-out alone: its own badge in words, never LIVE.
    await dispatch(win, { type: 'toggleBlackout' });
    await expect(bar.status.locator('[data-badge]').filter({ hasText: 'Black-out' }), mode).toHaveCount(1);
    await expect(bar.badge, mode).toHaveText('Off');
    await expect(bar.text, mode).toHaveText('Nothing live');
    await dispatch(win, { type: 'toggleBlackout' });
    // The Wallpaper on with nothing up: the same.
    await dispatch(win, { type: 'setWallpaper', on: true });
    await expect(bar.badge, mode).toHaveText('Off');
    await expect(bar.text, mode).toHaveText('Nothing live');
    await dispatch(win, { type: 'setWallpaper', on: false });

    // A picture from Media up alone as the background: LIVE in words, and its name (before, only the LIVE picture's
    // red frame said so: colour alone).
    await dispatch(win, { type: 'setBackground', background: picture });
    await expect(frame, mode).toHaveClass(/border-live-edge/u);
    await expect(bar.badge, mode).toHaveText('Live');
    await expect(bar.text, mode).toHaveText(`Live: Picture · ${named}`);
    if (mode === 'pro') expect(await liveWordsSeen(win)).toEqual([true]);
    // A colour.
    await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#1d4e89' } });
    await expect(bar.badge, mode).toHaveText('Live');
    await expect(bar.text, mode).toHaveText('Live: Background colour');
    await dispatch(win, { type: 'clearLayer', layer: 'background' });
    await expect(bar.badge, mode).toHaveText('Off');
    await expect(bar.text, mode).toHaveText('Nothing live');

    // The picture-in-picture box alone (Session 50: something on the screens too).
    await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId: pictureMediaId } });
    await expect(bar.badge, mode).toHaveText('Live');
    await expect(bar.text, mode).toHaveText(`Live: Picture in picture · ${named}`);
    await dispatch(win, { type: 'hidePip' });
    await expect(bar.badge, mode).toHaveText('Off');
    await expect(bar.text, mode).toHaveText('Nothing live');
  }

  // Pro Mode: a slide up over the picture, then cleared (F2): the picture stays up, so LIVE, the cleared slide's place
  // and what is still up.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  const bar = topBar(win);
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  const slides = slidesOf(win, KIRTAN);
  await slides.nth(1).click();
  await expect(bar.text).toHaveText(`Live: ${KIRTAN} · slide 2 of 5`);
  await dispatch(win, { type: 'setBackground', background: picture });
  await expect(bar.text).toHaveText(`Live: ${KIRTAN} · slide 2 of 5`);
  await win.keyboard.press('F2');
  await expect(bar.badge).toHaveText('Live');
  await expect(bar.text).toHaveText(`Live: ${KIRTAN} · slide 2 of 5 (cleared) · Picture · ${named}`);
  // The background cleared too: Off, the cleared slide's place as before.
  await dispatch(win, { type: 'clearLayer', layer: 'background' });
  await expect(bar.badge).toHaveText('Off');
  await expect(bar.text).toHaveText(`Live: ${KIRTAN} · slide 2 of 5 (cleared)`);
  await app.close();
});
