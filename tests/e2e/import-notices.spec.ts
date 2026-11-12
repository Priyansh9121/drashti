import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deckWithOldFonts } from '../../src/main/import/testing/deck-font-fixture';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  chooseMenuItem,
  closeLibrary,
  dropFiles,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
} from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Words typed in an old (legacy) Gujarati or Hindi font (Session 57, alpha.17): since the import report went, nothing
 * named the fonts to install. An import names its old fonts in one notice line, each font once however many of its
 * presentations use it, saying to install them on this computer and on each node (which draws these slides itself);
 * a later import's line naming every one of them takes its place. The line stands with the other import notices in the
 * window's bottom-right corner, never in the way, with no Try again and no Find…, above a refused file's own line,
 * which keeps its Try again; unlike the others, its words are drawn whole, wrapping, for the admin to write the fonts
 * down (the review of 12 Nov). The presentations come in as ever. Simple Mode imports none of these files (lyrics and
 * the other program's files are Pro Mode's), so its corner shows the lines Pro Mode's import left. In CI's window,
 * about 1024 × 645. Placeholder font names and words only.
 */

const GOPIKA = 'Placeholder Gopika';
const KRUTI_DEV = 'Placeholder Kruti Dev';
const INSTALL_THEM =
  'install them on this computer and on each node, then quit and start Drashti again on each.';

/** A ProPresenter 6 presentation with a slide of placeholder words in each of these fonts. */
function presentationIn(dir: string, name: string, uuid: string, fonts: string[]): string {
  const file = join(dir, `${name}.pro6`);
  writeFileSync(
    file,
    pp6Presentation({
      uuid,
      groups: [
        {
          name: 'Verse',
          uuid: `${uuid}-G`,
          slides: fonts.map((font) => ({
            text: [{ rtf: cocoaRtf([['Placeholder old font words', 72, [255, 255, 255]]], 'qc', font) }],
          })),
        },
      ],
    }),
  );
  return file;
}

/**
 * The import notices in the window's bottom-right corner, just above the bars at its foot, as every notice is (the
 * owner, 11 Nov 2026), each line's words letting a click through to what is under them.
 */
async function expectInTheCorner(
  win: Page,
  bars: 'layer-bar' | 'simple-buttons',
  lines: number,
): Promise<void> {
  const stack = win.getByTestId('import-notice-stack');
  await expect(stack.getByTestId('import-notice')).toHaveCount(lines);
  // The corner the notices stand in (the stack, and under it any other notice) and the bars, read together.
  await expect
    .poll(() =>
      win.evaluate((id) => {
        const corner = document
          .querySelector('[data-testid="import-notice-stack"]')
          ?.parentElement?.getBoundingClientRect();
        const foot = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
        if (!corner || !foot) return 'not drawn';
        const right = document.documentElement.clientWidth - corner.right;
        const above = foot.top - corner.bottom;
        return right <= 24 && above >= 0 && above <= 16
          ? 'in the corner'
          : `${String(right)} px from the right, ${String(above)} px above the bars`;
      }, bars),
    )
    .toBe('in the corner');
  const through = await stack.evaluate((element) =>
    Array.from(
      element.querySelectorAll('[data-testid="import-notice"] span[title], [data-testid="import-notice"] p'),
    ).map((line) => {
      const rect = line.getBoundingClientRect();
      const under = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return under !== null && !element.contains(under);
    }),
  );
  expect(through).toEqual(Array.from({ length: lines }, () => true));
}

/** Whether a notice's words are all in sight: none run out of their box, cut off with an ellipsis. */
const shownWhole = (line: Locator) =>
  line.evaluate((element) => {
    const words = element.querySelector('p, span[title]');
    return (
      words !== null && words.scrollWidth <= words.clientWidth && words.scrollHeight <= words.clientHeight
    );
  });

test('an import names its old fonts in one notice, drawn whole, bottom right in Pro Mode and in Simple Mode, with no Try again, above a refused file’s', async () => {
  const work = mkdtempSync(join(tmpdir(), 'drashti-old-font-'));
  const hymn = presentationIn(work, 'Placeholder Old Hymn', 'E2E-OLD-FONT-HYMN', [GOPIKA, KRUTI_DEV]);
  const song = presentationIn(work, 'Placeholder Old Song', 'E2E-OLD-FONT-SONG', [GOPIKA]);
  const prayer = presentationIn(work, 'Placeholder Old Prayer', 'E2E-OLD-FONT-PRAYER', [KRUTI_DEV, GOPIKA]);
  // A deck cut short: refused, with Try again (as in library-import.spec.ts).
  const damaged = join(work, 'Placeholder Old Damaged.pptx');
  writeFileSync(damaged, Buffer.from('PK\u0003\u0004 placeholder, cut short'));

  const { app } = await launchApp({ DRASHTI_TEST_DECK_CONVERTER: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await openLibrary(win);
  const list = win.getByTestId('presentation-list');
  const notices = win.getByTestId('import-notice');
  const fonts = notices.filter({ hasText: 'old fonts' });
  const refused = notices.filter({ hasText: 'Placeholder Old Damaged' });

  // One import: two presentations in old fonts and a refused deck. The old fonts share one line, each named once,
  // above the refused deck's own line, which keeps its Try again.
  await dropFiles(win, win.getByTestId('library-drop'), [hymn, song, damaged]);
  await expect(list.getByRole('button', { name: /^Placeholder Old Hymn/u })).toBeVisible();
  await expect(list.getByRole('button', { name: /^Placeholder Old Song/u })).toBeVisible();
  await expect(notices).toHaveCount(2);
  await expect(notices.first()).toContainText(
    `and 1 more · These presentations use the old fonts “${GOPIKA}” and “${KRUTI_DEV}”: ${INSTALL_THEM}`,
  );
  await expect(refused).toContainText('This file looks damaged');
  await expect(refused.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(fonts.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(fonts.getByRole('button', { name: 'Find…' })).toHaveCount(0);
  // Every font and what to do in sight: the line is drawn whole, wrapping, never cut off.
  await expect.poll(() => shownWhole(fonts)).toBe(true);

  // Another import naming both fonts: its line takes the earlier one's place, at the top.
  await dropFiles(win, win.getByTestId('library-drop'), [prayer]);
  await expect(list.getByRole('button', { name: /^Placeholder Old Prayer/u })).toBeVisible();
  await expect(notices.first()).toContainText(
    `“Placeholder Old Prayer” · This presentation uses the old fonts “${KRUTI_DEV}” and “${GOPIKA}”: ${INSTALL_THEM}`,
  );
  await expect(fonts).toHaveCount(1);
  await expect(notices).toHaveCount(2);

  // Pro Mode: bottom right, never in the way.
  await closeLibrary(win);
  await expectInTheCorner(win, 'layer-bar', 2);
  await expectNoSeriousA11yIssues(win, 'the old-font notice', '[data-testid="import-notice-stack"]');

  // Simple Mode: the same lines in its own bottom-right corner, the old fonts' still with nothing to try again.
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expectInTheCorner(win, 'simple-buttons', 2);
  await expect(fonts).toContainText('on each node');
  await expect.poll(() => shownWhole(fonts)).toBe(true);
  await expect(fonts.getByRole('button', { name: 'Try again' })).toHaveCount(0);

  // Dismissed like any other; the refused deck's line stays.
  await fonts.getByRole('button', { name: 'Dismiss import notice' }).click();
  await expect(fonts).toHaveCount(0);
  await expect(refused).toBeVisible();
  await app.close();
});

test('a deck names its old fonts and calendar and book imports name entries left out', async () => {
  const work = mkdtempSync(join(tmpdir(), 'drashti-file-notices-'));
  const deck = join(work, 'Placeholder font deck.pptx');
  const calendar = join(work, 'placeholder-calendar.json');
  const book = join(work, 'placeholder-book.json');
  writeFileSync(deck, deckWithOldFonts());
  const day = {
    date: '2026-11-12',
    samvat: 1001,
    month: { gu: 'નમૂનો', en: 'Placeholder month' },
    paksha: { gu: 'નમૂનો', en: 'Placeholder half' },
    tithi: { gu: 'નમૂનો', en: 'Placeholder day' },
  };
  writeFileSync(
    calendar,
    JSON.stringify({
      format: 'drashti-calendar',
      version: 1,
      name: 'Placeholder calendar',
      days: [day, day],
    }),
  );
  writeFileSync(
    book,
    JSON.stringify({
      format: 'drashti-shastra',
      version: 1,
      name: 'Placeholder book',
      abbreviation: 'PB',
      items: [
        { number: 1, text: { en: 'Placeholder words.' } },
        { number: 2, text: {} },
      ],
    }),
  );

  const { app } = await launchApp({ DRASHTI_TEST_DECK_CONVERTER: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    await openLibrary(win);
    await dropFiles(win, win.getByTestId('library-drop'), [deck, calendar, book]);

    const notices = win.getByTestId('import-notice');
    const fonts = notices.filter({ hasText: 'old fonts' });
    await expect(fonts).toHaveCount(1);
    await expect(fonts).toContainText('Placeholder font deck');
    await expect(fonts).toContainText('Gopika');
    await expect(fonts).toContainText('Kruti Dev 010');
    await expect(fonts).toContainText(INSTALL_THEM);

    const calendarNotice = notices.filter({ hasText: 'Placeholder calendar' });
    await expect(calendarNotice).toHaveCount(1);
    await expect(calendarNotice).toContainText('2026-11-12 is given twice: the first is kept.');
    const bookNotice = notices.filter({ hasText: 'Placeholder book' });
    await expect(bookNotice).toHaveCount(1);
    await expect(bookNotice).toContainText('2 has no words: it was left out.');
    await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
  }
});
