import { expect, test } from '@playwright/test';
import { launchApp, operatorPage, outputPage, setUpScreen } from './helpers';

/*
 * Messages: a template with a field, filled in by the operator and shown on
 * the audience screens; a second one with a live timer up at the same time;
 * updating, taking one off, and clearing them all.
 */

test('a message with a field goes up on the screens, next to another, and comes off', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await setUpScreen(win);
  const output = await outputPage(app);
  const banner = output.locator('[data-layer="messages"]');
  const panel = win.getByTestId('messages');

  // A template with a field.
  await panel.getByRole('button', { name: '+ Message' }).click();
  const form = panel.getByTestId('message-form');
  await form.getByRole('textbox', { name: 'Message name' }).fill('Placeholder parking');
  await form.getByRole('textbox', { name: 'Message words' }).fill('Car {plate} please move');
  await form.getByRole('button', { name: 'Save' }).click();
  const car = panel.getByTestId('message-row').filter({ hasText: 'Placeholder parking' });
  await expect(car).toBeVisible();

  // The field must be filled in first.
  await car.getByRole('button', { name: 'Show' }).click();
  await expect(car).toContainText('Fill in {plate} first.');
  await expect(banner).toHaveCount(0);
  await car.getByRole('textbox', { name: 'plate' }).fill('PLACEHOLDER-123');
  await car.getByRole('button', { name: 'Show' }).click();
  await expect(banner).toHaveText('Car PLACEHOLDER-123 please move');
  await expect(car).toHaveAttribute('data-shown', 'true');

  // A second message, with a timer in it: both are up at once.
  const timers = win.getByTestId('timers');
  await timers.getByRole('button', { name: '+ Timer' }).click();
  await timers.getByRole('textbox', { name: 'Timer name' }).fill('Placeholder start');
  await timers.getByRole('button', { name: 'Save' }).click();
  await panel.getByRole('button', { name: '+ Message' }).click();
  await form.getByRole('textbox', { name: 'Message name' }).fill('Placeholder start time');
  await form.getByRole('textbox', { name: 'Message words' }).fill('Sabha starts in {time}');
  await form
    .getByRole('combobox', { name: 'How {time} is filled' })
    .selectOption({ label: 'Timer: Placeholder start' });
  await form.getByRole('button', { name: 'Save' }).click();
  const start = panel.getByTestId('message-row').filter({ hasText: 'Placeholder start time' });
  await start.getByRole('button', { name: 'Show' }).click();
  await expect(banner).toHaveText('Car PLACEHOLDER-123 please move   ·   Sabha starts in 5:00');

  // Showing the car message again with another plate replaces it.
  await car.getByRole('textbox', { name: 'plate' }).fill('PLACEHOLDER-456');
  await car.getByRole('button', { name: 'Update' }).click();
  await expect(banner).toHaveText('Car PLACEHOLDER-456 please move   ·   Sabha starts in 5:00');

  // Take one off; the other stays. Clear messages (F5) takes the rest.
  await car.getByRole('button', { name: 'Take off' }).click();
  await expect(banner).toHaveText('Sabha starts in 5:00');
  await win.keyboard.press('F5');
  await expect(banner).toHaveCount(0);
  await expect(start).not.toHaveAttribute('data-shown', 'true');

  await app.close();
});
