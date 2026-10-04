import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';

/*
 * Sabha templates (Session 8): the example templates, saving a playlist as
 * one (fixed items and slots), a playlist made from it, a slot filled from
 * its category, and the playlist run; a template itself is never run. The
 * seeded placeholder presentations only.
 */

/** A week's playlist through the bridge: a header, the sample kirtan (a Kirtan) and the language slides. */
async function weekPlaylist(win: Page): Promise<{ playlistId: string; kirtanId: string; slidesId: string }> {
  return win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const list = await d.library.listPresentations();
    const kirtanId = list.find((p) => p.name.startsWith('Sample kirtan'))?.id ?? '';
    const slidesId = list.find((p) => p.name === 'Language test slides')?.id ?? '';
    const made = await d.playlists.create('Placeholder Sunday', null, false);
    if (!made.ok) throw new Error(made.message);
    const playlistId = made.ids[0] ?? '';
    await d.playlists.addItems(playlistId, null, [
      { kind: 'header', label: 'Opening' },
      { kind: 'presentation', presentationId: kirtanId },
      { kind: 'presentation', presentationId: slidesId },
    ]);
    return { playlistId, kirtanId, slidesId };
  });
}

const itemTexts = (win: Page) =>
  win
    .getByTestId('playlist-items')
    .getByTestId('playlist-item')
    .evaluateAll((els) =>
      els.map(
        (e) => `${e.getAttribute('data-kind') ?? ''}: ${e.querySelector('[data-label]')?.textContent ?? ''}`,
      ),
    );

test('a template from a playlist, a playlist from the template, a slot filled from its category, and run', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const { playlistId } = await weekPlaylist(win);

  // The example templates are there, apart from the playlists.
  await win.getByTestId('playlist-view-tab-templates').click();
  await expect(win.getByTestId('template-node')).toHaveText([
    /Example: Ravi Sabha/,
    /Example: Bal\/Kishore Sabha/,
  ]);
  await expectNoSeriousA11yIssues(win, 'the templates list');
  await win.getByTestId('playlist-view-tab-playlists').click();
  await expect(win.getByTestId('playlist-node')).toHaveText([/Placeholder Sunday/]);

  // Save the playlist as a template: the kirtan becomes a slot, the language slides stay.
  await win.getByTestId('playlist-node').first().click();
  await win.getByRole('button', { name: 'Playlist actions' }).click();
  await win.getByRole('menuitem', { name: 'Save as template…' }).click();
  const save = win.getByTestId('save-template');
  await expect(save.getByTestId('template-name')).toHaveValue('Placeholder Sunday template');
  await expect(save.getByRole('combobox', { name: /Sample kirtan/ })).toHaveValue('slot');
  await expect(save.getByRole('combobox', { name: /Language test slides/ })).toHaveValue('fixed');
  await expectNoSeriousA11yIssues(win, 'saving a template');
  await save.getByRole('button', { name: 'Save template' }).click();
  await expect(save).toHaveCount(0);
  await expect(win.getByTestId('template-banner')).toBeVisible();
  expect(await itemTexts(win)).toEqual([
    'header: Opening',
    'placeholder: Kirtan',
    'presentation: Language test slides',
  ]);

  // A template is never run: its items do not go to the slide grid, and the engine refuses it.
  const templateId = await win.evaluate(async () => {
    const t = await (globalThis as PageGlobals).drashti.playlists.templates();
    return t.find((x) => x.name === 'Placeholder Sunday template')?.id ?? '';
  });
  const fixed = win.getByTestId('playlist-item').nth(2);
  await fixed.click();
  await expect(fixed).toHaveAttribute('data-marked', 'true');
  await expect(fixed).not.toHaveAttribute('aria-current', 'true');
  const refused = await win.evaluate(
    async ({ templateId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const items = await d.playlists.items(templateId);
      return d.engine.dispatch({ type: 'playItem', playlistId: templateId, itemId: items[2]?.id ?? '' });
    },
    { templateId },
  );
  expect(refused.ok).toBe(false);

  // A new playlist from it, named in place.
  await win.getByTestId('template-banner').getByRole('button', { name: 'New playlist from this' }).click();
  const rename = win.getByRole('textbox', { name: 'Playlist name' });
  await expect(rename).toBeFocused();
  await rename.fill('Placeholder Next Sunday');
  await rename.press('Enter');
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder Next Sunday');
  expect(await itemTexts(win)).toEqual([
    'header: Opening',
    'placeholder: Kirtan',
    'presentation: Language test slides',
  ]);

  // Filling the slot opens search at its category: the kirtan, not the language slides.
  await win.getByTestId('playlist-item').nth(1).click();
  const fill = win.getByTestId('fill-slot');
  await expect(fill.getByTestId('slot-filter')).toHaveValue('Kirtan');
  await expect(fill.getByTestId('slot-choice')).toHaveCount(1);
  await expect(fill.getByTestId('slot-choice')).toContainText('Sample kirtan');
  await fill.getByTestId('slot-search').fill('language');
  await expect(fill.getByTestId('slot-choice')).toHaveCount(0);
  await fill.getByTestId('slot-filter').selectOption('');
  await expect(fill.getByTestId('slot-choice')).toContainText('Language test slides');
  await expectNoSeriousA11yIssues(win, 'filling a slot');
  await fill.getByTestId('slot-search').fill('');
  await fill.getByTestId('slot-filter').selectOption('Kirtan');
  await fill.getByTestId('slot-choice').first().click();
  await expect(fill).toHaveCount(0);
  await expect
    .poll(() => itemTexts(win))
    .toEqual([
      'header: Opening',
      'presentation: Sample kirtan (placeholder)',
      'presentation: Language test slides',
    ]);

  // Run it: the kirtan's slides, then on into the next item.
  await win.getByTestId('playlist-item').nth(1).click();
  await win.getByTestId('slide-thumb').first().click();
  const live = win.getByTestId('live-text');
  await expect(live).toContainText('Sample kirtan (placeholder) · slide 1 of 3');
  for (let i = 0; i < 3; i++) await win.keyboard.press('ArrowRight');
  await expect(live).toContainText('Language test slides · slide 1 of 3');

  // The template is unchanged, and the week's playlist too.
  expect(
    await win.evaluate(
      async ({ templateId, playlistId }) => {
        const d = (globalThis as PageGlobals).drashti;
        return [(await d.playlists.items(templateId)).length, (await d.playlists.items(playlistId)).length];
      },
      { templateId, playlistId },
    ),
  ).toEqual([3, 3]);
  await app.close();
});

test('an example template makes a playlist of slots, with a slot added by hand', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.getByTestId('playlist-view-tab-templates').click();
  await win.getByRole('button', { name: 'New playlist from Example: Ravi Sabha' }).click();
  await win.getByRole('textbox', { name: 'Playlist name' }).press('Enter');
  await expect(win.getByTestId('playlist-title')).toContainText('Ravi Sabha');
  const slots = win.getByTestId('playlist-item').and(win.locator('[data-kind="placeholder"]'));
  await expect(slots).toHaveCount(9);
  await expect(slots.first()).toHaveAccessibleName('Slot: Dhun (Dhun). Press to choose what goes here.');
  // A slot added by hand, with a category of its own.
  await win.getByRole('button', { name: 'Playlist actions' }).click();
  await win.getByRole('menuitem', { name: 'Add a slot…' }).click();
  const add = win.getByTestId('add-slot');
  await add.getByTestId('slot-label').fill('Placeholder extra kirtan');
  await add.getByTestId('slot-category').selectOption('Thal');
  await expectNoSeriousA11yIssues(win, 'adding a slot');
  await add.getByRole('button', { name: 'Add slot' }).click();
  await expect(slots).toHaveCount(10);
  await expect(slots.last()).toContainText('Placeholder extra kirtan');
  await expect(slots.last()).toContainText('Thal');
  await app.close();
});

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const)
  test(`the template dialogs fit at ${width} x ${height}`, async () => {
    const { app } = await launchApp();
    const win = await operatorPage(app);
    await win.setViewportSize({ width, height });
    await weekPlaylist(win);
    await win.getByTestId('playlist-node').first().click();
    await win.getByRole('button', { name: 'Playlist actions' }).click();
    await win.getByRole('menuitem', { name: 'Save as template…' }).click();
    await expectFits(win.getByTestId('save-template'), `saving a template at ${width} x ${height}`);
    await win.getByTestId('save-template').getByRole('button', { name: 'Cancel' }).click();
    await win.getByRole('button', { name: 'Playlist actions' }).click();
    await win.getByRole('menuitem', { name: 'Add a slot…' }).click();
    await win.getByTestId('add-slot').getByRole('button', { name: 'Add slot' }).click();
    await win.getByTestId('playlist-item').last().click();
    await expectFits(win.getByTestId('fill-slot'), `filling a slot at ${width} x ${height}`);
    await app.close();
  });

test('timers in templates: an item starts a countdown as it goes up, kept by the template and its playlists; a slot renamed and re-categorised', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const { playlistId } = await weekPlaylist(win);
  const timerId = await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.timers.create({
      name: 'Placeholder pravachan',
      kind: 'countdown',
      durationMs: 30 * 60_000,
      targetTime: null,
      allowsOverrun: false,
    });
    if (!made.ok) throw new Error(made.message);
    return made.id;
  });

  // In the window: the language slides item starts the countdown when it goes up.
  await win.getByTestId('playlist-node').first().click();
  const slidesItem = win.getByTestId('playlist-item').filter({ hasText: 'Language test slides' });
  await slidesItem.click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Timers when it goes up…' }).click();
  const cues = win.getByTestId('timer-cues');
  await cues.getByTestId('add-timer-cue').click();
  await expect(cues.getByRole('combobox', { name: 'What cue 1 does' })).toHaveValue('start');
  await expect(cues.getByRole('combobox', { name: 'The timer cue 1 is for' })).toHaveValue(timerId);
  await expectNoSeriousA11yIssues(win, 'an item’s timer cues');
  await cues.getByTestId('save-timer-cues').click();
  await expect(cues).toHaveCount(0);
  await expect(slidesItem.getByTestId('item-timer-cues')).toHaveText('starts “Placeholder pravachan”');

  // A template keeps it; a playlist made from the template gets it, and running the item starts the countdown.
  const made = await win.evaluate(async (pl) => {
    const d = (globalThis as PageGlobals).drashti;
    const template = await d.playlists.saveAsTemplate(pl, { name: 'Placeholder template', slots: [] });
    if (!template.ok) throw new Error(template.message);
    const next = await d.playlists.newFromTemplate(template.ids[0] ?? '', 'Placeholder next week', null);
    if (!next.ok) throw new Error(next.message);
    const items = await d.playlists.items(next.ids[0] ?? '');
    const item = items.find((i) => i.label === 'Language test slides');
    return { templateId: template.ids[0] ?? '', playlistId: next.ids[0] ?? '', item };
  }, playlistId);
  expect(made.item).toMatchObject({ timers: [{ timerId, action: 'start' }] });
  await win.evaluate(
    ({ pl, itemId }) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'playItem', playlistId: pl, itemId }),
    { pl: made.playlistId, itemId: made.item?.id ?? '' },
  );
  await expect
    .poll(async () => {
      const snap = await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
      return snap.state.timers.find((t) => t.id === timerId)?.startedAt !== null;
    })
    .toBe(true);

  // A slot: renamed, and asking for a Shastra passage now.
  await win.evaluate(async (tid) => {
    const added = await (globalThis as PageGlobals).drashti.playlists.addSlot(tid, null, {
      label: 'Placeholder slot',
      category: 'Kirtan',
    });
    if (!added.ok) throw new Error(added.message);
  }, made.templateId);
  await win.getByTestId('playlists-back').click();
  await win.getByTestId('playlist-view-tab-templates').click();
  await win.getByTestId('template-node').filter({ hasText: 'Placeholder template' }).click();
  const slot = win.getByTestId('playlist-item').filter({ hasText: 'Placeholder slot' });
  await slot.click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Edit slot…' }).click();
  const edit = win.getByTestId('edit-slot');
  await expect(edit.getByTestId('slot-category')).toHaveValue('Kirtan');
  await expectNoSeriousA11yIssues(win, 'editing a slot');
  await edit.getByTestId('slot-label').fill('Placeholder reading');
  await edit.getByTestId('slot-category').selectOption('Shastra');
  await edit.getByTestId('save-slot').click();
  await expect(edit).toHaveCount(0);
  const renamed = win.getByTestId('playlist-item').filter({ hasText: 'Placeholder reading' });
  await expect(renamed).toContainText('A slot · Shastra');
  await app.close();
});
