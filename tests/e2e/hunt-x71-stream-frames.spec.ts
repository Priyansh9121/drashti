import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeDeckFixture } from '../../src/main/import/deck/native-deck-fixture';
import type { EngineCommand } from '../../src/shared/engine/commands';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { drawPicture, goLive, makeSlides, plain } from './placeholder-slides';
import { streamPage, testFfmpeg } from './stream-helpers';
import { makeClip, shown, OUT } from './hall-looks';

// Generated media, recording only: no network destination is opened by this probe.
const dispatch = (p: Page, c: EngineCommand) =>
  p.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), c);
const frames = (p: Page) =>
  p.evaluate(
    () =>
      (globalThis as unknown as { drashtiTestEncoderFrames?: { t: number; mean: number }[] })
        .drashtiTestEncoderFrames ?? [],
  );

test('H6 G-E1: encoder frames stay lit through owner-shaped video, dissolve, deck click and PiP', async () => {
  test.setTimeout(180_000);
  const ffmpeg = testFfmpeg();
  if (!ffmpeg) throw new Error('The bundled FFmpeg is required');
  const dir = mkdtempSync(join(tmpdir(), 'drashti-x71-frames-'));
  const clip = join(dir, 'Placeholder owner shape.mp4');
  makeClip(clip, 'owner', 16);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_TEST_STREAM_PROBE: '1',
    DRASHTI_TEST_FAKE_DEVICES: '1',
    DRASHTI_TEST_DECK_CONVERTER: '1',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const deckFile = join(dir, 'Placeholder clicks.pptx');
    writeFileSync(deckFile, nativeDeckFixture());
    const picture = await drawPicture(win, join(dir, 'Placeholder green.png'), plain('32,160,64'));
    const [video = '', green = '', deck = ''] = await importAndGetIds(win, [clip, picture, deckFile]);
    expect(video).not.toBe('');
    expect(deck).not.toBe('');
    await setUpScreen(win);
    const hall = await outputPage(app);
    await outputReady(hall);
    await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: video, media: 'video', fit: 'fill', loop: true },
    });
    await expect.poll(() => shown(hall, OUT)).toBe('VIDEO');
    await win.getByTestId('open-stream').click();
    const program = await streamPage(app);
    await win.getByTestId('stream-layout-slides').click();
    await expect(program.getByTestId('program-root')).toHaveAttribute('data-layout', 'slides');
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [dir] });
    }, dir);
    const started = await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const folder = await d.stream.pickFolder();
      return folder.ok ? d.stream.startRecording() : folder;
    });
    expect(started.ok).toBe(true);
    await expect.poll(async () => (await frames(program)).length).toBeGreaterThan(0);
    const first = (await frames(program))[0]?.t ?? 0;
    const phaseFrames: Record<string, number> = {};
    const captured = async (phase: string) => {
      const before = (await frames(program)).length;
      await expect.poll(async () => (await frames(program)).length).toBeGreaterThanOrEqual(before + 2);
      phaseFrames[phase] = (await frames(program)).length;
    };
    await captured('video');
    const slides = await makeSlides(
      win,
      'Placeholder dissolve',
      [
        { shapes: [{ x: 50, y: 50, width: 100, height: 100, fill: '#40c060' }] },
        { shapes: [{ x: 100, y: 50, width: 100, height: 100, fill: '#60c040' }] },
      ],
      { kind: 'dissolve', durationMs: 700 },
    );
    await goLive(win, slides, 0);
    await goLive(win, slides, 1);
    await expect(program.locator('[data-layer="slide"][data-fading="true"]')).toHaveCount(0);
    await captured('dissolve');
    await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId: green } });
    await expect(program.getByTestId('pip-box')).toBeVisible();
    await captured('pip');
    await goLive(win, deck, 0);
    await dispatch(win, { type: 'next' });
    await expect
      .poll(
        async () =>
          (
            await win.evaluate(
              async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide,
            )
          )?.step,
      )
      .toBe(1);
    await captured('deck-click');
    await expect.poll(async () => (await frames(program)).length).toBeGreaterThan(100);
    const seen = (await frames(program)).filter((f) => f.t >= first);
    console.log(
      `HUNT-x71 G-E1 phases=${JSON.stringify(phaseFrames)} frames=${String(seen.length)} minLight=${String(Math.min(...seen.map((f) => f.mean)))} black=${String(seen.filter((f) => f.mean < 0.02).length)}`,
    );
    expect(
      seen.filter((f) => f.mean < 0.02),
      'the encoder never receives black while the lit show is up',
    ).toEqual([]);
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.stopRecording())).ok).toBe(
      true,
    );
  } finally {
    await app.close();
  }
});

test.afterEach(() => {
  const info = test.info();
  console.log(`HUNT-x71 case=${info.title} status=${String(info.status)}`);
});
