import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { launchApp, operatorPage, operatorReady, relaunchApp, type PageGlobals } from './helpers';

/*
 * The built-in themes (Session 26 step 14): ten beside Drashti default, each
 * a preview with a placeholder line in each language, given to a library
 * once (a deleted one stays deleted), and copied when changed; applied to a
 * playlist's presentations with Undo; and the default for new ones.
 * Placeholder words and the seeded placeholder presentations only.
 */

const NAMES = [
  'Midnight',
  'Plum and Flame',
  'Saffron',
  'Maroon and Gold',
  'Forest',
  'Ocean',
  'Ivory',
  'Charcoal',
  'High Contrast White on Black',
  'High Contrast Black on White',
];

const themes = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.themes.list());

/** Every slide's background and the colour of each of its words, by language. */
const looks = (win: Page, id: string) =>
  win.evaluate(async (pid) => {
    const doc = await (globalThis as PageGlobals).drashti.library.getPresentation(pid);
    return (doc?.groups ?? []).flatMap((g) =>
      g.slides.map((s) => ({
        background: s.slide.background,
        colours: s.slide.elements.flatMap((e) =>
          e.kind === 'text' ? (e.runs ?? []).map((r) => [r.lang ?? e.lang, r.color ?? e.style.color]) : [],
        ),
      })),
    );
  }, id);

async function openThemes(win: Page) {
  await win.getByRole('button', { name: 'Themes', exact: true }).click();
  return win.getByTestId('themes-panel');
}

test('ten built-in themes, each a preview in every language; given once (a deleted one stays deleted); changing one makes a copy', async () => {
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const panel = await openThemes(win);
  const items = panel.getByTestId('theme-item');
  await expect(items).toHaveCount(11);
  await expect(items.first()).toContainText('Drashti default');
  for (const [i, name] of NAMES.entries()) {
    const item = items.nth(i + 1);
    await expect(item).toContainText(name);
    await expect(item).toContainText('Built in');
    // Its preview: a placeholder line in Gujarati, transliteration, Hindi and English.
    await expect(item.locator('[data-run][data-lang]')).toHaveCount(4);
  }
  await expectNoSeriousA11yIssues(win, 'the Themes window with the built-in themes');

  // Changing Midnight: it stays as it is, and a copy of my own has the change.
  await items.filter({ hasText: 'Midnight' }).click();
  const editor = panel.getByTestId('theme-editor');
  await expect(editor.getByTestId('theme-builtin-note')).toBeVisible();
  await editor.getByRole('spinbutton', { name: 'English size' }).fill('96');
  await expect(editor.getByTestId('theme-save')).toHaveText('Save as a copy');
  await editor.getByTestId('theme-save').click();
  await expect(items).toHaveCount(12);
  const copy = items.filter({ hasText: 'Midnight (copy)' });
  await expect(copy).toHaveAttribute('aria-current', 'true');
  await expect(copy).not.toContainText('Built in');
  await expect(editor.getByTestId('theme-builtin-note')).toHaveCount(0);
  const list = await themes(win);
  expect(list.themes.find((t) => t.name === 'Midnight')?.langs.en.size).toBe(80);
  expect(list.themes.find((t) => t.name === 'Midnight (copy)')?.langs.en.size).toBe(96);

  // Charcoal deleted: after a restart it is still gone.
  await items.filter({ hasText: 'Charcoal' }).click();
  await editor.getByRole('button', { name: 'Delete' }).click();
  await expect(items).toHaveCount(11);
  await app.close();
  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  const names = (await themes(win2)).themes.map((t) => t.name);
  expect(names).not.toContain('Charcoal');
  expect(names).toContain('Midnight (copy)');
  expect(names.filter((n) => NAMES.includes(n))).toHaveLength(9);
  await again.app.close();
});

test('a theme applied to a playlist’s presentations: each takes its colours, the words stay; Undo puts them back', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  // A playlist with both placeholder presentations, a header and the first one again.
  const ids = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const presentations = (await d.library.listPresentations()).map((p) => p.id);
    await d.playlists.create('Placeholder Sunday sabha', null, false);
    const playlist = (await d.playlists.tree()).find((p) => p.name === 'Placeholder Sunday sabha');
    if (!playlist) throw new Error('no playlist');
    await d.playlists.addItems(
      playlist.id,
      null,
      presentations.map((id) => ({ kind: 'presentation' as const, presentationId: id })),
    );
    return presentations;
  });
  expect(ids).toHaveLength(2);
  const before = await Promise.all(ids.map((id) => looks(win, id)));

  const panel = await openThemes(win);
  await panel.getByTestId('theme-item').filter({ hasText: 'Ocean' }).click();
  const editor = panel.getByTestId('theme-editor');
  await editor.getByTestId('theme-playlist').selectOption({ label: 'Placeholder Sunday sabha' });
  await editor.getByTestId('theme-apply-playlist').click();
  await expect(editor).toContainText('Applied to 2 presentations in “Placeholder Sunday sabha”.');
  for (const id of ids) {
    const slides = await looks(win, id);
    expect(slides.length).toBeGreaterThan(0);
    for (const s of slides) {
      expect(s.background).toBe('#062a3f');
      for (const [lang, colour] of s.colours)
        expect(colour, String(lang)).toBe(lang === 'translit' ? '#80deea' : '#e0f7fa');
    }
  }
  await panel.getByRole('button', { name: 'Close themes' }).click();

  // Undo: each looks as it did.
  const undo = win.getByTestId('undo-removal');
  await expect(undo).toContainText('Applied the theme “Ocean” to 2 presentations');
  await undo.getByRole('button', { name: /Undo/ }).click();
  await expect.poll(() => Promise.all(ids.map((id) => looks(win, id)))).toEqual(before);
  await app.close();
});

test('a built-in theme made the default: a presentation made in Drashti starts with it', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const panel = await openThemes(win);
  const ivory = panel.getByTestId('theme-item').filter({ hasText: 'Ivory' });
  await ivory.click();
  const editor = panel.getByTestId('theme-editor');
  await editor.getByTestId('theme-make-default').click();
  await expect(editor.getByTestId('theme-is-default')).toBeVisible();
  await expect(ivory).toContainText('Default');
  await expect(panel.getByTestId('theme-item').first()).not.toContainText('Default');
  await panel.getByRole('button', { name: 'Close themes' }).click();

  const made = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const result = await d.library.newFromWords(
      'Placeholder new kirtan',
      '[Verse]\nનમૂના પંક્તિ\nPlaceholder line\n',
    );
    return result.ok ? result.id : '';
  });
  const slides = await looks(win, made);
  expect(slides[0]?.background).toBe('#fbf6e9');
  expect(slides[0]?.colours.map(([, c]) => c)).toEqual(['#2b2118', '#2b2118']);
  await app.close();
});
