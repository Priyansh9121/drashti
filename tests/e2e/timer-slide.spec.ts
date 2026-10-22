import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import {
  holdStill,
  launchApp,
  openLibrary,
  operatorPage,
  outputPage,
  outputReady,
  setUpScreen,
} from './helpers';
import { makeSlides } from './placeholder-slides';

/*
 * A timer alone on the screens (Session 50). Show on the screens, in Pro Mode's Timers panel, puts a timer up
 * alone in the slide's place over whatever background is up, counting on a hall screen; Clear slide takes it
 * off, and Next goes on from where the show was. New Timer Slide… in a presentation's slide menu adds a slide
 * with a Timer on it, which shows the time live; a countdown on it holds at 0:00, or, when it says so, the next
 * slide comes on at zero. The slide editor's Timer, styled as words, keeps its last minute and its zero.
 * Placeholder timers and words only; quiet; no display wider than 1024 is assumed.
 */

const snapshot = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** The library's presentations, by name. */
const presentations = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.library.listPresentations()).map((p) => p.name).sort(),
  );

/** A countdown in the library, made through the bridge; its id. */
const makeCountdown = (win: Page, name: string, durationMs: number) =>
  win.evaluate(
    async ({ name, durationMs }) => {
      const made = await (globalThis as PageGlobals).drashti.timers.create({
        name,
        kind: 'countdown',
        durationMs,
        targetTime: null,
        allowsOverrun: false,
      });
      if (!made.ok) throw new Error(made.message);
      return made.id;
    },
    { name, durationMs },
  );

/** The Timer on the slide a hall screen shows, and the time it shows. */
const timerOn = (output: Page): Locator => output.locator('[data-layer="slide"] [data-timer-element]');
const timeOn = (output: Page) => timerOn(output).first().getAttribute('data-time');

test('Show on the screens puts a timer up alone, counting; Clear slide takes it off; Next goes on as before', async () => {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  const id = await makeSlides(
    win,
    'Placeholder Timer Show',
    [{ words: 'Placeholder one' }, { words: 'Placeholder two' }, { words: 'Placeholder three' }],
    { kind: 'cut', durationMs: 0 },
  );
  await makeCountdown(win, 'Placeholder starts in', 5 * 60_000);
  await setUpScreen(win, 'Main Hall', 0);
  const output = await outputPage(app);
  await outputReady(output);

  // A slide and a background up; the countdown started.
  await win.evaluate(async (presentationId) => {
    const d = (globalThis as PageGlobals).drashti;
    await d.engine.dispatch({ type: 'goLive', presentationId, slideIndex: 0 });
    await d.engine.dispatch({ type: 'setBackground', background: { kind: 'color', color: '#204060' } });
  }, id);
  const row = win.getByTestId('timers').getByTestId('timer-row').filter({ hasText: 'Placeholder starts in' });
  await row.getByRole('button', { name: 'Start' }).click();
  const library = await presentations(win);

  // Show on the screens: the timer alone in the slide's place, over the background, counting down.
  await row.getByRole('button', { name: 'Show on the screens' }).click();
  await expect(timerOn(output)).toHaveCount(1);
  await expect(output.locator('[data-layer="slide"]')).not.toContainText('Placeholder one');
  await expect(output.locator('[data-layer="background"]')).toHaveCount(1);
  await expect.poll(() => timeOn(output)).toMatch(/^4:5\d$/);
  const first = await timeOn(output);
  await expect.poll(() => timeOn(output), { timeout: 5000 }).not.toBe(first);
  // LIVE names it; the show is where it was, and no presentation was made for it.
  await expect(win.getByTestId('live-timer')).toContainText('Placeholder starts in');
  const up = await snapshot(win);
  expect(up.layers.slide?.presentationId).toMatch(/^timer:/);
  expect(up.layers.slide?.timer?.name).toBe('Placeholder starts in');
  expect(up.live).toMatchObject({ presentationId: id, slideIndex: 0 });
  expect(await presentations(win)).toEqual(library);

  // Taken off: pressed again (as Clear slide does), the hall screen shows no slide.
  await row.getByRole('button', { name: 'Take off the screens' }).click();
  await expect(timerOn(output)).toHaveCount(0);
  expect((await snapshot(win)).layers.slide).toBeNull();

  // Up again, then Next: the show goes on from where it was, the presentation's next slide.
  await row.getByRole('button', { name: 'Show on the screens' }).click();
  await expect(timerOn(output)).toHaveCount(1);
  await win.getByTestId('show-next').click();
  await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder two');
  await expect(timerOn(output)).toHaveCount(0);
  expect((await snapshot(win)).live).toMatchObject({ presentationId: id, slideIndex: 1 });

  // Clear all takes it off too.
  await row.getByRole('button', { name: 'Show on the screens' }).click();
  await expect(timerOn(output)).toHaveCount(1);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearAll' }));
  await expect(timerOn(output)).toHaveCount(0);

  await app.close();
});

test('New Timer Slide… adds a slide whose Timer shows the time live; at zero it holds, or the next slide comes on', async () => {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  const id = await makeSlides(
    win,
    'Placeholder Countdown Slides',
    [{ words: 'Placeholder welcome' }, { words: 'Placeholder after the countdown' }],
    { kind: 'cut', durationMs: 0 },
  );
  await makeCountdown(win, 'Placeholder short countdown', 3000);
  await setUpScreen(win, 'Main Hall', 0);
  const output = await outputPage(app);
  await outputReady(output);

  // New Timer Slide… from the first slide's menu: Timer only, after it.
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Countdown Slides/ })
    .click();
  const thumbs = win.getByTestId('slide-grid').getByTestId('slide-thumb');
  await expect(thumbs).toHaveCount(2);
  await thumbs.first().click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'New Timer Slide…' }).click();
  const dialog = win.getByTestId('new-timer-slide');
  await expect(dialog.getByTestId('new-timer-slide-timer')).toBeVisible();
  await dialog
    .getByTestId('new-timer-slide-timer')
    .selectOption({ label: 'Placeholder short countdown (Countdown)' });
  await dialog.getByRole('radio', { name: 'Timer only' }).click();
  await dialog.getByTestId('new-timer-slide-add').click();
  await expect(dialog).toHaveCount(0);
  await expect(thumbs).toHaveCount(3);
  await expect(thumbs.nth(1).locator('[data-timer-element]')).toHaveCount(1);

  // Put up, the slide's Timer shows the time; started, it counts down to 0:00 and holds there.
  await thumbs.nth(1).click();
  await expect(timerOn(output)).toHaveCount(1);
  await expect.poll(() => timeOn(output)).toBe('0:03');
  const row = win
    .getByTestId('timers')
    .getByTestId('timer-row')
    .filter({ hasText: 'Placeholder short countdown' });
  await row.getByRole('button', { name: 'Start' }).click();
  await expect.poll(() => timeOn(output), { timeout: 10_000 }).toBe('0:00');
  await holdStill(
    async () => (await snapshot(win)).live.slideIndex === 1,
    1500,
    'at zero, by default, the countdown holds and its slide stays up',
  );

  // Its slide made to go on at zero (as the inspector's At zero does), and the countdown from the start again.
  await win.evaluate(async (presentationId) => {
    const d = (globalThis as PageGlobals).drashti;
    const opened = await d.library.slidesForEdit(presentationId);
    if (!opened.ok) throw new Error(opened.message);
    for (const g of opened.doc.groups)
      for (const s of g.slides)
        s.elements = s.elements.map((e) => (e.kind === 'timer' ? { ...e, atZero: 'next' as const } : e));
    const saved = await d.library.saveSlides(presentationId, opened.doc, opened.stamp);
    if (!saved.ok) throw new Error(saved.message);
  }, id);
  await row.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(() => timeOn(output)).toBe('0:03');
  await row.getByRole('button', { name: 'Start' }).click();
  // At zero the next slide comes on, as Next would.
  await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder after the countdown', {
    timeout: 10_000,
  });
  expect((await snapshot(win)).live).toMatchObject({ presentationId: id, slideIndex: 2 });

  await app.close();
});

test('the slide editor puts a Timer on a slide, styled as words, with its last minute and its zero', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const id = await makeSlides(win, 'Placeholder Editor Timer', [{ words: 'Placeholder words' }], {
    kind: 'cut',
    durationMs: 0,
  });
  await makeCountdown(win, 'Placeholder editor countdown', 90_000);
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Editor Timer/ })
    .click();
  await win.getByTestId('edit-slides').click();
  const editor = win.getByTestId('slide-editor');

  // Timer, then the timer: on the slide, its time live, and chosen for the inspector.
  await editor.getByTestId('add-timer').click();
  await win.getByRole('menuitem', { name: 'Placeholder editor countdown (Countdown)' }).click();
  await expect(editor.getByTestId('editor-slide').locator('[data-timer-element]')).toHaveAttribute(
    'data-time',
    '1:30',
  );
  const section = editor.getByTestId('inspector-timer');
  await expect(section.getByTestId('field-timer')).toHaveValue(/.+/);
  await section.getByTestId('field-timer-size').fill('180');
  await section.getByTestId('field-last-minute').click();
  await section.getByTestId('field-at-zero').selectOption('next');
  await editor.getByTestId('save-slides').click();
  await expect(editor).toHaveCount(0);

  const timers = await win.evaluate(async (pid) => {
    const doc = await (globalThis as PageGlobals).drashti.library.getPresentation(pid);
    return doc?.groups.flatMap((g) =>
      g.slides.flatMap((s) => s.slide.elements.filter((e) => e.kind === 'timer')),
    );
  }, id);
  expect(timers).toMatchObject([
    { kind: 'timer', style: { fontSize: 180 }, lastMinute: { color: '#f5a524' }, atZero: 'next' },
  ]);

  await app.close();
});
