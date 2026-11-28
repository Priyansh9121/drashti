import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventChannel, EventContract } from '../../src/shared/ipc';
import { IPC } from '../../src/shared/ipc';
import { festivalsLine, samvatLine, type CalendarDay } from '../../src/shared/calendar';
import { silentWords, type SoundLevels } from '../../src/shared/sound';
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
const SIZES = [CI_WINDOW, { width: 1280, height: 720 }, WIDE];
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
        w.webContents.getURL().includes('index.html'),
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

/** ResizeObserver updates the columns after the viewport changes: compare only once their baseline is stable. */
async function settledSteady(win: Page): Promise<string[]> {
  let last: string[] = [];
  await expect
    .poll(
      async () => {
        const now = await steady(win);
        const same = now.length > 0 && JSON.stringify(now) === JSON.stringify(last);
        last = now;
        return same;
      },
      { message: 'operator layout settles before the state change', intervals: [1000] },
    )
    .toBe(true);
  return last;
}

/** The unrelated top notice changes the column height; its ResizeObserver must restore LIVE after Dismiss.
 * Windows' non-overlay scrollbar otherwise leaves a one-frame 10 px narrower picture in this footer fixture.
 * Require the SAME exact baseline for every footer/show control; a real movement never satisfies this fence.
 */
async function dismissStoppedNotice(win: Page, before: string[]) {
  const notice = win.getByTestId('screen-stopped-notice');
  if (await notice.count()) await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
  await expect
    .poll(() => steady(win), {
      message:
        'the independent stopped-screen notice has closed and LIVE has returned to its original bounds',
      intervals: [50, 100, 250],
    })
    .toEqual(before);
}

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
        if (edge.height !== 28) faults.push(`footer must remain one 28 px row, got ${edge.height}`);
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
        // Also check the rendered compact words; hidden full wording must remain available to assistive tech.
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const nodeWords = node.textContent?.trim();
          if (!nodeWords) continue;
          const parent = node.parentElement;
          if (!parent?.getClientRects().length) continue;
          let hidden = false;
          for (let at: Element | null = parent; at && at !== root; at = at.parentElement) {
            const style = getComputedStyle(at);
            const r = at.getBoundingClientRect();
            if (style.display === 'none' || style.visibility === 'hidden' || (r.width <= 1 && r.height <= 1))
              hidden = true;
          }
          if (hidden) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          const button = parent.closest('button');
          const room = button?.getBoundingClientRect() ?? edge;
          if (
            r.left < room.left - 0.01 ||
            r.right > room.right + 0.01 ||
            r.top < edge.top - 0.01 ||
            r.bottom > edge.bottom + 0.01
          )
            faults.push(`visible words cut: ${nodeWords}`);
        }
        if (faults.length) {
          const children = [...root.children].filter((el) => el.getBoundingClientRect().width > 0);
          const style = getComputedStyle(root);
          let minimum =
            Number.parseFloat(style.paddingLeft) +
            Number.parseFloat(style.paddingRight) +
            Number.parseFloat(style.columnGap) * (children.length - 1);
          const sizes: string[] = [];
          for (const el of children) {
            const id = el.getAttribute('data-testid');
            let width = el.getBoundingClientRect().width;
            if (id === 'screens-summary' || id === 'sound-status' || id === 'sound-warning') width = 24;
            else if (id === 'today-calendar') {
              const label = el.querySelector('.truncate');
              if (label) {
                const range = document.createRange();
                range.selectNodeContents(label);
                const look = getComputedStyle(el);
                width =
                  range.getBoundingClientRect().width +
                  13 +
                  Number.parseFloat(look.columnGap) +
                  Number.parseFloat(look.paddingLeft) +
                  Number.parseFloat(look.paddingRight);
              }
            } else if (el.getAttribute('aria-live') === 'polite') width = 0;
            minimum += width;
            sizes.push(`${id ?? el.tagName}: ${width.toFixed(2)}`);
          }
          faults.push(
            `minimum width with summary/Sound at their 24 px target minimum (passing news 0): ${minimum.toFixed(2)} / ${root.clientWidth}; ${sizes.join('; ')}`,
          );
        }
        return faults;
      }),
      where,
    )
    .toEqual([]);
}

for (const mode of ['pro', 'simple'] as const)
  for (const size of SIZES)
    test(`MUST-1 ${mode} ${size.width}: mirroring, access countdown, both screens off, Audio muted and disconnected Sound all fit; steady controls never move`, async () => {
      const { app, access } = await launchApp({
        ...QUICK,
        DRASHTI_TEST_AUTO_SCREENS: 'pretend',
        DRASHTI_TEST_MIRRORED_ONTO: 'PLACEHOLDER PJ',
        DRASHTI_TEST_FAKE_DEVICES: '1',
      });
      try {
        const win = await operatorPage(app);
        await operatorReady(win);
        await sizeOperatorWindow(app, win, size);
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
        const snapshot = await win.evaluate(() => (globalThis as PageGlobals).drashti.screens.get());
        const showing: ScreenStatus = { screenId: 'placeholder-1', state: 'showing', displayId: 1 };
        const healthy: ScreenStatus = { screenId: 'placeholder-2', state: 'showing', displayId: 2 };
        await tell(app, IPC.screens.changed, { ...snapshot, status: [showing, healthy] });
        const before = await settledSteady(win);
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
          const soundWords = missing
            ? 'Sound output "Placeholder Mixer" not connected'
            : 'Sound: System default';
          await expect(sound).toHaveAccessibleName(soundWords);
          expect
            .soft(await sound.getAttribute('title'))
            .toMatch(new RegExp(missing ? 'Placeholder Mixer.*not connected' : 'Sound: System default'));
          for (const [audience, stage] of [
            [false, false],
            [true, false],
            [false, true],
            [true, true],
          ] as const) {
            await tell(app, IPC.screenSwitches.changed, { audience, stage });
            await expect(win.getByTestId('switch-off-audience')).toHaveCount(audience ? 0 : 1);
            await expect(win.getByTestId('switch-off-stage')).toHaveCount(stage ? 0 : 1);
            for (const muted of [true, false]) {
              await win.evaluate(
                (muted) => (globalThis as PageGlobals).drashti.sound.setMuted('audio', muted),
                muted,
              );
              await expect(win.getByTestId('sound-muted-status')).toHaveText(muted ? 'Audio muted' : '');
              const faults: ScreenStatus[] = [
                healthy,
                { ...healthy, state: 'missing-display' },
                { ...healthy, state: 'stopped' },
                { ...healthy, restarts: 4 },
              ];
              for (const fault of faults) {
                await tell(app, IPC.screens.changed, { ...snapshot, status: [showing, fault] });
                const words = fault.restarts
                  ? '1 keeps restarting'
                  : fault.state === 'stopped'
                    ? '1 stopped'
                    : fault.state === 'missing-display'
                      ? '1 display not connected'
                      : '2 screens showing';
                await expect(win.getByTestId('screens-summary')).toContainText(words);
                if (fault.state === 'stopped') await dismissStoppedNotice(win, before);
                const where = `${mode} ${size.width}, missing ${missing}, muted ${muted}, Audience ${audience}, Stage ${stage}, ${words}`;
                expect.soft(await steady(win), where).toEqual(before);
                await fits(win, where);
              }
            }
          }
        }
      } finally {
        await app.close();
      }
    });

for (const mode of ['pro', 'simple'] as const)
  test(`MUST-2 ${mode}: missing, stopped and restarting screens hold steady, including calendar, mirroring and all warnings`, async () => {
    const { app, userData } = await launchApp();
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      await sizeOperatorWindow(app, win, CI_WINDOW);
      const beforeCalendar = await settledSteady(win);
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
      const calendar = win.getByTestId('today-calendar');
      await expect(calendar).toBeVisible();
      const calendarWords = 'Samvat 1001, Month Half Day';
      await expect.soft(calendar).toHaveAccessibleName(calendarWords);
      expect.soft(await calendar.getAttribute('title')).toContain(calendarWords);
      expect.soft(await calendar.evaluate((el) => el.getBoundingClientRect().width)).toBe(24);
      // The compact calendar's place exists before its date arrives, so Help and the show controls stay put.
      expect
        .soft((await steady(win)).filter((line) => !line.startsWith('[data-testid="today-calendar"]')))
        .toEqual(beforeCalendar);
      await ring(win, calendar, `${mode}: compact calendar edge and keyboard ring`);
      if (mode === 'simple')
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
      const snapshot = await win.evaluate(() => (globalThis as PageGlobals).drashti.screens.get());
      const showing: ScreenStatus[] = [1, 2].map((n) => ({
        screenId: `placeholder-${n}`,
        state: 'showing',
        displayId: n,
      }));
      for (const size of SIZES) {
        await sizeOperatorWindow(app, win, size);
        await tell(app, IPC.screens.changed, { ...snapshot, status: showing });
        await expect(win.getByTestId('screens-summary')).toHaveAccessibleName('2 screens showing');
        const before = await settledSteady(win);
        const faults: ScreenStatus[] = [
          { screenId: 'placeholder-2', state: 'missing-display', displayId: 2 },
          { screenId: 'placeholder-2', state: 'stopped', displayId: 2 },
          { screenId: 'placeholder-2', state: 'showing', displayId: 2, restarts: 4 },
        ];
        for (const fault of faults) {
          await tell(app, IPC.screens.changed, {
            ...snapshot,
            status: [{ screenId: 'placeholder-1', state: 'showing', displayId: 1 }, fault],
          });
          const words = fault.restarts
            ? 'keeps restarting'
            : fault.state === 'stopped'
              ? 'stopped'
              : 'display not connected';
          await expect(win.getByTestId('screens-summary')).toContainText(words);
          await expect(win.getByTestId('screens-summary')).toHaveAccessibleName(new RegExp(words));
          expect
            .soft(await win.getByTestId('screens-summary').getAttribute('title'))
            .toMatch(new RegExp(words));
          // The separate, existing top-of-window stopped-screen notice is outside this footer regression.
          // Close it as an operator may, leaving the stopped state and every position/fit assertion intact.
          if (fault.state === 'stopped') await dismissStoppedNotice(win, before);
          const where = `${mode} ${size.width}, ${words}`;
          expect.soft(await steady(win), where).toEqual(before);
          await fits(win, where);
        }
        await tell(app, IPC.screenSwitches.changed, { audience: false, stage: false });
        await win.evaluate(() => (globalThis as PageGlobals).drashti.sound.setMuted('audio', true));
        await expect(win.getByTestId('sound-muted-status')).toHaveText('Audio muted');
        await tell(app, IPC.audio.status, {
          chosen: { id: 'placeholder-mixer', label: 'Placeholder Mixer' },
          devices: [],
          state: 'missing',
          checked: true,
        });
        await expect(win.getByTestId('sound-warning')).toBeVisible();
        expect.soft(await steady(win), `${mode} ${size.width}, calendar and all warnings`).toEqual(before);
        await fits(win, `${mode} ${size.width}, calendar and all warnings`);
        await tell(app, IPC.screens.said, {
          id: 11000 + size.width,
          kind: 'mirroring',
          displayIds: [],
          text: 'The computer screen is mirrored onto PLACEHOLDER PJ. Extend the displays to show a separate audience picture.',
        });
        await expect(win.getByTestId('screens-said')).toHaveAttribute('data-kind', 'mirroring');
        expect
          .soft(await steady(win), `${mode} ${size.width}, calendar, mirroring and all warnings`)
          .toEqual(before);
        await fits(win, `${mode} ${size.width}, calendar, mirroring and all warnings`);
        await win.getByTestId('screens-said').getByRole('button', { name: 'Dismiss' }).click();
        await expect(win.getByTestId('screens-said')).toHaveCount(0);
        await tell(app, IPC.screenSwitches.changed, { audience: true, stage: true });
        await win.evaluate(() => (globalThis as PageGlobals).drashti.sound.setMuted('audio', false));
        await tell(app, IPC.audio.status, { chosen: null, devices: [], state: 'default', checked: true });
        await expect(win.getByTestId('sound-status')).toBeVisible();
        await tell(app, IPC.screens.changed, { ...snapshot, status: showing });
        await expect(win.getByTestId('screens-summary')).toHaveAccessibleName('2 screens showing');
        expect.soft(await steady(win)).toEqual(before);
      }
    } finally {
      await app.close();
    }
  });

/** Production calendar import: fixtures are placeholder words only, including the schema's longest valid festivals. */
async function loadStatusCalendar(win: Page, userData: string, day: CalendarDay, tag: string) {
  const file = join(userData, `placeholder-status-${tag}.json`);
  writeFileSync(
    file,
    JSON.stringify({
      format: 'drashti-calendar',
      version: 1,
      name: 'Placeholder status calendar',
      days: [day],
    }),
  );
  await win.evaluate((file) => (globalThis as PageGlobals).drashti.library.importPaths([file]), file);
  const result = win.getByTestId('import-result');
  await expect(result).toBeVisible();
  await result.getByRole('button', { name: 'Dismiss' }).click();
  await expect(result).toHaveCount(0);
}

const statusDay = (): CalendarDay => {
  const now = new Date();
  return {
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    samvat: 1001,
    month: { en: 'Month' },
    paksha: { en: 'Half' },
    tithi: { en: 'Day' },
    festivals: [],
  };
};

for (const mode of ['pro', 'simple'] as const)
  test(`MUST-1 continued ${mode}: loaded calendar, mirroring, access room, both screens off and disconnected Sound fit with every two-kind silence state`, async () => {
    const { app, userData } = await launchApp({
      DRASHTI_TEST_AUTO_SCREENS: 'pretend',
      DRASHTI_TEST_MIRRORED_ONTO: 'PLACEHOLDER PJ',
    });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      await sizeOperatorWindow(app, win, CI_WINDOW);
      await expect(win.getByTestId('screens-said')).toHaveAttribute('data-kind', 'mirroring');
      await loadStatusCalendar(win, userData, statusDay(), 'silence');
      await expect(win.getByTestId('today-calendar')).toBeVisible();
      await win.evaluate(async () => {
        const d = (globalThis as PageGlobals).drashti;
        for (const which of ['audience', 'stage'] as const) {
          const result = await d.screenSwitches.turn(which, false);
          if (!result.ok) throw new Error(result.message);
        }
        await d.audio.setOutput({ id: 'placeholder-mixer', label: 'Placeholder Mixer' });
      });
      await expect(win.getByTestId('sound-warning')).toBeVisible();
      if (mode === 'simple')
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
      const before = await settledSteady(win);
      const cases: SoundLevels[] = [
        { audio: { level: 1, muted: true }, video: { level: 1, muted: true } },
        { audio: { level: 1, muted: true }, video: { level: 0, muted: false } },
        { audio: { level: 0, muted: false }, video: { level: 1, muted: true } },
        { audio: { level: 0, muted: false }, video: { level: 0, muted: false } },
        { audio: { level: 1, muted: false }, video: { level: 1, muted: false } },
      ];
      for (const levels of cases) {
        await win.evaluate(async (levels) => {
          const sound = (globalThis as PageGlobals).drashti.sound;
          for (const kind of ['audio', 'video'] as const) {
            await sound.setLevel(kind, levels[kind].level);
            await sound.setMuted(kind, levels[kind].muted);
          }
        }, levels);
        const words = silentWords(levels);
        await expect(win.getByTestId('sound-muted-status')).toHaveText(words);
        expect.soft(await steady(win), `${mode}: ${words}`).toEqual(before);
        await fits(win, `${mode}: ${words}`);
      }
    } finally {
      await app.close();
    }
  });

for (const mode of ['pro', 'simple'] as const)
  for (const size of [
    { width: 1535, height: 900 },
    { width: 1536, height: 900 },
    { width: 1600, height: 900 },
  ])
    test(`MUST-4 ${mode} ${size.width}: calendar loading, removal and changed date/festival words never move Help or following controls; long words use a 24 px fallback`, async () => {
      const { app, userData } = await launchApp({
        DRASHTI_TEST_AUTO_SCREENS: 'pretend',
        DRASHTI_TEST_MIRRORED_ONTO: 'PLACEHOLDER PJ',
      });
      try {
        const win = await operatorPage(app);
        await operatorReady(win);
        await sizeOperatorWindow(app, win, size);
        await expect(win.getByTestId('screens-said')).toHaveAttribute('data-kind', 'mirroring');
        await win.evaluate(async () => {
          const d = (globalThis as PageGlobals).drashti;
          for (const which of ['audience', 'stage'] as const) {
            const result = await d.screenSwitches.turn(which, false);
            if (!result.ok) throw new Error(result.message);
          }
          await d.audio.setOutput({ id: 'placeholder-mixer', label: 'Placeholder Mixer' });
          await d.sound.setMuted('audio', true);
          await d.sound.setMuted('video', true);
        });
        await expect(win.getByTestId('sound-warning')).toBeVisible();
        await expect(win.getByTestId('sound-muted-status')).toHaveText('Audio and Video muted');
        if (mode === 'simple')
          await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
        const neighbours = async () =>
          (await steady(win)).filter((line) => !line.startsWith('[data-testid="today-calendar"]'));
        const afterHelp = () =>
          bar(win)
            .locator('button')
            .evaluateAll((buttons) => {
              const help = buttons.findIndex((b) => b.getAttribute('data-testid') === 'help-toggle');
              return buttons.slice(help).map((b) => {
                const r = b.getBoundingClientRect();
                return `${b.getAttribute('data-testid') ?? b.textContent}: ${r.x.toFixed(2)},${r.y.toFixed(2)} ${r.width.toFixed(2)}×${r.height.toFixed(2)}`;
              });
            });
        const before = (await settledSteady(win)).filter(
          (line) => !line.startsWith('[data-testid="today-calendar"]'),
        );
        const controls = await afterHelp();
        for (const [index, day] of [
          statusDay(),
          {
            ...statusDay(),
            samvat: 1002,
            tithi: { en: 'Another placeholder day' },
            festivals: Array.from({ length: 12 }, (_, i) => ({
              en: `Placeholder ${i} ${'long '.repeat(21)}`.trim(),
            })),
          },
        ].entries()) {
          // Imports are a Pro action; put Simple back before measuring its footer.
          if (mode === 'simple')
            await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
          await loadStatusCalendar(win, userData, day, `wide-${index}`);
          if (mode === 'simple')
            await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
          const words = `${samvatLine(day, 'en')}${festivalsLine(day, 'en') ? ` · ${festivalsLine(day, 'en')}` : ''}`;
          const calendar = win.getByTestId('today-calendar');
          await expect(calendar).toHaveAccessibleName(words);
          expect.soft(await calendar.getAttribute('title')).toContain(words);
          expect.soft(await neighbours()).toEqual(before);
          expect.soft(await afterHelp()).toEqual(controls);
          if (index === 1 || size.width < 1536)
            expect.soft(await calendar.evaluate((el) => el.getBoundingClientRect().width)).toBe(24);
          if (index === 0 && size.width === 1600)
            expect
              .soft(await calendar.evaluate((el) => el.getBoundingClientRect().width))
              .toBeGreaterThan(24);
          await fits(win, `${mode} ${size.width}: calendar ${index}`);
        }
        if (mode === 'simple')
          await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
        await win.evaluate(async () => {
          const d = (globalThis as PageGlobals).drashti;
          for (const calendar of (await d.calendar.view()).calendars) {
            const result = await d.calendar.remove(calendar.id);
            if (!result.ok) throw new Error(result.message);
          }
        });
        await expect(win.getByTestId('today-calendar')).toHaveCount(0);
        if (mode === 'simple')
          await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
        expect.soft(await neighbours()).toEqual(before);
        expect.soft(await afterHelp()).toEqual(controls);
        await fits(win, `${mode} ${size.width}: calendar removed`);
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

for (const mode of ['pro', 'simple'] as const)
  test(`MUST-3 ${mode}: import Cancel/Dismiss, MP4 Stop/Show/Dismiss and conversion Stop are exactly 24 px with their edge and keyboard ring whole`, async () => {
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
      if (mode === 'simple') {
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
        await expect(win.getByTestId('simple-mode')).toBeVisible();
      }
      for (const size of SIZES) {
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
