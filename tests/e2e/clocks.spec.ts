import { expect, test } from '@playwright/test';
import { outputPage, type PageGlobals } from './helpers';
import { launchMain, launchNode, pairNode } from './nodes';

/*
 * Clocks in Main's time (Sessions 31–36, I18N-8): Main's locale and time zone go to every output, node and
 * the stream's page, so a node in another time zone shows Main's time on its stage screen, not its own.
 * Main stands in Pacific/Chatham (a quarter-hour zone no runner is in) by a tests-only switch.
 */

const MAIN_STYLE = { locale: 'en-GB', timeZone: 'Pacific/Chatham' };

/** The time as Main writes it now, as the stage clock writes it. */
const mainTime = () =>
  new Date().toLocaleTimeString(MAIN_STYLE.locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: MAIN_STYLE.timeZone,
  });
/** The time as the computer running the tests writes it in its own zone. */
const ownTime = () =>
  new Date().toLocaleTimeString(MAIN_STYLE.locale, { hour: 'numeric', minute: '2-digit' });

test('a node in another time zone shows Main’s time on its stage screen', async () => {
  test.setTimeout(180_000);
  const main = await launchMain({ DRASHTI_TEST_CLOCK_STYLE: `${MAIN_STYLE.locale} ${MAIN_STYLE.timeZone}` });
  const node = await launchNode();
  try {
    // The computer running the tests is not in Main's zone, or the check would prove nothing.
    expect(ownTime()).not.toBe(mainTime());
    const nodeId = await pairNode(main, node);
    // A stage group on Main, given the node's second (pretend) display.
    const groupId = await main.win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.screens.createGroup('Placeholder Stage');
      if (!made.ok) throw new Error(made.message);
      const id = made.snapshot.groups.find((g) => g.name === 'Placeholder Stage')?.id ?? '';
      const role = await d.screens.setGroupRole(id, 'stage');
      if (!role.ok) throw new Error(role.message);
      return id;
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
    await expect(nodeOut.getByTestId('output-root')).toHaveAttribute('data-role', 'stage');
    // Main's time, read again across a minute's turn.
    await expect
      .poll(async () => (await nodeOut.getByTestId('stage-clock').textContent()) === mainTime())
      .toBe(true);
  } finally {
    await node.app.close();
    await main.app.close();
  }
});
