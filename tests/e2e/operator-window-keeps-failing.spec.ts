import type { ElectronApplication } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importAndGetIds, launchApp, letTimePass, operatorPage, operatorReady } from './helpers';
import {
  audienceScreen,
  LIVE,
  makeClip,
  openNewPlaylist,
  OUT,
  row,
  SCREENS,
  shown,
  wallpaperAndPicture,
} from './hall-looks';
import {
  askWindow,
  clickMenu,
  poisonKills,
  poisonOff,
  poisonWindow,
  screenLook,
  upNow,
  watchdogEvents,
} from './keeps-failing';

/*
 * The operator window that keeps failing on a video (x53; the owner's Q60-31 bug hunt, x52's D6d; his Q60-50 A). LIVE
 * decodes the video up in the operator window itself. Until now a window that went down each time LIVE loaded it was
 * given up on after six times in a minute, the controls gone, and View › Reload Operator Window brought it down again
 * while the video stayed up: only a quit was left (x52-1120-161434-29576, both systems). Now the video comes off with
 * its sound after the second time, as a video that fails on LIVE does (x46's take-off), the window loads again at once
 * with its controls, and the notice naming the video waits for it. Generated media and placeholder names only.
 */

const OPERATOR = 'index.html';

/** Whether the operator window has its controls now (LIVE among them), asked by Main. */
const controls = (app: ElectronApplication) =>
  askWindow(app, OPERATOR, 'String(!!document.querySelector(\'[data-testid="live-preview"]\'))');

/** The operator window's notices now, asked by Main. */
const toldNow = (app: ElectronApplication) =>
  askWindow(
    app,
    OPERATOR,
    `Array.from(document.querySelectorAll('[data-testid="operator-notice"]')).map((e) => e.textContent.trim()).join(' / ')`,
  );

test('a video that brings the operator window down each time LIVE loads it: after the second time it comes off with its sound, the controls are back within seconds and a notice names it; never given up; View › Reload Operator Window gives the controls back', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-operator-keeps-failing-'));
  const clip = makeClip(join(dir, 'Placeholder brings LIVE down.mp4'), 'h264', 120, 831);
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    const screenId = (await hall.page.getByTestId('output-root').getAttribute('data-screen')) ?? '';
    await wallpaperAndPicture(win, dir);
    const [id = ''] = await importAndGetIds(win, [clip]);
    const { item } = await openNewPlaylist(win, 'Placeholder brings LIVE down', id);
    await row(win, item).click();
    await expect.poll(() => shown(hall.page, OUT), { timeout: 30_000 }).toBe('VIDEO');
    await expect.poll(() => shown(win, LIVE), { timeout: 30_000 }).toBe('VIDEO');

    // From here the operator window is read through Main, and the show through the hall's page.
    const t0 = Date.now();
    await poisonWindow(app, OPERATOR, `[data-testid="live-preview"] video[data-media-id="${id}"]`);
    const offAfter = await expect
      .poll(() => upNow(hall.page), { timeout: 20_000 })
      .not.toBe(id)
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    const backAfter = await expect
      .poll(() => controls(app), { timeout: 20_000 })
      .toBe('true')
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    await letTimePass(hall.page, 3000, 'the controls stay');
    const stays = await controls(app);
    await expect
      .poll(() => toldNow(app), { timeout: 10_000 })
      .toContain('Placeholder brings LIVE down')
      .catch(() => undefined);
    const told = await toldNow(app);
    const hallLook = await screenLook(app, screenId);
    // The menu's way back works too, nothing bringing the window down any more.
    const found = await clickMenu(app, 'Reload Operator Window');
    await letTimePass(hall.page, 8000, 'the operator window loads again');
    const afterReload = await controls(app);
    const events = (await watchdogEvents(app)).filter((e) => e.includes(' operator'));
    await poisonOff(app, OPERATOR);
    const result = {
      kills: await poisonKills(app, OPERATOR),
      offAfterMs: offAfter,
      controlsBackAfterMs: backAfter,
      stays,
      told,
      hallLook,
      menuFound: found,
      afterReload,
      watchdog: events,
    };
    console.log(`X53 ${process.platform} (operator) ${JSON.stringify(result)}`);
    expect(
      offAfter,
      `the video comes off once the operator window keeps going down on it: ${JSON.stringify(result)}`,
    ).toBeGreaterThan(0);
    expect(backAfter, 'the controls back within seconds').toBeGreaterThan(0);
    expect(stays, 'and they stay').toBe('true');
    expect(told, 'a notice names the video and LIVE').toMatch(/Placeholder brings LIVE down[\s\S]*LIVE/u);
    expect(hallLook, 'the hall on the Wallpaper').toBe('WALL');
    expect(result.kills, 'down twice, then never again').toBeLessThanOrEqual(3);
    expect(
      events.some((e) => e.includes(' gave-up operator')),
      'never given up',
    ).toBe(false);
    expect(found).toBe(true);
    expect(afterReload, 'View › Reload Operator Window gives the controls back').toBe('true');
  } finally {
    await app.close();
  }
});
