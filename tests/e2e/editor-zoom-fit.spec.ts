import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues, settled } from './a11y';
import { expectFits } from './fit';
import { smallestContent } from './fit-sweep';
import {
  editorGroup,
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  sizeSlideEditor,
  slideEditorWindow,
  type PageGlobals,
} from './helpers';
import { generatedPdf, PDF_PAGES } from './pdf-tools-fixtures';
import { CI_WINDOW } from './window-size';

const GROUPS = ['Words', 'Insert', 'Arrange', 'Design', 'Motion', 'Slides'] as const;

/** A placeholder presentation (native words or a generated PDF) in `mode`, open in the slide editor's window. */
async function openEditor(
  mode: 'pro' | 'simple',
  format: 'native' | 'PDF',
): Promise<{ app: ElectronApplication; ed: Page; editor: Locator }> {
  const { app, userData } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const file = join(userData, `Placeholder zoom.${format === 'PDF' ? 'pdf' : 'txt'}`);
    writeFileSync(file, format === 'PDF' ? generatedPdf(PDF_PAGES) : '[Verse]\nPlaceholder zoom words\n');
    const [id] = await importAndGetIds(win, [file]);
    if (!id) throw new Error('Placeholder presentation did not import');
    const opened = await win.evaluate(
      async ({ id, mode }) => {
        const d = (globalThis as PageGlobals).drashti;
        // Simple Mode permits editing presentations belonging to its playlist.
        const list = await d.playlists.create('Placeholder zoom playlist', null, false);
        if (!list.ok || !list.ids[0]) throw new Error('No placeholder playlist');
        const added = await d.playlists.addItems(list.ids[0], null, [
          { kind: 'presentation', presentationId: id },
        ]);
        if (!added.ok) throw new Error(added.message);
        const changed = await d.app.setMode(mode);
        if (!changed.ok) throw new Error(changed.message);
        return d.slideEditor.open(id, null);
      },
      { id, mode },
    );
    expect(opened.ok).toBe(true);
    const { ed, editor } = await slideEditorWindow(app);
    return { app, ed, editor };
  } catch (error) {
    await app.close();
    throw error;
  }
}

/** Each control along the editor's top that sits on a row below the first one, by its name. */
function belowTheFirstRow(header: Locator): Promise<string[]> {
  return header.evaluate((top) => {
    const boxes = [...top.children]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0);
    const firstBottom = Math.min(...boxes.map(({ r }) => r.bottom));
    return boxes
      .filter(({ r }) => r.top >= firstBottom - 0.5)
      .map(({ el, r }) => {
        const name =
          el.getAttribute('aria-label') ??
          el.querySelector('button')?.getAttribute('aria-label') ??
          el.textContent.trim();
        return `${name} is on a row below (its top ${Math.round(r.top)}, the first row ends at ${Math.round(firstBottom)})`;
      });
  });
}

// At 100% the top is one row wherever its commands fit on one (a22-review-x96 M1): in Pro Mode, a native
// presentation's top (Undo, Redo, Translate…, Save a PDF copy…, Cancel, Done) fits CI's 1024 × 645 and the window's
// least (884 inside on Windows, 900 on the Mac) on one row, as on phase1 and in the guides' pictures.
test('at 100% the native editor’s top stays one row in Pro Mode, at CI’s 1024 × 645 and at the window’s least, in every group', async () => {
  test.setTimeout(150_000);
  const { app, ed, editor } = await openEditor('pro', 'native');
  try {
    const header = editor.locator('header');
    for (const size of [CI_WINDOW, await smallestContent(app, 'slide-editor.html')]) {
      await sizeSlideEditor(app, ed, size);
      for (const group of GROUPS) {
        await editorGroup(ed, group);
        await settled(ed);
        expect.soft(await belowTheFirstRow(header), `${group} at ${size.width} × ${size.height}`).toEqual([]);
      }
      await expectFits(header, `the top at ${size.width} × ${size.height}`);
    }
  } finally {
    await app.close();
  }
});

for (const mode of ['pro', 'simple'] as const)
  for (const format of ['native', 'PDF'] as const)
    test(`the ${format} editor top row fits at 200% in ${mode} mode, with every command reachable`, async () => {
      const { app, ed, editor } = await openEditor(mode, format);
      try {
        await sizeSlideEditor(app, ed, { width: 1024, height: 645 });
        await app.evaluate(({ webContents }) => {
          const page = webContents.getAllWebContents().find((w) => w.getURL().includes('slide-editor.html'));
          if (!page) throw new Error('No editor page');
          page.setZoomFactor(2);
        });
        // The zoom has landed: the page is half as wide in CSS pixels (every check below passes at 100% too).
        await expect.poll(() => ed.evaluate(() => innerWidth)).toBe(512);
        const header = editor.locator('header');
        await expectFits(header, `${format}, ${mode}: top row and whole page at 200%`);
        await expectNoSeriousA11yIssues(ed, `${format} editor at 200% in ${mode} mode`);
        // All tabs work by pointer and their native arrow-key navigation, without sideways page scrolling.
        const tabs = header.getByRole('tab');
        const count = await tabs.count();
        for (let i = 0; i < count; i++) {
          const tab = tabs.nth(i);
          await tab.click();
          await expect(tab).toBeFocused();
          await ed.keyboard.press('ArrowRight');
          await expect(tabs.nth((i + 1) % count)).toBeFocused();
          await expectFits(header, 'Each editor group keeps the top row within the zoomed page');
        }
        // Trial clicks prove pointer hit targets without invoking exports or closing the editor.
        const buttons = header.getByRole('button');
        for (let i = 0; i < (await buttons.count()); i++) {
          const button = buttons.nth(i);
          if (await button.isDisabled()) continue;
          await button.click({ trial: true });
          await button.focus();
          await expect(button).toBeFocused();
          await ed.keyboard.press('Tab');
          await ed.keyboard.press('Shift+Tab');
          await expect(button).toBeFocused();
        }
        await expectFits(header, 'Pointer and keyboard access never scroll the page sideways');
      } finally {
        await app.close();
      }
    });
