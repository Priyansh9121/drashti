import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { importAndGetIds, launchApp, operatorPage, outputPage, setUpScreen } from './helpers';

/*
 * Arrangements set the order: the slide grid, Next and Previous follow the
 * presentation's arrangement, so a repeated chorus shows and plays each time.
 */

const line = (text: string) => ({ text: [{ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) }] });

test('the arrangement sets the order: a repeated chorus shows and plays each time, and the order can change live', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-arrangement-'));
  const song = join(dir, 'Placeholder Arranged Song.pro6');
  writeFileSync(
    song,
    pp6Presentation({
      uuid: 'E2E-ARRANGED',
      groups: [
        { name: 'Verse 1', uuid: 'G-V1', slides: [line('Placeholder verse one')] },
        { name: 'Chorus', uuid: 'G-C', slides: [line('Placeholder chorus')] },
        { name: 'Verse 2', uuid: 'G-V2', slides: [line('Placeholder verse two')] },
      ],
      arrangements: [{ name: 'As sung', groups: ['G-V1', 'G-C', 'G-V2', 'G-C'] }],
      selectedArrangement: 0,
    }),
  );
  await importAndGetIds(win, [song]);
  await setUpScreen(win);
  const output = await outputPage(app);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Placeholder Arranged Song/ })
    .click();
  const grid = win.getByTestId('slide-grid');
  await expect(grid.getByTestId('arrangement')).toHaveValue(/.+/);
  // The grid shows the order it plays in: the chorus twice.
  await expect(grid.getByTestId('slide-group')).toHaveCount(4);
  expect(
    await grid.getByTestId('slide-group').evaluateAll((els) => els.map((e) => e.getAttribute('data-group'))),
  ).toEqual(['Verse 1', 'Chorus', 'Verse 2', 'Chorus']);

  // Next plays it through, chorus included each time.
  const slideText = output.locator('[data-layer="slide"]');
  await grid.getByTestId('slide-thumb').first().click();
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    if (i > 0) await win.keyboard.press('ArrowRight');
    await expect(win.getByTestId('live-text')).toContainText(`slide ${i + 1} of 4`);
    seen.push((await slideText.innerText()).trim());
  }
  expect(seen).toEqual([
    'Placeholder verse one',
    'Placeholder chorus',
    'Placeholder verse two',
    'Placeholder chorus',
  ]);
  await expect(grid.getByTestId('slide-thumb').nth(3)).toHaveAttribute('aria-current', 'true');

  // Every slide in order, chosen while the second chorus is live: it stays up, and Next follows the new order.
  await grid.getByTestId('arrangement').selectOption({ label: 'All slides in order' });
  await expect(grid.getByTestId('slide-group')).toHaveCount(3);
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 3');
  await expect(slideText).toContainText('Placeholder chorus');
  await win.keyboard.press('ArrowRight');
  await expect(slideText).toContainText('Placeholder verse two');

  // The choice is kept with the presentation.
  await win.reload();
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Placeholder Arranged Song/ })
    .click();
  await expect(win.getByTestId('slide-grid').getByTestId('arrangement')).toHaveValue('');
  await app.close();
});
