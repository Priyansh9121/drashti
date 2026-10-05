import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { importAndGetIds, outputPage, setUpScreen } from './helpers';
import { launchMain, launchNode, nodeCode, pairNode } from './nodes';

/*
 * The screens dashboard (Session 13): every display on Main and on its
 * node, with a live picture and how it stands; Identify on a node's
 * display; the status bar's warning when the node goes offline; Simple Mode
 * sees the dashboard and Identify but refuses every request that changes
 * something; the dashboard and the node's window pass axe at 1280 x 720.
 * Placeholder words only.
 */

test('the dashboard: pictures, status, Identify, the warning when a node goes, and Simple Mode', async () => {
  test.setTimeout(240_000);
  const main = await launchMain();
  const node = await launchNode();
  let nodeClosed = false;
  try {
    // The node's window before and after pairing passes axe at 1280 x 720.
    await node.page.setViewportSize({ width: 1280, height: 720 });
    await expectNoSeriousA11yIssues(node.page, 'the node window, not paired');
    const nodeId = await pairNode(main, node);
    await expectNoSeriousA11yIssues(node.page, 'the node window, paired');

    const dir = mkdtempSync(join(tmpdir(), 'drashti-dashboard-'));
    const words = join(dir, 'Placeholder Dashboard.txt');
    writeFileSync(words, '[Verse]\nPlaceholder on every screen\n');
    const [id = ''] = await importAndGetIds(main.win, [words]);
    await setUpScreen(main.win, 'Placeholder Hall', 1);
    const groupId = await main.win.evaluate(
      async () =>
        (await (globalThis as PageGlobals).drashti.screens.get()).groups.find(
          (g) => g.name === 'Placeholder Hall',
        )?.id ?? '',
    );
    await expect
      .poll(async () =>
        main.win.evaluate(
          async (n) =>
            (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((x) => x.id === n)?.displays
              .length ?? 0,
          nodeId,
        ),
      )
      .toBeGreaterThanOrEqual(2);
    await main.win.evaluate(
      async ({ groupId, nodeId }) => {
        const d = (globalThis as PageGlobals).drashti;
        const n = (await d.screens.get()).nodes.find((x) => x.id === nodeId);
        const r = await d.screens.assignNodeDisplay(groupId, nodeId, n?.displays[1]?.id ?? -1);
        if (!r.ok) throw new Error(r.message);
      },
      { groupId, nodeId },
    );
    const nodeOut = await outputPage(node.app);
    await main.win.evaluate(
      (pid) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'goLive',
          presentationId: pid,
          slideIndex: 0,
        }),
      id,
    );
    await expect(nodeOut.locator('[data-layer="slide"]')).toContainText('Placeholder on every screen');

    // The dashboard, from the status bar: both computers, each display with its picture.
    await main.win.setViewportSize({ width: 1280, height: 720 });
    await main.win.getByTestId('screens-summary').click();
    const dashboard = main.win.getByTestId('screens-dashboard');
    await expect(dashboard).toBeVisible();
    await expect(dashboard.getByTestId('dashboard-node')).toHaveCount(1);
    await expect(dashboard.getByTestId('dashboard-thumb')).toHaveCount(2, { timeout: 20_000 });
    const nodeCard = dashboard.getByTestId('dashboard-node');
    await expect(nodeCard.getByTestId('dashboard-node-online')).toHaveText('Online');
    await expect(nodeCard.getByTestId('node-latency')).toHaveText(/ms round trip$/u);
    await expect(nodeCard.getByTestId('node-clock-offset')).toHaveText(/ms off Main’s, corrected/u);
    await expect(nodeCard.getByTestId('node-media')).not.toHaveText('–');
    await expect(
      nodeCard.locator('[data-testid="dashboard-display"][data-screen]:not([data-screen=""])'),
    ).toHaveCount(1);
    await expect(nodeCard.getByTestId('dashboard-frames')).toHaveCount(1);
    await expectNoSeriousA11yIssues(main.win, 'the screens dashboard');

    // Identify the node's display: its output says which it is.
    await nodeCard
      .locator('[data-testid="dashboard-display"][data-screen]:not([data-screen=""])')
      .getByRole('button', { name: /^Identify/u })
      .click();
    // Its number among the node's displays and its screen's name, then the node and the group.
    await expect(nodeOut.getByTestId('identify-name')).toHaveText(/^2: /u);
    await expect(nodeOut.getByText(/· Placeholder Hall$/u)).toBeVisible();

    // Simple Mode: the dashboard still opens and Identify works; nothing that changes anything does.
    await dashboard.getByRole('button', { name: 'Close the dashboard' }).click();
    const refused = await main.win.evaluate(
      async ({ nodeId, groupId }) => {
        const d = (globalThis as PageGlobals).drashti;
        await d.app.setMode('simple');
        const screenId =
          (await d.screens.get()).groups.flatMap((g) => g.screens).find((s) => s.nodeId === nodeId)?.id ?? '';
        const answers = [
          await d.nodes.startPairing(),
          await d.nodes.cancelPairing(),
          await d.nodes.rename(nodeId, 'Placeholder renamed'),
          await d.nodes.everything(nodeId, true),
          await d.nodes.reload(nodeId, screenId),
          await d.nodes.remove(nodeId),
          await d.screens.assignNodeDisplay(groupId, nodeId, 0),
        ];
        await d.nodes.identify(nodeId, null);
        return answers;
      },
      { nodeId, groupId },
    );
    for (const r of refused) expect(r).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    await expect(main.win.getByTestId('simple-mode')).toBeVisible();
    await main.win.getByTestId('screens-summary').click();
    await expect(dashboard).toBeVisible();
    await expect(dashboard.getByRole('button', { name: /^Remove/u })).toHaveCount(0);
    await expect(dashboard.getByRole('button', { name: /^Reload/u })).toHaveCount(0);
    await expect(dashboard.getByRole('button', { name: 'Set up screens…' })).toHaveCount(0);
    await expect(dashboard.getByTestId('dashboard-node')).toHaveCount(1);
    await dashboard.getByRole('button', { name: 'Close the dashboard' }).click();

    // The node goes: the status bar says so at once (Simple Mode too), and the dashboard shows it offline.
    await node.app.close();
    nodeClosed = true;
    const warning = main.win.getByTestId('node-warning');
    await expect(warning).toContainText('offline since', { timeout: 20_000 });
    await warning.click();
    await expect(dashboard.getByTestId('dashboard-node-online')).toHaveText('Offline');
    await expect(dashboard.getByTestId('dashboard-warnings')).toContainText('offline since');
    await main.win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'));
    // Pairing again works in Pro Mode (a code is offered).
    expect(await nodeCode(main.win)).toMatch(/^\d{6}$/u);
  } finally {
    if (!nodeClosed) await node.app.close();
    await main.app.close();
  }
});
