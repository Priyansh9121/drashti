import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
 * named the fonts to install. An import names each old font it met in a notice, one line per font however many of its
 * presentations use it, and one line in the stack for each font (a later import naming it takes its place), with the
 * other import notices in the window's bottom-right corner, never in the way, with no Try again and no Find…; the
 * presentations come in as ever. Simple Mode imports none of these files (lyrics and the other program's files are Pro
 * Mode's), so its corner shows the lines Pro Mode's import left. In CI's window, about 1024 × 645. Placeholder font
 * names and words only.
 */

const GOPIKA = 'Placeholder Gopika';
const KRUTI_DEV = 'Placeholder Kruti Dev';
const INSTALL = 'install it on this computer, then quit and start Drashti again.';

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

/** Where something is, and how big, in the window. */
const boxOf = async (l: Locator) => {
  const box = await l.boundingBox();
  if (!box) throw new Error('not drawn');
  return box;
};

/**
 * The import notices in the window's bottom-right corner, just above the bars at its foot, as every notice is (the
 * owner, 11 Nov 2026), each line's words letting a click through to what is under them, with nothing to try again.
 */
async function expectInTheCorner(win: Page, bars: Locator, lines: number): Promise<void> {
  const stack = win.getByTestId('import-notice-stack');
  await expect(stack.getByTestId('import-notice')).toHaveCount(lines);
  // The corner the notices stand in (the stack, and under it any other notice).
  const corner = await boxOf(stack.locator('xpath=..'));
  const foot = await boxOf(bars);
  const width = await win.evaluate(() => document.documentElement.clientWidth);
  expect(width - (corner.x + corner.width)).toBeLessThanOrEqual(24);
  expect(corner.y + corner.height).toBeLessThanOrEqual(foot.y);
  expect(foot.y - (corner.y + corner.height)).toBeLessThanOrEqual(16);
  const through = await stack.evaluate((element) =>
    Array.from(element.querySelectorAll('[data-testid="import-notice"] span[title]')).map((line) => {
      const rect = line.getBoundingClientRect();
      const under = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return under !== null && !element.contains(under);
    }),
  );
  expect(through).toEqual(Array.from({ length: lines }, () => true));
  await expect(stack.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(stack.getByRole('button', { name: 'Find…' })).toHaveCount(0);
}

test('an import names each old font once, one line per font, bottom right in Pro Mode and in Simple Mode, with no Try again', async () => {
  const work = mkdtempSync(join(tmpdir(), 'drashti-old-font-'));
  const hymn = presentationIn(work, 'Placeholder Old Hymn', 'E2E-OLD-FONT-HYMN', [GOPIKA, KRUTI_DEV]);
  const song = presentationIn(work, 'Placeholder Old Song', 'E2E-OLD-FONT-SONG', [GOPIKA]);
  const prayer = presentationIn(work, 'Placeholder Old Prayer', 'E2E-OLD-FONT-PRAYER', [GOPIKA]);

  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await openLibrary(win);
  const list = win.getByTestId('presentation-list');
  const notices = win.getByTestId('import-notice');

  // Two presentations, one old font in both and another in one: a line for each font, said once.
  await dropFiles(win, win.getByTestId('library-drop'), [hymn, song]);
  await expect(list.getByRole('button', { name: /^Placeholder Old Hymn/u })).toBeVisible();
  await expect(list.getByRole('button', { name: /^Placeholder Old Song/u })).toBeVisible();
  await expect(notices).toHaveCount(2);
  await expect(notices.filter({ hasText: GOPIKA })).toHaveCount(1);
  await expect(notices.filter({ hasText: GOPIKA })).toContainText(
    `and 1 more · These presentations use the old font “${GOPIKA}”: ${INSTALL}`,
  );
  await expect(notices.filter({ hasText: KRUTI_DEV })).toContainText(
    `“Placeholder Old Hymn” · This presentation uses the old font “${KRUTI_DEV}”: ${INSTALL}`,
  );

  // Another import naming the same font: its line takes the earlier one's place, at the top.
  await dropFiles(win, win.getByTestId('library-drop'), [prayer]);
  await expect(list.getByRole('button', { name: /^Placeholder Old Prayer/u })).toBeVisible();
  await expect(notices.first()).toContainText(
    `“Placeholder Old Prayer” · This presentation uses the old font “${GOPIKA}”: ${INSTALL}`,
  );
  await expect(notices).toHaveCount(2);
  await expect(notices.filter({ hasText: GOPIKA })).toHaveCount(1);

  // Pro Mode: bottom right, never in the way, nothing to try again.
  await closeLibrary(win);
  await expectInTheCorner(win, win.getByTestId('layer-bar'), 2);
  await expectNoSeriousA11yIssues(win, 'the old-font notices', '[data-testid="import-notice-stack"]');

  // Simple Mode: the same lines, in its own bottom-right corner.
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expectInTheCorner(win, win.getByTestId('simple-buttons'), 2);
  await expect(notices.filter({ hasText: KRUTI_DEV })).toContainText('install it on this computer');

  // Dismissed like any other.
  await notices.filter({ hasText: KRUTI_DEV }).getByRole('button', { name: 'Dismiss import notice' }).click();
  await expect(notices).toHaveCount(1);
  await expect(notices).toContainText(GOPIKA);
  await app.close();
});
