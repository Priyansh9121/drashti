import { expect, test } from '@playwright/test';
import { launchApp, openLibrary, operatorPage, operatorReady } from './helpers';

// Supplemental Mac/Windows reaction proof: raise SQLite's real full-drive code at the native
// statement boundary. The historical 300 MB Mac image probe remains the physical ENOSPC proof.
for (const code of ['SQLITE_FULL', 'ENOSPC']) {
  test(`a ${code} words save keeps the editor usable and saves once after space returns`, async () => {
    const { app } = await launchApp();
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      await openLibrary(win);
      await win.getByRole('button', { name: 'New…', exact: true }).click();
      const editor = win.getByTestId('words-editor');
      const name = `Placeholder ${code} words`;
      const words = 'Placeholder words kept after a full drive.\n'.repeat(100);
      await editor.getByRole('textbox', { name: 'Name' }).fill(name);
      await editor.getByTestId('words-text').fill(words);
      await app.evaluate((electron, failureCode) => {
        const { createRequire } = process.getBuiltinModule('node:module');
        const Database = createRequire(`${electron.app.getAppPath()}/package.json`)('better-sqlite3') as new (
          path: string,
        ) => { prepare(sql: string): object; close(): void };
        const sample = new Database(':memory:');
        const prototype = Object.getPrototypeOf(sample.prepare('SELECT 1')) as {
          run: (this: { source: string }, ...args: unknown[]) => unknown;
        };
        sample.close();
        const run = prototype.run;
        const control = {
          active: true,
          failures: 0,
          restore: () => {
            prototype.run = run;
          },
        };
        prototype.run = function (...args: unknown[]) {
          if (control.active && /^\s*INSERT INTO presentations\b/iu.test(this.source)) {
            control.failures++;
            throw Object.assign(new Error('Generated full drive'), { code: failureCode });
          }
          return run.apply(this, args);
        };
        (globalThis as { x87WordsDisk?: typeof control }).x87WordsDisk = control;
      }, code);
      const save = editor.getByRole('button', { name: /Make slides/u });
      await save.click();
      await expect(editor.getByRole('alert')).toContainText(/drive.*full|space/iu);
      await expect(editor.getByTestId('words-text')).toHaveValue(words);
      await expect(save).toBeEnabled();
      expect(
        await app.evaluate(() => {
          const control = (globalThis as { x87WordsDisk?: { active: boolean; failures: number } })
            .x87WordsDisk;
          if (!control) throw new Error('The disk fault was not installed');
          control.active = false;
          return control.failures;
        }),
      ).toBe(1);
      await save.click();
      await expect(editor).toHaveCount(0);
      await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toHaveText(name);
      await expect(
        win.getByTestId('presentation-list').getByRole('button', { name: new RegExp(`^${name}`, 'u') }),
      ).toHaveCount(1);
    } finally {
      await app.evaluate(() => {
        (globalThis as { x87WordsDisk?: { restore(): void } }).x87WordsDisk?.restore();
      });
      await app.close();
    }
  });
}
