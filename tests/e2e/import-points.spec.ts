import { type Page, expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineCommand } from '../../src/shared/engine/commands';
import type { PipPlace } from '../../src/shared/engine/state';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { importAndGetIds, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { makeTestVideo } from './test-media';

/*
 * Start and end points an import gives a file (Session 54, Session 53's question 10): a presentation from the older
 * app whose background video has in and out points, imported while that video (in the library already, with no
 * points of its own) is up as the background, on the slide up, as a prop and in the picture-in-picture box, and (the
 * review) as the sound playing, as a slide's sound can be a video's, and as the logo. Each moves to them at once, as
 * for points saved while it plays (Session 52; the box's, Session 53), and none goes up again: until now each played
 * the whole file until it went up again. A generated video, placeholder names only.
 */

const PLACE: PipPlace = {
  corner: 'bottom-right',
  x: 0,
  y: 0,
  size: 'medium',
  border: true,
  rounded: true,
  motion: 'fade',
};
/** The points the presentation gives the video, in its time scale's units (600 a second): 0:02 to 0:06. */
const POINTS = { timeScale: 600, in: 1200, out: 3600, end: 4800 };
/** As the library keeps them, and the engine stamps them on what plays the video. */
const CLIP = { startMs: 2000, endMs: 6000 };

const line = (text: string) => ({ text: [{ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) }] });

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

async function dispatch(win: Page, command: EngineCommand): Promise<void> {
  const done = await win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
  expect(done.ok, `${command.type} was refused`).toBe(true);
}

test('points an import gives a video move it at once wherever it is up: the background, the slide up, a prop, the box, the sound and the logo, none put up again', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-import-points-'));
  const video = await makeTestVideo(win, join(dir, 'Placeholder points clip.webm'), { seconds: 8, hue: 120 });
  // The video in the library first, with no points of its own; then a presentation with it on a slide.
  const [clip = ''] = await importAndGetIds(win, [video]);
  const onSlide = join(dir, 'Placeholder Video Slide.pro6');
  writeFileSync(
    onSlide,
    pp6Presentation({
      uuid: 'E2E-POINTS-SLIDE',
      groups: [
        {
          name: 'Verse',
          slides: [{ video: { path: video, rect: [960, 0, 960, 540], loop: true }, ...line('Placeholder') }],
        },
      ],
    }),
  );
  const [presentationId = ''] = await importAndGetIds(win, [onSlide]);
  const markers = () => win.evaluate((id) => (globalThis as PageGlobals).drashti.media.markers(id), clip);
  expect(await markers()).toMatchObject({ startMs: null, endMs: null });

  // Up, the whole file, everywhere it can be: on the slide, as the background, as a prop and in the box.
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
  await dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId: clip, media: 'video', fit: 'fill', loop: true },
  });
  await dispatch(win, {
    type: 'showProp',
    prop: {
      id: 'placeholder-points-prop',
      name: 'Placeholder points prop',
      elements: [
        {
          id: 'placeholder-points-prop-video',
          kind: 'video',
          mediaId: clip,
          frame: { x: 1200, y: 600, width: 640, height: 360 },
          fit: 'fit',
          loop: true,
        },
      ],
    },
  });
  await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId: clip }, place: PLACE });
  // Its sound too, silent here (a slide's sound can be a video's), and the logo.
  await dispatch(win, {
    type: 'playAudio',
    audio: {
      id: 'placeholder-points-sound',
      title: 'Placeholder points sound',
      mediaId: clip,
      volume: 0,
      loop: true,
    },
  });
  await dispatch(win, {
    type: 'showLogo',
    prop: {
      id: 'placeholder-points-logo',
      name: 'Placeholder points logo',
      elements: [
        {
          id: 'placeholder-points-logo-video',
          kind: 'video',
          mediaId: clip,
          frame: { x: 640, y: 360, width: 640, height: 360 },
          fit: 'fit',
          loop: true,
        },
      ],
    },
  });
  const before = await state(win);
  expect(before.layers.slide).toMatchObject({ presentationId, slideIndex: 0 });
  expect(before.layers.slide?.slide.elements.some((e) => e.kind === 'video' && e.mediaId === clip)).toBe(
    true,
  );
  expect(before.layers.slide).not.toHaveProperty('clips');
  expect(before.layers.background).toMatchObject({ kind: 'media', mediaId: clip });
  expect(before.layers.background).not.toHaveProperty('clip');
  expect(before.layers.props[0]).not.toHaveProperty('clips');
  expect(before.layers.pip).not.toHaveProperty('clips');
  expect(before.layers.audio).toMatchObject({ mediaId: clip });
  expect(before.layers.audio).not.toHaveProperty('clip');
  expect(before.logo).toMatchObject({ id: 'placeholder-points-logo' });
  expect(before.logo).not.toHaveProperty('clips');

  // Another presentation, whose background is the same video between 0:02 and 0:06: the file takes those points.
  const marked = join(dir, 'Placeholder Marked Backdrop.pro6');
  writeFileSync(
    marked,
    pp6Presentation({
      uuid: 'E2E-POINTS-BACKDROP',
      groups: [
        {
          name: 'Verse',
          slides: [
            {
              background: { path: video, kind: 'video', loop: true, points: POINTS },
              ...line('Placeholder over the video between its points'),
            },
          ],
        },
      ],
    }),
  );
  await importAndGetIds(win, [marked]);
  expect(await markers()).toMatchObject(CLIP);

  // At once, everywhere it is up, each from the time it went up: none put up again, nothing else changed.
  await expect.poll(async () => (await state(win)).layers.background).toMatchObject({ clip: CLIP });
  const after = await state(win);
  expect(after.layers.background).toMatchObject({
    kind: 'media',
    mediaId: clip,
    startedAt: before.layers.background?.kind === 'media' ? before.layers.background.startedAt : -1,
  });
  expect(after.layers.slide).toMatchObject({
    presentationId,
    slideIndex: 0,
    shownAt: before.layers.slide?.shownAt,
    clips: { [clip]: CLIP },
  });
  expect(after.layers.props).toHaveLength(1);
  expect(after.layers.props[0]).toMatchObject({
    shownAt: before.layers.props[0]?.shownAt,
    clips: { [clip]: CLIP },
  });
  expect(after.layers.pip).toMatchObject({ shownAt: before.layers.pip?.shownAt, clips: { [clip]: CLIP } });
  expect(after.layers.audio).toMatchObject({
    mediaId: clip,
    startedAt: before.layers.audio?.startedAt,
    clip: CLIP,
  });
  expect(after.logo).toMatchObject({ shownAt: before.logo?.shownAt, clips: { [clip]: CLIP } });
  expect(after.live).toEqual(before.live);
  await app.close();
});
