import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineCommand } from '../../src/shared/engine/commands';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import {
  holdStill,
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
  setTicked,
  type PageGlobals,
} from './helpers';
import { freePort, rtmpListener, setUpStream, streamPage, testFfmpeg } from './stream-helpers';

/*
 * YouTube as the third screen (Session 26 step 13): Screens opens with three
 * cards, the projector, the stage screen and YouTube (the stream), and the
 * stream's settings are one setting shown in two places, its YouTube card and
 * the Stream panel. The stream goes only to FFmpeg listening on this
 * computer, with Chromium's fake camera and microphone and a made-up key.
 */

const ffmpeg = testFfmpeg();
const FAKE = { DRASHTI_TEST_FAKE_DEVICES: '1' };
const listeners: ChildProcess[] = [];

test.afterEach(() => {
  for (const l of listeners.splice(0)) l.kill('SIGKILL');
});

const status = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
const run = (win: Page, command: EngineCommand) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);

const openScreens = (win: Page) => win.getByRole('button', { name: 'Screens', exact: true }).click();

/** Tick only these languages in a language picker (its rows move as they are ticked: each is found by its language). */
async function onlyLanguages(picker: Locator, keep: string[]): Promise<void> {
  await setTicked(picker.getByTestId('languages-some'), true);
  for (const lang of ['gu', 'hi', 'translit', 'en']) {
    if (keep.includes(lang)) continue;
    const box = picker.locator(`[data-testid="language-row"][data-lang="${lang}"]`).getByRole('checkbox');
    await setTicked(box, false);
  }
}

/**
 * The stream's picture as FFmpeg received it: one tiny frame each half second, each as the colour of its
 * top left corner (away from the words), as [r, g, b].
 */
function receivedCorners(file: string): number[][] {
  const out = spawnSync(
    ffmpeg ?? '',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      file,
      '-vf',
      'fps=2,scale=16:9',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (out.status !== 0) throw new Error(out.stderr.toString());
  const frame = 16 * 9 * 3;
  const corners: number[][] = [];
  for (let at = 0; at + frame <= out.stdout.length; at += frame)
    corners.push([out.stdout[at] ?? 0, out.stdout[at + 1] ?? 0, out.stdout[at + 2] ?? 0]);
  return corners;
}

const isMagenta = ([r = 0, g = 0, b = 0]: number[]) => r > 180 && b > 180 && g < 90;

test('Screens opens with three cards, the projector, the stage screen and YouTube, there from the first start; opening it starts nothing', async () => {
  const { app } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  // The stream's group is there before anyone has turned to the stream.
  const groups = await win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.screens.get()).groups.map((g) => [g.name, g.role]),
  );
  expect(groups).toEqual([['Stream', 'stream']]);

  await openScreens(win);
  const cards = win.getByTestId('screens-cards');
  await expect(cards.locator('[data-testid^="screens-card-"]')).toHaveCount(3);
  await expect(cards.locator('[data-testid^="screens-card-"] h3')).toHaveText([
    'Projector',
    'Stage screen',
    'YouTube (the stream)',
  ]);
  const youtube = cards.getByTestId('screens-card-youtube');
  // What it shows, its layout, camera and sound, its languages and the way to the Stream panel.
  await expect(youtube.getByTestId('youtube-shows')).toContainText('lower third');
  await expect(youtube.getByTestId('youtube-layout-camera')).toHaveAttribute('aria-checked', 'true');
  await expect(youtube.getByTestId('screens-stream-camera')).toBeVisible();
  await expect(youtube.getByTestId('screens-stream-sound')).toBeVisible();
  await expect(youtube.getByTestId('language-picker')).toBeVisible();
  await expect(youtube.getByTestId('youtube-open-stream')).toBeVisible();
  // Its preview is a still of what the stream would show: nothing has started.
  await expect(youtube.getByTestId('youtube-preview')).toHaveAttribute('data-kind', 'still');
  await holdStill(
    async () => {
      const s = await status(win);
      return !s.programOn && s.live.state === 'off' && s.recording.state === 'off';
    },
    1500,
    'opening Screens starts nothing',
  );
  await expectNoSeriousA11yIssues(win, 'Screens with its three cards');
  await expectFits(
    win.getByRole('dialog', { name: 'Screens' }),
    'Screens with its three cards at 1280 x 720',
  );

  // Listing the cameras and sound inputs is asked for: then the stream's page runs, for the lists.
  await youtube.getByTestId('youtube-find-inputs').click();
  await expect.poll(async () => (await status(win)).inputs.cameras.length).toBeGreaterThan(0);
  await expect(youtube.getByTestId('youtube-preview')).toHaveAttribute('data-kind', 'live');
  // The Stream panel is a click away.
  await youtube.getByTestId('youtube-open-stream').click();
  await expect(win.getByTestId('stream-panel')).toBeVisible();
  await app.close();
});

test('the YouTube card and the Stream panel are one setting: the layout and languages changed in either show in the other and on the stream’s picture', async () => {
  test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');
  test.setTimeout(240_000);
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-youtube-'));
  const got = join(dir, 'received.flv');
  listeners.push(rtmpListener(ffmpeg ?? '', port, got));
  const { app } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setUpStream(app, win, port, dir);
  const program = await streamPage(app);
  const root = program.getByTestId('program-root');
  const kirtan = await win.evaluate(
    async () =>
      (await (globalThis as PageGlobals).drashti.library.listPresentations()).find((p) =>
        p.name.startsWith('Sample kirtan'),
      )?.id ?? '',
  );
  await run(win, { type: 'goLive', presentationId: kirtan, slideIndex: 0 });
  // The hall's background is magenta: the stream shows it in Slides only (once the slide, black, is off).
  await run(win, { type: 'setBackground', background: { kind: 'color', color: '#ff00ff' } });
  const panel = win.getByTestId('stream-panel');
  await panel.getByTestId('go-live').click();
  await win.getByTestId('go-live-confirm').getByRole('button', { name: 'Go live' }).click();
  await expect.poll(async () => (await status(win)).live.state, { timeout: 45_000 }).toBe('live');
  await expect(root).toHaveAttribute('data-layout', 'camera');
  await win.getByRole('button', { name: 'Close stream' }).click();

  // In Screens: Slides, and transliteration only.
  await openScreens(win);
  const youtube = win.getByTestId('screens-card-youtube');
  await expect(youtube.getByTestId('youtube-preview')).toHaveAttribute('data-kind', 'live');
  await youtube.getByTestId('youtube-layout-slides').click();
  await onlyLanguages(youtube.getByTestId('language-picker'), ['translit']);
  // On the stream's picture.
  await expect(root).toHaveAttribute('data-layout', 'slides');
  await expect(root).toHaveAttribute('data-languages', 'translit');
  await expect(program.getByTestId('scene')).toContainText('Namūnānī pahelī paṅkti');
  await expect(program.getByTestId('scene')).not.toContainText('નમૂનાની');
  // The slide off: the hall's magenta background goes out.
  await run(win, { type: 'clearLayer', layer: 'slide' });
  await letTimePass(win, 4000, 'the stream sends a few seconds of the hall’s magenta (checked at the end)');
  await win.getByRole('button', { name: 'Close screens' }).click();

  // The Stream panel shows the same; back the other way from there: the camera, and every language.
  await win.getByTestId('open-stream').click();
  await expect(panel.getByTestId('stream-layout-slides')).toHaveAttribute('aria-checked', 'true');
  const languages = panel.getByTestId('stream-languages');
  await expect(languages.getByTestId('languages-some')).toBeChecked();
  await expect(
    languages.getByTestId('language-row').filter({ has: win.getByRole('checkbox', { checked: true }) }),
  ).toHaveCount(1);
  await panel.getByTestId('stream-layout-camera').click();
  await setTicked(languages.getByTestId('languages-all'), true);
  await expect(root).toHaveAttribute('data-layout', 'camera');
  await expect(root).toHaveAttribute('data-languages', 'all');
  await run(win, { type: 'goLive', presentationId: kirtan, slideIndex: 0 });
  await expect(program.getByTestId('lower-third').locator('[data-lang]')).toHaveCount(4);
  await win.getByRole('button', { name: 'Close stream' }).click();
  await openScreens(win);
  await expect(youtube.getByTestId('youtube-layout-camera')).toHaveAttribute('aria-checked', 'true');
  await expect(youtube.getByTestId('languages-all')).toBeChecked();
  await letTimePass(win, 4000, 'the stream sends a few seconds of the camera again (checked at the end)');
  await win.getByRole('button', { name: 'Close screens' }).click();

  await win.getByTestId('open-stream').click();
  await panel.getByTestId('end-stream').click();
  await win.getByTestId('end-confirm').getByRole('button', { name: 'End the stream' }).click();
  await expect.poll(async () => (await status(win)).live.state).toBe('off');
  await app.close();

  // What FFmpeg received: the camera, then the slides (magenta) from Screens' change, then the camera
  // again from the Stream panel's.
  await expect.poll(() => existsSync(got) && statSync(got).size > 0).toBe(true);
  const corners = receivedCorners(got);
  const magenta = corners.map(isMagenta);
  const first = magenta.indexOf(true);
  const last = magenta.lastIndexOf(true);
  expect(first, `corners ${JSON.stringify(corners)}`).toBeGreaterThan(0);
  expect(magenta.slice(first, last + 1).filter((m) => m).length).toBeGreaterThanOrEqual(4);
  expect(magenta.slice(last + 1).filter((m) => !m).length).toBeGreaterThanOrEqual(4);
});
