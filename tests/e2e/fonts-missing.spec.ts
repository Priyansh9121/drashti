import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { expectNoSeriousA11yIssues } from './a11y';
import { importAndGetIds, outputPage, type PageGlobals, setUpScreen } from './helpers';
import { launchMain, launchNode, pairNode } from './nodes';

/*
 * A font not on this computer (Sessions 31–36, I18N-1): a box of words in a font the slide names but the
 * computer lacks (here a legacy-named placeholder font no computer has) is marked where it is drawn, on
 * Main's outputs and a node's, and the operator is told beside LIVE and on the screens dashboard; nothing
 * different is drawn on the screens. Placeholder words only.
 */

const FONT = 'Placeholder LMG-Arun';

/** A presentation whose words are set in a font no computer has; its id. */
async function inMissingFont(win: Page): Promise<string> {
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-missing-font-')), 'Placeholder Missing Font.pro6');
  writeFileSync(
    file,
    pp6Presentation({
      uuid: 'E2E-MISSING-FONT',
      groups: [
        {
          name: 'Verse',
          uuid: 'E2E-MISSING-FONT-G',
          slides: [
            { text: [{ rtf: cocoaRtf([['Placeholder legacy words', 72, [255, 255, 255]]], 'qc', FONT) }] },
          ],
        },
      ],
    }),
  );
  const [id = ''] = await importAndGetIds(win, [file]);
  return id;
}

const goLive = (win: Page, presentationId: string) =>
  win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: id,
        slideIndex: 0,
      }),
    presentationId,
  );

test('a font not on this computer is marked on Main’s output, said beside LIVE and on the dashboard, and document.fonts.check() alone would not have said so', async () => {
  test.setTimeout(120_000);
  const main = await launchMain();
  const { app, win } = main;
  await win.setViewportSize({ width: 1280, height: 800 });
  const id = await inMissingFont(win);
  await setUpScreen(win);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  await goLive(win, id);
  const box = out.locator(`[data-layer="slide"] [data-missing-font="${FONT}"]`);
  await expect(box).toHaveCount(1);
  // The proof: the page's own font check says the font is there, as it says of any font it is not loading.
  expect(await out.evaluate((font) => document.fonts.check(`72px "${font}"`), FONT)).toBe(true);
  // Beside LIVE, and on the dashboard's card for Main's own display.
  await expect(win.getByTestId('live-missing-font')).toHaveText(`Font not on this computer: ${FONT}`);
  await win.getByTestId('screens-summary').click();
  const dashboard = win.getByTestId('screens-dashboard');
  await expect(dashboard.getByTestId('dashboard-missing-font')).toHaveText(
    `Font not on this computer: ${FONT}`,
    {
      timeout: 10_000,
    },
  );
  await expectNoSeriousA11yIssues(win, 'the dashboard naming a missing font');
  await app.close();
});

test('a node’s output marks a font not on the node, and Main’s dashboard says so for the node', async () => {
  test.setTimeout(180_000);
  const main = await launchMain();
  const node = await launchNode();
  try {
    const nodeId = await pairNode(main, node);
    const id = await inMissingFont(main.win);
    // A group on Main, given the node's second (pretend) display.
    const groupId = await main.win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.screens.createGroup('Placeholder Lobby');
      if (!made.ok) throw new Error(made.message);
      return made.snapshot.groups.find((g) => g.name === 'Placeholder Lobby')?.id ?? '';
    });
    await expect
      .poll(
        async () =>
          (
            (await main.win.evaluate(() => (globalThis as PageGlobals).drashti.screens.get())).nodes.find(
              (n) => n.id === nodeId,
            )?.displays ?? []
          ).length,
      )
      .toBeGreaterThanOrEqual(2);
    const assigned = await main.win.evaluate(
      async ({ groupId, nodeId }) => {
        const d = (globalThis as PageGlobals).drashti;
        const displays = (await d.screens.get()).nodes.find((n) => n.id === nodeId)?.displays ?? [];
        return d.screens.assignNodeDisplay(groupId, nodeId, displays[1]?.id ?? -1);
      },
      { groupId, nodeId },
    );
    expect(assigned.ok).toBe(true);
    const nodeOut = await outputPage(node.app);
    await goLive(main.win, id);
    await expect(nodeOut.locator(`[data-layer="slide"] [data-missing-font="${FONT}"]`)).toHaveCount(1, {
      timeout: 20_000,
    });
    await main.win.getByTestId('screens-summary').click();
    const card = main.win
      .getByTestId('screens-dashboard')
      .locator(`[data-testid="dashboard-display"][data-node="${nodeId}"]`)
      .filter({ has: main.win.getByTestId('dashboard-missing-font') });
    await expect(card.getByTestId('dashboard-missing-font')).toHaveText(`Font not on this node: ${FONT}`, {
      timeout: 20_000,
    });
  } finally {
    await node.app.close();
    await main.app.close();
  }
});
