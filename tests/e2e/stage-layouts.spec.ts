import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { AUDIENCE_BOX_MIN, newStageBox } from '../../src/shared/stage-layouts';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode, TABLET } from './devices';
import type { PageGlobals } from './helpers';
import {
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  setUpScreen,
} from './helpers';

/*
 * Stage layouts (Session 11): with none chosen a stage screen is the Standard
 * stage screen, drawn as before; a layout made in the editor puts each box
 * where it was set; a stage group gets its layout through the live Look; the
 * stage display in a browser shows the same layout. The audience picture box
 * (Session 50) draws what the hall's screens draw, black-out and the logo
 * too, under the stage message; the editor makes it no smaller than its line
 * needs, and leaves one saved smaller as it was (Session 53). The seeded
 * sample kirtan and placeholder words only.
 */

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/** The output showing this screen. */
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

/** Each box of a stage layout on a page: its kind, words, and where it is on the 1920 x 1080 canvas. */
const boxesOn = (page: Page) =>
  page.getByTestId('stage-layout').evaluate((layout) => {
    const r = layout.getBoundingClientRect();
    const scale = r.width / 1920;
    return [...layout.querySelectorAll<HTMLElement>('[data-stage-box]')].map((b) => {
      const box = b.getBoundingClientRect();
      return {
        kind: b.dataset['stageBox'],
        x: Math.round((box.left - r.left) / scale),
        y: Math.round((box.top - r.top) / scale),
        width: Math.round(box.width / scale),
        height: Math.round(box.height / scale),
        text: b.innerText.replace(/\s+/gu, ' ').trim(),
      };
    });
  });

test('Standard is the stage screen as before; a layout made in the editor puts each box where it was set, here and in a browser', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...NETWORK_ENV, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const stageId = await setUpScreen(win, 'Stage', 0);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.name === 'Stage');
    await d.screens.setGroupRole(group?.id ?? '', 'stage');
    await d.engine.dispatch({ type: 'setStageMessage', text: 'Placeholder: two minutes' });
  });
  const stage = await outputFor(app, stageId);
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Sample kirtan/ })
    .click();
  await win.getByTestId('slide-thumb').first().click();

  // Standard: the stage screen as it always was (the same component, the same parts).
  await expect(stage.getByTestId('stage-view')).toBeVisible();
  await expect(stage.getByTestId('stage-layout')).toHaveCount(0);
  await expect(stage.getByTestId('stage-current')).toContainText('નમૂનાની પહેલી પંક્તિ');
  await expect(stage.getByTestId('stage-message')).toHaveText('Placeholder: two minutes');
  await expect(stage.getByTestId('stage-clock')).toBeVisible();
  await expect(stage.getByTestId('stage-next')).toBeVisible();

  // The editor, from the stage group's settings in Screens: Duplicate Standard, then place boxes.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await win.getByTestId('screen-group').first().getByTestId('edit-stage-layouts').click();
  const editor = win.getByTestId('stage-layout-editor');
  await expect(editor).toBeVisible();
  await expect(editor.getByText('Standard is the stage screen Drashti comes with')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the stage layout editor, Standard');
  await editor.getByTestId('stage-layout-duplicate').click();
  await expect(editor.getByTestId('stage-box-list').getByRole('button')).toHaveCount(7);
  await editor.getByTestId('stage-layout-name').fill('Placeholder band layout');
  // A fixed text box, placed with the fields.
  await editor.getByTestId('stage-box-kind').selectOption('text');
  await editor.getByTestId('stage-box-add').click();
  const settings = editor.getByTestId('stage-box-settings');
  await settings.getByTestId('stage-box-text').fill('Placeholder band: watch the clock');
  await settings.getByRole('spinbutton', { name: 'Across' }).fill('100');
  await settings.getByRole('spinbutton', { name: 'Down' }).fill('900');
  await settings.getByRole('spinbutton', { name: 'Width' }).fill('800');
  await settings.getByRole('spinbutton', { name: 'Height' }).fill('120');
  await settings.getByTestId('stage-box-fit').uncheck();
  await settings.getByTestId('stage-box-size').fill('48');
  // The clock, dragged about 150 px to the left on the canvas (from 1162: no line to snap to near there).
  await editor.getByTestId('stage-box-list').getByRole('button', { name: 'Clock', exact: true }).click();
  const canvas = editor.getByTestId('stage-layout-canvas-stage');
  const scale = Number(await canvas.getAttribute('data-scale'));
  const chosen = await canvas.locator('[data-selected="true"]').boundingBox();
  if (!chosen) throw new Error('no clock box');
  const from = { x: chosen.x + chosen.width / 2, y: chosen.y + chosen.height / 2 };
  await win.mouse.move(from.x, from.y);
  await win.mouse.down();
  for (let i = 1; i <= 5; i++) await win.mouse.move(from.x - (150 * scale * i) / 5, from.y);
  await win.mouse.up();
  const across = settings.getByRole('spinbutton', { name: 'Across' });
  await expect.poll(async () => Math.abs(Number(await across.inputValue()) - 1012)).toBeLessThanOrEqual(3);
  const clockX = Number(await across.inputValue());
  // And one pixel down with the arrow key, from the canvas.
  await canvas.focus();
  await win.keyboard.press('ArrowDown');
  await expect(settings.getByRole('spinbutton', { name: 'Down' })).toHaveValue('187');
  await expectNoSeriousA11yIssues(win, 'the stage layout editor, a box chosen');
  await editor.getByTestId('stage-layout-save').click();
  await expect(editor.getByTestId('stage-layout-list')).toContainText('Placeholder band layout');
  await editor.getByRole('button', { name: 'Close stage layouts' }).click();

  // Not on the stage until the live Look gives it to the stage group.
  await expect(stage.getByTestId('stage-view')).toBeVisible();
  const choose = win.getByTestId('screen-group').first().getByTestId('look-stage-layout');
  await choose.selectOption({ label: 'Placeholder band layout' });
  await win.getByRole('button', { name: 'Close screens' }).click();
  await expect(stage.getByTestId('stage-layout')).toBeVisible();
  await expect(stage.getByTestId('stage-view')).toHaveCount(0);
  const boxes = await boxesOn(stage);
  expect(boxes.map((b) => b.kind)).toEqual([
    'stageMessage',
    'current',
    'screensState',
    'notes',
    'clock',
    'timer',
    'next',
    'text',
  ]);
  // Each box where it was set (Duplicate of Standard put the clock at 1162, 186; it was dragged left, and 1 down).
  expect(boxes.find((b) => b.kind === 'clock')).toMatchObject({ x: clockX, y: 187, width: 710, height: 130 });
  expect(boxes.find((b) => b.kind === 'text')).toMatchObject({
    x: 100,
    y: 900,
    width: 800,
    height: 120,
    text: 'Placeholder band: watch the clock',
  });
  expect(boxes.find((b) => b.kind === 'current')).toMatchObject({ x: 48, y: 186, width: 1066, height: 560 });
  expect(boxes.find((b) => b.kind === 'current')?.text).toContain('નમૂનાની પહેલી પંક્તિ');
  expect(boxes.find((b) => b.kind === 'stageMessage')?.text).toBe('Placeholder: two minutes');

  // The stage display in a browser: the same layout, the same boxes in the same places, the same words.
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'stage', 'Placeholder tablet');
  const tablet = await device('chromium', TABLET);
  try {
    await pairByQr(tablet.page, base, code, '/stage');
    await expect(tablet.page.getByTestId('stage-layout')).toBeVisible();
    const inBrowser = await boxesOn(tablet.page);
    expect(inBrowser.map((b) => b.kind)).toEqual(boxes.map((b) => b.kind));
    inBrowser.forEach((b, i) => {
      const there = boxes[i];
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(Math.abs(b[key] - (there?.[key] ?? NaN)), `${b.kind} ${key}`).toBeLessThanOrEqual(1);
    });
    for (const kind of ['text', 'current', 'stageMessage', 'next'])
      expect(inBrowser.find((b) => b.kind === kind)?.text, kind).toBe(
        boxes.find((b) => b.kind === kind)?.text,
      );
  } finally {
    await tablet.close();
  }
  await app.close();
});

/**
 * What a picture of the show draws, read from its Scene (Session 50: the hall's output and a stage layout's
 * audience picture box must draw the same): its canvas and Look's layers, the background's colour, the
 * slide's words, the messages, black-out and the logo.
 */
const sceneOn = (scene: Locator) =>
  scene.evaluate((root) => {
    const background = root.querySelector<HTMLElement>('[data-layer="background"]');
    const slide = root.querySelector<HTMLElement>('[data-layer="slide"]');
    return {
      canvas: root.getAttribute('data-canvas'),
      layers: root.getAttribute('data-look-layers'),
      background: background ? getComputedStyle(background).backgroundColor : null,
      words: slide ? slide.innerText.replace(/\s+/gu, ' ').trim() : null,
      messages: [...root.querySelectorAll<HTMLElement>('[data-message]')].map((m) => m.innerText.trim()),
      blackout: root.querySelector('[data-testid="blackout"]') !== null,
      logo: root.querySelector('[data-testid="logo"]') !== null,
    };
  });

test('the audience picture, live, as a stage layout box: what the hall shows, black-out and the logo too, under the stage message', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const hallId = await setUpScreen(win, 'Hall', 0);
  const stageId = await setUpScreen(win, 'Stage', 1);
  const hallGroup = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const groups = (await d.screens.get()).groups;
    const set = await d.screens.setGroupRole(groups.find((g) => g.name === 'Stage')?.id ?? '', 'stage');
    if (!set.ok) throw new Error(set.message);
    return groups.find((g) => g.name === 'Hall')?.id ?? '';
  });

  // In the stage layout editor, beside the other boxes; added to a copy of Standard, it goes under them all.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await win.getByTestId('edit-stage-layouts').click();
  const editor = win.getByTestId('stage-layout-editor');
  await expect(editor).toBeVisible();
  await editor.getByTestId('stage-layout-duplicate').click();
  await editor.getByTestId('stage-layout-name').fill('Placeholder hall picture layout');
  const kinds = editor.getByTestId('stage-box-kind');
  await expect(kinds.locator('option[value="audience"]')).toHaveText('The audience picture, live');
  await kinds.selectOption('audience');
  await editor.getByTestId('stage-box-add').click();
  const list = editor.getByTestId('stage-box-list').getByRole('button');
  await expect(list).toHaveCount(8);
  await expect(list.first()).toHaveText('The audience picture, live');
  await expect(list.first()).toHaveAttribute('aria-pressed', 'true');
  // Its settings: its place and size (made 16:9), no text size, colour or alignment.
  const settings = editor.getByTestId('stage-box-settings');
  await expect(settings.getByTestId('stage-box-audience-note')).toContainText('at 16:9 with black around it');
  await expect(settings.getByTestId('stage-box-color')).toHaveCount(0);
  await expect(settings.getByTestId('stage-box-fit')).toHaveCount(0);
  await expect(settings.getByRole('spinbutton', { name: 'Width' })).toHaveValue('960');
  await expect(settings.getByRole('spinbutton', { name: 'Height' })).toHaveValue('540');
  // Here, the whole stage canvas.
  for (const [name, value] of [
    ['Across', '0'],
    ['Down', '0'],
    ['Width', '1920'],
    ['Height', '1080'],
  ] as const)
    await settings.getByRole('spinbutton', { name }).fill(value);
  await expectNoSeriousA11yIssues(win, 'the stage layout editor, the audience picture box chosen');
  await editor.getByTestId('stage-layout-save').click();
  await expect(editor.getByTestId('stage-layout-list')).toContainText('Placeholder hall picture layout');
  await editor.getByRole('button', { name: 'Close stage layouts' }).click();
  await win.getByTestId('look-stage-layout').selectOption({ label: 'Placeholder hall picture layout' });
  await win.getByRole('button', { name: 'Close screens' }).click();

  const hall = await outputFor(app, hallId);
  const stage = await outputFor(app, stageId);
  await outputReady(hall);
  const box = stage.locator('[data-stage-box="audience"]');
  await expect(box).toBeVisible();
  await expect(box.getByTestId('stage-audience')).toHaveAttribute('data-hall-group', hallGroup);
  // Bottom to top: the picture first, so the stage message, the clock and the timer draw over it.
  expect((await boxesOn(stage)).map((b) => b.kind)).toEqual([
    'audience',
    'stageMessage',
    'current',
    'screensState',
    'notes',
    'clock',
    'timer',
    'next',
  ]);

  // A slide over a colour, and a message: the box draws exactly what the hall's output draws.
  const presentationId = await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.library.newFromWords(
      'Placeholder hall picture',
      'Placeholder words for the hall',
    );
    if (!made.ok) throw new Error(made.message);
    return made.id;
  });
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
  await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#1f6f8b' } });
  await dispatch(win, {
    type: 'showMessage',
    message: { id: 'placeholder-message', text: 'Placeholder message for the hall' },
  });
  await dispatch(win, { type: 'setStageMessage', text: 'Placeholder: two minutes' });
  const inHall = hall.getByTestId('scene');
  const inBox = box.getByTestId('scene');
  await expect
    .poll(() => sceneOn(inHall))
    .toMatchObject({
      canvas: '1920x1080',
      background: 'rgb(31, 111, 139)',
      words: expect.stringMatching(/placeholder words for the hall/iu),
      messages: ['Placeholder message for the hall'],
      blackout: false,
      logo: false,
    });
  await expect.poll(() => sceneOn(inBox)).toEqual(await sceneOn(inHall));

  // The stage message draws over the picture: where it is, it is what the stage sees.
  const message = stage.getByTestId('stage-box-message');
  await expect(message).toHaveText('Placeholder: two minutes');
  expect(
    await message.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        message: hit !== null && el.contains(hit),
        picture: (hit?.closest('[data-stage-box="audience"]') ?? null) !== null,
      };
    }),
  ).toEqual({ message: true, picture: false });

  // The hall's own settings in the live Look, never the stage group's: messages left out of the hall go from
  // the box too.
  await win.evaluate(async (group) => {
    const d = (globalThis as PageGlobals).drashti;
    const set = await d.looks.setGroup((await d.looks.list()).liveId, group, {
      layers: ['background', 'slide', 'props', 'ticker', 'masks'],
    });
    if (!set.ok) throw new Error(set.message);
  }, hallGroup);
  await expect.poll(async () => (await sceneOn(inHall)).messages).toEqual([]);
  await expect.poll(() => sceneOn(inBox)).toEqual(await sceneOn(inHall));

  // The hall's canvas: its screen's, as its output draws it.
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.screens.updateScreen(id, { canvasWidth: 1280, canvasHeight: 720 }),
    hallId,
  );
  await expect.poll(async () => (await sceneOn(inHall)).canvas).toBe('1280x720');
  await expect.poll(() => sceneOn(inBox)).toEqual(await sceneOn(inHall));

  // Black-out and the logo show in the box, as the hall sees them; the stage's own boxes stay.
  await dispatch(win, { type: 'setBlackout', on: true });
  await expect(inHall.getByTestId('blackout')).toHaveCount(1);
  await expect(inBox.getByTestId('blackout')).toHaveCount(1);
  await expect(message).toHaveText('Placeholder: two minutes');
  await dispatch(win, { type: 'setBlackout', on: false });
  await expect(inBox.getByTestId('blackout')).toHaveCount(0);
  await dispatch(win, {
    type: 'showLogo',
    prop: { id: 'placeholder-logo', name: 'Placeholder logo', elements: [] },
  });
  await expect(inHall.getByTestId('logo')).toHaveCount(1);
  await expect(inBox.getByTestId('logo')).toHaveCount(1);
  await expect.poll(() => sceneOn(inBox)).toEqual(await sceneOn(inHall));
  await dispatch(win, { type: 'hideLogo' });
  await expect(inBox.getByTestId('logo')).toHaveCount(0);
  await app.close();
});

/** A layout saved before Session 53, with the audience picture box smaller than the editor makes it now. */
const SMALL_LAYOUT = 'Placeholder small hall picture layout';

test('the editor makes the audience picture box no smaller than its line needs, by its fields and its handles, and leaves one saved smaller as it was', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  // A stage group, with no screen and no audience group, and the layout saved smaller.
  const small = {
    ...newStageBox('audience', 'placeholder-hall-box'),
    frame: { x: 900, y: 500, width: 96, height: 54 },
  };
  await win.evaluate(
    async ({ small, name }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.screens.createGroup('Stage');
      if (!made.ok) throw new Error(made.message);
      const role = await d.screens.setGroupRole(
        made.snapshot.groups.find((g) => g.name === 'Stage')?.id ?? '',
        'stage',
      );
      if (!role.ok) throw new Error(role.message);
      const saved = await d.stageLayouts.save(null, { name, background: '#000000', boxes: [small] });
      if (!saved.ok) throw new Error(saved.message);
    },
    { small, name: SMALL_LAYOUT },
  );
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await win.getByTestId('edit-stage-layouts').click();
  const editor = win.getByTestId('stage-layout-editor');
  await expect(editor).toBeVisible();
  await editor.getByTestId('stage-layout-list').getByRole('button', { name: SMALL_LAYOUT }).click();
  await editor
    .getByTestId('stage-box-list')
    .getByRole('button', { name: 'The audience picture, live' })
    .click();
  const settings = editor.getByTestId('stage-box-settings');
  const field = (name: string) => settings.getByRole('spinbutton', { name, exact: true });
  const save = editor.getByTestId('stage-layout-save');

  // Saved smaller: left as it was, with nothing to save, and moved by the arrow keys at the size it was.
  await expect(field('Width')).toHaveValue('96');
  await expect(field('Height')).toHaveValue('54');
  await expect(save).toBeDisabled();
  const canvas = editor.getByTestId('stage-layout-canvas-stage');
  await canvas.focus();
  await win.keyboard.press('ArrowRight');
  await expect(field('Across')).toHaveValue('901');
  await expect(field('Width')).toHaveValue('96');
  await expect(field('Height')).toHaveValue('54');

  // A size typed below its smallest (a sixth of the stage each way): its smallest, once the field is left.
  await field('Width').fill('100');
  await field('Width').blur();
  await expect(field('Width')).toHaveValue(String(AUDIENCE_BOX_MIN.width));
  await field('Height').fill('50');
  await field('Height').blur();
  await expect(field('Height')).toHaveValue(String(AUDIENCE_BOX_MIN.height));
  // A size typed figure by figure, below its smallest on the way: as typed (each figure was taken as it came).
  await field('Width').fill('');
  await field('Width').pressSequentially('400');
  await field('Width').blur();
  await expect(field('Width')).toHaveValue('400');

  // Its corner handle dragged in far past its smallest: its smallest, the other corner where it was.
  const scale = Number(await canvas.getAttribute('data-scale'));
  const handle = await canvas.getByTestId('canvas-handle-se').boundingBox();
  if (!handle) throw new Error('no handle');
  const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await win.mouse.move(from.x, from.y);
  await win.mouse.down();
  for (let i = 1; i <= 5; i++)
    await win.mouse.move(from.x - (300 * scale * i) / 5, from.y - (200 * scale * i) / 5);
  await win.mouse.up();
  await expect(field('Width')).toHaveValue(String(AUDIENCE_BOX_MIN.width));
  await expect(field('Height')).toHaveValue(String(AUDIENCE_BOX_MIN.height));
  await expect(field('Across')).toHaveValue('901');
  await expect(field('Down')).toHaveValue('500');
  // There its line reads at a box's label's size (30 px) at the least: no audience group here.
  const line = editor.getByTestId('stage-audience-none');
  await expect(line).toHaveText('No audience screens');
  await expect.poll(async () => Number(await line.getAttribute('data-fit-size'))).toBeGreaterThanOrEqual(30);

  // Dragged out again, it grows as ever; saved, the layout keeps what the editor shows.
  const corner = await canvas.getByTestId('canvas-handle-se').boundingBox();
  if (!corner) throw new Error('no handle');
  const at = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };
  await win.mouse.move(at.x, at.y);
  await win.mouse.down();
  for (let i = 1; i <= 5; i++)
    await win.mouse.move(at.x + (200 * scale * i) / 5, at.y + (100 * scale * i) / 5);
  await win.mouse.up();
  await expect
    .poll(async () => Number(await field('Width').inputValue()))
    .toBeGreaterThan(AUDIENCE_BOX_MIN.width);
  await expect
    .poll(async () => Number(await field('Height').inputValue()))
    .toBeGreaterThan(AUDIENCE_BOX_MIN.height);
  const shown = {
    x: Number(await field('Across').inputValue()),
    y: Number(await field('Down').inputValue()),
    width: Number(await field('Width').inputValue()),
    height: Number(await field('Height').inputValue()),
  };
  await save.click();
  await expect(save).toBeDisabled();
  const kept = await win.evaluate(
    async (name) =>
      (await (globalThis as PageGlobals).drashti.stageLayouts.list()).find((l) => l.name === name)?.boxes[0]
        ?.frame,
    SMALL_LAYOUT,
  );
  expect(kept).toEqual(shown);
  await app.close();
});
