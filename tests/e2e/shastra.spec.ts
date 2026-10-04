import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import { apiCall, device, NETWORK_ENV, networkOn, pairByQr, pairingCode, pairToken } from './devices';
import type { PageGlobals } from './helpers';
import { dropFiles, launchApp, operatorPage, operatorReady, outputPages, setUpScreen } from './helpers';

/*
 * The Shastra module (Session 12), with the made-up texts in docs/examples
 * (placeholder words only): a text loads from its file, again unchanged, and
 * updated; references, ranges and abbreviations resolve and nonsense is
 * refused saying why; search finds passages by words in each language; a
 * long passage goes on over several slides and Next goes on to the next
 * item; passages are playlist items and fill template slots; two groups
 * show their own languages (Sanskrit in both scripts) and a lower third;
 * the remote and the API put up a reference; Simple Mode refuses changing
 * texts; the new panel and dialogs pass the accessibility checks.
 */

const EXAMPLES = join(__dirname, '..', '..', 'docs', 'examples');

/** The two example texts, copied to a folder of the test's own. */
function exampleFiles(): { granth: string; vachan: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-shastra-'));
  const granth = join(dir, 'placeholder-granth.json');
  const vachan = join(dir, 'placeholder-vachan.json');
  copyFileSync(join(EXAMPLES, 'placeholder-granth.json'), granth);
  copyFileSync(join(EXAMPLES, 'placeholder-vachan.json'), vachan);
  return { granth, vachan, dir };
}

const bridge = (win: Page) =>
  ({
    snapshot: () => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot()),
    texts: () => win.evaluate(() => (globalThis as PageGlobals).drashti.shastra.list()),
  }) as const;

/** Load files through the bridge; each file's report row. */
async function load(win: Page, paths: string[]) {
  return win.evaluate(async (files) => {
    const d = (globalThis as PageGlobals).drashti;
    const started = await d.library.importPaths(files);
    if (!started.ok) throw new Error(started.message);
    const report = await d.library.getImportReport(started.run.id);
    return files.map((f) => report?.items.find((i) => i.sourcePath === f) ?? null);
  }, paths);
}

const live = async (win: Page) => (await bridge(win).snapshot()).state.live;

test('a text loads from its file, again unchanged, and updated; references, nonsense and search', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const files = exampleFiles();

  // Dragged onto the library, like any file: the report says what came in, and opens it in Shastra.
  await dropFiles(win, win.getByTestId('library-drop'), [files.granth]);
  const report = win.getByTestId('import-report');
  await expect(report).toContainText('Placeholder Granth (PG)');
  await expect(report).toContainText(
    'Loaded: 21 items. Find a passage in Shastra by typing its reference, for example “PG 1”.',
  );
  await expectNoSeriousA11yIssues(win, 'the import report with a Shastra text');
  // (A text with notes is listed under those too.)
  await report.getByRole('button', { name: 'Open in Shastra' }).first().click();
  await expect(win.getByTestId('shastra-texts-dialog').getByTestId('shastra-text-row')).toHaveCount(1);
  await win.getByRole('button', { name: 'Close Shastra texts' }).click();
  expect((await bridge(win).texts()).map((t) => t.abbreviation)).toEqual(['PG']);
  const [vachan] = await load(win, [files.vachan]);
  expect(vachan).toMatchObject({
    format: 'shastra',
    outcome: 'imported',
    name: 'Placeholder Vachan (PV)',
    message: 'Loaded: 8 items in 2 sections. Find a passage in Shastra by typing its reference.',
  });
  // Again: nothing changes. Changed: the same text, updated (one more verse).
  const [again] = await load(win, [files.granth]);
  expect(again).toMatchObject({ outcome: 'skipped', message: 'Already loaded, unchanged since.' });
  const changed = JSON.parse(readFileSync(files.granth, 'utf8')) as {
    items: { number: number; text: object }[];
  };
  changed.items.push({ number: 22, text: { en: 'A placeholder verse added later.' } });
  writeFileSync(files.granth, JSON.stringify(changed));
  const [updated] = await load(win, [files.granth]);
  expect(updated).toMatchObject({
    outcome: 'replaced',
    message: 'Updated: 22 items. Find a passage in Shastra by typing its reference, for example “PG 1”.',
  });
  expect((await bridge(win).texts()).map((t) => [t.abbreviation, t.itemCount])).toEqual([
    ['PG', 22],
    ['PV', 8],
  ]);

  // The Shastra tab (already open, from the report): a reference, a range, a section's abbreviation however it is typed.
  await win.getByRole('tab', { name: 'Shastra' }).click();
  const panel = win.getByTestId('shastra-panel');
  await expect(panel.getByTestId('shastra-text')).toHaveCount(2);
  await expectNoSeriousA11yIssues(win, 'the Shastra tab', '[data-testid="shastra-panel"]');
  const grid = win.getByTestId('slide-grid');
  const show = async (reference: string) => {
    await panel.getByTestId('shastra-reference').fill(reference);
    await panel.getByTestId('shastra-reference').press('Enter');
  };
  await show('PG 14');
  await expect(grid).toHaveAttribute('data-presentation-id', 'shastra:pg#14');
  await expect(grid.getByRole('heading', { level: 2 })).toHaveText('Placeholder Granth 14');
  await expect(grid.getByTestId('passage-note')).toBeVisible();
  // Its slides are made from the text: no editing here.
  await expect(grid.getByTestId('edit-slides')).toHaveCount(0);
  await show('pg 14-16');
  await expect(grid).toHaveAttribute('data-presentation-id', 'shastra:pg#14-16');
  // A group for each item (an item may take more than one slide when every language is on).
  await expect(grid.getByTestId('slide-group')).toHaveText([
    /^Placeholder Granth 14/u,
    /^Placeholder Granth 15/u,
    /^Placeholder Granth 16/u,
  ]);
  for (const typed of ['PV P.Pr. 2', 'pv ppr2', 'PV Placeholder Pratham 2']) {
    await show(typed);
    await expect(grid).toHaveAttribute('data-presentation-id', 'shastra:pv/ppr#2');
  }
  await expect(grid.getByRole('heading', { level: 2 })).toHaveText(
    'Placeholder Vachan Placeholder Pratham 2',
  );
  // Nonsense says why, and leaves what was typed to fix.
  await show('XY 3');
  await expect(panel.getByTestId('shastra-problem')).toHaveText(
    'No loaded text is called “XY”. The texts are: PG, PV.',
  );
  await expect(panel.getByTestId('shastra-reference')).toHaveValue('XY 3');
  await show('PG 99');
  await expect(panel.getByTestId('shastra-problem')).toHaveText(
    'Placeholder Granth has no 99: it goes from 1 to 22.',
  );
  await show('PV 1');
  await expect(panel.getByTestId('shastra-problem')).toHaveText(
    'Placeholder Vachan has no section “1”. Its sections are: P.Pr., P.M..',
  );
  // Clicking one of its slides puts the passage up, as a presentation's.
  await show('PG 2');
  await grid.getByTestId('slide-thumb').first().click();
  await expect.poll(async () => (await live(win)).presentationId).toBe('shastra:pg#2');

  // Search by words in each language (accents ignored), the made transliteration too.
  const search = panel.getByTestId('shastra-search');
  const found = async (words: string) => {
    await search.fill(words);
    await expect(panel.getByTestId('shastra-hits')).toBeVisible();
    return panel.getByTestId('shastra-hit').allInnerTexts();
  };
  expect((await found('द्वितीयः पादः 7'))[0]).toContain('Placeholder Granth 7');
  expect((await found('મધ્ય વચન 3'))[0]).toContain('Placeholder Vachan Placeholder Madhya 3');
  expect((await found('placeholder meaning 12'))[0]).toContain('Placeholder Granth 12');
  expect((await found('dvitiyah 5'))[0]).toContain('Placeholder Granth 5');
  await search.fill('nowhere-to-be-found');
  await expect(panel.getByText('Nothing found')).toBeVisible();
  await search.fill('');

  // Texts…: each text's theme, and Remove (asking first). Pro Mode only.
  await panel.getByTestId('open-shastra-texts').click();
  const dialog = win.getByTestId('shastra-texts-dialog');
  await expect(dialog.getByTestId('shastra-text-row')).toHaveCount(2);
  await expectNoSeriousA11yIssues(win, 'the Shastra texts dialog');
  // Simple Mode refuses changing the texts, from anywhere.
  const textId = (await bridge(win).texts())[1]?.id ?? '';
  const refused = await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    await d.app.setMode('simple');
    const r = [await d.shastra.remove(id), await d.shastra.setTheme(id, null)];
    await d.app.setMode('pro');
    return r;
  }, textId);
  expect(refused).toEqual([
    { ok: false, message: SIMPLE_MODE_REFUSAL },
    { ok: false, message: SIMPLE_MODE_REFUSAL },
  ]);
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  await win.getByTestId('open-shastra-texts').click();
  await win
    .getByTestId('shastra-texts-dialog')
    .getByRole('button', { name: 'Remove Placeholder Vachan' })
    .click();
  await win.getByTestId('shastra-remove-confirm').getByRole('button', { name: 'Remove' }).click();
  await expect(win.getByTestId('shastra-texts-dialog').getByTestId('shastra-text-row')).toHaveCount(1);
  await app.close();
});

test('a long passage goes on over several slides and Next goes on to the next item; playlists and template slots', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const files = exampleFiles();
  await load(win, [files.granth, files.vachan]);

  // A playlist: the long item, then a short one.
  const playlistId = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.playlists.create('Placeholder reading', null, false);
    if (!made.ok) throw new Error(made.message);
    const id = made.ids[0] ?? '';
    const added = await d.playlists.addItems(id, null, [
      { kind: 'shastra', passageId: 'shastra:pg#21' },
      { kind: 'shastra', passageId: 'shastra:pg#1' },
    ]);
    if (!added.ok) throw new Error(added.message);
    return id;
  });
  const items = await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.playlists.items(id),
    playlistId,
  );
  expect(items.map((i) => [i.kind, i.label])).toEqual([
    ['shastra', 'Placeholder Granth 21'],
    ['shastra', 'Placeholder Granth 1'],
  ]);
  await win.evaluate(
    ({ playlistId: pl, itemId }) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'playItem', playlistId: pl, itemId }),
    { playlistId, itemId: items[0]?.id ?? '' },
  );
  await expect.poll(async () => (await live(win)).presentationId).toBe('shastra:pg#21');
  const count = (await live(win)).slideCount;
  expect(count).toBeGreaterThan(1);
  // Next through every slide of it, then on to the next item.
  for (let i = 1; i < count; i++) {
    await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'next' }));
    await expect.poll(async () => (await live(win)).slideIndex).toBe(i);
  }
  // The parts say so on the reference line.
  const reference = async () =>
    (await bridge(win).snapshot()).state.layers.slide?.slide.elements.find((e) =>
      e.id.endsWith('-reference'),
    );
  expect(await reference()).toMatchObject({
    kind: 'text',
    text: `Placeholder Granth 21 (${String(count)}/${String(count)})`,
  });
  await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'next' }));
  await expect.poll(async () => (await live(win)).presentationId).toBe('shastra:pg#1');
  // A short item too may take two slides when the Look shows every language at once.
  const first = await reference();
  expect(first?.kind === 'text' ? first.text : null).toMatch(/^Placeholder Granth 1( \(1\/\d\))?$/u);

  // A template keeps a passage; a slot asks for one, filled from the playlist.
  const filled = await win.evaluate(async (pl) => {
    const d = (globalThis as PageGlobals).drashti;
    const slot = await d.playlists.addSlot(pl, null, {
      label: 'Placeholder reading slot',
      category: 'Shastra',
    });
    if (!slot.ok) throw new Error(slot.message);
    const template = await d.playlists.saveAsTemplate(pl, { name: 'Placeholder template', slots: [] });
    if (!template.ok) throw new Error(template.message);
    const made = await d.playlists.newFromTemplate(template.ids[0] ?? '', 'Placeholder from template', null);
    if (!made.ok) throw new Error(made.message);
    return d.playlists.items(made.ids[0] ?? '');
  }, playlistId);
  expect(filled.map((i) => [i.kind, i.label])).toEqual([
    ['shastra', 'Placeholder Granth 21'],
    ['shastra', 'Placeholder Granth 1'],
    ['placeholder', 'Placeholder reading slot'],
  ]);
  // Filling the slot in the window: it asks for a passage.
  // (The live playlist may be open: back to the list first.)
  const back = win.getByTestId('playlists-back');
  if (await back.isVisible()) await back.click();
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder from template' }).click();
  await win.getByTestId('playlist-item').filter({ hasText: 'Placeholder reading slot' }).click();
  const fill = win.getByTestId('fill-slot');
  await expect(fill.getByTestId('passage-picker')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'filling a slot that asks for a passage');
  await fill.getByTestId('passage-reference').fill('PV P.M. 2');
  await fill.getByTestId('use-passage').click();
  await expect(fill).toHaveCount(0);
  await expect(
    win.getByTestId('playlist-item').filter({ hasText: 'Placeholder Vachan Placeholder Madhya 2' }),
  ).toBeVisible();
  await app.close();
});

const TWO_OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };

/** The output showing this screen. */
async function outputFor(app: ElectronApplication, screenId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const p of outputPages(app))
        if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) found = p;
      return found !== undefined;
    })
    .toBe(true);
  if (!found) throw new Error(`no output for ${screenId}`);
  return found;
}

test('each group shows its own languages, Sanskrit in either script, and a lower third', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(TWO_OUTPUTS);
  const win = await operatorPage(app);
  await operatorReady(win);
  await load(win, [exampleFiles().granth]);
  const hallId = await setUpScreen(win, 'Placeholder hall', 0);
  const sideId = await setUpScreen(win, 'Placeholder side', 1);
  const [hall, side] = [await outputFor(app, hallId), await outputFor(app, sideId)];
  // The hall: Sanskrit in Gujarati script and the Gujarati meaning; the side: Devanagari and English, as a lower third.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const looks = await d.looks.list();
    const screens = await d.screens.get();
    const group = (name: string) => screens.groups.find((g) => g.name === name)?.id ?? '';
    await d.looks.setGroup(looks.liveId, group('Placeholder hall'), { languages: ['sa-gu', 'gu'] });
    await d.looks.setGroup(looks.liveId, group('Placeholder side'), {
      languages: ['sa', 'en'],
      slides: 'lowerThird',
    });
    await d.engine.dispatch({ type: 'goLive', presentationId: 'shastra:pg#3', slideIndex: 0 });
  });
  const runs = (out: Page) =>
    out
      .getByTestId('output-root')
      .evaluate((root) =>
        [...root.querySelectorAll('[data-layer="slide"] [data-slide-in] [data-run]')].map((r) => [
          r.getAttribute('data-lang'),
          r.textContent.trim(),
        ]),
      );
  await expect
    .poll(() => runs(hall))
    .toEqual([
      ['sa-gu', 'નમૂના શ્લોકઃ પ્રથમઃ પાદઃ 3।\nનમૂના શ્લોકઃ દ્વિતીયઃ પાદઃ 3॥'],
      ['gu', 'આ નમૂના શ્લોક 3 નો નમૂના અર્થ છે.'],
    ]);
  // The reference line shows on every screen, whatever its languages.
  await expect(hall.getByTestId('output-root')).toContainText('Placeholder Granth 3');
  const third = side.getByTestId('lower-third');
  await expect(third).toBeVisible();
  await expect
    .poll(() =>
      third.evaluate((el) => [...el.querySelectorAll('[data-lang]')].map((l) => l.getAttribute('data-lang'))),
    )
    .toEqual(['en', 'sa', 'sa', 'en']);
  await expect(third).toContainText('Placeholder Granth 3');
  await expect(third).toContainText('नमूना श्लोकः प्रथमः पादः 3।');
  await app.close();
});

test('the remote and the API put up a reference', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await load(win, [exampleFiles().granth, exampleFiles().vachan]);
  const { port, base } = await networkOn(win);
  const token = await pairToken(win, port, 'remote', 'Placeholder script');
  const listed = await apiCall(port, '/api/v1/shastra', { token });
  expect(listed.json['texts']).toEqual([
    { name: 'Placeholder Granth', abbreviation: 'PG', itemCount: 21 },
    { name: 'Placeholder Vachan', abbreviation: 'PV', itemCount: 8 },
  ]);
  const put = await apiCall(port, '/api/v1/shastra', {
    method: 'POST',
    token,
    body: { reference: 'PG 4-5' },
  });
  expect(put.status).toBe(200);
  expect(put.json['reference']).toBe('Placeholder Granth 4–5');
  await expect.poll(async () => (await live(win)).presentationId).toBe('shastra:pg#4-5');
  const nonsense = await apiCall(port, '/api/v1/shastra', {
    method: 'POST',
    token,
    body: { reference: 'XY 4' },
  });
  expect(nonsense).toEqual({
    status: 404,
    json: { ok: false, message: 'No loaded text is called “XY”. The texts are: PG, PV.' },
  });

  // A phone: the More tab's reference box.
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  try {
    await pairByQr(phone.page, base, code, '/remote');
    await phone.page.getByTestId('remote-tab-more').click();
    const form = phone.page.getByTestId('remote-shastra');
    await form.getByRole('textbox', { name: 'Reference' }).fill('PV P.Pr. 3');
    await form.getByRole('button', { name: 'Show' }).click();
    await expect.poll(async () => (await live(win)).presentationId).toBe('shastra:pv/ppr#3');
  } finally {
    await phone.close();
  }
  await app.close();
});
