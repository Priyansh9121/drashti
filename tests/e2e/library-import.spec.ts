import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import type { PageGlobals } from './helpers';
import { launchApp } from './helpers';

/*
 * Importing from the operator window: drag files onto the presentation
 * list, read the report, go live on what came in, remove it and Undo, and
 * the Import… button. The fixtures are placeholder lyrics written for these tests.
 */

const FIXTURES = join(__dirname, '..', 'fixtures', 'lyrics');

async function outputPage(app: ElectronApplication): Promise<Page> {
  const existing = app.windows().find((w) => w.url().includes('output.html'));
  if (existing) return existing;
  return app.waitForEvent('window', { predicate: (w) => w.url().includes('output.html') });
}

/**
 * Drop files from disk onto an element, as a drag from the desktop does. A file
 * input gives the page File objects backed by the real files, so the preload
 * can tell their paths; they are then dropped with a DataTransfer.
 */
async function dropFiles(page: Page, target: Locator, paths: string[]): Promise<void> {
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.id = 'e2e-drop-source';
    input.style.display = 'none';
    document.body.appendChild(input);
  });
  await page.setInputFiles('#e2e-drop-source', paths);
  const dataTransfer = await page.evaluateHandle(() => {
    const input = document.getElementById('e2e-drop-source') as HTMLInputElement;
    const dt = new DataTransfer();
    for (const file of Array.from(input.files ?? [])) dt.items.add(file);
    input.remove();
    return dt;
  });
  await target.dispatchEvent('dragenter', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  await expect(page.getByTestId('drop-overlay')).toBeVisible();
  await target.dispatchEvent('drop', { dataTransfer });
  await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
}

test('drag lyrics onto the library, read the report, go live, remove and undo, import with the button', async () => {
  const work = mkdtempSync(join(tmpdir(), 'drashti-drop-'));
  const songOne = join(work, 'Placeholder Song One.txt');
  copyFileSync(join(FIXTURES, 'Placeholder Song One.txt'), songOne);

  const { app } = await launchApp();
  const win = await app.firstWindow();
  const list = win.getByTestId('presentation-list');
  await expect(list.getByRole('button')).toHaveCount(2);
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
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');

  // Drop the file: it is imported, and (nothing is live yet) the report comes up by itself.
  await dropFiles(win, win.getByTestId('library-drop'), [songOne]);
  const report = win.getByTestId('import-report');
  await expect(report).toBeVisible();
  await expect(report.getByTestId('report-summary')).toContainText(
    'Came across: 1 presentation · 2 groups · 3 slides · 1 arrangement.',
  );
  await expect(report.getByTestId('report-item')).toHaveCount(1);
  await report.getByTestId('report-item').getByRole('button', { name: 'Open' }).click();
  await expect(report).toHaveCount(0);
  await expect(list.getByRole('button', { name: /Placeholder Song One/ })).toHaveAttribute(
    'aria-current',
    'true',
  );

  // Go live on its first slide: the output shows it.
  await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toHaveText(
    'Placeholder Song One',
  );
  const thumbs = win.getByTestId('slide-thumb');
  await expect(thumbs).toHaveCount(3);
  await thumbs.first().click();
  await expect(output.locator('[data-element]')).toContainText('Placeholder song one, first line');
  await thumbs.nth(2).click();
  await expect(output.locator('[data-run][data-lang="gu"]')).toHaveText('નમૂનાની ટેક');
  await expect(output.locator('[data-run][data-lang="translit"]')).toHaveText('Namūnānī ṭek');

  // Remove it with the Delete key: Drashti asks first, and warns that it is live.
  const item = list.getByRole('button', { name: /Placeholder Song One/ });
  await item.focus();
  await win.keyboard.press('Delete');
  const confirm = win.getByTestId('remove-confirm');
  await expect(confirm).toContainText('Remove “Placeholder Song One”?');
  await expect(confirm).toContainText('on the screens now');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(list.getByRole('button')).toHaveCount(3);
  await item.focus();
  await win.keyboard.press('Backspace');
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(list.getByRole('button')).toHaveCount(2);
  await expect(win.getByTestId('undo-removal')).toContainText('Removed “Placeholder Song One”');
  // The slide stays on the screens.
  await expect(output.locator('[data-run][data-lang="gu"]')).toHaveText('નમૂનાની ટેક');

  // Undo brings it back, with its slides.
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/ }).click();
  await expect(list.getByRole('button', { name: /Placeholder Song One/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toHaveText(
    'Placeholder Song One',
  );
  await expect(thumbs).toHaveCount(3);
  await expect(win.getByTestId('undo-removal')).toHaveCount(0);

  // Edit > Undo does the same (the menu owns Cmd/Ctrl+Z, so text fields keep their own undo).
  await item.focus();
  await win.keyboard.press('Delete');
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(list.getByRole('button')).toHaveCount(2);
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('undo')?.click();
  });
  await expect(list.getByRole('button')).toHaveCount(3);

  // The file changes and is dropped again. A slide is live, so the report waits to be opened.
  writeFileSync(songOne, '[Verse 1]\nPlaceholder song one, rewritten\n');
  await dropFiles(win, win.getByTestId('library-drop'), [songOne]);
  const result = win.getByTestId('import-result');
  await expect(result).toContainText('1 file changed: choose what to do');
  await expect(report).toHaveCount(0);
  await result.getByRole('button', { name: 'Report' }).click();
  const changed = report.getByTestId('report-item').filter({ hasText: 'Placeholder Song One' });
  await expect(changed).toHaveAttribute('data-outcome', 'conflict');
  await changed.getByRole('button', { name: 'Keep both' }).click();
  await expect(list.getByRole('button', { name: /Placeholder Song One \(2\)/ })).toBeVisible();
  await expect(result).toContainText('Imported 1 presentation');

  // The Import… button opens a system dialog (answered here by the test).
  const songTwo = join(FIXTURES, 'Placeholder Song Two.txt');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, songTwo);
  await win.getByRole('button', { name: 'Import…' }).click();
  await win.getByRole('menuitem', { name: 'Files…' }).click();
  await expect(list.getByRole('button', { name: /Placeholder Song Two/ })).toBeVisible();

  // Every run was kept, with its report.
  const runs = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.library.listImportRuns()).length,
  );
  expect(runs).toBe(4);
  await app.close();
});

test('drag a .pro6 presentation in: its text goes live, and missing media is found from the report', async () => {
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
  const win = await app.firstWindow();
  await expect(win.getByTestId('presentation-list').getByRole('button')).toHaveCount(2);
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
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');

  await dropFiles(win, win.getByTestId('library-drop'), [hymn]);
  const report = win.getByTestId('import-report');
  await expect(report.getByTestId('report-summary')).toContainText(
    'Came across: 1 presentation · 1 group · 1 slide',
  );
  await expect(report.getByTestId('missing-media')).toContainText('1 media file could not be found');

  // "Find missing media…" asks for a folder (answered here by the test) and relinks by name.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, found);
  await report.getByRole('button', { name: 'Find missing media…' }).click();
  await expect(report.getByTestId('report-item')).toHaveAttribute('data-outcome', 'imported');
  await expect(report.getByTestId('report-item')).toContainText('Relinked to');
  await report.getByRole('button', { name: 'Close' }).click();

  // Its text goes live like any other presentation's.
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Placeholder Hymn/ })
    .click();
  await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toHaveText(
    'Placeholder Hymn',
  );
  await win.getByTestId('slide-thumb').first().click();
  await expect(output.locator('[data-run][data-lang="gu"]')).toHaveText('નમૂનાની પહેલી પંક્તિ');
  await expect(output.locator('[data-run][data-lang="translit"]')).toHaveText('Namūnānī pahelī paṅkti');
  await app.close();
});
