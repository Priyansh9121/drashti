import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { EngineCommand } from '../../src/shared/engine/commands';
import type { StreamProfileInput } from '../../src/shared/stream';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';

/*
 * The stream's Program, with Chromium's fake camera and microphone (tests
 * only): no real camera picture or sound is ever used. Placeholder words
 * from the seeded sample kirtan only.
 */

const FAKE = { DRASHTI_TEST_FAKE_DEVICES: '1' };

async function streamPage(app: ElectronApplication): Promise<Page> {
  const isStream = (p: Page) => p.url().includes('stream.html');
  return app.windows().find(isStream) ?? app.waitForEvent('window', { predicate: isStream });
}

const run = (win: Page, command: EngineCommand) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);

const status = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());

/** Choose the first fake camera and sound input for the profile in use. */
async function useFakeInputs(win: Page): Promise<void> {
  await expect
    .poll(async () => {
      const s = await status(win);
      return s.inputs.cameras.length > 0 && s.inputs.microphones.length > 0;
    })
    .toBe(true);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const s = await d.stream.status();
    const { profiles, activeId } = await d.stream.profiles();
    const p = profiles.find((x) => x.id === activeId);
    if (!p) throw new Error('no profile');
    const input: StreamProfileInput = {
      name: p.name,
      url: p.url,
      preset: p.preset,
      camera: s.inputs.cameras[0] ?? null,
      sound: s.inputs.microphones[0] ?? null,
      soundDelayMs: 0,
      mixOwnSound: false,
    };
    const saved = await d.stream.saveProfile(p.id, input);
    if (!saved.ok) throw new Error(saved.message);
  });
}

test('the Program: the camera with the words in the stream’s languages, or the slides as the hall has them', async () => {
  const { app } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.getByTestId('open-stream').click();
  const program = await streamPage(app);
  const root = program.getByTestId('program-root');
  await useFakeInputs(win);
  await expect(root).toHaveAttribute('data-camera', 'on');
  await expect(root).toHaveAttribute('data-sound', 'on');
  await expect(win.getByTestId('stream-camera-state')).toHaveText('On');

  // The stream group shows transliteration, then English.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.role === 'stream');
    if (!group) throw new Error('no stream group');
    await d.screens.setGroupLanguages(group.id, ['translit', 'en']);
  });
  await expect(root).toHaveAttribute('data-languages', 'translit,en');

  const kirtan = await win.evaluate(
    async () =>
      (await (globalThis as PageGlobals).drashti.library.listPresentations()).find((p) =>
        p.name.startsWith('Sample kirtan'),
      )?.id ?? '',
  );
  await run(win, { type: 'goLive', presentationId: kirtan, slideIndex: 0 });
  const third = program.getByTestId('lower-third');
  await expect(third).toBeVisible();
  await expect(third.locator('[data-lang]')).toHaveText([
    'Namūnānī pahelī paṅkti',
    'Placeholder verse, first line',
  ]);
  await expect(program.getByTestId('program-picture')).toHaveAttribute('data-kind', 'camera');
  await expect(program.getByTestId('program-camera')).toHaveAttribute('data-on', 'yes');
  // The operator sees it: the preview's frames and the sound level (the fake microphone beeps).
  await expect(win.getByTestId('stream-preview')).toBeVisible();
  await expect
    .poll(async () => Number(await win.getByTestId('stream-level').getAttribute('data-db')))
    .toBeGreaterThan(-60);

  // Black-out and the logo are for the hall: the camera stays, the words go.
  await run(win, { type: 'setBlackout', on: true });
  await expect(third).toHaveCount(0);
  await expect(program.getByTestId('program-camera')).toHaveAttribute('data-on', 'yes');
  await expect(program.locator('[data-layer="blackout"]')).toHaveCount(0);
  await run(win, { type: 'setBlackout', on: false });
  await expect(third).toBeVisible();
  await run(win, {
    type: 'showLogo',
    prop: {
      id: 'test-logo',
      name: 'Placeholder logo',
      elements: [],
    },
  });
  await expect(third).toHaveCount(0);
  await run(win, { type: 'hideLogo' });
  await expect(third).toBeVisible();
  // Clear slide: the camera alone.
  await run(win, { type: 'clearLayer', layer: 'slide' });
  await expect(third).toHaveCount(0);
  await run(win, { type: 'goLive', presentationId: kirtan, slideIndex: 0 });
  await expect(third).toBeVisible();

  // Slides: the hall's picture in the stream's languages; black-out goes black, as in the hall.
  await win.getByTestId('stream-layout-slides').click();
  await expect(root).toHaveAttribute('data-layout', 'slides');
  await expect(program.getByTestId('program-picture')).toHaveAttribute('data-kind', 'scene');
  await expect(program.getByTestId('scene')).toContainText('Namūnānī pahelī paṅkti');
  await expect(program.getByTestId('scene')).not.toContainText('નમૂનાની');
  await run(win, { type: 'setBlackout', on: true });
  await expect(program.locator('[data-layer="blackout"]')).toHaveCount(1);
  await run(win, { type: 'setBlackout', on: false });
  // And back to the camera, while it all runs.
  await win.getByTestId('stream-layout-camera').click();
  await expect(third).toBeVisible();

  // Closing the panel lets the Program go when nothing else needs it.
  await win.getByRole('button', { name: 'Close stream' }).click();
  await expect.poll(async () => (await status(win)).programOn).toBe(false);
  await app.close();
});

test('only the stream’s page may use the camera and microphone; the operator window still sees no devices', async () => {
  const { app } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.getByTestId('open-stream').click();
  const program = await streamPage(app);
  await useFakeInputs(win);
  await expect(program.getByTestId('program-root')).toHaveAttribute('data-camera', 'on');

  const ask = (page: Page) =>
    page.evaluate(async () => {
      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === 'videoinput' || d.kind === 'audioinput')
        .map((d) => d.label);
      const asked = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(
        (stream) => {
          for (const t of stream.getTracks()) t.stop();
          return 'granted';
        },
        (error: unknown) => (error instanceof DOMException ? error.name : 'refused'),
      );
      const shared = await navigator.mediaDevices.getDisplayMedia({ video: true }).then(
        (stream) => {
          for (const t of stream.getTracks()) t.stop();
          return 'granted';
        },
        () => 'refused',
      );
      return { labels: devices.filter((l) => l !== ''), asked, shared };
    });
  // The operator window: no device names, no camera or microphone, no capture.
  const operator = await ask(win);
  expect(operator.labels).toEqual([]);
  expect(operator.asked).not.toBe('granted');
  expect(operator.shared).toBe('refused');
  // The stream's page: it sees and opens them.
  const stream = await ask(program);
  expect(stream.labels.length).toBeGreaterThan(0);
  expect(stream.asked).toBe('granted');
  await app.close();
});

test('the Stream panel, its settings and the stream group in Screens: accessible, and they fit at 1280 x 720', async () => {
  const { app } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await win.getByTestId('open-stream').click();
  await streamPage(app);
  await useFakeInputs(win);
  await expect(win.getByTestId('stream-preview')).toBeVisible();
  await expect(win.getByTestId('stream-camera-state')).toHaveText('On');
  await expectNoSeriousA11yIssues(win, 'the Stream panel');
  await expectFits(win.getByTestId('stream-panel'), 'the Stream panel at 1280 x 720');

  await win.getByTestId('open-stream-settings').click();
  const settings = win.getByTestId('stream-settings');
  await expect(settings.getByTestId('stream-camera')).toBeVisible();
  await expect(settings.getByTestId('stream-key-input')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the stream settings');
  await expectFits(settings, 'the stream settings at 1280 x 720');
  await settings.getByRole('button', { name: 'Close stream settings' }).click();
  await win.getByRole('button', { name: 'Close stream' }).click();

  // Screens: the stream group, off screen, with its languages, camera and sound input.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const card = win.getByTestId('stream-group');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('screens-stream-camera')).not.toHaveValue('');
  // No display can be given to it.
  await expect(win.locator('[data-testid="display-row"] option', { hasText: 'Stream' })).toHaveCount(0);
  await expectNoSeriousA11yIssues(win, 'Screens with the stream group');
  await app.close();
});

test('quitting with the Stream panel’s preview open leaves no uncaught error in the log', async () => {
  // As Drashti quits, the operator window's page goes before the window; the preview's watcher then
  // told that page the stream had changed, and Electron threw "Object has been destroyed" (Session 20).
  const { app, userData } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.getByTestId('open-stream').click();
  await streamPage(app);
  await expect(win.getByTestId('stream-preview')).toBeVisible();
  await app.close();
  const log = readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8');
  expect(log).toContain("The stream's page opens");
  expect(log).not.toContain('Uncaught exception');
  expect(log).not.toContain('Object has been destroyed');
});
