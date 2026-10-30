import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import {
  dropFiles,
  editorGroup,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  showExtras,
  slideEditorClosed,
  slideEditorWindow,
} from './helpers';
import { makeTestVideo } from './test-media';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';

/*
 * A kirtan's language tracks (Session 8): a copied slide keeping its lines, the words never drifting between the slide
 * editor and the tracks (they are one copy), lyrics in two scripts coming in as a kirtan, and the library filtering and
 * searching by kirtan details. Session 55 (Part 12, the owner's decision): the open presentation's Kirtan and Edit
 * words buttons are gone, with the Kirtan dialog and the words by language; their data stays in the library, unseen,
 * and a library holding it opens as before. The seeded sample kirtan and placeholder words only.
 */

const KIRTAN = /Sample kirtan/;

async function open(win: Page, name: RegExp | string): Promise<string> {
  // By its row (the row's trash button is named after it too: “Delete …”, Session 26a).
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByTestId('presentation-row')
    .filter({ hasText: name })
    .click();
  const grid = win.getByTestId('slide-grid');
  await expect(grid.getByRole('heading', { level: 2 })).toBeVisible();
  return (await grid.getAttribute('data-presentation-id')) ?? '';
}

/** Each slide's lines by language, as the main process reads them. */
async function tracks(win: Page, id: string) {
  return win.evaluate(async (pid) => {
    const r = await (globalThis as PageGlobals).drashti.kirtans.tracks(pid);
    return r.ok ? r.slides.map((s) => s.lines) : null;
  }, id);
}

test('the open presentation’s Kirtan and Edit words are gone (Session 55): nowhere in the window, its menus or the app’s; a kirtan’s details and words stay in the library, which opens as before', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const id = await open(win, KIRTAN);
  // Its details and its words by language are still there (the library keeps them, unseen).
  const kept = await win.evaluate(async (pid) => {
    const d = (globalThis as PageGlobals).drashti;
    const [doc, byLang] = await Promise.all([d.library.getPresentation(pid), d.kirtans.tracks(pid)]);
    return {
      kirtan: doc?.kirtan !== null && doc?.kirtan !== undefined,
      tracks: byLang.ok ? byLang.slides.length : 0,
    };
  }, id);
  expect(kept).toEqual({ kirtan: true, tracks: 3 });
  // Its slides open as rows, and go up; no Kirtan or Edit words anywhere in the window.
  const grid = win.getByTestId('slide-grid');
  await expect(grid.getByTestId('slide-thumb')).toHaveCount(3);
  await grid.getByTestId('slide-thumb').first().click();
  await expect
    .poll(() =>
      win.evaluate(
        async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.live.presentationId,
      ),
    )
    .toBe(id);
  await expect(win.getByTestId('kirtan-button')).toHaveCount(0);
  await expect(win.getByRole('button', { name: /^(Kirtan|Edit words)/u })).toHaveCount(0);
  // Its menus: a slide's right-click and the presentation's ⋯ have Edit slides…, never Kirtan or Edit words.
  await grid.getByTestId('slide-thumb').first().click({ button: 'right' });
  await expect(win.getByRole('menuitem', { name: 'Edit slides…' })).toBeVisible();
  await expect(win.getByRole('menuitem', { name: /Kirtan|Edit words/u })).toHaveCount(0);
  await win.keyboard.press('Escape');
  await win.getByTestId('presentation-menu').click();
  await expect(win.getByRole('menuitem', { name: 'Edit slides…' })).toBeVisible();
  await expect(win.getByRole('menuitem', { name: /Kirtan|Edit words/u })).toHaveCount(0);
  await win.keyboard.press('Escape');
  // The app's menus: none either (View's Show Shastra, Templates and Kirtan Details is the library's, and stays).
  const labels = await app.evaluate(({ Menu }) => {
    const all: string[] = [];
    const walk = (menu: Electron.Menu | null | undefined) => {
      for (const item of menu?.items ?? []) {
        all.push(item.label);
        walk(item.submenu);
      }
    };
    walk(Menu.getApplicationMenu());
    return all;
  });
  expect(labels.filter((l) => /^(Kirtan|Edit words)/u.test(l))).toEqual([]);
  await app.close();
});

test('a copied slide keeps its lines; one copy of the words', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);

  // A copied slide in the slide editor has the same lines in every language.
  const kirtanId = await open(win, KIRTAN);
  await win.getByTestId('edit-slides').click();
  // The editor's own window (Session 55, Part 17a); Duplicate is in its Slides group.
  const { ed, editor: slideEditor } = await slideEditorWindow(app);
  await expect(slideEditor.getByTestId('slide-panel')).toBeVisible();
  await editorGroup(ed, 'Slides');
  await slideEditor.getByTestId('slide-duplicate').click();
  await slideEditor.getByTestId('save-slides').click();
  await slideEditorClosed(app);
  const copied = await tracks(win, kirtanId);
  expect(copied).toHaveLength(4);
  expect(copied?.[1]).toEqual(copied?.[0]);

  // The words (all of them, saved through the library's own request: Edit words' button is gone, Session 55), the
  // tracks and the slides: always the same words.
  const same = await win.evaluate(async (pid) => {
    const d = (globalThis as PageGlobals).drashti;
    const words = await d.library.words(pid);
    if (!words.ok) throw new Error(words.message);
    const saved = await d.library.saveWords(
      pid,
      words.text.replace('Placeholder chorus', 'Placeholder chorus, fixed'),
    );
    if (!saved.ok) throw new Error('the words were not saved');
    const [all, byLang] = await Promise.all([d.library.words(pid), d.kirtans.tracks(pid)]);
    return {
      all: all.ok ? all.text : '',
      english: byLang.ok ? byLang.slides.map((s) => s.lines.en?.join('\n') ?? null) : [],
    };
  }, kirtanId);
  expect(same.english).toEqual([
    'Placeholder verse, first line',
    'Placeholder verse, first line',
    'Placeholder chorus, fixed',
    'Placeholder verse, second line',
  ]);
  for (const line of same.english) expect(same.all).toContain(line ?? '');
  await app.close();
});

test('lyrics with lines in two scripts come in as a kirtan, and the editor calls such a box “Several”', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-kirtan-'));
  const file = join(dir, 'Placeholder Two Scripts.txt');
  writeFileSync(file, '[Verse]\nનમૂનાની પંક્તિ\nNamūnānī pankti\n\nબીજી પંક્તિ\nBījī pankti\n');
  await openLibrary(win);
  await dropFiles(win, win.getByTestId('presentation-list'), [file]);
  // The report says what was mapped.
  const report = win.getByTestId('import-report');
  // Under "Imported with notes" (it is listed again under "Imported").
  await expect(report.getByTestId('report-item').first()).toContainText(
    'A kirtan: its lines are Gujarati (every slide) and Transliteration (every slide), each line’s language going by its script.',
  );
  await report.getByRole('button', { name: 'Close' }).first().click();
  const id = await open(win, 'Placeholder Two Scripts');
  expect(await tracks(win, id)).toEqual([
    { gu: ['નમૂનાની પંક્તિ'], translit: ['Namūnānī pankti'] },
    { gu: ['બીજી પંક્તિ'], translit: ['Bījī pankti'] },
  ]);
  await expect(
    win.getByTestId('presentation-list').getByRole('button', { name: /^Placeholder Two Scripts/ }),
  ).toContainText('GU');

  // In the slide editor the box is in several languages, not one of them.
  await win.getByTestId('edit-slides').click();
  const { editor } = await slideEditorWindow(app);
  await editor.getByTestId('editor-canvas').locator('[data-element]').first().click();
  const lang = editor.getByTestId('field-lang');
  await expect(lang.locator('option:checked')).toHaveText('Several');
  await app.close();
});

test('kirtan details: a new category, kavi, raag, occasions and a recording, kept; the library filters by them; search finds kavi and raag', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  // The filters are behind View › Show Shastra, Templates and Kirtan Details (Session 26a).
  await showExtras(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-details-'));
  const clip = await makeTestVideo(win, join(dir, 'Placeholder recording.webm'), {
    seconds: 1,
    width: 160,
    height: 90,
    hue: 30,
  });
  await importAndGetIds(win, [clip]);
  // A second kirtan, so the filters have something to leave out.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.library.newFromWords('Placeholder Other Kirtan', '[Verse]\nઘર\n');
    if (!made.ok) throw new Error(made.message);
    await d.kirtans.setDetails(made.id, {
      category: 'Dhun',
      kavi: 'Placeholder Kavi Two',
      raag: null,
      occasions: [],
      audioMediaId: null,
    });
  });

  // Its details, kept with it (Session 55: the Kirtan dialog is gone; the library still has them and filters by them).
  const id = await open(win, KIRTAN);
  await win.evaluate(async (pid) => {
    const d = (globalThis as PageGlobals).drashti;
    const added = await d.kirtans.addCategory('Placeholder Category');
    if (!added.ok) throw new Error(added.message);
    const media = await d.library.listMedia();
    const recording = media.find((m) => m.name.startsWith('Placeholder recording'))?.id ?? null;
    const set = await d.kirtans.setDetails(pid, {
      category: 'Placeholder Category',
      kavi: 'Placeholder Kavi One',
      raag: 'Placeholder Raag',
      occasions: ['Diwali', 'Placeholder Day'],
      audioMediaId: recording,
    });
    if (!set.ok) throw new Error(set.message);
  }, id);
  const saved = await win.evaluate(
    async (pid) => (await (globalThis as PageGlobals).drashti.library.getPresentation(pid))?.kirtan,
    id,
  );
  expect(saved).toMatchObject({
    category: 'Placeholder Category',
    kavi: 'Placeholder Kavi One',
    raag: 'Placeholder Raag',
    occasions: ['Diwali', 'Placeholder Day'],
  });
  expect(saved?.audioMediaId).toBeTruthy();
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.kirtans.categories())).toContain(
    'Placeholder Category',
  );

  // The library filters by them.
  await openLibrary(win);
  const list = win.getByTestId('presentation-list');
  const rows = () => list.getByRole('button').evaluateAll((els) => els.map((e) => e.textContent));
  await win.getByTestId('filter-button').click();
  const filters = win.getByTestId('kirtan-filters');
  await filters.getByTestId('filter-category').selectOption('Placeholder Category');
  await expect(win.getByTestId('filter-count')).toContainText('1 kirtan with these details');
  await expect(list.getByRole('button', { name: /^Sample kirtan/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /^Placeholder Other Kirtan/ })).toHaveCount(0);
  await filters.getByTestId('filter-category').selectOption('');
  await filters.getByTestId('filter-kavi').selectOption('Placeholder Kavi Two');
  await expect(list.getByRole('button', { name: /^Placeholder Other Kirtan/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /^Sample kirtan/ })).toHaveCount(0);
  await filters.getByTestId('filter-kavi').selectOption('');
  await filters.getByTestId('filter-occasion').selectOption('Diwali');
  await expect(win.getByTestId('filter-count')).toContainText('1 kirtan');
  await expectNoSeriousA11yIssues(win, 'the library filters');
  await filters.getByRole('button', { name: 'Clear filters' }).click();
  await expect.poll(async () => (await rows()).length).toBeGreaterThanOrEqual(3);

  // Search finds kirtans by kavi and by raag, and says where.
  const search = win.getByTestId('library-search');
  await search.fill('kavi one');
  const hits = win.getByTestId('search-hit');
  await expect(hits).toHaveCount(1);
  await expect(hits.first().getByTestId('search-detail')).toHaveText('Kavi: Placeholder Kavi One');
  await search.fill('placeholder raag');
  await expect(hits.first().getByTestId('search-detail')).toHaveText('Raag: Placeholder Raag');
  await app.close();
});

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const)
  test(`the library’s kirtan filters fit at ${width} x ${height}`, async () => {
    const { app } = await launchApp();
    const win = await operatorPage(app);
    await operatorReady(win);
    // The filters are behind View › Show Shastra, Templates and Kirtan Details (Session 26a).
    await showExtras(win);
    await win.setViewportSize({ width, height });
    await open(win, KIRTAN);
    // The library's filters, open, in the left column.
    await openLibrary(win);
    await win.getByTestId('filter-button').click();
    await expectFits(win.getByTestId('kirtan-filters'), `the library filters at ${width} x ${height}`);
    await expectNoSeriousA11yIssues(win, `the library filters at ${width} x ${height}`);
    await app.close();
  });
