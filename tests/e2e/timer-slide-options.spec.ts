import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import {
  editorGroup,
  launchApp,
  openLibrary,
  operatorPage,
  outputPage,
  outputReady,
  setUpScreen,
  sizeSlideEditor,
  slideEditorClosed,
  slideEditorWindow,
} from './helpers';
import { makeSlides } from './placeholder-slides';
import { CI_WINDOW } from './window-size';

/*
 * A timer on a slide, in Edit slides (Session 55, Part 15): its time changed there (a countdown's length, or the
 * time a countdown to a time counts to, the library's timer itself), its kind, its format, a warning colour from a
 * time left, and what it does at zero (it holds, the next slide comes on, it shows a message, or it goes); the screens
 * draw it so. Placeholder timers and words only.
 */

const snapshot = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

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

test('Edit slides changes a slide timer’s time, kind, format, warning and what it does at zero; the screens show its message at zero', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  const id = await makeSlides(win, 'Placeholder Timer Options', [{ words: 'Placeholder words' }], {
    kind: 'cut',
    durationMs: 0,
  });
  const timerId = await makeCountdown(win, 'Placeholder options countdown', 90_000);
  await setUpScreen(win, 'Main Hall', 0);
  const output = await outputPage(app);
  await outputReady(output);
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Timer Options/ })
    .click();
  await win.getByTestId('edit-slides').click();
  // The editor's own window (Session 55, Part 17a); a Timer from its Insert group.
  const first = await slideEditorWindow(app);
  const editor = first.editor;
  await editorGroup(first.ed, 'Insert');
  await editor.getByTestId('add-timer').click();
  await first.ed.getByRole('menuitem', { name: 'Placeholder options countdown (Countdown)' }).click();
  const section = editor.getByTestId('inspector-timer');
  // Laid out at CI's operator window and at 1280 × 720: nothing in the Timer's section sticks out sideways.
  for (const size of [CI_WINDOW, { width: 1280, height: 720 }]) {
    await sizeSlideEditor(app, first.ed, size);
    await section.scrollIntoViewIfNeeded();
    const out = await section.evaluate((root) => {
      const frame = root.getBoundingClientRect();
      return [...root.querySelectorAll<HTMLElement>('button, select, input')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.left < frame.left - 1 || r.right > frame.right + 1);
        })
        .map((el) => el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName);
    });
    expect(out, `the Timer's section at ${String(size.width)} × ${String(size.height)}`).toEqual([]);
  }

  // Its time, changed here: the library's timer itself.
  await expect(section.getByTestId('field-timer-kind')).toHaveValue('countdown');
  await section.getByTestId('field-timer-length').fill('0:04');
  await section.getByTestId('field-timer-length').press('Enter');
  await expect
    .poll(async () => (await snapshot(win)).timers.find((t) => t.id === timerId)?.durationMs)
    .toBe(4000);
  await expect(editor.getByTestId('editor-slide').locator('[data-timer-element]')).toHaveAttribute(
    'data-time',
    '0:04',
  );
  // Its format, its warning from 2 seconds left, and a message at zero.
  await section.getByTestId('field-timer-format').selectOption('mss');
  await section.getByTestId('field-timer-warn').check();
  await section.getByTestId('field-timer-warn-from').fill('2');
  await section.getByTestId('field-timer-warn-color').fill('#ff6b6b');
  await section.getByTestId('field-at-zero').selectOption('message');
  await section.getByTestId('field-timer-zero-text').fill('Placeholder: time is up');
  await editor.getByTestId('save-slides').click();
  await slideEditorClosed(app);

  const timers = await win.evaluate(async (pid) => {
    const doc = await (globalThis as PageGlobals).drashti.library.getPresentation(pid);
    return doc?.groups.flatMap((g) =>
      g.slides.flatMap((s) => s.slide.elements.filter((e) => e.kind === 'timer')),
    );
  }, id);
  expect(timers).toMatchObject([
    {
      kind: 'timer',
      timerId,
      format: 'mss',
      warn: { fromMs: 2000, color: '#ff6b6b' },
      atZero: 'message',
      zeroText: 'Placeholder: time is up',
    },
  ]);

  // On the screens: started, its warning colour near the end, then its message at zero in its place.
  await win.evaluate(
    async ({ pid, timerId }) => {
      const d = (globalThis as PageGlobals).drashti;
      await d.engine.dispatch({ type: 'goLive', presentationId: pid, slideIndex: 0 });
      await d.engine.dispatch({ type: 'startTimer', timerId });
    },
    { pid: id, timerId },
  );
  const onScreen = output.locator('[data-layer="slide"] [data-timer-element]');
  await expect(onScreen).toHaveAttribute('data-warn', 'true', { timeout: 10_000 });
  await expect(onScreen).toHaveAttribute('data-shows', 'message', { timeout: 10_000 });
  await expect(onScreen).toContainText('Placeholder: time is up');

  // Its kind changed in Edit slides: a countdown to a time, the time it counts to.
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Timer Options/ })
    .click();
  await win.getByTestId('edit-slides').click();
  const again = await slideEditorWindow(app);
  await again.editor.getByTestId('editor-slide').locator('[data-timer-element]').click();
  const sectionAgain = again.editor.getByTestId('inspector-timer');
  await sectionAgain.getByTestId('field-timer-kind').selectOption('countdown_to_time');
  await sectionAgain.getByTestId('field-timer-time').fill('19:30');
  await sectionAgain.getByTestId('field-timer-time').press('Enter');
  await expect
    .poll(async () => {
      const t = (await snapshot(win)).timers.find((x) => x.id === timerId);
      return [t?.kind, t?.targetTime];
    })
    .toEqual(['countdown_to_time', '19:30']);
  await app.close();
});
