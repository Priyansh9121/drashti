import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { WORDS_PRINT_REFUSED } from '../../src/shared/words-print';
import { launchApp, openLibrary, operatorPage, operatorReady, type PageGlobals } from './helpers';

/*
 * A singers' sheet (alpha.22; the owner's "Yes, build them", 24 Nov 2026): a presentation's right-click menu in the
 * library has Print words… and Save words as PDF… (Pro Mode). The page is its words group by group, in its language
 * tracks in its own order, with a kirtan's kavi and raag, printed from the Manual's hidden window; refused in words while
 * anything is up, on air or recording; refused in Simple Mode. The seeded sample kirtan's placeholder words only.
 */

const KIRTAN = 'Sample kirtan (placeholder)';

/** A PDF's pages, counted as the setup kit's printout counts them (its page objects, and its tree's count). */
function pdfPages(file: string): number {
  const text = readFileSync(file).toString('latin1');
  const pages = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/gu) ?? []).length;
  const counts = [...text.matchAll(/\/Count\s+(\d+)/gu)].map((m) => Number(m[1]));
  return Math.max(pages, ...counts);
}

interface Printed {
  title: string;
  groups: string[];
  text: string;
}

test('a library presentation’s right-click menu prints its words and saves them as a PDF where you choose, group by group in its language tracks with kavi and raag; refused in words while anything is up or on air, and in Simple Mode', async () => {
  test.setTimeout(120_000);
  const folder = mkdtempSync(join(tmpdir(), 'drashti-words-'));
  const pdf = join(folder, 'Placeholder words.pdf');
  // A test can say the stream is on air (DRASHTI_TEST_ON_AIR_HOOK), as the manual's print test does.
  const { app } = await launchApp({ DRASHTI_TEST_ON_AIR_HOOK: '1' });
  // The system's save dialog answers with the file above (and says where it offered first); the system's print
  // dialog is never shown: what Print words… sends is written down instead, from the page it prints.
  await app.evaluate(({ app: electronApp, dialog }, path) => {
    const g = globalThis as { drashtiOffered?: string[]; drashtiPrinted?: Printed[] };
    g.drashtiOffered = [];
    g.drashtiPrinted = [];
    dialog.showSaveDialog = (...args: unknown[]) => {
      const options = args.find(
        (a): a is { defaultPath?: string } => typeof a === 'object' && a !== null && 'defaultPath' in a,
      );
      g.drashtiOffered?.push(options?.defaultPath ?? '');
      return Promise.resolve({ canceled: false, filePath: path });
    };
    electronApp.on('browser-window-created', (_event, w) => {
      w.webContents.print = (_options: unknown, callback?: (success: boolean, why: string) => void) => {
        void w.webContents
          .executeJavaScript(
            '[document.title, [...document.querySelectorAll("h2")].map((h) => h.textContent), document.body.innerText]',
          )
          .then(([title, groups, text]: [string, string[], string]) => {
            g.drashtiPrinted?.push({ title, groups, text });
            callback?.(true, '');
          });
      };
    });
  }, pdf);
  const offered = () =>
    app.evaluate(() => (globalThis as { drashtiOffered?: string[] }).drashtiOffered ?? []);
  const win = await operatorPage(app);
  await operatorReady(win);
  const sheet = await openLibrary(win);
  const row = sheet.getByTestId('presentation-row').filter({ hasText: KIRTAN });
  const choose = async (name: string) => {
    await row.click({ button: 'right' });
    await win.getByRole('menuitem', { name, exact: true }).click();
  };
  // The notice's own words (its card also holds Report this… and Dismiss).
  const notice = win.getByTestId('operator-notice').locator('p');
  const kirtanId = await win.evaluate(
    async (name) =>
      (await (globalThis as PageGlobals).drashti.library.listPresentations()).find((p) => p.name === name)
        ?.id ?? '',
    KIRTAN,
  );
  expect(kirtanId).not.toBe('');
  /** Both requests as the window sends them, with nothing chosen in a menu. */
  const askBoth = () =>
    win.evaluate(async (id) => {
      const d = (globalThis as PageGlobals).drashti;
      return [await d.library.printWords(id), await d.library.saveWordsPdf(id)];
    }, kirtanId);
  const refusedBoth = (message: string) => [
    { ok: false, cancelled: false, message },
    { ok: false, cancelled: false, message },
  ];

  // Save words as PDF…: where you choose, suggested as "<name> words.pdf".
  await choose('Save words as PDF…');
  await expect(notice).toContainText(`Saved the words of “${KIRTAN}” as a PDF: Placeholder words.pdf`, {
    timeout: 60_000,
  });
  const asked = await offered();
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatch(/Sample kirtan \(placeholder\) words\.pdf$/u);
  expect(existsSync(pdf)).toBe(true);
  expect(readFileSync(pdf).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdfPages(pdf)).toBeGreaterThanOrEqual(1);
  expect(statSync(pdf).size).toBeGreaterThan(2_000);

  // Print words…: the same page, through the system's print dialog: its groups in order, its tracks, kavi and raag.
  await choose('Print words…');
  await expect
    .poll(() => app.evaluate(() => (globalThis as { drashtiPrinted?: Printed[] }).drashtiPrinted ?? []), {
      timeout: 60_000,
    })
    .toHaveLength(1);
  const [printed] = await app.evaluate(
    () => (globalThis as { drashtiPrinted?: Printed[] }).drashtiPrinted ?? [],
  );
  expect(printed?.title).toBe(KIRTAN);
  expect(printed?.groups).toEqual(['Verse 1', 'Chorus', 'Verse 2']);
  const text = printed?.text ?? '';
  expect(text).toContain('Kavi: Placeholder Kavi');
  expect(text).toContain('Raag: Placeholder Raag');
  // Each slide's lines in the kirtan's track order: Gujarati, Hindi, the Roman reading, then the meaning.
  const lines = [
    'નમૂનાની પહેલી પંક્તિ',
    'नमूने की पहली पंक्ति',
    'Namūnānī pahelī paṅkti',
    'Placeholder verse, first line',
  ];
  const at = lines.map((l) => text.indexOf(l));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  await expect(notice).toHaveText(`The words of “${KIRTAN}” went to the printer.`);

  // Something up: refused in words, nothing asked and nothing printed.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const first = (await d.library.listPresentations())[0];
    if (!first) throw new Error('No presentation to put up');
    await d.engine.dispatch({ type: 'goLive', presentationId: first.id, slideIndex: 0 });
  });
  await expect(win.getByTestId('live-text')).toContainText('Live:');
  await choose('Save words as PDF…');
  await expect(notice).toHaveText(WORDS_PRINT_REFUSED);
  expect(await askBoth()).toEqual(refusedBoth(WORDS_PRINT_REFUSED));
  expect(await offered()).toHaveLength(1);
  // Nothing up, but on air (as the main process sees it): refused the same way.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearAll' }));
  await app.evaluate(() => {
    (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(true);
  });
  expect(await askBoth()).toEqual(refusedBoth(WORDS_PRINT_REFUSED));
  expect(await offered()).toHaveLength(1);
  await app.evaluate(() => {
    (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(false);
  });
  expect(
    await app.evaluate(() => (globalThis as { drashtiPrinted?: Printed[] }).drashtiPrinted ?? []),
  ).toHaveLength(1);

  // Simple Mode: the main process refuses both, asking nothing (its menu never has them: words-print.test.ts).
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  expect(await askBoth()).toEqual(refusedBoth(SIMPLE_MODE_REFUSAL));
  expect(await offered()).toHaveLength(1);
  expect(
    await app.evaluate(() => (globalThis as { drashtiPrinted?: Printed[] }).drashtiPrinted ?? []),
  ).toHaveLength(1);
  await app.close();
  rmSync(folder, { recursive: true, force: true });
});
