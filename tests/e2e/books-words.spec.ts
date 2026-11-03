import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  dropFiles,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  showExtras,
} from './helpers';

/*
 * Books, never Shastra, wherever a person sees it (the owner's words, 3 Nov 2026, for alpha.15). The operator window
 * walked as an admin and a volunteer meet it: the library's Books tab with nothing loaded and with two books, its
 * dialogs, its notices and errors, a passage in a playlist and a template's slot asking for one, the kirtan details,
 * the menus, the guides inside Drashti and Simple Mode; then a phone's pages in Pro Mode and in Simple Mode. None
 * shows or says Shastra, in its words, its accessible names (what a screen reader reads), its tooltips or its
 * placeholders; the text format's file name (docs/shastra-format.md) is the one word kept. The made-up books of
 * docs/examples; placeholder names only.
 */

const EXAMPLES = join(__dirname, '..', '..', 'docs', 'examples');

/** The two example books, a book file Drashti cannot read and a JSON file that is no book, in a folder of the test's. */
function bookFiles(): { granth: string; vachan: string; broken: string; other: string } {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-books-'));
  const granth = join(dir, 'placeholder-granth.json');
  const vachan = join(dir, 'placeholder-vachan.json');
  copyFileSync(join(EXAMPLES, 'placeholder-granth.json'), granth);
  copyFileSync(join(EXAMPLES, 'placeholder-vachan.json'), vachan);
  const broken = join(dir, 'placeholder-broken.json');
  writeFileSync(
    broken,
    JSON.stringify({
      format: 'drashti-shastra',
      version: 1,
      name: 'Placeholder Broken',
      abbreviation: 'PB',
      items: [{ number: 'one', text: { en: 'A placeholder line.' } }],
    }),
  );
  const other = join(dir, 'placeholder-other.json');
  writeFileSync(other, JSON.stringify({ placeholder: true }));
  return { granth, vachan, broken, other };
}

/** Everything a page shows and says: its words, its accessible names and roles, its tooltips and placeholders. */
async function wordsOf(page: Page): Promise<string[]> {
  const shown = await page.evaluate(() => {
    const said = ['aria-label', 'title', 'placeholder', 'alt', 'aria-description', 'aria-roledescription'];
    return [
      document.title,
      document.body.innerText,
      ...[...document.querySelectorAll('*')].flatMap((el) => said.map((name) => el.getAttribute(name) ?? '')),
      ...[...document.querySelectorAll('option')].map((o) => o.label),
    ];
  });
  return [...shown, await page.locator('body').ariaSnapshot()].flatMap((words) => words.split('\n'));
}

/**
 * Nothing on the page says Shastra (the text format's file name, docs/shastra-format.md, aside). Soft, so one run
 * names every place that still does.
 */
async function saysBooks(page: Page, where: string): Promise<void> {
  const lines = (await wordsOf(page))
    .map((line) => line.replace(/(docs\/)?shastra-format\.md/gu, ''))
    .filter((line) => /shastra/iu.test(line))
    .map((line) => line.trim());
  expect.soft([...new Set(lines)], `${where}: no Shastra`).toEqual([]);
}

/** Every label of the application menu, submenus included. */
const menuWords = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => {
    const words: string[] = [];
    const walk = (menu: ReturnType<typeof Menu.getApplicationMenu>) => {
      for (const item of menu?.items ?? []) {
        words.push(item.label, item.sublabel, item.toolTip);
        walk(item.submenu ?? null);
      }
    };
    walk(Menu.getApplicationMenu());
    return words.filter((w) => w !== '');
  });

/** The words of an element fit it: none cut off (at CI's 1024 × 645 and at 1280 × 720). */
async function fits(element: Locator, what: string): Promise<void> {
  await expect(element, what).toBeVisible();
  const box = await element.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(box.scroll, `${what}: its words fit`).toBeLessThanOrEqual(box.client);
}

const SIZES = [
  { width: 1024, height: 645 },
  { width: 1280, height: 720 },
] as const;

test('the operator window: the Books tab, its dialogs, notices and errors, a passage in a playlist and a slot asking for one, the kirtan details, the menus, the guides and Simple Mode say Books, never Shastra', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await showExtras(win);
  await win.setViewportSize(SIZES[0]);
  const files = bookFiles();
  const library = await openLibrary(win);

  // The library with the kirtan details shown (View › Show Books, Templates and Kirtan Details).
  await saysBooks(win, 'the library with its kirtan details');
  // Its third tab, with nothing loaded: a reference asked for says why.
  await library.getByTestId('library-tab-shastra').click();
  const panel = win.getByTestId('shastra-panel');
  await expect(panel).toBeVisible();
  await saysBooks(win, 'the Books tab, with no book loaded');
  await panel.getByTestId('shastra-reference').fill('PG 14');
  await panel.getByTestId('shastra-reference').press('Enter');
  await expect(panel.getByTestId('shastra-problem')).toHaveText('No books are loaded yet.');
  await saysBooks(win, 'a reference asked for with no book loaded');
  await expect(library.getByRole('tab', { name: 'Books', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Two books dropped on the library, with a book Drashti cannot read and a JSON file that is no book: the report.
  await library.getByTestId('library-tab-presentations').click();
  await dropFiles(win, win.getByTestId('library-drop'), [
    files.granth,
    files.vachan,
    files.broken,
    files.other,
  ]);
  const report = win.getByTestId('import-report');
  await expect(report).toContainText(
    'Loaded: 21 items. Find a passage in Books by typing its reference, for example “PG 1”.',
  );
  await expect(report).toContainText('This is not a book Drashti can read');
  await expect(report).toContainText('A JSON file that is not a book or a calendar Drashti knows');
  await saysBooks(win, 'the import report');
  await report.getByRole('button', { name: 'Open in Books' }).first().click();

  // The books' own dialog, and removing one, asked first.
  const dialog = win.getByTestId('shastra-texts-dialog');
  await expect(dialog.getByTestId('shastra-text-row')).toHaveCount(2);
  await expect(dialog.getByRole('heading', { name: 'Books', exact: true })).toBeVisible();
  await saysBooks(win, 'the Books dialog');
  await dialog.getByRole('button', { name: 'Remove Placeholder Vachan' }).click();
  const confirm = win.getByTestId('shastra-remove-confirm');
  await expect(confirm).toContainText('until the book is loaded again');
  await saysBooks(win, 'removing a book, asked first');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await win.getByRole('button', { name: 'Close Books' }).click();
  await expect(dialog).toHaveCount(0);

  // The tab with two books: its list, a book's sections, a search, a passage shown in the middle.
  await expect(panel.getByTestId('shastra-text')).toHaveCount(2);
  await fits(panel.getByTestId('open-shastra-texts'), 'Books…');
  await saysBooks(win, 'the Books tab with two books');
  await panel.getByTestId('shastra-text').filter({ hasText: 'Placeholder Vachan' }).click();
  await expect(panel.getByTestId('shastra-tree')).toBeVisible();
  await saysBooks(win, 'a book’s sections');
  await panel.getByRole('button', { name: 'All books' }).click();
  await panel.getByTestId('shastra-search').fill('placeholder meaning 12');
  await expect(panel.getByTestId('shastra-hit').first()).toContainText('Placeholder Granth 12');
  await saysBooks(win, 'a search of the books’ words');
  await panel.getByTestId('shastra-search').fill('');
  await panel.getByTestId('shastra-reference').fill('XY 1');
  await panel.getByTestId('shastra-reference').press('Enter');
  await expect(panel.getByTestId('shastra-problem')).toHaveText(
    'No loaded book is called “XY”. The books are: PG, PV.',
  );
  await panel.getByTestId('shastra-reference').fill('PG 14');
  await panel.getByTestId('shastra-reference').press('Enter');
  await expect(win.getByTestId('passage-note')).toHaveText(
    'Passage from a book · drag it from Books onto a playlist to add it',
  );
  await saysBooks(win, 'a passage in the middle');

  // A playlist with two passages and a slot asking for one, as a library stores it ("Shastra", SHASTRA_SLOT).
  const playlistId = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.playlists.create('Placeholder reading', null, false);
    if (!made.ok) throw new Error(made.message);
    const id = made.ids[0] ?? '';
    const added = await d.playlists.addItems(id, null, [
      { kind: 'shastra', passageId: 'shastra:pg#14' },
      { kind: 'shastra', passageId: 'shastra:pv/ppr#2' },
    ]);
    if (!added.ok) throw new Error(added.message);
    const slot = await d.playlists.addSlot(id, null, {
      label: 'Placeholder reading slot',
      category: 'Shastra',
    });
    if (!slot.ok) throw new Error(slot.message);
    return id;
  });
  await win.getByTestId('library-close').click();
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder reading' }).click();
  const card = (name: string) => win.getByTestId('playlist-item').filter({ hasText: name });
  await expect(card('Placeholder Granth 14').getByTestId('item-what')).toHaveText('Passage from a book');
  const slot = card('Placeholder reading slot');
  await expect(slot).toContainText('A slot · Books · choose what goes here');
  await expect(slot).toHaveAccessibleName(
    'Slot: Placeholder reading slot (Books). Press to choose what goes here.',
  );
  // A passage's card says what it is in full at both sizes. (A slot's line is cut short with "…" on a card as narrow
  // as 1024 × 645's, Books or not, as it was before; its accessible name above carries every word.)
  for (const size of SIZES) {
    await win.setViewportSize(size);
    const at = `${String(size.width)} × ${String(size.height)}`;
    await fits(card('Placeholder Granth 14').getByTestId('item-what'), `a passage’s card at ${at}`);
  }
  await saysBooks(win, 'a playlist with passages and a slot asking for one');

  // Its menu's Add a slot…, the slot's Edit slot…, and filling it.
  await win.getByRole('button', { name: 'Playlist actions' }).click();
  await win.getByRole('menuitem', { name: 'Add a slot…' }).click();
  const add = win.getByTestId('add-slot');
  await add.getByTestId('slot-category').selectOption({ label: 'A passage from a book' });
  await expect(add).toContainText(
    'Filling the slot asks for a passage from a book, by its reference or its words.',
  );
  await saysBooks(win, 'adding a slot');
  await add.getByRole('button', { name: 'Cancel' }).click();
  await slot.click({ button: 'right' });
  await saysBooks(win, 'a slot’s menu');
  await win.getByRole('menuitem', { name: 'Edit slot…' }).click();
  const edit = win.getByTestId('edit-slot');
  await expect(edit.getByTestId('slot-category')).toHaveValue('Shastra');
  await expect(edit.getByTestId('slot-category').locator('option:checked')).toHaveText(
    'A passage from a book',
  );
  await saysBooks(win, 'editing a slot');
  await edit.getByRole('button', { name: 'Cancel' }).click();
  await slot.click();
  const fill = win.getByTestId('fill-slot');
  await expect(fill.getByTestId('passage-picker')).toBeVisible();
  await saysBooks(win, 'filling a slot that asks for a passage');
  await fill.getByRole('button', { name: 'Cancel' }).click();

  // A book removed while a playlist names its passage: its card says so, and putting it up says why not.
  const vachanId = await win.evaluate(
    async () =>
      (await (globalThis as PageGlobals).drashti.shastra.list()).find((t) => t.abbreviation === 'PV')?.id ??
      '',
  );
  await win.evaluate(async (id) => {
    const removed = await (globalThis as PageGlobals).drashti.shastra.remove(id);
    if (!removed.ok) throw new Error(removed.message);
  }, vachanId);
  // (An open playlist reads its rows again when the playlists change, not when a book goes: opened again here.)
  await win.getByTestId('playlist-close').click();
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder reading' }).click();
  const missing = card('Placeholder Vachan');
  await expect(missing).toContainText('Its book is not loaded');
  const missingId = await win.evaluate(
    async (id) =>
      (await (globalThis as PageGlobals).drashti.playlists.items(id)).find(
        (i) => i.kind === 'shastra' && i.missing,
      )?.id ?? '',
    playlistId,
  );
  const played = await win.evaluate(
    ({ pl, itemId }) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'playItem', playlistId: pl, itemId }),
    { pl: playlistId, itemId: missingId },
  );
  expect(JSON.stringify(played)).toContain('its book is not loaded');
  await saysBooks(win, 'a passage whose book is not loaded');

  // The templates beside the playlists.
  await win.getByTestId('playlist-view-tab-templates').click();
  await saysBooks(win, 'the templates');
  await win.getByTestId('playlist-view-tab-playlists').click();

  // The menus, as on this computer (menu.test.ts builds them as on the Mac and on Windows).
  const menus = await menuWords(app);
  expect(menus).toContain('Show Books, Templates and Kirtan Details');
  expect(menus.filter((w) => /shastra/iu.test(w))).toEqual([]);

  // The guides inside Drashti: the admin's has the books' section.
  await chooseMenuItem(app, 'guides');
  const guides = win.getByTestId('guides');
  await expect(guides).toBeVisible();
  for (const tab of ['operator', 'presenter', 'admin', 'setup-day']) {
    await guides.getByTestId(`guides-tab-${tab}`).click();
    await expect(guides.getByTestId(`guides-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
    await saysBooks(win, `the ${tab} guide inside Drashti`);
  }
  await win.getByRole('button', { name: 'Close the guides' }).click();

  // Simple Mode, with the passages' playlist as its one playlist (open as Drashti switches).
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder reading' }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder reading');
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(card('Placeholder Granth 14').getByTestId('item-what')).toHaveText('Passage from a book');
  await saysBooks(win, 'Simple Mode');
  expect((await menuWords(app)).filter((w) => /shastra/iu.test(w))).toEqual([]);
  await win.getByTestId('simple-leave').dblclick();
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  await app.close();
});

test('a phone’s pages say Books, never Shastra: its pairing page and every tab of the remote, in Pro Mode and in Simple Mode', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await showExtras(win);
  const files = bookFiles();
  const playlistId = await win.evaluate(
    async (paths) => {
      const d = (globalThis as PageGlobals).drashti;
      const started = await d.library.importPaths(paths);
      if (!started.ok) throw new Error(started.message);
      const made = await d.playlists.create('Placeholder reading', null, false);
      if (!made.ok) throw new Error(made.message);
      const id = made.ids[0] ?? '';
      const added = await d.playlists.addItems(id, null, [{ kind: 'shastra', passageId: 'shastra:pg#14' }]);
      if (!added.ok) throw new Error(added.message);
      return id;
    },
    [files.granth, files.vachan],
  );
  await expect
    .poll(async () => (await win.evaluate(() => (globalThis as PageGlobals).drashti.shastra.list())).length)
    .toBe(2);
  const { base } = await networkOn(win);
  const phone = await device('chromium');
  const p = phone.page;
  try {
    await p.goto(`${base}/pair`);
    await expect(p.getByTestId('pair-page')).toBeVisible();
    await saysBooks(p, 'the pairing page');
    // A new page for the code (only the address's # changing would not load the pairing page again).
    await p.goto('about:blank');
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');

    // Pro Mode: every tab; the playlist with a passage (its name and slides, as a presentation's); the playlist
    // shared with phones, where each file says what it is; More with its Books box.
    await p.getByTestId('remote-tab-playlist').click();
    await p.getByTestId('remote-playlist').selectOption(playlistId);
    await expect(
      p
        .getByTestId('remote-item')
        .and(p.locator('[data-kind="group"]'))
        .filter({ hasText: 'Placeholder Granth 14' }),
    ).toBeVisible();
    await saysBooks(p, 'the phone’s Playlist tab');
    await win.evaluate(async (id) => {
      const shared = await (globalThis as PageGlobals).drashti.playlists.share(id, true);
      if (!shared.ok) throw new Error(shared.message);
    }, playlistId);
    await p.getByTestId('remote-tab-library').click();
    await p.getByTestId('remote-library-shared').click();
    await p.getByTestId('remote-shared-playlist').filter({ hasText: 'Placeholder reading' }).click();
    await expect(
      p.getByTestId('remote-shared-item').filter({ hasText: 'Placeholder Granth 14' }),
    ).toContainText('Passage from a book');
    await saysBooks(p, 'a playlist shared with the phone');
    await p.getByTestId('remote-tab-more').click();
    const books = p.getByTestId('remote-shastra');
    await expect(books).toBeVisible();
    await expect(p.getByRole('heading', { name: 'Books', exact: true })).toBeVisible();
    await saysBooks(p, 'the phone’s More tab');
    for (const tab of ['show', 'library']) {
      await p.getByTestId(`remote-tab-${tab}`).click();
      await saysBooks(p, `the phone’s ${tab} tab`);
    }

    // Simple Mode: the passages' playlist is its one playlist, on the phone too.
    await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder reading' }).click();
    await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    await expect(p.getByTestId('remote-simple')).toBeVisible();
    for (const tab of ['show', 'playlist', 'library', 'more']) {
      const button = p.getByTestId(`remote-tab-${tab}`);
      if ((await button.count()) === 0) continue;
      await button.click();
      await saysBooks(p, `the phone’s ${tab} tab in Simple Mode`);
    }
  } finally {
    await phone.close();
  }
  await app.close();
});
