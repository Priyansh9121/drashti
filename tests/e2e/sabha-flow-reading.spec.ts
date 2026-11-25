import type { Locator } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { NETWORK_ENV, networkOn } from './devices';
import { launchApp, operatorPage, operatorReady } from './helpers';
import {
  chooseInPanel,
  ENGLISH,
  expectNowNext,
  type FlowFixture,
  flowKept,
  GUJARATI,
  HINDI,
  itemOf,
  langsOf,
  LIST,
  lineOf,
  NO_ITEMS,
  NOW_NOT_STARTED,
  nextOf,
  openPanel,
  phoneOnMore,
  SCAN,
  seen,
  seenAll,
  STATUS_PHRASE,
  TYPING_FONT,
  UNREADABLE,
  writeFlows,
} from './sabha-flow';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Sabha flow (alpha.23, QA23-FLOW-1; the owner: "its a pdf, which is also seen in phone mode when paired ... the window
 * should read the pdf, which can be in english, gujarati,and hindi. and say whats on number 1, 2, 3, 4, 5 and so on"):
 * what Drashti reads from a running order, the same in the operator window's panel and on a paired phone. English,
 * Gujarati and Hindi tables and a numbered list, each item in its own language (its lang), a merged cell on every row
 * it covers, the title and the total; and a PDF it cannot read (a scan, fonts with no Unicode map, an old typing font's
 * ASCII, words with no numbered items) said plainly, in the same words on both, with its page alone. Chosen and replaced
 * with the panel's own buttons (Main's file dialog answered by the test), read by the real pictures window. Placeholder
 * PDFs made by the test (tests/e2e/sabha-flow-fixtures.ts), never a real running order.
 */

/** Every word an item shows (its number and each cell that says something). */
const wordsOf = (item: readonly string[]) => item.filter((w) => w.trim() !== '');

/**
 * A read list's rows as lines, each as a person reads it, less the word a phone puts above its Now and Next up rows
 * (those marks are checked by their own attributes, aria-current and data-next).
 */
const linesOf = async (rows: Locator) =>
  (await seenAll(rows)).map((line) => line.replace(/^(?:Now|Next up):?\s*/u, ''));

/** The read list's rows, their words and each word's language, and the title and total, in this view. */
async function expectReadList(
  rows: Locator,
  list: Locator,
  total: Locator,
  f: FlowFixture,
  where: string,
): Promise<void> {
  await expect(rows, where).toHaveCount(f.items.length);
  expect(await linesOf(rows), where).toEqual(f.items.map(lineOf));
  for (const [i, item] of f.items.entries()) {
    const words = wordsOf(item);
    expect(await langsOf(rows.nth(i), words), `${where}, item ${String(i + 1)}`).toEqual(
      words.map(() => f.lang),
    );
  }
  const heads = [f.title, f.subtitle].filter((w): w is string => w !== undefined);
  expect(await langsOf(list, heads), `${where}, its title`).toEqual(heads.map(() => f.lang));
  if (f.total === undefined) await expect(total, where).toHaveCount(0);
  else {
    await expect(total, where).toHaveText(f.total);
    expect(await langsOf(total, [f.total]), `${where}, its total`).toEqual([f.lang]);
  }
}

test('English, Gujarati and Hindi tables and a numbered list, chosen and replaced in the panel: every item as "1 · Program · Details · Duration · Presenter" in its own language on the panel and a paired phone alike, merged cells on each row they cover, the title and the total', async () => {
  test.setTimeout(240_000);
  const files = await writeFlows({ ENGLISH, GUJARATI, HINDI, LIST });
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const { base } = await networkOn(win);
  const phone = await phoneOnMore(win, base, 'chromium', 'Placeholder phone');
  const p = phone.page;
  try {
    await p.setViewportSize({ width: 390, height: 844 });
    const panel = await openPanel(win);
    let sheet: Locator | null = null;
    for (const [key, f] of [
      ['ENGLISH', ENGLISH],
      ['GUJARATI', GUJARATI],
      ['HINDI', HINDI],
      ['LIST', LIST],
    ] as const) {
      await chooseInPanel(app, panel, files[key], f.fileName);
      expect(await flowKept(win), f.fileName).toEqual({ fileName: f.fileName, status: 'read' });

      // The panel: each item in order, its words in the PDF's language, the title and the total.
      await expectReadList(
        panel.getByTestId('flow-row'),
        panel.getByTestId('flow-read-list'),
        panel.getByTestId('flow-total'),
        f,
        `the panel, ${f.fileName}`,
      );
      // Nothing marked yet: Next up is the first item, in full and in its own language, inside Drashti's words.
      const first = itemOf(f, 0);
      const section = p.getByTestId('remote-flow');
      await expectNowNext(panel, section, NOW_NOT_STARTED, nextOf(first));
      expect(await langsOf(panel.getByTestId('flow-next'), wordsOf(first)), 'the panel’s Next up').toEqual(
        wordsOf(first).map(() => f.lang),
      );
      expect(
        await langsOf(section.getByTestId('remote-flow-next'), wordsOf(first)),
        'a phone’s Next up',
      ).toEqual(wordsOf(first).map(() => f.lang));

      // The phone: its sheet opened once, then following each PDF chosen on the computer, on its read list.
      if (sheet === null) {
        await expect(section.getByTestId('remote-flow-file')).toHaveText(f.fileName);
        await section.getByTestId('remote-open-flow').click();
        sheet = p.getByTestId('remote-flow-sheet');
        await expect(sheet).toBeVisible();
      }
      await expect(sheet.getByTestId('remote-flow-sheet-file')).toHaveText(f.fileName);
      await expect(sheet.getByTestId('remote-flow-view-list')).toHaveAttribute('aria-selected', 'true');
      await expectReadList(
        sheet.getByTestId('remote-flow-row'),
        sheet.getByTestId('remote-flow-list'),
        sheet.getByTestId('remote-flow-total'),
        f,
        `a phone, ${f.fileName}`,
      );
    }
  } finally {
    await phone.close();
    await app.close();
  }
});

test('A PDF Drashti cannot read is said so plainly, in the same words on the panel and a paired phone, with its page alone and no Now or Next up: a scan, fonts with no Unicode map, an old typing font’s ASCII, words with no numbered items; a readable one brings the read list back on both', async () => {
  test.setTimeout(240_000);
  const files = await writeFlows({ ENGLISH, SCAN, UNREADABLE, TYPING_FONT, NO_ITEMS });
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const { base } = await networkOn(win);
  const phone = await phoneOnMore(win, base, 'chromium', 'Placeholder phone');
  const p = phone.page;
  try {
    await p.setViewportSize({ width: 390, height: 844 });
    const panel = await openPanel(win);
    const section = p.getByTestId('remote-flow');
    await chooseInPanel(app, panel, files.ENGLISH, ENGLISH.fileName);
    await expect(panel.getByTestId('flow-row')).toHaveCount(ENGLISH.items.length);
    await expect(section.getByTestId('remote-flow-now-next')).toBeVisible();

    for (const [key, f] of [
      ['SCAN', SCAN],
      ['UNREADABLE', UNREADABLE],
      ['TYPING_FONT', TYPING_FONT],
      ['NO_ITEMS', NO_ITEMS],
    ] as const) {
      if (f.status === 'read') throw new Error(`${f.fileName} is meant not to be read`);
      const phrase = STATUS_PHRASE[f.status];
      await chooseInPanel(app, panel, files[key], f.fileName);
      expect(await flowKept(win), f.fileName).toEqual({ fileName: f.fileName, status: f.status });

      // The panel: said in plain words; no read list, no views to choose between, no Now or Next up; its page drawn.
      const status = panel.getByTestId('flow-status');
      await expect(status, f.fileName).toContainText(phrase);
      const words = await seen(status);
      await expect(panel.getByTestId('flow-row'), f.fileName).toHaveCount(0);
      await expect(panel.getByTestId('flow-read-list'), f.fileName).toHaveCount(0);
      await expect(panel.getByRole('tablist'), f.fileName).toHaveCount(0);
      await expect(panel.getByTestId('flow-now-next'), f.fileName).toHaveCount(0);
      const page = panel.getByTestId('flow-page');
      await expect(page, f.fileName).toHaveCount(1, { timeout: 30_000 });
      await expect
        .poll(() => page.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), {
          message: `${f.fileName}: its page drawn in the panel`,
        })
        .toBe(true);

      // The phone, in More: the same file and the same words, and no Now or Next up.
      await expect(section.getByTestId('remote-flow-file'), f.fileName).toHaveText(f.fileName);
      await expect
        .poll(() => seen(section.getByTestId('remote-flow-said')), { message: f.fileName })
        .toBe(words);
      await expect(section.getByTestId('remote-flow-now-next'), f.fileName).toHaveCount(0);
      // Its sheet: the same words, no read list to choose, the page as the computer drew it.
      await section.getByTestId('remote-open-flow').click();
      const sheet = p.getByTestId('remote-flow-sheet');
      await expect(sheet).toBeVisible();
      await expect
        .poll(() => seen(sheet.getByTestId('remote-flow-status')), { message: f.fileName })
        .toBe(words);
      await expect(sheet.getByTestId('remote-flow-view-list'), f.fileName).toHaveCount(0);
      await expect(sheet.getByTestId('remote-flow-row'), f.fileName).toHaveCount(0);
      await expect(sheet.getByTestId('remote-flow-now-next'), f.fileName).toHaveCount(0);
      const picture = sheet.getByTestId('remote-flow-picture');
      await expect
        .poll(
          () =>
            picture.evaluate(
              (img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0,
            ),
          { message: `${f.fileName}: its page drawn on the phone` },
        )
        .toBe(true);
      await sheet.getByTestId('remote-flow-sheet-close').click();
      await expect(sheet).toHaveCount(0);
    }

    // A readable one again: the read list, Now and Next up back on both, the plain words gone.
    await chooseInPanel(app, panel, files.ENGLISH, ENGLISH.fileName);
    await expect(panel.getByTestId('flow-status')).toHaveCount(0);
    await expect(panel.getByTestId('flow-row')).toHaveCount(ENGLISH.items.length);
    await expect(section.getByTestId('remote-flow-said')).toHaveCount(0);
    await expectNowNext(panel, section, NOW_NOT_STARTED, nextOf(itemOf(ENGLISH, 0)));
  } finally {
    await phone.close();
    await app.close();
  }
});
