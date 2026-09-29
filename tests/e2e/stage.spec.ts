import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { importAndGetIds, launchApp, operatorPage, outputPages, setUpScreen } from './helpers';
import { makeTestImage } from './test-media';

/*
 * The stage screen: the performers see the slide on the screens, the next
 * one, the slide's notes, the clock and a message the audience never sees,
 * in large text with no pictures, and it follows Next.
 */

const line = (text: string) => ({ text: [{ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) }] });

test('a stage screen follows Next with the current and next text, notes, clock and a stage-only message', async () => {
  // Two outputs on a one-screen machine: windowed, with one pretend extra display.
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-stage-'));
  const picture = await makeTestImage(win, join(dir, 'Placeholder backdrop.png'), { color: '#1565c0' });
  const song = join(dir, 'Placeholder Stage Song.pro6');
  writeFileSync(
    song,
    pp6Presentation({
      uuid: 'E2E-STAGE',
      groups: [
        {
          name: 'Verse',
          slides: [
            {
              ...line('Placeholder stage line one'),
              background: { path: picture, kind: 'image' },
              notes: 'Placeholder note: slow down here',
            },
            line('Placeholder stage line two'),
            line('Placeholder stage line three'),
          ],
        },
      ],
    }),
  );
  const [presentationId = ''] = await importAndGetIds(win, [song]);
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Stage', 1);
  await expect.poll(() => outputPages(app).length).toBe(2);
  // Make the second group a stage group, from the Screens panel.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const groups = win.getByTestId('screen-group');
  await groups.nth(1).getByTestId('group-role').selectOption('stage');
  await win.getByRole('button', { name: 'Close screens' }).click();
  const [first, second] = outputPages(app) as [Page, Page];
  const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
  await expect
    .poll(async () => [await roleOf(first), await roleOf(second)].sort())
    .toEqual(['audience', 'stage']);
  const [stage, audience] = (await roleOf(first)) === 'stage' ? [first, second] : [second, first];
  const view = stage.getByTestId('stage-view');
  await expect(view).toBeVisible();

  // Live on slide 1: now, next, the notes and the clock; no pictures on the stage.
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Placeholder Stage Song/ })
    .click();
  const grid = win.getByTestId('slide-grid');
  await expect(grid).toHaveAttribute('data-presentation-id', presentationId);
  await grid.getByTestId('slide-thumb').first().click();
  await expect(view.getByTestId('stage-current')).toHaveText('Placeholder stage line one');
  await expect(view.getByTestId('stage-next')).toHaveText('Placeholder stage line two');
  await expect(view.getByTestId('stage-notes')).toHaveText('Placeholder note: slow down here');
  await expect(view.getByTestId('stage-clock')).toHaveText(/\d{1,2}:\d{2}/);
  await expect(audience.locator('[data-layer="background"] img')).toHaveCount(1);
  await expect(stage.locator('img, video')).toHaveCount(0);

  // Next: the stage follows.
  await win.keyboard.press('ArrowRight');
  await expect(view.getByTestId('stage-current')).toHaveText('Placeholder stage line two');
  await expect(view.getByTestId('stage-next')).toHaveText('Placeholder stage line three');
  await expect(view.getByTestId('stage-notes')).toHaveCount(0);
  await win.keyboard.press('ArrowRight');
  await expect(view.getByTestId('stage-next')).toHaveText('End');

  // A message for the stage: the audience never sees it.
  const control = win.getByTestId('stage-message-control');
  await control.getByRole('textbox', { name: 'Message for the stage' }).fill('Placeholder: two minutes left');
  await control.getByRole('button', { name: 'Show' }).click();
  await expect(view.getByTestId('stage-message')).toHaveText('Placeholder: two minutes left');
  await expect(control.getByTestId('stage-message-shown')).toContainText('Placeholder: two minutes left');
  await expect(audience.getByText('two minutes left')).toHaveCount(0);
  await control.getByRole('button', { name: 'Clear' }).click();
  await expect(view.getByTestId('stage-message')).toHaveCount(0);

  await app.close();
});
