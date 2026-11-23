import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  sizeSlideEditor,
  slideEditorWindow,
  type PageGlobals,
} from './helpers';
import { generatedPdf, PDF_PAGES } from './pdf-tools-fixtures';

for (const mode of ['pro', 'simple'] as const)
  for (const format of ['native', 'PDF'] as const)
    test(`the ${format} editor top row fits at 200% in ${mode} mode, with every command reachable`, async () => {
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
        await sizeSlideEditor(app, ed, { width: 1024, height: 645 });
        await app.evaluate(({ webContents }) => {
          const page = webContents.getAllWebContents().find((w) => w.getURL().includes('slide-editor.html'));
          if (!page) throw new Error('No editor page');
          page.setZoomFactor(2);
        });
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
