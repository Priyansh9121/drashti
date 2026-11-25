import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editablePptxFixture, slideXml } from '../../src/main/import/testing/editable-pptx-fixture';
import { deckWipeShows } from '../../src/renderer/src/render/transition-frame';
import type { DeckNativeTransition } from '../../src/shared/deck-transition';
import type { EngineCommand } from '../../src/shared/engine/commands';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import {
  holdStill,
  importAndGetIds,
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
  outputPage,
  outputPages,
  outputReady,
  type PageGlobals,
  setUpScreen,
  testDisplays,
  windowShowing,
} from './helpers';
import { launchMain, launchNode, pairNode } from './nodes';
import { expectPhoneRefuses } from './phone-refuses';
import { canvasPixels, near } from './pixels';
import { holdClock } from './placeholder-slides';
import { phoneAsks, phoneShowsLive, playlistOf } from './pro-phone';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

const CLOCK = { DRASHTI_TEST_CLOCK_HOLD: '1', DRASHTI_TEST_DECK_CONVERTER: '1' };
const FADE_MS = 400;
const WIPE_MS = 1600;
const MIDDLE = { x: 960, y: 540 };
const dispatch = (win: Page, command: EngineCommand) =>
  win.evaluate((command) => (globalThis as PageGlobals).drashti.engine.dispatch(command), command);
const current = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide);
const target = (root: Page | Locator, shape: number) => root.locator(`[data-deck-motion-target="${shape}"]`);

/**
 * Whether an output draws without a graphics chip (its context says so, data-chipless: as on CI's Windows): a deck's Wipe then draws
 * PowerPoint's band on the incoming slide's band box, moved; with a chip (CI's Mac) as a mask on the slide's own box
 * (render/chipless.ts, Session 58).
 */
const drawsWithoutChip = async (page: Page): Promise<boolean> =>
  (await page.getByTestId('output-root').getAttribute('data-chipless')) === 'true';

/**
 * Generated shapes with a transparent slide background, so the key can prove the click's changing opacity. Its Wipe goes
 * up unless said (`l`: from the right, as the Performance check's deck's, Q60-2).
 */
function outputDeck(wipe: 'u' | 'l' = 'u'): Buffer {
  const shape = (id: number, color: string, x: number, y: number, width: number, height: number) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Placeholder rectangle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
  const center = (id: number, color: string) => shape(id, color, 4_114_800, 2_286_000, 4_114_800, 2_286_000);
  const fade = (id: number) =>
    `<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="4"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="5" presetClass="entr" presetID="10" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:animEffect filter="fade" transition="in"><p:cBhvr><p:cTn id="6" dur="${FADE_MS}"/><p:tgtEl><p:spTgt spid="${id}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
  const page = (shapes: string, after: string) =>
    slideXml(shapes)
      .replace('<p:spTree>', '<p:bg><p:bgPr><a:noFill/><a:effectLst/></p:bgPr></p:bg><p:spTree>')
      .replace('</p:sld>', `${after}</p:sld>`);
  return editablePptxFixture({
    slides: [
      page(shape(2, 'FF0000', 914_400, 914_400, 1_828_800, 914_400) + center(3, '0000FF'), fade(3)),
      page(
        shape(4, '304050', 0, 0, 12_192_000, 6_858_000) + center(5, '00FF00'),
        `<p:transition dur="${WIPE_MS}"><p:wipe dir="${wipe}"/></p:transition>${fade(5)}`,
      ),
    ],
  });
}

async function importOutputDeck(win: Page, wipe: 'u' | 'l' = 'u'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'drashti-native-outputs-'));
  try {
    const file = join(dir, 'Placeholder output clicks.pptx');
    await writeFile(file, outputDeck(wipe));
    const [id = ''] = await importAndGetIds(win, [file]);
    expect(id).not.toBe('');
    return id;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function outputFor(app: ElectronApplication, screen: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const page of outputPages(app))
        if ((await page.getByTestId('output-root').getAttribute('data-screen')) === screen) found = page;
      return found !== undefined;
    })
    .toBe(true);
  if (!found) throw new Error('The test output did not open.');
  await outputReady(found);
  return found;
}

// A Pro Mode phone (alpha.23, QA23-PHONE-1, the owner's "Only PPT and PDF"): the PowerPoint put up from its playlist
// row on the phone, stepped with its Next and Back, Next stopping at its last click (never the words after it), its
// slide cleared from the phone; Clear all refused.
test('stage Current and Next and a phone follow native clicks through Back and a click during entry; the phone puts the deck up from its playlist row, its Next stops at the last click and it clears the slide', async () => {
  const { app } = await launchApp({
    ...CLOCK,
    ...NETWORK_ENV,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const id = await importOutputDeck(win);
    const hallId = await setUpScreen(win, 'Placeholder Hall', 0);
    const stageId = await setUpScreen(win, 'Placeholder Stage', 1);
    await win.evaluate(async (stageId) => {
      const d = (globalThis as PageGlobals).drashti;
      const group = (await d.screens.get()).groups.find((g) => g.screens.some((s) => s.id === stageId));
      const role = await d.screens.setGroupRole(group?.id ?? '', 'stage');
      if (!role.ok) throw new Error(role.message);
    }, stageId);
    const hall = await outputFor(app, hallId);
    const stage = await outputFor(app, stageId);
    const stageCurrent = stage.getByTestId('stage-current');
    const stageNext = stage.getByTestId('stage-next');
    const { base } = await networkOn(win);
    const phone = await device('chromium');
    try {
      const page = phone.page;
      await pairByQr(page, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
      await expect(page.getByTestId('connection')).toHaveText('Connected');
      const live = page.getByTestId('remote-live');

      // The deck in a playlist, words after it; its row put up from the phone (before alpha.23 the operator put it up).
      const words = await win.evaluate(async () => {
        const made = await (globalThis as PageGlobals).drashti.library.newFromWords(
          'Placeholder words after the clicks',
          'Placeholder words one',
        );
        if (!made.ok) throw new Error(made.message);
        return made.id;
      });
      const list = await playlistOf(win, 'Placeholder clicks list', [
        { kind: 'presentation', presentationId: id },
        { kind: 'presentation', presentationId: words },
      ]);
      expect(
        (
          await phoneAsks(page, 'POST', '/api/v1/trigger/item', {
            playlistId: list.playlistId,
            itemId: list.rows[0] ?? '',
          })
        ).status,
      ).toBe(200);
      await expect.poll(async () => (await current(win))?.presentationId).toBe(id);
      await phoneShowsLive(page, win);
      await expect(target(stageCurrent, 3)).toHaveCSS('opacity', '0');
      await expect(stageNext.locator('[data-shape="rectangle"]')).toHaveCount(2);
      await expect(target(live, 3)).toHaveCSS('opacity', '0');

      await page.getByTestId('remote-next-button').click();
      await expect.poll(async () => (await current(win))?.step).toBe(1);
      const firstClick = await current(win);
      expect(firstClick?.stepAt).toBeDefined();
      await holdClock(app, (firstClick?.stepAt ?? 0) + FADE_MS / 2);
      await expect(target(hall, 3)).toHaveCSS('opacity', '0.5');
      await expect(target(stageCurrent, 3)).toHaveCSS('opacity', '0.5');
      await expect(target(live, 3)).toHaveCSS('opacity', '1');
      await expect(stageNext.locator('[data-shape="rectangle"]')).toHaveCount(1);

      const { entered, clicked } = await win.evaluate(async () => {
        const engine = (globalThis as PageGlobals).drashti.engine;
        await engine.dispatch({ type: 'next' });
        const entered = (await engine.snapshot()).state.layers.slide;
        await engine.dispatch({ type: 'next' });
        const clicked = (await engine.snapshot()).state.layers.slide;
        return { entered, clicked };
      });
      expect(entered).toMatchObject({
        slideIndex: 1,
        step: 0,
        transition: { kind: 'wipe', durationMs: WIPE_MS },
      });
      expect(clicked).toMatchObject({ slideIndex: 1, step: 1 });
      const entryAt = entered?.shownAt ?? 0;
      expect(clicked?.stepAt).toBe(entryAt + WIPE_MS);
      const incoming = hall.locator('[data-layer="slide"] [data-slide-in]');
      const outgoing = hall.locator('[data-layer="slide"] [data-slide-out]');
      await holdClock(app, entryAt + WIPE_MS / 2);
      // A deck's Wipe (Session 58): PowerPoint's soft band, no clip: a mask on the incoming slide's own box, with a
      // graphics chip and without; without one the outgoing slide is a still layer of its own while it runs (X11).
      await expect(incoming).toHaveCSS('clip-path', 'none');
      await expect(incoming).toHaveCSS('mask-image', /^linear-gradient\(/u);
      if (await drawsWithoutChip(hall)) await expect(outgoing).not.toHaveCSS('transform', 'none');
      else await expect(outgoing).toHaveCSS('transform', 'none');
      // Half-way up from the bottom, as the hall draws it: through the band, the incoming slide's full-slide shape over
      // the outgoing slide's blue box, mixed as PowerPoint's half cosine has them (a hard edge half-way would show the
      // box whole above the middle and not at all below it).
      for (const [y, shows] of [
        [400, 0.5 + 0.5 * Math.cos((Math.PI * 680) / 1080)],
        [700, 0.5 + 0.5 * Math.cos((Math.PI * 380) / 1080)],
      ] as const) {
        const mixed: [number, number, number] = [
          shows * 0x30,
          shows * 0x40,
          shows * 0x50 + (1 - shows) * 255,
        ];
        await expect
          .poll(
            async () => {
              const [rgb] = await canvasPixels(hall, [{ x: MIDDLE.x, y }]);
              return near(rgb, mixed, 18) ? 'mixed' : (rgb ?? []).join(',');
            },
            {
              message: `the hall half-way through the Wipe at y ${String(y)}, ${mixed.map(Math.round).join(',')}`,
            },
          )
          .toBe('mixed');
      }
      await expect(target(hall, 5)).toHaveCSS('opacity', '0');
      await expect(target(stageCurrent, 5)).toHaveCSS('opacity', '0');
      await holdClock(app, entryAt + WIPE_MS + FADE_MS / 2);
      await expect(incoming).toHaveCSS('clip-path', 'none');
      await expect(incoming).toHaveCSS('mask-image', 'none');
      await expect(incoming).toHaveCSS('transform', 'none');
      await expect(target(hall, 5)).toHaveCSS('opacity', '0.5');
      await expect(target(stageCurrent, 5)).toHaveCSS('opacity', '0.5');
      await holdClock(app, entryAt + WIPE_MS + FADE_MS);
      await expect(target(stageCurrent, 5)).toHaveCSS('opacity', '1');

      await page.getByTestId('remote-back').click();
      await expect.poll(async () => (await current(win))?.step).toBe(0);
      await expect(target(stageCurrent, 5)).toHaveCSS('opacity', '0');
      await expect(stageNext.locator('[data-shape="rectangle"]')).toHaveCount(2);
      await expect(target(live, 5)).toHaveCSS('opacity', '0');

      // Its last click from the phone, then Next again: nothing changes (never the words after it in the playlist).
      await page.getByTestId('remote-next-button').click();
      await expect.poll(async () => (await current(win))?.step).toBe(1);
      await page.getByTestId('remote-next-button').click();
      await holdStill(
        async () => {
          const now = await current(win);
          return now?.presentationId === id && now.slideIndex === 1 && now.step === 1;
        },
        1500,
        'Next on the phone at the deck’s last click changes nothing',
      );
      // Clear all from the phone: refused; Clear slide (the owner's Q7): the slide goes.
      await expectPhoneRefuses({ win, page }, 'POST', '/api/v1/clear/all', {}, 'computer');
      expect((await phoneAsks(page, 'POST', '/api/v1/clear/slide', {})).status).toBe(200);
      await expect.poll(() => current(win)).toBeNull();
    } finally {
      await phone.close();
    }
  } finally {
    await app.close();
  }
});

test('the LIVE picture and Screens card draw the Wipe band as the slide’s mask in software, the outgoing slide a still layer', async () => {
  const { app } = await launchApp({
    ...CLOCK,
    DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software',
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    const id = await importOutputDeck(win);
    const hallId = await setUpScreen(win, 'Placeholder Hall', 1);
    const hall = await outputFor(app, hallId);
    await expect(hall.getByTestId('output-root')).toHaveAttribute('data-warm-up', 'skipped');
    await win.getByRole('button', { name: 'Screens', exact: true }).click();
    const projector = win.getByTestId('projector-preview');
    await expect(projector).toBeVisible();
    const previews = [win.getByTestId('live-preview'), projector];

    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    for (const preview of previews) await expect(target(preview, 3)).toHaveCount(1);
    // Next first reveals slide one's click. The second Next enters the slide with the Wipe.
    expect(await dispatch(win, { type: 'next' })).toMatchObject({ ok: true });
    expect(await dispatch(win, { type: 'next' })).toMatchObject({ ok: true });
    const entered = await current(win);
    expect(entered).toMatchObject({ slideIndex: 1, transition: { kind: 'wipe', durationMs: WIPE_MS } });
    await holdClock(app, (entered?.shownAt ?? 0) + WIPE_MS / 2);

    for (const preview of previews) {
      const incoming = preview.locator('[data-layer="slide"] [data-slide-in]');
      const outgoing = preview.locator('[data-layer="slide"] [data-slide-out]');
      await expect(incoming).toHaveCSS('mask-image', /^linear-gradient\(/u);
      await expect(outgoing).not.toHaveCSS('transform', 'none');
    }
  } finally {
    await app.close();
  }
});

test('without a graphics chip a deck’s own Wipe across shows its incoming slide through PowerPoint’s band part-way on the hall (Q60-2)', async () => {
  // Told it draws without a graphics chip (as CI's two-core Windows does, or a PC whose graphics driver is blocked): the
  // band boxes' way (render/chipless.ts), the band's mask on the incoming slide's band holder, moved. A Wipe across (from
  // the right, as the Performance check's deck's): the holder's height is the slide's own, never written for it.
  const { app } = await launchApp({
    ...CLOCK,
    DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software',
    DRASHTI_WINDOWED_OUTPUTS: '1',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const id = await importOutputDeck(win, 'l');
    const hallId = await setUpScreen(win, 'Placeholder Hall', 0);
    const hall = await outputFor(app, hallId);
    await expect(hall.getByTestId('output-root')).toHaveAttribute('data-chipless', 'true');
    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    // Next first reveals slide one's click. The second Next enters the slide with the Wipe.
    expect(await dispatch(win, { type: 'next' })).toMatchObject({ ok: true });
    expect(await dispatch(win, { type: 'next' })).toMatchObject({ ok: true });
    const entered = await current(win);
    expect(entered).toMatchObject({
      slideIndex: 1,
      transition: { kind: 'wipe', deckEffect: 'wipe', direction: 'left', durationMs: WIPE_MS },
    });
    const wipe = entered?.transition as DeckNativeTransition;
    // At three moments of the way, three points across from the slide's right (its own side) along y 900, clear of both
    // slides' shapes: the incoming slide's full-slide shape (#304050) over the outgoing slide's own nothing (black), as
    // much as PowerPoint's band shows of it there (deckWipeShows: what every screen draws, with a chip and without).
    for (const part of [0.3, 0.5, 0.7]) {
      await holdClock(app, (entered?.shownAt ?? 0) + WIPE_MS * part);
      for (const across of [0.05, 0.3, 0.55]) {
        const shows = deckWipeShows(wipe, part, across);
        const want: [number, number, number] = [0x30 * shows, 0x40 * shows, 0x50 * shows];
        const x = 1920 * (1 - across);
        await expect
          .poll(
            async () => {
              const [rgb] = await canvasPixels(hall, [{ x, y: 900 }]);
              return near(rgb, want, 18) ? 'as PowerPoint' : (rgb ?? []).join(',');
            },
            {
              message: `the hall ${String(part * 100)}% through the Wipe at x ${String(x)}: ${want.map(Math.round).join(',')}`,
            },
          )
          .toBe('as PowerPoint');
      }
    }
    await holdClock(app, (entered?.shownAt ?? 0) + WIPE_MS);
    await expect(hall.locator('[data-layer="slide"]')).not.toHaveAttribute('data-fading', 'true');
    await expect
      .poll(async () => {
        const [rgb] = await canvasPixels(hall, [{ x: 960, y: 900 }]);
        return near(rgb, [0x30, 0x40, 0x50], 18) ? 'the slide whole' : (rgb ?? []).join(',');
      })
      .toBe('the slide whole');
    await holdClock(app, null);
  } finally {
    await app.close();
  }
});

test('a node and the key and fill draw a native click at the same held frame', async () => {
  const main = await launchMain({ ...CLOCK, DRASHTI_EXTRA_DISPLAYS: '2' });
  try {
    const node = await launchNode({ DRASHTI_TEST_CLOCK_HOLD: '1' });
    try {
      const nodeId = await pairNode(main, node);
      const id = await importOutputDeck(main.win);
      const hallId = await setUpScreen(main.win, 'Placeholder Hall', 0);
      await expect
        .poll(async () =>
          main.win.evaluate(
            async (id) =>
              (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((n) => n.id === id)
                ?.displays.length ?? 0,
            nodeId,
          ),
        )
        .toBeGreaterThanOrEqual(2);
      const pairDisplays = (await testDisplays(main.win)).slice(1, 3).map((display) => display.id);
      const pair = await main.win.evaluate(
        async ({ hallId, nodeId, pairDisplays }) => {
          const d = (globalThis as PageGlobals).drashti;
          const config = await d.screens.get();
          const hall = config.groups.find((group) => group.screens.some((screen) => screen.id === hallId));
          const display = config.nodes.find((node) => node.id === nodeId)?.displays[1]?.id ?? -1;
          const nodeDisplay = await d.screens.assignNodeDisplay(hall?.id ?? '', nodeId, display);
          if (!nodeDisplay.ok) throw new Error(nodeDisplay.message);
          const made = await d.screens.createGroup('Placeholder switcher');
          if (!made.ok) throw new Error(made.message);
          const group = made.snapshot.groups.find((group) => group.name === 'Placeholder switcher');
          const role = await d.screens.setGroupRole(group?.id ?? '', 'keyfill');
          if (!role.ok) throw new Error(role.message);
          for (const displayId of pairDisplays) {
            const assigned = await d.screens.assignDisplay(group?.id ?? '', displayId, {
              coverOperator: true,
            });
            if (!assigned.ok) throw new Error(assigned.message);
          }
          return (await d.screens.get()).groups.find((g) => g.id === group?.id)?.screens ?? [];
        },
        { hallId, nodeId, pairDisplays },
      );
      expect(pair.map((screen) => screen.feed)).toEqual(['fill', 'key']);
      const hall = await outputFor(main.app, hallId);
      const fill = await outputFor(main.app, pair[0]?.id ?? '');
      const key = await outputFor(main.app, pair[1]?.id ?? '');
      const nodeOut = await outputPage(node.app);
      await outputReady(nodeOut);

      await dispatch(main.win, { type: 'goLive', presentationId: id, slideIndex: 0 });
      await expect(target(nodeOut, 3)).toHaveCSS('opacity', '0');
      await dispatch(main.win, { type: 'next' });
      await expect.poll(async () => (await current(main.win))?.step).toBe(1);
      const live = await current(main.win);
      expect(live?.stepAt).toBeDefined();
      const hold = async (elapsed: number) => {
        for (const app of [main.app, node.app]) await holdClock(app, (live?.stepAt ?? 0) + elapsed);
      };
      const sameFrame = async (opacity: string, blue: number) => {
        for (const page of [hall, nodeOut, fill, key])
          await expect(target(page, 3)).toHaveCSS('opacity', opacity);
        for (const page of [hall, nodeOut, fill])
          await expect
            .poll(async () => near((await canvasPixels(page, [MIDDLE]))[0], [0, 0, blue], 18))
            .toBe(true);
        await expect
          .poll(async () => near((await canvasPixels(key, [MIDDLE]))[0], [blue, blue, blue], 18))
          .toBe(true);
      };

      await hold(FADE_MS / 2);
      await sameFrame('0.5', 128);
      await hold(FADE_MS);
      await sameFrame('1', 255);
    } finally {
      await node.app.close();
    }
  } finally {
    await main.app.close();
  }
});

const PUSH_MS = 800;

/** A generated 4:3 deck: a red slide, then a green one that comes in by PowerPoint's Push from the right. */
function fourThreePushDeck(opaque = false): Buffer {
  // See-through slides (no background) each with a full-slide shape of its colour; or, `opaque`, slides whose own
  // background is that colour (X11: a slide known opaque, backed while it moves without a graphics chip).
  const whole = (color: string) =>
    opaque
      ? ''
      : `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Placeholder rectangle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
  const fill = (color: string) =>
    opaque ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : '<a:noFill/>';
  const page = (color: string, after = '') =>
    slideXml(whole(color))
      .replace('<p:spTree>', `<p:bg><p:bgPr>${fill(color)}<a:effectLst/></p:bgPr></p:bg><p:spTree>`)
      .replace('</p:sld>', `${after}</p:sld>`);
  const ns =
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return editablePptxFixture({
    slides: [
      page('FF0000'),
      page('00FF00', `<p:transition dur="${PUSH_MS}"><p:push dir="l"/></p:transition>`),
    ],
    // The deck's own size: 4:3 (9144000 x 6858000 EMU), where the fixture's is 16:9.
    parts: {
      'ppt/presentation.xml': `<p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`,
    },
  });
}

test('Back part-way through a deck’s own Push shows a slide whole, never the Push part-way (TX-1)', async () => {
  const { app } = await launchApp({ ...CLOCK, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const dir = await mkdtemp(join(tmpdir(), 'drashti-back-push-'));
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const file = join(dir, 'Placeholder back push.pptx');
    await writeFile(file, fourThreePushDeck());
    const [id = ''] = await importAndGetIds(win, [file]);
    const hall = await outputFor(app, await setUpScreen(win, 'Placeholder Hall', 0));
    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    await expect.poll(async () => (await current(win))?.slideIndex).toBe(0);
    await dispatch(win, { type: 'next' });
    await expect.poll(async () => (await current(win))?.slideIndex).toBe(1);
    const entered = await current(win);
    await holdClock(app, (entered?.shownAt ?? 0) + PUSH_MS / 2);
    /** The colours at the slide's left and right, as one word each (r = red, g = green, else its numbers). */
    const sides = async () => {
      const seen = await canvasPixels(hall, [
        { x: 600, y: MIDDLE.y },
        { x: 1300, y: MIDDLE.y },
      ]);
      return seen.map((px) =>
        near(px, [255, 0, 0], 40) ? 'r' : near(px, [0, 255, 0], 40) ? 'g' : px.join(','),
      );
    };
    // Part-way: the red slide going on the left, the green one coming on the right.
    await expect.poll(sides, { message: 'half-way through the Push' }).toEqual(['r', 'g']);
    // Back, part-way (TX-1): the slide that was coming in up whole, as at rest, while the slide gone back to waits for
    // its clip, then that one whole: never the Push left part-way.
    await dispatch(win, { type: 'back' });
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      const [left = '', right = ''] = await sides();
      seen.push(`${left}|${right}`);
      expect(left, `both sides one slide after Back (read so far: ${seen.join(' ')})`).toBe(right);
      await letTimePass(hall, 80, 'the hall screen looked at again a few frames later, after Back');
    }
    await expect.poll(sides, { message: 'the slide gone back to, whole' }).toEqual(['r', 'r']);
    await expect(hall.locator('[data-layer="slide"]')).toHaveCSS('clip-path', 'none');
    await holdClock(app, null);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a 4:3 deck’s Push on a 16:9 hall moves its slides by the slide’s width inside the slide, the bars staying black (Q58-16)', async () => {
  const { app } = await launchApp({ ...CLOCK, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const dir = await mkdtemp(join(tmpdir(), 'drashti-four-three-'));
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const file = join(dir, 'Placeholder four three push.pptx');
    await writeFile(file, fourThreePushDeck());
    const [id = ''] = await importAndGetIds(win, [file]);
    expect(id).not.toBe('');
    const hallId = await setUpScreen(win, 'Placeholder Hall', 0);
    const hall = await outputFor(app, hallId);
    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    await expect.poll(async () => (await current(win))?.slideIndex).toBe(0);
    await dispatch(win, { type: 'next' });
    await expect.poll(async () => (await current(win))?.slideIndex).toBe(1);
    const entered = await current(win);
    expect(entered?.transition).toMatchObject({ deckEffect: 'push', durationMs: PUSH_MS, direction: 'left' });
    // Half-way (eased in and out: half): the red slide half its width out to the left, the green one half in from the
    // right, both inside the slide (1440 x 1080 between 240-px bars).
    await holdClock(app, (entered?.shownAt ?? 0) + PUSH_MS / 2);
    await expect(hall.locator('[data-layer="slide"]')).toHaveCSS(
      'clip-path',
      /^inset\(0px 240px( 0px 240px)?\)$/u,
    );
    for (const [x, rgb, what] of [
      [100, [0, 0, 0], 'the left bar'],
      [600, [255, 0, 0], 'the red slide going'],
      [1300, [0, 255, 0], 'the green slide coming'],
      [1820, [0, 0, 0], 'the right bar'],
    ] as const) {
      const want: [number, number, number] = [rgb[0], rgb[1], rgb[2]];
      await expect
        .poll(
          async () => {
            const [seen] = await canvasPixels(hall, [{ x, y: MIDDLE.y }]);
            return near(seen, want, 40) ? 'as PowerPoint' : (seen ?? []).join(',');
          },
          { message: `${what} at x ${String(x)}, half-way through the Push` },
        )
        .toBe('as PowerPoint');
    }
    await holdClock(app, (entered?.shownAt ?? 0) + PUSH_MS);
    await expect(hall.locator('[data-layer="slide"]')).not.toHaveAttribute('data-fading', 'true');
    // Over: no clip left on the layer.
    await expect(hall.locator('[data-layer="slide"]')).toHaveCSS('clip-path', 'none');
    await holdClock(app, null);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('without a graphics chip a deck’s moving slide known opaque is backed in its own place, the bars staying black; a see-through one never (X11, Q60-6)', async () => {
  // Told it draws without a graphics chip (as CI's two-core Windows does): each moving slide a layer of its own, and
  // one whose own background is an opaque colour backed by it in its own place (the stream's page: 1920 x 1080, whole
  // device pixels), so the compositor draws nothing under it. The bars beside a 4:3 slide stay black; a slide that can
  // be seen through (no background, a shape of its colour on it) is never backed.
  const { app } = await launchApp({
    ...CLOCK,
    DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software',
    DRASHTI_WINDOWED_OUTPUTS: '1',
  });
  const dir = await mkdtemp(join(tmpdir(), 'drashti-backed-push-'));
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const opaqueFile = join(dir, 'Placeholder backed push.pptx');
    const seeThroughFile = join(dir, 'Placeholder see-through push.pptx');
    await writeFile(opaqueFile, fourThreePushDeck(true));
    await writeFile(seeThroughFile, fourThreePushDeck());
    const [opaqueId = '', seeThroughId = ''] = await importAndGetIds(win, [opaqueFile, seeThroughFile]);
    expect(opaqueId).not.toBe('');
    expect(seeThroughId).not.toBe('');
    const hall = await outputFor(app, await setUpScreen(win, 'Placeholder Hall', 0));
    await expect(hall.getByTestId('output-root')).toHaveAttribute('data-chipless', 'true');
    // The stream's picture, as the Stream panel's preview asks for it.
    await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.watchPreview(true));
    const stream = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
    await expect(stream.getByTestId('program-root')).toHaveAttribute('data-fonts', 'ready', {
      timeout: 30_000,
    });
    const box = (page: Page, which: 'in' | 'out') =>
      page.locator(`[data-layer="slide"] [data-slide-${which}]`);
    const halfway = async (id: string) => {
      await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
      await expect.poll(async () => (await current(win))?.slideIndex).toBe(0);
      // Main can answer both commands before a page has painted the first slide. Its outgoing layer needs that
      // first render; wait for both pages, not just Main's snapshot, before asking for the moving slide.
      const first = await current(win);
      if (!first) throw new Error('The first slide was not put up.');
      for (const page of [hall, stream])
        await expect(page.locator('[data-layer="slide"] [data-slide-in] [data-slide]')).toHaveAttribute(
          'data-slide',
          first.slide.id,
        );

      await dispatch(win, { type: 'next' });
      await expect.poll(async () => (await current(win))?.slideIndex).toBe(1);
      const entered = await current(win);
      expect(entered?.transition).toMatchObject({
        deckEffect: 'push',
        durationMs: PUSH_MS,
        direction: 'left',
      });
      await holdClock(app, (entered?.shownAt ?? 0) + PUSH_MS / 2);
      return entered?.shownAt ?? 0;
    };
    /** Both pages half-way through the Push: the bars black, the red slide going, the green one coming. */
    const asPowerPoint = async (what: string) => {
      for (const page of [hall, stream])
        for (const [x, rgb, where] of [
          [100, [0, 0, 0], 'the left bar'],
          [600, [255, 0, 0], 'the red slide going'],
          [1300, [0, 255, 0], 'the green slide coming'],
          [1820, [0, 0, 0], 'the right bar'],
        ] as const) {
          const want: [number, number, number] = [rgb[0], rgb[1], rgb[2]];
          await expect
            .poll(
              async () => {
                const [seen] = await canvasPixels(page, [{ x, y: MIDDLE.y }]);
                return near(seen, want, 40) ? 'as PowerPoint' : (seen ?? []).join(',');
              },
              { message: `${what}: ${where} at x ${String(x)} on the ${page === hall ? 'hall' : 'stream'}` },
            )
            .toBe('as PowerPoint');
        }
    };

    // Slides whose own background is their colour: each moving slide backed by it, its layer the slide's own place
    // (240 px in, 1440 wide), its drawing moved back by as much, so it is drawn where it was.
    const shownAt = await halfway(opaqueId);
    await expect(box(stream, 'out')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
    await expect(box(stream, 'in')).toHaveCSS('background-color', 'rgb(0, 255, 0)');
    for (const which of ['in', 'out'] as const) {
      await expect(box(stream, which)).toHaveCSS('left', '240px');
      await expect(box(stream, which)).toHaveCSS('width', '1440px');
      await expect(box(stream, which).locator(':scope > [data-wipe-band]')).toHaveCSS('left', '-240px');
    }
    await asPowerPoint('slides known opaque, backed');
    // Over: nothing of it left.
    await holdClock(app, shownAt + PUSH_MS);
    await expect(stream.locator('[data-layer="slide"]')).not.toHaveAttribute('data-fading', 'true');
    await expect(box(stream, 'in')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(box(stream, 'in')).toHaveCSS('left', '0px');
    await expect(box(stream, 'in')).toHaveCSS('width', '1920px');
    await holdClock(app, null);

    // Slides that can be seen through: moved on layers of their own, never backed.
    await halfway(seeThroughId);
    for (const page of [hall, stream])
      for (const which of ['in', 'out'] as const)
        await expect(box(page, which)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await asPowerPoint('see-through slides, never backed');
    await holdClock(app, null);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
