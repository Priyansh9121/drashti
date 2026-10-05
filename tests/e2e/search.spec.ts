import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { importAndGetIds, launchApp, operatorPage } from './helpers';

/*
 * Searching the library as you type, in each language, with Latin accents
 * ignored; text in legacy fonts is said to be unsearchable, not hidden.
 * Placeholder text only ("sample search line" in each language).
 */

const box = (text: string, font?: string) => ({
  rtf: cocoaRtf([[text, 72, [255, 255, 255]]], 'qc', font),
});

test('search finds titles and slide text in English, Gujarati, Hindi and transliteration, as you type', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-search-'));
  const files = {
    english: pp6Presentation({
      uuid: 'E2E-EN',
      groups: [
        {
          name: 'Verse',
          slides: [
            { text: [box('Placeholder first line')] },
            { text: [box('Placeholder sample line for searching')] },
          ],
        },
      ],
    }),
    gujarati: pp6Presentation({
      uuid: 'E2E-GU',
      groups: [{ name: 'Verse', slides: [{ text: [box('નમૂના શોધ પંક્તિ'), box('Namūnā śodh pankti')] }] }],
    }),
    hindi: pp6Presentation({
      uuid: 'E2E-HI',
      groups: [{ name: 'Verse', slides: [{ text: [box('नमूना खोज पंक्ति')] }] }],
    }),
    // Transliteration spelt one way, searched another (Session 13: v and w, doubled vowels).
    spelling: pp6Presentation({
      uuid: 'E2E-SPELLING',
      groups: [{ name: 'Verse', slides: [{ text: [box('Placeholder shree dwitiya line')] }] }],
    }),
    // Typed in a legacy Gujarati font: Latin letters that only look like Gujarati in that font.
    legacy: pp6Presentation({
      uuid: 'E2E-LEGACY',
      groups: [{ name: 'Verse', slides: [{ text: [box('Rkk{kk Zkkuf', 'Gopika')] }] }],
    }),
  };
  const paths = [
    ['Placeholder English Hymn.pro6', files.english],
    ['Placeholder Gujarati Kirtan.pro6', files.gujarati],
    ['Placeholder Hindi Bhajan.pro6', files.hindi],
    ['Placeholder Spelling Kirtan.pro6', files.spelling],
    ['Placeholder Legacy Kirtan.pro6', files.legacy],
  ].map(([name = '', content = '']) => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  });
  await importAndGetIds(win, paths);

  const search = win.getByTestId('library-search');
  const results = win.getByTestId('search-results');
  const hits = results.getByTestId('search-hit');
  const names = () => hits.evaluateAll((els) => els.map((e) => e.querySelector('span')?.textContent ?? ''));

  // Cmd/Ctrl+F goes to the search box.
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await expect(search).toBeFocused();

  // English, from the slide text, as it is typed.
  await search.pressSequentially('searchi');
  await expect(hits).toHaveCount(1);
  await expect(hits.first()).toContainText('Placeholder English Hymn');
  await expect(hits.first().getByTestId('search-line')).toHaveText('Placeholder sample line for searching');
  await expect(hits.first().locator('mark')).toHaveText('searching');

  // Gujarati and Hindi, whole words and the start of one (the sample kirtan every library starts
  // with has "નમૂના" too).
  await search.fill('નમૂ');
  await expect.poll(names).toContain('Placeholder Gujarati Kirtan');
  await search.fill('શોધ પંક્');
  await expect.poll(names).toEqual(['Placeholder Gujarati Kirtan']);
  await expect(hits.first().getByTestId('search-line')).toHaveText('નમૂના શોધ પંક્તિ');
  await search.fill('खोज');
  await expect.poll(names).toEqual(['Placeholder Hindi Bhajan']);
  await expect(hits.first().getByTestId('search-line')).toHaveText('नमूना खोज पंक्ति');

  // Transliteration without its accents.
  await search.fill('namuna sodh');
  await expect.poll(names).toEqual(['Placeholder Gujarati Kirtan']);
  await expect(hits.first().getByTestId('search-line')).toHaveText('Namūnā śodh pankti');

  // Another spelling of the same words: v for w, and a single vowel for a doubled one ("shri" for "shree").
  await search.fill('shri dvitiya');
  await expect.poll(names).toEqual(['Placeholder Spelling Kirtan']);
  await expect(hits.first().getByTestId('search-line')).toHaveText('Placeholder shree dwitiya line');
  await expect(hits.first().locator('mark')).toHaveText(['shree', 'dwitiya']);

  // Titles.
  await search.fill('bhajan');
  await expect.poll(names).toEqual(['Placeholder Hindi Bhajan']);

  // Legacy-font text is not searched, and the results say so.
  await search.fill('rkk');
  await expect(results).toContainText('Nothing found');
  const legacy = results.getByTestId('search-legacy');
  await expect(legacy).toContainText('1 presentation has slide text in a legacy Gujarati or Hindi font');
  await legacy.getByRole('button', { name: 'Show them' }).click();
  await expect(legacy.getByRole('button', { name: 'Placeholder Legacy Kirtan' })).toBeVisible();

  // Opening a result shows its presentation with the slide that matched marked.
  await search.fill('line for search');
  await expect.poll(names).toEqual(['Placeholder English Hymn']);
  await hits.first().click();
  const grid = win.getByTestId('slide-grid');
  await expect(grid.getByRole('heading', { level: 2 })).toHaveText('Placeholder English Hymn');
  await expect(grid.locator('[data-found="true"]')).toHaveAttribute('data-index', '1');

  // Esc empties the box and the whole list is back.
  await search.focus();
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(win.getByTestId('presentation-list').getByRole('button')).toHaveCount(7);

  await app.close();
});
