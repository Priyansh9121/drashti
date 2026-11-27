import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { settled } from './a11y';
import { fitFaults } from './fit';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { KIRTAN, PICTURE, PLAYLIST, setUpPlaceholderShow, WELCOME } from './placeholder-show';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The open playlist's header and a chosen presentation's Order line each stay ONE row (alpha.24, lead 2's hdrwrap): in
 * CI's 1024 × 645 the header had wrapped to two rows (Add files… alone, then From a Link…, Find, the ?, ⋯ and ×), and
 * Down had gone under Order's list. In Pro and Simple Mode, at CI's window and the owner's own 1410 × 900, with the side
 * columns as they open, at their least and at their most: the header's controls on one row, and in Pro Mode the chosen
 * presentation's Order, Up and Down on one row (their middles within 1 px: each row centres them, and the ? is smaller
 * than the buttons beside it); nothing cut anywhere in the window (fit.ts's fitFaults); every name, title and test id
 * as before; the words in sight where they fit (lead 2's ask: From a Link…'s go before Add files…'s, Simple Mode's Add
 * files… always says its words, both say them in the owner's window as it opens); and nothing in either row moves when
 * the row goes live. Placeholder names only.
 */

/** The owner's own window (22 Nov 2026, alpha.20.1 on his Mac), in CSS pixels (operator-fit.spec.ts's). */
const OWNERS_WINDOW = { width: 1410, height: 900 } as const;

/** The side columns, each set by its splitter's keys as an operator can (operator-fit.spec.ts's). */
const COLUMNS = {
  'both columns at their least': { left: 'Home', right: 'Home' },
  'the playlists at their most': { left: 'End', right: 'Home' },
  'the live column at its most': { left: 'Home', right: 'End' },
} as const;

/**
 * The names given in this test (placeholder-show.ts), the words placeholder-show.ts writes on its slides (a slide's
 * row shows its first line, the operator's words, as operator-fit.spec.ts's SLIDE_WORDS) and the library's two seeded
 * presentations: they may end in "…".
 */
const NAMES = [
  PLAYLIST,
  WELCOME,
  KIRTAN,
  PICTURE,
  'Placeholder welcome to the sabha',
  'Placeholder chorus line',
  'Placeholder first verse',
  'Placeholder second verse',
  'Language test slides',
  'Sample kirtan (placeholder)',
];

/** Laid out, and what a size change starts (a container query) done: three frames, then every animation finished. */
async function laidOut(win: Page): Promise<void> {
  await win.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }),
  );
  await settled(win);
}

/** Both side columns as `columns` has them, then laid out (operator-fit.spec.ts's). */
async function setColumns(win: Page, columns: { left: string; right: string }): Promise<void> {
  for (const [name, key] of [
    ['Resize the live column', columns.right],
    ['Resize the playlists', columns.left],
  ] as const) {
    const splitter = win.getByRole('separator', { name, exact: true });
    await splitter.focus();
    await splitter.press(key);
  }
  await win.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await laidOut(win);
}

interface Part {
  what: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The parts of a row as drawn, each from the row's own top left (a row that scrolls with the playlist moves whole):
 * `parts` (a selector) inside `rowEl`, those drawn only.
 */
const partsOf = (rowEl: Locator, parts: string) =>
  rowEl.evaluate((el, selector) => {
    const at = el.getBoundingClientRect();
    return [...el.querySelectorAll(selector)]
      .map((p) => ({ p, r: p.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
      .map(({ p, r }) => ({
        what: `${p.tagName.toLowerCase()} “${p.getAttribute('data-testid') ?? p.getAttribute('aria-label') ?? p.textContent.trim().slice(0, 30)}”`,
        left: Math.round((r.left - at.left) * 10) / 10,
        top: Math.round((r.top - at.top) * 10) / 10,
        width: Math.round(r.width * 10) / 10,
        height: Math.round(r.height * 10) / 10,
      }));
  }, parts);

/** How far apart the parts' middles are, up and down: 0 on one row (1 px allowed for rounding). */
const spread = (parts: Part[]) => {
  const middles = parts.map((p) => p.top + p.height / 2);
  return Math.max(...middles) - Math.min(...middles);
};

/** The header's parts: its icon, the name and every button (Add files…, From a Link…, Find, the ?, ⋯ and ×). */
const HEADER_PARTS = ':scope > svg, h2, button';
/** Order's line's parts: its label, the list, Up and Down. */
const ORDER_PARTS = 'label, select, button';

for (const mode of ['pro', 'simple'] as const)
  for (const size of [CI_WINDOW, OWNERS_WINDOW])
    test(`${mode === 'pro' ? 'Pro' : 'Simple'} Mode at ${String(size.width)} × ${String(size.height)}: the open playlist’s header${mode === 'pro' ? ' and a chosen presentation’s Order, Up and Down' : ''} each on one row with the columns as they open, at their least and at their most; nothing cut; the names and titles kept; nothing in ${mode === 'pro' ? 'them' : 'it'} moves when the row goes live`, async () => {
      test.setTimeout(120_000);
      const { app } = await launchApp();
      const win = await operatorPage(app);
      await operatorReady(win);
      await sizeOperatorWindow(app, win, size);
      const show = await setUpPlaceholderShow(win);
      await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
      const middle = win.getByTestId('column-middle');
      await expect(middle.getByTestId('playlist-title')).toHaveText(PLAYLIST);
      const moves = middle.getByTestId('open-playlist').getByTestId('playlist-item-moves');
      if (mode === 'pro') {
        // The kirtan chosen (one click on a presentation's name chooses it and folds its slides; nothing goes up): its
        // Order (it has an arrangement), Up and Down under it.
        await middle.getByTestId('playlist-item').filter({ hasText: KIRTAN }).click();
        await expect(moves).toBeVisible();
        await expect(moves.getByTestId('arrangement')).toBeVisible();
      } else {
        // The playlist open in Pro Mode is Simple Mode's one playlist (Session 55, Part 18).
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
        await expect(win.getByTestId('simple-mode')).toBeVisible();
        await expect(middle.getByTestId('playlist-title')).toHaveText(PLAYLIST);
      }
      await win.evaluate(() => document.fonts.ready.then(() => undefined));
      await laidOut(win);
      const header = middle.getByTestId('playlist-title').locator('..');

      // Every name, title and test id as before, whether a button shows its words or its icon alone.
      const addFiles = header.getByRole('button', { name: 'Add files…', exact: true });
      await expect(addFiles).toHaveAttribute('data-testid', 'playlist-add-files');
      await expect(addFiles).toHaveAttribute(
        'title',
        'Import files and add them at the end of this playlist',
      );
      const fromLink = header.getByRole('button', { name: 'From a Link…', exact: true });
      await expect(fromLink).toHaveAttribute('data-testid', 'playlist-from-link');
      await expect(fromLink).toHaveAttribute(
        'title',
        'Download from a link and add it at the end of this playlist',
      );
      if (mode === 'pro') {
        await expect(moves.getByRole('button', { name: 'Up', exact: true })).toHaveAttribute(
          'data-move',
          'up',
        );
        await expect(moves.getByRole('button', { name: 'Down', exact: true })).toHaveAttribute(
          'data-move',
          'down',
        );
        await expect(moves.getByRole('combobox', { name: 'Order', exact: true })).toBeVisible();
      }
      // Their words in sight wherever the row has room for them (lead 2: keep the words where they fit): both in the
      // owner's window as it opens. In sight, not only there: a button showing its icon alone keeps its words unseen.
      const addWords = addFiles.getByText('Add files…', { exact: true });
      const linkWords = fromLink.getByText('From a Link…', { exact: true });
      if (size === OWNERS_WINDOW) {
        await expect(addWords).toBeVisible();
        await expect(linkWords).toBeVisible();
      }

      // The row goes live (the kirtan from its first slide): nothing in the header or Order's line moves.
      const before = {
        header: await partsOf(header, HEADER_PARTS),
        order: mode === 'pro' ? await partsOf(moves, ORDER_PARTS) : [],
      };
      // Played from its row (playItem: the playlist's place), as one click on it plays it; a goLive by the presentation
      // alone is played from the library, and no row of the playlist is up.
      const kirtanRow = middle.getByTestId('playlist-item').filter({ hasText: KIRTAN });
      const itemId = (await kirtanRow.getAttribute('data-item-id')) ?? '';
      expect(itemId).not.toBe('');
      await win.evaluate(
        (place) => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'playItem', ...place }),
        { playlistId: show.playlistId, itemId },
      );
      await expect(kirtanRow).toHaveAttribute('data-live', 'true');
      await laidOut(win);
      expect(await partsOf(header, HEADER_PARTS), 'the header as the row goes live').toEqual(before.header);
      if (mode === 'pro')
        expect(await partsOf(moves, ORDER_PARTS), 'Order’s line as the row goes live').toEqual(before.order);

      const findings: string[] = [];
      const states: [string, { left: string; right: string } | null][] = [
        ['as they open', null],
        ...Object.entries(COLUMNS),
      ];
      for (const [state, columns] of states) {
        if (columns) await setColumns(win, columns);
        const width = Math.round((await header.boundingBox())?.width ?? 0);
        const headerParts = await partsOf(header, HEADER_PARTS);
        const orderParts = mode === 'pro' ? await partsOf(moves, ORDER_PARTS) : [];
        const words = { addFiles: await addWords.isVisible(), fromLink: await linkWords.isVisible() };
        console.log(
          `${mode} ${String(size.width)} × ${String(size.height)}, the columns ${state}: the header ${String(width)} px, words ${JSON.stringify(words)} ${JSON.stringify(headerParts)}; Order's line ${JSON.stringify(orderParts)}`,
        );
        // From a Link…'s words go first, then Add files…'s; Simple Mode's Add files… says its words at every size.
        if (words.fromLink && !words.addFiles)
          findings.push(`the columns ${state}: From a Link… says its words, Add files… not`);
        if (mode === 'simple' && !words.addFiles)
          findings.push(`the columns ${state}: Simple Mode's Add files… shows its icon alone`);
        expect(headerParts.length, `${state}: the header's parts`).toBeGreaterThanOrEqual(
          mode === 'pro' ? 7 : 4,
        );
        if (spread(headerParts) > 1)
          findings.push(`the columns ${state}: the header is not one row (${JSON.stringify(headerParts)})`);
        if (mode === 'pro') {
          expect(orderParts.length, `${state}: Order's line's parts`).toBe(4);
          if (spread(orderParts) > 1)
            findings.push(
              `the columns ${state}: Order's line is not one row (${JSON.stringify(orderParts)})`,
            );
        }
        findings.push(...(await fitFaults(win, NAMES)).map((f) => `the columns ${state}: ${f}`));
      }
      expect(findings).toEqual([]);
      await app.close();
    });
