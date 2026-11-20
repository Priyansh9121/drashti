import type { ElectronApplication, Page } from '@playwright/test';
import type { Display } from 'electron';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, letTimePass, operatorPage, operatorReady } from './helpers';
import { makeClip, openNewPlaylist, OUT, row, SCREENS, shown, wallpaperAndPicture } from './hall-looks';
import { sampler } from './keeps-failing';

/*
 * A display that gives no name and no serial number, changing its resolution mid-show (x53; the owner's Q60-31 bug hunt,
 * x52's D2): some cheap projectors, HDMI converters and extenders give neither, and a projector or an extender
 * renegotiating changes its mode. Until now such a display at its new size matched no screen (its id was the same, but
 * every pass but the first wants its size or its name): its window hidden, a NEW screen made for it ("Screen 2", Fit),
 * the operator's own screen (its name, Stretch) left "missing", and about 0.7 s with no Drashti window on that
 * projector (x52-1120-161434-29576, both systems). Now it keeps its screen by its id and its (empty) name, as a named
 * display keeps it by its name: the same window, moved, never hidden. Two projectors of one model with one name and no
 * serial, both changing mode at once, each keep theirs the same way. Drashti's pretend displays, Electron's display list
 * replaced in Main; generated media and placeholder names only.
 */

/** The first pretend display's id (main/outputs/electron-outputs.ts EXTRA_DISPLAY_ID). */
const PRETEND = 900_000_000;

const displays = (app: ElectronApplication, n: number) =>
  app.evaluate((_electron, count) => {
    (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays?.(count);
  }, n);

const screensNow = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.screens.get());

/** The jobs of the displays from the first pretend one on: "1: audience", "2: stage"… for those given one. */
const jobs = (win: Page) =>
  win.evaluate(async (first) => {
    const s = await (globalThis as PageGlobals).drashti.screens.get();
    return s.uses
      .filter((u) => u.displayId >= first && u.displayId < first + 4 && u.screenId !== null)
      .map((u) => `${String(u.displayId - first + 1)}: ${u.role === 'stage' ? 'stage' : 'audience'}`);
  }, PRETEND);

/** The output page of a screen, once open. */
async function screenPage(app: ElectronApplication, screenId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(
      async () => {
        found = undefined;
        for (const page of app.windows()) {
          if (page.isClosed() || !page.url().includes('output.html')) continue;
          const at = await page
            .evaluate(() =>
              document.querySelector('[data-testid="output-root"]')?.getAttribute('data-screen'),
            )
            .catch(() => null);
          if (at === screenId) found = page;
        }
        return found !== undefined;
      },
      { timeout: 40_000, message: `the output of screen ${screenId}` },
    )
    .toBe(true);
  if (!found) throw new Error('no output page');
  await expect(found.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
  return found;
}

/** Every output window Main has now: its screen, and whether it is shown. */
const outputWindows = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => {
        if (w.isDestroyed()) return false;
        const url = w.webContents.getURL();
        return url.includes('output.html') && !url.includes('identify=');
      })
      .map(
        (w) => `${new URL(w.webContents.getURL()).searchParams.get('screen') ?? ''}:${String(w.isVisible())}`,
      ),
  );

const origin = (page: Page) => page.evaluate(() => performance.timeOrigin).catch(() => -1);

test('a display with no name and no serial changing its resolution mid-video keeps its screen: the same window, never hidden; the operator’s name and Stretch kept; no new screen', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-nameless-display-'));
  const clip = makeClip(join(dir, 'Placeholder nameless display.mp4'), 'h264', 120, 523);
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await displays(app, 1);
    await expect.poll(() => jobs(win), { timeout: 30_000 }).toEqual(['1: audience']);
    const screenId = (await screensNow(win)).uses.find((u) => u.displayId === PRETEND)?.screenId ?? '';
    const hall = await screenPage(app, screenId);
    await wallpaperAndPicture(win, dir);
    const [id = ''] = await importAndGetIds(win, [clip]);
    const { item } = await openNewPlaylist(win, 'Placeholder nameless display', id);
    await row(win, item).click();
    await expect.poll(() => shown(hall, OUT), { timeout: 30_000 }).toBe('VIDEO');
    // The operator has named its screen and set it to Stretch.
    await win.evaluate(async (sid) => {
      const r = await (globalThis as PageGlobals).drashti.screens.updateScreen(sid, {
        name: 'Placeholder Left PJ',
        scaling: 'stretch',
      });
      if (!r.ok) throw new Error(r.message);
    }, screenId);
    // The projector gives no name and no serial: the same display (its id, place and size), with no name.
    await app.evaluate(({ screen }, pretend) => {
      const g = globalThis as { x53Pj?: Display };
      const p = screen.getPrimaryDisplay();
      const listed = screen.getAllDisplays.bind(screen);
      g.x53Pj = {
        ...p,
        id: pretend,
        label: '',
        internal: false,
        bounds: { ...p.bounds, x: p.bounds.x + 60, y: p.bounds.y + 60 },
        workArea: { ...p.workArea, x: p.workArea.x + 60, y: p.workArea.y + 60 },
      };
      screen.getAllDisplays = () => [...listed(), ...(g.x53Pj ? [g.x53Pj] : [])];
      (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays?.(0);
    }, PRETEND);
    await letTimePass(win, 4000, 'the display without a name is the screen’s');
    const before = {
      state: (await screensNow(win)).status.find((s) => s.screenId === screenId)?.state ?? 'none',
      windows: await outputWindows(app),
      look: await shown(hall, OUT),
    };
    expect(before, 'the nameless display is the screen’s, as it was').toEqual({
      state: 'showing',
      windows: [`${screenId}:true`],
      look: 'VIDEO',
    });
    const page = await origin(hall);

    // Its resolution changes: two thirds of its size.
    const t0 = Date.now();
    const seen = sampler(async () => (await outputWindows(app)).join(','), 50);
    await app.evaluate(() => {
      const g = globalThis as { x53Pj?: Display };
      const pj = g.x53Pj;
      if (!pj) return;
      const w = Math.round((pj.size.width * 2) / 3);
      const h = Math.round((pj.size.height * 2) / 3);
      g.x53Pj = { ...pj, size: { width: w, height: h }, bounds: { ...pj.bounds, width: w, height: h } };
      (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays?.(0);
    });
    await letTimePass(win, 6000, 'Main follows: the display read again, the outputs after it');
    const windowsSeen = (await seen.stop()).map((s) => `+${String(s.at - t0)} ${s.v}`);
    const snap = await screensNow(win);
    const audience = snap.groups.filter((g) => g.role === 'audience').flatMap((g) => g.screens);
    const result = {
      state: snap.status.find((s) => s.screenId === screenId)?.state ?? 'none',
      screens: audience.map(
        (s) => `${s.name} (${s.scaling}, ${snap.status.find((x) => x.screenId === s.id)?.state ?? 'none'})`,
      ),
      everHidden: windowsSeen.some((w) => w.includes(':false')),
      windows: [...new Set(windowsSeen.map((w) => w.split(' ')[1] ?? ''))],
      samePage: (await origin(hall)) === page,
      look: await shown(hall, OUT),
      display: snap.displays
        .filter((d) => d.id === PRETEND)
        .map((d) => `${String(d.pixelWidth)}x${String(d.pixelHeight)}`),
    };
    console.log(`X53 ${process.platform} (nameless) ${JSON.stringify(result)}`);
    expect(result.state, `the operator’s screen keeps its display: ${JSON.stringify(result)}`).toBe(
      'showing',
    );
    expect(result.screens, 'no new screen: the operator’s name and Stretch kept').toEqual([
      'Placeholder Left PJ (stretch, showing)',
    ]);
    expect(result.everHidden, 'its window never hidden').toBe(false);
    expect(result.samePage, 'the same page, never loaded again').toBe(true);
    expect(result.look, 'the video plays on').toBe('VIDEO');
  } finally {
    await app.close();
  }
});

test('two projectors of one model with one name and no serial, both on the audience, changing mode at once mid-video: each keeps its screen and its job', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-nameless-pair-'));
  const clip = makeClip(join(dir, 'Placeholder projector pair.mp4'), 'h264', 120, 880);
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    // Two projectors of one model: one name, no serial that tells them apart, side by side.
    await app.evaluate(({ screen }, pretend) => {
      const g = globalThis as { x53Pair?: Display[] };
      const p = screen.getPrimaryDisplay();
      const listed = screen.getAllDisplays.bind(screen);
      const pj = (i: number): Display => ({
        ...p,
        id: pretend + i,
        label: 'Placeholder PJ',
        internal: false,
        bounds: { ...p.bounds, x: p.bounds.x + 60 * (i + 1), y: p.bounds.y + 60 * (i + 1) },
        workArea: { ...p.workArea, x: p.workArea.x + 60 * (i + 1), y: p.workArea.y + 60 * (i + 1) },
      });
      g.x53Pair = [pj(0), pj(1)];
      screen.getAllDisplays = () => [...listed(), ...(g.x53Pair ?? [])];
      (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays?.(0);
    }, PRETEND);
    await expect.poll(() => jobs(win), { timeout: 30_000 }).toEqual(['1: audience', '2: stage']);
    // The operator's one Change…: the second shows the audience picture too.
    const given = await win.evaluate(
      (d) => (globalThis as PageGlobals).drashti.screens.setJob(d, 'audience'),
      PRETEND + 1,
    );
    expect(given.ok).toBe(true);
    await expect.poll(() => jobs(win), { timeout: 20_000 }).toEqual(['1: audience', '2: audience']);
    const screensOf = async () =>
      (await screensNow(win)).uses
        .filter((u) => u.displayId >= PRETEND && u.screenId !== null)
        .map((u) => `${String(u.displayId - PRETEND + 1)}:${u.screenId ?? ''}`);
    const before = await screensOf();
    const uses = (await screensNow(win)).uses;
    const pageA = await screenPage(app, uses.find((u) => u.displayId === PRETEND)?.screenId ?? '');
    const pageB = await screenPage(app, uses.find((u) => u.displayId === PRETEND + 1)?.screenId ?? '');
    await wallpaperAndPicture(win, dir);
    const [id = ''] = await importAndGetIds(win, [clip]);
    const { item } = await openNewPlaylist(win, 'Placeholder projector pair', id);
    await row(win, item).click();
    await expect.poll(() => shown(pageA, OUT), { timeout: 30_000 }).toBe('VIDEO');
    await expect.poll(() => shown(pageB, OUT), { timeout: 30_000 }).toBe('VIDEO');
    // Both change mode at once (the computer's display settings applied again; both waking at another mode).
    await app.evaluate(() => {
      const g = globalThis as { x53Pair?: Display[] };
      g.x53Pair = (g.x53Pair ?? []).map((d) => {
        const w = Math.round((d.size.width * 2) / 3);
        const h = Math.round((d.size.height * 2) / 3);
        return { ...d, size: { width: w, height: h }, bounds: { ...d.bounds, width: w, height: h } };
      });
      (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays?.(0);
    });
    await letTimePass(win, 6000, 'Main follows: the displays read again, the outputs after them');
    const result = {
      before,
      after: await screensOf(),
      jobs: await jobs(win),
      looks: [await shown(pageA, OUT), await shown(pageB, OUT)],
    };
    console.log(`X53 ${process.platform} (pair) ${JSON.stringify(result)}`);
    expect(result.jobs, `each keeps its job: ${JSON.stringify(result)}`).toEqual([
      '1: audience',
      '2: audience',
    ]);
    expect(result.after, 'each keeps its screen').toEqual(before);
    expect(result.looks, 'both play on').toEqual(['VIDEO', 'VIDEO']);
  } finally {
    await app.close();
  }
});
