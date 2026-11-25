import { expect, test } from '@playwright/test';
import { TEST_LINES } from '../../src/main/db/seed';
import type { ScreenStatus } from '../../src/shared/screens';
import {
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  setUpScreen,
  type OutputGlobals,
  type PageGlobals,
} from './helpers';
import { launchMain, launchNode, pairNode } from './nodes';

/*
 * HELD FOR THE OWNER (QA23-HEARTBEAT-1, option A; a23-heartbeat, review SA4). An output whose page does not answer is
 * restarted by the heartbeat; from the 4th restart in a row Screens and the status line say it keeps restarting, and
 * the next time, if it has not drawn the show since its last restart, it is kept as it is and Stopped. It is back by
 * itself once it draws the show, and Try again starts afresh. On Main and on a node. A test switch
 * (DRASHTI_TEST_HEARTBEAT_FAST, ignored by a packaged Drashti) shortens the graces to 3 s, then 6 s, and drops an
 * output's reports while a test asks (drashtiTestHeartbeatDeaf), as a page that does not answer sends none. The
 * restarts crash the output's renderer: its page is never used after that. Placeholder words only.
 */

interface Globals {
  drashtiTestHeartbeatDeaf?: (screenId: string, on: boolean) => void;
  drashtiDiagnostics: { watchdog: { events: { window: string; kind: string; reason?: string }[] } };
}

type App = Awaited<ReturnType<typeof launchApp>>['app'];

/** The output's watchdog events, as "kind reason". */
const outputEvents = (app: App) =>
  app.evaluate(() =>
    (globalThis as unknown as Globals).drashtiDiagnostics.watchdog.events
      .filter((e) => e.window.startsWith('output'))
      .map((e) => `${e.kind} ${e.reason ?? ''}`.trim()),
  );

/** Its reports dropped (a page that does not answer), or not. */
const deaf = (app: App, screenId: string, on: boolean) =>
  app.evaluate(
    (_electron, { screenId, on }) => {
      (globalThis as unknown as Globals).drashtiTestHeartbeatDeaf?.(screenId, on);
    },
    { screenId, on },
  );

const restarts = (events: string[]) => events.filter((e) => e.startsWith('restarted')).length;

test('held for the owner (QA23-HEARTBEAT-1, A): an output that does not answer is said to keep restarting, then kept as it is and Stopped; back by itself once it draws; Try again starts afresh', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_TEST_HEARTBEAT_FAST: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const screenId = await setUpScreen(win);
    const out = await outputPage(app);
    await outputReady(out);
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const list = await d.library.listPresentations();
      const id = list.find((p) => p.name === 'Language test slides')?.id ?? '';
      await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: 0 });
    });
    await expect(out.locator('[data-lang="en"]')).toHaveText(TEST_LINES.en);
    const status = () =>
      win.evaluate(
        async (id): Promise<ScreenStatus | undefined> =>
          (await (globalThis as PageGlobals).drashti.screens.get()).status.find((s) => s.screenId === id),
        screenId,
      );

    // It stops answering: restarted again and again, and from the 4th time in a row said so.
    await deaf(app, screenId, true);
    await expect.poll(async () => (await status())?.restarts, { timeout: 120_000 }).toBe(4);
    await expect(win.getByTestId('screens-summary')).toContainText('1 keeps restarting');
    // Not drawing after that reload either: kept as it is, not restarted, Stopped, and its notice says why.
    await expect.poll(async () => (await status())?.state, { timeout: 30_000 }).toBe('stopped');
    expect((await status())?.notAnswering).toBe(true);
    await expect(win.getByTestId('screen-stopped-notice')).toContainText(
      'stopped answering after 4 restarts in a row',
    );
    const kept = await outputEvents(app);
    expect(restarts(kept)).toBe(4);
    expect(kept.at(-1)).toMatch(/^gave-up stuck again \(no report for \d+ s\) after 4 restarts in a row$/u);

    // It answers again: back by itself, Showing, with no reload and no try.
    await deaf(app, screenId, false);
    await expect.poll(async () => (await status())?.state, { timeout: 20_000 }).toBe('showing');
    const backAt = (await outputEvents(app)).length;
    expect(
      (await outputEvents(app)).slice(kept.length).filter((e) => /^(reloaded|retried|restarted)/u.test(e)),
    ).toEqual([]);

    // It stops again: it drew since its last restart, so it is restarted (review SA1); after that reload, kept again.
    await deaf(app, screenId, true);
    await expect.poll(async () => (await status())?.state, { timeout: 60_000 }).toBe('stopped');
    expect(restarts((await outputEvents(app)).slice(backAt))).toBe(1);
    expect((await status())?.notAnswering).toBe(true);

    // Try again, on its notice: tried afresh, and nothing of the restarts is said any more.
    await win.getByTestId('screen-stopped-try-again').click();
    await deaf(app, screenId, false);
    await expect.poll(async () => (await status())?.state, { timeout: 30_000 }).toBe('showing');
    const after = await status();
    expect(after?.restarts).toBeUndefined();
    expect(after?.notAnswering).toBeUndefined();
    expect(await outputEvents(app)).toContain('retried Try again');
    await expect(win.getByTestId('screens-summary')).not.toContainText('restarting');
  } finally {
    await app.close();
  }
});

test("held for the owner (QA23-HEARTBEAT-1, A): a node's output that does not answer is said to keep restarting and kept as it is on Main; tried again and still silent, the node judges it again (review MA1)", async () => {
  test.setTimeout(240_000);
  const main = await launchMain();
  const node = await launchNode({ DRASHTI_TEST_HEARTBEAT_FAST: '1' });
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
    await outputReady(output);
    await expect
      .poll(() =>
        output.evaluate(() => ((globalThis as OutputGlobals).drashtiPaintLog ?? []).at(-1)?.rev ?? -1),
      )
      .toBeGreaterThan(0);
    const status = () =>
      main.win.evaluate(
        async (id): Promise<ScreenStatus | undefined> =>
          (await (globalThis as PageGlobals).drashti.screens.get()).status.find((st) => st.screenId === id),
        screenId,
      );
    await expect.poll(async () => (await status())?.state).toBe('showing');

    // It stops answering on the node: Main says it keeps restarting, then Stopped, kept as it is.
    await deaf(node.app, screenId, true);
    await expect.poll(async () => (await status())?.restarts, { timeout: 120_000 }).toBe(4);
    await expect(main.win.getByTestId('screens-summary')).toContainText('1 keeps restarting');
    await expect.poll(async () => (await status())?.state, { timeout: 30_000 }).toBe('stopped');
    expect((await status())?.notAnswering).toBe(true);
    await expect(main.win.getByTestId('screen-stopped-notice')).toContainText(
      'stopped answering after 4 restarts in a row',
    );
    expect(restarts(await outputEvents(node.app))).toBe(4);

    // Try again on Main's dashboard while it is still silent: the node tries it, and since it is still Stopped (no
    // report), the node judges it as Main does and restarts it again (review MA1).
    const tried = (await outputEvents(node.app)).length;
    await main.win.getByTestId('screens-summary').click();
    const card = main.win
      .getByTestId('screens-dashboard')
      .getByTestId('dashboard-node')
      .locator(`[data-testid="dashboard-display"][data-screen="${screenId}"]`);
    await expect(card.getByTestId('dashboard-state')).toHaveText('Stopped');
    await card.getByRole('button', { name: /^Try again/u }).click();
    await expect
      .poll(async () => (await outputEvents(node.app)).slice(tried), { timeout: 30_000 })
      .toEqual(expect.arrayContaining(['retried Try again on Main', expect.stringMatching(/^restarted/u)]));
    expect((await status())?.notAnswering).toBeUndefined();

    // It answers again: Showing on Main.
    await deaf(node.app, screenId, false);
    await expect.poll(async () => (await status())?.state, { timeout: 30_000 }).toBe('showing');
  } finally {
    await node.app.close();
    await main.app.close();
  }
});
