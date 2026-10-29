import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { newStageBox, type StageBox } from '../../src/shared/stage-layouts';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode, TABLET } from './devices';
import { expectFits } from './fit';
import {
  chooseMenuItem,
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  relaunchApp,
  setUpScreen,
} from './helpers';
import { holdClock } from './placeholder-slides';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The stage screen (Session 55, Part 2): one layout chosen for every stage screen in the Stage screen panel under
 * LIVE (no longer per Look), kept over a restart; Stage off shows exactly the audience picture on the stage screens,
 * which stay; the video input box, which shows the chosen video input from the same capture as the hall's screens;
 * LIVE's one press for that input on the audience, which the stage never follows; the editor's New, Duplicate,
 * Rename and Delete, each with Undo, and a box deleted with Undo; and the field that changes what a stage timer
 * counts to. Chromium's fake camera stands in for the video mixer (never a real camera's picture); placeholder names
 * and words only.
 */

const TWO_STAGES = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '2' };
const FAKE = { DRASHTI_TEST_FAKE_DEVICES: '1' };
/** Chromium's fake camera, as the computer names it. */
const DEVICE = 'fake_device_0';

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

/** Give the group of this name the stage's role. */
const makeStage = (win: Page, name: string) =>
  win.evaluate(async (name) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.name === name);
    if (!group) throw new Error(`no group ${name}`);
    const set = await d.screens.setGroupRole(group.id, 'stage');
    if (!set.ok) throw new Error(set.message);
    return group.id;
  }, name);

/** Save a stage layout of these boxes (not chosen); its id. */
const saveLayout = (win: Page, name: string, boxes: StageBox[]) =>
  win.evaluate(
    async ({ name, boxes }) => {
      const saved = await (globalThis as PageGlobals).drashti.stageLayouts.save(null, {
        name,
        background: '#000000',
        boxes,
      });
      if (!saved.ok) throw new Error(saved.message);
      return saved.id;
    },
    { name, boxes },
  );

/** The layout every stage screen shows now, from the engine's state: its id, or null for Standard. */
const chosenNow = (win: Page) =>
  win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.stage?.layout?.id ?? null,
  );

/** What a stage screen shows: 'layout' (and which), 'standard', or 'audience' (Stage off). */
async function shows(page: Page): Promise<string> {
  const root = page.getByTestId('output-root');
  const what = (await root.getAttribute('data-stage-shows')) ?? '';
  if (what !== 'layout') return what;
  return `layout ${(await page.getByTestId('stage-layout').getAttribute('data-layout')) ?? ''}`;
}

const dispatch = (win: Page, command: Parameters<PageGlobals['drashti']['engine']['dispatch']>[0]) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);

const background = (win: Page) =>
  win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
  );

/** A placeholder presentation of two slides; its id. */
const placeholderWords = (win: Page) =>
  win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.library.newFromWords(
      'Placeholder stage words',
      'Placeholder stage line one\n\nPlaceholder stage line two',
    );
    if (!made.ok) throw new Error(made.message);
    return made.id;
  });

test('one layout for every stage screen: the Stage screen panel’s Layout or a phone’s changes them all at once, a tablet’s too, and it stays chosen after a restart', async () => {
  test.setTimeout(240_000);
  const { app, userData } = await launchApp({ ...TWO_STAGES, ...NETWORK_ENV });
  const win = await operatorPage(app);
  await operatorReady(win);
  const oneId = await setUpScreen(win, 'Stage one', 1);
  const twoId = await setUpScreen(win, 'Stage two', 2);
  await makeStage(win, 'Stage one');
  await makeStage(win, 'Stage two');
  const one = await outputFor(app, oneId);
  const two = await outputFor(app, twoId);
  const band = await saveLayout(win, 'Placeholder band', [newStageBox('clock', 'clock')]);
  const other = await saveLayout(win, 'Placeholder other', [
    { ...newStageBox('text', 'words'), text: 'Placeholder other layout' },
  ]);
  // Standard until one is chosen.
  await expect.poll(() => shows(one)).toBe('standard');
  expect(await shows(two)).toBe('standard');

  // The Layout picker in the Stage screen panel under LIVE: Standard and every layout.
  const panel = win.getByTestId('stage-message-control');
  const picker = panel.getByTestId('stage-layout-choice');
  await expect(picker).toHaveValue('standard');
  await expect(picker.locator('option')).toHaveText(['Standard', 'Placeholder band', 'Placeholder other']);
  await picker.selectOption({ label: 'Placeholder band' });
  // Every stage screen at once.
  await expect.poll(() => shows(one)).toBe(`layout ${band}`);
  await expect.poll(() => shows(two)).toBe(`layout ${band}`);
  expect(await chosenNow(win)).toBe(band);
  // The panel's own picture of the stage shows it too.
  await expect(panel.getByTestId('stage-preview').getByTestId('stage-layout')).toHaveAttribute(
    'data-layout',
    band,
  );
  // Screens no longer offers a layout per Look: it says where it is chosen.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await expect(win.getByTestId('look-stage-layout')).toHaveCount(0);
  await expect(win.getByTestId('look-stage-layout-note').first()).toContainText('Stage screen panel');
  await win.getByRole('button', { name: 'Close screens' }).click();

  // A tablet's stage page follows the same choice.
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'stage', 'Placeholder stage tablet');
  const tablet = await device('chromium', TABLET);
  try {
    await pairByQr(tablet.page, base, code, '/stage');
    await expect(tablet.page.getByTestId('stage-layout')).toHaveAttribute('data-layout', band);
    await picker.selectOption({ label: 'Placeholder other' });
    await expect(tablet.page.getByTestId('stage-layout')).toHaveAttribute('data-layout', other);
    await expect(tablet.page.getByTestId('stage-layout')).toContainText('Placeholder other layout');
  } finally {
    await tablet.close();
  }
  await expect.poll(() => shows(one)).toBe(`layout ${other}`);
  await expect.poll(() => shows(two)).toBe(`layout ${other}`);

  // A phone's Layout, in its Stage screen section: the same choice, both ways.
  const phoneCode = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  try {
    await pairByQr(phone.page, base, phoneCode, '/remote');
    await expect(phone.page.getByTestId('connection')).toHaveText('Connected');
    await phone.page.getByTestId('remote-tab-more').click();
    const onPhone = phone.page.getByTestId('remote-stage-layout');
    await expect(onPhone).toHaveValue(other);
    await expect(onPhone.locator('option')).toHaveText(['Standard', 'Placeholder band', 'Placeholder other']);
    await onPhone.selectOption({ label: 'Placeholder band' });
    await expect.poll(() => shows(one)).toBe(`layout ${band}`);
    await expect.poll(() => shows(two)).toBe(`layout ${band}`);
    await expect(picker).toHaveValue(band);
    // Chosen in the window: the phone follows.
    await picker.selectOption({ label: 'Placeholder other' });
    await expect(onPhone).toHaveValue(other);
    await expectNoSeriousA11yIssues(phone.page, 'the phone’s Stage screen section with its Layout');
  } finally {
    await phone.close();
  }
  await expect.poll(() => shows(one)).toBe(`layout ${other}`);
  await expectNoSeriousA11yIssues(
    win,
    'the Stage screen panel with its Layout picker',
    '[data-testid="stage-message-control"]',
  );

  // A restart: still chosen, on every stage screen.
  await app.close();
  const again = await relaunchApp(userData, TWO_STAGES);
  const next = await operatorPage(again.app);
  await operatorReady(next);
  await expect.poll(() => chosenNow(next)).toBe(other);
  await expect(next.getByTestId('stage-layout-choice')).toHaveValue(other);
  const oneAgain = await outputFor(again.app, oneId);
  const twoAgain = await outputFor(again.app, twoId);
  await expect.poll(() => shows(oneAgain)).toBe(`layout ${other}`);
  await expect.poll(() => shows(twoAgain)).toBe(`layout ${other}`);
  // Standard again, from the picker.
  await next.getByTestId('stage-layout-choice').selectOption({ label: 'Standard' });
  await expect.poll(() => shows(oneAgain)).toBe('standard');
  await expect.poll(() => shows(twoAgain)).toBe('standard');
  await again.app.close();
});

test('Stage off: the stage screens stay, the same windows, showing exactly the audience picture; the audience is as it was; on, their layout again', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const hallId = await setUpScreen(win, 'Main Hall', 0);
  const stageId = await setUpScreen(win, 'Stage', 1);
  await makeStage(win, 'Stage');
  const hall = await outputFor(app, hallId);
  const stage = await outputFor(app, stageId);
  const band = await saveLayout(win, 'Placeholder band', [newStageBox('clock', 'clock')]);
  await win.evaluate((id) => (globalThis as PageGlobals).drashti.stageLayouts.choose(id), band);
  const words = await placeholderWords(win);
  await dispatch(win, { type: 'goLive', presentationId: words, slideIndex: 0 });
  await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#1f3a5f' } });
  await expect(hall.locator('[data-layer="slide"]')).toContainText('Placeholder stage line one');
  await expect.poll(() => shows(stage)).toBe(`layout ${band}`);
  const hallLayers = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers,
  );

  // Turned off, as the top bar's switch does (asked first, the stage screens always showing something).
  const turned = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.screenSwitches.turn('stage', false),
  );
  expect(turned).toMatchObject({ ok: true, switches: { audience: true, stage: false } });
  await expect.poll(() => shows(stage)).toBe('audience');
  // The same window, open, and the screen says so: showing.
  expect(stage.isClosed()).toBe(false);
  expect(outputPages(app)).toHaveLength(2);
  const status = await win.evaluate(async (id) => {
    const st = (await (globalThis as PageGlobals).drashti.screens.get()).status.find(
      (s) => s.screenId === id,
    );
    return st?.state ?? null;
  }, stageId);
  expect(status).toBe('showing');
  // Exactly what the hall shows: its words and its background, nothing of the stage's own.
  const picture = stage.getByTestId('stage-audience-picture');
  await expect(picture.locator('[data-layer="slide"]')).toContainText('Placeholder stage line one');
  await expect(picture.locator('[data-layer="background"]')).toHaveCSS('background-color', 'rgb(31, 58, 95)');
  await expect(stage.getByTestId('stage-layout')).toHaveCount(0);
  await expect(stage.getByTestId('stage-view')).toHaveCount(0);
  // Next on the hall: the stage shows it too.
  await dispatch(win, { type: 'next' });
  await expect(picture.locator('[data-layer="slide"]')).toContainText('Placeholder stage line two');
  // The Stage screen panel says so.
  await expect(win.getByTestId('stage-off-note')).toContainText(
    'every stage screen shows the audience picture',
  );
  // Nothing the stage did changed the audience: the hall's layers as they were but for Next.
  const after = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers,
  );
  expect(after.background).toEqual(hallLayers.background);
  expect(hall.isClosed()).toBe(false);

  // On again: the layout, in the same window.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.screenSwitches.turn('stage', true));
  await expect.poll(() => shows(stage)).toBe(`layout ${band}`);
  await expect(win.getByTestId('stage-off-note')).toHaveCount(0);
  expect(stage.isClosed()).toBe(false);
  await app.close();
});

/** The fake camera named in Media as this computer's video input; its id. */
const addFakeInput = (win: Page, name: string) =>
  win.evaluate(
    async ({ name, device }) => {
      const made = await (globalThis as PageGlobals).drashti.videoInputs.add({ name, device, fit: 'fit' });
      if (!made.ok) throw new Error(made.message);
      return made.view.inputs.find((i) => i.name === name)?.id ?? '';
    },
    { name, device: DEVICE },
  );

/** A video element's frames as they come (capture times when Chromium gives them), counted from now. */
async function framesOf(video: Locator): Promise<{ count: number; capture: number[] }> {
  return video.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<{ count: number; capture: number[] }>((resolve) => {
        const capture: number[] = [];
        let count = 0;
        const step = (_now: number, meta: VideoFrameCallbackMetadata) => {
          count++;
          const at = (meta as VideoFrameCallbackMetadata & { captureTime?: number }).captureTime;
          if (typeof at === 'number') capture.push(Math.round(performance.timeOrigin + at));
          if (count < 20) v.requestVideoFrameCallback(step);
          else resolve({ count, capture });
        };
        v.requestVideoFrameCallback(step);
        setTimeout(() => {
          resolve({ count, capture });
        }, 8000);
      }),
  );
}

test('the video input box shows the chosen input whatever the audience shows; with the audience showing it, one feed; LIVE’s button puts it up and takes it off, the stage never following', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ ...FAKE, DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const hallId = await setUpScreen(win, 'Main Hall', 0);
  const stageId = await setUpScreen(win, 'Stage', 1);
  await makeStage(win, 'Stage');
  const hall = await outputFor(app, hallId);
  const stage = await outputFor(app, stageId);
  const programme = await addFakeInput(win, 'Placeholder programme');
  // The video input large with the hall's picture beside it: both draw the input once it is on the audience.
  const layout = await saveLayout(win, 'Placeholder anchoring', [
    { ...newStageBox('videoInput', 'input'), frame: { x: 0, y: 0, width: 1280, height: 720 } },
    { ...newStageBox('audience', 'hall'), frame: { x: 1280, y: 0, width: 640, height: 360 } },
    { ...newStageBox('clock', 'clock'), frame: { x: 1280, y: 400, width: 640, height: 200 } },
  ]);
  await win.evaluate((id) => (globalThis as PageGlobals).drashti.stageLayouts.choose(id), layout);
  // The chosen video input: the first, offered in the Stage screen panel.
  const panel = win.getByTestId('stage-message-control');
  await expect(panel.getByTestId('stage-input-choice')).toHaveValue(programme);
  await expect(panel.getByTestId('stage-input-choice').locator('option')).toHaveText([
    'Placeholder programme',
  ]);
  const box = stage.locator('[data-stage-box="videoInput"]');
  // On the stage, live, whatever the audience shows (nothing up there).
  await expect(box.locator('[data-stage-input]')).toHaveAttribute('data-input-state', 'live', {
    timeout: 15_000,
  });
  const boxVideo = box.locator('video');
  await expect.poll(async () => (await framesOf(boxVideo)).count, { timeout: 15_000 }).toBeGreaterThan(3);
  expect(await background(win)).toBeNull();
  await expect(hall.locator('[data-kind="input"]')).toHaveCount(0);

  // LIVE's one press: on the audience, as its background; the button says it is up; the stage as it was.
  const button = win.getByTestId('input-on-audience');
  await expect(button).toHaveText('Placeholder programme on the audience');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#1f3a5f' } });
  await button.click();
  await expect.poll(async () => (await background(win))?.kind).toBe('input');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(hall.locator('[data-kind="input"]')).toHaveAttribute('data-input-state', 'live', {
    timeout: 15_000,
  });
  expect(await shows(stage)).toBe(`layout ${layout}`);

  // One feed: on the stage screen, the video input box and the hall's picture box play the same stream, one
  // capture of the device for the page.
  const hallInStage = stage.locator('[data-stage-box="audience"] [data-kind="input"] video');
  await expect(hallInStage).toHaveCount(1, { timeout: 15_000 });
  await expect
    .poll(() =>
      stage.evaluate(() => {
        const box = document.querySelector<HTMLVideoElement>('[data-stage-box="videoInput"] video');
        const hall = document.querySelector<HTMLVideoElement>(
          '[data-stage-box="audience"] [data-kind="input"] video',
        );
        return box !== null && hall !== null && box.srcObject !== null && box.srcObject === hall.srcObject;
      }),
    )
    .toBe(true);
  // And the same frames as the hall's own screen, at the same moments: one capture for every page (where Chromium
  // gives the frames' capture times).
  const [onStage, onHall] = await Promise.all([
    framesOf(boxVideo),
    framesOf(hall.locator('[data-kind="input"] video')),
  ]);
  expect(onStage.count).toBeGreaterThan(3);
  expect(onHall.count).toBeGreaterThan(3);
  // Said in the run's output: whether Chromium gave the frames' capture times here, and how many were shared.
  console.log(
    `Capture times: ${String(onStage.capture.length)} on the stage, ${String(onHall.capture.length)} on the hall's screen`,
  );
  if (onStage.capture.length > 0 && onHall.capture.length > 0) {
    const hallTimes = new Set(onHall.capture);
    const shared = onStage.capture.filter(
      (t) => hallTimes.has(t) || hallTimes.has(t - 1) || hallTimes.has(t + 1),
    );
    console.log(`Frames with the same capture time on both: ${String(shared.length)}`);
    expect(shared.length, 'frames captured once, shown on both').toBeGreaterThan(0);
  }

  // Pressed again: off, and the colour that was there before comes back; the stage never followed.
  await button.click();
  await expect.poll(async () => (await background(win))?.kind).toBe('color');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await shows(stage)).toBe(`layout ${layout}`);
  await expect(box.locator('[data-stage-input]')).toHaveAttribute('data-input-state', 'live');
  await expectNoSeriousA11yIssues(win, 'LIVE with the video input’s button', '[aria-label="Live"]');
  await app.close();
});

test('the editor: New, Duplicate, Rename, Save, Delete and New from a Template…, each with Undo; deleting the layout in use puts Standard on the stage; a box deleted by its button, Delete or Backspace, with Undo', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const stageId = await setUpScreen(win, 'Stage', 0);
  await makeStage(win, 'Stage');
  const stage = await outputFor(app, stageId);
  const listed = () =>
    win.evaluate(async () =>
      (await (globalThis as PageGlobals).drashti.stageLayouts.list()).map((l) => l.name),
    );

  await win.getByTestId('stage-edit-layout').click();
  const editor = win.getByTestId('stage-layout-editor');
  await expect(editor).toBeVisible();
  const list = editor.getByTestId('stage-layout-list');
  const undo = editor.getByTestId('stage-layout-undo');
  const said = editor.getByTestId('stage-layout-undo-line');
  await expect(undo).toHaveCount(0);

  // New: an empty stage, made at once and shown; Undo takes it away.
  await editor.getByTestId('stage-layout-new').click();
  await expect.poll(listed).toEqual(['Stage layout']);
  await expect(list.getByRole('button', { name: 'Stage layout', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(editor.getByTestId('stage-box-list').getByRole('button')).toHaveCount(0);
  await expect(said).toContainText('Made “Stage layout”');
  await undo.click();
  await expect.poll(listed).toEqual([]);
  await expect(editor.getByText('Standard is the stage screen Drashti comes with')).toBeVisible();

  // Duplicate Standard: its parts, made at once; Undo takes it away; again, then Rename…, which Undo puts back.
  await editor.getByTestId('stage-layout-duplicate').click();
  await expect.poll(listed).toEqual(['Stage layout']);
  await expect(said).toContainText('Duplicated Standard as “Stage layout”');
  await undo.click();
  await expect.poll(listed).toEqual([]);
  await editor.getByTestId('stage-layout-duplicate').click();
  await expect.poll(listed).toEqual(['Stage layout']);
  await expect(editor.getByTestId('stage-box-list').getByRole('button')).toHaveCount(7);
  await editor.getByTestId('stage-layout-rename').click();
  const rename = win.getByTestId('stage-layout-rename-dialog');
  await expect(rename.getByTestId('stage-layout-rename-name')).toBeFocused();
  await expectNoSeriousA11yIssues(win, 'Rename the layout');
  await rename.getByTestId('stage-layout-rename-name').fill('Placeholder band');
  await win.keyboard.press('Enter');
  await expect(rename).toHaveCount(0);
  await expect.poll(listed).toEqual(['Placeholder band']);
  await expect(said).toContainText('Renamed “Stage layout” to “Placeholder band”');
  await undo.click();
  await expect.poll(listed).toEqual(['Stage layout']);
  await editor.getByTestId('stage-layout-rename').click();
  await rename.getByTestId('stage-layout-rename-name').fill('Placeholder band');
  await rename.getByTestId('stage-layout-rename-keep').click();
  await expect.poll(listed).toEqual(['Placeholder band']);

  // A box deleted three ways, each back with Undo: its button on the canvas, Delete, and Backspace.
  const boxes = editor.getByTestId('stage-box-list').getByRole('button');
  const canvas = editor.getByTestId('stage-layout-canvas-stage');
  await boxes.filter({ hasText: 'Clock' }).click();
  await canvas.getByTestId('canvas-box-delete').click();
  await expect(boxes).toHaveCount(6);
  await expect(boxes.filter({ hasText: 'Clock' })).toHaveCount(0);
  await expect(said).toContainText('Deleted the box Clock');
  await undo.click();
  await expect(boxes).toHaveCount(7);
  await expect(boxes.filter({ hasText: 'Clock' })).toHaveCount(1);
  for (const key of ['Delete', 'Backspace']) {
    await boxes.filter({ hasText: 'Notes' }).click();
    await canvas.focus();
    await win.keyboard.press(key);
    await expect(boxes.filter({ hasText: 'Notes' }), key).toHaveCount(0);
    // Edit › Undo (Mod+Z): back.
    await chooseMenuItem(app, 'undo');
    await expect(boxes.filter({ hasText: 'Notes' }), key).toHaveCount(1);
  }
  // Every change taken back: the layout as it was saved, nothing to save.
  await expect(editor.getByTestId('stage-layout-save')).toBeDisabled();
  await expectFits(editor, 'the stage layout editor at 1024 × 645');
  await expectNoSeriousA11yIssues(win, 'the stage layout editor with Undo, at 1024 × 645');
  // Edit and Save: a box taken out, saved; Undo puts the layout back as it was saved before.
  const kinds = () =>
    win.evaluate(
      async () =>
        (await (globalThis as PageGlobals).drashti.stageLayouts.list())
          .find((l) => l.name === 'Placeholder band')
          ?.boxes.map((b) => b.kind) ?? [],
    );
  await boxes.filter({ hasText: 'Clock' }).click();
  await editor.getByTestId('stage-box-delete').click();
  await editor.getByTestId('stage-layout-save').click();
  await expect.poll(kinds).not.toContain('clock');
  await expect(said).toContainText('Saved “Placeholder band”');
  await undo.click();
  await expect.poll(kinds).toContain('clock');
  await expect(boxes.filter({ hasText: 'Clock' })).toHaveCount(1);

  // Chosen for the stage, then deleted: the stage shows Standard; Undo puts it back, chosen again.
  const band = await win.evaluate(
    async () =>
      (await (globalThis as PageGlobals).drashti.stageLayouts.list()).find(
        (l) => l.name === 'Placeholder band',
      )?.id ?? '',
  );
  await win.evaluate((id) => (globalThis as PageGlobals).drashti.stageLayouts.choose(id), band);
  await expect.poll(() => shows(stage)).toBe(`layout ${band}`);
  await expect(list.getByTestId('stage-layout-in-use')).toHaveCount(1);
  await editor.getByTestId('stage-layout-delete').click();
  await expect.poll(listed).toEqual([]);
  await expect.poll(() => shows(stage)).toBe('standard');
  await expect(said).toContainText('Deleted “Placeholder band”');
  await undo.click();
  await expect.poll(listed).toEqual(['Placeholder band']);
  await expect.poll(() => shows(stage)).toBe(`layout ${band}`);
  await expect(list.getByRole('button', { name: 'Placeholder band', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );

  // New from a Template…: the layout and its timer made, and chosen for the stage at once; one Undo takes all of it
  // back, the layout chosen before on the stage again.
  const timerNames = () =>
    win.evaluate(async () =>
      (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.timers.map((t) => t.name),
    );
  await editor.getByTestId('stage-layout-from-template').click();
  const dialog = win.getByTestId('stage-template-dialog');
  await dialog.getByRole('radio', { name: 'Pravachan and anchoring', exact: true }).click();
  await dialog.getByTestId('stage-template-make').click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(listed).toEqual(['Placeholder band', 'Pravachan and anchoring']);
  await expect.poll(timerNames).toContain('Stage countdown');
  await expect.poll(() => shows(stage)).not.toBe(`layout ${band}`);
  await expect(stage.locator('[data-stage-box="videoInput"]')).toHaveCount(1);
  await expect(said).toContainText('Made “Pravachan and anchoring” from a template');
  await undo.click();
  await expect.poll(listed).toEqual(['Placeholder band']);
  await expect.poll(timerNames).not.toContain('Stage countdown');
  await expect.poll(() => shows(stage)).toBe(`layout ${band}`);
  await app.close();
});

test('the Stage screen panel changes the time a stage timer counts to, and a countdown’s length, at once on every stage screen', async () => {
  test.setTimeout(180_000);
  // The stage screen's clock held at noon today, so a countdown to a time shows the same whatever the real time.
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_TEST_CLOCK_HOLD: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const stageId = await setUpScreen(win, 'Stage', 0);
  await makeStage(win, 'Stage');
  const stage = await outputFor(app, stageId);
  const timers = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const at = await d.timers.create({
      name: 'Placeholder start time',
      kind: 'countdown_to_time',
      durationMs: 0,
      targetTime: '23:59',
      allowsOverrun: false,
    });
    const length = await d.timers.create({
      name: 'Placeholder talk',
      kind: 'countdown',
      durationMs: 5 * 60_000,
      targetTime: null,
      allowsOverrun: true,
    });
    if (!at.ok || !length.ok) throw new Error('could not make the timers');
    return { at: at.id, length: length.id };
  });
  const layout = await saveLayout(win, 'Placeholder timers', [
    {
      ...newStageBox('timer', 'to-time'),
      timerId: timers.at,
      frame: { x: 0, y: 0, width: 1920, height: 500 },
    },
    {
      ...newStageBox('timer', 'length'),
      timerId: timers.length,
      frame: { x: 0, y: 540, width: 1920, height: 500 },
    },
  ]);
  await win.evaluate((id) => (globalThis as PageGlobals).drashti.stageLayouts.choose(id), layout);
  const panel = win.getByTestId('stage-message-control');
  const rows = panel.getByTestId('stage-timer-row');
  await expect(rows).toHaveCount(2);
  const toTime = rows.filter({ hasText: 'Placeholder start time' });
  const talk = rows.filter({ hasText: 'Placeholder talk' });
  await expect(toTime.getByTestId('stage-timer-target')).toHaveValue('23:59');
  await expect(talk.getByTestId('stage-timer-target')).toHaveValue('5:00');
  const box = (id: string) => stage.locator(`[data-box-id="${id}"]`);
  await expect(box('length')).toHaveText('5:00');
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  expect(await holdClock(app, noon.getTime())).toBeGreaterThanOrEqual(1);
  await expect(box('to-time')).toHaveText('11:59:00');

  // The time of day: kept as it is set, and the stage screen counts to it at once.
  const timeOf = async () =>
    (
      await win.evaluate(
        async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.timers,
      )
    ).find((t) => t.id === timers.at)?.targetTime;
  await toTime.getByTestId('stage-timer-target').fill('13:00');
  await expect.poll(timeOf).toBe('13:00');
  await expect(box('to-time')).toHaveText('1:00:00');

  // The length: kept on Enter; what does not read is said, and changes nothing.
  await talk.getByTestId('stage-timer-target').fill('soon');
  await talk.getByTestId('stage-timer-target').press('Enter');
  await expect(talk.getByTestId('stage-timer-target-problem')).toContainText('for example 5:00');
  await expect(box('length')).toHaveText('5:00');
  await talk.getByTestId('stage-timer-target').fill('2:30');
  await talk.getByTestId('stage-timer-target').press('Enter');
  await expect(talk.getByTestId('stage-timer-target-problem')).toHaveCount(0);
  await expect(box('length')).toHaveText('2:30');
  await expect(talk.getByTestId('stage-timer-value')).toHaveText('2:30');
  await expectNoSeriousA11yIssues(win, 'the stage timers’ fields', '[data-testid="stage-message-control"]');

  // The panel's Layout and its timers with their fields fit CI's window and 1280 × 720: nothing cut off or over the
  // window's edge, every button's words whole.
  for (const size of [CI_WINDOW, { width: 1280, height: 720 }]) {
    const at = `at ${String(size.width)} × ${String(size.height)}`;
    await sizeOperatorWindow(app, win, size);
    const list = panel.getByTestId('stage-timers');
    await list.scrollIntoViewIfNeeded();
    await expectFits(list, `the stage timers ${at}`);
    const picker = panel.getByTestId('stage-layout-choice');
    await picker.scrollIntoViewIfNeeded();
    const box = await picker.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= size.width, `the Layout picker ${at}`).toBe(true);
  }
  await app.close();
});
