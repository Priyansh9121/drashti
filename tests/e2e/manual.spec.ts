import type { ElectronApplication } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';

/*
 * The Drashti Manual (x37, Session 60; the owner's "A, new Manual", 19 Nov 2026): Help › Drashti Manual…, the first
 * item under Help in both modes, opens the manual in the operator window as Guides… opens the guides: a chapter for
 * each part of the window, read from the files beside the app and never from the internet, searchable, with its
 * pictures, and printed or saved as a PDF from a hidden window of its own. Nothing in it touches the show.
 */

/** The manual's chapters, in its order, as its list names them. */
const CHAPTERS = [
  'Start here',
  'Library',
  'Playlists and wallpapers',
  'LIVE, Back and Next',
  'Audio and the levels',
  'Stage screen',
  'Messages and timers',
  'Tools',
  'Screens and screen geometry',
  'Stream',
  'Phones and network',
  'Settings and appearance',
  'Simple Mode',
  'Keys',
  'Editing slides',
  'Bringing things in and sharing',
  'Help and when something goes wrong',
];

/** The Help menu's items, in order, by their ids (null for a line between them). */
const helpItems = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => {
    const help = Menu.getApplicationMenu()?.items.find((i) => i.role === 'help');
    return (help?.submenu?.items ?? []).map((i) => (i.type === 'separator' ? null : i.id));
  });

const menuLabel = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.label ?? null, id);

/** A PDF's pages, counted as the setup kit's printout counts them (its page objects, and its tree's count). */
function pdfPages(file: string): number {
  const text = readFileSync(file).toString('latin1');
  const pages = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/gu) ?? []).length;
  const counts = [...text.matchAll(/\/Count\s+(\d+)/gu)].map((m) => Number(m[1]));
  return Math.max(pages, ...counts);
}

test('Help › Drashti Manual…: first under Help, every chapter offline, a picture from beside the app, and search finds Black-out in LIVE, Back and Next', async () => {
  test.setTimeout(90_000);
  const { app, access } = await launchApp();
  // Every request off this computer is stopped and written down: none may be made. Drashti's own checks of its
  // access (Session 54) go to the stand-in list on this computer: they are let through.
  await app.evaluate(({ session }, list) => {
    const g = globalThis as { drashtiRequestsOut?: string[] };
    g.drashtiRequestsOut = [];
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, callback) => {
        if (new URL(details.url).origin === list) {
          callback({});
          return;
        }
        g.drashtiRequestsOut?.push(details.url);
        callback({ cancel: true });
      },
    );
  }, new URL(access.url).origin);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  // The first item under Help, before Guides….
  const items = await helpItems(app);
  expect(items[0]).toBe('manual');
  expect(items.indexOf('guides')).toBeGreaterThan(0);
  expect(await menuLabel(app, 'manual')).toBe('Drashti Manual…');

  await chooseMenuItem(app, 'manual');
  const manual = win.getByTestId('manual');
  await expect(manual).toBeVisible();
  // It opens at its start, with the keyboard in its search box.
  await expect(manual.getByRole('heading', { level: 1 })).toHaveText('Start here');
  await expect(manual.getByRole('searchbox', { name: 'Search the manual' })).toBeFocused();
  // Every chapter, in its order.
  const chapters = manual.getByRole('navigation', { name: 'Chapters' }).getByRole('button');
  await expect(chapters).toHaveText(CHAPTERS);
  await expectNoSeriousA11yIssues(win, 'the manual at 1280 × 720');
  // A picture, shown from the files beside the app.
  const picture = manual.getByRole('region', { name: 'Start here' }).locator('img').first();
  await picture.scrollIntoViewIfNeeded();
  await expect
    .poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  expect(await picture.getAttribute('src')).toMatch(/^drashti-media:\/\/guide\/[a-z0-9-]+\.png$/u);

  // A chapter from the list opens at its start, and the list says which is open.
  await chapters.filter({ hasText: /^Stage screen$/u }).click();
  await expect(manual.getByRole('heading', { level: 1 })).toHaveText('Stage screen');
  await expect(chapters.filter({ hasText: /^Stage screen$/u })).toHaveAttribute('aria-current', 'true');

  // Search: "black" finds the Black-out passage of LIVE, Back and Next, under its chapter.
  const search = manual.getByRole('searchbox', { name: 'Search the manual' });
  await search.fill('black');
  const results = manual.getByTestId('manual-results');
  const hit = results
    .getByTestId('manual-hit')
    .filter({ hasText: 'LIVE, Back and Next' })
    .filter({ hasText: 'Black-out' })
    .first();
  await expect(hit).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'what the manual’s search found');
  // With the keyboard: on the result, Enter opens its chapter there, marked.
  await hit.focus();
  await win.keyboard.press('Enter');
  await expect(manual.getByRole('heading', { level: 1 })).toHaveText('LIVE, Back and Next');
  const shown = manual.locator('[data-passage][data-current="true"]');
  await expect(shown).toContainText('Black-out');
  await expect(shown).toBeInViewport();
  // Still in view once the pictures above it have loaded.
  await expect
    .poll(() =>
      manual.locator('img').evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete)),
    )
    .toBe(true);
  await expect(shown).toBeInViewport();

  // Words no chapter holds say so.
  await search.fill('zzzqqq');
  await expect(results).toContainText('Nothing in the manual holds every word of “zzzqqq”');

  // Esc closes it; nothing went out.
  await win.keyboard.press('Escape');
  await expect(manual).toBeHidden();
  expect(
    await app.evaluate(() => (globalThis as { drashtiRequestsOut?: string[] }).drashtiRequestsOut ?? []),
  ).toEqual([]);
  await app.close();
});

test('Print… and Save as PDF… wait while anything is up, saying so; with nothing up, Save as PDF… writes the whole manual where you choose, a chapter from a new page, and Print… prints the same pages; on air, a request is refused in words', async () => {
  test.setTimeout(120_000);
  const folder = mkdtempSync(join(tmpdir(), 'drashti-manual-'));
  const pdf = join(folder, 'Placeholder manual.pdf');
  // A test can say the stream is on air (DRASHTI_TEST_ON_AIR_HOOK), as the conversions' tests do.
  const { app } = await launchApp({ DRASHTI_TEST_ON_AIR_HOOK: '1' });
  // The system's save dialog answers with the file above (and says where it offered first); the system's print
  // dialog is never shown: what Print… sends is written down instead, from the page it prints.
  await app.evaluate(({ app: electronApp, dialog }, path) => {
    const g = globalThis as {
      drashtiOffered?: string[];
      drashtiPrinted?: { title: string; chapters: number }[];
    };
    g.drashtiOffered = [];
    g.drashtiPrinted = [];
    dialog.showSaveDialog = (...args: unknown[]) => {
      const options = args.find(
        (a): a is { defaultPath?: string } => typeof a === 'object' && a !== null && 'defaultPath' in a,
      );
      g.drashtiOffered?.push(options?.defaultPath ?? '');
      return Promise.resolve({ canceled: false, filePath: path });
    };
    electronApp.on('browser-window-created', (_event, w) => {
      w.webContents.print = (_options: unknown, callback?: (success: boolean, why: string) => void) => {
        void w.webContents
          .executeJavaScript('[document.title, document.querySelectorAll("h1").length]')
          .then(([title, chapters]: [string, number]) => {
            g.drashtiPrinted?.push({ title, chapters });
            callback?.(true, '');
          });
      };
    });
  }, pdf);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  // Something up: Print… and Save as PDF… wait, with one plain line beside them (the lead's call, 20 Nov 2026, under
  // the owner's word that nothing in the manual's window may touch the show), until nothing is up, on air or recording.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const first = (await d.library.listPresentations())[0];
    if (!first) throw new Error('No presentation to put up');
    await d.engine.dispatch({ type: 'goLive', presentationId: first.id, slideIndex: 0 });
  });
  await expect(win.getByTestId('live-text')).toContainText('Live:');
  await chooseMenuItem(app, 'manual');
  const manual = win.getByTestId('manual');
  await expect(manual).toBeVisible();
  const print = manual.getByRole('button', { name: 'Print…' });
  const save = manual.getByRole('button', { name: 'Save as PDF…' });
  const waits = manual.getByTestId('manual-waits');
  await expect(waits).toHaveText('Print or save the manual when nothing is up, on air or recording.');
  await expect(print).toBeDisabled();
  await expect(save).toBeDisabled();
  await expectNoSeriousA11yIssues(win, 'the manual while something is up');
  // Nothing up (Clear all): both as before.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearAll' }));
  await expect(waits).toHaveCount(0);
  await expect(print).toBeEnabled();
  await expect(save).toBeEnabled();

  await save.click();
  await expect(manual.getByRole('status')).toContainText('Saved the manual as a PDF', { timeout: 60_000 });
  const offered = await app.evaluate(
    () => (globalThis as { drashtiOffered?: string[] }).drashtiOffered ?? [],
  );
  expect(offered).toHaveLength(1);
  expect(offered[0]).toMatch(/Drashti Manual\.pdf$/u);
  expect(existsSync(pdf)).toBe(true);
  expect(readFileSync(pdf).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  // Every chapter starts a new page: at least one page each.
  expect(pdfPages(pdf)).toBeGreaterThanOrEqual(CHAPTERS.length);
  expect(statSync(pdf).size).toBeGreaterThan(10_000);

  await manual.getByRole('button', { name: 'Print…' }).click();
  await expect
    .poll(
      () =>
        app.evaluate(
          () =>
            (globalThis as { drashtiPrinted?: { title: string; chapters: number }[] }).drashtiPrinted ?? [],
        ),
      { timeout: 60_000 },
    )
    .toEqual([{ title: 'Drashti Manual', chapters: CHAPTERS.length }]);
  // Neither touched the show: the manual is still open where it was.
  await expect(manual.getByRole('heading', { level: 1 })).toHaveText('Start here');
  // On air (as the main process sees it): a request is refused in words, nothing asked and nothing made.
  await app.evaluate(() => {
    (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(true);
  });
  await save.click();
  await expect(manual.getByRole('status')).toHaveText(
    'Print or save the manual when nothing is up, on air or recording: clear what is up, and end the stream and the recording first.',
  );
  expect(
    await app.evaluate(() => (globalThis as { drashtiOffered?: string[] }).drashtiOffered ?? []),
  ).toHaveLength(1);
  await app.evaluate(() => {
    (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(false);
  });
  await win.keyboard.press('Escape');
  await expect(manual).toBeHidden();
  await app.close();
  rmSync(folder, { recursive: true, force: true });
});

test('Simple Mode’s Help › Drashti Manual… opens at the Simple Mode chapter, with every chapter there', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const items = await helpItems(app);
  expect(items[0]).toBe('manual');
  await chooseMenuItem(app, 'manual');
  const manual = win.getByTestId('manual');
  await expect(manual).toBeVisible();
  await expect(manual.getByRole('heading', { level: 1 })).toHaveText('Simple Mode');
  await expect(manual.getByRole('navigation', { name: 'Chapters' }).getByRole('button')).toHaveText(CHAPTERS);
  await win.keyboard.press('Escape');
  await expect(manual).toBeHidden();
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
  await app.close();
});
