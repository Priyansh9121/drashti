import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { launchApp, openMoreTools, operatorPage, operatorReady } from './helpers';

/*
 * Every panel and dialog Session 11 added passes the accessibility checks at
 * 1280 x 720: the Looks and Masks panels; Screens with the Looks, a stage
 * group's layout and a key and fill group; the stage layout and mask editors;
 * the MIDI dialog (Session 44: Macros are gone, and MIDI is in More tools).
 * Placeholder names only.
 */

test('the new panels and dialogs pass the accessibility checks at 1280 x 720', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  // Masks, the Idle rotation and MIDI are in More tools (Session 26a; MIDI since Session 44).
  await openMoreTools(win);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    for (const [name, role] of [
      ['Placeholder hall', 'audience'],
      ['Placeholder stage', 'stage'],
      ['Placeholder switcher', 'keyfill'],
    ] as const) {
      const made = await d.screens.createGroup(name);
      if (!made.ok) throw new Error(made.message);
      const group = made.snapshot.groups.find((g) => g.name === name);
      if (role !== 'audience') await d.screens.setGroupRole(group?.id ?? '', role);
    }
    await d.looks.create('Placeholder evening', null);
    await d.masks.save(null, {
      name: 'Placeholder wall',
      width: 1920,
      height: 1080,
      mode: 'hide',
      shapes: [{ id: 's1', kind: 'rounded', frame: { x: 100, y: 100, width: 400, height: 300 }, radius: 40 }],
    });
    await d.stageLayouts.save(null, {
      name: 'Placeholder band',
      background: '#000000',
      boxes: [
        {
          id: 'b1',
          kind: 'clock',
          frame: { x: 100, y: 100, width: 600, height: 200 },
          size: 'fit',
          color: '#ffffff',
          align: 'left',
          label: '',
        },
      ],
    });
  });

  // The right column's new panels.
  await expect(win.getByTestId('looks-panel').getByTestId('look-button')).toHaveCount(2);
  await expect(win.getByTestId('masks-panel').getByTestId('mask-button')).toHaveCount(1);
  for (const panel of ['looks-panel', 'masks-panel'])
    await expectNoSeriousA11yIssues(win, `the ${panel}`, `[data-testid="${panel}"]`);
  await expectNoSeriousA11yIssues(win, 'the operator window with the new panels');

  // Screens: the Looks, and a stage group's and a key and fill group's settings.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await expect(win.getByTestId('looks-section')).toBeVisible();
  await expect(win.getByTestId('keyfill-hint')).toBeVisible();
  await expect(win.getByTestId('look-stage-layout')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'Screens with Looks, a stage group and a key and fill group');
  await win.getByTestId('edit-stage-layouts').click();
  const layouts = win.getByTestId('stage-layout-editor');
  await expect(layouts).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the stage layout editor (Standard)');
  await layouts.getByRole('button', { name: 'Placeholder band' }).click();
  await layouts.getByTestId('stage-box-list').getByRole('button').first().click();
  await expect(layouts.getByTestId('stage-box-settings')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the stage layout editor (a layout, a box chosen)');
  await layouts.getByRole('button', { name: 'Close stage layouts' }).click();
  await win.getByTestId('edit-masks').first().click();
  const masks = win.getByTestId('mask-editor');
  await expect(masks).toBeVisible();
  await masks.getByTestId('mask-shape-list').getByRole('button').first().click();
  await expect(masks.getByTestId('mask-shape-settings')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the mask editor (a shape chosen)');
  await masks.getByRole('button', { name: 'Close masks' }).click();
  await win.getByRole('button', { name: 'Close screens' }).click();

  // The MIDI dialog.
  await win.getByTestId('more-tools').getByTestId('open-midi').click();
  await expect(win.getByTestId('midi-dialog')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the MIDI dialog');
  await win.getByRole('button', { name: 'Close MIDI' }).click();
  await app.close();
});
