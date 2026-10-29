import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The hall's messages (Session 55, Part 15): each message keeps its own look, set in the Messages panel beside a small
 * picture of it: where it sits (one of nine places, or dragged in the picture), how it comes in and goes out (a slide
 * in from an edge of the picture, a fade, or the Lower Thirds' other animations), how long it stays up (a set time,
 * or until taken off), its font, size, colour and weight, and a band or a box behind it with its colour and how
 * see-through it is; a change and a removal each with Undo. A message with the standard look still shows in the band
 * along the bottom, as before (messages.spec.ts). Placeholder words only.
 */

/** Where an element sits on the output, as fractions of its scene. */
async function placeOf(
  output: Page,
  selector: string,
): Promise<{ x: number; y: number; w: number; h: number }> {
  return output.evaluate((selector) => {
    const scene = document.querySelector('[data-testid="scene"]')?.getBoundingClientRect();
    const box = document.querySelector(selector)?.getBoundingClientRect();
    if (!scene || !box) return { x: -1, y: -1, w: 0, h: 0 };
    return {
      x: (box.left - scene.left) / scene.width,
      y: (box.top - scene.top) / scene.height,
      w: box.width / scene.width,
      h: box.height / scene.height,
    };
  }, selector);
}

const engine = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

/** A new message in the panel's form: its name and words (the form stays open). */
async function newMessage(panel: Locator, name: string, words: string): Promise<Locator> {
  await panel.getByRole('button', { name: 'New message' }).click();
  const form = panel.getByTestId('message-form');
  await form.getByRole('textbox', { name: 'Message name' }).fill(name);
  await form.getByRole('textbox', { name: 'Message words' }).fill(words);
  return form;
}

test('a message keeps its own look: top left in a box, yellow, bigger, sliding in from the left edge, up for a set time', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win);
  const output = await outputPage(app);
  await outputReady(output);
  const panel = win.getByTestId('messages');

  const form = await newMessage(panel, 'Placeholder corner', 'Placeholder corner words');
  const look = form.getByTestId('message-look');
  // The standard look to begin with: the band along the bottom, until taken off.
  await expect(look.getByRole('radio', { name: 'Bottom centre' })).toBeChecked();
  await expect(look.getByRole('combobox', { name: 'Behind the words' })).toHaveValue('band');
  await expect(look.getByRole('combobox', { name: 'How long' })).toHaveValue('until');
  await expect(look.getByTestId('message-size')).toHaveText('Standard');
  // Its own: top left, a box, yellow, two steps bigger, bold, sliding in from the left edge, for 10 seconds.
  await look.getByRole('radio', { name: 'Top left' }).click();
  await look.getByRole('combobox', { name: 'Behind the words' }).selectOption('box');
  await look.getByRole('combobox', { name: 'Comes in and goes out' }).selectOption({
    label: 'Slide in from the left edge',
  });
  await look.getByRole('combobox', { name: 'How long' }).selectOption('10');
  await look.getByRole('button', { name: 'Bigger' }).click();
  await look.getByRole('button', { name: 'Bigger' }).click();
  await expect(look.getByTestId('message-size')).toHaveText('2 steps bigger');
  await look.getByRole('combobox', { name: 'Weight' }).selectOption({ label: 'Bold' });
  await look.getByLabel('Words colour').fill('#fde68a');
  await look.getByLabel('See-through').fill('50');
  // The small picture shows it as it will look, at its place.
  const preview = form.getByTestId('message-preview');
  await expect(preview.locator('[data-message-box]')).toHaveAttribute('data-place', 'top-left');
  await expectNoSeriousA11yIssues(win, 'the message form with its look', '[data-testid="messages"]');
  await form.getByRole('button', { name: 'Save' }).click();
  const row = panel.getByTestId('message-row').filter({ hasText: 'Placeholder corner' });
  await expect(row).toContainText('Top left');
  await expect(row).toContainText('10 s');

  // Shown: in a box at the top left, in its look, coming in from the left edge.
  await row.getByRole('button', { name: 'Show' }).click();
  const box = output.locator('[data-message-box]');
  await expect(box).toHaveAttribute('data-place', 'top-left');
  await expect(box).toContainText('Placeholder corner words');
  await expect(box).toHaveAttribute('data-animation', 'across-left-steady');
  const words = box.locator('[data-message-band]');
  await expect(words).toHaveCSS('color', 'rgb(253, 230, 138)');
  await expect(words).toHaveCSS('font-weight', '700');
  await expect(words).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.5)');
  await expect.poll(async () => (await placeOf(output, '[data-message-band]')).x).toBeLessThan(0.1);
  const at = await placeOf(output, '[data-message-band]');
  expect(at.y).toBeLessThan(0.1);
  expect(at.w, 'a box round its words, not a band across').toBeLessThan(0.6);
  // Never in the band along the bottom.
  await expect(output.locator('[data-layer="messages"]')).toHaveCount(0);
  // Up for its 10 seconds, then it goes by itself.
  const up = (await engine(win)).state.layers.messages[0];
  expect(up?.until).toBe((up?.shownAt ?? 0) + 10_000);
  await expect(row).toHaveAttribute('data-shown', 'true');
  await expect(box).toHaveCount(0, { timeout: 20_000 });
  await expect(row).not.toHaveAttribute('data-shown', 'true');

  // Undo: a change made, then undone, as it was.
  await row.getByRole('button', { name: 'Edit' }).click();
  await panel
    .getByTestId('message-form')
    .getByRole('textbox', { name: 'Message words' })
    .fill('Placeholder changed');
  await panel.getByTestId('message-form').getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByTestId('message-row').filter({ hasText: 'Placeholder corner' })).toContainText(
    'Placeholder changed',
  );
  await win.getByTestId('undo-removal').getByRole('button', { name: 'Undo' }).click();
  await expect(panel.getByTestId('message-row').filter({ hasText: 'Placeholder corner' })).toContainText(
    'Placeholder corner words',
  );
  await expect(panel.getByTestId('message-row').filter({ hasText: 'Placeholder corner' })).toContainText(
    'Top left',
  );
  // Delete, and Undo brings it back with its look.
  await panel
    .getByTestId('message-row')
    .filter({ hasText: 'Placeholder corner' })
    .getByRole('button', { name: 'Edit' })
    .click();
  await panel.getByTestId('message-form').getByRole('button', { name: 'Delete' }).click();
  await expect(panel.getByTestId('message-row')).toHaveCount(0);
  await win.getByTestId('undo-removal').getByRole('button', { name: 'Undo' }).click();
  await expect(panel.getByTestId('message-row').filter({ hasText: 'Placeholder corner' })).toContainText(
    'Top left',
  );
  await app.close();
});

test('a message dragged to its place in the small picture shows there; take off plays its out; the band along the bottom stays for the standard look', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win);
  const output = await outputPage(app);
  await outputReady(output);
  const panel = win.getByTestId('messages');
  const form = await newMessage(panel, 'Placeholder dragged', 'Placeholder dragged words');
  const look = form.getByTestId('message-look');
  await look.getByRole('combobox', { name: 'Behind the words' }).selectOption('box');
  // Dragged to about three quarters across and a third down.
  const preview = form.getByTestId('message-preview');
  await preview.scrollIntoViewIfNeeded();
  const frame = await preview.boundingBox();
  const handle = await preview.locator('[data-message-band]').boundingBox();
  if (!frame || !handle) throw new Error('no picture');
  await win.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await win.mouse.down();
  for (let i = 1; i <= 5; i++)
    await win.mouse.move(
      handle.x + handle.width / 2 + ((frame.x + frame.width * 0.75 - handle.x - handle.width / 2) * i) / 5,
      handle.y + handle.height / 2 + ((frame.y + frame.height / 3 - handle.y - handle.height / 2) * i) / 5,
    );
  await win.mouse.up();
  await expect(look.getByTestId('message-place-words')).toHaveText('Where it was dragged');
  await expect(look.getByRole('radio', { checked: true })).toHaveCount(0);
  await form.getByRole('button', { name: 'Save' }).click();
  const row = panel.getByTestId('message-row').filter({ hasText: 'Placeholder dragged' });
  await row.getByRole('button', { name: 'Show' }).click();
  const box = output.locator('[data-message-box]');
  await expect(box).toHaveAttribute('data-place', 'dragged');
  await expect
    .poll(async () => {
      const p = await placeOf(output, '[data-message-band]');
      return [Math.round((p.x + p.w / 2) * 20) / 20, Math.round((p.y + p.h / 2) * 20) / 20];
    })
    .toEqual([0.75, 0.35]);
  // Take off: its out plays from then (the engine's), then it is gone.
  await row.getByRole('button', { name: 'Take off' }).click();
  await expect.poll(async () => (await engine(win)).state.messagesOff?.length ?? 0).toBe(1);
  await expect(box).toHaveCount(0);

  // A message left in the standard look shows in the band along the bottom, as every message did before.
  const plain = await newMessage(panel, 'Placeholder plain', 'Placeholder plain words');
  await plain.getByRole('button', { name: 'Save' }).click();
  await panel
    .getByTestId('message-row')
    .filter({ hasText: 'Placeholder plain' })
    .getByRole('button', { name: 'Show' })
    .click();
  await expect(output.locator('[data-layer="messages"]')).toHaveText('Placeholder plain words');
  await expect(output.locator('[data-message-box]')).toHaveCount(0);
  expect((await engine(win)).state.layers.messages[0]).not.toHaveProperty('look');
  await app.close();
});

test('the Messages panel and its look fit CI’s operator window and 1280 × 720', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  for (const size of [CI_WINDOW, { width: 1280, height: 720 }]) {
    await sizeOperatorWindow(app, win, size);
    const panel = win.getByTestId('messages');
    const form = await newMessage(panel, 'Placeholder fit', 'Placeholder fit words');
    await form.scrollIntoViewIfNeeded();
    const problems = await form.evaluate((f) => {
      const out: string[] = [];
      const frame = f.getBoundingClientRect();
      for (const el of f.querySelectorAll<HTMLElement>(
        'button, select, input, [data-testid="message-preview"]',
      )) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < frame.left - 1 || r.right > frame.right + 1)
          out.push(`${el.getAttribute('aria-label') ?? el.textContent} sticks out`);
      }
      if (f.scrollWidth > f.clientWidth + 1) out.push('the form scrolls sideways');
      return out;
    });
    expect(problems, `at ${String(size.width)} × ${String(size.height)}`).toEqual([]);
    await form.getByRole('button', { name: 'Cancel' }).click();
  }
  await app.close();
});
