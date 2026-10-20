import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues, expectValidLang } from './a11y';
import { device, networkOn, NETWORK_ENV, pairByQr, pairingCode } from './devices';
import {
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  type PageGlobals,
  setUpScreen,
} from './helpers';

/*
 * Words say their language (Sessions 31–36, I18N-4): on the hall's screens and the stage (a slide's words, a
 * message, the ticker, a stage message, notes), on a phone's pages (the remote's notes and search, the
 * announcement box) and in Edit words. Transliteration says what it transliterates (hi-Latn for a Hindi
 * kirtan's), and the outputs and the remote are never machine-translated. Every tag passes axe's valid-lang.
 * Placeholder words only.
 */

const HINDI = '[Verse]\nनमूना पंक्ति\nNamūnā paṅkti\n';
const GUJARATI = '[Verse]\nનમૂના પંક્તિ\nNamūnā paṅkti\n';

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

const goLive = (win: Page, presentationId: string) =>
  dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });

/** Two placeholder kirtans, a Hindi one (its slide's notes in Hindi) and a Gujarati one; their ids. */
async function twoKirtans(win: Page): Promise<{ hindi: string; gujarati: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-lang-'));
  const hindiFile = join(dir, 'Placeholder Hindi kirtan.txt');
  const gujaratiFile = join(dir, 'Placeholder Gujarati kirtan.txt');
  writeFileSync(hindiFile, HINDI);
  writeFileSync(gujaratiFile, GUJARATI);
  const [hindi = '', gujarati = ''] = await importAndGetIds(win, [hindiFile, gujaratiFile]);
  await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const opened = await d.library.slidesForEdit(id);
    if (!opened.ok) throw new Error(opened.message);
    const first = opened.doc.groups[0]?.slides[0];
    if (first) first.notes = 'नमूना टिप्पणी';
    const saved = await d.library.saveSlides(id, opened.doc, opened.stamp);
    if (!saved.ok) throw new Error(saved.message);
  }, hindi);
  return { hindi, gujarati };
}

test('the hall’s and the stage’s words say their language, a Hindi kirtan’s transliteration is hi-Latn, and the outputs are never translated', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({
    ...NETWORK_ENV,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const { hindi, gujarati } = await twoKirtans(win);
  // The hall, and a stage screen on a pretend display.
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Stage', 1);
  await expect.poll(() => outputPages(app).length).toBe(2);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.name === 'Stage');
    if (!group) throw new Error('no stage group');
    const set = await d.screens.setGroupRole(group.id, 'stage');
    if (!set.ok) throw new Error(set.message);
  });
  const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
  await expect
    .poll(async () => (await Promise.all(outputPages(app).map(roleOf))).sort())
    .toEqual(['audience', 'stage']);
  const [first, second] = outputPages(app);
  if (!first || !second) throw new Error('two screens expected');
  const [hall, stage] = (await roleOf(first)) === 'audience' ? [first, second] : [second, first];
  for (const page of [hall, stage]) {
    await outputReady(page);
    // Never machine-translated.
    await expect(page.locator('html')).toHaveAttribute('translate', 'no');
  }

  // The Hindi kirtan: its transliteration is hi-Latn, on the hall and the stage; its notes are Hindi.
  await goLive(win, hindi);
  const slide = hall.locator('[data-layer="slide"]');
  await expect(slide.locator('[data-run][data-lang="hi"]')).toHaveAttribute('lang', 'hi');
  await expect(slide.locator('[data-run][data-lang="translit"]')).toHaveAttribute('lang', 'hi-Latn');
  await expect(stage.getByTestId('stage-current').locator('[lang="hi-Latn"]')).toHaveText('Namūnā paṅkti');
  await expect(stage.getByTestId('stage-notes')).toHaveAttribute('lang', 'hi');
  // The Gujarati one's is gu-Latn.
  await goLive(win, gujarati);
  await expect(slide.locator('[data-run][data-lang="translit"]')).toHaveAttribute('lang', 'gu-Latn');
  await expect(stage.getByTestId('stage-current').locator('[lang="gu-Latn"]')).toHaveText('Namūnā paṅkti');

  // A message in Gujarati, and a stage message in Hindi.
  await dispatch(win, { type: 'showMessage', message: { id: 'placeholder-message', text: 'નમૂના સંદેશ' } });
  await expect(hall.locator('[data-message="placeholder-message"] > [lang]')).toHaveAttribute('lang', 'gu');
  await dispatch(win, { type: 'setStageMessage', text: 'नमूना संदेश' });
  await expect(stage.getByTestId('stage-message')).toHaveAttribute('lang', 'hi');

  // The ticker, from a phone: the announcement box says the language typed in it, and so does the ticker.
  const { base } = await networkOn(win);
  const key = await win.evaluate(async () => {
    const r = await (globalThis as PageGlobals).drashti.network.makePoster();
    if (!r.ok || !r.status.poster) throw new Error(r.ok ? 'no poster link' : r.message);
    return r.status.poster.url.split('#k=')[1] ?? '';
  });
  const phone = await device('webkit');
  try {
    await phone.page.goto(`${base}/announce#k=${key}`);
    const box = phone.page.getByTestId('announce-text');
    await box.fill('નમૂના જાહેરાત');
    await expect(box).toHaveAttribute('lang', 'gu');
    expect(await expectValidLang(phone.page, 'the announcements page')).toBeGreaterThan(0);
    await phone.page.getByTestId('announce-from').fill('Placeholder name');
    await phone.page.getByTestId('announce-send').click();
    await expect(phone.page.getByRole('status')).toContainText('waiting for the operator');
  } finally {
    await phone.close();
  }
  const approved = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [waiting] = (await d.announcements.list()).waiting;
    return d.announcements.approve({ id: waiting?.id ?? '', as: 'ticker' });
  });
  expect(approved.ok).toBe(true);
  await expect(hall.locator('[data-ticker-item]')).toHaveAttribute('lang', 'gu');

  // Every tag a real language.
  expect(await expectValidLang(hall, 'the hall’s screen')).toBeGreaterThan(0);
  expect(await expectValidLang(stage, 'the stage screen')).toBeGreaterThan(0);
  await app.close();
});

test('the remote’s notes, search and slide say their language, and the remote is never translated', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const { hindi } = await twoKirtans(win);
  await goLive(win, hindi);
  const { base } = await networkOn(win);
  const phone = await device('chromium');
  try {
    const page = phone.page;
    await pairByQr(page, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(page.locator('html')).toHaveAttribute('translate', 'no');
    // The live slide, as the hall shows it.
    await expect(page.locator('[data-run][data-lang="translit"]').first()).toHaveAttribute('lang', 'hi-Latn');
    // The notes (open to begin with).
    await expect(page.getByTestId('remote-notes-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('remote-notes-live')).toHaveAttribute('lang', 'hi');
    await expect(page.getByTestId('remote-notes-live')).toHaveText('नमूना टिप्पणी');
    expect(await expectValidLang(page, 'the remote')).toBeGreaterThan(0);
    await expectNoSeriousA11yIssues(page, 'the remote with Hindi notes');
  } finally {
    await phone.close();
  }
  await app.close();
});

test('Edit words’ fields and the library’s search say their language (Hindi, and hi-Latn for its transliteration)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  await operatorReady(win);
  await twoKirtans(win);
  // A line found by search.
  await openLibrary(win);
  await win.getByTestId('library-search').fill('नमूना');
  await expect(win.getByTestId('search-line').first()).toHaveAttribute('lang', 'hi');
  await win.getByTestId('library-search').fill('');
  // Edit words, by language: each field in its language.
  await win
    .getByTestId('presentation-list')
    .getByTestId('presentation-row')
    .filter({ hasText: 'Placeholder Hindi kirtan' })
    .click();
  await win.getByTestId('slide-grid').getByRole('button', { name: 'Edit words' }).click();
  const editor = win.getByTestId('words-editor');
  await editor.getByTestId('words-mode-tab-tracks').click();
  await expect(editor.getByTestId('track-slides')).toBeVisible();
  await expect(editor.locator('[data-testid="track-cell"][data-lang="hi"] textarea')).toHaveAttribute(
    'lang',
    'hi',
  );
  await expect(editor.locator('[data-testid="track-cell"][data-lang="translit"] textarea')).toHaveAttribute(
    'lang',
    'hi-Latn',
  );
  expect(await expectValidLang(win, 'Edit words')).toBeGreaterThan(0);
  await expectNoSeriousA11yIssues(win, 'Edit words by language');
  await app.close();
});
