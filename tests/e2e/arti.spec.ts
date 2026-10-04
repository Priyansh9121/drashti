import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { ArtiFields } from '../../src/shared/arti';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';

/*
 * The arti at its time (Session 12), on a fake clock: the schedules read
 * this computer's clock moved on by the test (DRASHTI_TEST_ARTI_CLOCK), the
 * engine's clock is never moved. The prompt shows its minutes before; at the
 * time the arti is what Next shows; Put up Arti now and Not now; it never
 * goes up by itself unless its schedule says, and then after a ten-second
 * countdown with Cancel; Simple Mode shows the prompt as a big button and
 * changes no schedule; a time that passed while Drashti was closed is not
 * run late. The seeded placeholder presentations stand in for the arti.
 */

const ARTI = 'Sample kirtan (placeholder)';
const OTHER = 'Language test slides';
const CLOCK = { DRASHTI_TEST_ARTI_CLOCK: '1' };

/** This computer's time `days` from today at hh:mm:ss (the app runs on the same computer). */
function at(days: number, hours: number, minutes = 0, seconds = 0): number {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hours, minutes, seconds, 0);
  return d.getTime();
}

/** Move the schedules' clock to `wallMs`, and look again. */
async function clockTo(app: ElectronApplication, wallMs: number): Promise<void> {
  await app.evaluate((_electron, ms) => {
    (globalThis as { drashtiArtiClock?: (wallMs: number) => void }).drashtiArtiClock?.(ms);
  }, wallMs);
}

const engine = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

async function presentationId(win: Page, name: string): Promise<string> {
  const id = await win.evaluate(async (n) => {
    const list = await (globalThis as PageGlobals).drashti.library.listPresentations();
    return list.find((p) => p.name === n)?.id ?? null;
  }, name);
  if (!id) throw new Error(`no ${name}`);
  return id;
}

async function goLive(win: Page, id: string): Promise<void> {
  await win.evaluate(
    (pid) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: pid,
        slideIndex: 0,
      }),
    id,
  );
}

test('the arti prompts before its time, is what Next shows at its time, goes up when asked; Not now; Simple Mode’s big button', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(CLOCK);
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const arti = await presentationId(win, ARTI);
  const other = await presentationId(win, OTHER);

  // An admin adds the time, in the live column's Arti panel.
  const panel = win.getByTestId('arti-panel');
  await panel.getByTestId('add-arti').click();
  const dialog = win.getByTestId('arti-dialog');
  await expect(dialog).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'a new arti time');
  await dialog.getByTestId('arti-name').fill('Placeholder evening arti');
  await dialog.getByTestId('arti-presentation').selectOption({ label: ARTI });
  await dialog.getByTestId('arti-time').fill('19:00');
  await dialog.getByTestId('arti-prompt-minutes').fill('5');
  await dialog.getByTestId('save-arti').click();
  await expect(dialog).toHaveCount(0);
  await expect(panel.getByTestId('arti-schedule')).toHaveCount(1);
  await expect(panel.getByTestId('arti-schedule')).toContainText('Every day 19:00');
  await expect(panel.getByTestId('arti-schedule')).toContainText(ARTI);
  await expectNoSeriousA11yIssues(win, 'the Arti panel');

  // Tomorrow (so the time is after Drashti started): nothing yet at 18:54, the prompt from 18:55.
  await goLive(win, other);
  await clockTo(app, at(1, 18, 54));
  const prompt = win.getByTestId('arti-prompt');
  await expect(prompt).toHaveCount(0);
  await clockTo(app, at(1, 18, 55));
  await expect(prompt).toContainText('Placeholder evening arti at 19:00.');
  await expect(prompt.getByTestId('arti-countdown')).toHaveText(/^in [45]:\d\d$/u);
  await expectNoSeriousA11yIssues(win, 'the arti prompt');
  // Not cued before its time: Next goes on as it was.
  expect((await engine(win)).cue).toBeNull();

  // At the time: the arti is what Next shows; it never goes up by itself.
  await clockTo(app, at(1, 19));
  await expect(prompt).toContainText('it is time (19:00). Next puts it up.');
  await expect.poll(async () => (await engine(win)).cue?.presentationId).toBe(arti);
  expect((await engine(win)).next).toMatchObject({ kind: 'slide', presentationId: arti, slideIndex: 0 });
  await clockTo(app, at(1, 19, 9));
  expect((await engine(win)).live.presentationId).toBe(other);
  await prompt.getByTestId('arti-put-up').click();
  await expect.poll(async () => (await engine(win)).live.presentationId).toBe(arti);
  await expect(prompt).toHaveCount(0);
  expect((await engine(win)).cue).toBeNull();

  // The next day: Not now takes the prompt and the cue away.
  await goLive(win, other);
  await clockTo(app, at(2, 19, 1));
  await expect(prompt).toBeVisible();
  await expect.poll(async () => (await engine(win)).cue?.presentationId).toBe(arti);
  await prompt.getByTestId('arti-not-now').click();
  await expect(prompt).toHaveCount(0);
  await expect.poll(async () => (await engine(win)).cue).toBeNull();
  expect((await engine(win)).live.presentationId).toBe(other);

  // Simple Mode: the prompt is a big button; the schedules cannot be changed there.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('arti-panel')).toHaveCount(0);
  await clockTo(app, at(3, 18, 56));
  const big = win.getByTestId('simple-mode').getByTestId('arti-prompt');
  await expect(big).toContainText('Placeholder evening arti at 19:00.');
  expect((await big.getByTestId('arti-put-up').boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(90);
  await expectNoSeriousA11yIssues(win, 'the arti prompt in Simple Mode');
  const refused = await win.evaluate(async (fields: ArtiFields) => {
    const d = (globalThis as PageGlobals).drashti;
    const id = (await d.arti.view()).schedules[0]?.id ?? '';
    return [await d.arti.save(null, fields), await d.arti.setEnabled(id, false), await d.arti.remove(id)];
  }, artiFields(arti));
  expect(refused).toEqual([
    { ok: false, message: SIMPLE_MODE_REFUSAL },
    { ok: false, message: SIMPLE_MODE_REFUSAL },
    { ok: false, message: SIMPLE_MODE_REFUSAL },
  ]);
  // Putting it up early, before its time.
  await big.getByTestId('arti-put-up').click();
  await expect.poll(async () => (await engine(win)).live.presentationId).toBe(arti);
  await expect(big).toHaveCount(0);
  await app.close();
});

function artiFields(presentation: string, over: Partial<ArtiFields> = {}): ArtiFields {
  return {
    name: 'Placeholder morning arti',
    presentationId: presentation,
    days: [0, 1, 2, 3, 4, 5, 6],
    date: null,
    time: '07:00',
    promptMinutes: 1,
    byItself: true,
    enabled: true,
    ...over,
  };
}

test('goes up by itself only as its schedule says, after a ten-second countdown with Cancel; a time missed while closed is not run late', async () => {
  test.setTimeout(120_000);
  const first = await launchApp(CLOCK);
  let win = await operatorPage(first.app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const arti = await presentationId(win, ARTI);
  const other = await presentationId(win, OTHER);
  const saved = await win.evaluate(
    (fields: ArtiFields) => (globalThis as PageGlobals).drashti.arti.save(null, fields),
    artiFields(arti),
  );
  expect(saved).toMatchObject({ ok: true });

  // At its time: ten seconds counted down, with Cancel; then up by itself.
  await goLive(win, other);
  await clockTo(first.app, at(1, 7));
  const prompt = win.getByTestId('arti-prompt');
  await expect(prompt).toHaveAttribute('data-counting', 'true');
  await expect(prompt).toContainText('Placeholder morning arti goes up by itself in ten seconds.');
  await expect(prompt.getByTestId('arti-countdown')).toHaveText(/^Up in (10|9|8)$/u);
  expect((await engine(win)).live.presentationId).toBe(other);
  // (The count runs on in real time too: if the check outlasts it, the arti is simply up already.)
  await expectNoSeriousA11yIssues(win, 'the arti counting down to go up by itself');
  await clockTo(first.app, at(1, 7, 0, 10));
  await expect.poll(async () => (await engine(win)).live.presentationId).toBe(arti);
  await expect(prompt).toHaveCount(0);

  // The next day: Cancel stops it; the prompt stays for the operator.
  await goLive(win, other);
  await clockTo(first.app, at(2, 7));
  await prompt.getByTestId('arti-cancel').click();
  await expect(prompt).not.toHaveAttribute('data-counting', 'true');
  await expect(prompt.getByTestId('arti-cancel')).toHaveCount(0);
  await clockTo(first.app, at(2, 7, 0, 30));
  expect((await engine(win)).live.presentationId).toBe(other);
  await expect(prompt).toBeVisible();
  await prompt.getByTestId('arti-not-now').click();
  await expect(prompt).toHaveCount(0);
  await first.app.close();

  // Closed through the time: started again two minutes after it, nothing runs late.
  const late = at(3, 7, 2);
  const again = await launchApp(
    { ...CLOCK, DRASHTI_TEST_ARTI_OFFSET_MS: String(late - Date.now()) },
    first.userData,
  );
  win = await operatorPage(again.app);
  await operatorReady(win);
  await clockTo(again.app, at(3, 7, 5));
  await expect
    .poll(async () => (await win.evaluate(() => (globalThis as PageGlobals).drashti.arti.view())).prompt)
    .toBeNull();
  expect((await engine(win)).cue).toBeNull();
  await expect(win.getByTestId('arti-prompt')).toHaveCount(0);
  expect((await engine(win)).live.presentationId).not.toBe(arti);
  // Its next time runs as usual.
  await clockTo(again.app, at(4, 6, 59, 30));
  await expect(win.getByTestId('arti-prompt')).toContainText('Placeholder morning arti at 07:00.');
  await again.app.close();
});
