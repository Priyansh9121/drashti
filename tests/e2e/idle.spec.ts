import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { idleFrame, type IdleState } from '../../src/shared/idle';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  openMoreTools,
  operatorPage,
  operatorReady,
  outputPages,
  setUpScreen,
  outputReady,
} from './helpers';
import { makeTestImage } from './test-media';
import { holdClock } from './placeholder-slides';

/*
 * The idle rotation (Session 12), with generated pictures and placeholder
 * quotes: a lobby screen shows it whenever nothing is up; started, the hall
 * shows it too, in step with the lobby; the quote of the day comes after the
 * pictures and in a stage box; the first slide up stops it, so Clear all
 * does not bring it back to the hall (the lobby shows it again); Simple Mode
 * changes none of it; the panel and its dialog pass the accessibility checks.
 */

async function outputFor(app: ElectronApplication, screenId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const p of outputPages(app))
        if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) found = p;
      return found !== undefined;
    })
    .toBe(true);
  if (!found) throw new Error(`no output for ${screenId}`);
  // Ready to draw the show (Session 27's warm-up): one still warming would lag another.
  await outputReady(found);
  return found;
}

const engineState = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** The item each screen shows now, read as close together as the test can. */
async function shownIndex(page: Page): Promise<number | null> {
  const at = await page
    .locator('[data-layer="idle"]')
    .getAttribute('data-idle-index', { timeout: 1000 })
    .catch(() => null);
  return at === null ? null : Number(at);
}

test('a lobby shows the rotation whenever nothing is up; started, the hall shows it in step; the first slide stops it', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '2' });
  const win = await operatorPage(app);
  // Macros, Masks and the Idle rotation are in More tools (Session 26a).
  await openMoreTools(win);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const hallId = await setUpScreen(win, 'Hall', 0);
  const lobbyId = await setUpScreen(win, 'Lobby', 1);
  const stageId = await setUpScreen(win, 'Stage', 2);

  // Three generated pictures, two placeholder quotes, 3 seconds each, then the quote of the day.
  const dir = mkdtempSync(join(tmpdir(), 'drashti-idle-'));
  const files = [];
  for (const [i, color] of ['#3a6ea5', '#a5563a', '#4a8f4a'].entries())
    files.push(
      await makeTestImage(win, join(dir, `placeholder-darshan-${String(i + 1)}.png`), {
        color,
        width: 320,
        height: 180,
      }),
    );
  const pictures = await importAndGetIds(win, files);
  const quoteOfTheDay = await win.evaluate(
    async ({ ids }) => {
      const d = (globalThis as PageGlobals).drashti;
      for (const words of [
        { en: 'Placeholder quote one', gu: 'નમૂનાનું પહેલું વાક્ય' },
        { en: 'Placeholder quote two' },
      ]) {
        const made = await d.idle.saveQuote(null, { words, attribution: 'Placeholder' });
        if (!made.ok) throw new Error(made.message);
      }
      const saved = await d.idle.saveSettings({ pictures: ids, secondsEach: 3, quoteOfTheDay: true });
      if (!saved.ok) throw new Error(saved.message);
      // The hall shows it once started; the lobby always; the stage a quote box.
      const groups = (await d.screens.get()).groups;
      const id = (name: string) => groups.find((g) => g.name === name)?.id ?? '';
      await d.screens.setGroupRole(id('Stage'), 'stage');
      const layout = await d.stageLayouts.save(null, {
        name: 'Placeholder quote layout',
        background: '#000000',
        boxes: [
          {
            id: 'quote',
            kind: 'quote',
            frame: { x: 48, y: 48, width: 1824, height: 600 },
            size: 56,
            color: '#ffffff',
            align: 'center',
            label: '',
          },
        ],
      });
      if (!layout.ok) throw new Error(layout.message);
      const live = (await d.looks.list()).liveId;
      await d.looks.setGroup(live, id('Hall'), { idle: 'started' });
      await d.looks.setGroup(live, id('Lobby'), { idle: 'always' });
      await d.looks.setGroup(live, id('Stage'), { stageLayoutId: layout.id });
      return (await d.idle.view()).quoteOfTheDay;
    },
    { ids: pictures },
  );
  expect(quoteOfTheDay).not.toBeNull();
  const hall = await outputFor(app, hallId);
  const lobby = await outputFor(app, lobbyId);
  const stage = await outputFor(app, stageId);

  // Not started: the lobby shows it (nothing is up), the hall does not.
  await expect(lobby.locator('[data-layer="idle"]')).toBeVisible();
  await expect(hall.locator('[data-layer="idle"]')).toHaveCount(0);
  // The stage shows the quote of the day.
  await expect(stage.locator('[data-stage-box="quote"]')).toContainText(quoteOfTheDay?.words.en ?? '-');

  // Started from the panel: the hall shows it too, the same item as the lobby at the same time.
  const panel = win.getByTestId('idle-panel');
  await expect(panel.getByTestId('idle-where')).toContainText('Hall (once started), Lobby (always)');
  await expectNoSeriousA11yIssues(win, 'the Idle rotation panel');
  await panel.getByTestId('idle-start').click();
  await expect(hall.locator('[data-layer="idle"]')).toBeVisible();
  const idle: IdleState = (await engineState(win)).idle;
  expect(idle.items.map((i) => i.kind)).toEqual(['picture', 'picture', 'picture', 'quote']);
  let compared = 0;
  for (let sample = 0; sample < 12 && compared < 5; sample++) {
    // Away from a change (a window's clock reads up to a tenth of a second apart), every screen agrees.
    const now = Date.now();
    const frame = idleFrame(idle, idle.startedAt ?? 0, now);
    const into = (now - (idle.startedAt ?? 0)) % 3000;
    if (frame && into > 400 && into < 2400) {
      const [h, l] = await Promise.all([shownIndex(hall), shownIndex(lobby)]);
      // The lobby, showing it before the start, follows the start too: one rotation for every screen.
      expect([h, l]).toEqual([frame.index, frame.index]);
      compared++;
    }
    await win.waitForTimeout(700);
  }
  expect(compared).toBeGreaterThanOrEqual(3);
  // After the pictures, the quote of the day.
  await expect(hall.locator(`[data-idle-item="${quoteOfTheDay?.id ?? '-'}"]`).first()).toBeAttached({
    timeout: 15_000,
  });

  // The first slide up stops it: the hall and the lobby show the slide.
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Sample kirtan/ })
    .click();
  await win.getByTestId('slide-thumb').first().click();
  await expect.poll(async () => (await engineState(win)).idle.startedAt).toBeNull();
  await expect(hall.locator('[data-layer="idle"]')).toHaveCount(0);
  await expect(lobby.locator('[data-layer="idle"]')).toHaveCount(0);
  await expect(panel.getByTestId('idle-start')).toBeVisible();
  // Clear all: the hall stays empty (it stopped), the lobby shows it again.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearAll' }));
  await expect(lobby.locator('[data-layer="idle"]')).toBeVisible();
  await expect(hall.locator('[data-layer="idle"]')).toHaveCount(0);

  // Set up: its dialog passes the checks at 1280 x 720.
  await panel.getByTestId('open-idle').click();
  const dialog = win.getByTestId('idle-dialog');
  await expect(dialog.getByTestId('idle-chosen').locator('li')).toHaveCount(3);
  await expect(dialog.getByTestId('quote-row')).toHaveCount(2);
  await expectNoSeriousA11yIssues(win, 'the Idle rotation dialog');
  await win.getByRole('button', { name: 'Close the idle rotation' }).click();

  // Simple Mode changes none of it.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const refused = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const view = await d.idle.view();
    return [
      await d.idle.saveSettings(view.settings),
      await d.idle.saveQuote(null, { words: { en: 'Placeholder' }, attribution: '' }),
      await d.idle.removeQuote(view.quotes[0]?.id ?? ''),
    ];
  });
  expect(refused).toEqual([
    { ok: false, message: SIMPLE_MODE_REFUSAL },
    { ok: false, message: SIMPLE_MODE_REFUSAL },
    { ok: false, message: SIMPLE_MODE_REFUSAL },
  ]);
  await app.close();
});

test('the rotation dissolves light for light: the old item out as the new comes in, in a group of their own (Session 27)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_TEST_CLOCK_HOLD: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const lobbyId = await setUpScreen(win, 'Lobby', 0);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-idle-dissolve-'));
  const files = [];
  for (const [i, color] of ['#3a6ea5', '#a5563a'].entries())
    files.push(
      await makeTestImage(win, join(dir, `placeholder-darshan-${String(i + 1)}.png`), {
        color,
        width: 320,
        height: 180,
      }),
    );
  const pictures = await importAndGetIds(win, files);
  await win.evaluate(
    async ({ ids }) => {
      const d = (globalThis as PageGlobals).drashti;
      const saved = await d.idle.saveSettings({ pictures: ids, secondsEach: 3, quoteOfTheDay: false });
      if (!saved.ok) throw new Error(saved.message);
      const lobby = (await d.screens.get()).groups.find((g) => g.name === 'Lobby')?.id ?? '';
      await d.looks.setGroup((await d.looks.list()).liveId, lobby, { idle: 'always' });
    },
    { ids: pictures },
  );
  const lobby = await outputFor(app, lobbyId);
  await expect(lobby.locator('[data-layer="idle"]')).toBeVisible();
  const idle: IdleState = (await engineState(win)).idle;
  const each = idle.secondsEach * 1000;
  const dissolve = Math.min(idle.dissolveMs, each / 2);
  // Not started, it runs from 0: held a quarter and a half of the way through a dissolve, a step ahead.
  const step = Math.floor(Date.now() / each) + 2;
  // The item up is drawn first, the one dissolving in over it second.
  const opacities = () =>
    lobby.locator('[data-layer="idle"]').evaluate((root) => {
      const [current, next] = root.querySelectorAll<HTMLElement>('[data-idle-item]');
      return {
        isolated: getComputedStyle(root).isolation,
        current: Number(getComputedStyle(current ?? root).opacity),
        next: next ? Number(getComputedStyle(next).opacity) : Number.NaN,
        adds: next ? getComputedStyle(next).mixBlendMode : '',
      };
    });
  for (const [fade, eased] of [
    [0.25, 0.15625],
    [0.5, 0.5],
  ] as const) {
    await holdClock(app, step * each + (each - dissolve) + fade * dissolve);
    await expect.poll(async () => (await opacities()).next).toBeCloseTo(eased, 3);
    const o = await opacities();
    expect(o.current + o.next, `at ${String(fade)} of the dissolve`).toBeCloseTo(1, 6);
    expect(o.isolated).toBe('isolate');
    expect(o.adds).toBe('plus-lighter');
  }
  await holdClock(app, null);
  await app.close();
});
