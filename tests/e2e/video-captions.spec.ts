import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { EngineCommand } from '../../src/shared/engine/commands';
import { NEW_LOWER_THIRD } from '../../src/shared/lower-thirds';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  NO_PLACEHOLDERS,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  setUpScreen,
  type PageGlobals,
} from './helpers';
import { streamPage } from './stream-helpers';
import { makeTestVideo } from './test-media';

const ENV = { ...NO_PLACEHOLDERS, DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
const run = async (win: Page, command: EngineCommand) => {
  const result = await win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
  expect(result.ok).toBe(true);
};
const PLAYING = { layer: 'background' as const };
const SRT =
  '1\n00:00:00,000 --> 00:00:04,000\nFirst placeholder\n\n2\n00:00:04,000 --> 00:00:09,000\nSecond placeholder\n\n3\n00:00:09,000 --> 00:00:15,000\nThird placeholder\n';

async function outputs(win: Page, app: ElectronApplication) {
  await setUpScreen(win, 'Caption hall', 0);
  const stageId = await setUpScreen(win, 'Caption stage', 1);
  await win.evaluate(async (screenId) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) =>
      g.screens.some((screen) => screen.id === screenId),
    );
    const result = await d.screens.setGroupRole(group?.id ?? '', 'stage');
    if (!result.ok) throw new Error(result.message);
  }, stageId);
  await expect.poll(() => outputPages(app).length).toBe(2);
  for (const page of outputPages(app)) await outputReady(page);
  let hall: Page | undefined;
  let stage: Page | undefined;
  for (const page of outputPages(app)) {
    const role = await page.getByTestId('output-root').getAttribute('data-role');
    if (role === 'stage') stage = page;
    else if (role === 'audience') hall = page;
  }
  if (!hall || !stage) throw new Error('Hall and stage outputs were not made');
  return { hall, stage };
}

const videoCaption = (page: Page) => page.locator('[data-testid="captions"][data-source="video"]');
async function chooseCC(win: Page, label: string) {
  await win.getByTestId('video-cc').click();
  await win
    .getByRole('menu', { name: 'Video captions', exact: true })
    .getByRole('menuitemradio', { name: label, exact: true })
    .click();
}

test('stored SRT captions follow the hall and stream video clocks through play, pause, seek, language, trims and looping; stage and live speech step aside', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({
    ...ENV,
    DRASHTI_TEST_SPEECH: 'Live placeholder alpha|Live placeholder beta',
    // Words left out of captions (alpha.24, QA24-CAPCLEAN-1): a test-only placeholder word, never a real one. The
    // files below carry it, and the screens show their cues without it.
    DRASHTI_TEST_CAPTION_CLEAN: 'zqvorn',
  });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-caption-e2e-'));
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const file = await makeTestVideo(win, join(dir, 'Placeholder captions.webm'), {
      seconds: 15,
      width: 320,
      height: 180,
    });
    const en = join(dir, 'Placeholder captions.en.srt');
    const gu = join(dir, 'Placeholder captions.gu.auto.srt');
    writeFileSync(en, SRT.replace('Second placeholder', 'Second zqvorn placeholder'));
    writeFileSync(
      gu,
      SRT.replace('First placeholder', 'નમૂનો zqvorn એક')
        .replace('Second placeholder', 'નમૂનો બે')
        .replace('Third placeholder', 'નમૂનો ત્રણ'),
    );
    const [mediaId = ''] = await importAndGetIds(win, [file]);
    expect(mediaId).not.toBe('');
    rmSync(en);
    rmSync(gu);
    const view = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.videoCaptions.view(id),
      mediaId,
    );
    expect(view.selected).toBeNull();
    expect(view.tracks).toHaveLength(2);
    const { hall, stage } = await outputs(win, app);
    // Keep the Program running without opening the modal Stream drawer over LIVE’s CC controls.
    await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.watchPreview(true));
    const program = await streamPage(app);
    await expect(program.getByTestId('program-root')).toHaveAttribute('data-fonts', 'ready', {
      timeout: 20_000,
    });
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const current = await d.captions.view();
      await d.captions.setSettings({ ...current.settings, audience: true });
      await d.captions.setOn(true);
    });
    await expect(stage.getByTestId('captions')).toContainText('Live placeholder', { timeout: 15_000 });
    await win.evaluate(
      (id) =>
        (globalThis as PageGlobals).drashti.media.setMarkers(id, {
          startMs: 1000,
          endMs: 11000,
          markers: [],
        }),
      mediaId,
    );
    await run(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId, media: 'video', fit: 'fit', loop: true },
    });
    await expect(win.getByTestId('video-cc')).toHaveAttribute('aria-pressed', 'false');
    await expect(hall.locator(`video[data-media-id="${mediaId}"]`)).toHaveCount(1);
    await expect(
      win.getByTestId('time-bars').locator('[data-playing="background"]').getByTestId('time-bar-pause'),
    ).toBeEnabled();
    await run(win, { type: 'pausePlaying', playing: PLAYING });
    await run(win, { type: 'moveTo', playing: PLAYING, toMs: 2500 });
    await chooseCC(win, 'English');
    for (const page of [hall, program]) await expect(videoCaption(page)).toHaveText('First placeholder');
    await expect(stage.getByTestId('captions')).toHaveCount(0);
    for (const page of [hall, program])
      await expect(page.locator('[data-source="live"][data-testid="captions"]')).toHaveCount(0);
    await letTimePass(win, 400, 'paused video captions stay at the held frame');
    for (const page of [hall, program]) await expect(videoCaption(page)).toHaveText('First placeholder');
    await win
      .getByTestId('time-bars')
      .locator('[data-playing="background"]')
      .getByTestId('time-bar-play')
      .click();
    for (const page of [hall, program])
      await expect(videoCaption(page)).toHaveText('Second placeholder', { timeout: 10_000 });
    await run(win, { type: 'pausePlaying', playing: PLAYING });
    await run(win, { type: 'moveTo', playing: PLAYING, toMs: 2500 });
    for (const page of [hall, program]) await expect(videoCaption(page)).toHaveText('First placeholder');
    await chooseCC(win, 'Off');
    for (const page of [hall, program, stage]) await expect(videoCaption(page)).toHaveCount(0);
    await expect(stage.getByTestId('captions')).toContainText('Live placeholder', { timeout: 15_000 });
    // Keyboard opens the same CC menu; automatic languages are named plainly.
    await win.getByTestId('video-cc').focus();
    await win.keyboard.press('Enter');
    await win.getByRole('menuitemradio', { name: 'Gujarati (automatic)', exact: true }).focus();
    await win.keyboard.press('Enter');
    for (const page of [hall, program]) {
      await expect(videoCaption(page)).toHaveText('નમૂનો એક');
      await expect(videoCaption(page)).toHaveAttribute('lang', 'gu');
      await expect(videoCaption(page).locator(':scope > div')).toHaveCSS(
        'font-family',
        /^["']?Noto Sans Gujarati/u,
      );
    }
    await expect(stage.getByTestId('captions')).toHaveCount(0);
    await chooseCC(win, 'English');
    await run(win, {
      type: 'showLowerThird',
      lowerThird: {
        ...NEW_LOWER_THIRD,
        id: 'caption-third',
        lines: ['Placeholder lower third', 'Second placeholder line'],
      },
    });
    await run(win, {
      type: 'showMessage',
      message: { id: 'caption-message', text: 'Placeholder hall message' },
    });
    for (const page of [hall, program]) {
      await expect(page.getByTestId('lower-third-layer')).toHaveAttribute('data-lt-phase', 'still');
      await expect
        .poll(() =>
          page.evaluate(() => {
            const caption = document
              .querySelector('[data-testid="captions"][data-source="video"]')
              ?.getBoundingClientRect();
            const third = document
              .querySelector('[data-testid="lower-third-layer"]')
              ?.getBoundingClientRect();
            const message = document.querySelector('[data-layer="messages"]')?.getBoundingClientRect();
            if (!caption || !third || !message) return false;
            const overlaps = (a: DOMRect, b: DOMRect) =>
              a.top < b.bottom && a.bottom > b.top && a.left < b.right && a.right > b.left;
            return !overlaps(caption, third) && !overlaps(caption, message);
          }),
        )
        .toBe(true);
    }
    await run(win, { type: 'hideLowerThird' });
    await run(win, { type: 'hideMessage', messageId: 'caption-message' });
    await run(win, { type: 'moveTo', playing: PLAYING, toMs: 10800 });
    await run(win, { type: 'resumePlaying', playing: PLAYING });
    for (const page of [hall, program])
      await expect(videoCaption(page)).toHaveText('First placeholder', { timeout: 10_000 });
    // The CC button stays inside CI's small operator window and has no serious axe issues.
    await win.setViewportSize({ width: 1024, height: 645 });
    await expectFits(win.getByTestId('time-bars'), 'video captions beside the time bar');
    await expectNoSeriousA11yIssues(win, 'video captions');
    await run(win, { type: 'setBlackout', on: true });
    for (const page of [hall, program]) await expect(videoCaption(page)).toHaveCount(0);
    await run(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId, media: 'video', fit: 'fit', loop: true },
    });
    await expect(videoCaption(hall)).toHaveText('First placeholder');
    await run(win, { type: 'setWallpaper', on: true });
    for (const page of [hall, program]) await expect(videoCaption(page)).toHaveCount(0);
    await run(win, { type: 'clearAll' });
    for (const page of [hall, program]) await expect(videoCaption(page)).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a damaged caption file leaves its video available; Captions › Add a Caption File keeps a later file in the library', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(ENV);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-caption-add-'));
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const file = await makeTestVideo(win, join(dir, 'Placeholder add captions.webm'), {
      seconds: 6,
      width: 320,
      height: 180,
    });
    writeFileSync(join(dir, 'Placeholder add captions.en.srt'), 'damaged caption placeholder');
    const imported = await win.evaluate(async (path) => {
      const d = (globalThis as PageGlobals).drashti;
      const result = await d.library.importPaths([path]);
      if (!result.ok) throw new Error(result.message);
      return d.library.getImportReport(result.run.id);
    }, file);
    const item = imported?.items.find((row) => row.target?.kind === 'media');
    const mediaId = item?.target?.id ?? '';
    expect(item?.outcome).toBe('imported');
    expect(item?.issues.some((issue) => issue.code === 'video-captions')).toBe(true);
    const later = join(dir, 'Later.hi.vtt');
    writeFileSync(later, 'WEBVTT\n\n00:00.000 --> 00:06.000\nनमूना एक\n');
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
    }, later);
    await openLibrary(win);
    await win.getByTestId('library-tab-media').click();
    const row = win.getByTestId('media-item').filter({ hasText: 'Placeholder add captions' });
    await row.focus();
    await win.keyboard.press('Shift+F10');
    await win.getByRole('menuitem', { name: 'Captions…', exact: true }).click();
    await win.getByRole('menuitem', { name: 'Add a Caption File…', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await win.evaluate((id) => (globalThis as PageGlobals).drashti.videoCaptions.view(id), mediaId))
            .tracks.length,
      )
      .toBe(1);
    rmSync(later);
    await row.click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Captions…', exact: true }).click();
    await win.getByRole('menuitemradio', { name: 'Hindi', exact: true }).click();
    expect(
      (await win.evaluate((id) => (globalThis as PageGlobals).drashti.videoCaptions.view(id), mediaId))
        .selected,
    ).toBe('hi-file');
    await expectNoSeriousA11yIssues(win, 'the caption file menu');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
