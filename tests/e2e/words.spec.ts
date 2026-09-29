import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { importAndGetIds, launchApp, operatorPage, outputPage, setUpScreen } from './helpers';
import { makeTestImage } from './test-media';

/*
 * Editing a presentation's words as plain text, and making a new one from
 * pasted words. Placeholder words and a generated picture only.
 */

const line = (text: string) => ({ text: [{ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) }] });
const saveKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';

test('edit the words: fix a word, add a verse, move a group; the live slide follows, and Undo puts it back', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-words-'));
  const picture = await makeTestImage(win, join(dir, 'Placeholder backdrop.png'), { color: '#6a1b9a' });
  const song = join(dir, 'Placeholder Editable Song.pro6');
  writeFileSync(
    song,
    pp6Presentation({
      uuid: 'E2E-WORDS',
      groups: [
        {
          name: 'Verse 1',
          slides: [
            { ...line('Placeholder verse one'), background: { path: picture, kind: 'image' } },
            line('Placeholder verse two'),
          ],
        },
        { name: 'Chorus', slides: [line('Placeholder chorus')] },
      ],
    }),
  );
  const [presentationId = ''] = await importAndGetIds(win, [song]);
  await setUpScreen(win);
  const output = await outputPage(app);
  const slideText = output.locator('[data-layer="slide"]');

  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Placeholder Editable Song/ })
    .click();
  const grid = win.getByTestId('slide-grid');
  await expect(grid).toHaveAttribute('data-presentation-id', presentationId);
  const groups = () =>
    grid.getByTestId('slide-group').evaluateAll((els) => els.map((e) => e.getAttribute('data-group')));
  // Live on the second verse slide.
  await grid.getByTestId('slide-thumb').nth(1).click();
  await expect(slideText).toHaveText('Placeholder verse two');

  // The words, as plain text.
  await grid.getByRole('button', { name: 'Edit words' }).click();
  const editor = win.getByTestId('words-editor');
  const words = editor.getByTestId('words-text');
  await expect(words).toHaveValue(
    '[Verse 1]\nPlaceholder verse one\n\nPlaceholder verse two\n\n[Chorus]\nPlaceholder chorus\n',
  );
  await expect(editor.getByTestId('words-count')).toHaveText('2 groups · 3 slides');

  // Fix a word in the live slide, move the chorus first, and add a verse.
  await words.fill(
    '[Chorus]\nPlaceholder chorus\n\n[Verse 1]\nPlaceholder verse one\n\nPlaceholder verse 2, fixed\n\n[Verse 2]\nPlaceholder new verse\n',
  );
  await expect(editor.getByTestId('words-count')).toHaveText('3 groups · 4 slides');
  await words.press(saveKey);
  await expect(editor).toHaveCount(0);

  // The screens show the fixed words at once; the grid has the new order; the first verse keeps its picture.
  await expect(slideText).toHaveText('Placeholder verse 2, fixed');
  await expect.poll(groups).toEqual(['Chorus', 'Verse 1', 'Verse 2']);
  await expect(grid.getByTestId('slide-thumb').nth(1).getByTestId('thumb-background')).toHaveCount(1);
  await expect(grid.getByTestId('slide-thumb').nth(2)).toHaveAttribute('aria-current', 'true');

  // Undo brings the words, the order and the live slide's text back.
  const undo = win.getByTestId('undo-removal');
  await expect(undo).toContainText('Edited the words of “Placeholder Editable Song”');
  await undo.getByRole('button', { name: /Undo/ }).click();
  await expect.poll(groups).toEqual(['Verse 1', 'Chorus']);
  await expect(slideText).toHaveText('Placeholder verse two');

  await app.close();
});

test('a new presentation from pasted words, with a repeated chorus sung each time', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
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
    win.getByTestId('presentation-list').getByRole('button', { name: /Placeholder Pasted Kirtan/ }),
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

test('words typed in a legacy font open read-only, naming the font, and cannot be saved', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-words-legacy-'));
  const old = join(dir, 'Placeholder Legacy Kirtan.pro6');
  writeFileSync(
    old,
    pp6Presentation({
      uuid: 'E2E-LEGACY-WORDS',
      groups: [
        {
          name: 'Verse',
          slides: [{ text: [{ rtf: cocoaRtf([['Rkk{kk', 72, [255, 255, 255]]], 'qc', 'Gopika') }] }],
        },
      ],
    }),
  );
  await importAndGetIds(win, [old]);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Placeholder Legacy Kirtan/ })
    .click();
  await win.getByTestId('slide-grid').getByRole('button', { name: 'Edit words' }).click();
  const editor = win.getByTestId('words-editor');
  await expect(editor.getByRole('alert')).toContainText('legacy font (Gopika)');
  await expect(editor.getByTestId('words-text')).toHaveAttribute('readonly', '');
  await expect(editor.getByRole('button', { name: /Save/ })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Close' }).click();
  await expect(editor).toHaveCount(0);
  await app.close();
});
