import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues, settled } from './a11y';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import {
  closeLibrary,
  dropFiles,
  importAndGetIds,
  launchApp,
  openLibrary,
  openMoreTools,
  operatorPage,
  relaunchApp,
} from './helpers';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

/*
 * The redesigned operator window: no serious or critical accessibility
 * findings in the window or any panel, nothing cut off or overlapping at
 * 1280 x 720 and 1920 x 1080, and the columns resize from the keyboard and
 * keep their size.
 */

/** A placeholder kirtan whose groups have one, two, three and four slides. */
const GROUPS_KIRTAN = 'Placeholder Groups Kirtan';
const GROUPS = [
  ['Verse 1', 1],
  ['Chorus', 2],
  ['Verse 2', 3],
  ['Bridge', 4],
] as const;

async function importGroupsKirtan(win: Page): Promise<void> {
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-groups-')), `${GROUPS_KIRTAN}.txt`);
  const lines = GROUPS.flatMap(([name, slides]) => [
    `[${name}]`,
    ...Array.from({ length: slides }, (_, i) => [`Placeholder ${name} line ${i + 1}`, '']).flat(),
  ]);
  writeFileSync(file, lines.join('\n'));
  await importAndGetIds(win, [file]);
}

/** Show the groups kirtan's slides (Session 55: the library's chosen presentation shows with no playlist open). */
async function openGroupsKirtan(win: Page): Promise<void> {
  const close = win.getByTestId('playlist-close');
  if ((await close.count()) > 0) await close.click();
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: new RegExp(`^${GROUPS_KIRTAN}`) })
    .click();
  await expect(win.getByTestId('slide-thumb')).toHaveCount(10);
}

/** Where each slide's row starts, top to bottom (Session 55: the slides are rows, one a line). */
async function rowTops(win: Page): Promise<number[]> {
  return win
    .getByTestId('slide-thumb')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
}

/**
 * The slides as rows (Session 55, Part 4: the slide grid went), one slide a row in play order, each group's name where
 * it starts, and each slide's group colour beside it.
 */
async function expectSlideRows(win: Page, what: string): Promise<void> {
  await expect(win.getByTestId('slide-list')).toHaveCount(1);
  const tops = await rowTops(win);
  expect(tops, `${what}: one slide a row`).toHaveLength(10);
  expect(
    tops.every((top, i) => i === 0 || top > (tops[i - 1] ?? 0)),
    `${what}: rows ${tops.join(', ')}`,
  ).toBe(true);
  const markers = win.getByTestId('slide-thumb').filter({ has: win.getByTestId('slide-group') });
  expect(await markers.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-index'))))).toEqual([
    0, 1, 3, 6,
  ]);
  expect(
    await win.getByTestId('slide-group').evaluateAll((els) => els.map((e) => e.getAttribute('data-group'))),
  ).toEqual(GROUPS.map(([name]) => name));
  // Each slide's colour strip is its group's colour (verse indigo, chorus teal since Session 26g, bridge
  // purple).
  const strips = await win
    .getByTestId('group-color')
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  const verse = 'rgb(62, 99, 221)';
  const chorus = 'rgb(18, 165, 148)';
  const bridge = 'rgb(142, 78, 198)';
  expect(strips).toEqual([verse, chorus, chorus, verse, verse, verse, bridge, bridge, bridge, bridge]);
}

/** Open the placeholder playlist and put the kirtan's second slide live. */
async function showRunning(win: Page) {
  await closeLibrary(win);
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  // Its slides are rows under its name in the playlist (Session 55): one click on the second puts it up.
  await win
    .getByTestId('open-playlist')
    .locator('[data-item-row]')
    .filter({ has: win.getByTestId('playlist-item').filter({ hasText: KIRTAN }) })
    .getByTestId('slide-thumb')
    .nth(1)
    .click();
  await expect(win.getByTestId('live-text')).toContainText(`${KIRTAN} · slide 2 of 5`);
}

test('the operator window and every panel pass the accessibility checks', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await setUpPlaceholderShow(win);
  // An import from the window: its report opens by itself while nothing is live.
  const dir = mkdtempSync(join(tmpdir(), 'drashti-ui-'));
  writeFileSync(join(dir, 'Placeholder Dropped Song.txt'), 'Placeholder dropped line\n');
  await openLibrary(win);
  await dropFiles(win, win.getByTestId('library-drop'), [join(dir, 'Placeholder Dropped Song.txt')]);
  await expect(win.getByTestId('import-report')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the import report');
  await win.getByTestId('import-report').getByRole('button', { name: 'Close' }).first().click();
  await showRunning(win);
  await expectNoSeriousA11yIssues(win, 'the operator window');
  // With the open playlist in the centre (Session 26a), and More tools unfolded.
  await expect(win.getByTestId('open-playlist')).toBeVisible();
  await openMoreTools(win);
  await expectNoSeriousA11yIssues(win, 'More tools, unfolded', '[data-testid="more-tools"]');

  // The panels on the right, with their forms open.
  for (const [panel, button] of [
    ['props', 'New prop'],
    ['messages', 'New message'],
    ['timers', 'New timer'],
  ] as const) {
    await win.getByTestId(panel).getByRole('button', { name: button }).click();
    await expectNoSeriousA11yIssues(win, `the ${panel} panel`, `[data-testid="${panel}"]`);
    await win.getByTestId(panel).getByRole('button', { name: 'Cancel' }).click();
  }

  // Menus.
  await win.getByRole('button', { name: 'Playlist actions' }).click();
  await expect(win.getByRole('menu')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'a menu', '[role="menu"]');
  await win.keyboard.press('Escape');

  // Each dialog.
  const dialogs: [string, () => Promise<void>, () => Promise<void>][] = [
    [
      'Screens',
      () => win.getByRole('button', { name: 'Screens', exact: true }).click(),
      () => win.getByRole('button', { name: 'Close screens' }).click(),
    ],
    [
      'Themes',
      () => win.getByRole('button', { name: 'Themes', exact: true }).click(),
      () => win.getByRole('button', { name: 'Close themes' }).click(),
    ],
    [
      // The words editor (Session 55: New… from words; the open presentation's Edit words went).
      'the words editor',
      async () => {
        await openLibrary(win);
        await win.getByTestId('library-sheet').getByRole('button', { name: 'New…' }).click();
      },
      () => win.getByTestId('words-editor').getByRole('button', { name: 'Cancel' }).click(),
    ],
    [
      'the import report',
      () => win.getByTestId('import-result').getByRole('button', { name: 'Report' }).click(),
      () => win.getByTestId('import-report').getByRole('button', { name: 'Close' }).first().click(),
    ],
    [
      'Remove presentations',
      async () => {
        await openLibrary(win);
        await win
          .getByTestId('presentation-list')
          .getByRole('button', { name: /^Placeholder Welcome/ })
          .click();
        await win.keyboard.press('Delete');
      },
      () => win.getByTestId('remove-confirm').getByRole('button', { name: 'Cancel' }).click(),
    ],
  ];
  for (const [name, open, close] of dialogs) {
    await open();
    await expect(win.locator('[aria-modal="true"]')).toBeVisible();
    await expectNoSeriousA11yIssues(win, name);
    await close();
    await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  }
  await app.close();
});

/** Every element matching `selector` is inside the window, and no two of them overlap. */
async function expectLaidOut(win: Page, what: string) {
  const problems = await win.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (document.documentElement.scrollWidth > vw)
      out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
    if (document.documentElement.scrollHeight > vh)
      out.push(`the page scrolls down (${document.documentElement.scrollHeight} > ${vh})`);
    const name = (el: Element) =>
      el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? el.textContent.trim().slice(0, 40);
    // The window's fixed parts: the header's and the bars' controls, and the columns.
    const groups = [
      [...document.querySelectorAll('[data-testid="app-header"] button, [data-testid="app-header"] h1')],
      [...document.querySelectorAll('[data-testid="layer-bar"] button')],
      [...document.querySelectorAll('footer[aria-label="Status"] > *')],
      [...document.querySelectorAll('[data-testid^="column-"]')],
    ];
    for (const group of groups) {
      const boxes = group.map((el) => ({ el, r: el.getBoundingClientRect() })).filter((b) => b.r.width > 0);
      for (const { el, r } of boxes) {
        if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5)
          out.push(`${name(el)} is cut off by the window edge`);
        // Words in a control must fit (names cut off on purpose use Truncate, which is not a control).
        if (el instanceof HTMLButtonElement && el.scrollWidth > el.clientWidth + 1)
          out.push(`${name(el)}: its words do not fit`);
      }
      boxes.forEach((one, i) => {
        for (const other of boxes.slice(i + 1)) {
          const a = one.r;
          const b = other.r;
          const overlap =
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
          if (overlap) out.push(`${name(one.el)} overlaps ${name(other.el)}`);
        }
      });
    }
    // Every column's controls stay inside it (a row of tabs and buttons must fit its width); the centre's
    // too, with the open playlist above the slides (Session 26a).
    for (const id of ['column-left', 'column-middle', 'column-right']) {
      const column = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
      if (!column) continue;
      for (const el of document.querySelectorAll(
        `[data-testid="${id}"] button, [data-testid="${id}"] [role="tab"]`,
      )) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.left < column.left - 0.5 || r.right > column.right + 0.5))
          out.push(`${name(el)} sticks out of ${id}`);
      }
    }
    // The middle has room for its rows (Session 55: the slides are rows there).
    const grid = document.querySelector('[data-testid="column-middle"]')?.getBoundingClientRect();
    if (!grid || grid.width < 380) out.push(`the slides have too little room (${grid?.width ?? 0} px)`);
    return out;
  });
  expect(problems, what).toEqual([]);
}

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`at ${width} x ${height} nothing is cut off or overlapping`, async () => {
    const { app } = await launchApp();
    const win = await operatorPage(app);
    await win.setViewportSize({ width, height });
    await setUpPlaceholderShow(win);
    await showRunning(win);
    // A message on the screens and a sound would light more of the bar; the slide is enough here.
    await expectLaidOut(win, `the operator window at ${width} x ${height}`);
    // The slides as rows, one a line, each group's name where it starts (Session 55).
    await importGroupsKirtan(win);
    await openGroupsKirtan(win);
    await expectSlideRows(win, `the slides at ${width} x ${height}`);
    await expectLaidOut(win, `the groups kirtan at ${width} x ${height}`);
    // With a dialog open too.
    await win.getByRole('button', { name: 'Screens', exact: true }).click();
    const sheet = win.getByRole('dialog', { name: 'Screens' });
    await expect(sheet).toBeVisible();
    // Where it settles, once it has slid in (Session 26g).
    await settled(win);
    const box = await sheet.boundingBox();
    expect(
      box &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= width + 0.5 &&
        box.y + box.height <= height + 0.5,
    ).toBe(true);
    await app.close();
  });
}

test('the columns change from the keyboard, and are kept after a restart; the slides are rows, one a line', async () => {
  const first = await launchApp();
  const win = await operatorPage(first.app);
  await win.setViewportSize({ width: 1600, height: 900 });
  await importGroupsKirtan(win);
  await openGroupsKirtan(win);
  // Session 55 (Part 4): the slides are rows, a slide each (the thumbnail size went with the slide grid).
  await expectSlideRows(win, 'the slides');
  await expect(win.getByRole('slider', { name: 'Thumbnail size' })).toHaveCount(0);
  const library = win.getByRole('separator', { name: 'Resize the playlists' });
  const live = win.getByRole('separator', { name: 'Resize the live column' });
  await library.focus();
  // The focus ring shows where the keyboard is.
  await expect(library).toBeFocused();
  await win.keyboard.press('Shift+ArrowRight');
  await expect(library).toHaveAttribute('aria-valuenow', '364');
  await live.focus();
  await win.keyboard.press('ArrowLeft');
  await expect(live).toHaveAttribute('aria-valuenow', '396');
  const leftWidth = await win.getByTestId('column-left').evaluate((el) => el.getBoundingClientRect().width);
  expect(leftWidth).toBe(364);
  // A button shows a visible focus ring.
  await win.getByRole('button', { name: 'Screens', exact: true }).focus();
  await win.keyboard.press('Shift+Tab');
  await win.keyboard.press('Tab');
  const ring = await win.evaluate(() => {
    const el = document.activeElement;
    return el ? getComputedStyle(el).outlineStyle : 'none';
  });
  expect(ring).not.toBe('none');
  await first.app.close();

  const second = await relaunchApp(first.userData);
  const win2 = await operatorPage(second.app);
  await win2.setViewportSize({ width: 1600, height: 900 });
  await openGroupsKirtan(win2);
  await expectSlideRows(win2, 'the slides after a restart');
  await expect(win2.getByRole('separator', { name: 'Resize the playlists' })).toHaveAttribute(
    'aria-valuenow',
    '364',
  );
  await expect(win2.getByRole('separator', { name: 'Resize the live column' })).toHaveAttribute(
    'aria-valuenow',
    '396',
  );
  expect(
    await win2.evaluate(async () => (await (globalThis as PageGlobals).drashti.app.getInfo()).name),
  ).toBe('Drashti');
  await second.app.close();
});
