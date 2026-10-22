import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import {
  killApp,
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  type PageGlobals,
  relaunchApp,
  type SavedLive,
  savedLive,
  setUpScreen,
} from './helpers';
import { engineState } from './placeholder-slides';

/*
 * A video input in the picture-in-picture box after an unexpected stop (Session 51, B1): checked as the
 * background's input is (tests/e2e/video-input.spec.ts). Chromium's fake camera (DRASHTI_TEST_FAKE_DEVICES: a
 * moving test pattern the computer names "fake_device_0", never a real camera) stands in for it, named
 * "Placeholder input". There after the restart, the box comes back with it live and stays; pointed at a camera
 * this computer does not have (as if unplugged while Drashti was down), the first screen to draw it says so, the
 * box comes off, and the recovery notice names it. Quiet: the hall's screen as a window.
 */

const ENV = { DRASHTI_TEST_FAKE_DEVICES: '1', DRASHTI_WINDOWED_OUTPUTS: '1' };
const INPUT = 'Placeholder input';
/** Chromium's fake camera, as the computer names it. */
const DEVICE = 'fake_device_0';
/** A camera no computer running the tests has. */
const UNPLUGGED = 'Placeholder unplugged camera';

/** The box as the engine has it now. */
const pipNow = async (win: Page) => (await engineState(win)).layers.pip;

/** A page's picture of the input in the box (not one in the background's place, once swapped). */
const inBox = (page: Page) => page.locator('[data-testid="pip-box"] [data-pip-picture="input"]');

/** What the box holds, as Drashti saved the show (live-state.json): its kind and its device, or null. */
function savedBox(saved: SavedLive): { kind: unknown; device: unknown } | null {
  const box = saved['pip'];
  if (typeof box !== 'object' || box === null || !('source' in box)) return null;
  const { source } = box;
  if (typeof source !== 'object' || source === null) return null;
  return {
    kind: 'kind' in source ? source.kind : null,
    device: 'device' in source ? source.device : null,
  };
}

/** The hall's output, by its screen (the same screen after each restart). */
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
  await outputReady(found);
  return found;
}

test('a video input in the picture-in-picture box after an unexpected stop: put back while it is there; not there, the box comes off and the notice names it', async () => {
  test.setTimeout(240_000);
  const first = await launchApp(ENV);
  const win = await operatorPage(first.app);
  await operatorReady(win);
  const screenId = await setUpScreen(win, 'Main Hall', 0);
  // Named in Media's Video inputs, then put in the box (Picture in Picture… sends the same command).
  const inputId = await win.evaluate(
    async ({ name, device }) => {
      const made = await (globalThis as PageGlobals).drashti.videoInputs.add({ name, device, fit: 'fit' });
      if (!made.ok) throw new Error(made.message);
      return made.view.inputs.find((i) => i.name === name)?.id ?? '';
    },
    { name: INPUT, device: DEVICE },
  );
  expect(
    await win.evaluate(
      (id) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'showPip',
          source: { kind: 'input', inputId: id },
        }),
      inputId,
    ),
  ).toMatchObject({ ok: true });
  const hall = await outputFor(first.app, screenId);
  await expect(inBox(hall)).toHaveAttribute('data-input-state', 'live', { timeout: 15_000 });
  await savedLive(first.userData, (saved) => savedBox(saved)?.kind === 'input');
  await killApp(first.app);

  // There after the restart: the box comes back with the camera live, and stays once the screens have said so
  // (the notice comes only then).
  const second = await relaunchApp(first.userData, ENV);
  const win2 = await operatorPage(second.app);
  await operatorReady(win2);
  const notice = win2.getByTestId('recovery-notice');
  await expect(notice).toContainText(
    'Drashti stopped unexpectedly and has put back what was live: the picture-in-picture box.',
    { timeout: 30_000 },
  );
  await expect(notice).not.toContainText('was not there');
  expect(await pipNow(win2)).toMatchObject({
    source: { kind: 'input', inputId, name: INPUT, device: DEVICE },
  });
  const hall2 = await outputFor(second.app, screenId);
  await expect(inBox(hall2)).toHaveAttribute('data-input-state', 'live', { timeout: 15_000 });
  expect(await pipNow(win2)).not.toBeNull();

  // Pointed at a camera this computer does not have, as if unplugged while Drashti was down: the box follows Media.
  expect(
    await win2.evaluate(
      ({ id, device }) => (globalThis as PageGlobals).drashti.videoInputs.update(id, { device }),
      { id: inputId, device: UNPLUGGED },
    ),
  ).toMatchObject({ ok: true });
  await savedLive(second.userData, (saved) => savedBox(saved)?.device === UNPLUGGED);
  await killApp(second.app);

  // Not there after the restart: the first screen to draw it says so, the box comes off, and the notice names it
  // instead of saying the box was put back.
  const third = await relaunchApp(first.userData, ENV);
  const win3 = await operatorPage(third.app);
  await operatorReady(win3);
  await expect(win3.getByTestId('recovery-notice')).toContainText(
    `Drashti stopped unexpectedly. The video input “${INPUT}” in the picture-in-picture box was not there after the restart, so the box was not put back.`,
    { timeout: 30_000 },
  );
  await expect.poll(() => pipNow(win3)).toBeNull();
  const hall3 = await outputFor(third.app, screenId);
  await expect(hall3.getByTestId('pip-box')).toHaveCount(0, { timeout: 10_000 });
  // Only the box came off: the input is still in Media's list, to put up again once it is plugged in.
  expect(
    await win3.evaluate(async () =>
      (await (globalThis as PageGlobals).drashti.videoInputs.list()).inputs.map((i) => i.name),
    ),
  ).toEqual([INPUT]);
  await third.app.close();
});
