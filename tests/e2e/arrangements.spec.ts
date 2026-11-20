import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { importAndGetIds, launchApp, openLibrary, operatorPage, outputPage, setUpScreen } from './helpers';
import { makeTestImage } from './test-media';

/*
 * Arrangements set the order: the slide grid, Next and Previous follow the
 * presentation's arrangement, so a repeated chorus shows and plays each time.
 * Each slide has a picture of its own, and every picture comes late, as from a slow disk
 * (DRASHTI_TEST_MEDIA_DELAY_MS): a hall screen keeps the slide before up until the new one's picture can be drawn
 * (X19), while the operator window already says the new one (x58). Generated pictures only.
 */

const PICTURE_LATE_MS = 1500;

const line = (text: string) => ({ text: [{ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) }] });

test('the arrangement sets the order: a repeated chorus shows and plays each time, and the order can change live', async () => {
  const { app } = await launchApp({ DRASHTI_TEST_MEDIA_DELAY_MS: String(PICTURE_LATE_MS) });
  const win = await operatorPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-arrangement-'));
  /** A slide with its words and a generated picture of its own. */
  const slide = async (words: string, color: string) => ({
    ...line(words),
    image: {
      path: await makeTestImage(win, join(dir, `${words} picture.png`), { width: 160, height: 90, color }),
      rect: [60, 60, 320, 180] as [number, number, number, number],
    },
  });
  const song = join(dir, 'Placeholder Arranged Song.pro6');
  writeFileSync(
    song,
    pp6Presentation({
      uuid: 'E2E-ARRANGED',
      groups: [
        { name: 'Verse 1', uuid: 'G-V1', slides: [await slide('Placeholder verse one', '#3a6ea5')] },
        { name: 'Chorus', uuid: 'G-C', slides: [await slide('Placeholder chorus', '#2e7d32')] },
        { name: 'Verse 2', uuid: 'G-V2', slides: [await slide('Placeholder verse two', '#8e24aa')] },
      ],
      arrangements: [{ name: 'As sung', groups: ['G-V1', 'G-C', 'G-V2', 'G-C'] }],
      selectedArrangement: 0,
    }),
  );
  await importAndGetIds(win, [song]);
  await setUpScreen(win);
  const output = await outputPage(app);
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Arranged Song/ })
    .click();
  const grid = win.getByTestId('slide-grid');
  await expect(grid.getByTestId('arrangement')).toHaveValue(/.+/);
  // The grid shows the order it plays in: the chorus twice.
  await expect(grid.getByTestId('slide-group')).toHaveCount(4);
  expect(
    await grid.getByTestId('slide-group').evaluateAll((els) => els.map((e) => e.getAttribute('data-group'))),
  ).toEqual(['Verse 1', 'Chorus', 'Verse 2', 'Chorus']);

  // Next plays it through, chorus included each time: the hall screen shows each slide alone once it has made the
  // change the operator window already says (x58: it keeps the slide before in its layer until then, X19).
  const slideText = output.locator('[data-layer="slide"]');
  await grid.getByTestId('slide-thumb').first().click();
  const order = [
    'Placeholder verse one',
    'Placeholder chorus',
    'Placeholder verse two',
    'Placeholder chorus',
  ];
  for (const [i, words] of order.entries()) {
    if (i > 0) await win.keyboard.press('ArrowRight');
    await expect(win.getByTestId('live-text')).toContainText(`slide ${i + 1} of 4`);
    await expect(slideText, `the hall screen at slide ${i + 1} of 4`).toHaveText(words, {
      useInnerText: true,
    });
  }
  await expect(grid.getByTestId('slide-thumb').nth(3)).toHaveAttribute('aria-current', 'true');

  // Every slide in order, chosen while the second chorus is live: it stays up, and Next follows the new order.
  await grid.getByTestId('arrangement').selectOption({ label: 'All slides in order' });
  await expect(grid.getByTestId('slide-group')).toHaveCount(3);
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 3');
  await expect(slideText).toHaveText('Placeholder chorus', { useInnerText: true });
  await win.keyboard.press('ArrowRight');
  await expect(slideText).toHaveText('Placeholder verse two', { useInnerText: true });

  // The choice is kept with the presentation.
  await win.reload();
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Arranged Song/ })
    .click();
  await expect(win.getByTestId('slide-grid').getByTestId('arrangement')).toHaveValue('');
  await app.close();
});
