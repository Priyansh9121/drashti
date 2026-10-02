import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, outputPage, setUpScreen } from './helpers';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';

/*
 * A kirtan's language tracks (Session 8): its words by language, slide by
 * slide, in the words editor; a missing line; a presentation made a kirtan
 * and back; a copied slide keeping its lines; and the words never drifting
 * between Edit words, the slide editor and the tracks (they are one copy).
 * The seeded sample kirtan and placeholder words only.
 */

const saveKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
const KIRTAN = /Sample kirtan/;

async function open(win: Page, name: RegExp | string): Promise<string> {
  await win.getByTestId('presentation-list').getByRole('button', { name }).click();
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

async function openByLanguage(win: Page) {
  await win.getByTestId('slide-grid').getByRole('button', { name: 'Edit words' }).click();
  const editor = win.getByTestId('words-editor');
  await editor.getByTestId('words-mode-tab-tracks').click();
  await expect(editor.getByTestId('track-slides')).toBeVisible();
  return editor;
}

test('a kirtan by language: one track, then all of them, a missing line, and Undo', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await setUpScreen(win);
  const output = await outputPage(app);
  const id = await open(win, KIRTAN);
  await win.getByTestId('slide-thumb').first().click();
  const translit = output.locator('[data-run][data-lang="translit"]');
  await expect(translit).toHaveText('Namūnānī pahelī paṅkti');

  // The Kirtan dialog: four languages, on every slide.
  await win.getByTestId('kirtan-button').click();
  const dialog = win.getByTestId('kirtan-dialog');
  await expect(dialog.getByTestId('kirtan-track')).toHaveText([
    /English\s*Every slide \(3\)/,
    /Gujarati\s*Every slide \(3\)/,
    /Hindi\s*Every slide \(3\)/,
    /Transliteration\s*Every slide \(3\)/,
  ]);
  await expectNoSeriousA11yIssues(win, 'the Kirtan dialog');
  await dialog.getByRole('button', { name: 'Done' }).click();

  // One track on its own: the transliteration, slide by slide.
  let editor = await openByLanguage(win);
  await editor.getByTestId('words-lang-tab-translit').click();
  const cells = editor.getByTestId('track-cell');
  await expect(cells).toHaveCount(3);
  expect(
    await cells.locator('textarea').evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value)),
  ).toEqual(['Namūnānī pahelī paṅkti', 'Namūnānī ṭek', 'Namūnānī bījī paṅkti']);
  await cells.first().locator('textarea').fill('Namuno badlelu');
  await expect(editor.getByTestId('track-count')).toHaveText('3 slides · 1 change');
  await cells.first().locator('textarea').press(saveKey);
  await expect(editor).toHaveCount(0);
  // The live slide shows it at once; nothing else on the slide changed.
  await expect(translit).toHaveText('Namuno badlelu');
  await expect(output.locator('[data-run][data-lang="gu"]')).toHaveText('નમૂનાની પહેલી પંક્તિ');
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/ }).click();
  await expect(translit).toHaveText('Namūnānī pahelī paṅkti');

  // Every language of each slide together: take the chorus's English away, change a Gujarati line.
  editor = await openByLanguage(win);
  await expect(editor.getByTestId('track-slide')).toHaveCount(3);
  const chorus = editor.getByTestId('track-slide').nth(1);
  await chorus.getByRole('textbox', { name: 'Slide 2, English' }).fill('');
  await editor
    .getByTestId('track-slide')
    .nth(2)
    .getByRole('textbox', { name: 'Slide 3, Gujarati' })
    .fill('નમૂનાની નવી પંક્તિ');
  await expectNoSeriousA11yIssues(win, 'the words editor, by language');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toHaveCount(0);
  const after = await tracks(win, id);
  expect(after?.[1]).toEqual({ gu: ['નમૂનાની ટેક'], hi: ['नमूने की टेक'], translit: ['Namūnānī ṭek'] });
  expect(after?.[2]?.gu).toEqual(['નમૂનાની નવી પંક્તિ']);

  // A slide with no English shows it as missing, not as blank text; typing there adds it back.
  editor = await openByLanguage(win);
  const missing = editor
    .getByTestId('track-slide')
    .nth(1)
    .locator('[data-testid="track-cell"][data-lang="en"]');
  await expect(missing.getByTestId('track-missing')).toHaveText('Missing');
  await expect(missing.locator('textarea')).toHaveAttribute('data-missing', 'true');
  await editor.getByTestId('words-lang-tab-en').click();
  const english = editor.getByTestId('track-cell').nth(1);
  await expect(english.locator('textarea')).toHaveAttribute('data-missing', 'true');
  await expect(english.getByTestId('track-missing')).toHaveCount(1);
  await english.locator('textarea').fill('Placeholder chorus, again');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toHaveCount(0);
  expect((await tracks(win, id))?.[1]?.en).toEqual(['Placeholder chorus, again']);
  await app.close();
});

test('made a kirtan and back without losing words; a copied slide keeps its lines; one copy of the words', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const id = await open(win, 'Language test slides');
  const words = () =>
    win.evaluate(async (pid) => {
      const doc = await (globalThis as PageGlobals).drashti.library.getPresentation(pid);
      return JSON.stringify(doc?.groups.map((g) => g.slides.map((s) => s.slide.elements)));
    }, id);
  const before = await words();

  // Not a kirtan: no By language view. Made one, it has its words in their languages.
  await win.getByTestId('kirtan-button').click();
  const dialog = win.getByTestId('kirtan-dialog');
  await dialog.getByTestId('make-kirtan').click();
  await expect(dialog.getByTestId('kirtan-track')).toHaveText([
    /English\s*Every slide \(3\)/,
    /Gujarati\s*2 of 3 slides\s*1 missing/,
    /Hindi\s*1 of 3 slides\s*2 missing/,
    /Transliteration\s*1 of 3 slides\s*2 missing/,
  ]);
  expect(await words()).toBe(before);
  await dialog.getByTestId('not-kirtan').click();
  await expect(dialog.getByTestId('make-kirtan')).toBeVisible();
  expect(await words()).toBe(before);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  // Undo makes it a kirtan again (each change is one step).
  const undo = win.getByTestId('undo-removal');
  await expect(undo).toContainText('No longer a kirtan');
  await undo.getByRole('button', { name: /Undo/ }).click();
  await win.getByTestId('kirtan-button').click();
  await expect(dialog.getByTestId('not-kirtan')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  expect(await words()).toBe(before);

  // A copied slide in the slide editor has the same lines in every language.
  const kirtanId = await open(win, KIRTAN);
  await win.getByTestId('edit-slides').click();
  const slideEditor = win.getByTestId('slide-editor');
  await expect(slideEditor.getByTestId('slide-panel')).toBeVisible();
  await slideEditor.getByTestId('slide-duplicate').click();
  await slideEditor.getByTestId('save-slides').click();
  await expect(slideEditor).toHaveCount(0);
  const copied = await tracks(win, kirtanId);
  expect(copied).toHaveLength(4);
  expect(copied?.[1]).toEqual(copied?.[0]);

  // Edit words (all of them), the tracks and the slides: always the same words.
  await win.getByTestId('slide-grid').getByRole('button', { name: 'Edit words' }).click();
  const editor = win.getByTestId('words-editor');
  const text = editor.getByTestId('words-text');
  await text.fill((await text.inputValue()).replace('Placeholder chorus', 'Placeholder chorus, fixed'));
  await text.press(saveKey);
  await expect(editor).toHaveCount(0);
  const same = await win.evaluate(async (pid) => {
    const d = (globalThis as PageGlobals).drashti;
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

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const)
  test(`the kirtan dialog and the words by language fit at ${width} x ${height}`, async () => {
    const { app } = await launchApp();
    const win = await operatorPage(app);
    await win.setViewportSize({ width, height });
    await open(win, KIRTAN);
    await win.getByTestId('kirtan-button').click();
    await expectFits(win.getByTestId('kirtan-dialog'), `the Kirtan dialog at ${width} x ${height}`);
    await win.getByTestId('kirtan-dialog').getByRole('button', { name: 'Edit words by language' }).click();
    const editor = win.getByTestId('words-editor');
    await expect(editor.getByTestId('track-slides')).toBeVisible();
    await expectFits(editor, `the words by language at ${width} x ${height}`);
    // All four languages side by side still leave each field room to type in.
    const narrowest = await editor
      .getByTestId('track-cell')
      .locator('textarea')
      .evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().width)));
    expect(narrowest).toBeGreaterThan(180);
    await app.close();
  });
