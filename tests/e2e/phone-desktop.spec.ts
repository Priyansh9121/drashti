import type { BrowserContext, ElectronApplication, Page } from '@playwright/test';
import { chromium, expect, test, webkit } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { ONLY_ON_IN_SIMPLE_MODE } from '../../src/main/outputs/screen-switches';
import {
  apiCall,
  device,
  type Engine,
  NETWORK_ENV,
  networkOn,
  pairByQr,
  pairingCode,
  pairToken,
} from './devices';
import {
  importAndGetIds,
  launchApp,
  needsRealScreen,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { expectPhoneRefuses } from './phone-refuses';
import { makeTestTone, makeTestVideo } from './test-media';

/*
 * The phone as a full Drashti (Session 54, the owner's item 3: "the drashti phone should be just like a mirror …
 * full of drashti connection") ended in alpha.23 (QA23-PHONE-1, the owner: "no video access in either of simple or
 * pro mode in phone, they cant change videos, only ppts an pdfs, that also in pro mode, in simple mode only show the
 * flow, whats running in live, and chat"). Every request the phone's sheets made (the computer's screens, Keep these
 * screens?, Audience and Stage, video inputs and windows, picture in picture, the library and the playlists, an Audio
 * track, a folder, MIDI and the announcements' queue) is refused in words, in Pro Mode and Simple Mode, from Safari's
 * engine and Chrome's at 375 × 812 and 768 × 1024, and nothing changes; the same steps made in the operator window
 * (moved from the phone) give what the phone's gave. A Stage or Announcements device can do none of it, and nothing a
 * phone sends asks the computer's own box to cover the controls. Drashti's pretend displays and windowed outputs;
 * placeholder names; codes and tokens made at run time and never printed.
 */

/** The first pretend display's id (src/main/outputs/electron-outputs.ts, EXTRA_DISPLAY_ID). */
const PRETEND = 900_000_000;
/**
 * Keep these screens? asked (a test about it), the outputs windows on Drashti's pretend displays, the first counting
 * as the controls' (Session 55: only an output there asks; DRASHTI_TEST_CONTROLS_DISPLAY).
 */
const ASKS = {
  ...NETWORK_ENV,
  DRASHTI_TEST_KEEP_SCREENS: '1',
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_EXTRA_DISPLAYS: '2',
  DRASHTI_TEST_CONTROLS_DISPLAY: String(PRETEND),
};

/** The computer's box, answered as the operator would: Cover the controls (1), or Cancel (0); what it said kept. */
const answerBoxWith = (app: ElectronApplication, response: number) =>
  app.evaluate(({ dialog }, r) => {
    const said = globalThis as unknown as { boxes?: { message: string; detail: string }[] };
    said.boxes = [];
    Object.assign(dialog, {
      showMessageBox: (...args: unknown[]) => {
        const box = args.find((a) => typeof a === 'object' && a !== null && 'message' in a) as {
          message: string;
          detail: string;
        };
        said.boxes?.push({ message: box.message, detail: box.detail });
        return Promise.resolve({ response: r, checkboxChecked: false });
      },
    });
  }, response);

/** What the computer's box said, each time it asked. */
const boxes = (app: ElectronApplication) =>
  app.evaluate(
    () => (globalThis as unknown as { boxes?: { message: string; detail: string }[] }).boxes ?? [],
  );

const SIZES = [
  { name: 'a phone', width: 375, height: 812, layout: 'phone' },
  { name: 'a tablet', width: 768, height: 1024, layout: 'wide' },
] as const;

/** The screens as the window has them: every group with its screens, and how each stands. */
const screensNow = (win: Page) =>
  win.evaluate(async () => {
    const s = await (globalThis as PageGlobals).drashti.screens.get();
    return { groups: s.groups.filter((g) => g.role !== 'stream'), status: s.status };
  });

const pendingNow = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.screens.pending());

const switchesNow = (win: Page) =>
  win.evaluate(() => (globalThis as PageGlobals).drashti.screenSwitches.get());

const openOutputs = (app: ElectronApplication) => outputPages(app).filter((p) => !p.isClosed()).length;

/** A phone's page paired at this size (a phone's or a tablet's), on its own page in the browser given. */
async function phoneAt(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  win: Page,
  base: string,
  size: (typeof SIZES)[number],
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: true,
    hasTouch: true,
    bypassCSP: true,
  });
  const page = await context.newPage();
  await pairByQr(page, base, await pairingCode(win, 'remote', `Placeholder ${size.name}`), '/remote');
  await expect(page.getByTestId('connection')).toHaveText('Connected');
  return { context, page };
}

/** A screen group made in the window; its id. */
const newGroup = (win: Page, name: string) =>
  win.evaluate(async (n) => {
    const made = await (globalThis as PageGlobals).drashti.screens.createGroup(n);
    if (!made.ok) throw new Error(made.message);
    return made.snapshot.groups.find((g) => g.name === n)?.id ?? '';
  }, name);

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`the computer’s screens set up in the window as in Screens, Keep these screens? answered there with its countdown; a phone at 375 × 812 and 768 × 1024 is refused each step in words (${engine})`, async () => {
    test.setTimeout(300_000);
    const { app } = await launchApp(ASKS);
    const win = await operatorPage(app);
    await operatorReady(win);
    // The computer's own box would agree if a phone asked it to cover the (pretend) controls: no phone ever does now.
    await answerBoxWith(app, 1);
    const { base } = await networkOn(win);
    const question = win.getByTestId('keep-screens');
    const screens = () => screensNow(win);
    const browser = await (engine === 'webkit' ? webkit : chromium).launch();
    try {
      for (const size of SIZES) {
        const { context, page: p } = await phoneAt(browser, win, base, size);
        try {
          const asks = { win, page: p };
          const group = `Placeholder Hall ${size.name}`;
          // The phone's More: the screens read, a group added, a display's job, Identify, Audience and Stage; each
          // refused in words, nothing changed.
          await expectPhoneRefuses(asks, 'GET', '/api/v1/screens', undefined, 'computer');
          await expectPhoneRefuses(
            asks,
            'POST',
            '/api/v1/screen-groups',
            { name: group },
            'computer',
            screens,
          );
          await expectPhoneRefuses(
            asks,
            'POST',
            `/api/v1/displays/${String(PRETEND + 1)}/job`,
            { job: 'audience' },
            'computer',
            screens,
          );
          await expectPhoneRefuses(asks, 'POST', '/api/v1/screens/identify', undefined, 'computer');
          await expectPhoneRefuses(asks, 'POST', '/api/v1/switches/audience', { on: false }, 'computer', () =>
            switchesNow(win),
          );
          expect(openOutputs(app)).toBe(0);

          // A group added in the window (moved from the phone) is there at once.
          const groupId = await newGroup(win, group);
          await expect.poll(async () => (await screens()).groups.map((g) => g.name)).toContain(group);

          // A display's job in one step (Session 55), on the other pretend display: the audience picture at once,
          // asking nothing; Not used takes it off again.
          const job = (j: 'audience' | 'none') =>
            win.evaluate(({ id, j }) => (globalThis as PageGlobals).drashti.screens.setJob(id, j), {
              id: PRETEND + 1,
              j,
            });
          expect((await job('audience')).ok).toBe(true);
          await expect.poll(() => openOutputs(app)).toBe(1);
          expect(await pendingNow(win)).toBeNull();
          expect((await job('none')).ok).toBe(true);
          await expect.poll(() => openOutputs(app)).toBe(0);

          // Use this display on the pretend one the controls are on: the phone refused; in the window, the operator
          // agreeing there, it opens, and Keep these screens? asks with its countdown, Keep holding the keyboard.
          await expectPhoneRefuses(
            asks,
            'POST',
            `/api/v1/screen-groups/${groupId}/display`,
            { displayId: PRETEND },
            'computer',
            screens,
          );
          const used = await win.evaluate(
            ({ groupId, displayId }) =>
              (globalThis as PageGlobals).drashti.screens.assignDisplay(groupId, displayId, {
                coverOperator: true,
              }),
            { groupId, displayId: PRETEND },
          );
          expect(used.ok).toBe(true);
          await expect(question).toContainText('Keep these screens?');
          const countdown = question.getByTestId('keep-screens-countdown');
          await expect(countdown).toHaveText(/^Going back by itself in \d+ seconds?\.$/u);
          expect(Number(await countdown.getAttribute('data-seconds'))).toBeGreaterThan(5);
          expect(Number(await countdown.getAttribute('data-seconds'))).toBeLessThanOrEqual(15);
          await expect(question.getByTestId('keep-screens-keep')).toBeFocused();
          await expect.poll(() => openOutputs(app)).toBe(1);
          expect(await pendingNow(win)).toMatchObject({ coversControls: true });
          // The phone's Keep: refused, the question still waits. Keep, in the window: the change stays.
          await expectPhoneRefuses(asks, 'POST', '/api/v1/screens/keep', {}, 'computer', () =>
            pendingNow(win),
          );
          await question.getByTestId('keep-screens-keep').click();
          await expect(question).toHaveCount(0);
          await expect.poll(() => pendingNow(win)).toBeNull();
          await expect.poll(() => openOutputs(app)).toBe(1);
          const screenId = (await screens()).groups.find((g) => g.id === groupId)?.screens[0]?.id ?? '';
          expect(screenId).not.toBe('');
          const screenNow = async () =>
            (await screens()).groups.flatMap((g) => g.screens).find((sc) => sc.id === screenId);

          // Off asks nothing; On again (the operator agreeing) asks, and Go back puts it off again; the phone's Off,
          // On and Go back refused.
          const change = (patch: { enabled?: boolean; scaling?: 'fill' }, cover = false) =>
            win.evaluate(
              ({ screenId, patch, cover }) =>
                (globalThis as PageGlobals).drashti.screens.updateScreen(
                  screenId,
                  patch,
                  cover ? { coverOperator: true } : undefined,
                ),
              { screenId, patch, cover },
            );
          await expectPhoneRefuses(
            asks,
            'POST',
            `/api/v1/screens/${screenId}/change`,
            { enabled: false },
            'computer',
            screens,
          );
          expect((await change({ enabled: false })).ok).toBe(true);
          await expect.poll(() => openOutputs(app)).toBe(0);
          await expect(question).toHaveCount(0);
          expect((await screenNow())?.enabled).toBe(false);
          expect((await change({ enabled: true }, true)).ok).toBe(true);
          await expect(question).toBeVisible();
          await expectPhoneRefuses(asks, 'POST', '/api/v1/screens/go-back', {}, 'computer', () =>
            pendingNow(win),
          );
          await question.getByTestId('keep-screens-go-back').click();
          await expect(question).toHaveCount(0);
          await expect.poll(() => openOutputs(app)).toBe(0);
          await expect.poll(async () => (await screenNow())?.enabled).toBe(false);

          // Its scaling, and the group's name, as the window then has them; the phone's refused.
          await expectPhoneRefuses(
            asks,
            'POST',
            `/api/v1/screens/${screenId}/change`,
            { scaling: 'fill' },
            'computer',
            screens,
          );
          expect((await change({ scaling: 'fill' })).ok).toBe(true);
          await expect
            .poll(async () => (await screens()).groups.flatMap((g) => g.screens).map((sc) => sc.scaling))
            .toContain('fill');
          const renamed = `${group} renamed`;
          await expectPhoneRefuses(
            asks,
            'POST',
            `/api/v1/screen-groups/${groupId}/name`,
            { name: renamed },
            'computer',
            screens,
          );
          const named = await win.evaluate(
            ({ groupId, renamed }) =>
              (globalThis as PageGlobals).drashti.screens.renameGroup(groupId, renamed),
            { groupId, renamed },
          );
          expect(named.ok).toBe(true);
          await expect.poll(async () => (await screens()).groups.map((g) => g.name)).toContain(renamed);

          // Another group the window adds; both deleted in the window (the phone's Delete group refused): gone.
          const stageGroup = await newGroup(win, `Placeholder Stage ${size.name}`);
          for (const id of [groupId, stageGroup]) {
            await expectPhoneRefuses(
              asks,
              'POST',
              `/api/v1/screen-groups/${id}/delete`,
              {},
              'computer',
              screens,
            );
            const gone = await win.evaluate(
              (id) => (globalThis as PageGlobals).drashti.screens.deleteGroup(id),
              id,
            );
            expect(gone.ok).toBe(true);
          }
          await expect.poll(async () => (await screens()).groups).toEqual([]);
          await expect(p.getByTestId('remote')).toBeVisible();
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
    // Nothing a phone sent asked the computer's own box.
    expect(await boxes(app)).toEqual([]);
    await app.close();
  });

/** Chromium's fake camera, as the computer names it (DRASHTI_TEST_FAKE_DEVICES), and the window stand-in's name. */
const FAKE_CAMERA = 'fake_device_0';
const MEETING = 'Placeholder meeting';

/** A placeholder meeting window, opened in Drashti's own process without the focus (show-a-window.spec.ts's). */
const openMeeting = (app: ElectronApplication) =>
  app.evaluate(async ({ BrowserWindow }, title) => {
    const w = new BrowserWindow({
      width: 640,
      height: 360,
      show: false,
      title,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    const html = `<!doctype html><title>${title}</title><body style="background:#1d4ed8">`;
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    w.showInactive();
    return w.id;
  }, MEETING);

const backgroundNow = (win: Page) =>
  win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
  );

const inputsNow = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.videoInputs.list()).inputs);

const dispatch = (win: Page, command: Parameters<PageGlobals['drashti']['engine']['dispatch']>[0]) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`video inputs and windows in the window as in Media: one named from the computer’s cameras, put up, changed and deleted, and a window from its list; a phone at 375 × 812 and 768 × 1024 is refused each in words (${engine})`, async () => {
    test.setTimeout(300_000);
    const { app } = await launchApp({
      ...NETWORK_ENV,
      DRASHTI_TEST_FAKE_DEVICES: '1',
      DRASHTI_TEST_WINDOW_STANDIN: '1',
    });
    const win = await operatorPage(app);
    await operatorReady(win);
    await openMeeting(app);
    const { base } = await networkOn(win);
    const inputs = () => inputsNow(win);
    const browser = await (engine === 'webkit' ? webkit : chromium).launch();
    try {
      for (const [index, size] of SIZES.entries()) {
        const { context, page: p } = await phoneAt(browser, win, base, size);
        try {
          const asks = { win, page: p };
          // The phone's Video inputs and windows sheet, as it asked: refused in words, nothing changed.
          await expectPhoneRefuses(asks, 'GET', '/api/v1/video-inputs', undefined, 'computer');
          await expectPhoneRefuses(
            asks,
            'POST',
            '/api/v1/video-inputs',
            { name: 'Placeholder input', device: FAKE_CAMERA, fit: 'fit' },
            'computer',
            inputs,
          );
          await expectPhoneRefuses(asks, 'GET', '/api/v1/windows', undefined, 'computer');
          if (index === 0) {
            // In the window (moved from the phone): named from the cameras the computer lists, the fake one.
            const added = await win.evaluate(
              (device) =>
                (globalThis as PageGlobals).drashti.videoInputs.add({
                  name: 'Placeholder input',
                  device,
                  fit: 'fit',
                }),
              FAKE_CAMERA,
            );
            expect(added.ok).toBe(true);
            await expect
              .poll(inputs)
              .toEqual([
                expect.objectContaining({ name: 'Placeholder input', device: FAKE_CAMERA, fit: 'fit' }),
              ]);
            const id = (await inputs())[0]?.id ?? '';
            // Put up as Media's click does (the phone's refused), and cleared.
            await expectPhoneRefuses(asks, 'POST', `/api/v1/video-inputs/${id}/show`, {}, 'computer');
            await dispatch(win, { type: 'showInput', inputId: id });
            await expect.poll(async () => (await backgroundNow(win))?.kind).toBe('input');
            await expectPhoneRefuses(asks, 'POST', '/api/v1/clear/background', {}, 'computer');
            await dispatch(win, { type: 'clearLayer', layer: 'background' });
            await expect.poll(() => backgroundNow(win)).toBeNull();
            // Changed: Media has the new name (the phone's change refused).
            await expectPhoneRefuses(
              asks,
              'POST',
              `/api/v1/video-inputs/${id}/change`,
              { name: 'Placeholder stage camera' },
              'computer',
              inputs,
            );
            const changed = await win.evaluate(
              (id) =>
                (globalThis as PageGlobals).drashti.videoInputs.update(id, {
                  name: 'Placeholder stage camera',
                }),
              id,
            );
            expect(changed.ok).toBe(true);
            await expect
              .poll(async () => (await inputs()).map((i) => i.name))
              .toEqual(['Placeholder stage camera']);
          }
          // Show a Window…'s list, by name: the placeholder meeting, put up and cleared in the window (the phone's
          // refused).
          const listed = await win.evaluate(() => (globalThis as PageGlobals).drashti.liveWindow.list());
          const meeting = listed.ok ? listed.windows.find((w) => w.name === MEETING) : undefined;
          expect(meeting, 'the placeholder meeting is listed').toBeDefined();
          await expectPhoneRefuses(
            asks,
            'POST',
            '/api/v1/windows/show',
            { id: meeting?.id ?? '' },
            'computer',
          );
          const shown = await win.evaluate(
            (id) => (globalThis as PageGlobals).drashti.liveWindow.show(id),
            meeting?.id ?? '',
          );
          expect(shown.ok).toBe(true);
          await expect.poll(async () => (await backgroundNow(win))?.kind).toBe('window');
          await expectPhoneRefuses(asks, 'POST', '/api/v1/clear/background', {}, 'computer');
          await dispatch(win, { type: 'clearLayer', layer: 'background' });
          await expect.poll(() => backgroundNow(win)).toBeNull();
          if (index === SIZES.length - 1) {
            // Deleted from Media in the window (the phone's Delete refused).
            const id = (await inputs())[0]?.id ?? '';
            await expectPhoneRefuses(
              asks,
              'POST',
              `/api/v1/video-inputs/${id}/remove`,
              {},
              'computer',
              inputs,
            );
            expect(await inputs()).toHaveLength(1);
            const removed = await win.evaluate(
              (id) => (globalThis as PageGlobals).drashti.videoInputs.remove(id),
              id,
            );
            expect(removed.ok).toBe(true);
            await expect.poll(inputs).toEqual([]);
          }
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
    await app.close();
  });

test('Audience and Stage from the window’s top bar: off asks its question while its screens show something, on puts them back where they were; a phone is refused each turn in words, and its live picture says what is off', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({
    ...NETWORK_ENV,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '2',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Placeholder Hall', 1);
  await expect.poll(() => openOutputs(app)).toBe(1);
  // Something on the hall's screens: turning Audience off asks first, in the window.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const r = await d.engine.dispatch({ type: 'setBlackout', on: true });
    if (!r.ok) throw new Error(r.message);
  });
  const { base } = await networkOn(win);
  const phone = await device('webkit');
  const p = phone.page;
  try {
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const asks = { win, page: p };
    const switches = () => switchesNow(win);
    // The phone's Audience off: refused in words, nothing asked or changed (its More before alpha.23).
    await expectPhoneRefuses(asks, 'POST', '/api/v1/switches/audience', { on: false }, 'computer', switches);
    await expectPhoneRefuses(
      asks,
      'POST',
      '/api/v1/switches/audience',
      { on: false, confirmed: true },
      'computer',
      switches,
    );
    expect(openOutputs(app)).toBe(1);
    // The window's top bar (moved from the phone): it asks first; Cancel changes nothing.
    const audience = win.getByTestId('switch-audience');
    const ask = win.getByTestId('screen-switch-ask');
    await audience.click();
    await expect(ask).toContainText('Turn Audience off?');
    await expect(ask).toContainText('The hall’s screens will show this computer’s desktop.');
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toHaveCount(0);
    expect(await switches()).toEqual({ audience: true, stage: true });
    expect(openOutputs(app)).toBe(1);
    // Turn off: the hall's window closes, and the window and the phone's live picture say Audience is off.
    await audience.click();
    await ask.getByRole('button', { name: 'Turn off' }).click();
    await expect.poll(switches).toEqual({ audience: false, stage: true });
    await expect.poll(() => openOutputs(app)).toBe(0);
    await expect(audience).toHaveAttribute('aria-checked', 'false');
    await expect(win.getByTestId('switch-off-audience')).toBeVisible();
    // The phone's live picture (Show) says what the screens switched off show meanwhile (Session 55: the stage screens
    // the audience picture, never the desktop): what is live, a phone still reads.
    const offLine = p.getByTestId('remote-switched-off');
    await expect(offLine).toHaveText(
      'Audience off on Drashti’s computer: the hall’s screens show its desktop until Audience is on again.',
    );
    // Stage has no screens open: off at once from the top bar, asking nothing (the phone's refused).
    await expectPhoneRefuses(asks, 'POST', '/api/v1/switches/stage', { on: false }, 'computer', switches);
    await win.getByTestId('switch-stage').click();
    await expect.poll(switches).toEqual({ audience: false, stage: false });
    await expect(ask).toHaveCount(0);
    await expect(offLine).toHaveText(
      'Audience and Stage off on Drashti’s computer: the hall’s screens show its desktop, and the stage screens the audience picture, until they are on again.',
    );
    // On puts them back where they were, asking nothing (the phone's On refused too).
    await expectPhoneRefuses(asks, 'POST', '/api/v1/switches/audience', { on: true }, 'computer', switches);
    await audience.click();
    await expect.poll(switches).toEqual({ audience: true, stage: false });
    await expect(offLine).toHaveText(
      'Stage off on Drashti’s computer: the stage screens show the audience picture until Stage is on again.',
    );
    await win.getByTestId('switch-stage').click();
    await expect.poll(switches).toEqual({ audience: true, stage: true });
    await expect.poll(() => openOutputs(app)).toBe(1);
    await expect(audience).toHaveAttribute('aria-checked', 'true');
    await expect(offLine).toHaveCount(0);
  } finally {
    await phone.close();
  }
  await app.close();
});

test('in Simple Mode a phone is refused every screens request in words, reading, Keep, Identify and On too; the window refuses just what it did: the screens’ setup changed, a switch turned off', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({
    ...NETWORK_ENV,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '2',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const groupId = await newGroup(win, 'Placeholder Hall');
  const { port, base } = await networkOn(win);
  const token = await pairToken(win, port, 'remote', 'Placeholder script');
  const phone = await device('chromium');
  const p = phone.page;
  try {
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    const screens = () => screensNow(win);
    // Every change and read as the phone's page or a script sends it: refused in words (alpha.23: before, Simple Mode
    // let a phone read the screens, Identify, Keep and turn a switch on), nothing changed.
    const changes: [string, unknown][] = [
      ['/api/v1/screen-groups', { name: 'Placeholder Stage' }],
      [`/api/v1/screen-groups/${groupId}/name`, { name: 'Placeholder renamed' }],
      [`/api/v1/screen-groups/${groupId}/role`, { role: 'stage' }],
      [`/api/v1/screen-groups/${groupId}/display`, { displayId: PRETEND }],
      [`/api/v1/screen-groups/${groupId}/delete`, undefined],
      ['/api/v1/screens/identify', undefined],
      ['/api/v1/screens/keep', undefined],
      ['/api/v1/switches/stage', { on: false, confirmed: true }],
      ['/api/v1/switches/stage', { on: true }],
      ['/api/v1/video-inputs', { name: 'Input 1', device: 'Placeholder camera', fit: 'fit' }],
    ];
    for (const [path, body] of changes) {
      await expectPhoneRefuses({ win, page: p }, 'POST', path, body, 'computer', screens);
      await expectPhoneRefuses({ win, port, token }, 'POST', path, body, 'computer', screens);
    }
    for (const path of ['/api/v1/screens', '/api/v1/video-inputs', '/api/v1/windows'])
      await expectPhoneRefuses({ win, port, token }, 'GET', path, undefined, 'computer');
    expect((await screens()).groups.map((g) => g.name)).toEqual(['Placeholder Hall']);
    expect(await switchesNow(win)).toEqual({ audience: true, stage: true });

    // The window in Simple Mode (what the phone did as its window does): the screens' setup refused in its words, a
    // switch only going on.
    expect(
      await win.evaluate(() => (globalThis as PageGlobals).drashti.screens.createGroup('Placeholder Stage')),
    ).toMatchObject({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect((await screens()).groups.map((g) => g.name)).toEqual(['Placeholder Hall']);
    expect(
      await win.evaluate(() => (globalThis as PageGlobals).drashti.screenSwitches.turn('stage', false)),
    ).toMatchObject({ ok: false, message: ONLY_ON_IN_SIMPLE_MODE });
    expect(await switchesNow(win)).toEqual({ audience: true, stage: true });
  } finally {
    await phone.close();
  }
  await app.close();
});

test('a Stage or Announcements device can do none of it, and a phone never gives the operator’s consent to cover the controls: refused in words, the window assigning the display', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({
    ...NETWORK_ENV,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '2',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const groupId = await newGroup(win, 'Placeholder Hall');
  const { port } = await networkOn(win);
  const remote = await pairToken(win, port, 'remote', 'Placeholder script');
  const stage = await pairToken(win, port, 'stage', 'Placeholder tablet');
  const poster = await pairToken(win, port, 'announcements', 'Placeholder poster');
  const asked: [string, string, unknown][] = [
    ['GET', '/api/v1/screens', undefined],
    ['POST', '/api/v1/screen-groups', { name: 'Placeholder Stage' }],
    ['POST', `/api/v1/screen-groups/${groupId}/display`, { displayId: PRETEND }],
    ['POST', '/api/v1/screens/identify', undefined],
    ['POST', '/api/v1/switches/audience', { on: true }],
  ];
  for (const [method, path, body] of asked)
    for (const token of [stage, poster])
      expect((await apiCall(port, path, { method, token, body })).status, path).toBe(403);
  expect((await screensNow(win)).groups.map((g) => g.name)).toEqual(['Placeholder Hall']);
  // The window's own consent, sent by a phone (before alpha.23, 400), and the plain request (before, 200): refused in
  // words, nothing changes.
  const screens = () => screensNow(win);
  for (const body of [
    { displayId: PRETEND, coverOperator: true },
    { displayId: PRETEND, options: { coverOperator: true } },
    { displayId: PRETEND },
  ])
    await expectPhoneRefuses(
      { win, port, token: remote },
      'POST',
      `/api/v1/screen-groups/${groupId}/display`,
      body,
      'computer',
      screens,
    );
  expect((await screens()).groups.flatMap((g) => g.screens)).toEqual([]);
  // The window may (moved from the phone).
  const used = await win.evaluate(
    ({ groupId, displayId }) => (globalThis as PageGlobals).drashti.screens.assignDisplay(groupId, displayId),
    { groupId, displayId: PRETEND },
  );
  expect(used.ok).toBe(true);
  await expect.poll(async () => (await screens()).groups.flatMap((g) => g.screens).length).toBe(1);
  await app.close();
});

test('an output over the controls is never a phone’s to ask for: refused in words, the computer’s own box never asked; the window’s Use this display asks its consent, and Keep these screens? is the window’s to answer', async () => {
  // The display the controls are on: a real screen (CI's one display), not the quiet test's windowed outputs.
  needsRealScreen();
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...NETWORK_ENV, DRASHTI_TEST_KEEP_SCREENS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const controls = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'));
    return w ? screen.getDisplayMatching(w.getBounds()).id : -1;
  });
  const groupId = await newGroup(win, 'Placeholder Hall');
  const { base } = await networkOn(win);
  const phone = await device('webkit');
  const p = phone.page;
  try {
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const asks = { win, page: p };
    const screens = () => screensNow(win);

    // The phone's Use this display on the controls' display: refused in words; the computer's box is never asked
    // (before alpha.23 it asked, and the phone answered Keep these screens?).
    await answerBoxWith(app, 1);
    await expectPhoneRefuses(
      asks,
      'POST',
      `/api/v1/screen-groups/${groupId}/display`,
      { displayId: controls },
      'computer',
      screens,
    );
    expect(await boxes(app)).toEqual([]);
    expect(await pendingNow(win)).toBeNull();

    // In the window (moved from the phone): asked first, nothing changed until the operator agrees; agreed, the output
    // opens over the controls and Keep these screens? asks in the window, Keep answered there.
    const assign = (cover: boolean) =>
      win.evaluate(
        ({ groupId, displayId, cover }) =>
          (globalThis as PageGlobals).drashti.screens.assignDisplay(
            groupId,
            displayId,
            cover ? { coverOperator: true } : undefined,
          ),
        { groupId, displayId: controls, cover },
      );
    expect(await assign(false)).toMatchObject({ ok: false, confirm: 'covers-operator' });
    expect((await screens()).groups.flatMap((g) => g.screens)).toEqual([]);
    expect((await assign(true)).ok).toBe(true);
    await expect.poll(() => pendingNow(win)).toMatchObject({ coversControls: true });
    await expect(win.getByTestId('keep-screens-covered')).toContainText(
      'An output covers these controls now',
    );
    await expectPhoneRefuses(asks, 'POST', '/api/v1/screens/keep', {}, 'computer', () => pendingNow(win));
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.screens.keep())).ok).toBe(true);
    await expect.poll(() => pendingNow(win)).toBeNull();
    const screenId = (await screens()).groups.flatMap((g) => g.screens)[0]?.id ?? '';

    // Off from the phone: refused; from the window, off asks nothing. On again from the phone: refused, the box never
    // asked; the screen stays off.
    await expectPhoneRefuses(
      asks,
      'POST',
      `/api/v1/screens/${screenId}/change`,
      { enabled: false },
      'computer',
      screens,
    );
    const off = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.screens.updateScreen(id, { enabled: false }),
      screenId,
    );
    expect(off.ok).toBe(true);
    expect(await pendingNow(win)).toBeNull();
    await answerBoxWith(app, 0);
    await expectPhoneRefuses(
      asks,
      'POST',
      `/api/v1/screens/${screenId}/change`,
      { enabled: true },
      'computer',
      screens,
    );
    expect(await boxes(app)).toEqual([]);
    expect((await screens()).groups.flatMap((g) => g.screens)[0]?.enabled).toBe(false);
    expect(await pendingNow(win)).toBeNull();
  } finally {
    await phone.close();
  }
  await app.close();
});

/** The picture-in-picture box as the engine has it now, or null. */
const pipNow = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.pip);

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`the picture-in-picture box set up in the window as Picture in Picture… does: a Media video in it, moved to a corner and made Large, swapped and taken off; a phone at 375 × 812 and 768 × 1024 is refused each in words, in Pro Mode and Simple Mode (${engine})`, async () => {
    test.setTimeout(240_000);
    const { app } = await launchApp({
      ...NETWORK_ENV,
      DRASHTI_WINDOWED_OUTPUTS: '1',
      DRASHTI_EXTRA_DISPLAYS: '1',
    });
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-phone-pip-'));
    const clip = await makeTestVideo(win, join(dir, 'Placeholder boxed clip.webm'), { seconds: 4, hue: 120 });
    const [mediaId = ''] = await importAndGetIds(win, [clip]);
    await setUpScreen(win, 'Main Hall', 0);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      const asks = { win, page: p };
      for (const size of SIZES) {
        await p.setViewportSize(size);
        // The phone's Picture in picture sheet, as it asked: Media's videos, one in the box: refused in words.
        await expectPhoneRefuses(asks, 'GET', '/api/v1/media?kind=video', undefined, 'media');
        await expectPhoneRefuses(
          asks,
          'POST',
          '/api/v1/pip/show',
          { source: { kind: 'media', mediaId } },
          'computer',
        );
        expect(await pipNow(win)).toBeNull();
        // In the window (moved from the phone): a video from Media, by its id, in the box on the screens.
        await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId } });
        await expect
          .poll(async () => (await pipNow(win))?.source)
          .toEqual({ kind: 'media', mediaId, media: 'video' });
        const place = (await pipNow(win))?.place;
        if (!place) throw new Error('The box has no place.');
        // To the top left, then Large: on every screen at once (the engine's place); the phone's refused.
        await expectPhoneRefuses(
          asks,
          'POST',
          '/api/v1/pip/place',
          { place: { ...place, corner: 'top-left' } },
          'computer',
        );
        await dispatch(win, { type: 'placePip', place: { ...place, corner: 'top-left' } });
        await expect.poll(async () => (await pipNow(win))?.place.corner).toBe('top-left');
        await dispatch(win, { type: 'placePip', place: { ...place, corner: 'top-left', size: 'large' } });
        await expect.poll(async () => (await pipNow(win))?.place.size).toBe('large');
        // Swap: the box's picture and the main picture change places (the phone's refused).
        await expectPhoneRefuses(asks, 'POST', '/api/v1/pip/swap', {}, 'computer');
        await dispatch(win, { type: 'swapPip' });
        await expect.poll(async () => (await pipNow(win))?.swapped).toBe(true);
        // Take off: the box goes (the phone's, the box's own clear, refused).
        await expectPhoneRefuses(asks, 'POST', '/api/v1/clear/pip', {}, 'computer');
        await dispatch(win, { type: 'hidePip' });
        await expect.poll(() => pipNow(win)).toBeNull();
      }
      // Simple Mode: the slides in the box refused in Simple Mode's words, nothing up.
      await win
        .getByTestId('app-header')
        .getByRole('button', { name: 'Simple Mode', exact: true })
        .dblclick();
      await expect(win.getByTestId('simple-mode')).toBeVisible();
      await expectPhoneRefuses(asks, 'POST', '/api/v1/pip/show', { source: { kind: 'slides' } }, 'simple');
      expect(await pipNow(win)).toBeNull();
    } finally {
      await phone.close();
      await app.close();
    }
  });

/** The window's playlists (not folders) by name, and a playlist's items by their labels, as the window reads them. */
const playlistNames = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.playlists.tree())
      .filter((p) => !p.isFolder)
      .map((p) => p.name),
  );
const playlistId = (win: Page, name: string) =>
  win.evaluate(
    async (name) =>
      (await (globalThis as PageGlobals).drashti.playlists.tree()).find((p) => p.name === name)?.id ?? null,
    name,
  );
const itemIds = (win: Page, id: string) =>
  win.evaluate(
    async (id) => (await (globalThis as PageGlobals).drashti.playlists.items(id)).map((i) => i.id),
    id,
  );
const presentationNames = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.library.listPresentations()).map((p) => p.name),
  );

/** A playlist change in the window, as Playlists and the library make it: ok. */
const inWindow = async (result: Promise<{ ok: boolean }>) => expect((await result).ok).toBe(true);

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`the library changed in the window: a presentation from words, a playlist made, added to, moved, taken out and put back with Undo, renamed, deleted and put back; a phone at 375 × 812 and 768 × 1024 is refused each in words, in Pro Mode and Simple Mode (${engine})`, async () => {
    test.setTimeout(240_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    const asks = { win, page: p };
    const tree = () => win.evaluate(() => (globalThis as PageGlobals).drashti.playlists.tree());
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      for (const size of SIZES) {
        const words = `Placeholder phone words ${size.layout}`;
        const list = `Placeholder phone list ${size.layout}`;
        await p.setViewportSize(size);
        // A presentation from words, and a playlist made: the phone's refused, the window's made.
        await expectPhoneRefuses(
          asks,
          'POST',
          '/api/v1/presentations/new',
          { name: words, words: 'Placeholder line one\n\nPlaceholder line two' },
          'computer',
          () => presentationNames(win),
        );
        await expectPhoneRefuses(asks, 'POST', '/api/v1/playlists/new', { name: list }, 'computer', tree);
        const presentationId = await win.evaluate(async (name) => {
          const made = await (globalThis as PageGlobals).drashti.library.newFromWords(
            name,
            'Placeholder line one\n\nPlaceholder line two',
          );
          if (!made.ok) throw new Error(made.message);
          return made.id;
        }, words);
        await expect.poll(() => presentationNames(win)).toContain(words);
        await inWindow(
          win.evaluate(
            (name) => (globalThis as PageGlobals).drashti.playlists.create(name, null, false),
            list,
          ),
        );
        await expect.poll(() => playlistNames(win)).toContain(list);
        const id = (await playlistId(win, list)) ?? '';
        // The presentation added twice, then the second moved up: the window has that order (the phone's refused).
        const add = { items: [{ kind: 'presentation', presentationId }] };
        await expectPhoneRefuses(asks, 'POST', `/api/v1/playlists/${id}/add`, add, 'computer', tree);
        for (let i = 0; i < 2; i += 1) {
          await inWindow(
            win.evaluate(
              ({ id, presentationId }) =>
                (globalThis as PageGlobals).drashti.playlists.addItems(id, null, [
                  { kind: 'presentation', presentationId },
                ]),
              { id, presentationId },
            ),
          );
          await expect.poll(async () => (await itemIds(win, id)).length).toBe(i + 1);
        }
        const [first = '', second = ''] = await itemIds(win, id);
        await expectPhoneRefuses(
          asks,
          'POST',
          `/api/v1/playlists/${id}/move`,
          { ids: [second], to: 0 },
          'computer',
          () => itemIds(win, id),
        );
        await inWindow(
          win.evaluate(
            ({ id, second }) => (globalThis as PageGlobals).drashti.playlists.moveItems(id, [second], 0),
            { id, second },
          ),
        );
        await expect.poll(() => itemIds(win, id)).toEqual([second, first]);
        // One taken out, then put back by Undo, where it was (the phone's both refused).
        await expectPhoneRefuses(
          asks,
          'POST',
          '/api/v1/playlist-items/delete',
          { ids: [first] },
          'computer',
          () => itemIds(win, id),
        );
        await inWindow(
          win.evaluate((first) => (globalThis as PageGlobals).drashti.playlists.removeItems([first]), first),
        );
        await expect.poll(() => itemIds(win, id)).toEqual([second]);
        await expectPhoneRefuses(
          asks,
          'POST',
          '/api/v1/playlist-items/restore',
          { ids: [first] },
          'computer',
          () => itemIds(win, id),
        );
        await inWindow(
          win.evaluate((first) => (globalThis as PageGlobals).drashti.playlists.restoreItems([first]), first),
        );
        await expect.poll(() => itemIds(win, id)).toEqual([second, first]);
        // Renamed, then deleted and put back by Undo (the phone's refused).
        await expectPhoneRefuses(
          asks,
          'POST',
          `/api/v1/playlists/${id}/rename`,
          { name: `${list}, renamed` },
          'computer',
          tree,
        );
        await inWindow(
          win.evaluate(({ id, name }) => (globalThis as PageGlobals).drashti.playlists.rename(id, name), {
            id,
            name: `${list}, renamed`,
          }),
        );
        await expect.poll(() => playlistNames(win)).toContain(`${list}, renamed`);
        await expectPhoneRefuses(asks, 'POST', '/api/v1/playlists/delete', { ids: [id] }, 'computer', tree);
        await inWindow(win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.remove([id]), id));
        await expect.poll(() => playlistNames(win)).not.toContain(`${list}, renamed`);
        await expectPhoneRefuses(asks, 'POST', '/api/v1/playlists/restore', { ids: [id] }, 'computer', tree);
        await inWindow(win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.restore([id]), id));
        await expect.poll(() => playlistNames(win)).toContain(`${list}, renamed`);
      }
      // Simple Mode: the playlist tools refused to the phone in words too; Simple Mode's window keeps them.
      await win
        .getByTestId('app-header')
        .getByRole('button', { name: 'Simple Mode', exact: true })
        .dblclick();
      await expect(win.getByTestId('simple-mode')).toBeVisible();
      await expectPhoneRefuses(
        asks,
        'POST',
        '/api/v1/playlists/new',
        { name: 'Placeholder Simple list' },
        'computer',
        tree,
      );
      await expectPhoneRefuses(
        asks,
        'POST',
        '/api/v1/presentations/new',
        { name: 'Placeholder Simple words', words: 'Placeholder line' },
        'computer',
        () => presentationNames(win),
      );
      await inWindow(
        win.evaluate(() =>
          (globalThis as PageGlobals).drashti.playlists.create('Placeholder Simple list', null, false),
        ),
      );
      await expect.poll(() => playlistNames(win)).toContain('Placeholder Simple list');
      const simpleList = await playlistId(win, 'Placeholder Simple list');
      if (simpleList === null) throw new Error('The window did not create its playlist.');
      await inWindow(
        win.evaluate(
          (id) => (globalThis as PageGlobals).drashti.playlists.rename(id, 'Placeholder Simple renamed'),
          simpleList,
        ),
      );
      await expect.poll(() => playlistNames(win)).toContain('Placeholder Simple renamed');
      await inWindow(
        win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.remove([id]), simpleList),
      );
      await expect.poll(() => playlistNames(win)).not.toContain('Placeholder Simple renamed');
      await inWindow(
        win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.restore([id]), simpleList),
      );
      await expect.poll(() => playlistNames(win)).toContain('Placeholder Simple renamed');
    } finally {
      await phone.close();
      await app.close();
    }
  });

test('an Audio track renamed in the window through the existing file Rename; a Pro Mode phone is refused the Audio requests in words', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-pro-phone-audio-'));
  const { app } = await launchApp(NETWORK_ENV);
  const phone = await device('chromium');
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const [mediaId = ''] = await importAndGetIds(win, [
      makeTestTone(join(dir, 'Placeholder rename tone.wav'), { seconds: 2, hz: 300 }),
    ]);
    expect(mediaId).not.toBe('');
    const { base } = await networkOn(win);
    const p = phone.page;
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const asks = { win, page: p };
    const music = () => win.evaluate(() => (globalThis as PageGlobals).drashti.music.view());
    // The phone's Audio (its More before alpha.23): an audio playlist made, the tone added, renamed: refused in words.
    await expectPhoneRefuses(asks, 'GET', '/api/v1/music', undefined, 'media');
    await expectPhoneRefuses(asks, 'GET', '/api/v1/music/audio', undefined, 'media');
    await expectPhoneRefuses(
      asks,
      'POST',
      '/api/v1/music/new',
      { name: 'Placeholder phone tunes' },
      'media',
      music,
    );
    // In the window (moved from the phone): made, the tone added, and the track renamed by the file's own Rename.
    const made = await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.music.create('Placeholder phone tunes'),
    );
    if (!made.ok) throw new Error(made.message);
    const playlistId = made.id ?? made.view.playlists[0]?.id ?? '';
    await expectPhoneRefuses(
      asks,
      'POST',
      `/api/v1/music/${playlistId}/tracks/add`,
      { mediaIds: [mediaId] },
      'media',
      music,
    );
    const added = await win.evaluate(
      ({ playlistId, mediaId }) =>
        (globalThis as PageGlobals).drashti.music.addTracks(playlistId, [mediaId], null),
      { playlistId, mediaId },
    );
    expect(added.ok).toBe(true);
    await expectPhoneRefuses(
      asks,
      'POST',
      `/api/v1/media/${mediaId}/rename`,
      { name: 'Placeholder renamed tone' },
      'media',
      music,
    );
    const renamed = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.media.rename(id, 'Placeholder renamed tone'),
      mediaId,
    );
    expect(renamed.ok).toBe(true);
    await expect
      .poll(async () => (await music()).playlists[0]?.tracks[0]?.name)
      .toBe('Placeholder renamed tone');
  } finally {
    await phone.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a folder with its playlist deleted in the window and put back, and a running Repeat Slides playlist; a Pro Mode phone is refused deleting either, putting them back and starting it going round, in words', async () => {
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const folderName = 'Placeholder phone folder';
  const repeatName = 'Placeholder repeating slides';
  const { folderId, repeatId } = await win.evaluate(
    async ({ folderName, repeatName }) => {
      const d = (globalThis as PageGlobals).drashti;
      const folder = await d.playlists.create(folderName, null, true);
      if (!folder.ok || !folder.ids[0]) throw new Error('The placeholder folder could not be made.');
      const folderId = folder.ids[0];
      const repeat = await d.playlists.createRepeat(folderId);
      if (!repeat.ok || !repeat.ids[0]) throw new Error('The placeholder playlist could not be made.');
      const repeatId = repeat.ids[0];
      const renamed = await d.playlists.rename(repeatId, repeatName);
      if (!renamed.ok) throw new Error(renamed.message);
      const presentation = await d.library.newFromWords(
        'Placeholder phone slides',
        'Placeholder slide one\n\nPlaceholder slide two',
      );
      if (!presentation.ok) throw new Error(presentation.message);
      const added = await d.playlists.addItems(repeatId, null, [
        { kind: 'presentation', presentationId: presentation.id },
      ]);
      if (!added.ok) throw new Error(added.message);
      return { folderId, repeatId };
    },
    { folderName, repeatName },
  );
  const { base } = await networkOn(win);
  const phone = await device('chromium');
  const p = phone.page;
  const tree = () => win.evaluate(() => (globalThis as PageGlobals).drashti.playlists.tree());
  const running = () =>
    win.evaluate(
      async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.repeat?.playlistId,
    );
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const asks = { win, page: p };
    // The folder deleted from the phone: refused; in the window (moved from the phone) its playlist goes with it, and
    // Undo puts both back.
    await expectPhoneRefuses(asks, 'POST', '/api/v1/playlists/delete', { ids: [folderId] }, 'computer', tree);
    await inWindow(
      win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.remove([id]), folderId),
    );
    await expect.poll(() => playlistId(win, folderName)).toBeNull();
    await expect.poll(() => playlistId(win, repeatName)).toBeNull();
    await expectPhoneRefuses(
      asks,
      'POST',
      '/api/v1/playlists/restore',
      { ids: [folderId] },
      'computer',
      tree,
    );
    await inWindow(
      win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.restore([id]), folderId),
    );
    await expect.poll(() => playlistId(win, folderName)).toBe(folderId);
    await expect.poll(() => playlistId(win, repeatName)).toBe(repeatId);

    // Going round: the phone's start refused (not a PowerPoint or a PDF), the window's own (moved from the phone);
    // the phone's delete of it refused too, so it keeps going round.
    await expectPhoneRefuses(asks, 'POST', `/api/v1/repeat/${repeatId}/start`, {}, 'notDeck');
    expect(await running()).toBeUndefined();
    const started = await win.evaluate(
      (playlistId) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'startRepeat', playlistId }),
      repeatId,
    );
    expect(started.ok).toBe(true);
    await expect.poll(running).toBe(repeatId);
    await expectPhoneRefuses(asks, 'POST', '/api/v1/playlists/delete', { ids: [repeatId] }, 'computer', tree);
    expect(await playlistId(win, repeatName)).toBe(repeatId);
    expect(await running()).toBe(repeatId);
  } finally {
    await phone.close();
    await app.close();
  }
});

/** MIDI's settings as the window reads them. */
const midiNow = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.midi.get());

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`MIDI set up in the window as MIDI… does: a mapping forgotten, None chosen; a phone at 375 × 812 and 768 × 1024 is refused reading it, Learn, forgetting and choosing a device, in words, in Pro Mode and Simple Mode (${engine})`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    // A device and a mapping set up in the window (a made-up device: none is plugged into a test computer).
    const kept = await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.midi.set({
        deviceName: 'Placeholder pad',
        mappings: [
          { input: { type: 'note', channel: 0, number: 36 }, action: { kind: 'next' } },
          { input: { type: 'note', channel: 0, number: 38 }, action: { kind: 'back' } },
        ],
      }),
    );
    expect(kept.ok).toBe(true);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    const asks = { win, page: p };
    const midi = () => midiNow(win);
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      for (const size of SIZES) {
        await p.setViewportSize(size);
        // The phone's MIDI sheet, as it asked: its device and mappings read, Learn, a mapping forgotten: refused in
        // words, MIDI as it was.
        await expectPhoneRefuses(asks, 'GET', '/api/v1/midi', undefined, 'computer');
        await expectPhoneRefuses(
          asks,
          'POST',
          '/api/v1/midi/learn',
          { action: { kind: 'blackout' } },
          'computer',
          midi,
        );
        await expectPhoneRefuses(asks, 'POST', '/api/v1/midi/forget', { index: 1 }, 'computer', midi);
        expect((await midi()).deviceName).toBe('Placeholder pad');
      }
      // In the window (moved from the phone): Back's mapping forgotten.
      const forgot = await win.evaluate(async () => {
        const d = (globalThis as PageGlobals).drashti;
        const now = await d.midi.get();
        return d.midi.set({ deviceName: now.deviceName, mappings: now.mappings.slice(0, 1) });
      });
      expect(forgot.ok).toBe(true);
      await expect.poll(async () => (await midi()).mappings.map((m) => m.action.kind)).toEqual(['next']);
      // Simple Mode: forgetting refused to the phone in words, nothing changed.
      await win
        .getByTestId('app-header')
        .getByRole('button', { name: 'Simple Mode', exact: true })
        .dblclick();
      await expect(win.getByTestId('simple-mode')).toBeVisible();
      await expectPhoneRefuses(asks, 'POST', '/api/v1/midi/forget', { index: 0 }, 'computer', midi);
      expect((await midi()).mappings).toHaveLength(1);
      // Pro Mode again: None chosen, the phone refused, the window choosing it (moved from the phone).
      expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'))).toMatchObject({
        ok: true,
      });
      await expect(win.getByTestId('simple-mode')).toHaveCount(0);
      await expectPhoneRefuses(asks, 'POST', '/api/v1/midi/device', { deviceName: null }, 'computer', midi);
      const none = await win.evaluate(async () => {
        const d = (globalThis as PageGlobals).drashti;
        const now = await d.midi.get();
        return d.midi.set({ deviceName: null, mappings: now.mappings });
      });
      expect(none.ok).toBe(true);
      await expect.poll(async () => (await midi()).deviceName).toBeNull();
    } finally {
      await phone.close();
      await app.close();
    }
  });

/** The announcements in the ticker on the screens now, by id. */
const inTicker = (win: Page) =>
  win.evaluate(async () =>
    ((await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.ticker?.items ?? []).map(
      (i) => i.id,
    ),
  );

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`the announcements’ queue decided in the window as Announcements does: one put in the ticker and taken off, one rejected; a phone at 375 × 812 and 768 × 1024 is refused each in words, in Pro Mode and Simple Mode (${engine})`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const { port, base } = await networkOn(win);
    const poster = await pairToken(win, port, 'announcements', 'Placeholder poster');
    const send = async (text: string) => {
      const sent = await apiCall(port, '/api/v1/announcements', {
        method: 'POST',
        token: poster,
        body: { text, from: 'Placeholder volunteer', minutes: 10 },
      });
      expect(sent.status).toBe(202);
      return (sent.json['announcement'] as { id: string }).id;
    };
    const queue = () => win.evaluate(() => (globalThis as PageGlobals).drashti.announcements.list());
    const waitingIds = async () => (await queue()).waiting.map((a) => a.id);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    const asks = { win, page: p };
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      for (const size of SIZES) {
        const first = await send(`Placeholder car notice ${size.layout}`);
        const second = await send(`Placeholder lost keys ${size.layout}`);
        await p.setViewportSize(size);
        await expect.poll(waitingIds).toEqual(expect.arrayContaining([first, second]));
        // The phone's queue, read and decided: refused in words, the queue as it was.
        await expectPhoneRefuses(asks, 'GET', '/api/v1/announcement-queue', undefined, 'computer');
        await expectPhoneRefuses(
          asks,
          'POST',
          `/api/v1/announcement-queue/${first}/approve`,
          { as: 'ticker' },
          'computer',
          queue,
        );
        // In the ticker from the window (moved from the phone): on the hall's screens; then taken off.
        const approved = await win.evaluate(
          (id) => (globalThis as PageGlobals).drashti.announcements.approve({ id, as: 'ticker' }),
          first,
        );
        expect(approved.ok).toBe(true);
        await expect.poll(() => inTicker(win)).toContain(first);
        await expectPhoneRefuses(
          asks,
          'POST',
          `/api/v1/announcement-queue/${first}/take-off`,
          {},
          'computer',
        );
        expect(await inTicker(win)).toContain(first);
        const off = await win.evaluate(
          (id) => (globalThis as PageGlobals).drashti.announcements.takeOff({ id }),
          first,
        );
        expect(off.ok).toBe(true);
        await expect.poll(() => inTicker(win)).not.toContain(first);
        // Rejected in the window (the phone's refused): gone from the queue.
        await expectPhoneRefuses(
          asks,
          'POST',
          `/api/v1/announcement-queue/${second}/reject`,
          {},
          'computer',
          queue,
        );
        const rejected = await win.evaluate(
          (id) => (globalThis as PageGlobals).drashti.announcements.reject({ id }),
          second,
        );
        expect(rejected.ok).toBe(true);
        await expect.poll(waitingIds).not.toContain(second);
      }
      // Simple Mode: approving refused to the phone in words, nothing up.
      const third = await send('Placeholder refused notice');
      await win
        .getByTestId('app-header')
        .getByRole('button', { name: 'Simple Mode', exact: true })
        .dblclick();
      await expect(win.getByTestId('simple-mode')).toBeVisible();
      await expectPhoneRefuses(
        asks,
        'POST',
        `/api/v1/announcement-queue/${third}/approve`,
        { as: 'ticker' },
        'computer',
        queue,
      );
      expect(await inTicker(win)).not.toContain(third);
    } finally {
      await phone.close();
      await app.close();
    }
  });
