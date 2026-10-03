import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, networkOn, NETWORK_ENV, pairByQr, pairingCode, TABLET } from './devices';
import {
  importAndGetIds,
  killApp,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  type PageGlobals,
  relaunchApp,
  setUpScreen,
} from './helpers';

/*
 * The stage display in a browser (a Stage device) shows exactly what a stage
 * screen shows, from the same state: the current and next text, the notes,
 * the clock, timers and the stage message; black-out as the stage screen
 * says it; and after Drashti stops and starts again it comes back by itself
 * with the slide recovery put back. Placeholder content.
 */

const line = (text: string) => ({ text: [{ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) }] });

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/** What a stage view says, part by part (the running timers' seconds left out). */
async function said(page: Page) {
  const view = page.getByTestId('stage-view');
  const text = async (id: string) =>
    (await view.getByTestId(id).count()) > 0 ? await view.getByTestId(id).innerText() : null;
  return {
    current: await text('stage-current'),
    next: await text('stage-next'),
    notes: await text('stage-notes'),
    message: await text('stage-message'),
    clock: await text('stage-clock'),
    timers: await view.getByTestId('stage-timer').allInnerTexts(),
    now: await view.locator('p').first().innerText(),
  };
}

test('the stage display in a browser matches the stage screen, and comes back after Drashti restarts', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-stage-display-'));
  const song = join(dir, 'Placeholder Stage Song.pro6');
  writeFileSync(
    song,
    pp6Presentation({
      uuid: 'E2E-STAGE-DISPLAY',
      groups: [
        {
          name: 'Verse',
          slides: [
            { ...line('Placeholder stage line one'), notes: 'Placeholder note: slow down here' },
            line('Placeholder stage line two'),
          ],
        },
      ],
    }),
  );
  const { app, userData } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const [presentationId = ''] = await importAndGetIds(win, [song]);
  // One output, on a stage group.
  await setUpScreen(win, 'Stage');
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.name === 'Stage');
    const r = await d.screens.setGroupRole(group?.id ?? '', 'stage');
    if (!r.ok) throw new Error(r.message);
  });
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-role', 'stage');
  // A timer, paused part way (so both show the same time), and the slide with notes, and a stage message.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const t = await d.timers.create({
      name: 'Placeholder countdown',
      kind: 'countdown',
      durationMs: 600_000,
      targetTime: null,
      allowsOverrun: false,
    });
    if (!t.ok) throw new Error(t.message);
  });
  const timerId = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.timers[0]?.id ?? '',
  );
  await dispatch(win, { type: 'startTimer', timerId });
  await win.waitForTimeout(1200);
  await dispatch(win, { type: 'pauseTimer', timerId });
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
  await dispatch(win, { type: 'setStageMessage', text: 'Placeholder: two minutes left' });

  const { base, port } = await networkOn(win);
  const code = await pairingCode(win, 'stage', 'Placeholder stage tablet');
  const tablet = await device('webkit', TABLET);
  const t = tablet.page;
  try {
    await pairByQr(t, base, code, '/stage');
    await expect(t.getByTestId('stage-view')).toBeVisible();
    await expect(t.getByTestId('stage-current')).toHaveText('Placeholder stage line one');
    await expectNoSeriousA11yIssues(t, 'the stage display on a tablet');
    // The same, part by part (the clock can turn over between reads: compare again until it agrees).
    await expect.poll(async () => JSON.stringify(await said(t))).toBe(JSON.stringify(await said(output)));
    const now = await said(t);
    expect(now).toMatchObject({
      current: 'Placeholder stage line one',
      next: 'Placeholder stage line two',
      notes: 'Placeholder note: slow down here',
      message: 'Placeholder: two minutes left',
    });
    expect(now.timers[0]).toContain('Placeholder countdown (paused)');
    // It follows: Next, then black-out, as the stage screen does.
    await dispatch(win, { type: 'next' });
    await expect(t.getByTestId('stage-current')).toHaveText('Placeholder stage line two');
    await dispatch(win, { type: 'setBlackout', on: true });
    await expect(t.getByTestId('stage-view')).toContainText('AUDIENCE SCREENS BLACK');
    await expect.poll(async () => JSON.stringify(await said(t))).toBe(JSON.stringify(await said(output)));
    await dispatch(win, { type: 'setBlackout', on: false });
    // No pictures on a stage display.
    await expect(t.locator('img, video')).toHaveCount(0);

    // Drashti stops: the display keeps the last picture and says so. It starts again: back by itself,
    // with the slide restart recovery put back.
    await expect
      .poll(
        async () =>
          await win.evaluate(
            async () =>
              (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide?.slideIndex,
          ),
      )
      .toBe(1);
    await win.waitForTimeout(600);
    await killApp(app);
    await expect(t.getByTestId('stage-offline')).toBeVisible({ timeout: 20_000 });
    await expect(t.getByTestId('stage-current')).toHaveText('Placeholder stage line two');
    const again = await relaunchApp(userData, NETWORK_ENV);
    const win2 = await operatorPage(again.app);
    await operatorReady(win2);
    await expect
      .poll(
        async () => (await win2.evaluate(() => (globalThis as PageGlobals).drashti.network.status())).state,
      )
      .toBe('listening');
    expect((await win2.evaluate(() => (globalThis as PageGlobals).drashti.network.status())).port).toBe(port);
    await expect(t.getByTestId('stage-offline')).toHaveCount(0, { timeout: 20_000 });
    await expect(t.getByTestId('stage-current')).toHaveText('Placeholder stage line two');
    await again.app.close();
  } finally {
    await tablet.close();
  }
});
