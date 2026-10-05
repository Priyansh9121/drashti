import { expect, test } from '@playwright/test';
import { versionMismatch } from '../../src/shared/nodes';
import type { PageGlobals } from './helpers';
import { launchMain, launchNode, nodesStatus, nodeView, pairNode, typePairing, nodeCode } from './nodes';

/*
 * Output nodes, pairing and trust (Session 13): Main and a node as two
 * Drashti instances on this computer. The node pairs with the code Main
 * shows; removed on Main, it is cut off at once; a fake Main (another
 * certificate at Main's address) is refused; a node on another version is
 * refused, saying so on both sides. Codes and tokens are never printed.
 */

test('a node pairs with the code Main shows, and is cut off at once when removed on Main', async () => {
  test.setTimeout(120_000);
  const main = await launchMain();
  const node = await launchNode();
  try {
    // Before pairing: the node says so, and offers to pair.
    await expect(node.page.getByTestId('node-pair-form')).toBeVisible();
    expect((await nodeView(node.page)).paired).toBeNull();
    // A wrong code is refused, saying why (the right one still works afterwards).
    const code = await nodeCode(main.win);
    await typePairing(node.page, main.port, code === '000000' ? '111111' : '000000');
    await expect(node.page.getByTestId('node-pair-error')).toHaveText(
      'That code is wrong or has expired. Ask for a new code on Main.',
    );
    const nodeId = await pairNode(main, node);
    const view = await nodeView(node.page);
    expect(view.paired?.main.addresses[0]).toBe('127.0.0.1');
    expect(view.paired?.main.fingerprint).toBe((await nodesStatus(main.win)).fingerprint);
    // Main's Screens lists it, online.
    await main.win.getByRole('button', { name: 'Screens', exact: true }).click();
    const card = main.win.getByTestId('node-card');
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('node-online')).toHaveText('Online');

    // Removed on Main: cut off at once; the node forgets its pairing and says why.
    await card.getByRole('button', { name: 'Remove' }).click();
    await main.win.getByTestId('node-remove-confirm').getByRole('button', { name: 'Remove' }).click();
    await expect(main.win.getByTestId('node-card')).toHaveCount(0);
    await expect(node.page.getByTestId('node-pair-form')).toBeVisible({ timeout: 10_000 });
    await expect(
      node.page.getByText('This node was removed on Main. Pair it again to use it.'),
    ).toBeVisible();
    expect((await nodesStatus(main.win)).nodes.map((n) => n.id)).not.toContain(nodeId);
  } finally {
    await node.app.close();
    await main.app.close();
  }
});

test('a fake Main (another certificate at Main’s address) is refused', async () => {
  test.setTimeout(120_000);
  const main = await launchMain();
  const node = await launchNode();
  try {
    await pairNode(main, node);
    // Main goes; another Drashti (its own certificate) answers at the same address and port.
    await main.app.close();
    const fake = await launchMain({}, { port: main.port });
    try {
      // It has a node paired of its own, so it listens; nobody it does not know gets in either way.
      await nodeCode(fake.win);
      await expect(node.page.getByTestId('node-link-state')).toHaveText('Refused', { timeout: 20_000 });
      await expect(node.page.getByTestId('node-link-why')).toContainText(
        'is not the Main this node paired with (its certificate is different), so it is refused.',
      );
      expect((await nodesStatus(fake.win)).nodes).toEqual([]);
    } finally {
      await fake.app.close();
    }
  } finally {
    await node.app.close();
  }
});

test('a node on another version of Drashti is refused, saying so on both sides', async () => {
  test.setTimeout(150_000);
  const main = await launchMain({ DRASHTI_TEST_VERSION: '1.0.0-test.1' });
  // Pairing is refused at once.
  const other = await launchNode({ DRASHTI_TEST_VERSION: '1.0.0-test.2' });
  try {
    await typePairing(other.page, main.port, await nodeCode(main.win));
    await expect(other.page.getByTestId('node-pair-error')).toHaveText(
      versionMismatch('1.0.0-test.1', '1.0.0-test.2'),
    );
  } finally {
    await other.app.close();
  }
  // Paired on the same version, then started on another: refused on the feed, on both sides.
  const node = await launchNode({ DRASHTI_TEST_VERSION: '1.0.0-test.1' });
  try {
    const nodeId = await pairNode(main, node);
    await node.app.close();
    const updated = await launchNode({ DRASHTI_TEST_VERSION: '1.0.0-test.3' }, node.userData);
    try {
      await expect(updated.page.getByTestId('node-link-state')).toHaveText('Refused', { timeout: 20_000 });
      await expect(updated.page.getByTestId('node-link-why')).toHaveText(
        versionMismatch('1.0.0-test.1', '1.0.0-test.3'),
      );
      await expect
        .poll(async () => (await nodesStatus(main.win)).nodes.find((n) => n.id === nodeId)?.versionRefused)
        .toBe('1.0.0-test.3');
      await main.win.getByRole('button', { name: 'Screens', exact: true }).click();
      await expect(main.win.getByTestId('node-version-refused')).toContainText(
        'This node runs Drashti 1.0.0-test.3, and this computer runs 1.0.0-test.1.',
      );
      // Session 14: Main says it needs updating, and how; the node offers to match Main.
      await expect(main.win.getByTestId('node-version-refused')).toContainText(
        'It needs updating: on the node, press Update to Drashti 1.0.0-test.1',
      );
      await expect(updated.page.getByTestId('node-update')).toContainText(
        'Main runs Drashti 1.0.0-test.1; this node runs 1.0.0-test.3',
      );
      expect(
        await main.win.evaluate(
          async () => (await (globalThis as PageGlobals).drashti.nodes.status()).nodes[0]?.online,
        ),
      ).toBe(false);
    } finally {
      await updated.app.close();
    }
  } finally {
    await main.app.close();
  }
});
