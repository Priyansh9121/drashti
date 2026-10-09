import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { relaunchApp } from './helpers';
import { COMMON, launchMain, launchNode, nodesStatus, nodeWindow, pairNode } from './nodes';

/*
 * Small state files that cannot be read (Session 23): never taken for
 * missing, never written over, and never a question at start-up on a node,
 * which may have nobody at it.
 */

test('a node whose role file cannot be read starts as a node, with no question, and says what it chose', async () => {
  test.setTimeout(90_000);
  const first = await launchNode();
  const userData = first.userData;
  await first.app.close();
  const roleFile = join(userData, 'drashti-role.json');
  expect(JSON.parse(readFileSync(roleFile, 'utf8'))).toEqual({ role: 'node' });
  writeFileSync(roleFile, '{"role": "no');

  // Started again with nothing else saying what it is (no DRASHTI_ROLE), as a computer would be.
  const { app } = await relaunchApp(userData, { ...COMMON, DRASHTI_ROLE: '', DRASHTI_TEST_NO_WIZARD: '0' });
  const page = await nodeWindow(app);
  await expect(page.getByTestId('node-start-note')).toContainText('could not be read');
  await expect(page.getByTestId('node-start-note')).toContainText('started as a node');
  const log = readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8');
  // No question was asked (quiet test mode answers any dialog, and says so in the log).
  expect(log).not.toContain('Quiet test mode: answered');
  expect(log).toContain('Starting as a node');
  // The damaged file was kept aside, and the role it chose is kept.
  expect(readdirSync(userData).some((f) => f.startsWith('drashti-role.unreadable-'))).toBe(true);
  expect(JSON.parse(readFileSync(roleFile, 'utf8'))).toEqual({ role: 'node' });
  await app.close();
});

test('Main’s identity for its nodes cannot be read: kept aside, never remade by itself, and an admin makes a new one', async () => {
  test.setTimeout(120_000);
  const node = await launchNode();
  try {
    const main = await launchMain();
    await pairNode(main, node);
    const port = main.port;
    const userData = main.userData;
    await main.app.close();
    const identity = join(userData, 'node-link', 'identity.json');
    const text = readFileSync(identity, 'utf8');
    writeFileSync(identity, text.slice(0, 40));

    // Started again: the operator is told, nothing listens for nodes, and Screens says what to do.
    const again = await launchMain({}, { port, userData });
    await expect(
      again.win.getByRole('alert').filter({ hasText: 'identity for its nodes could not be read' }),
    ).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await nodesStatus(again.win)).identityProblem ?? '')
      .toContain('identity.unreadable-');
    expect((await nodesStatus(again.win)).state).not.toBe('listening');
    expect(readdirSync(join(userData, 'node-link')).some((f) => f.startsWith('identity.unreadable-'))).toBe(
      true,
    );
    expect(readdirSync(join(userData, 'node-link'))).not.toContain('identity.json');
    const log = readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8');
    expect(log).toContain('node-link/identity.json could not be read');
    await again.win.getByRole('button', { name: 'Screens', exact: true }).click();
    const hold = again.win.getByTestId('nodes-identity-problem');
    await expect(hold).toBeVisible();
    // An admin makes a new one: the link listens again (each node is then paired again).
    await hold.getByRole('button', { name: 'Make a new identity…' }).click();
    await again.win
      .getByTestId('nodes-new-identity-confirm')
      .getByRole('button', { name: 'Make a new identity' })
      .click();
    await expect(hold).toHaveCount(0);
    await expect.poll(async () => (await nodesStatus(again.win)).state).toBe('listening');
    expect(readdirSync(join(userData, 'node-link'))).toContain('identity.json');
    await again.app.close();
  } finally {
    await node.app.close();
  }
});
