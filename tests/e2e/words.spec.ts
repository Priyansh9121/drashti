import { expect, test } from '@playwright/test';
import { launchApp, openLibrary, operatorPage } from './helpers';

/*
 * Making a new presentation from pasted words. Editing an open presentation's words as plain text (Edit words, and
 * its legacy-font read-only view) went in Session 55 (Part 12, the owner's decision): words are changed in Edit slides;
 * kirtans.spec.ts checks Edit words is gone and a library holding its words opens as before. Placeholder words only.
 */

test('a new presentation from pasted words, with a repeated chorus sung each time', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await openLibrary(win);
  await win.getByRole('button', { name: 'New…' }).click();
  const editor = win.getByTestId('words-editor');
  await editor.getByRole('textbox', { name: 'Name' }).fill('Placeholder Pasted Kirtan');
  await editor
    .getByTestId('words-text')
    .fill(
      '[Verse 1]\nનમૂના પંક્તિ\nNamūnā pankti\n\n[Chorus]\nPlaceholder chorus\n\n[Verse 2]\nPlaceholder verse two\n\n[Chorus]\n',
    );
  await expect(editor.getByTestId('words-count')).toHaveText(
    '3 groups · 3 slides · sung in the order written',
  );
  await editor.getByRole('button', { name: /Make slides/ }).click();
  await expect(editor).toHaveCount(0);

  const grid = win.getByTestId('slide-grid');
  await expect(grid.getByRole('heading', { level: 2 })).toHaveText('Placeholder Pasted Kirtan');
  await expect(
    win.getByTestId('presentation-list').getByRole('button', { name: /^Placeholder Pasted Kirtan/ }),
  ).toHaveAttribute('aria-current', 'true');
  // The chorus comes again at the end, as written.
  await expect
    .poll(() =>
      grid.getByTestId('slide-group').evaluateAll((els) => els.map((e) => e.getAttribute('data-group'))),
    )
    .toEqual(['Verse 1', 'Chorus', 'Verse 2', 'Chorus']);
  await expect(grid.getByTestId('arrangement')).toHaveValue(/.+/);
  await app.close();
});
