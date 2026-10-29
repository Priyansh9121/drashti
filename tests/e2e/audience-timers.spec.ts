import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import {
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputPages,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Timers for the audience (Session 55, Part 15): a timer in its own look on the hall's screens (full screen or in a
 * corner, over the wallpaper or over what is up, a label above it, a ring or a bar of the time left, a warning colour
 * and a flash near the end, and at zero: it stays, shows a message, shows the wallpaper or goes by itself), started,
 * paused, reset, shown and hidden from Timers, the Stage screen panel and a phone; and Countdown to the start, the
 * sabha's time counted down over the wallpaper on the audience and the stage, gone by itself at zero. Placeholder
 * words only.
 */

const SCREENS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };

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
  return found;
}

const makeStage = (win: Page, name: string) =>
  win.evaluate(async (name) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.name === name);
    if (!group) throw new Error(`no group ${name}`);
    const set = await d.screens.setGroupRole(group.id, 'stage');
    if (!set.ok) throw new Error(set.message);
  }, name);

const state = async (win: Page) =>
  (await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).state;

/** A countdown in Timers, through its form: its id. */
async function newCountdown(win: Page, name: string, length: string): Promise<string> {
  const timers = win.getByTestId('timers');
  await timers.getByRole('button', { name: 'New timer' }).click();
  const form = timers.getByTestId('timer-form');
  await form.getByRole('textbox', { name: 'Timer name' }).fill(name);
  await form.getByRole('textbox', { name: 'Length' }).fill(length);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await state(win)).timers.find((t) => t.name === name)?.id).toBeTruthy();
  return (await state(win)).timers.find((t) => t.name === name)?.id ?? '';
}

test('a timer for the audience in its own look: a corner over what is up, its label, ring and warning, at zero its message; Show, Pause, Reset and Hide from Timers and the Stage screen panel', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(SCREENS);
  const win = await operatorPage(app);
  await operatorReady(win);
  const hallId = await setUpScreen(win, 'Main Hall', 0);
  const stageId = await setUpScreen(win, 'Stage one', 1);
  await makeStage(win, 'Stage one');
  const hall = await outputFor(app, hallId);
  const stage = await outputFor(app, stageId);
  const id = await newCountdown(win, 'Placeholder activity', '0:06');
  const timers = win.getByTestId('timers');
  const row = timers.getByTestId('timer-row').filter({ hasText: 'Placeholder activity' });

  // Its look for the audience, beside a small picture of it.
  await row.getByRole('button', { name: 'How it looks for the audience…' }).click();
  const look = win.getByTestId('timer-look');
  await look.getByRole('combobox', { name: 'Where' }).selectOption({ label: 'Top right corner' });
  await look.getByRole('combobox', { name: 'Behind it' }).selectOption({ label: 'Over what is up' });
  await look.getByRole('textbox', { name: 'Label above it' }).fill('Placeholder: activity ends in');
  await look.getByRole('combobox', { name: 'Time left' }).selectOption({ label: 'A ring' });
  await look.getByRole('combobox', { name: 'At zero' }).selectOption({ label: 'It shows a message' });
  await look.getByRole('textbox', { name: 'Message at zero' }).fill('Placeholder: time is up');
  await look.getByRole('checkbox', { name: 'Flash near the end' }).check();
  await look.getByRole('checkbox', { name: 'On the stage screens too' }).check();
  await expect(look.getByTestId('timer-look-preview').locator('[data-layer="timer"]')).toHaveAttribute(
    'data-place',
    'top-right',
  );
  await expectNoSeriousA11yIssues(win, 'a timer’s look for the audience', '[data-testid="timer-look"]');
  await look.getByRole('button', { name: 'Save' }).click();
  await expect(look).toHaveCount(0);
  expect((await state(win)).timers.find((t) => t.id === id)?.look).toMatchObject({
    place: 'top-right',
    over: 'content',
    label: 'Placeholder: activity ends in',
    timeLeft: 'ring',
    atZero: 'message',
    zeroText: 'Placeholder: time is up',
    flash: true,
    stage: true,
  });

  // Shown from Timers: in the top right corner of the hall's screens, its label over the time, with its ring.
  await row.getByRole('button', { name: 'Show for the audience' }).click();
  const onHall = hall.locator('[data-layer="timer"]');
  await expect(onHall).toHaveAttribute('data-place', 'top-right');
  await expect(onHall).toHaveAttribute('data-over', 'content');
  await expect(onHall.getByTestId('audience-timer-label')).toHaveText('Placeholder: activity ends in');
  await expect(onHall.getByTestId('audience-timer-time')).toHaveText('0:06');
  await expect(onHall.locator('[data-time-left="ring"]')).toHaveCount(1);
  // On the stage screens too, as its look says.
  await expect(stage.locator('[data-layer="timer"]')).toHaveCount(1);

  // Start, Pause and Reset from the Stage screen panel's timer for the audience.
  const panel = win.getByTestId('stage-message-control');
  const forAudience = panel.getByTestId('stage-audience-timer');
  await expect(forAudience.getByRole('combobox', { name: 'Timer for the audience' })).toHaveValue(id);
  await forAudience.getByRole('button', { name: 'Start' }).click();
  await expect(onHall.getByTestId('audience-timer-time')).toHaveText(/^0:0[0-5]$/);
  await forAudience.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => (await state(win)).timers.find((t) => t.id === id)?.startedAt).toBeNull();
  await forAudience.getByRole('button', { name: 'Reset' }).click();
  await expect(onHall.getByTestId('audience-timer-time')).toHaveText('0:06');
  // Started again from Timers: its warning colour near the end, then at zero its message in its place.
  await row.getByRole('button', { name: 'Start' }).click();
  await expect(onHall).toHaveAttribute('data-warn', 'true', { timeout: 10_000 });
  await expect(onHall).toHaveAttribute('data-shows', 'message', { timeout: 10_000 });
  await expect(onHall).toContainText('Placeholder: time is up');
  // Hidden from the Stage screen panel: it fades out, then it is gone.
  await forAudience.getByRole('button', { name: 'Hide' }).click();
  await expect(onHall).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Show for the audience' })).toBeVisible();
  await app.close();
});

test('Countdown to the start: the sabha’s time, counted down over the wallpaper on the audience and the stage; a timer that goes by itself at zero goes', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(SCREENS);
  const win = await operatorPage(app);
  await operatorReady(win);
  const hallId = await setUpScreen(win, 'Main Hall', 0);
  const stageId = await setUpScreen(win, 'Stage one', 1);
  await makeStage(win, 'Stage one');
  const hall = await outputFor(app, hallId);
  const stage = await outputFor(app, stageId);
  // Something up on the hall: the countdown goes over the wallpaper, covering it.
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'setBackground',
      background: { kind: 'color', color: '#1f3a5f' },
    }),
  );
  const timers = win.getByTestId('timers');
  await timers.getByRole('button', { name: 'Countdown to the start…' }).click();
  const start = timers.getByTestId('start-countdown');
  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  // A time already come today is refused, with the reason (it would go at once).
  const earlier = new Date(Date.now() - 60_000);
  if (earlier.getDate() === new Date().getDate()) {
    await start.getByLabel('The sabha’s time').fill(hhmm(earlier));
    await start.getByRole('button', { name: 'Show the countdown' }).click();
    await expect(start.getByRole('alert')).toContainText('already come today');
  }
  // Two hours ahead (or the day's last minute, late in the evening).
  const later = new Date(Date.now() + 2 * 3600_000);
  const time = later.getDate() === new Date().getDate() ? hhmm(later) : '23:59';
  await start.getByLabel('The sabha’s time').fill(time);
  await start.getByRole('button', { name: 'Show the countdown' }).click();
  const onHall = hall.locator('[data-layer="timer"]');
  await expect(onHall).toHaveAttribute('data-over', 'wallpaper');
  await expect(onHall).toHaveAttribute('data-place', 'full');
  await expect(onHall.getByTestId('audience-timer-label')).toHaveText('The sabha starts in');
  await expect(onHall.getByTestId('audience-timer-time')).toHaveText(/^\d{1,2}:\d\d(:\d\d)?$/);
  await expect(onHall.locator('[data-time-left="ring"]')).toHaveCount(1);
  await expect(onHall.locator('[data-wallpaper-backdrop]')).toHaveCount(1);
  await expect(stage.locator('[data-layer="timer"]')).toHaveAttribute('data-over', 'wallpaper');
  const q = (await state(win)).timers.find((t) => t.name === 'Countdown to the start');
  expect(q).toMatchObject({
    kind: 'countdown_to_time',
    targetTime: time,
    look: { atZero: 'gone', stage: true },
  });
  // Opened again while it is up: Hide takes it off.
  await timers.getByRole('button', { name: 'Countdown to the start…' }).click();
  await start.getByRole('button', { name: 'Hide the countdown' }).click();
  await expect(onHall).toHaveCount(0);
  // A countdown whose look goes by itself at zero: taken off by the engine then, on every screen.
  const id = await newCountdown(win, 'Placeholder gone at zero', '0:03');
  await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const t = (await d.engine.snapshot()).state.timers.find((x) => x.id === id);
    if (!t) throw new Error('no timer');
    const saved = await d.timers.update(id, {
      name: t.name,
      kind: t.kind,
      durationMs: t.durationMs,
      targetTime: t.targetTime,
      allowsOverrun: t.allowsOverrun,
      look: {
        place: 'full',
        over: 'wallpaper',
        size: 0,
        font: 'Noto Sans',
        color: '#ffffff',
        labelColor: '#d6dae3',
        label: '',
        format: 'auto',
        timeLeft: 'bar',
        timeLeftColor: '#f5a524',
        warn: null,
        flash: false,
        atZero: 'gone',
        zeroText: '',
        stage: true,
      },
    });
    if (!saved.ok) throw new Error(saved.message);
    await d.engine.dispatch({ type: 'startTimer', timerId: id });
    await d.engine.dispatch({ type: 'showAudienceTimer', timerId: id });
  }, id);
  await expect(onHall.locator('[data-time-left="bar"]')).toHaveCount(1);
  await expect(stage.locator('[data-layer="timer"]')).toHaveCount(1);
  await expect(onHall).toHaveCount(0, { timeout: 10_000 });
  await expect(stage.locator('[data-layer="timer"]')).toHaveCount(0);
  expect((await state(win)).layers.timer ?? null).toBeNull();
  // The background up under it shows again.
  await expect(hall.locator('[data-layer="background"]')).toHaveCSS('background-color', 'rgb(31, 58, 95)');
  await app.close();
});

test('a phone shows and hides a timer for the audience, and starts and pauses it', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', ...NETWORK_ENV });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win);
  const hall = await outputPage(app);
  const id = await newCountdown(win, 'Placeholder phone timer', '5:00');
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  try {
    const p = phone.page;
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await p.getByTestId('remote-tab-more').click();
    const timer = p.getByTestId('remote-timer').filter({ hasText: 'Placeholder phone timer' });
    await timer.getByRole('button', { name: 'Start' }).click();
    await timer.getByTestId('remote-timer-show').click();
    await expect.poll(async () => (await state(win)).layers.timer?.timerId).toBe(id);
    await expect(hall.locator('[data-layer="timer"]')).toHaveCount(1);
    await expect(timer.getByTestId('remote-timer-show')).toHaveText('Hide');
    await timer.getByRole('button', { name: 'Pause' }).click();
    await expect.poll(async () => (await state(win)).timers.find((t) => t.id === id)?.startedAt).toBeNull();
    await timer.getByTestId('remote-timer-show').click();
    await expect(hall.locator('[data-layer="timer"]')).toHaveCount(0);
    await expectNoSeriousA11yIssues(p, 'the phone’s timers for the audience');
  } finally {
    await phone.close();
  }
  await app.close();
});

test('the Timers panel and a timer’s look fit CI’s operator window and 1280 × 720', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await newCountdown(win, 'Placeholder fit', '5:00');
  for (const size of [CI_WINDOW, { width: 1280, height: 720 }]) {
    await sizeOperatorWindow(app, win, size);
    const row = win.getByTestId('timer-row').filter({ hasText: 'Placeholder fit' });
    await row.scrollIntoViewIfNeeded();
    const sticks = await row.evaluate((r) => {
      const frame = r.getBoundingClientRect();
      return [...r.querySelectorAll('button')]
        .filter((b) => {
          const x = b.getBoundingClientRect();
          return x.right > frame.right + 1 || x.left < frame.left - 1;
        })
        .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    });
    expect(sticks, `the timer's row at ${String(size.width)}`).toEqual([]);
    await row.getByRole('button', { name: 'How it looks for the audience…' }).click();
    const look = win.getByTestId('timer-look');
    const fits = await look.evaluate((d) => {
      const r = d.getBoundingClientRect();
      return (
        r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.top >= -1
      );
    });
    expect(fits, `the look at ${String(size.width)}`).toBe(true);
    await look.getByRole('button', { name: 'Cancel' }).click();
  }
  await app.close();
});
