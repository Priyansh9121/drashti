import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { settled } from './a11y';
import { fitFaults } from './fit';
import type { PageGlobals } from './helpers';
import {
  closeLibrary,
  closePlaylistIfOpen,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
} from './helpers';
import { KIRTAN, PICTURE, PLAYLIST, setUpPlaceholderShow, WELCOME } from './placeholder-show';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The ?'s rooms in the left column and the middle (alpha.24, lead 2's middlehelp; the a25 list's items 6, 16, 21 and
 * 41). Help is off at a first start, so no ? is drawn; turning it on brought the playlists', the Wallpapers', a
 * presentation's slides' and the open playlist's ? into their headings, and everything beside each moved: New and the
 * Wallpapers' Import… about 28 px, the open playlist's Add files…, From a Link… and Find about 30 px, and at CI's
 * 1024 × 645 the slides' heading wrapped, its menu on a second row and every slide row 36 px down. Each heading now holds
 * its ?'s room while Help is off (WhatIsThis's keepRoom, as a panel's heading does), so in Pro Mode (Simple Mode has no
 * ?) turning Help on or off moves nothing in them, the slides' heading stays one row at CI's window, and nothing is cut
 * with the rooms held (fit.ts's fitFaults). The icon-alone buttons' tooltips begin with their names (uitop's rule for
 * the top bar). And the first playlist's keyboard ring is drawn whole: the list it scrolls in had cut its top.
 * Placeholder names only.
 */

/** The owner's own window (22 Nov 2026, alpha.20.1 on his Mac), in CSS pixels (operator-fit.spec.ts's). */
const OWNERS_WINDOW = { width: 1410, height: 900 } as const;

/**
 * The names given in this test (placeholder-show.ts), the words it writes on its slides and the library's two seeded
 * presentations: the operator's own, so they may end in "…" (playlist-head.spec.ts's).
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

/** Both side columns at their least, each by its splitter's Home key as an operator can (operator-fit.spec.ts's). */
async function columnsAtTheirLeast(win: Page): Promise<void> {
  for (const name of ['Resize the live column', 'Resize the playlists']) {
    const splitter = win.getByRole('separator', { name, exact: true });
    await splitter.focus();
    await splitter.press('Home');
  }
  await win.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await laidOut(win);
}

/**
 * Every part of a heading as drawn, where it is in the window and how big (its ? and the ?'s room left out): what
 * turning Help on or off must never move.
 */
const partsOf = (strip: Locator) =>
  strip.evaluate((el) =>
    [...el.querySelectorAll(':scope > svg, h2, button, select, label')]
      .filter((p) => !p.matches('[data-what-is-this]'))
      .map((p) => ({ p, r: p.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
      .map(
        ({ p, r }) =>
          `${p.tagName.toLowerCase()} “${p.getAttribute('data-testid') ?? p.getAttribute('aria-label') ?? p.textContent.trim().slice(0, 30)}”: ${r.left.toFixed(1)}, ${r.top.toFixed(1)}, ${r.width.toFixed(1)} × ${r.height.toFixed(1)}`,
      ),
  );

/** How far apart a heading's parts' middles are, up and down (its ? among them): 0 on one row (1 px for rounding). */
const spread = (strip: Locator) =>
  strip.evaluate((el) => {
    const middles = [...el.querySelectorAll(':scope > svg, h2, button, select, label')]
      .map((p) => p.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => r.top + r.height / 2);
    return Math.max(...middles) - Math.min(...middles);
  });

/** A presentation chosen in the library, with no playlist open: its slides in the middle, under its heading. */
async function chooseInLibrary(win: Page, name: string): Promise<void> {
  await closePlaylistIfOpen(win);
  const sheet = await openLibrary(win);
  await sheet
    .getByTestId('presentation-list')
    .getByRole('button', { name: new RegExp(`^${name}`, 'u') })
    .click();
  await closeLibrary(win);
  await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toHaveText(name);
}

/**
 * Help turned on, then off again, by the status bar's switch (as an operator's click does, the focus left where it
 * was): each heading's parts read at rest, with Help on (its ? in sight) and with Help off again, and each read the
 * same.
 */
async function helpMovesNothing(
  win: Page,
  where: string,
  headings: { name: string; strip: Locator; ask: string }[],
): Promise<void> {
  const help = win.getByTestId('help-toggle');
  await expect(help).toHaveAttribute('aria-pressed', 'false');
  await laidOut(win);
  const read = async () =>
    Object.fromEntries(
      await Promise.all(headings.map(async (h) => [h.name, await partsOf(h.strip)] as const)),
    );
  const atRest = await read();
  for (const h of headings)
    expect(atRest[h.name]?.length ?? 0, `${where}: the ${h.name}' parts measured`).toBeGreaterThanOrEqual(2);
  await help.dispatchEvent('click');
  await expect(help).toHaveAttribute('aria-pressed', 'true');
  for (const h of headings) await expect(h.strip.getByTestId(h.ask)).toBeVisible();
  await laidOut(win);
  expect.soft(await read(), `${where}: with Help on`).toEqual(atRest);
  await help.dispatchEvent('click');
  await expect(help).toHaveAttribute('aria-pressed', 'false');
  await expect(win.locator('[data-what-is-this]')).toHaveCount(0);
  await laidOut(win);
  expect.soft(await read(), `${where}: with Help off again`).toEqual(atRest);
}

for (const size of [CI_WINDOW, OWNERS_WINDOW])
  test(`Pro Mode at ${String(size.width)} × ${String(size.height)}: turning Help on and off moves nothing in the left column’s headings, a presentation’s slides’ heading or the open playlist’s header, with the columns as they open and at their least; the slides’ heading one row with Help on; nothing cut with the rooms held; the icon-alone buttons’ tooltips begin with their names`, async () => {
    test.setTimeout(150_000);
    const { app } = await launchApp();
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, size);
    await setUpPlaceholderShow(win);
    await win.evaluate(() => document.fonts.ready.then(() => undefined));
    const playlists = win.getByTestId('playlists').locator('[data-strip]').first();
    const wallpapers = win.getByTestId('wallpapers').locator('[data-strip]').first();
    const slides = win.getByTestId('slide-grid').locator('[data-strip]').first();
    const middle = win.getByTestId('column-middle');
    const header = middle.getByTestId('playlist-title').locator('..');

    // The Wallpapers' Import… shows its icon alone in a narrow column: its tooltip begins with its name.
    const wallpapersImport = win.getByTestId('wallpapers-import');
    await expect(wallpapersImport).toHaveAccessibleName('Import…');
    await expect.soft(wallpapersImport).toHaveAttribute('title', 'Import…: bring pictures in as wallpapers');

    for (const columns of ['as they open', 'at their least'] as const) {
      if (columns === 'at their least') await columnsAtTheirLeast(win);
      const where = `${String(size.width)} × ${String(size.height)}, the columns ${columns}`;

      // A presentation with no arrangement chosen in the library: the playlists' and Wallpapers' headings in the left
      // column, the slides' in the middle.
      await chooseInLibrary(win, WELCOME);
      await expect(slides.getByTestId('arrangement')).toHaveCount(0);
      await helpMovesNothing(win, `${where}, ${WELCOME} chosen`, [
        { name: 'playlists', strip: playlists, ask: 'what-is-this-playlists' },
        { name: 'Wallpapers', strip: wallpapers, ask: 'what-is-this-wallpapers' },
        { name: 'slides', strip: slides, ask: 'what-is-this-slides' },
      ]);
      // In the owner's window and CI's, as they open, its name, the ?, Edit slides and its menu on one row with Help
      // on (at 1024 × 645 the menu had gone to a second row and every slide row down 36 px).
      if (columns === 'as they open') {
        await win.getByTestId('help-toggle').dispatchEvent('click');
        await expect(slides.getByTestId('what-is-this-slides')).toBeVisible();
        await laidOut(win);
        expect
          .soft(await spread(slides), `${where}: the slides' heading on one row with Help on`)
          .toBeLessThanOrEqual(1);
        await win.getByTestId('help-toggle').dispatchEvent('click');
        await expect(win.locator('[data-what-is-this]')).toHaveCount(0);
        await laidOut(win);
      }
      expect.soft(await fitFaults(win, NAMES), `${where}, ${WELCOME} chosen: nothing cut`).toEqual([]);

      // One with an arrangement: its Arrangement list in the heading too.
      await chooseInLibrary(win, KIRTAN);
      await expect(slides.getByTestId('arrangement')).toBeVisible();
      await helpMovesNothing(win, `${where}, ${KIRTAN} chosen`, [
        { name: 'slides', strip: slides, ask: 'what-is-this-slides' },
      ]);

      // The playlist open: its header's Add files…, From a Link…, Find, ⋯ and ×.
      await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
      await expect(middle.getByTestId('playlist-title')).toHaveText(PLAYLIST);
      await helpMovesNothing(win, `${where}, the playlist open`, [
        { name: 'open playlist', strip: header, ask: 'what-is-this-playlist' },
      ]);
      expect.soft(await fitFaults(win, NAMES), `${where}, the playlist open: nothing cut`).toEqual([]);
    }
    await app.close();
  });

/**
 * Where the keyboard's ring round the focused control is cut by a box round it that clips (one that scrolls, or hides
 * what is outside it): each such side, by how much. The ring is its outline, drawn its offset outside it.
 */
const ringCuts = (win: Page) =>
  win.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body)
      return { name: 'nothing', ring: false, cuts: [] };
    const style = getComputedStyle(el);
    const out = (Number.parseFloat(style.outlineWidth) || 0) + (Number.parseFloat(style.outlineOffset) || 0);
    const r = el.getBoundingClientRect();
    const ring = { left: r.left - out, top: r.top - out, right: r.right + out, bottom: r.bottom + out };
    const cuts: string[] = [];
    for (let at = el.parentElement; at; at = at.parentElement) {
      const clip = getComputedStyle(at);
      if (clip.overflowX === 'visible' && clip.overflowY === 'visible') continue;
      const b = at.getBoundingClientRect();
      const inside = {
        left: b.left + at.clientLeft,
        top: b.top + at.clientTop,
        right: b.left + at.clientLeft + at.clientWidth,
        bottom: b.top + at.clientTop + at.clientHeight,
      };
      const what =
        at.getAttribute('data-testid') ?? at.getAttribute('aria-label') ?? at.tagName.toLowerCase();
      const by = {
        left: inside.left - ring.left,
        top: inside.top - ring.top,
        right: ring.right - inside.right,
        bottom: ring.bottom - inside.bottom,
      };
      for (const [side, px] of Object.entries(by))
        if (px > 0.5) cuts.push(`its ${side} cut ${px.toFixed(1)} px by “${what}”`);
    }
    return {
      name:
        el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? el.textContent.trim().slice(0, 40),
      ring: el.matches(':focus-visible') && style.outlineStyle !== 'none' && out > 0,
      cuts,
    };
  });

test('the first playlist’s keyboard ring, and its Rename’s and Delete’s, drawn whole: the list they scroll in cuts none of them, in Pro and Simple Mode at 1024 × 645', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await setUpPlaceholderShow(win);
  for (const mode of ['pro', 'simple'] as const) {
    if (mode === 'simple') {
      await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
      await expect(win.getByTestId('simple-mode')).toBeVisible();
    }
    const first = win.getByTestId('playlist-tree').getByTestId('playlist-node').first();
    const row = first.locator('..');
    // Chosen, so its Rename and Delete are Tab stops too (Session 26a).
    await first.click();
    await expect(first).toHaveAttribute('aria-current', 'true');
    await first.focus();
    await laidOut(win);
    // From the keyboard: the row's Rename and Delete, then Shift+Tab back to the row itself.
    const seen: Awaited<ReturnType<typeof ringCuts>>[] = [];
    for (let i = 0; i < 4; i += 1) {
      await win.keyboard.press('Tab');
      if (!(await row.evaluate((li) => li.contains(document.activeElement)))) break;
      seen.push(await ringCuts(win));
    }
    for (let i = 0; i < 6 && !(await first.evaluate((b) => b === document.activeElement)); i += 1)
      await win.keyboard.press('Shift+Tab');
    await expect(first).toBeFocused();
    seen.push(await ringCuts(win));
    console.log(`${mode}: ${JSON.stringify(seen)}`);
    expect(
      seen.map((s) => s.name),
      `${mode}: the first row's stops`,
    ).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Rename /u), expect.stringMatching(/^Delete /u)]),
    );
    for (const s of seen) {
      expect.soft(s.ring, `${mode}: “${s.name}” shows the keyboard's ring`).toBe(true);
      expect.soft(s.cuts, `${mode}: “${s.name}”'s ring`).toEqual([]);
    }
  }
  await app.close();
});
