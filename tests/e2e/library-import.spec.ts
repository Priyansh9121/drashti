import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeOldWordDoc, makeTestDocx } from '../../src/main/import/testing/make-docx';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, dropFiles, launchApp, openLibrary, operatorPage } from './helpers';
import { sizeOperatorWindow } from './window-size';

/*
 * Importing from the operator window: drag files onto the presentation
 * list, go live on what came in, remove it and Undo, and
 * the Import… button. The fixtures are placeholder lyrics written for these tests.
 */

const FIXTURES = join(__dirname, '..', 'fixtures', 'lyrics');

async function outputPage(app: ElectronApplication): Promise<Page> {
  const existing = app.windows().find((w) => w.url().includes('output.html'));
  if (existing) return existing;
  return app.waitForEvent('window', { predicate: (w) => w.url().includes('output.html') });
}

test('drag lyrics onto the library, go live, remove and undo, and keep both versions without a question', async () => {
  const work = mkdtempSync(join(tmpdir(), 'drashti-drop-'));
  const songOne = join(work, 'Placeholder Song One.txt');
  copyFileSync(join(FIXTURES, 'Placeholder Song One.txt'), songOne);

  const { app } = await launchApp();
  const win = await operatorPage(app);
  await openLibrary(win);
  const list = win.getByTestId('presentation-list');
  await expect(list.getByTestId('presentation-row')).toHaveCount(2);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const created = await d.screens.createGroup('Main Hall');
    if (!created.ok) throw new Error(created.message);
    await d.screens.assignDisplay(
      created.snapshot.groups[0]?.id ?? '',
      created.snapshot.displays[0]?.id ?? -1,
      {
        coverOperator: true,
      },
    );
  });
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });

  await dropFiles(win, win.getByTestId('library-drop'), [songOne]);
  const first = list.getByRole('button', { name: /^Placeholder Song One/ });
  await expect(first).toBeVisible();
  await expect(win.getByTestId('import-report')).toHaveCount(0);
  await first.click();

  // Go live on its first slide: the output shows it.
  await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toHaveText(
    'Placeholder Song One',
  );
  // As written: verse 1 (two slides), the chorus, verse 1 again.
  const thumbs = win.getByTestId('slide-thumb');
  await expect(thumbs).toHaveCount(5);
  await thumbs.first().click();
  await expect(output.locator('[data-element]')).toContainText('Placeholder song one, first line');
  await thumbs.nth(2).click();
  await expect(output.locator('[data-run][data-lang="gu"]')).toHaveText('નમૂનાની ટેક');
  await expect(output.locator('[data-run][data-lang="translit"]')).toHaveText('Namūnānī ṭek');

  // Remove it with the Delete key: Drashti asks first, and warns that it is live.
  const item = list.getByRole('button', { name: /^Placeholder Song One/ });
  await item.focus();
  await win.keyboard.press('Delete');
  const confirm = win.getByTestId('remove-confirm');
  await expect(confirm).toContainText('Delete “Placeholder Song One”?');
  await expect(confirm).toContainText('on the screens now');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(list.getByTestId('presentation-row')).toHaveCount(3);
  await item.focus();
  await win.keyboard.press('Backspace');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(list.getByTestId('presentation-row')).toHaveCount(2);
  await expect(win.getByTestId('undo-removal')).toContainText('Deleted “Placeholder Song One”');
  // The slide stays on the screens.
  await expect(output.locator('[data-run][data-lang="gu"]')).toHaveText('નમૂનાની ટેક');

  // Undo brings it back, with its slides.
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/ }).click();
  await expect(list.getByRole('button', { name: /^Placeholder Song One/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toHaveText(
    'Placeholder Song One',
  );
  await expect(thumbs).toHaveCount(5);
  await expect(win.getByTestId('undo-removal')).toHaveCount(0);

  // Edit > Undo does the same (the menu owns Cmd/Ctrl+Z, so text fields keep their own undo).
  await item.focus();
  await win.keyboard.press('Delete');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(list.getByTestId('presentation-row')).toHaveCount(2);
  await chooseMenuItem(app, 'undo');
  await expect(list.getByTestId('presentation-row')).toHaveCount(3);

  // Both versions are kept while the slide already up stays on the output.
  writeFileSync(songOne, '[Verse 1]\nPlaceholder song one, rewritten\n');
  await dropFiles(win, win.getByTestId('library-drop'), [songOne]);
  const result = win.getByTestId('import-result');
  await expect(list.getByRole('button', { name: /^Placeholder Song One \(2\)/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /^Placeholder Song One/ })).toHaveCount(2);
  await expect(result).toContainText('Imported 1 presentation');
  await expect(result.getByRole('button', { name: 'Report' })).toHaveCount(0);
  await expect(win.getByTestId('import-report')).toHaveCount(0);
  await expect(output.locator('[data-run][data-lang="gu"]')).toHaveText('નમૂનાની ટેક');

  // The Import… button opens a system dialog (answered here by the test).
  const songTwo = join(FIXTURES, 'Placeholder Song Two.txt');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, songTwo);
  await win.getByTestId('library-sheet').getByRole('button', { name: 'Import…' }).click();
  await win.getByRole('menuitem', { name: 'Files…' }).click();
  await expect(list.getByRole('button', { name: /^Placeholder Song Two/ })).toBeVisible();

  // Every run was kept, with its report.
  const runs = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.library.listImportRuns()).length,
  );
  expect(runs).toBe(3);
  await app.close();
});

test('Word lyrics (Session 26f): Files… offers a .docx and imports it as lyrics in English, Gujarati and Hindi; an old .doc says what to do', async () => {
  const work = mkdtempSync(join(tmpdir(), 'drashti-word-'));
  const song = join(work, 'Placeholder Word Song.docx');
  writeFileSync(
    song,
    makeTestDocx([
      '[Verse 1]',
      'Placeholder English line',
      'નમૂના ગુજરાતી પંક્તિ',
      '',
      'नमूना हिंदी पंक्ति',
      '',
      { runs: [{ text: 'Placeholder bold line', bold: true }] },
      { table: [['Placeholder cell']] },
    ]),
  );
  const old = join(work, 'Placeholder Old Order.doc');
  writeFileSync(old, makeOldWordDoc());

  const { app } = await launchApp();
  const win = await operatorPage(app);
  await openLibrary(win);
  const list = win.getByTestId('presentation-list');
  await expect(list.getByTestId('presentation-row')).toHaveCount(2);
  // Import… › Files…: the dialog (answered here by the test) offers .docx, never .doc.
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (...args: unknown[]) => {
      const options = args.at(-1) as { filters?: { extensions: string[] }[] };
      (globalThis as { offered?: string[] }).offered = (options.filters ?? []).flatMap((f) => f.extensions);
      return Promise.resolve({ canceled: false, filePaths: [path] });
    };
  }, song);
  await win.getByTestId('library-sheet').getByRole('button', { name: 'Import…' }).click();
  await win.getByRole('menuitem', { name: 'Files…' }).click();
  await expect(list.getByRole('button', { name: /^Placeholder Word Song/ })).toBeVisible();
  const offered = await app.evaluate(() => (globalThis as { offered?: string[] }).offered ?? []);
  expect(offered).toContain('docx');
  expect(offered).not.toContain('doc');

  // Its slides: a paragraph a line, an empty paragraph a new slide, each line in its own language.
  const slides = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const found = (await d.library.listPresentations()).find((p) => p.name === 'Placeholder Word Song');
    const doc = found ? await d.library.getPresentation(found.id) : null;
    return (doc?.groups ?? []).map((g) => [
      g.name,
      g.slides.map((s) =>
        s.slide.elements.flatMap((e) =>
          e.kind === 'text' ? (e.runs ?? [{ text: e.text, lang: e.lang }]).map((r) => [r.text, r.lang]) : [],
        ),
      ),
    ]);
  });
  expect(slides).toEqual([
    [
      'Verse 1',
      [
        [
          ['Placeholder English line\n', 'en'],
          ['નમૂના ગુજરાતી પંક્તિ', 'gu'],
        ],
        [['नमूना हिंदी पंक्ति', 'hi']],
        [['Placeholder bold line', 'en']],
      ],
    ],
  ]);
  const notices = win.getByTestId('import-notice');
  const omitted = notices.filter({ hasText: 'Placeholder Word Song' });
  await expect(omitted).toContainText(
    'Its formatting (bold, colours, sizes, alignment) was left out: the slides take their theme’s look.',
  );
  await expect(omitted).toContainText('A table was left out, and the words in it.');
  await dropFiles(win, win.getByTestId('library-drop'), [old]);
  const refused = notices.filter({ hasText: 'Placeholder Old Order.doc' });
  await expect(refused).toContainText(
    'An old Word document (.doc) is not read: open it in Word and save it as a Word Document (.docx), then import that.',
  );
  await expect(refused.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(win.getByTestId('import-report')).toHaveCount(0);
  await app.close();
});

test('drag a .pro6 presentation in: its text goes live, and Find relinks its missing slide background', async () => {
  const work = mkdtempSync(join(tmpdir(), 'drashti-pp6-drop-'));
  const hymn = join(work, 'Placeholder Hymn.pro6');
  writeFileSync(
    hymn,
    pp6Presentation({
      uuid: 'E2E-HYMN',
      groups: [
        {
          name: 'Verse 1',
          slides: [
            {
              background: { path: '/Volumes/OldMac/Loops/Blue Loop.mov', kind: 'video', loop: true },
              text: [
                {
                  rtf: cocoaRtf([
                    ['નમૂનાની પહેલી પંક્તિ', 80, [255, 255, 255]],
                    ['Namūnānī pahelī paṅkti', 50, [255, 204, 0]],
                  ]),
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  const found = join(work, 'found media');
  mkdirSync(found);
  writeFileSync(join(found, 'Blue Loop.mov'), 'placeholder video bytes');

  const { app } = await launchApp();
  const win = await operatorPage(app);
  await openLibrary(win);
  await expect(win.getByTestId('presentation-list').getByTestId('presentation-row')).toHaveCount(2);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const created = await d.screens.createGroup('Main Hall');
    if (!created.ok) throw new Error(created.message);
    await d.screens.assignDisplay(
      created.snapshot.groups[0]?.id ?? '',
      created.snapshot.displays[0]?.id ?? -1,
      {
        coverOperator: true,
      },
    );
  });
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });

  await dropFiles(win, win.getByTestId('library-drop'), [hymn]);
  const missing = win.getByTestId('import-notice').filter({ hasText: 'Placeholder Hymn' });
  await expect(missing).toContainText('Blue Loop.mov');
  await expect(win.getByTestId('import-report')).toHaveCount(0);

  // Find… uses the selected folder to relink the slide’s missing background by name.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, found);
  await missing.getByRole('button', { name: 'Find…', exact: true }).click();
  await expect
    .poll(() =>
      win.evaluate(async () => {
        const d = (globalThis as PageGlobals).drashti;
        return (await d.library.listMedia()).find((item) => item.name === 'Blue Loop.mov')?.missing;
      }),
    )
    .toBe(false);
  await expect(missing).toHaveCount(0);

  // Its text goes live like any other presentation's.
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Hymn/ })
    .click();
  await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toHaveText(
    'Placeholder Hymn',
  );
  await win.getByTestId('slide-thumb').first().click();
  await expect(output.locator('[data-run][data-lang="gu"]')).toHaveText('નમૂનાની પહેલી પંક્તિ');
  await expect(output.locator('[data-run][data-lang="translit"]')).toHaveText('Namūnānī pahelī paṅkti');
  await app.close();
});

test('a window drop gives each refused file its own notice and retries a repaired deck', async () => {
  const work = mkdtempSync(join(tmpdir(), 'drashti-drop-'));
  const songOne = join(work, 'Placeholder Song One.txt');
  copyFileSync(join(FIXTURES, 'Placeholder Song One.txt'), songOne);
  const damaged = join(work, 'Placeholder damaged.pptx');
  const unknown = join(work, 'Placeholder extra.odt');
  writeFileSync(damaged, Buffer.from('PK\u0003\u0004 placeholder, cut short'));
  writeFileSync(unknown, 'Placeholder words');

  const { app } = await launchApp({ DRASHTI_TEST_DECK_CONVERTER: '1' });
  const win = await operatorPage(app);
  await sizeOperatorWindow(app, win, { width: 1024, height: 645 });
  await openLibrary(win);
  const list = win.getByTestId('presentation-list');
  await expect(list.getByTestId('presentation-row')).toHaveCount(2);

  await dropFiles(win, win.getByTestId('slide-grid'), [songOne], { overlay: false });
  await expect(list.getByRole('button', { name: /^Placeholder Song One/ })).toHaveCount(1);
  await expect(win.getByTestId('import-report')).toHaveCount(0);

  await dropFiles(win, win.getByTestId('live-preview'), [damaged, unknown], { overlay: false });
  const notices = win.getByTestId('import-notice');
  await expect(notices).toHaveCount(2);
  const damagedNotice = notices.filter({ hasText: 'Placeholder damaged.pptx' });
  await expect(damagedNotice).toContainText('This file looks damaged');
  await expect(notices.filter({ hasText: 'Placeholder extra.odt' })).toContainText(
    'Drashti doesn’t read .odt files.',
  );
  await expect(win.getByTestId('import-report')).toHaveCount(0);
  await expect(win.getByTestId('import-result').getByRole('button', { name: 'Report' })).toHaveCount(0);

  writeFileSync(damaged, makeTestPptx([{ color: '1E3A8A', text: 'Placeholder repaired slide', notes: '' }]));
  await damagedNotice.getByRole('button', { name: 'Try again' }).click();
  await expect(list.getByRole('button', { name: /^Placeholder damaged/ })).toBeVisible();
  await expect(damagedNotice).toHaveCount(0);
  await expect(notices.filter({ hasText: 'Placeholder extra.odt' })).toBeVisible();

  const more = Array.from({ length: 5 }, (_, index) => {
    const file = join(work, `Placeholder extra ${String(index)}.odt`);
    writeFileSync(file, 'Placeholder words');
    return file;
  });
  await dropFiles(win, win.getByTestId('live-preview'), more, { overlay: false });
  const stack = win.getByTestId('import-notice-stack');
  await expect(stack.getByTestId('import-notice')).toHaveCount(4);
  await expect(stack.getByText('2 more import notices')).toBeVisible();
  const passThrough = await stack.evaluate((element) =>
    Array.from(element.querySelectorAll('[data-testid="import-notice"] span[title]')).map((line) => {
      const rect = line.getBoundingClientRect();
      const underneath = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return underneath !== null && !element.contains(underneath);
    }),
  );
  expect(passThrough).toEqual([true, true, true, true]);
  await stack.getByRole('button', { name: 'Dismiss all' }).click();
  await expect(stack).toHaveCount(0);
  await app.close();
});
