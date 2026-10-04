import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';

/*
 * Every panel and dialog Session 12 added passes the accessibility checks at
 * 1280 x 720, beyond those its own tests check as they go (the Shastra tab
 * and Texts, the passage picker, timer cues and slots, the arti dialog and
 * prompt, the Calendar dialog, the idle rotation's panel and dialog): the
 * Arti and Idle rotation panels together with today's line along the
 * bottom, a group's "When nothing is up", the stage layout editor with a
 * Samvat box and a quote box, a message with a Samvat field, a quote being
 * written, a macro that starts the idle rotation, and Simple Mode with
 * today's line. Placeholder names and a made-up calendar only.
 */

const pad = (n: number) => String(n).padStart(2, '0');
function today(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test('the new panels and dialogs pass the accessibility checks at 1280 x 720', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-a11y-')), 'placeholder-calendar.json');
  writeFileSync(
    file,
    JSON.stringify({
      format: 'drashti-calendar',
      version: 1,
      name: 'Placeholder calendar',
      days: [
        {
          date: today(),
          samvat: 1001,
          month: { gu: 'નમૂના માસ', en: 'Placeholder month' },
          paksha: { gu: 'પહેલો પક્ષ', en: 'First half' },
          tithi: { gu: 'નમૂના તિથિ', en: 'Placeholder tithi' },
          festivals: [{ gu: 'નમૂના ઉત્સવ', en: 'Placeholder festival' }],
        },
      ],
    }),
  );
  await win.evaluate(async (path) => {
    const d = (globalThis as PageGlobals).drashti;
    const loaded = await d.library.importPaths([path]);
    if (!loaded.ok) throw new Error(loaded.message);
    const presentations = await d.library.listPresentations();
    const arti = presentations[0]?.id ?? '';
    const saved = await d.arti.save(null, {
      name: 'Placeholder evening arti',
      presentationId: arti,
      days: [0, 1, 2, 3, 4, 5, 6],
      date: null,
      time: '19:00',
      promptMinutes: 5,
      byItself: true,
      enabled: true,
    });
    if (!saved.ok) throw new Error(saved.message);
    await d.idle.saveQuote(null, {
      words: { en: 'Placeholder quote', gu: 'નમૂનાનું વાક્ય' },
      attribution: 'Placeholder',
    });
    const made = await d.screens.createGroup('Placeholder hall');
    if (!made.ok) throw new Error(made.message);
    const stage = await d.screens.createGroup('Placeholder stage');
    if (!stage.ok) throw new Error(stage.message);
    await d.screens.setGroupRole(
      stage.snapshot.groups.find((g) => g.name === 'Placeholder stage')?.id ?? '',
      'stage',
    );
    await d.stageLayouts.save(null, {
      name: 'Placeholder calendar band',
      background: '#000000',
      boxes: [
        {
          id: 's',
          kind: 'samvat',
          frame: { x: 48, y: 48, width: 1200, height: 200 },
          size: 56,
          color: '#ffffff',
          align: 'left',
          label: '',
          lang: 'gu',
        },
        {
          id: 'q',
          kind: 'quote',
          frame: { x: 48, y: 400, width: 1200, height: 400 },
          size: 48,
          color: '#ffffff',
          align: 'left',
          label: '',
        },
      ],
    });
    await d.messages.create({
      name: 'Placeholder today',
      template: 'Today: {date}',
      fields: { date: { kind: 'samvat', lang: 'gu' } },
    });
    await d.macros.save(null, {
      name: 'Placeholder before sabha',
      color: '#2f9e44',
      actions: [{ kind: 'idle', to: 'start' }],
    });
  }, file);

  // The right column's new panels, and today's line along the bottom.
  await expect(win.getByTestId('today-calendar')).toContainText('Placeholder festival');
  await expect(win.getByTestId('arti-panel').getByTestId('arti-schedule')).toHaveCount(1);
  for (const panel of ['arti-panel', 'idle-panel'])
    await expectNoSeriousA11yIssues(win, `the ${panel}`, `[data-testid="${panel}"]`);
  await expectNoSeriousA11yIssues(win, 'the operator window with the Session 12 panels and today’s line');

  // A message with a Samvat field, being changed.
  const row = win.getByTestId('message-row').filter({ hasText: 'Placeholder today' });
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(win.getByRole('combobox', { name: 'How {date} is filled' })).toHaveValue('samvat:gu');
  await expectNoSeriousA11yIssues(win, 'a message template with a Samvat field');

  // Screens: an audience group's "When nothing is up", and the stage layout editor's new boxes.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await expect(win.getByTestId('look-idle').first()).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'Screens with “When nothing is up”');
  await win.getByTestId('edit-stage-layouts').first().click();
  const layouts = win.getByTestId('stage-layout-editor');
  await layouts.getByRole('button', { name: 'Placeholder calendar band' }).click();
  for (const box of [0, 1]) {
    await layouts.getByTestId('stage-box-list').getByRole('button').nth(box).click();
    await expect(layouts.getByTestId('stage-box-settings')).toBeVisible();
    await expectNoSeriousA11yIssues(win, `the stage layout editor (a ${box === 0 ? 'Samvat' : 'quote'} box)`);
  }
  await layouts.getByRole('button', { name: 'Close stage layouts' }).click();
  await win.getByRole('button', { name: 'Close screens' }).click();

  // A quote being written, in the idle rotation's dialog.
  await win.getByTestId('idle-panel').getByTestId('open-idle').click();
  const idle = win.getByTestId('idle-dialog');
  await idle.getByTestId('add-quote').click();
  await expect(idle.getByTestId('quote-form')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'writing a quote');
  await win.getByRole('button', { name: 'Close the idle rotation' }).click();

  // A macro that starts the idle rotation.
  await win.getByTestId('macros-panel').getByRole('button', { name: 'Edit' }).click();
  await expect(win.getByRole('combobox', { name: 'The idle rotation' })).toHaveValue('start');
  await expectNoSeriousA11yIssues(win, 'the macro editor with the idle rotation');
  await win.getByRole('button', { name: 'Close macros' }).click();

  // Simple Mode, with today's line.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode').getByTestId('today-calendar')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'Simple Mode with today’s line');
  await app.close();
});
