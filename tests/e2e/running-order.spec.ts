import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady } from './helpers';
import { makeTestVideo } from './test-media';

/*
 * A playlist's running order (alpha.22, from PLAN §7's "Print": seen, not added; the owner's "Yes, build them"), in
 * the open playlist's ⋯ Playlist actions (Pro Mode's): Copy running order puts plain lines on the clipboard, written by
 * the main process; Print running order… and Save running order as PDF… print it from a hidden window as the manual
 * is, never while the show is live. Placeholder names and generated media only.
 */

/** 'Placeholder sabha <test>': a header, the library's first presentation and a 10-second video, opened. */
async function placeholderSabha(win: Page, dir: string): Promise<{ id: string; labels: string[] }> {
  const video = await makeTestVideo(win, join(dir, 'Placeholder video.webm'), { seconds: 10 });
  const [mediaId] = await importAndGetIds(win, [video]);
  const made = await win.evaluate(async (media) => {
    const d = (globalThis as PageGlobals).drashti;
    const first = (await d.library.listPresentations())[0];
    if (!first) throw new Error('No presentation to add');
    const list = await d.playlists.create('Placeholder sabha <test>', null, false);
    if (!list.ok) throw new Error(list.message);
    const id = list.ids[0] ?? '';
    const added = await d.playlists.addItems(id, null, [
      { kind: 'header', label: 'Placeholder Dhun' },
      { kind: 'presentation', presentationId: first.id },
      { kind: 'media', mediaId: media },
    ]);
    if (!added.ok) throw new Error(added.message);
    return { id, labels: (await d.playlists.items(id)).map((i) => i.label) };
  }, mediaId ?? '');
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder sabha' }).click();
  // The video's length is known (the running order says it).
  await expect(win.getByTestId('open-playlist').getByTestId('playlist-totals')).toHaveText(
    '3 rows · videos and sounds 0:10',
  );
  return made;
}

const clipboardText = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText());

/** A PDF's pages, counted as manual.spec.ts counts them (its page objects, and its tree's count). */
function pdfPages(file: string): number {
  const text = readFileSync(file).toString('latin1');
  const pages = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/gu) ?? []).length;
  const counts = [...text.matchAll(/\/Count\s+(\d+)/gu)].map((m) => Number(m[1]));
  return Math.max(pages, ...counts);
}

/** The open playlist's ⋯, then one of its entries. */
async function playlistAction(win: Page, name: string): Promise<void> {
  await win.getByRole('button', { name: 'Playlist actions' }).click();
  await win.getByRole('menuitem', { name, exact: true }).click();
}

interface Printed {
  title: string;
  sections: number;
  rows: number;
}

test('Copy running order puts the open playlist’s plain lines on the clipboard; Simple Mode copies, prints and saves nothing', async () => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-running-order-'));
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const { id, labels } = await placeholderSabha(win, dir);
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText('Placeholder clipboard');
    });
    await win.getByRole('button', { name: 'Playlist actions' }).click();
    await win.getByRole('menuitem', { name: 'Copy running order', exact: true }).click();
    await expect(win.getByTestId('operator-notice')).toContainText(
      'Copied the running order (2 rows): paste it where you need it.',
    );
    expect((await clipboardText(app)).split('\n')).toEqual([
      'Placeholder sabha <test>',
      '— Placeholder Dhun —',
      `1. ${labels[1] ?? ''}`,
      `2. ${labels[2] ?? ''}, 0:10`,
      'Videos and sounds in all: 0:10',
    ]);

    // Simple Mode: no ⋯ of the playlist's own, and the main process copies nothing when asked.
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText('Placeholder clipboard');
    });
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    await expect(win.getByRole('button', { name: 'Playlist actions' })).toHaveCount(0);
    const refused = await win.evaluate(
      (playlistId) => (globalThis as PageGlobals).drashti.playlists.copyRunningOrder(playlistId),
      id,
    );
    expect(refused).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(await clipboardText(app)).toBe('Placeholder clipboard');
    // Nor printed, nor saved as a PDF.
    const printing = await win.evaluate(async (playlistId) => {
      const d = (globalThis as PageGlobals).drashti;
      return [await d.playlists.printRunningOrder(playlistId), await d.playlists.saveRunningOrderPdf(playlistId)];
    }, id);
    expect(printing).toEqual([
      { ok: false, cancelled: false, message: SIMPLE_MODE_REFUSAL },
      { ok: false, cancelled: false, message: SIMPLE_MODE_REFUSAL },
    ]);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Save running order as PDF… writes the open playlist’s running order where you choose, and Print running order… prints the same page; with a slide up, or on air, each is refused in words', async () => {
  test.setTimeout(150_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-running-order-'));
  const pdf = join(dir, 'Placeholder order.pdf');
  // A test can say the stream is on air (DRASHTI_TEST_ON_AIR_HOOK), as manual.spec.ts does.
  const { app } = await launchApp({ DRASHTI_TEST_ON_AIR_HOOK: '1' });
  try {
    // The system's save dialog answers with the file above (and says where it offered first); the system's print
    // dialog is never shown: what Print… sends is written down instead, from the page it prints.
    await app.evaluate(({ app: electronApp, dialog }, path) => {
      const g = globalThis as { drashtiOffered?: string[]; drashtiPrinted?: Printed[] };
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
            .executeJavaScript(
              '[document.title, document.querySelectorAll("h2").length, document.querySelectorAll("tr").length]',
            )
            .then(([title, sections, rows]: [string, number, number]) => {
              g.drashtiPrinted?.push({ title, sections, rows });
              callback?.(true, '');
            });
        };
      });
    }, pdf);
    const offered = () => app.evaluate(() => (globalThis as { drashtiOffered?: string[] }).drashtiOffered ?? []);
    const printed = () => app.evaluate(() => (globalThis as { drashtiPrinted?: Printed[] }).drashtiPrinted ?? []);
    const win = await operatorPage(app);
    await operatorReady(win);
    await placeholderSabha(win, dir);
    const notice = win.getByTestId('operator-notice');
    const refused =
      'Print or save the running order when nothing is up, on air or recording: clear what is up, and end the stream and the recording first.';

    // Something up: refused in words, nothing asked and nothing printed.
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const first = (await d.library.listPresentations())[0];
      if (!first) throw new Error('No presentation to put up');
      await d.engine.dispatch({ type: 'goLive', presentationId: first.id, slideIndex: 0 });
    });
    await expect(win.getByTestId('live-text')).toContainText('Live:');
    await playlistAction(win, 'Save running order as PDF…');
    await expect(notice).toHaveText(refused);
    await playlistAction(win, 'Print running order…');
    await expect(notice).toHaveText(refused);
    expect(await offered()).toEqual([]);
    expect(await printed()).toEqual([]);

    // Nothing up (Clear all): saved where chosen, suggesting the playlist's own name.
    await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearAll' }));
    await playlistAction(win, 'Save running order as PDF…');
    await expect(notice).toContainText('Saved the running order as a PDF: Placeholder order.pdf', {
      timeout: 60_000,
    });
    const asked = await offered();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/Placeholder sabha _test_ running order\.pdf$/u);
    expect(existsSync(pdf)).toBe(true);
    expect(readFileSync(pdf).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdfPages(pdf)).toBeGreaterThanOrEqual(1);

    // Print…: the same page, its title the playlist's, its one header a section with its two rows.
    await playlistAction(win, 'Print running order…');
    await expect.poll(printed, { timeout: 60_000 }).toEqual([
      { title: 'Placeholder sabha <test> running order', sections: 1, rows: 2 },
    ]);
    await expect(notice).toHaveText('The running order went to the printer.');

    // On air (as the main process sees it): refused in words, nothing asked.
    await app.evaluate(() => {
      (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(true);
    });
    await playlistAction(win, 'Save running order as PDF…');
    await expect(notice).toHaveText(refused);
    expect(await offered()).toHaveLength(1);
    await app.evaluate(() => {
      (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(false);
    });
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
