import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { expectNoSeriousA11yIssues, settled } from './a11y';
import { expectFits } from './fit';
import {
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  outputPages,
  setUpScreen,
  sizeSlideEditor,
  slideEditorClosed,
  slideEditorWindow,
  type PageGlobals,
} from './helpers';

// Prepared translations (alpha.21): CI on Mac and Windows; no local Electron/e2e run.
const NAME = 'Placeholder translation';
const SOURCE = 'The blue box is empty.';
async function fixture(win: Page): Promise<string> {
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-translation-')), `${NAME}.pro6`);
  writeFileSync(
    file,
    pp6Presentation({
      uuid: 'PLACEHOLDER-TRANSLATION',
      groups: [
        {
          name: 'One',
          slides: [
            {
              label: 'Placeholder first',
              text: [{ rtf: cocoaRtf([[SOURCE, 60, [255, 255, 255]]]), rect: [100, 100, 1500, 120] }],
            },
          ],
        },
      ],
    }),
  );
  const [id] = await importAndGetIds(win, [file]);
  if (!id) throw new Error('Placeholder import failed');
  return id;
}
async function editor(app: ElectronApplication, win: Page) {
  await openLibrary(win);
  await win.getByTestId('presentation-row').filter({ hasText: NAME }).click();
  await win.getByTestId('edit-slides').click();
  const opened = await slideEditorWindow(app);
  await opened.ed.getByRole('button', { name: 'Translate…', exact: true }).click();
  return { ...opened, review: opened.ed.getByRole('dialog', { name: 'Translation', exact: true }) };
}
async function check(review: Locator, words: string, language = 'gu') {
  await review.getByLabel('Source language', { exact: true }).selectOption('en');
  await review.getByLabel('Target language', { exact: true }).selectOption(language);
  await review.getByLabel('Translation words', { exact: true }).first().fill(words);
  await expect(review.getByRole('button', { name: 'Mark checked', exact: true }).first()).toBeDisabled();
  await review.getByLabel('Reader name', { exact: true }).fill('Reader Q');
  await review.getByRole('button', { name: 'Mark checked', exact: true }).first().click();
  await expect(review.getByTestId('translation-review-state').first()).toHaveText('Checked by Reader Q');
}
async function save(app: ElectronApplication, ed: Page, review: Locator) {
  await review.getByRole('button', { name: 'Done', exact: true }).click();
  await ed.getByTestId('save-slides').click();
  // Edited off air: no live-save question (covered separately), so Save closes the window at once.
  await slideEditorClosed(app);
}
async function output(app: ElectronApplication, id: string): Promise<Page> {
  await expect
    .poll(async () =>
      Promise.all(
        outputPages(app).map((page) => page.getByTestId('output-root').getAttribute('data-screen')),
      ),
    )
    .toContain(id);
  for (const page of outputPages(app))
    if ((await page.getByTestId('output-root').getAttribute('data-screen')) === id) return page;
  throw new Error('Expected output page is missing');
}

/**
 * The Translation dialog itself fits (fit.ts's expectFits, all but its whole-page check): inside the window,
 * every button's words whole and inside the dialog, nothing in it scrolling sideways. At 200% zoom the slide
 * editor's own top row is wider than its page (822-837 px in 512, on phase1 before prepared translations too:
 * diagnostic a21-take-tr-1123-210335-48560), an alpha.22 item of its own (QA21-TR-1 A, the lead).
 */
async function expectDialogFits(dialog: Locator, what: string): Promise<void> {
  await expect(dialog).toBeVisible();
  await settled(dialog.page());
  const problems = await dialog.evaluate((root) => {
    const out: string[] = [];
    const r = root.getBoundingClientRect();
    if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5)
      out.push(
        `it is cut off (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`,
      );
    if (root.scrollWidth > root.clientWidth + 1) out.push('the dialog scrolls sideways');
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      const x = getComputedStyle(el).overflowX;
      if ((x === 'auto' || x === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        out.push(`${el.tagName.toLowerCase()} in it scrolls sideways`);
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-scroll-x="no"], footer, header'))
      if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()} scrolls sideways`);
    for (const b of root.querySelectorAll('button')) {
      const box = b.getBoundingClientRect();
      if (box.width === 0) continue;
      if (b.scrollWidth > b.clientWidth + 1) out.push(`“${b.textContent}”: its words do not fit`);
      if (box.left < r.left - 0.5 || box.right > r.right + 0.5)
        out.push(`“${b.textContent}” is outside the dialog`);
    }
    return out;
  });
  expect(problems, what).toEqual([]);
}

test('prepared translations require named review, survive restart, and source edits require re-check', async () => {
  const first = await launchApp();
  const win = await operatorPage(first.app);
  const id = await fixture(win);
  const { ed, review } = await editor(first.app, win);
  await expect(review).toContainText('No engine installed');
  await expect(review.getByRole('button', { name: 'Prepare translations', exact: true })).toBeDisabled();
  await check(review, 'Placeholder Q7');
  await review.getByLabel('Translation words', { exact: true }).first().fill('Placeholder R8');
  await expect(review.getByTestId('translation-review-state').first()).toHaveText('Unchecked');
  await review.getByRole('button', { name: 'Mark checked', exact: true }).first().click();
  await review.getByText('Where checked translations show', { exact: true }).click();
  await review.getByLabel('Presentation translation', { exact: true }).selectOption('gu');
  await expect(review.getByTestId('translation-preview')).toContainText('Placeholder R8');
  await save(first.app, ed, review);
  await first.app.close();
  const second = await launchApp({}, first.userData);
  const again = await operatorPage(second.app);
  const reopened = await editor(second.app, again);
  await expect(reopened.review.getByLabel('Translation words', { exact: true }).first()).toHaveValue(
    'Placeholder R8',
  );
  await expect(reopened.review.getByTestId('translation-review-state').first()).toHaveText(
    'Checked by Reader Q',
  );
  await reopened.review.getByRole('button', { name: 'Done', exact: true }).click();
  await reopened.ed.getByTestId('save-slides').click();
  await slideEditorClosed(second.app);
  const changed = await again.evaluate(
    async ({ id }) => {
      const d = (globalThis as PageGlobals).drashti;
      const opened = await d.library.slidesForEdit(id);
      if (!opened.ok) throw new Error(opened.message);
      const box = opened.doc.groups[0]?.slides[0]?.elements.find((element) => element.kind === 'text');
      if (box?.kind !== 'text') throw new Error('Missing source words');
      box.text = 'The green box is empty.';
      delete box.runs;
      return d.library.saveSlides(id, opened.doc, opened.stamp, false);
    },
    { id },
  );
  expect(changed.ok).toBe(true);
  const held = await editor(second.app, again);
  await expect(held.review.getByTestId('translation-review-state').first()).toHaveText(
    'Needs re-check: source words changed',
  );
  await expect(held.review.getByLabel('Translation words', { exact: true }).first()).toHaveValue(
    'Placeholder R8',
  );
  await expect(held.review.getByTestId('translation-preview')).not.toContainText('Placeholder R8');
  await second.app.close();
});

test('hall, explicit screen Off and stage use their own saved checked targets; Simple Mode cannot approve over raw IPC', async () => {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '2' });
  const win = await operatorPage(app);
  const hall = await setUpScreen(win, 'Placeholder Hall', 0);
  const off = await setUpScreen(win, 'Placeholder Off', 1);
  const stage = await setUpScreen(win, 'Placeholder Stage', 2);
  const screens = await win.evaluate(async (stageId) => {
    const d = (globalThis as PageGlobals).drashti;
    const snapshot = await d.screens.get();
    const stageGroup = snapshot.groups.find((group) => group.screens.some((screen) => screen.id === stageId));
    if (!stageGroup) throw new Error('No stage group');
    const role = await d.screens.setGroupRole(stageGroup.id, 'stage');
    if (!role.ok) throw new Error(role.message);
    return role.snapshot.groups;
  }, stage);
  const id = await fixture(win);
  const { ed, review } = await editor(app, win);
  await check(review, 'Placeholder Gujarati Q7');
  await review.getByLabel('Reader name', { exact: true }).fill('');
  await check(review, 'Placeholder Hindi R8', 'hi');
  await review.getByText('Where checked translations show', { exact: true }).click();
  await review.getByLabel('Presentation translation', { exact: true }).selectOption('gu');
  const offName = screens.flatMap((group) => group.screens).find((screen) => screen.id === off)?.name;
  if (!offName) throw new Error('No screen name');
  await review.getByLabel(`${offName} translation`, { exact: true }).selectOption('off');
  await review.getByLabel('Placeholder Stage translation', { exact: true }).selectOption('hi');
  await save(app, ed, review);
  const result = await win.evaluate(
    (pid) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: pid,
        slideIndex: 0,
      }),
    id,
  );
  expect(result.ok).toBe(true);
  const hallPage = await output(app, hall),
    offPage = await output(app, off),
    stagePage = await output(app, stage);
  await expect(hallPage.getByTestId('output-root')).toContainText(SOURCE);
  await expect(hallPage.getByTestId('output-root')).toContainText('Placeholder Gujarati Q7');
  await expect(offPage.getByTestId('output-root')).toContainText(SOURCE);
  await expect(offPage.getByTestId('output-root')).not.toContainText('Placeholder Gujarati Q7');
  await expect(stagePage.getByTestId('output-root')).toContainText('Placeholder Hindi R8');
  const stageOriginal = stagePage.getByText(SOURCE, { exact: true }).first();
  const stageSourceMetrics = () =>
    stageOriginal.evaluate((el) => ({
      top: el.getBoundingClientRect().top,
      size: getComputedStyle(el).fontSize,
    }));
  const originalMetrics = await stageSourceMetrics();
  await win.getByRole('button', { name: 'Hide translation', exact: true }).click();
  await expect(stagePage.getByTestId('output-root')).not.toContainText('Placeholder Hindi R8');
  await expect.poll(stageSourceMetrics).toEqual(originalMetrics);
  await expect(hallPage.getByTestId('output-root')).not.toContainText('Placeholder Gujarati Q7');
  await expect(hallPage.getByTestId('output-root')).toContainText(SOURCE);
  await win.getByRole('button', { name: 'Show checked translation', exact: true }).click();
  await expect(hallPage.getByTestId('output-root')).toContainText('Placeholder Gujarati Q7');
  const refused = await win.evaluate(async (pid) => {
    const d = (globalThis as PageGlobals).drashti;
    const opened = await d.library.slidesForEdit(pid);
    if (!opened.ok) throw new Error(opened.message);
    const box = opened.doc.groups[0]?.slides[0]?.elements.find((element) => element.kind === 'text');
    if (box?.kind !== 'text' || !box.translationDisplay) throw new Error('Missing translation setup');
    box.translationDisplay.choice = 'off';
    const list = await d.playlists.create('Placeholder translation playlist', null, false);
    if (!list.ok || !list.ids[0]) throw new Error('No placeholder playlist');
    const added = await d.playlists.addItems(list.ids[0], null, [
      { kind: 'presentation', presentationId: pid },
    ]);
    if (!added.ok) throw new Error(added.message);
    const mode = await d.app.setMode('simple');
    if (!mode.ok) throw new Error(mode.message);
    return d.library.saveSlides(pid, opened.doc, opened.stamp, false);
  }, id);
  expect(refused.ok).toBe(false);
  if (refused.ok) throw new Error('Simple Mode changed a translation');
  expect(refused.message).toBe('Use Pro Mode to change or check translations.');
  await expect(hallPage.getByTestId('output-root')).toContainText('Placeholder Gujarati Q7');
  await app.close();
});

test('translation review fits the least editor size, keeps focus and readable script marks at 200% zoom', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await fixture(win);
  const { ed, review } = await editor(app, win);
  await sizeSlideEditor(app, ed, { width: 1024, height: 645 });
  await expectFits(review, 'Translation dialog at the least editor size');
  await expectNoSeriousA11yIssues(ed, 'Translation dialog');
  await check(review, 'કિ કી કું');
  await expect(review.getByLabel('Translation words', { exact: true }).first()).toHaveValue('કિ કી કું');
  await app.evaluate(({ webContents }) => {
    const editor = webContents.getAllWebContents().find((page) => page.getURL().includes('editor.html'));
    if (!editor) throw new Error('No editor page');
    editor.setZoomFactor(2);
  });
  await expectDialogFits(review, 'Translation dialog at 200% zoom');
  await ed.keyboard.press('Escape');
  await expect(review).toHaveCount(0);
  // Translate… is reached at 200% too, though the top row is wider than the page there: by keys (focus comes back
  // to it, Enter opens it) and by the pointer (the click scrolls the page to it and lands only where it is hit).
  const translate = ed.getByRole('button', { name: 'Translate…', exact: true });
  await expect(translate).toBeFocused();
  await ed.keyboard.press('Enter');
  await expectDialogFits(review, 'Translation dialog opened by keys at 200% zoom');
  await ed.keyboard.press('Escape');
  await expect(review).toHaveCount(0);
  await expect(translate).toBeFocused();
  await translate.click();
  await expectDialogFits(review, 'Translation dialog opened by the pointer at 200% zoom');
  await review.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(review).toHaveCount(0);
  await ed.getByTestId('save-slides').click();
  await slideEditorClosed(app);
  await app.close();
});

test('portable export/import carries checked and unchecked prepared words with their remapped source', async () => {
  const first = await launchApp();
  const win = await operatorPage(first.app);
  const id = await fixture(win);
  const opened = await editor(first.app, win);
  await check(opened.review, 'Placeholder Q7');
  await opened.review.getByLabel('Target language', { exact: true }).selectOption('hi');
  await opened.review.getByLabel('Translation words', { exact: true }).first().fill('Placeholder R8');
  await expect(opened.review.getByTestId('translation-review-state').first()).toHaveText('Unchecked');
  await opened.review.getByText('Where checked translations show', { exact: true }).click();
  await opened.review.getByLabel('Presentation translation', { exact: true }).selectOption('gu');
  await save(first.app, opened.ed, opened.review);
  const bundle = join(
    mkdtempSync(join(tmpdir(), 'drashti-translation-bundle-')),
    'Placeholder prepared.drashti-kirtans',
  );
  await first.app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: file });
  }, bundle);
  const exported = await win.evaluate(async (pid) => {
    const d = (globalThis as PageGlobals).drashti;
    const details = await d.kirtans.setDetails(pid, {
      category: null,
      kavi: null,
      raag: null,
      occasions: [],
      audioMediaId: null,
    });
    if (!details.ok) throw new Error(details.message);
    return d.kirtans.exportBundle({ presentationIds: [pid], includeMedia: false });
  }, id);
  expect(exported.ok).toBe(true);
  await first.app.close();
  const second = await launchApp();
  const target = await operatorPage(second.app);
  const received = await target.evaluate(async (path) => {
    const d = (globalThis as PageGlobals).drashti;
    const imported = await d.library.importPaths([path]);
    if (!imported.ok) throw new Error(imported.message);
    const report = await d.library.getImportReport(imported.run.id);
    // A bundle's items are named by their entry inside it (<bundle>!/<entry>), not by the bundle alone.
    return (
      report?.items.find((item) => item.format === 'kirtan-bundle' && item.sourcePath.startsWith(`${path}!/`))
        ?.target?.id ?? ''
    );
  }, bundle);
  expect(received).toBeTruthy();
  expect(received).not.toBe(id);
  const review = await editor(second.app, target);
  await expect(review.review.getByLabel('Translation words', { exact: true }).first()).toHaveValue(
    'Placeholder Q7',
  );
  await expect(review.review.getByTestId('translation-review-state').first()).toHaveText(
    'Checked by Reader Q',
  );
  await expect(review.review.getByTestId('translation-preview')).toContainText('Placeholder Q7');
  await review.review.getByLabel('Target language', { exact: true }).selectOption('hi');
  await expect(review.review.getByLabel('Translation words', { exact: true }).first()).toHaveValue(
    'Placeholder R8',
  );
  await expect(review.review.getByTestId('translation-review-state').first()).toHaveText('Unchecked');
  await expect(review.review.getByTestId('translation-preview')).not.toContainText('Placeholder R8');
  await expect(review.review).toContainText('No engine installed');
  await second.app.close();
});
