import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PipPlace } from '../../src/shared/engine/state';
import { AUDIENCE_BOX_MIN, newStageBox, type StageBox } from '../../src/shared/stage-layouts';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode, TABLET } from './devices';
import {
  importAndGetIds,
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
import { makeTestImage } from './test-media';

/*
 * The audience picture, live, as a stage layout's box (Session 50), where Session 51 finished it: a video input
 * (Chromium's fake camera: DRASHTI_TEST_FAKE_DEVICES, never a real one), another app's window (Session 48's
 * stand-in: DRASHTI_TEST_WINDOW_STANDIN) and a picture-in-picture box show under it as on the hall's screen; with
 * Audience off it keeps the picture and says so in a corner, and the box of the audience screens' state says off;
 * a tablet draws it from its pictures, as the phone remote's picture does, naming a window it cannot draw; a
 * node with no audience screen of its own draws Main's hall as the live Look sets it, never every layer. Since
 * Session 52 it says Audience off in the picture's bottom left corner, where a stage message along the top never
 * covers it, and with no audience group at all it is black and says so in one short line, never every layer: on
 * this computer's stage screen (read in a small box, inside a tiny one), a tablet's and a node's. Since Session 53
 * Audience off keeps to 30 px at least while it fits, read in a box as small as the layout editor makes one, and
 * the box of the audience screens' state says there are none too: on this computer's stage screen, a node's and a
 * tablet's. Since Session 54 a tablet's muted line naming a window it cannot draw keeps to 30 px at least too, in
 * that box, under Audience off and alone. Placeholder words and generated media only. Quiet: outputs as windows,
 * nothing wider than 1024 assumed.
 */

const OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
const MEETING = 'Placeholder meeting';
const INPUT = 'Placeholder input';
/** The stage layout's box of the audience picture, on a stage page. */
const BOX = '[data-stage-box="audience"]';

/** The audience picture over the whole stage canvas. */
const HALL_BOX: StageBox = {
  ...newStageBox('audience', 'placeholder-hall-box'),
  frame: { x: 0, y: 0, width: 1920, height: 1080 },
};
/** The layout: that box alone. */
const BOXES: StageBox[] = [HALL_BOX];

/** The same, with the stage message along the top over the picture, where Standard has it (Session 52). */
const WITH_MESSAGE: StageBox[] = [
  ...BOXES,
  {
    ...newStageBox('stageMessage', 'placeholder-message-box'),
    frame: { x: 48, y: 48, width: 1824, height: 110 },
    size: 64,
  },
];

/** The box of the audience screens' state, along the top over the picture (Session 53). */
const STATE_BOX: StageBox = {
  ...newStageBox('screensState', 'placeholder-state-box'),
  frame: { x: 48, y: 48, width: 1824, height: 120 },
};

/** The stage message the performers are sent, placeholder words. */
const STAGE_MESSAGE = 'Placeholder: two minutes';
/** What the box says with no audience group at all (Session 52). */
const NO_AUDIENCE = 'No audience screens';

const PLACE: PipPlace = {
  corner: 'bottom-right',
  x: 0,
  y: 0,
  size: 'medium',
  border: true,
  rounded: true,
  motion: 'fade',
};

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/** Audience off or on, as the operator's switch turns it (Session 50). */
async function audience(win: Page, on: boolean): Promise<void> {
  const turned = await win.evaluate(
    (on) => (globalThis as PageGlobals).drashti.screenSwitches.turn('audience', on),
    on,
  );
  expect(turned).toMatchObject({ ok: true, switches: { audience: on } });
}

/** The roles of the output windows open now, sorted. */
const openRoles = async (app: ElectronApplication) =>
  (
    await Promise.all(outputPages(app).map((p) => p.getByTestId('output-root').getAttribute('data-role')))
  ).sort();

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

/**
 * Make "Stage" a stage group (making it first when asked) whose layout, in the live Look, is the audience picture
 * over the whole canvas (or these boxes); the hall's group's id ("Main Hall"), and the stage group's.
 */
function stageWithHallPicture(
  win: Page,
  make: boolean,
  boxes: StageBox[] = BOXES,
): Promise<{ hallGroup: string; stageGroup: string }> {
  return win.evaluate(
    async ({ boxes, make }) => {
      const d = (globalThis as PageGlobals).drashti;
      if (make) {
        const made = await d.screens.createGroup('Stage');
        if (!made.ok) throw new Error(made.message);
      }
      const groups = (await d.screens.get()).groups;
      const stage = groups.find((g) => g.name === 'Stage');
      const hall = groups.find((g) => g.name === 'Main Hall');
      if (!stage || !hall) throw new Error('no hall or stage group');
      const role = await d.screens.setGroupRole(stage.id, 'stage');
      if (!role.ok) throw new Error(role.message);
      const saved = await d.stageLayouts.save(null, {
        name: 'Placeholder hall picture layout',
        background: '#000000',
        boxes,
      });
      if (!saved.ok) throw new Error(saved.message);
      const looks = await d.looks.list();
      const set = await d.looks.setGroup(looks.liveId, stage.id, { stageLayoutId: saved.id });
      if (!set.ok) throw new Error(set.message);
      return { hallGroup: hall.id, stageGroup: stage.id };
    },
    { boxes, make },
  );
}

/**
 * Save a stage layout of these boxes (again, given its id) and give it, in the live Look, to the stage group; the
 * layout's id.
 */
function giveLayout(
  win: Page,
  stageGroup: string,
  boxes: StageBox[],
  layoutId: string | null = null,
): Promise<string> {
  return win.evaluate(
    async ({ boxes, stageGroup, layoutId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const saved = await d.stageLayouts.save(layoutId, {
        name: 'Placeholder stage box layout',
        background: '#000000',
        boxes,
      });
      if (!saved.ok) throw new Error(saved.message);
      const set = await d.looks.setGroup((await d.looks.list()).liveId, stageGroup, {
        stageLayoutId: saved.id,
      });
      if (!set.ok) throw new Error(set.message);
      return saved.id;
    },
    { boxes, stageGroup, layoutId },
  );
}

/** Delete a screen group, as Screens' Delete group does. */
async function deleteGroup(win: Page, groupId: string): Promise<void> {
  const deleted = await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.screens.deleteGroup(id),
    groupId,
  );
  expect(deleted.ok).toBe(true);
}

/** The hall's screen on the first display and the stage screen, with the hall picture layout, on the second. */
async function hallAndStage(
  app: ElectronApplication,
  win: Page,
  boxes: StageBox[] = BOXES,
): Promise<{ hall: Page; stage: Page; hallGroup: string; stageGroup: string }> {
  const hallId = await setUpScreen(win, 'Main Hall', 0);
  const stageId = await setUpScreen(win, 'Stage', 1);
  const { hallGroup, stageGroup } = await stageWithHallPicture(win, false, boxes);
  const hall = await outputFor(app, hallId);
  const stage = await outputFor(app, stageId);
  await outputReady(hall);
  await outputReady(stage);
  await expect(stage.locator(BOX).getByTestId('stage-audience')).toHaveAttribute(
    'data-hall-group',
    hallGroup,
  );
  return { hall, stage, hallGroup, stageGroup };
}

/** The placeholder slide's words, as a screen draws them (a theme may write them in capitals). */
const WORDS = /placeholder words for the hall/iu;

/** A placeholder presentation's slide up over a colour. */
async function slideOverColour(win: Page): Promise<void> {
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
}

/**
 * What a picture of the show draws, read from its Scene (as stage-layouts.spec.ts reads it): its canvas and
 * Look's layers, the background's colour, the slide's words, the messages, black-out and the logo.
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

/**
 * A live picture on a page (a video input's or a window's, found by `selector`): how its capture stands, and its
 * picture now, made small: whether it has light in it (the fake camera's moving pattern, never black), and
 * whether its top left is the placeholder window's blue.
 */
function livePicture(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const state = el?.getAttribute('data-input-state') ?? el?.getAttribute('data-window-state') ?? null;
    const video = el?.querySelector('video');
    let lit = false;
    let blue = false;
    if (video && video.videoWidth > 0) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 36;
      const g = c.getContext('2d');
      if (g) {
        g.drawImage(video, 0, 0, 64, 36);
        const data = g.getImageData(0, 0, 64, 36).data;
        for (let i = 0; i < data.length; i += 4)
          if (Math.max(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0) > 60) lit = true;
        const [r = 0, gr = 0, b = 0] = g.getImageData(4, 4, 1, 1).data;
        blue = b > 150 && r < 90 && gr < 140;
      }
    }
    return { state, lit, blue };
  }, selector);
}

/** Chromium's fake camera's name, as the operator window's page sees it (it is the only camera there is). */
async function fakeCamera(win: Page): Promise<string> {
  const label = await win.evaluate(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.find((d) => d.kind === 'videoinput' && d.label !== '')?.label ?? '';
  });
  return label || 'fake_device_0';
}

/** A placeholder window, opened in Drashti's own process without taking the focus: blue, a bar going across. */
function openPlaceholder(app: ElectronApplication): Promise<number> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${MEETING}</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#1d4ed8}#bar{position:absolute;top:35%;left:0;width:20%;height:30%;background:#facc15}</style></head><body><div id="bar"></div><script>let x=0;setInterval(()=>{x=(x+2)%80;document.getElementById('bar').style.left=x+'%'},40)</script></body></html>`;
  return app.evaluate(async ({ BrowserWindow }, page) => {
    const w = new BrowserWindow({
      width: 640,
      height: 360,
      show: false,
      title: 'Placeholder meeting',
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
    w.showInactive();
    return w.id;
  }, html);
}

test('a video input, a window and a picture-in-picture box show under the stage box, as on the hall’s screen', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({
    ...OUTPUTS,
    DRASHTI_TEST_FAKE_DEVICES: '1',
    DRASHTI_TEST_WINDOW_STANDIN: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const { hall, stage } = await hallAndStage(app, win);

  // A video input (the fake camera) as the background: live in the hall's picture and in the stage box.
  const camera = await fakeCamera(win);
  const inputId = await win.evaluate(
    async ({ device, name }) => {
      const made = await (globalThis as PageGlobals).drashti.videoInputs.add({ name, device, fit: 'fit' });
      if (!made.ok) throw new Error(made.message);
      return made.view.inputs.find((i) => i.name === name)?.id ?? '';
    },
    { device: camera, name: INPUT },
  );
  await dispatch(win, { type: 'showInput', inputId });
  const inputUp = '[data-bg-slot][data-kind="input"]';
  await expect
    .poll(() => livePicture(hall, inputUp), { timeout: 15_000 })
    .toMatchObject({ state: 'live', lit: true });
  await expect
    .poll(() => livePicture(stage, `${BOX} ${inputUp}`), { timeout: 15_000 })
    .toMatchObject({ state: 'live', lit: true });

  // Another app's window (the placeholder, from Show a Window…'s list) as the background, in place of the input.
  const meeting = await openPlaceholder(app);
  const shown = await win.evaluate(async (name) => {
    const d = (globalThis as PageGlobals).drashti;
    const list = await d.liveWindow.list();
    const choice = list.ok ? list.windows.find((w) => w.name === name) : undefined;
    if (!choice) throw new Error('the placeholder window is not offered');
    return d.liveWindow.show(choice.id);
  }, MEETING);
  expect(shown).toEqual({ ok: true });
  const windowUp = '[data-layer="background"][data-kind="window"]';
  await expect
    .poll(() => livePicture(hall, windowUp), { timeout: 15_000 })
    .toMatchObject({ state: 'live', blue: true });
  await expect
    .poll(() => livePicture(stage, `${BOX} ${windowUp}`), { timeout: 15_000 })
    .toMatchObject({ state: 'live', blue: true });
  await expect(stage.locator(`${BOX} ${inputUp}`)).toHaveCount(0);

  // A picture-in-picture box holding the input, over the window: both in the stage box, as on the hall's screen.
  await dispatch(win, { type: 'showPip', source: { kind: 'input', inputId }, place: PLACE });
  const inBox = '[data-testid="pip-box"] [data-pip-picture="input"]';
  await expect
    .poll(() => livePicture(hall, inBox), { timeout: 15_000 })
    .toMatchObject({ state: 'live', lit: true });
  await expect
    .poll(() => livePicture(stage, `${BOX} ${inBox}`), { timeout: 15_000 })
    .toMatchObject({ state: 'live', lit: true });
  await expect(stage.locator(`${BOX} [data-testid="pip-box"]`)).toHaveAttribute(
    'data-pip-corner',
    'bottom-right',
  );
  expect(await livePicture(stage, `${BOX} ${windowUp}`)).toMatchObject({ state: 'live' });

  await dispatch(win, { type: 'hidePip' });
  await expect(stage.locator(`${BOX} [data-testid="pip-box"]`)).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), meeting);
  await app.close();
});

/**
 * Audience off in the box, as the page draws it (Session 53): the box's size and the words' in stage canvas pixels
 * (drawn on the picture, which is scaled into the box), whether the picture is drawn fitted to the box's size yet,
 * whether the words lie wholly inside the picture, and whether they sit in its bottom left.
 */
const audienceOffOn = (box: Locator) =>
  box.getByTestId('stage-audience-off').evaluate((said) => {
    const area = said.closest<HTMLElement>('[data-testid="stage-audience"]');
    const picture = said.closest<HTMLElement>('[data-hall-picture]');
    if (!area || !picture) return null;
    const a = area.getBoundingClientRect();
    const p = picture.getBoundingClientRect();
    const r = said.getBoundingClientRect();
    // The picture's pixels on the page, and the page's in stage canvas pixels.
    const stage = (p.width / picture.offsetWidth) * (area.clientWidth / a.width);
    // Fitted as the box draws it, one side the box's and the other no larger (to a pixel): until the box's new size
    // reaches the picture, it is drawn at the scale of the size before, and its words read at that scale.
    const near = (x: number, y: number) => Math.abs(x - y) <= 1;
    return {
      box: `${String(area.clientWidth)}x${String(area.clientHeight)}`,
      size: Math.round(parseFloat(getComputedStyle(said).fontSize) * stage * 10) / 10,
      fitted:
        (near(p.width, a.width) && p.height <= a.height + 1) ||
        (near(p.height, a.height) && p.width <= a.width + 1),
      inside:
        r.left >= p.left - 0.5 &&
        r.top >= p.top - 0.5 &&
        r.right <= p.right + 0.5 &&
        r.bottom <= p.bottom + 0.5,
      bottomLeft: r.left - p.left < p.width / 4 && p.bottom - r.bottom < p.height / 4,
    };
  });

/**
 * The box's first muted line naming what a page cannot draw (Session 54), as the page draws it, as audienceOffOn
 * reads Audience off: the box's size and the line's in stage canvas pixels, its words, whether the picture is drawn
 * fitted to the box's size yet, whether the line lies wholly inside the picture, and whether it sits in its bottom
 * left.
 */
const unseenOn = (box: Locator) =>
  box
    .getByTestId('stage-audience-unseen')
    .first()
    .evaluate((line) => {
      const area = line.closest<HTMLElement>('[data-testid="stage-audience"]');
      const picture = line.closest<HTMLElement>('[data-hall-picture]');
      if (!area || !picture) return null;
      const a = area.getBoundingClientRect();
      const p = picture.getBoundingClientRect();
      const r = line.getBoundingClientRect();
      const stage = (p.width / picture.offsetWidth) * (area.clientWidth / a.width);
      const near = (x: number, y: number) => Math.abs(x - y) <= 1;
      return {
        box: `${String(area.clientWidth)}x${String(area.clientHeight)}`,
        text: line.textContent,
        size: Math.round(parseFloat(getComputedStyle(line).fontSize) * stage * 10) / 10,
        fitted:
          (near(p.width, a.width) && p.height <= a.height + 1) ||
          (near(p.height, a.height) && p.width <= a.width + 1),
        inside:
          r.left >= p.left - 0.5 &&
          r.top >= p.top - 0.5 &&
          r.right <= p.right + 0.5 &&
          r.bottom <= p.bottom + 0.5,
        bottomLeft: r.left - p.left < p.width / 4 && p.bottom - r.bottom < p.height / 4,
      };
    });

test('with Audience off the stage box keeps the hall’s picture and says “Audience off” in its bottom left corner, clear of the stage message, at 30 px at least in a small box', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(OUTPUTS);
  const win = await operatorPage(app);
  await operatorReady(win);
  // The stage message along the top, over the picture, as Standard has it, with a message up (Session 52).
  const { stage, stageGroup } = await hallAndStage(app, win, WITH_MESSAGE);
  await slideOverColour(win);
  await dispatch(win, { type: 'setStageMessage', text: STAGE_MESSAGE });
  const message = stage.getByTestId('stage-box-message');
  await expect(message).toHaveText(STAGE_MESSAGE);
  const box = stage.locator(BOX);
  const picture = box.getByTestId('scene');
  const drawn = { background: 'rgb(31, 111, 139)', words: expect.stringMatching(WORDS) };
  await expect.poll(() => sceneOn(picture)).toMatchObject(drawn);
  await expect(box.getByTestId('stage-audience')).toHaveAttribute('data-audience', 'on');
  await expect(box.getByTestId('stage-audience-off')).toHaveCount(0);

  // Off: the hall's screen closes, its display the computer's; the box keeps the picture, and says so.
  await audience(win, false);
  await expect.poll(() => openRoles(app)).toEqual(['stage']);
  const said = box.getByTestId('stage-audience-off');
  await expect(said).toHaveText('Audience off');
  await expect(box.getByTestId('stage-audience')).toHaveAttribute('data-audience', 'off');
  expect(await sceneOn(picture)).toMatchObject(drawn);
  // In the picture's bottom left corner (Session 52; its top left until then, where the stage message along the
  // top covered it), and over it: at its middle is the label itself, never the message.
  const where = await said.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const p = el.closest('[data-hall-picture]')?.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return p
      ? {
          left: (r.left - p.left) / p.width,
          top: (r.top - p.top) / p.height,
          right: (r.right - p.left) / p.width,
          bottom: (r.bottom - p.top) / p.height,
          over: hit !== null && el.contains(hit),
        }
      : null;
  });
  expect(where).not.toBeNull();
  expect(where?.left).toBeLessThan(0.05);
  expect(where?.right).toBeLessThan(0.5);
  expect(where?.top).toBeGreaterThan(0.8);
  expect(where?.bottom).toBeGreaterThan(0.93);
  expect(where?.bottom).toBeLessThanOrEqual(1);
  expect(where?.over).toBe(true);
  // As large as ever in a box the size of the stage: 64 px.
  expect(await audienceOffOn(box)).toMatchObject({
    box: '1920x1080',
    size: 64,
    inside: true,
    bottomLeft: true,
  });
  // The message stays along the top, over the picture: the stage sees both.
  await expect(message).toHaveText(STAGE_MESSAGE);
  expect(
    await message.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit !== null && el.contains(hit);
    }),
  ).toBe(true);

  // In a box as small as the layout editor makes one (a sixth of the stage each way, Session 53): never below a
  // box's label (30 px), where on the picture at 64 px it was a sixth of that, in its bottom left, wholly inside.
  const small = { ...HALL_BOX, frame: { x: 800, y: 450, ...AUDIENCE_BOX_MIN } };
  const layoutId = await giveLayout(win, stageGroup, [small]);
  await expect
    .poll(() => audienceOffOn(box))
    .toMatchObject({ box: '320x180', fitted: true, inside: true, bottomLeft: true });
  expect((await audienceOffOn(box))?.size).toBeGreaterThanOrEqual(30);
  // A smaller one, saved before the editor stopped there: smaller, as it must be to fit, and still wholly inside.
  await giveLayout(
    win,
    stageGroup,
    [{ ...HALL_BOX, frame: { x: 900, y: 500, width: 96, height: 54 } }],
    layoutId,
  );
  await expect.poll(() => audienceOffOn(box)).toMatchObject({ box: '96x54', fitted: true, inside: true });
  expect((await audienceOffOn(box))?.size).toBeLessThan(30);

  // On again: the hall's screen opens where it was; the box says nothing more.
  await audience(win, true);
  await expect.poll(() => openRoles(app)).toEqual(['audience', 'stage']);
  await expect(said).toHaveCount(0);
  await expect(box.getByTestId('stage-audience')).toHaveAttribute('data-audience', 'on');
  await app.close();
});

/**
 * The box's line with no audience group (Session 52), as the page draws it: the box's size and the line's in stage
 * canvas pixels, its words, whether it lies wholly inside the box with no word cut, and whether it sits in the
 * box's bottom left.
 */
const noAudienceLineOn = (box: Locator) =>
  box.getByTestId('stage-audience').evaluate((area) => {
    const line = area.querySelector<HTMLElement>('[data-testid="stage-audience-none"]');
    if (!line) return null;
    const a = area.getBoundingClientRect();
    const r = line.getBoundingClientRect();
    return {
      box: `${String(area.clientWidth)}x${String(area.clientHeight)}`,
      text: line.textContent,
      size: parseFloat(getComputedStyle(line).fontSize),
      inside:
        r.left >= a.left - 0.5 &&
        r.top >= a.top - 0.5 &&
        r.right <= a.right + 0.5 &&
        r.bottom <= a.bottom + 0.5,
      whole: line.scrollWidth <= line.clientWidth + 0.5,
      bottomLeft: r.left - a.left < a.width / 4 && a.bottom - r.bottom < a.height / 4,
    };
  });

test('with no audience group at all the stage box is black and says so in one short line, read in a small box, never every layer, and the box of the audience screens’ state says so too', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(OUTPUTS);
  const win = await operatorPage(app);
  await operatorReady(win);
  // The stage screen alone: no group shows the audience picture.
  const stageId = await setUpScreen(win, 'Stage', 0);
  const stageGroup = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.name === 'Stage');
    if (!group) throw new Error('no stage group');
    const role = await d.screens.setGroupRole(group.id, 'stage');
    if (!role.ok) throw new Error(role.message);
    return group.id;
  });
  const layoutId = await giveLayout(win, stageGroup, [...BOXES, STATE_BOX]);
  const stage = await outputFor(app, stageId);
  await outputReady(stage);
  // A slide over a colour: every layer would draw it, and the box must not.
  await slideOverColour(win);
  const box = stage.locator(BOX);
  const area = box.getByTestId('stage-audience');
  await expect(area).toHaveAttribute('data-audience', 'none');
  await expect(area).toHaveAttribute('data-hall-group', '');
  await expect(box.getByTestId('stage-audience-none')).toHaveText(NO_AUDIENCE);
  await expect(box.getByTestId('scene')).toHaveCount(0);
  await expect(box).not.toContainText(WORDS);
  // The box of the audience screens' state says the same (Session 53: it said they were showing).
  const screensState = stage.locator('[data-stage-box="screensState"]');
  await expect(screensState).toHaveText(NO_AUDIENCE);
  // In the whole stage: as large as Audience off is there (64 px), in the box's bottom left corner.
  await expect
    .poll(() => noAudienceLineOn(box))
    .toEqual({
      box: '1920x1080',
      text: NO_AUDIENCE,
      size: 64,
      inside: true,
      whole: true,
      bottomLeft: true,
    });

  // A small box (a sixth of the stage each way): never smaller than a box's label (30 px), and inside it.
  await giveLayout(
    win,
    stageGroup,
    [{ ...HALL_BOX, frame: { x: 800, y: 450, width: 320, height: 180 } }, STATE_BOX],
    layoutId,
  );
  await expect
    .poll(() => noAudienceLineOn(box))
    .toMatchObject({ box: '320x180', text: NO_AUDIENCE, inside: true, whole: true, bottomLeft: true });
  expect((await noAudienceLineOn(box))?.size).toBeGreaterThanOrEqual(30);

  // A tiny one (a twentieth each way): smaller, as it must be to fit, and still wholly inside it.
  await giveLayout(
    win,
    stageGroup,
    [{ ...HALL_BOX, frame: { x: 900, y: 500, width: 96, height: 54 } }, STATE_BOX],
    layoutId,
  );
  await expect
    .poll(() => noAudienceLineOn(box))
    .toMatchObject({ box: '96x54', text: NO_AUDIENCE, inside: true, whole: true });
  expect((await noAudienceLineOn(box))?.size).toBeLessThan(30);

  await expect(screensState).toHaveText(NO_AUDIENCE);

  // An audience group with its screen: the box draws the hall's picture, and says nothing more.
  const hallId = await setUpScreen(win, 'Main Hall', 1);
  await outputReady(await outputFor(app, hallId));
  await expect(area).toHaveAttribute('data-audience', 'on');
  await expect(box.getByTestId('stage-audience-none')).toHaveCount(0);
  await expect(screensState).toHaveText('Audience screens showing');
  await expect
    .poll(() => sceneOn(box.getByTestId('scene')))
    .toMatchObject({ background: 'rgb(31, 111, 139)', words: expect.stringMatching(WORDS) });
  await app.close();
});

test('a tablet’s stage page draws the box from pictures at the width it draws them, as the remote’s live picture does, and says Audience off and no audience screens', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...NETWORK_ENV, ...OUTPUTS });
  const win = await operatorPage(app);
  await operatorReady(win);
  // The hall's screen on this computer; the stage group, with the layout, has no screen here: the tablet shows it.
  await setUpScreen(win, 'Main Hall', 0);
  const { hallGroup } = await stageWithHallPicture(win, true);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-stage-hall-picture-'));
  const [pictureId = ''] = await importAndGetIds(win, [
    await makeTestImage(win, join(dir, 'Placeholder hall picture.png'), {
      width: 640,
      height: 360,
      color: '#1e3a8a',
    }),
  ]);
  await dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId: pictureId, media: 'image', fit: 'fit', loop: false },
  });
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'stage', 'Placeholder tablet');
  const tablet = await device('chromium', TABLET);
  const loads: string[] = [];
  tablet.page.on('request', (r) => loads.push(new URL(r.url()).pathname));
  try {
    await pairByQr(tablet.page, base, code, '/stage');
    const box = tablet.page.locator(BOX);
    await expect(box.getByTestId('stage-audience')).toHaveAttribute('data-hall-group', hallGroup);
    // The picture at the width the tablet draws it (Session 54, D1; its small preview before), as the phone
    // remote's live picture draws it: never a file in pieces.
    await expect(box.locator(`img[data-preview="shown"][data-media-id^="${pictureId}"]`)).toHaveCount(1, {
      timeout: 30_000,
    });
    expect(loads.some((p) => p.startsWith(`/api/v1/media/${pictureId}`) && p.endsWith('/picture'))).toBe(
      true,
    );
    expect(loads.filter((p) => p.includes('/media/') && !p.endsWith('/picture'))).toEqual([]);

    // Audience off on Drashti's computer: said in the box's corner, the picture kept.
    await audience(win, false);
    await expect(box.getByTestId('stage-audience-off')).toHaveText('Audience off');
    await expect(box.locator('img[data-preview="shown"]')).toHaveCount(1);
    await audience(win, true);
    await expect(box.getByTestId('stage-audience-off')).toHaveCount(0);

    // No audience group at all (Session 52): black, and said in one short line, never every layer (the picture).
    await deleteGroup(win, hallGroup);
    await expect(box.getByTestId('stage-audience')).toHaveAttribute('data-audience', 'none');
    await expect(box.getByTestId('stage-audience-none')).toHaveText(NO_AUDIENCE);
    await expect(box.getByTestId('scene')).toHaveCount(0);
    await expect(box.locator('img[data-preview]')).toHaveCount(0);
  } finally {
    await tablet.close();
  }
  await app.close();
});

/** A node's displays as Main last heard of them. */
async function nodeDisplays(win: Page, nodeId: string): Promise<number[]> {
  return win.evaluate(
    async (id) =>
      (
        (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((n) => n.id === id)?.displays ??
        []
      ).map((d) => d.id),
    nodeId,
  );
}

test('on a node with no audience screen, the stage box draws Main’s hall as the live Look sets it, and says Audience off and no audience screens', async () => {
  test.setTimeout(240_000);
  const main = await launchMain();
  const node = await launchNode();
  try {
    const nodeId = await pairNode(main, node);
    // Main's hall on its second display; the stage group on the node's: the node has no audience screen. The box
    // of the audience screens' state over the picture (Session 53).
    await setUpScreen(main.win, 'Main Hall', 1);
    const { hallGroup, stageGroup } = await stageWithHallPicture(main.win, true, [...BOXES, STATE_BOX]);
    await expect.poll(async () => (await nodeDisplays(main.win, nodeId)).length).toBeGreaterThanOrEqual(2);
    const displayId = (await nodeDisplays(main.win, nodeId))[1] ?? -1;
    const assigned = await main.win.evaluate(
      (a) => (globalThis as PageGlobals).drashti.screens.assignNodeDisplay(a.group, a.nodeId, a.displayId),
      { group: stageGroup, nodeId, displayId },
    );
    expect(assigned.ok).toBe(true);
    const hall = await outputPage(main.app);
    const nodeStage = await outputPage(node.app);
    await outputReady(hall);
    await outputReady(nodeStage);

    // The hall's Look leaves the messages out: its screen shows none, and the node's box none either.
    await main.win.evaluate(async (group) => {
      const d = (globalThis as PageGlobals).drashti;
      const set = await d.looks.setGroup((await d.looks.list()).liveId, group, {
        layers: ['background', 'slide', 'props', 'pip', 'ticker', 'masks'],
      });
      if (!set.ok) throw new Error(set.message);
    }, hallGroup);
    await slideOverColour(main.win);
    await dispatch(main.win, {
      type: 'showMessage',
      message: { id: 'placeholder-message', text: 'Placeholder message for the hall' },
    });
    const box = nodeStage.locator(BOX);
    await expect(box.getByTestId('stage-audience')).toHaveAttribute('data-hall-group', hallGroup);
    const inHall = hall.getByTestId('scene');
    await expect
      .poll(() => sceneOn(inHall))
      .toMatchObject({
        canvas: '1920x1080',
        background: 'rgb(31, 111, 139)',
        words: expect.stringMatching(WORDS),
        messages: [],
      });
    await expect.poll(() => sceneOn(box.getByTestId('scene'))).toEqual(await sceneOn(inHall));
    const screensState = nodeStage.locator('[data-stage-box="screensState"]');
    await expect(screensState).toHaveText('Audience screens showing');

    // Audience off on Main closes Main's hall: the node's box keeps the picture and says so.
    await audience(main.win, false);
    await expect(box.getByTestId('stage-audience-off')).toHaveText('Audience off');
    expect(await sceneOn(box.getByTestId('scene'))).toMatchObject({ words: expect.stringMatching(WORDS) });
    await audience(main.win, true);
    await expect(box.getByTestId('stage-audience-off')).toHaveCount(0);

    // No audience group at all on Main (Session 52): the node's box is black and says so, never every layer, and
    // the box of the audience screens' state says so too (Session 53).
    await deleteGroup(main.win, hallGroup);
    await expect(box.getByTestId('stage-audience')).toHaveAttribute('data-audience', 'none');
    await expect(box.getByTestId('stage-audience-none')).toHaveText(NO_AUDIENCE);
    await expect(box.getByTestId('scene')).toHaveCount(0);
    await expect(box).not.toContainText(WORDS);
    await expect(screensState).toHaveText(NO_AUDIENCE);
  } finally {
    await node.app.close();
    await main.app.close();
  }
});

test('a tablet’s box names a window it cannot draw, at 30 px at least in a small box, and the box of the audience screens says when they are off, and when there are none', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...NETWORK_ENV, ...OUTPUTS, DRASHTI_TEST_WINDOW_STANDIN: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  const { hallGroup, stageGroup } = await stageWithHallPicture(win, true);
  // The picture, with the box of the audience screens' state under it.
  const stateUnder: StageBox = {
    ...newStageBox('screensState', 'placeholder-state-box'),
    frame: { x: 0, y: 920, width: 1920, height: 120 },
  };
  const boxes = [
    { ...newStageBox('audience', 'placeholder-hall-box'), frame: { x: 0, y: 0, width: 1920, height: 900 } },
    stateUnder,
  ];
  await win.evaluate(
    async ({ boxes, stageGroup }) => {
      const d = (globalThis as PageGlobals).drashti;
      const saved = await d.stageLayouts.save(null, {
        name: 'Placeholder hall picture and state layout',
        background: '#000000',
        boxes,
      });
      if (!saved.ok) throw new Error(saved.message);
      const set = await d.looks.setGroup((await d.looks.list()).liveId, stageGroup, {
        stageLayoutId: saved.id,
      });
      if (!set.ok) throw new Error(set.message);
    },
    { boxes, stageGroup },
  );
  // Another app's window (the placeholder) as the hall's background.
  const meeting = await openPlaceholder(app);
  const shown = await win.evaluate(async (name) => {
    const d = (globalThis as PageGlobals).drashti;
    const list = await d.liveWindow.list();
    const choice = list.ok ? list.windows.find((w) => w.name === name) : undefined;
    if (!choice) throw new Error('the placeholder window is not offered');
    return d.liveWindow.show(choice.id);
  }, MEETING);
  expect(shown).toEqual({ ok: true });
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'stage', 'Placeholder tablet');
  const tablet = await device('chromium', TABLET);
  try {
    await pairByQr(tablet.page, base, code, '/stage');
    const box = tablet.page.locator(BOX);
    // Never drawn there, as on the phone remote's picture: named in its words, in the box's corner.
    await expect(box.getByTestId('stage-audience-unseen')).toHaveText(`A window: ${MEETING}`);
    await expect(box.locator('[data-kind="window"]')).toHaveCount(0);
    const screensState = tablet.page.locator('[data-stage-box="screensState"]');
    await expect(screensState).toHaveText('Audience screens showing');

    // Audience off: the box says so above the window's name, and the box of the screens' state says they are off.
    await audience(win, false);
    await expect(screensState).toHaveText('Audience screens off');
    await expect(box.getByTestId('stage-audience-off')).toHaveText('Audience off');
    await expect(box.getByTestId('stage-audience-unseen')).toHaveText(`A window: ${MEETING}`);
    await audience(win, true);
    await expect(screensState).toHaveText('Audience screens showing');
    await expect(box.getByTestId('stage-audience-off')).toHaveCount(0);

    // In a box as small as the layout editor makes one (Session 54): the window's name keeps to 30 px at least, as
    // Audience off does, where at 40 px on the picture it was a sixth of that; alone, and under Audience off, each
    // wholly inside the picture, the name in its bottom left (Audience off above it).
    const small = {
      ...newStageBox('audience', 'placeholder-hall-box'),
      frame: { x: 800, y: 450, ...AUDIENCE_BOX_MIN },
    };
    await giveLayout(win, stageGroup, [small, stateUnder]);
    const named = {
      box: '320x180',
      text: `A window: ${MEETING}`,
      fitted: true,
      inside: true,
      bottomLeft: true,
    };
    await expect.poll(() => unseenOn(box)).toMatchObject(named);
    expect((await unseenOn(box))?.size).toBeGreaterThanOrEqual(30);
    await audience(win, false);
    await expect(box.getByTestId('stage-audience-off')).toHaveText('Audience off');
    await expect.poll(() => unseenOn(box)).toMatchObject(named);
    expect((await unseenOn(box))?.size).toBeGreaterThanOrEqual(30);
    expect(await audienceOffOn(box)).toMatchObject({ box: '320x180', fitted: true, inside: true });
    expect((await audienceOffOn(box))?.size).toBeGreaterThanOrEqual(30);
    await audience(win, true);
    await expect(box.getByTestId('stage-audience-off')).toHaveCount(0);

    // No audience group at all (Session 53): the box of the audience screens' state says so, as the picture's does.
    await deleteGroup(win, hallGroup);
    await expect(box.getByTestId('stage-audience-none')).toHaveText(NO_AUDIENCE);
    await expect(screensState).toHaveText(NO_AUDIENCE);
    await expect(box.getByTestId('stage-audience-unseen')).toHaveCount(0);
  } finally {
    await tablet.close();
  }
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), meeting);
  await app.close();
});
