import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { newStageBox, type StageBox, type StageLayout } from '../../src/shared/stage-layouts';
import { FLASH_DIM } from '../../src/shared/stage-timer';
import type { TimerFields } from '../../src/shared/timers';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode, TABLET } from './devices';
import {
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputPages,
  outputReady,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { launchMain, launchNode, pairNode } from './nodes';
import { holdClock } from './placeholder-slides';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Stage timer layouts (Session 54). The stage layout editor's New from a Template… makes each of five ready-made
 * layouts with the timer it needs (a new one, with the length or the time of day asked, or one already in
 * Timers), shows it in the editor and chooses it at once for the stage screens in the live Look. The editor and
 * the dialog fit CI's window, 1024 × 645, and pass the accessibility checks. Boxes may overlap, and Bring to the
 * front, Send to the back and one step either way set which is over which; Alt with the arrows resizes. A box's
 * own settings (a see-through fill, bold, a line round the letters, a shadow, up and down; a timer's format,
 * warning colour, colour when over and flash; a clock's 24 hours and seconds) draw alike on this computer's stage
 * screen, a node's, a tablet's stage page, the Stage panel's preview and the editor; the flash and the colours
 * follow the engine's time; a layout saved before opens and draws as it was. The Stage screen panel and the phone
 * remote (Chrome's engine and Safari's) start, pause and reset the timers the layout shows, saying what each
 * counts to. The Text size field shows what is typed (G4). Placeholder timers and words only; quiet; outputs as
 * windows; nothing wider than 1024 assumed.
 */

/** The engine's state, as the operator window has it. */
const engineState = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** The timers, as Timers has them: what a template made. */
const timersNow = async (win: Page) =>
  (await engineState(win)).timers.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    durationMs: t.durationMs,
    targetTime: t.targetTime,
    allowsOverrun: t.allowsOverrun,
  }));

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

/** Make the group of this name a stage group; its id. */
function makeStage(win: Page, name: string): Promise<string> {
  return win.evaluate(async (name) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.name === name);
    if (!group) throw new Error(`no group ${name}`);
    const set = await d.screens.setGroupRole(group.id, 'stage');
    if (!set.ok) throw new Error(set.message);
    return group.id;
  }, name);
}

/** The stage layout the live Look gives this group, or null for the Standard stage screen. */
const liveLayoutOf = (win: Page, groupId: string): Promise<StageLayout | null> =>
  win.evaluate(async (groupId) => {
    const d = (globalThis as PageGlobals).drashti;
    const looks = await d.looks.list();
    const id = looks.looks.find((l) => l.id === looks.liveId)?.groups[groupId]?.stageLayoutId ?? null;
    return id === null ? null : ((await d.stageLayouts.list()).find((l) => l.id === id) ?? null);
  }, groupId);

/** A timer in Timers, made through the bridge; its id. */
const makeTimer = (win: Page, fields: TimerFields) =>
  win.evaluate(async (fields) => {
    const made = await (globalThis as PageGlobals).drashti.timers.create(fields);
    if (!made.ok) throw new Error(made.message);
    return made.id;
  }, fields);

/** Save a stage layout of these boxes and give it, in the live Look, to the stage group; the layout's id. */
const giveLayout = (win: Page, stageGroup: string, name: string, boxes: StageBox[]) =>
  win.evaluate(
    async ({ stageGroup, name, boxes }) => {
      const d = (globalThis as PageGlobals).drashti;
      const saved = await d.stageLayouts.save(null, { name, background: '#000000', boxes });
      if (!saved.ok) throw new Error(saved.message);
      const set = await d.looks.setGroup((await d.looks.list()).liveId, stageGroup, {
        stageLayoutId: saved.id,
      });
      if (!set.ok) throw new Error(set.message);
      return saved.id;
    },
    { stageGroup, name, boxes },
  );

/** Which box of a stage layout on a page is over this point of the 1920 x 1080 canvas: its id. */
const topBoxAt = (scope: Page | Locator, x: number, y: number) =>
  scope
    .getByTestId('stage-layout')
    .first()
    .evaluate(
      (layout, at) => {
        const r = layout.getBoundingClientRect();
        const scale = r.width / 1920;
        const hit = document.elementFromPoint(r.left + at.x * scale, r.top + at.y * scale);
        return hit?.closest<HTMLElement>('[data-stage-box]')?.dataset['boxId'] ?? null;
      },
      { x, y },
    );

/**
 * How each box of a stage layout draws on a page, bottom to top: its fill and corners, its words' weight, line
 * round the letters, shadow and place up and down, how large they were fitted, and a timer's time and colour.
 */
const looksOn = (scope: Page | Locator) =>
  scope
    .getByTestId('stage-layout')
    .first()
    .evaluate((layout) =>
      [...layout.querySelectorAll<HTMLElement>('[data-stage-box]')].map((b) => {
        // The box's words: after its label, the part that is sized (and fitted), and its words inside it.
        const sized = b.lastElementChild instanceof HTMLElement ? b.lastElementChild : null;
        const words = sized?.firstElementChild instanceof HTMLElement ? sized.firstElementChild : null;
        const timer = b.querySelector<HTMLElement>('[data-timer]');
        const box = getComputedStyle(b);
        const w = words ? getComputedStyle(words) : null;
        return {
          kind: b.dataset['stageBox'],
          fill: box.backgroundColor,
          corners: box.borderTopLeftRadius,
          weight: w?.fontWeight ?? null,
          line: w ? `${w.webkitTextStrokeWidth} ${w.webkitTextStrokeColor}` : null,
          shadow: w ? w.textShadow !== 'none' : null,
          upDown: sized ? getComputedStyle(sized).justifyContent : null,
          fitted: Number(sized?.getAttribute('data-fit-size') ?? NaN),
          text: (words?.innerText ?? '').replace(/\s+/gu, ' ').trim(),
          timerColor: timer?.dataset['timerColor'] ?? null,
          color: timer ? getComputedStyle(timer).color : null,
        };
      }),
    );

/** The kinds of the boxes a stage page draws, bottom to top. */
const boxKinds = (page: Page) =>
  page
    .getByTestId('stage-layout')
    .evaluate((layout) =>
      [...layout.querySelectorAll<HTMLElement>('[data-stage-box]')].map((b) => b.dataset['stageBox']),
    );

test('New from a Template… makes each of the five with the timer it needs, chosen for the stage screens at once', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const stageId = await setUpScreen(win, 'Stage', 0);
  const group = await makeStage(win, 'Stage');
  const stage = await outputFor(app, stageId);

  // The editor, from the Stage screen panel's Edit layout….
  await win.getByTestId('stage-edit-layout').click();
  const editor = win.getByTestId('stage-layout-editor');
  await expect(editor).toBeVisible();
  const dialog = win.getByTestId('stage-template-dialog');
  const open = async (template: string) => {
    await editor.getByTestId('stage-layout-from-template').click();
    await expect(dialog).toBeVisible();
    const choice = dialog.getByRole('radio', { name: template, exact: true });
    await choice.click();
    await expect(choice).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByTestId('stage-template-picture')).toHaveAttribute(
      'data-template',
      (await choice.getAttribute('data-template')) ?? '',
    );
  };
  const make = async (layout: string) => {
    await dialog.getByTestId('stage-template-make').click();
    await expect(dialog).toHaveCount(0);
    // Shown in the editor, saved (nothing left to save), and chosen for the stage group in the live Look.
    await expect(
      editor.getByTestId('stage-layout-list').getByRole('button', { name: layout, exact: true }),
    ).toHaveAttribute('aria-current', 'true');
    await expect(editor.getByTestId('stage-layout-name')).toHaveValue(layout);
    await expect(editor.getByTestId('stage-layout-save')).toBeDisabled();
    await expect.poll(async () => (await liveLayoutOf(win, group))?.name ?? null).toBe(layout);
    await expect(stage.getByTestId('stage-layout')).toHaveAttribute(
      'data-layout',
      (await liveLayoutOf(win, group))?.id ?? '',
    );
  };

  // Countdown: a new one, of the length typed, that runs on past 0:00.
  await open('Countdown');
  await expect(dialog.getByTestId('stage-template-where')).toContainText(
    'it is chosen at once for the stage screens',
  );
  await expect(dialog.getByTestId('stage-template-length')).toHaveValue('5:00');
  await expect(dialog.getByTestId('stage-template-name')).toHaveValue('Stage countdown');
  await dialog.getByTestId('stage-template-length').fill('2:30');
  await make('Countdown');
  const countdown = (await timersNow(win)).find((t) => t.name === 'Stage countdown');
  expect(countdown).toMatchObject({ kind: 'countdown', durationMs: 150_000, allowsOverrun: true });
  expect(await boxKinds(stage)).toEqual(['timer']);
  await expect(stage.locator('[data-stage-box="timer"]')).toHaveText('2:30');

  // Countdown to a time: the time of day typed, and the words above it.
  await open('Countdown to a time');
  await dialog.getByTestId('stage-template-time').fill('08:15');
  await expect(dialog.getByTestId('stage-template-words')).toHaveValue('Starting in');
  await dialog.getByTestId('stage-template-words').fill('Placeholder words above');
  await make('Countdown to a time');
  expect((await timersNow(win)).find((t) => t.name === 'Stage countdown to a time')).toMatchObject({
    kind: 'countdown_to_time',
    targetTime: '08:15',
    allowsOverrun: false,
  });
  expect(await boxKinds(stage)).toEqual(['text', 'timer']);
  await expect(stage.locator('[data-stage-box="text"]')).toHaveText('Placeholder words above');
  await expect(stage.locator('[data-stage-box="timer"]')).toHaveText(/^\d+:\d\d(:\d\d)?$/u);

  // Count up from 0:00.
  await open('Count up from 0:00');
  await make('Count up from 0:00');
  expect((await timersNow(win)).find((t) => t.name === 'Stage count up')).toMatchObject({ kind: 'countup' });
  await expect(stage.locator('[data-stage-box="timer"]')).toHaveText('0:00');

  // Timer only, with a timer already in Timers: no new one is made.
  const before = await timersNow(win);
  await open('Timer only');
  await dialog.getByTestId('stage-template-own-timer').click();
  await expect(dialog.getByTestId('stage-template-own-timer')).toBeChecked();
  await dialog
    .getByTestId('stage-template-timer-choice')
    .selectOption({ label: 'Stage countdown (Countdown)' });
  await make('Timer only');
  expect(await timersNow(win)).toEqual(before);
  const alone = await liveLayoutOf(win, group);
  expect(alone?.boxes.map((b) => [b.kind, b.timerId])).toEqual([['timer', countdown?.id]]);
  await expect(stage.locator('[data-stage-box="timer"]')).toHaveText('2:30');

  // Timer and clock over the audience: a new count-up of the name typed; the picture under the two.
  await open('Timer and clock over the audience');
  await dialog.getByTestId('stage-template-kind').selectOption('countup');
  await dialog.getByTestId('stage-template-name').fill('Placeholder stage timer');
  await make('Timer and clock over the audience');
  expect((await timersNow(win)).find((t) => t.name === 'Placeholder stage timer')).toMatchObject({
    kind: 'countup',
  });
  expect(await boxKinds(stage)).toEqual(['audience', 'timer', 'clock']);
  await app.close();
});

test('the stage layout editor and New from a Template fit 1024 × 645 and pass the accessibility checks', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await win.getByTestId('stage-edit-layout').click();
  const editor = win.getByTestId('stage-layout-editor');
  await expect(editor).toBeVisible();
  await editor.getByTestId('stage-layout-from-template').click();
  const dialog = win.getByTestId('stage-template-dialog');
  await expect(dialog).toBeVisible();
  // No stage group yet: the layout is made, and chosen for the stage in Screens once there is one.
  await expect(dialog.getByTestId('stage-template-where')).toContainText(
    'No screens are set up for the stage yet',
  );
  // Each template: the dialog in the window, its Make the layout in view without scrolling the window.
  const makeButton = dialog.getByTestId('stage-template-make');
  for (const name of [
    'Timer only',
    'Countdown to a time',
    'Countdown',
    'Count up from 0:00',
    'Timer and clock over the audience',
  ]) {
    await dialog.getByRole('radio', { name, exact: true }).click();
    await expect(makeButton).toBeInViewport({ ratio: 1 });
  }
  // The arrow keys move the choice, as in any radio group.
  await dialog.getByRole('radio', { name: 'Timer and clock over the audience', exact: true }).focus();
  await win.keyboard.press('ArrowUp');
  await expect(dialog.getByRole('radio', { name: 'Count up from 0:00', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expectNoSeriousA11yIssues(win, 'New from a Template');
  await dialog.getByRole('radio', { name: 'Timer and clock over the audience', exact: true }).click();
  await makeButton.click();
  await expect(dialog).toHaveCount(0);
  await expect(editor.getByTestId('stage-layout-name')).toHaveValue('Timer and clock over the audience');

  // The new layout's timer box chosen: its settings, the canvas and Save in the window.
  await editor.getByTestId('stage-box-list').getByRole('button', { name: 'Timer', exact: true }).click();
  await expect(editor.getByTestId('stage-box-settings')).toBeVisible();
  await expect(editor.getByTestId('stage-layout-canvas')).toBeInViewport();
  await expect(editor.getByTestId('stage-layout-save')).toBeInViewport({ ratio: 1 });
  await expectNoSeriousA11yIssues(win, 'the stage layout editor at 1024 x 645, a timer box chosen');
  await app.close();
});

/** A fixed text box of placeholder words at this place across, 800 x 400 from 340 down. */
const textAt = (id: string, words: string, x: number): StageBox => ({
  ...newStageBox('text', id),
  text: words,
  frame: { x, y: 340, width: 800, height: 400 },
  size: 64,
});

test('boxes may overlap; Bring to the front, Send to the back and one step set which is over which, on the stage too; Alt with the arrows resizes', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const stageId = await setUpScreen(win, 'Stage', 0);
  const group = await makeStage(win, 'Stage');
  // Three boxes, each over the one before; the middle of the stage is under all three.
  await giveLayout(win, group, 'Placeholder overlap layout', [
    textAt('placeholder-a', 'Placeholder A', 400),
    textAt('placeholder-b', 'Placeholder B', 600),
    textAt('placeholder-c', 'Placeholder C', 800),
  ]);
  const stage = await outputFor(app, stageId);
  await expect(stage.getByTestId('stage-layout')).toBeVisible();
  await expect.poll(() => topBoxAt(stage, 1000, 540)).toBe('placeholder-c');

  await win.getByTestId('stage-edit-layout').click();
  const editor = win.getByTestId('stage-layout-editor');
  await expect(editor.getByTestId('stage-layout-name')).toHaveValue('Placeholder overlap layout');
  const list = editor.getByTestId('stage-box-list').getByRole('button');
  const order = async () =>
    (await list.allTextContents()).map((t) => t.replace('Fixed text: Placeholder ', ''));
  await editor
    .getByTestId('stage-box-list')
    .getByRole('button', { name: 'Fixed text: Placeholder A' })
    .click();
  const settings = editor.getByTestId('stage-box-settings');
  const arrange = async (label: string, then: string[]) => {
    await settings.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(order).toEqual(then);
  };
  await arrange('Bring to the front', ['B', 'C', 'A']);
  await arrange('Send backward', ['B', 'A', 'C']);
  await arrange('Send to the back', ['A', 'B', 'C']);
  await arrange('Bring forward', ['B', 'A', 'C']);
  await arrange('Bring to the front', ['B', 'C', 'A']);
  // The canvas draws them so: A over the others where all three are.
  await expect
    .poll(() => topBoxAt(editor.getByTestId('stage-layout-canvas'), 1000, 540))
    .toBe('placeholder-a');

  // Alt with the arrows: larger and smaller (Shift: ten pixels); the arrows alone still move it.
  const field = (name: string) => settings.getByRole('spinbutton', { name, exact: true });
  const canvas = editor.getByTestId('stage-layout-canvas-stage');
  await canvas.focus();
  await win.keyboard.press('Alt+ArrowRight');
  await expect(field('Width')).toHaveValue('801');
  await win.keyboard.press('Alt+Shift+ArrowLeft');
  await expect(field('Width')).toHaveValue('791');
  await win.keyboard.press('Alt+ArrowDown');
  await expect(field('Height')).toHaveValue('401');
  await win.keyboard.press('Alt+ArrowUp');
  await expect(field('Height')).toHaveValue('400');
  await expect(field('Across')).toHaveValue('400');
  await win.keyboard.press('ArrowRight');
  await expect(field('Across')).toHaveValue('401');
  await expect(field('Width')).toHaveValue('791');

  // Saved, overlapping as they are: the stage screen draws A over the others.
  await editor.getByTestId('stage-layout-save').click();
  await expect(editor.getByTestId('stage-layout-save')).toBeDisabled();
  await expect.poll(() => topBoxAt(stage, 1000, 540)).toBe('placeholder-a');
  const saved = await liveLayoutOf(win, group);
  expect(saved?.boxes.map((b) => b.id)).toEqual(['placeholder-b', 'placeholder-c', 'placeholder-a']);
  expect(saved?.boxes[2]?.frame).toEqual({ x: 401, y: 340, width: 791, height: 400 });
  await app.close();
});

/** A countdown of this length, not started: the same time on every page whatever the moment. */
const countdownOf = (name: string, durationMs: number): TimerFields => ({
  name,
  kind: 'countdown',
  durationMs,
  targetTime: null,
  allowsOverrun: true,
});

/** The settings a box can have, on a timer box, a timer box at 0:00 and a clock box (24 hours, the seconds). */
function settingsLayout(longId: string, zeroId: string): StageBox[] {
  return [
    {
      ...newStageBox('timer', 'placeholder-long'),
      timerId: longId,
      frame: { x: 48, y: 48, width: 1100, height: 400 },
      size: 'fit',
      color: '#ffffff',
      align: 'center',
      label: 'PLACEHOLDER TIMER',
      valign: 'middle',
      bold: true,
      fill: { color: '#203040', seeThrough: 0.25 },
      outline: { color: '#101010', width: 3 },
      shadow: true,
      format: 'mss',
      // Two hours: a 65-minute countdown is in its warning already.
      warn: { color: '#f5a524', fromMs: 2 * 3600 * 1000 },
    },
    {
      ...newStageBox('timer', 'placeholder-zero'),
      timerId: zeroId,
      frame: { x: 48, y: 500, width: 1100, height: 300 },
      size: 120,
      format: 'hmmss',
      overColor: '#ef4444',
      valign: 'bottom',
    },
    {
      ...newStageBox('clock', 'placeholder-clock'),
      frame: { x: 1200, y: 48, width: 672, height: 200 },
      size: 'fit',
      hours: 24,
      seconds: true,
      shadow: true,
    },
  ];
}

/** What a page draws of the settings layout, with the clock's time as its shape (pages read it at moments apart). */
async function settingsOn(scope: Page | Locator) {
  return (await looksOn(scope)).map((l) => ({
    ...l,
    text: l.kind === 'clock' ? l.text.replace(/\d/gu, '0') : l.text,
  }));
}

/** The same without how large each box's words were fitted (a font's measure may differ by a pixel). */
const unfitted = (looks: Awaited<ReturnType<typeof settingsOn>>) => looks.map(({ fitted: _f, ...l }) => l);

test('a box’s settings draw alike on this computer’s stage screen, a node’s, a tablet’s stage page, the Stage panel’s preview and the editor', async () => {
  test.setTimeout(240_000);
  const main = await launchMain();
  const node = await launchNode();
  const tablet = await device('chromium', TABLET);
  try {
    const nodeId = await pairNode(main, node);
    const stageId = await setUpScreen(main.win, 'Stage', 0);
    const group = await makeStage(main.win, 'Stage');
    const long = await makeTimer(main.win, countdownOf('Placeholder long countdown', 65 * 60_000));
    const zero = await makeTimer(main.win, countdownOf('Placeholder spent countdown', 0));
    await giveLayout(main.win, group, 'Placeholder settings layout', settingsLayout(long, zero));
    // The node's second (pretend) display in the same stage group.
    await expect
      .poll(async () =>
        main.win.evaluate(
          async (id) =>
            (
              (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((n) => n.id === id)
                ?.displays ?? []
            ).length,
          nodeId,
        ),
      )
      .toBeGreaterThanOrEqual(2);
    const assigned = await main.win.evaluate(
      async ({ group, nodeId }) => {
        const d = (globalThis as PageGlobals).drashti;
        const displays = (await d.screens.get()).nodes.find((n) => n.id === nodeId)?.displays ?? [];
        return d.screens.assignNodeDisplay(group, nodeId, displays[1]?.id ?? -1);
      },
      { group, nodeId },
    );
    expect(assigned.ok).toBe(true);
    const here = await outputFor(main.app, stageId);
    const nodeStage = await outputPage(node.app);
    await outputReady(here);
    await outputReady(nodeStage);
    await expect(nodeStage.getByTestId('stage-layout')).toBeVisible();

    // This computer's stage screen: each setting as set.
    await expect(here.locator('[data-stage-box="clock"]')).toHaveText(/^\d\d:\d\d:\d\d$/u);
    const drawn = await settingsOn(here);
    expect(drawn.map((l) => l.kind)).toEqual(['timer', 'timer', 'clock']);
    const [timer, spent, clock] = drawn;
    expect(timer).toMatchObject({
      fill: 'rgba(32, 48, 64, 0.75)',
      corners: '16px',
      weight: '700',
      line: '6px rgb(16, 16, 16)',
      shadow: true,
      upDown: 'center',
      // m:ss, in its warning colour.
      text: '65:00',
      timerColor: '#f5a524',
      color: 'rgb(245, 165, 36)',
    });
    // Fitted to its box, inside the fill's room and under its label.
    expect(timer?.fitted).toBeGreaterThan(200);
    expect(spent).toMatchObject({
      fill: 'rgba(0, 0, 0, 0)',
      weight: '400',
      shadow: false,
      upDown: 'flex-end',
      text: '0:00:00',
      timerColor: '#ef4444',
      color: 'rgb(239, 68, 68)',
    });
    // 24 hours, with the seconds.
    expect(clock).toMatchObject({ shadow: true, weight: '400', text: '00:00:00' });

    /** Drawn alike elsewhere: every setting the same, and its words fitted as large, give or take a pixel or two. */
    const same = async (scope: Page | Locator, where: string) => {
      await expect
        .poll(async () => unfitted(await settingsOn(scope)), { message: where })
        .toEqual(unfitted(drawn));
      (await settingsOn(scope)).forEach((l, i) => {
        const at = drawn[i]?.fitted ?? NaN;
        if (Number.isNaN(at)) expect(l.fitted, `${where} ${String(l.kind)}`).toBeNaN();
        else expect(Math.abs(l.fitted - at), `${where} ${String(l.kind)} fitted`).toBeLessThanOrEqual(2);
      });
    };
    // The node's stage screen.
    await same(nodeStage, 'a node’s stage screen');

    // A tablet's stage page.
    const { base } = await networkOn(main.win);
    const code = await pairingCode(main.win, 'stage', 'Placeholder tablet');
    await pairByQr(tablet.page, base, code, '/stage');
    await expect(tablet.page.getByTestId('stage-layout')).toBeVisible();
    await same(tablet.page, 'a tablet’s stage page');

    // The Stage panel's preview, and the editor's canvas.
    await same(main.win.getByTestId('stage-preview'), 'the Stage panel’s preview');
    await main.win.getByTestId('stage-edit-layout').click();
    await expect(main.win.getByTestId('stage-layout-editor')).toBeVisible();
    await same(main.win.getByTestId('stage-layout-canvas'), 'the stage layout editor');
  } finally {
    await tablet.close();
    await node.app.close();
    await main.app.close();
  }
});

test('a timer box’s colours and its flash at 0:00 follow the engine’s time: dim a second, bright a second, for ten seconds', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_TEST_CLOCK_HOLD: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const stageId = await setUpScreen(win, 'Stage', 0);
  const group = await makeStage(win, 'Stage');
  const timerId = await makeTimer(win, countdownOf('Placeholder flashing countdown', 60_000));
  await giveLayout(win, group, 'Placeholder flash layout', [
    {
      ...newStageBox('timer', 'placeholder-flash'),
      timerId,
      frame: { x: 48, y: 48, width: 1824, height: 984 },
      size: 'fit',
      color: '#ffffff',
      warn: { color: '#f5a524', fromMs: 30_000 },
      overColor: '#ef4444',
      flash: true,
    },
  ]);
  const stage = await outputFor(app, stageId);
  await outputReady(stage);
  await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'startTimer', timerId: id }),
    timerId,
  );
  const startedAt = (await engineState(win)).timers.find((t) => t.id === timerId)?.startedAt ?? null;
  if (startedAt === null) throw new Error('the countdown did not start');
  const zeroAt = startedAt + 60_000;
  const time = stage.locator('[data-stage-box="timer"] [data-timer]');
  /** The timer at a moment of the engine's time, held on every output. */
  const at = async (ms: number, text: string, color: string | null, dim: boolean) => {
    expect(await holdClock(app, ms)).toBeGreaterThan(0);
    await expect(time).toHaveText(text);
    if (color === null) await expect(time).not.toHaveAttribute('data-timer-color');
    else await expect(time).toHaveAttribute('data-timer-color', color);
    if (dim) await expect(time).toHaveAttribute('data-flash', 'dim');
    else await expect(time).not.toHaveAttribute('data-flash');
    expect(Number(await time.evaluate((el) => getComputedStyle(el).opacity))).toBe(dim ? FLASH_DIM : 1);
  };
  await at(startedAt + 10_000, '0:50', null, false);
  await at(startedAt + 35_000, '0:25', '#f5a524', false);
  await at(zeroAt, '0:00', '#ef4444', true);
  await at(zeroAt + 999, '0:00', '#ef4444', true);
  await at(zeroAt + 1000, '-0:01', '#ef4444', false);
  await at(zeroAt + 2500, '-0:02', '#ef4444', true);
  await at(zeroAt + 9500, '-0:09', '#ef4444', false);
  await at(zeroAt + 8500, '-0:08', '#ef4444', true);
  // Ten seconds on, it stays bright.
  await at(zeroAt + 10_000, '-0:10', '#ef4444', false);
  await at(zeroAt + 60_000, '-1:00', '#ef4444', false);
  // Paused, it never flashes.
  await holdClock(app, null);
  await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'pauseTimer', timerId: id }),
    timerId,
  );
  await expect(time).not.toHaveAttribute('data-flash');
  await app.close();
});

test('a layout saved before opens as it was, and draws as it did: nothing to save, words no larger than 400 px', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const stageId = await setUpScreen(win, 'Stage', 0);
  const group = await makeStage(win, 'Stage');
  // As Session 53's editor saved them: none of the settings since (fitWhole among them).
  const before: StageBox[] = [
    {
      id: 'placeholder-clock',
      kind: 'clock',
      frame: { x: 48, y: 48, width: 1824, height: 984 },
      size: 'fit',
      color: '#ffffff',
      align: 'center',
      label: '',
    },
    {
      id: 'placeholder-timer',
      kind: 'timer',
      frame: { x: 48, y: 860, width: 900, height: 200 },
      size: 96,
      color: '#fde68a',
      align: 'left',
      label: 'TIMERS',
      timerId: null,
    },
  ];
  const layoutId = await giveLayout(win, group, 'Placeholder layout saved before', before);
  const stage = await outputFor(app, stageId);
  await expect(stage.getByTestId('stage-layout')).toHaveAttribute('data-layout', layoutId);
  await expect.poll(async () => (await looksOn(stage))[0]?.fitted ?? NaN).toBe(400);
  const [clock, timers] = await looksOn(stage);
  expect(clock).toMatchObject({ fill: 'rgba(0, 0, 0, 0)', weight: '400', shadow: false, upDown: 'normal' });
  expect(timers).toMatchObject({
    fill: 'rgba(0, 0, 0, 0)',
    weight: '400',
    line: expect.stringMatching(/^0px /u),
  });

  // In the editor: as it was, nothing to save, its boxes' new settings at what they leave out.
  await win.getByTestId('stage-edit-layout').click();
  const editor = win.getByTestId('stage-layout-editor');
  await expect(editor.getByTestId('stage-layout-name')).toHaveValue('Placeholder layout saved before');
  const save = editor.getByTestId('stage-layout-save');
  await expect(save).toBeDisabled();
  await editor.getByTestId('stage-box-list').getByRole('button', { name: 'Clock', exact: true }).click();
  const settings = editor.getByTestId('stage-box-settings');
  await expect(settings.getByTestId('stage-box-valign')).toHaveValue('top');
  await expect(settings.getByTestId('stage-box-bold')).not.toBeChecked();
  await expect(settings.getByTestId('stage-box-fill')).toHaveAttribute('aria-checked', 'false');
  await expect(settings.getByTestId('stage-box-hours')).toHaveValue('computer');
  await expect(settings.getByTestId('stage-box-seconds')).not.toBeChecked();
  await editor.getByTestId('stage-box-list').getByRole('button', { name: 'Timer', exact: true }).click();
  await expect(settings.getByTestId('stage-box-format')).toHaveValue('auto');
  await expect(settings.getByTestId('stage-box-flash')).toHaveAttribute('aria-checked', 'false');
  await expect(save).toBeDisabled();
  await editor.getByRole('button', { name: 'Close stage layouts' }).click();
  // Kept exactly as it was saved.
  expect((await liveLayoutOf(win, group))?.boxes).toEqual(before);
  await app.close();
});

test('the Stage panel and the phone start, pause and reset the stage layout’s timers, and say what each counts to', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  // A stage group (no screen needed: the panel and the phone follow its layout in the live Look).
  const group = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.screens.createGroup('Stage');
    if (!made.ok) throw new Error(made.message);
    const id = made.snapshot.groups.find((g) => g.name === 'Stage')?.id ?? '';
    const role = await d.screens.setGroupRole(id, 'stage');
    if (!role.ok) throw new Error(role.message);
    return id;
  });
  const countdown = await makeTimer(win, countdownOf('Placeholder stage countdown', 5 * 60_000));
  const toTime = await makeTimer(win, {
    name: 'Placeholder start time',
    kind: 'countdown_to_time',
    durationMs: 0,
    targetTime: '19:30',
    allowsOverrun: false,
  });
  await makeTimer(win, countdownOf('Placeholder timer not on the stage', 60_000));
  // The countdown twice, every running timer (no one timer to run), and the countdown to a time.
  await giveLayout(win, group, 'Placeholder stage timers', [
    { ...newStageBox('timer', 'placeholder-countdown-box'), timerId: countdown },
    { ...newStageBox('timer', 'placeholder-every-box'), timerId: null },
    { ...newStageBox('timer', 'placeholder-time-box'), timerId: toTime },
    { ...newStageBox('timer', 'placeholder-again-box'), timerId: countdown },
  ]);
  const timerOf = async (id: string) => (await engineState(win)).timers.find((t) => t.id === id);
  const startedAt = async () => (await timerOf(countdown))?.startedAt ?? null;
  const elapsed = async () => (await timerOf(countdown))?.elapsedMs ?? -1;
  /** The countdown at 5:00 again, stopped, between the checks. */
  const resetAll = () =>
    win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'resetTimer', timerId: id }),
      countdown,
    );

  // The Stage screen panel: the two timers the layout names, each once, in its order, with what each counts to.
  const panel = win.getByTestId('stage-message-control');
  const rows = panel.getByTestId('stage-timer-row');
  await expect(rows).toHaveCount(2);
  const first = rows.first();
  await expect(first).toHaveAttribute('data-timer-id', countdown);
  await expect(first).toContainText('Placeholder stage countdown');
  await expect(first.getByTestId('stage-timer-counts')).toHaveText('Counts down from 5:00');
  await expect(first.getByTestId('stage-timer-value')).toHaveText('5:00');
  const second = rows.nth(1);
  await expect(second).toHaveAttribute('data-timer-id', toTime);
  await expect(second.getByTestId('stage-timer-counts')).toHaveText(
    /^Counts down to (19:30|7:30\s?[ap]\.?m\.?)$/iu,
  );
  // A countdown to a time counts by the clock: it has no Reset, as in Timers.
  await expect(second.getByRole('button', { name: 'Reset' })).toHaveCount(0);
  await first.getByRole('button', { name: 'Start' }).click();
  await expect.poll(startedAt).not.toBeNull();
  await expect(first).toHaveAttribute('data-running', 'true');
  await first.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(startedAt).toBeNull();
  await expect(first).not.toHaveAttribute('data-running');
  await first.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(elapsed).toBe(0);
  await expect(first.getByTestId('stage-timer-value')).toHaveText('5:00');

  // The phone remote, Chrome's engine and Safari's: the same timers, under "On the stage screens".
  const { base } = await networkOn(win);
  for (const engine of ['chromium', 'webkit'] as const) {
    await resetAll();
    const code = await pairingCode(win, 'remote', `Placeholder phone ${engine}`);
    const phone = await device(engine);
    const p = phone.page;
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      await p.getByTestId('remote-tab-more').click();
      // The stage screens' timers: in the More tab, with the stage screen's other controls.
      const section = p.getByTestId('remote-stage-timers');
      await expect(section).toBeVisible();
      await expect(p.getByRole('list', { name: 'The stage screens’ timers' })).toBeVisible();
      const timers = section.getByTestId('remote-stage-timer');
      await expect(timers).toHaveCount(2);
      const one = timers.first();
      await expect(one).toHaveAttribute('data-timer-id', countdown);
      await expect(one).toContainText('Counts down from 5:00');
      await expect(one.getByTestId('remote-stage-timer-value')).toHaveText('5:00');
      await expect(timers.nth(1)).toContainText(/Counts down to (19:30|7:30\s?[ap]\.?m\.?)/iu);
      await one.getByRole('button', { name: 'Start' }).click();
      await expect.poll(startedAt).not.toBeNull();
      await one.getByRole('button', { name: 'Pause' }).click();
      await expect.poll(startedAt).toBeNull();
      await one.getByRole('button', { name: 'Reset' }).click();
      await expect.poll(elapsed).toBe(0);
      // Every target 44 px or more; the accessibility checks on a phone and on a tablet.
      for (const button of await section.getByRole('button').all())
        expect((await button.boundingBox())?.height ?? 0, engine).toBeGreaterThanOrEqual(44);
      await p.setViewportSize({ width: 375, height: 812 });
      await expect(section).toBeVisible();
      await expectNoSeriousA11yIssues(p, `the remote’s stage timers at 375 x 812 (${engine})`);
      await p.setViewportSize({ width: 768, height: 1024 });
      await expect(p.getByTestId('remote-stage-timers')).toBeVisible();
      await expectNoSeriousA11yIssues(p, `the remote’s stage timers at 768 x 1024 (${engine})`);
    } finally {
      await phone.close();
    }
  }
  await app.close();
});

// Session 54 (G4): the Text size field took each figure as it came, so typing 48 showed 8 at the first figure (its
// smallest) and then went on from there, never 48.
test('the Text size field shows what is typed, figure by figure, and the box takes it; its smallest once it is left', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.getByTestId('stage-edit-layout').click();
  const editor = win.getByTestId('stage-layout-editor');
  await editor.getByTestId('stage-layout-duplicate').click();
  await editor.getByTestId('stage-box-list').getByRole('button', { name: 'Notes', exact: true }).click();
  const size = editor.getByTestId('stage-box-settings').getByTestId('stage-box-size');
  const drawnAt = () =>
    editor
      .getByTestId('stage-layout-canvas')
      .locator('[data-stage-box="notes"]')
      .evaluate((box) => {
        const words = box.lastElementChild?.firstElementChild;
        return words instanceof HTMLElement ? getComputedStyle(words).fontSize : null;
      });
  await expect(size).toHaveValue('40');
  await size.fill('');
  await size.pressSequentially('4');
  await expect(size).toHaveValue('4');
  await size.pressSequentially('8');
  await expect(size).toHaveValue('48');
  // The box took it at once.
  await expect.poll(drawnAt).toBe('48px');
  await size.blur();
  await expect(size).toHaveValue('48');
  // Below its smallest (8 px), left so: its smallest.
  await size.fill('3');
  await expect(size).toHaveValue('3');
  await size.blur();
  await expect(size).toHaveValue('8');
  await expect.poll(drawnAt).toBe('8px');
  // Typed again, figure by figure, and saved: what the field shows.
  await size.fill('');
  await size.pressSequentially('120');
  await size.blur();
  await expect(size).toHaveValue('120');
  await editor.getByTestId('stage-layout-name').fill('Placeholder typed size layout');
  await editor.getByTestId('stage-layout-save').click();
  await expect(editor.getByTestId('stage-layout-save')).toBeDisabled();
  const saved = await win.evaluate(
    async () =>
      (await (globalThis as PageGlobals).drashti.stageLayouts.list())
        .find((l) => l.name === 'Placeholder typed size layout')
        ?.boxes.find((b) => b.kind === 'notes')?.size,
  );
  expect(saved).toBe(120);
  await app.close();
});

// Session 54 (Part A's review): a line's width and how many items a box of the playlist's next items shows took each
// figure as it came, as the Text size field did (G4): Backspace then 8 gave 38, the 3 put back between the two.
test('a line’s width and how many items show what is typed: Backspace, then a figure, gives that figure', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.getByTestId('stage-edit-layout').click();
  const editor = win.getByTestId('stage-layout-editor');
  await editor.getByTestId('stage-layout-duplicate').click();
  await editor.getByTestId('stage-layout-name').fill('Placeholder typed line layout');
  const settings = editor.getByTestId('stage-box-settings');
  /** Backspace at the end of what the field shows, then these figures: what it shows then, and once it is left. */
  const retype = async (field: Locator, figures: string, shown: string, left: string) => {
    await field.focus();
    await field.press('End');
    await field.press('Backspace');
    await expect(field).toHaveValue('');
    await field.pressSequentially(figures);
    await expect(field).toHaveValue(shown);
    await field.blur();
    await expect(field).toHaveValue(left);
  };

  // A line round the clock's letters: 3 px to begin with; typed 8, then 2.5.
  await editor.getByTestId('stage-box-list').getByRole('button', { name: 'Clock', exact: true }).click();
  await settings.getByTestId('stage-box-outline').click();
  await expect(settings.getByTestId('stage-box-outline')).toHaveAttribute('aria-checked', 'true');
  const width = settings.getByTestId('stage-box-outline-width');
  await expect(width).toHaveValue('3');
  await retype(width, '8', '8', '8');
  await retype(width, '2.5', '2.5', '2.5');
  // Wider than the widest (40 px), once it is left: the widest.
  await retype(width, '95', '95', '40');

  // The playlist's next items: 4 to begin with; typed 3.
  await editor.getByTestId('stage-box-kind').selectOption('upcoming');
  await editor.getByTestId('stage-box-add').click();
  const count = settings.getByRole('spinbutton', { name: 'How many items' });
  await expect(count).toHaveValue('4');
  await retype(count, '3', '3', '3');

  await editor.getByTestId('stage-layout-save').click();
  await expect(editor.getByTestId('stage-layout-save')).toBeDisabled();
  const saved = await win.evaluate(
    async () =>
      (await (globalThis as PageGlobals).drashti.stageLayouts.list()).find(
        (l) => l.name === 'Placeholder typed line layout',
      )?.boxes,
  );
  expect(saved?.find((b) => b.kind === 'clock')?.outline).toEqual({ color: '#000000', width: 40 });
  expect(saved?.find((b) => b.kind === 'upcoming')?.count).toBe(3);
  await app.close();
});

// Part A's review: the Countdown goes on past 0:00 in the overtime colour, so it says when a countdown chosen in Timers
// holds at 0:00 instead, and lets it run on when asked.
test('New from a Template… says when a countdown chosen in Timers stops at 0:00, and lets it run on past it when asked', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const held = await makeTimer(win, {
    name: 'Placeholder held countdown',
    kind: 'countdown',
    durationMs: 120_000,
    targetTime: null,
    allowsOverrun: false,
  });

  await win.getByTestId('stage-edit-layout').click();
  const editor = win.getByTestId('stage-layout-editor');
  await editor.getByTestId('stage-layout-from-template').click();
  const dialog = win.getByTestId('stage-template-dialog');
  await dialog.getByRole('radio', { name: 'Countdown', exact: true }).click();
  await dialog.getByTestId('stage-template-own-timer').click();
  await expect(dialog.getByTestId('stage-template-own-timer')).toBeChecked();
  // It holds at 0:00: said under the choice, with the choice to let it run on.
  await expect(dialog.getByTestId('stage-template-stops')).toContainText(
    '“Placeholder held countdown” stops at 0:00',
  );
  const runOn = dialog.getByTestId('stage-template-run-on');
  await runOn.click();
  await expect(runOn).toBeChecked();
  // Another template has nothing to say of it.
  await dialog.getByRole('radio', { name: 'Timer only', exact: true }).click();
  await expect(dialog.getByTestId('stage-template-stops')).toHaveCount(0);
  await dialog.getByRole('radio', { name: 'Countdown', exact: true }).click();
  await expect(runOn).toBeChecked();
  await dialog.getByTestId('stage-template-make').click();
  await expect(dialog).toHaveCount(0);
  // Let run on past 0:00, in Timers too: the same timer, nothing else of it changed.
  await expect
    .poll(async () => (await timersNow(win)).find((t) => t.id === held))
    .toMatchObject({ name: 'Placeholder held countdown', durationMs: 120_000, allowsOverrun: true });
  await app.close();
});
