import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editablePptxFixture, slideXml } from '../../src/main/import/testing/editable-pptx-fixture';
import type { EngineCommand } from '../../src/shared/engine/commands';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
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
  testDisplays,
} from './helpers';
import { launchMain, launchNode, pairNode } from './nodes';
import { canvasPixels, near } from './pixels';
import { holdClock } from './placeholder-slides';

const CLOCK = { DRASHTI_TEST_CLOCK_HOLD: '1', DRASHTI_TEST_DECK_CONVERTER: '1' };
const FADE_MS = 400;
const WIPE_MS = 1600;
const MIDDLE = { x: 960, y: 540 };
const dispatch = (win: Page, command: EngineCommand) =>
  win.evaluate((command) => (globalThis as PageGlobals).drashti.engine.dispatch(command), command);
const current = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide);
const target = (root: Page | Locator, shape: number) => root.locator(`[data-deck-motion-target="${shape}"]`);

/** Generated shapes with a transparent slide background, so the key can prove the click's changing opacity. */
function outputDeck(): Buffer {
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
        `<p:transition dur="${WIPE_MS}"><p:wipe dir="u"/></p:transition>${fade(5)}`,
      ),
    ],
  });
}

async function importOutputDeck(win: Page): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'drashti-native-outputs-'));
  try {
    const file = join(dir, 'Placeholder output clicks.pptx');
    await writeFile(file, outputDeck());
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

test('stage Current and Next and a phone follow native clicks through Back and a click during entry', async () => {
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

      await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
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
      await holdClock(app, entryAt + WIPE_MS / 2);
      // PowerPoint's Wipe: the incoming slide through a soft band one slide long (a mask), no hard edge.
      await expect(incoming).toHaveCSS('mask-image', /^linear-gradient\(/u);
      await expect(incoming).toHaveCSS('clip-path', 'none');
      await expect(target(hall, 5)).toHaveCSS('opacity', '0');
      await expect(target(stageCurrent, 5)).toHaveCSS('opacity', '0');
      await holdClock(app, entryAt + WIPE_MS + FADE_MS / 2);
      await expect(incoming).toHaveCSS('mask-image', 'none');
      await expect(target(hall, 5)).toHaveCSS('opacity', '0.5');
      await expect(target(stageCurrent, 5)).toHaveCSS('opacity', '0.5');
      await holdClock(app, entryAt + WIPE_MS + FADE_MS);
      await expect(target(stageCurrent, 5)).toHaveCSS('opacity', '1');

      await page.getByTestId('remote-back').click();
      await expect.poll(async () => (await current(win))?.step).toBe(0);
      await expect(target(stageCurrent, 5)).toHaveCSS('opacity', '0');
      await expect(stageNext.locator('[data-shape="rectangle"]')).toHaveCount(2);
      await expect(target(live, 5)).toHaveCSS('opacity', '0');
    } finally {
      await phone.close();
    }
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
