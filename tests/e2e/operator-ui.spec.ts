import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { dropFiles, importAndGetIds, launchApp, operatorPage, relaunchApp } from './helpers';
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

/** Show the groups kirtan's slides. */
async function openGroupsKirtan(win: Page): Promise<void> {
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: new RegExp(GROUPS_KIRTAN) })
    .click();
  await expect(win.getByTestId('slide-thumb')).toHaveCount(10);
}

/** How many thumbnails each row of the slide grid holds, top to bottom. */
async function gridRows(win: Page): Promise<number[]> {
  return win.getByTestId('slide-thumb').evaluateAll((els) => {
    const rows = new Map<number, number>();
    for (const el of els) {
      const top = Math.round(el.getBoundingClientRect().top);
      rows.set(top, (rows.get(top) ?? 0) + 1);
    }
    return [...rows.values()];
  });
}

/**
 * The slides flow on from one group to the next in one grid: every row but
 * the last is full, however few slides a group has, and each group's name
 * and colour mark where it starts.
 */
async function expectContinuousGrid(win: Page, atLeast: number, what: string): Promise<number> {
  await expect(win.getByTestId('slide-list')).toHaveCount(1);
  const rows = await gridRows(win);
  const perRow = rows[0] ?? 0;
  expect(perRow, `${what}: slides in a row`).toBeGreaterThanOrEqual(atLeast);
  expect(
    rows.slice(0, -1).every((n) => n === perRow),
    `${what}: rows ${rows.join(', ')}`,
  ).toBe(true);
  expect(rows.length, `${what}: rows ${rows.join(', ')}`).toBe(Math.ceil(10 / perRow));
  const markers = win.getByTestId('slide-thumb').filter({ has: win.getByTestId('slide-group') });
  expect(await markers.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-index'))))).toEqual([
    0, 1, 3, 6,
  ]);
  expect(
    await win.getByTestId('slide-group').evaluateAll((els) => els.map((e) => e.getAttribute('data-group'))),
  ).toEqual(GROUPS.map(([name]) => name));
  // Each slide's colour strip is its group's colour (verse blue, chorus red, bridge purple).
  const strips = await win
    .getByTestId('group-color')
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  const verse = 'rgb(62, 99, 221)';
  const chorus = 'rgb(229, 72, 77)';
  const bridge = 'rgb(142, 78, 198)';
  expect(strips).toEqual([verse, chorus, chorus, verse, verse, verse, bridge, bridge, bridge, bridge]);
  return perRow;
}

/** Open the placeholder playlist and put the kirtan's second slide live. */
async function showRunning(win: Page) {
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await win.getByTestId('playlist-item').filter({ hasText: KIRTAN }).click();
  await win.getByTestId('slide-thumb').nth(1).click();
  await expect(win.getByTestId('live-text')).toContainText(`${KIRTAN} · slide 2 of 5`);
}

test('the operator window and every panel pass the accessibility checks', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await setUpPlaceholderShow(win);
  // An import from the window: its report opens by itself while nothing is live.
  const dir = mkdtempSync(join(tmpdir(), 'drashti-ui-'));
  writeFileSync(join(dir, 'Placeholder Dropped Song.txt'), 'Placeholder dropped line\n');
  await dropFiles(win, win.getByTestId('library-drop'), [join(dir, 'Placeholder Dropped Song.txt')]);
  await expect(win.getByTestId('import-report')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the import report');
  await win.getByRole('button', { name: 'Close' }).click();
  await showRunning(win);
  await expectNoSeriousA11yIssues(win, 'the operator window');

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
      'Edit words',
      () => win.getByRole('button', { name: 'Edit words' }).click(),
      () => win.getByTestId('words-editor').getByRole('button', { name: 'Cancel' }).click(),
    ],
    [
      'the import report',
      () => win.getByTestId('import-result').getByRole('button', { name: 'Report' }).click(),
      () => win.getByRole('button', { name: 'Close' }).click(),
    ],
    [
      'Remove presentations',
      async () => {
        await win
          .getByTestId('presentation-list')
          .getByRole('button', { name: /Placeholder Welcome/ })
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
    // The slide grid has room for at least two thumbnails side by side.
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
    // At the usual thumbnail size the slides fill the width: three a row at 1280 x 720, five at 1920 x 1080.
    await importGroupsKirtan(win);
    await openGroupsKirtan(win);
    await expectContinuousGrid(win, width === 1280 ? 3 : 5, `the slides at ${width} x ${height}`);
    await expectLaidOut(win, `the groups kirtan at ${width} x ${height}`);
    // With a dialog open too.
    await win.getByRole('button', { name: 'Screens', exact: true }).click();
    const sheet = win.getByRole('dialog', { name: 'Screens' });
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

test('the columns and the thumbnail size change from the keyboard, and are kept after a restart', async () => {
  const first = await launchApp();
  const win = await operatorPage(first.app);
  await win.setViewportSize({ width: 1600, height: 900 });
  await importGroupsKirtan(win);
  await openGroupsKirtan(win);
  const usual = await expectContinuousGrid(win, 3, 'the usual size');
  const size = win.getByRole('slider', { name: 'Thumbnail size' });
  await expect(size).toHaveValue('170');
  await size.focus();
  await win.keyboard.press('End');
  await expect(size).toHaveValue('400');
  // Bigger thumbnails, fewer in a row, still flowing on from group to group.
  const big = await expectContinuousGrid(win, 1, 'the biggest size');
  expect(big).toBeLessThan(usual);
  const thumbWidth = () =>
    win
      .getByTestId('slide-thumb')
      .first()
      .evaluate((el) => el.getBoundingClientRect().width);
  expect(await thumbWidth()).toBeGreaterThanOrEqual(400);
  await win.keyboard.press('Home');
  await expect(size).toHaveValue('120');
  expect(await expectContinuousGrid(win, usual + 1, 'the smallest size')).toBeGreaterThan(usual);
  for (let i = 0; i < 10; i++) await win.keyboard.press('ArrowRight');
  await expect(size).toHaveValue('220');
  const library = win.getByRole('separator', { name: 'Resize the library and playlists' });
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
  await expect(win2.getByRole('slider', { name: 'Thumbnail size' })).toHaveValue('220');
  const kept = await win2
    .getByTestId('slide-thumb')
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(kept).toBeGreaterThanOrEqual(220);
  await expect(win2.getByRole('separator', { name: 'Resize the library and playlists' })).toHaveAttribute(
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
