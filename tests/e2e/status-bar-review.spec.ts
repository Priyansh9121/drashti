import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventChannel, EventContract } from '../../src/shared/ipc';
import { IPC } from '../../src/shared/ipc';
import type { ScreenStatus } from '../../src/shared/screens';
import type { SaveJob } from '../../src/shared/trim';
import { stopAnswering } from './access';
import { fitFaults } from './fit';
import { dropFiles, launchApp, openLibrary, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/* The release lead's three statusbar MUSTs (28 Nov): combined warnings must fit without moving Sound/Help,
 * failed screens must not widen the summary, and task buttons must keep their entire 24 px edge and focus ring.
 * IPC fixtures deliver real production payloads to the operator only; no output or show-engine code is replaced.
 */
const WIDE = { width: 1410, height: 900 } as const;
const QUICK = {
  DRASHTI_TEST_ACCESS_CHECK_MS: '2000',
  DRASHTI_TEST_ACCESS_TIMEOUT_MS: '1000',
  DRASHTI_TEST_ACCESS_BAR_MS: '12000',
  DRASHTI_TEST_ACCESS_STOP_MS: '600000',
};
const bar = (win: Page) => win.locator('footer[aria-label="Status"]');

async function tell<C extends EventChannel>(app: ElectronApplication, channel: C, value: EventContract[C]) {
  await app.evaluate(
    ({ BrowserWindow }, { channel, value }) => {
      const operator = BrowserWindow.getAllWindows().find((w) =>
        /operator\.html/u.test(w.webContents.getURL()),
      );
      if (!operator) throw new Error('no operator window');
      operator.webContents.send(channel, value);
    },
    { channel, value },
  );
}

const steady = (win: Page) =>
  win.evaluate(() => {
    const selectors = [
      '[data-testid="screens-summary"]',
      '[data-testid="sound-status"], [data-testid="sound-warning"]',
      '[data-testid="today-calendar"]',
      '[data-testid="help-toggle"]',
      '[data-show-control]',
    ];
    return selectors.flatMap((selector) =>
      [...document.querySelectorAll(selector)].map((el) => {
        const r = el.getBoundingClientRect();
        return `${selector}: ${r.x.toFixed(2)},${r.y.toFixed(2)} ${r.width.toFixed(2)}×${r.height.toFixed(2)}`;
      }),
    );
  });

async function fits(win: Page, where: string) {
  expect
    .soft(
      (await fitFaults(win, [])).filter((f) => f.startsWith('the status bar')),
      where,
    )
    .toEqual([]);
  expect
    .soft(
      await bar(win).evaluate((root) => {
        const faults: string[] = [];
        const edge = root.getBoundingClientRect();
        if (root.scrollWidth > root.clientWidth + 1)
          faults.push(`footer needs ${root.scrollWidth} px of ${root.clientWidth}`);
        for (const el of root.querySelectorAll('[data-testid], button')) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (
            r.left < edge.left - 0.01 ||
            r.right > edge.right + 0.01 ||
            r.top < edge.top - 0.01 ||
            r.bottom > edge.bottom + 0.01
          )
            faults.push(`${el.getAttribute('data-testid') ?? el.textContent.trim()}: outside footer`);
        }
        for (const el of root.querySelectorAll(
          '[data-testid="sound-status"] .truncate, [data-testid="sound-warning"] .truncate',
        )) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const cut = range.getBoundingClientRect().width - el.getBoundingClientRect().width;
          if (cut > 0.01) faults.push(`Sound words cut ${cut.toFixed(2)} px`);
        }
        return faults;
      }),
      where,
    )
    .toEqual([]);
}

for (const mode of ['pro', 'simple'] as const)
  test(`MUST-1 ${mode}: mirroring, access countdown, both screens off, Audio muted and disconnected Sound all fit; steady controls never move`, async () => {
    const { app, access } = await launchApp({
      ...QUICK,
      DRASHTI_TEST_AUTO_SCREENS: 'pretend',
      DRASHTI_TEST_MIRRORED_ONTO: 'PLACEHOLDER PJ',
      DRASHTI_TEST_FAKE_DEVICES: '1',
    });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      await sizeOperatorWindow(app, win, CI_WINDOW);
      await expect(win.getByTestId('screens-said')).toHaveAttribute('data-kind', 'mirroring');
      await win.evaluate(async () => {
        const d = (globalThis as PageGlobals).drashti;
        for (const which of ['audience', 'stage'] as const) {
          const result = await d.screenSwitches.turn(which, false);
          if (!result.ok) throw new Error(result.message);
        }
      });
      if (mode === 'simple')
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
      stopAnswering(access);
      await expect(win.getByTestId('access-offline-notice')).toBeVisible({ timeout: 30_000 });
      await expect(win.getByTestId('sound-status')).toBeVisible();
      const before = await steady(win);
      for (const missing of [false, true, false]) {
        // Selecting a missing mixer is a real operator action; returning to System default must restore the same slot.
        if (mode === 'simple')
          await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
        await win.evaluate(
          (missing) =>
            (globalThis as PageGlobals).drashti.audio.setOutput(
              missing ? { id: 'placeholder-mixer', label: 'Placeholder Mixer' } : null,
            ),
          missing,
        );
        if (mode === 'simple')
          await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
        const sound = win.getByTestId(missing ? 'sound-warning' : 'sound-status');
        await expect(sound).toBeVisible();
        for (const muted of [true, false]) {
          await win.evaluate(
            (muted) => (globalThis as PageGlobals).drashti.sound.setMuted('audio', muted),
            muted,
          );
          await expect(win.getByTestId('sound-muted-status')).toHaveText(muted ? 'Audio muted' : '');
          const where = `${mode}, missing ${missing}, muted ${muted}`;
          expect.soft(await steady(win), where).toEqual(before);
          await fits(win, where);
        }
      }
    } finally {
      await app.close();
    }
  });

for (const mode of ['pro', 'simple'] as const)
  test(`MUST-2 ${mode}: missing, stopped and restarting screens never widen the summary or move Sound, calendar, Help or show controls`, async () => {
    const { app, userData } = await launchApp();
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const file = join(userData, 'placeholder-calendar.json');
      writeFileSync(
        file,
        JSON.stringify({
          format: 'drashti-calendar',
          version: 1,
          name: 'Placeholder calendar',
          days: [
            {
              date,
              samvat: 1001,
              month: { en: 'Month' },
              paksha: { en: 'Half' },
              tithi: { en: 'Day' },
              festivals: [],
            },
          ],
        }),
      );
      await win.evaluate((file) => (globalThis as PageGlobals).drashti.library.importPaths([file]), file);
      await expect(win.getByTestId('today-calendar')).toBeVisible();
      if (mode === 'simple')
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
      const snapshot = await win.evaluate(() => (globalThis as PageGlobals).drashti.screens.get());
      const showing: ScreenStatus[] = [1, 2].map((n) => ({
        screenId: `placeholder-${n}`,
        state: 'showing',
        displayId: n,
      }));
      for (const size of [CI_WINDOW, WIDE]) {
        await sizeOperatorWindow(app, win, size);
        await tell(app, IPC.screens.changed, { ...snapshot, status: showing });
        await expect(win.getByTestId('screens-summary')).toHaveText('2 screens showing');
        const before = await steady(win);
        const faults: ScreenStatus[] = [
          { screenId: 'placeholder-2', state: 'missing-display', displayId: 2 },
          { screenId: 'placeholder-2', state: 'stopped', displayId: 2 },
          { screenId: 'placeholder-2', state: 'showing', displayId: 2, restarts: 4 },
        ];
        for (const fault of faults) {
          await tell(app, IPC.screens.changed, { ...snapshot, status: [showing[0]!, fault] });
          const words = fault.restarts
            ? 'keeps restarting'
            : fault.state === 'stopped'
              ? 'stopped'
              : 'display not connected';
          await expect(win.getByTestId('screens-summary')).toContainText(words);
          const where = `${mode} ${size.width}, ${words}`;
          expect.soft(await steady(win), where).toEqual(before);
          await fits(win, where);
        }
        await tell(app, IPC.screens.changed, { ...snapshot, status: showing });
        await expect(win.getByTestId('screens-summary')).toHaveText('2 screens showing');
        expect.soft(await steady(win)).toEqual(before);
      }
    } finally {
      await app.close();
    }
  });

async function ring(win: Page, button: Locator, where: string) {
  await button.focus();
  await win.keyboard.press('Shift+Tab');
  await win.keyboard.press('Tab');
  await expect(button).toBeFocused();
  const faults = await button.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const out = Math.max(0, Number.parseFloat(s.outlineOffset) + Number.parseFloat(s.outlineWidth));
    const faults: string[] = [];
    if (r.height !== 24 || r.width < 24)
      faults.push(`target ${r.width.toFixed(2)} × ${r.height.toFixed(2)} (height must be 24)`);
    if (!el.matches(':focus-visible') || s.outlineStyle === 'none') faults.push('no keyboard ring');
    const check = (box: { left: number; top: number; right: number; bottom: number }, what: string) => {
      if (
        r.left - out < box.left - 0.01 ||
        r.right + out > box.right + 0.01 ||
        r.top - out < box.top - 0.01 ||
        r.bottom + out > box.bottom + 0.01
      )
        faults.push(`edge or ring cut by ${what}`);
    };
    check({ left: 0, top: 0, right: innerWidth, bottom: innerHeight }, 'window');
    for (let p = el.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible')
        check(p.getBoundingClientRect(), p.tagName);
    }
    return faults;
  });
  expect.soft(faults, where).toEqual([]);
}

test('MUST-3: import Cancel/Dismiss, MP4 Stop/Show/Dismiss and conversion Stop are exactly 24 px with their edge and keyboard ring whole', async () => {
  const { app, userData } = await launchApp({ DRASHTI_TEST_STAGE_AT_START: '' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const file = join(userData, 'Placeholder status task.txt');
    writeFileSync(file, 'title: Placeholder task\n\nPlaceholder first line\nPlaceholder second line\n');
    await openLibrary(win);
    await dropFiles(win, win.getByTestId('library-drop'), [file]);
    const result = win.getByTestId('import-result');
    await expect(result).toBeVisible();
    for (const size of [CI_WINDOW, WIDE]) {
      await sizeOperatorWindow(app, win, size);
      await ring(win, result.getByRole('button', { name: 'Dismiss' }), `import result ${size.width}`);
      await tell(app, IPC.library.importProgress, {
        runId: 'placeholder-import',
        phase: 'importing',
        done: 1,
        total: 2,
        current: 'Placeholder task.txt',
      });
      await expect(win.getByTestId('import-progress')).toBeVisible();
      await ring(
        win,
        win.getByTestId('import-progress').getByRole('button', { name: 'Cancel' }),
        `import Cancel ${size.width}`,
      );
      await tell(app, IPC.library.importProgress, {
        runId: 'placeholder-import',
        phase: 'finished',
        done: 2,
        total: 2,
        current: null,
      });
      await expect(result).toBeVisible();
      const job: SaveJob = {
        id: `placeholder-save-${size.width}`,
        mediaId: 'placeholder-media',
        name: 'Placeholder MP4',
        state: 'saving',
        progress: 0.5,
        note: null,
        message: null,
        path: null,
        added: false,
      };
      await tell(app, IPC.media.savesChanged, [job]);
      await expect(win.getByTestId('save-progress')).toBeVisible();
      await ring(win, win.getByTestId('save-stop'), `save Stop ${size.width}`);
      await tell(app, IPC.media.savesChanged, [{ ...job, state: 'done', progress: 1 }]);
      const save = win.getByTestId('save-result');
      await expect(save).toBeVisible();
      for (const button of await save.getByRole('button').all())
        await ring(win, button, `save result ${size.width}`);
      await tell(app, IPC.media.savesChanged, []);
      await tell(app, IPC.media.conversionsChanged, [
        {
          id: 'placeholder-conversion',
          mediaId: 'placeholder-media',
          name: 'Placeholder link',
          state: 'converting',
          progress: 0.5,
          note: null,
          message: null,
          maxHeight: 720,
          convertedId: null,
          convertedName: null,
          conversionId: null,
        },
      ]);
      const stop = win
        .getByTestId('link-conversion-status')
        .getByRole('button', { name: 'Stop converting Placeholder link' });
      await expect(stop).toBeVisible();
      await ring(win, stop, `conversion Stop ${size.width}`);
      await tell(app, IPC.media.conversionsChanged, []);
    }
  } finally {
    await app.close();
  }
});
