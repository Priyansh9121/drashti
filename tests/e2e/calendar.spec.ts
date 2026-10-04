import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { dropFiles, launchApp, operatorPage, operatorReady, outputPages, setUpScreen } from './helpers';

/*
 * Samvat and tithi (Session 12), from a made-up calendar written for the
 * test's own dates (placeholder names only): it loads from its file; today
 * shows in the operator window, on the stage (a Samvat box, and a clock box
 * with the date) and on the audience screens in a message with a Samvat
 * field; a date the calendars do not give shows nothing; Simple Mode shows
 * today's line and cannot remove a calendar.
 */

const pad = (n: number) => String(n).padStart(2, '0');
/** This computer's date `days` from today, "YYYY-MM-DD". */
function dateIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A placeholder calendar file for these dates (the first has a festival). */
function calendarFile(dir: string, dates: string[]): string {
  const file = join(dir, 'placeholder-calendar.json');
  writeFileSync(
    file,
    JSON.stringify({
      format: 'drashti-calendar',
      version: 1,
      name: 'Placeholder calendar',
      days: dates.map((date, i) => ({
        date,
        samvat: 1001,
        month: { gu: 'નમૂના માસ', en: 'Placeholder month' },
        paksha: { gu: 'પહેલો પક્ષ', en: 'First half' },
        tithi: { gu: `નમૂના તિથિ ${String(i + 1)}`, en: `Placeholder tithi ${String(i + 1)}` },
        festivals: i === 0 ? [{ gu: 'નમૂના ઉત્સવ', en: 'Placeholder festival' }] : [],
      })),
    }),
  );
  return file;
}

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

test('a calendar loads; today shows in the operator window, on the stage and in a message; a date it does not give shows nothing', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const hallId = await setUpScreen(win, 'Hall', 0);
  const stageId = await setUpScreen(win, 'Stage', 1);
  // The stage gets a layout with a Samvat box (Gujarati) and a clock with the date (English).
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const groups = (await d.screens.get()).groups;
    const stage = groups.find((g) => g.name === 'Stage')?.id ?? '';
    await d.screens.setGroupRole(stage, 'stage');
    const layout = await d.stageLayouts.save(null, {
      name: 'Placeholder calendar layout',
      background: '#000000',
      boxes: [
        {
          id: 'samvat',
          kind: 'samvat',
          frame: { x: 48, y: 48, width: 1824, height: 300 },
          size: 56,
          color: '#ffffff',
          align: 'left',
          label: '',
          lang: 'gu',
        },
        {
          id: 'clock',
          kind: 'clock',
          frame: { x: 48, y: 500, width: 1824, height: 400 },
          size: 'fit',
          color: '#ffffff',
          align: 'right',
          label: '',
          calendar: true,
          lang: 'en',
        },
      ],
    });
    if (!layout.ok) throw new Error(layout.message);
    const looks = await d.looks.list();
    await d.looks.setGroup(looks.liveId, stage, { stageLayoutId: layout.id });
  });
  const hall = await outputFor(app, hallId);
  const stage = await outputFor(app, stageId);
  await expect(stage.getByTestId('stage-layout')).toBeVisible();
  // No calendar yet: nothing anywhere.
  await expect(win.getByTestId('today-calendar')).toHaveCount(0);
  await expect(stage.locator('[data-stage-box="samvat"]')).toHaveText('');

  // Dragged onto the library, like any file: the report says what came in.
  const dir = mkdtempSync(join(tmpdir(), 'drashti-calendar-'));
  const file = calendarFile(dir, [dateIn(0), dateIn(1)]);
  await dropFiles(win, win.getByTestId('library-drop'), [file]);
  const report = win.getByTestId('import-report');
  await expect(report).toContainText(`Loaded: 2 days, ${dateIn(0)} to ${dateIn(1)}, with 1 festival.`);
  await report.getByRole('button', { name: 'Open Calendar' }).first().click();
  const dialog = win.getByTestId('calendar-dialog');
  await expect(dialog.getByTestId('calendar-today')).toContainText(
    'Samvat 1001, Placeholder month First half Placeholder tithi 1 · Placeholder festival',
  );
  await expect(dialog.getByTestId('calendar-today')).toContainText(
    'સંવત ૧૦૦૧, નમૂના માસ પહેલો પક્ષ નમૂના તિથિ 1',
  );
  await expect(dialog.getByTestId('calendar-row')).toHaveCount(1);
  await expectNoSeriousA11yIssues(win, 'the Calendar dialog');
  await win.getByRole('button', { name: 'Close the calendar' }).click();

  // The operator window, along the bottom.
  await expect(win.getByTestId('today-calendar')).toContainText(
    'Samvat 1001, Placeholder month First half Placeholder tithi 1 · Placeholder festival',
  );
  // The stage: the Samvat box in Gujarati (digits too), the clock with the date in English.
  await expect(stage.locator('[data-stage-box="samvat"]')).toContainText('સંવત ૧૦૦૧, નમૂના માસ');
  await expect(stage.locator('[data-stage-box="samvat"]')).toContainText('નમૂના ઉત્સવ');
  await expect(stage.locator('[data-stage-box="clock"] [data-samvat="en"]')).toHaveText(
    'Samvat 1001, Placeholder month First half Placeholder tithi 1',
  );

  // The audience: a message with a Samvat field, shown from the Messages panel.
  await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.messages.create({
      name: 'Placeholder today',
      template: 'Today: {date}',
      fields: { date: { kind: 'samvat', lang: 'en' } },
    });
    if (!made.ok) throw new Error(made.message);
  });
  const row = win.getByTestId('message-row').filter({ hasText: 'Placeholder today' });
  await expect(row).toContainText("today's Samvat date (English)");
  await row.getByRole('button', { name: 'Show' }).click();
  await expect(hall.locator('[data-layer="messages"]')).toContainText(
    'Today: Samvat 1001, Placeholder month First half Placeholder tithi 1 · Placeholder festival',
  );

  // Simple Mode: today's line stays; removing a calendar is refused.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('today-calendar')).toContainText('Placeholder tithi 1');
  const refused = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const id = (await d.calendar.view()).calendars[0]?.id ?? '';
    return d.calendar.remove(id);
  });
  expect(refused).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'));
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);

  // Loaded again by its name, without today: today shows nothing anywhere.
  calendarFile(dir, [dateIn(-1), dateIn(2)]);
  const reloaded = await win.evaluate(async (path) => {
    const d = (globalThis as PageGlobals).drashti;
    const started = await d.library.importPaths([path]);
    if (!started.ok) throw new Error(started.message);
    return (await d.library.getImportReport(started.run.id))?.items[0]?.outcome;
  }, file);
  expect(reloaded).toBe('replaced');
  await expect(win.getByTestId('today-calendar')).toHaveCount(0);
  await expect(stage.locator('[data-stage-box="samvat"]')).toHaveText('');
  await expect(stage.locator('[data-stage-box="clock"] [data-samvat]')).toHaveCount(0);
  await expect(hall.locator('[data-layer="messages"]')).toHaveText('Today: ');
  await app.close();
});
