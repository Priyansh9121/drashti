import { expect, test } from '@playwright/test';
import type { OutputGlobals, PageGlobals } from './helpers';
import { outputPage } from './helpers';
import { launchMain, launchNode, pairNode } from './nodes';

/*
 * A node's screen that its watchdog gave up on (Sessions 31–36): before, the node never said so, and Main's
 * dashboard showed it as Showing while it was black. Now the node reports it Stopped; Main's dashboard says
 * so, the stopped-screen notice names it, and Try again (the dashboard's or the notice's) has the node's
 * watchdog try it again. A test hook on the node (DRASHTI_TEST_GIVE_UP, ignored by a packaged Drashti)
 * marks the output as given up on, as a crash loop would. Placeholder words only.
 */

interface Globals {
  drashtiTestGiveUp?: (screenId: string) => void;
}

test("a node's screen given up on is Stopped on Main's dashboard, named in the notice, and Try again brings it back", async () => {
  test.setTimeout(150_000);
  const main = await launchMain();
  const node = await launchNode({ DRASHTI_TEST_GIVE_UP: '1' });
  try {
    const nodeId = await pairNode(main, node);
    const displays = async () =>
      main.win.evaluate(
        async (id) =>
          (
            (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((n) => n.id === id)
              ?.displays ?? []
          ).map((d) => d.id),
        nodeId,
      );
    await expect.poll(async () => (await displays()).length).toBeGreaterThanOrEqual(2);
    const screenId = await main.win.evaluate(
      async ({ nodeId, displayId }) => {
        const d = (globalThis as PageGlobals).drashti;
        const made = await d.screens.createGroup('Lobby');
        if (!made.ok) throw new Error(made.message);
        const groupId = made.snapshot.groups.find((g) => g.name === 'Lobby')?.id ?? '';
        const r = await d.screens.assignNodeDisplay(groupId, nodeId, displayId);
        if (!r.ok) throw new Error(r.message);
        const first = (await d.library.listPresentations())[0]?.id ?? '';
        await d.engine.dispatch({ type: 'goLive', presentationId: first, slideIndex: 0 });
        return r.snapshot.groups.find((g) => g.id === groupId)?.screens[0]?.id ?? '';
      },
      { nodeId, displayId: (await displays())[1] ?? -1 },
    );
    expect(screenId).not.toBe('');
    const output = await outputPage(node.app);
    await expect
      .poll(() =>
        output.evaluate(() => ((globalThis as OutputGlobals).drashtiPaintLog ?? []).at(-1)?.rev ?? -1),
      )
      .toBeGreaterThan(0);
    const state = () =>
      main.win.evaluate(
        async (id) =>
          (await (globalThis as PageGlobals).drashti.screens.get()).status.find((st) => st.screenId === id)
            ?.state,
        screenId,
      );
    await expect.poll(state).toBe('showing');

    // The node gives up on its output, as a crash loop would: Main hears of it within a report or two.
    await node.app.evaluate((_electron, id) => {
      (globalThis as unknown as Globals).drashtiTestGiveUp?.(id);
    }, screenId);
    await expect.poll(state, { timeout: 10_000 }).toBe('stopped');

    // The notice names it, as it names Main's own.
    const name = await main.win.evaluate(
      async (id) =>
        (await (globalThis as PageGlobals).drashti.screens.get()).groups
          .flatMap((g) => g.screens)
          .find((sc) => sc.id === id)?.name ?? '',
      screenId,
    );
    expect(name).not.toBe('');
    const notice = main.win.getByTestId('screen-stopped-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(`“${name}” has stopped`);
    // The dashboard says Stopped, with Try again.
    await main.win.getByTestId('screens-summary').click();
    const dashboard = main.win.getByTestId('screens-dashboard');
    await expect(dashboard).toBeVisible();
    const card = dashboard
      .getByTestId('dashboard-node')
      .locator(`[data-testid="dashboard-display"][data-screen="${screenId}"]`);
    await expect(card.getByTestId('dashboard-state')).toHaveText('Stopped');
    await card.getByRole('button', { name: /^Try again/u }).click();
    // The node's watchdog tries it again: Showing on Main, and the notice goes by itself.
    await expect.poll(state, { timeout: 20_000 }).toBe('showing');
    await expect(card.getByTestId('dashboard-state')).toHaveText('Showing');
    await expect(notice).toHaveCount(0);
  } finally {
    await node.app.close();
    await main.app.close();
  }
});
