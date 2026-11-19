import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import type { PageGlobals } from './helpers';
import { importAndGetIds, outputPage, outputReady, setUpScreen } from './helpers';
import { launchMain, launchNode, nodesStatus, pairNode } from './nodes';

// Two separate data folders, localhost only; placeholder text. Pairing stays in the existing helper,
// which creates credentials at run time and never prints them.
test('an explicitly enabled second computer shares Main’s live and next view; a link drop never changes Main’s screens', async () => {
  test.setTimeout(180_000);
  const main = await launchMain();
  const node = await launchNode();
  try {
    const nodeId = await pairNode(main, node);
    await expect(node.page.getByTestId('controller-view')).toHaveCount(0);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-controller-'));
    const words = join(dir, 'Placeholder Shared Show.txt');
    writeFileSync(words, '[Verse]\nPlaceholder shared first\n\n[Chorus]\nPlaceholder shared second\n\n[Bridge]\nPlaceholder shared third\n');
    const [id = ''] = await importAndGetIds(main.win, [words]);
    await setUpScreen(main.win, 'Placeholder Hall', 1);
    const output = await outputPage(main.app);
    await outputReady(output);
    await main.win.evaluate((pid) => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'goLive', presentationId: pid, slideIndex: 0 }), id);
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder shared first');
    await main.win.getByRole('button', { name: 'Screens', exact: true }).click();
    const card = main.win.getByTestId('node-card').filter({ has: main.win.locator(`[data-node="${nodeId}"]`) });
    // There is exactly one paired computer; scope the permission control to its card.
    const permission = main.win.locator(`[data-testid="node-card"][data-node="${nodeId}"]`).getByRole('checkbox', { name: 'Shared show view' });
    await expect(permission).not.toBeChecked();
    await permission.check();
    const view = node.page.getByTestId('controller-view');
    await expect(view).toBeVisible();
    await expect(view.getByTestId('controller-status')).toHaveText('Connected to Main');
    await expect(view.getByTestId('controller-live')).toContainText('Placeholder shared first');
    await expect(view.getByTestId('controller-next')).toContainText('Placeholder shared second');
    await expect(view.getByRole('button')).toHaveCount(0);
    const before = await main.win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
    // Drop just the node socket: Main and its output remain running.
    await node.app.evaluate(() => { (globalThis as { drashtiNode?: { dropLink(): void } }).drashtiNode?.dropLink(); });
    await expect(view.getByTestId('controller-status')).toHaveText('Not connected');
    await expect(view.getByTestId('controller-live')).toContainText('Placeholder shared first');
    const after = await main.win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
    expect(after.rev).toBe(before.rev);
    expect(after.state).toEqual(before.state);
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder shared first');
    await main.win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'next' }));
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder shared second');
    await expect(view.getByTestId('controller-status')).toHaveText('Connected to Main');
    await expect(view.getByTestId('controller-live')).toContainText('Placeholder shared second');
    await expect(view.getByTestId('controller-next')).toContainText('Placeholder shared third');
    const rev = await main.win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).rev);
    await expect(view).toHaveAttribute('data-rev', String(rev));
    // Switching it off removes the shared view without clearing Main or its output.
    await permission.uncheck();
    await expect(view).toHaveCount(0);
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder shared second');
    expect((await nodesStatus(main.win)).nodes[0]?.controller).toBe(false);
    // Main alone owns this permission, and Simple Mode refuses changing it.
    await main.win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    expect(await main.win.evaluate((nid) => (globalThis as PageGlobals).drashti.nodes.setController(nid, true), nodeId)).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    void card;
  } finally {
    await node.app.close();
    await main.app.close();
  }
});
