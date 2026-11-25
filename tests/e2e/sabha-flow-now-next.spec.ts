import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flowScanPage, flowTablePage, makeFlowPdf } from '../../src/main/documents/testing/sabha-flow-pdfs';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import { OWNERS_WINDOW, sizeWindow, smallestContent, sweep } from './fit-sweep';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Now and Next up in the operator window's Sabha flow panel (alpha.23, QA23-FLOW-2; the owner: "if we are on 1, it
 * should say next up this program, video which is also seen on phone paired"). The operator marks where the sabha is,
 * with a row's click or Back and Next; the panel says "Now: 1 · Program · Details" and, larger, "Next up: 2 · Program ·
 * Details · Duration · Presenter" (a Video row marked as the video), "Last item" at the end, the PDF's own language on
 * its words; nothing of it for a PDF Drashti could not read. Two quick presses of Next are two steps (a22-review-flow
 * M3: each press steps from the Now last asked, not the one Main has answered). From the keyboard Back and Next keep
 * their Tab stop when they cannot move, so the focus stays in the panel; a screen reader hears each change once. It
 * fits at the window's least, CI's 1024 × 645 and the owner's 1410 × 900, with the playlists' column at its least and
 * its most. Simple Mode, when Sabha flow is chosen there, marks Now as Pro Mode does. A paired phone shows the same Now
 * and Next up as the panel, as each mark is made there, read only, said to a screen reader once (More's not while the
 * Sabha flow sheet is over it).
 *
 * Placeholder PDFs only, made here by a22-flow-core's maker (pdf-lib, the bundled Noto fonts with ToUnicode maps, a
 * table's borders as lines): never a real running order.
 */

const ROWS = [
  '1 · Opening · Placeholder words one · 10 min · Speaker A',
  '2 · Video · Placeholder clip · 15 min · Speaker B',
  '3 · Talk · Placeholder words three · 15 min · Speaker B',
  '4 · Closing · Placeholder words four · 5 min · Speaker C',
];

const WIDTHS = [44, 140, 190, 70, 106];

/** Choose PDF… (or Replace…) answered with this file: Main's file dialog, stood in for by the test. */
async function chooseThis(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, file);
}

/** What a person reads in an element: its words without those only a screen reader hears (.sr-only). */
const seen = (el: Locator) =>
  el.evaluate((node) => {
    const copy = node.cloneNode(true) as HTMLElement;
    for (const hidden of copy.querySelectorAll('.sr-only')) hidden.remove();
    return copy.textContent.replace(/\s+/gu, ' ').trim();
  });

/** Now, as Main keeps it. */
const flowNow = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.flow.get()).state);

/**
 * Four placeholder running orders: an English table whose rows 2 and 3 share one Duration and one Presenter cell, a
 * Video in row 2; a Gujarati one; a scan (a picture, no text); and one whose words are as long as a running order's
 * get, for the fit.
 */
async function makePdfs(): Promise<{ table: string; gujarati: string; scan: string; long: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-flow-now-next-'));
  const file = (name: string) => join(dir, name);
  writeFileSync(
    file('placeholder-flow.pdf'),
    await makeFlowPdf([
      flowTablePage({
        title: 'Placeholder evening',
        headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
        widths: WIDTHS,
        rows: [
          ['1', 'Opening', 'Placeholder words one', '10 min', 'Speaker A'],
          ['2', 'Video', 'Placeholder clip', { text: '15 min', rows: 2 }, { text: 'Speaker B', rows: 2 }],
          ['3', 'Talk', 'Placeholder words three', null, null],
          ['4', 'Closing', 'Placeholder words four', '5 min', 'Speaker C'],
        ],
        total: 'Total 45 min',
        borders: 'lines',
      }),
    ]),
  );
  writeFileSync(
    file('placeholder-gujarati.pdf'),
    await makeFlowPdf([
      flowTablePage({
        title: 'નમૂનો કાર્યક્રમ',
        headers: ['ક્રમ', 'કાર્યક્રમ', 'વિગત', 'સમય', 'વક્તા'],
        widths: WIDTHS,
        rows: [
          ['૧', 'પહેલો કાર્યક્રમ', 'નમૂનો વિગત', '૫ મિનિટ', 'વક્તા એક'],
          ['૨', 'બીજો કાર્યક્રમ', 'નમૂનો', '૫ મિનિટ', 'વક્તા બે'],
        ],
        borders: 'boxes',
      }),
    ]),
  );
  writeFileSync(file('placeholder-scan.pdf'), await makeFlowPdf([flowScanPage()]));
  writeFileSync(
    file('placeholder-long-flow.pdf'),
    await makeFlowPdf([
      flowTablePage({
        headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
        widths: [40, 150, 180, 70, 115],
        rows: [
          ['1', 'Placeholder opening', 'Placeholder words', '5 min', 'Placeholder A'],
          [
            '2',
            'Video: placeholder\nclip with a long name',
            'Placeholder details of the clip\nwritten over three lines\nas a long cell has them',
            '25 minutes',
            'Placeholder\npresenter with a\nlong name',
          ],
          ['3', 'Placeholder closing', 'Placeholder words', '5 min', 'Placeholder B'],
        ],
        borders: 'lines',
      }),
    ]),
  );
  return {
    table: file('placeholder-flow.pdf'),
    gujarati: file('placeholder-gujarati.pdf'),
    scan: file('placeholder-scan.pdf'),
    long: file('placeholder-long-flow.pdf'),
  };
}

/** The panel open, this PDF chosen and read. */
async function openWith(app: ElectronApplication, win: Page, file: string, rows: number): Promise<Locator> {
  const toggle = win.getByTestId('column-left').getByRole('button', { name: 'Sabha flow', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const panel = win.getByTestId('sabha-flow');
  await chooseThis(app, file);
  const replace = panel.getByTestId('flow-replace');
  await ((await replace.count()) > 0 ? replace : panel.getByRole('button', { name: 'Choose PDF…' })).click();
  await expect(panel.getByTestId('flow-row')).toHaveCount(rows, { timeout: 30_000 });
  return panel;
}

test('Now and Next up in the Sabha flow panel: Next and Back, a row, two quick presses stepping twice, Last item, the video, the keyboard keeping its place, said to a screen reader, the PDF’s language, none for a scan, and Simple Mode', async () => {
  test.setTimeout(180_000);
  const { table, gujarati, scan } = await makePdfs();
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const panel = await openWith(app, win, table, 4);
  const rows = panel.getByTestId('flow-row');
  const nowLine = panel.getByTestId('flow-now');
  const nextLine = panel.getByTestId('flow-next');
  const back = panel.getByRole('button', { name: 'Sabha flow: Back', exact: true });
  const next = panel.getByRole('button', { name: 'Sabha flow: Next', exact: true });
  // Names of their own: never taken for the show's Next or Next item (a name that begins with Next).
  await expect(win.getByRole('button', { name: 'Sabha flow: Next', exact: true })).toHaveCount(1);
  await expect(panel.getByRole('button', { name: /^(Next|Back)/u })).toHaveCount(0);
  const flowId = (await flowNow(win))?.flowId ?? '';
  expect(flowId).not.toBe('');
  /** Now as the panel says it, the row marked, and as Main keeps it, all agreeing. */
  const nowIs = async (now: number | null) => {
    await expect.poll(() => flowNow(win)).toEqual({ flowId, now });
    await expect(panel.locator('[aria-current="step"]')).toHaveCount(now === null ? 0 : 1);
    if (now !== null) await expect(rows.nth(now)).toHaveAttribute('aria-current', 'step');
  };

  // Nothing is Now yet: Next up is the first item, in full; Back cannot move.
  expect(await seen(nowLine)).toBe('Now: not started');
  expect(await seen(nextLine)).toBe(`Next up: ${ROWS[0] ?? ''}`);
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await expect(next).not.toHaveAttribute('aria-disabled', 'true');

  // Next: on 1, "Now: 1 · Program · Details", and Next up the next item in full; a Video row shows as the video.
  await next.click();
  await nowIs(0);
  await expect.poll(() => seen(nowLine)).toBe('Now: 1 · Opening · Placeholder words one');
  expect(await seen(nextLine)).toBe(`Next up: ${ROWS[1] ?? ''}`);
  await expect(nextLine).toHaveAttribute('data-video', 'true');
  await expect(nextLine.locator('svg')).toHaveCount(1);
  await expect(back).not.toHaveAttribute('aria-disabled', 'true');

  // Two quick presses (a double click: the second before Main has answered the first) are two steps (M3).
  await next.dblclick();
  await nowIs(2);
  await expect.poll(() => seen(nextLine)).toBe(`Next up: ${ROWS[3] ?? ''}`);
  await expect(nextLine).not.toHaveAttribute('data-video', 'true');

  // Back and Next never move from under the pointer as Now moves: the read list keeps Now in sight by its own box,
  // never by scrolling the panel.
  const nextAt = await next.boundingBox();
  await next.click();
  await nowIs(3);
  await back.click();
  await nowIs(2);
  expect(await next.boundingBox()).toEqual(nextAt);

  // A row's click marks it, and Back steps from it.
  await rows.nth(1).click();
  await nowIs(1);
  await back.click();
  await nowIs(0);

  // From the keyboard: Enter on Next, twice at once, then once more: the last item, "Last item". Next cannot move on,
  // and the focus stays on it (a pressed Next that went off would drop it out of the panel); Enter again moves nothing.
  await next.focus();
  await win.keyboard.press('Enter');
  await win.keyboard.press('Enter');
  await nowIs(2);
  await win.keyboard.press('Enter');
  await nowIs(3);
  await expect.poll(() => seen(nextLine)).toBe('Last item');
  expect(await seen(nowLine)).toBe('Now: 4 · Closing · Placeholder words four');
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await expect(next).toBeFocused();
  await win.keyboard.press('Enter');
  await nowIs(3);
  await expect(next).toBeFocused();
  // Back from the keyboard, all the way: one Tab stop back, Enter four times at once, to not started.
  await win.keyboard.press('Shift+Tab');
  await expect(back).toBeFocused();
  for (let i = 0; i < 4; i++) await win.keyboard.press('Enter');
  await nowIs(null);
  await expect.poll(() => seen(nowLine)).toBe('Now: not started');
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await expect(back).toBeFocused();

  // A screen reader hears a change once, Now and Next up together, and each row by its words.
  const live = panel.getByTestId('flow-now-next').locator('[aria-live]');
  await expect(live).toHaveCount(1);
  await expect(live).toHaveAttribute('aria-live', 'polite');
  await expect(live).toHaveAttribute('aria-atomic', 'true');
  await expect(live.getByTestId('flow-now')).toHaveCount(1);
  await expect(live.getByTestId('flow-next')).toHaveCount(1);
  await expect(live.getByRole('button')).toHaveCount(0);
  await rows.nth(1).click();
  await nowIs(1);
  await expect(live).toContainText('Now: 2');
  // Named by its own words, each part in its own language (no aria-label: it would lose them); Chromium's exact name
  // has a space round each comma a screen reader hears.
  await expect(rows.nth(1)).toHaveAccessibleName('2 , Video , Placeholder clip , 15 min , Speaker B');
  await expectNoSeriousA11yIssues(win, 'Sabha flow, Now and Next up', '[data-testid="sabha-flow"]');

  // Replace… with a Gujarati one: Now starts again, and Next up's words keep the PDF's language inside Drashti's
  // English label.
  await openWith(app, win, gujarati, 2);
  const gujaratiId = (await flowNow(win))?.flowId ?? '';
  await expect.poll(() => flowNow(win)).toEqual({ flowId: gujaratiId, now: null });
  expect(await seen(nowLine)).toBe('Now: not started');
  expect(await seen(nextLine)).toBe('Next up: ૧ · પહેલો કાર્યક્રમ · નમૂનો વિગત · ૫ મિનિટ · વક્તા એક');
  await expect(nextLine.locator('[lang="gu"]').first()).toHaveText('૧');
  await expect(panel.getByTestId('flow-now-next')).not.toHaveAttribute('lang', /.+/u);
  await next.click();
  await expect.poll(() => seen(nextLine)).toBe('Next up: ૨ · બીજો કાર્યક્રમ · નમૂનો · ૫ મિનિટ · વક્તા બે');

  // A PDF with no text: no Now and Next up at all, its page only.
  await chooseThis(app, scan);
  await panel.getByTestId('flow-replace').click();
  await expect(panel.getByTestId('flow-status')).toContainText('no words Drashti can read', {
    timeout: 30_000,
  });
  await expect(panel.getByTestId('flow-now-next')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Sabha flow: Next', exact: true })).toHaveCount(0);

  // Simple Mode, with Sabha flow chosen there: Now and Next up, Back and Next, as in Pro Mode.
  await openWith(app, win, table, 4);
  const tableId = (await flowNow(win))?.flowId ?? '';
  expect(
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setSimpleFeature('sabha-flow', true)),
  ).toEqual({ ok: true, chosen: ['sabha-flow'] });
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toHaveCount(1);
  const simple = win.getByTestId('sabha-flow');
  await expect(simple.getByTestId('flow-now-next')).toBeVisible();
  await simple.getByRole('button', { name: 'Sabha flow: Next', exact: true }).dblclick();
  await expect.poll(() => flowNow(win)).toEqual({ flowId: tableId, now: 1 });
  await expect.poll(() => seen(simple.getByTestId('flow-next'))).toBe(`Next up: ${ROWS[2] ?? ''}`);
  await simple.getByRole('button', { name: 'Sabha flow: Back', exact: true }).click();
  await expect.poll(() => flowNow(win)).toEqual({ flowId: tableId, now: 0 });
  await app.close();
});

/** The playlists' column (with the Sabha flow at its top) at its least or its most, by its splitter's keys. */
async function playlistsColumn(win: Page, key: 'Home' | 'End'): Promise<void> {
  const splitter = win.getByRole('separator', { name: 'Resize the playlists', exact: true });
  await splitter.focus();
  await splitter.press(key);
  await win.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

/**
 * Where an element (all of its words: its whole box) is out of sight: outside the window, or outside a box around it
 * that clips what overflows it ([] when all of it is in sight).
 */
const outOfSight = (loc: Locator) =>
  loc.evaluate((el) => {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return ['not drawn'];
    const out: string[] = [];
    const within = (r: { left: number; top: number; right: number; bottom: number }, what: string) => {
      if (
        box.left < r.left - 0.5 ||
        box.top < r.top - 0.5 ||
        box.right > r.right + 0.5 ||
        box.bottom > r.bottom + 0.5
      )
        out.push(
          `it (${String(Math.round(box.left))},${String(Math.round(box.top))} to ${String(Math.round(box.right))},${String(Math.round(box.bottom))}) is out of ${what} (${String(Math.round(r.left))},${String(Math.round(r.top))} to ${String(Math.round(r.right))},${String(Math.round(r.bottom))})`,
        );
    };
    within({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }, 'the window');
    for (let up = el.parentElement; up; up = up.parentElement) {
      const style = getComputedStyle(up);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      within(
        up.getBoundingClientRect(),
        `a box that clips it (${up.dataset['testid'] ?? up.tagName.toLowerCase()})`,
      );
    }
    // Its own words not cut inside it either (nothing hidden past its own edge).
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)
      out.push('its words overflow it');
    return out;
  });

test('Now and Next up fit: a Video row with long words as Next up, at the window’s least, CI’s 1024 × 645 and the owner’s 1410 × 900, with the playlists’ column at its least and its most: nothing cut, over another or out of its box, every target 24 px', async () => {
  test.setTimeout(150_000);
  const { long } = await makePdfs();
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const panel = await openWith(app, win, long, 3);
  // On 1: Next up is the long Video row, in full.
  await panel.getByTestId('flow-row').first().click();
  const nextLine = panel.getByTestId('flow-next');
  await expect(nextLine).toHaveAttribute('data-video', 'true');
  await expect
    .poll(() => seen(nextLine))
    .toBe(
      'Next up: 2 · Video: placeholder clip with a long name · Placeholder details of the clip written over three lines as a long cell has them · 25 minutes · Placeholder presenter with a long name',
    );
  // The app's fit rule (operator-fit.spec.ts): the panel at each size, with the playlists' column at its least and its
  // most, and the panel's body at its top and at its end; what the body has scrolled out of sight is its own.
  const body = panel.getByTestId('sabha-flow-body');
  const sizes = [await smallestContent(app, 'index.html'), CI_WINDOW, OWNERS_WINDOW];
  for (const size of sizes)
    for (const key of ['Home', 'End'] as const)
      for (const end of [false, true]) {
        await sizeWindow(app, win, 'index.html', size);
        await playlistsColumn(win, key);
        await body.evaluate((el, toEnd) => {
          el.scrollTop = toEnd ? el.scrollHeight : 0;
        }, end);
        const where = `${key === 'Home' ? 'the playlists’ column at its least' : 'the playlists’ column at its most'}, the panel ${end ? 'at its end' : 'at its top'}`;
        await sweep(app, win, 'index.html', panel, `Now and Next up in the Sabha flow panel, ${where}`, [
          size,
        ]);
        if (!end) {
          // At its top: Now's line and Back and Next whole in sight.
          for (const part of [
            panel.getByTestId('flow-now'),
            panel.getByRole('button', { name: 'Sabha flow: Back', exact: true }),
            panel.getByRole('button', { name: 'Sabha flow: Next', exact: true }),
          ])
            await expect(part, `${where} at ${String(size.width)} × ${String(size.height)}`).toBeInViewport({
              ratio: 1,
            });
          // And Next up, shown prominently (the owner: "next up this program"): its label and ALL its words in sight
          // beside them, whole, in the window and in every box round it that clips (a22-review-flow round 7, lead 2:
          // nothing cut short, it wraps).
          expect(
            await outOfSight(nextLine),
            `${where} at ${String(size.width)} × ${String(size.height)}`,
          ).toEqual([]);
        }
      }
  await app.close();
});

test('a paired phone shows the panel’s Now and Next up as each is marked there (a row, Next, a double click, Back), in the same words, read only, said once: More’s not while the sheet is over it', async () => {
  test.setTimeout(180_000);
  const { table } = await makePdfs();
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  const p = phone.page;
  try {
    await p.setViewportSize({ width: 390, height: 844 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await p.getByTestId('remote-tab-more').click();
    const more = p.getByTestId('remote-flow');
    const panel = await openWith(app, win, table, 4);
    const rows = panel.getByTestId('flow-row');
    const next = panel.getByRole('button', { name: 'Sabha flow: Next', exact: true });
    const flowId = (await flowNow(win))?.flowId ?? '';
    /** Main keeps this Now, the panel says it, and the phone (in `where`) says the same words. */
    const phoneSays = async (now: number | null, where: Locator) => {
      await expect.poll(() => flowNow(win)).toEqual({ flowId, now });
      await expect(panel.locator('[aria-current="step"]')).toHaveCount(now === null ? 0 : 1);
      const said = [await seen(panel.getByTestId('flow-now')), await seen(panel.getByTestId('flow-next'))];
      await expect
        .poll(async () => [
          await seen(where.getByTestId('remote-flow-now')),
          await seen(where.getByTestId('remote-flow-next')),
        ])
        .toEqual(said);
    };

    await phoneSays(null, more);
    expect(await seen(more.getByTestId('remote-flow-next'))).toBe(`Next up: ${ROWS[0] ?? ''}`);
    // A row clicked in the panel: on the phone at once, the video's row marked as the video.
    await rows.first().click();
    await phoneSays(0, more);
    await expect(more.getByTestId('remote-flow-next')).toHaveAttribute('data-video', 'true');
    // Two quick presses of Next, two steps; Back one.
    await next.dblclick();
    await phoneSays(2, more);
    await panel.getByRole('button', { name: 'Sabha flow: Back', exact: true }).click();
    await phoneSays(1, more);
    // Read only: nothing to press in it; said to a screen reader as it changes.
    const moreNowNext = more.getByTestId('remote-flow-now-next');
    await expect(moreNowNext.getByRole('button')).toHaveCount(0);
    await expect(moreNowNext.locator('[aria-live="polite"]')).toHaveCount(1);

    // The sheet over More: its Now and Next up follows and is the one said; More's is not said under it.
    await more.getByTestId('remote-open-flow').click();
    const sheet = p.getByTestId('remote-flow-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('remote-flow-now-next').locator('[aria-live="polite"]')).toHaveCount(1);
    await expect(moreNowNext.locator('[aria-live]')).toHaveCount(0);
    await next.click();
    await next.click();
    await phoneSays(3, sheet);
    await expect(sheet.getByTestId('remote-flow-next')).toHaveText('Last item');
    await expect(sheet.getByTestId('remote-flow-now-next').getByRole('button')).toHaveCount(0);
    await expectNoSeriousA11yIssues(
      p,
      'Now and Next up in the phone’s Sabha flow sheet',
      '[data-testid="remote-flow-sheet"]',
    );
    // Closed: More's is said again, as the panel has it.
    await sheet.getByTestId('remote-flow-sheet-close').click();
    await expect(sheet).toHaveCount(0);
    await expect(moreNowNext.locator('[aria-live="polite"]')).toHaveCount(1);
    await phoneSays(3, more);
  } finally {
    await phone.close();
    await app.close();
  }
});
