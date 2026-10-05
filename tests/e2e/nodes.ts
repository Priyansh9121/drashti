import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { NodeView } from '../../src/shared/nodes';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, relaunchApp } from './helpers';
import { freePort } from './stream-helpers';

/*
 * Main and its output nodes in the end-to-end tests (Session 13): two
 * Drashti instances on this computer, each with its own data folder. The
 * node link listens on this computer only, on a free port; outputs are
 * windows (each instance has one pretend extra display). Codes and tokens
 * are made at run time and never printed.
 */

/** Both instances: outputs as windows, one extra pretend display, the network on this computer only. */
const COMMON = {
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_EXTRA_DISPLAYS: '1',
  DRASHTI_TEST_NETWORK_LOCAL: '1',
};

export interface MainRun {
  app: ElectronApplication;
  win: Page;
  userData: string;
  port: number;
}

/** Drashti as Main, its node link on a free port (or the one given). */
export async function launchMain(
  extra: Record<string, string> = {},
  options: { port?: number; userData?: string } = {},
): Promise<MainRun> {
  const port = options.port ?? (await freePort());
  const env = { ...COMMON, DRASHTI_NODE_PORT: String(port), ...extra };
  const { app, userData } = options.userData
    ? await relaunchApp(options.userData, env)
    : await launchApp(env);
  const win = await operatorPage(app);
  await operatorReady(win);
  return { app, win, userData, port };
}

export interface NodeRun {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

/** The node's own window. */
export async function nodeWindow(app: ElectronApplication): Promise<Page> {
  const isNode = (p: Page) => p.url().includes('node.html');
  const existing = app.windows().find(isNode);
  const page = existing ?? (await app.waitForEvent('window', { predicate: isNode }));
  await expect(page.getByTestId('node-window')).toBeVisible();
  return page;
}

/** Drashti as a node (its own data folder, or the one given to start it again). */
export async function launchNode(extra: Record<string, string> = {}, userData?: string): Promise<NodeRun> {
  const env = { ...COMMON, DRASHTI_ROLE: 'node', ...extra };
  const run = userData ? await relaunchApp(userData, env) : await launchApp(env);
  return { app: run.app, page: await nodeWindow(run.app), userData: run.userData };
}

/** What the node's window shows (through its bridge). */
export function nodeView(page: Page): Promise<NodeView> {
  return page.evaluate(() => (globalThis as PageGlobals).drashti.node.view());
}

/** A code from Main for a node (never printed), once Main's link listens for nodes. */
export async function nodeCode(win: Page): Promise<string> {
  const code = await win.evaluate(async () => {
    const r = await (globalThis as PageGlobals).drashti.nodes.startPairing();
    if (!r.ok || !r.status.pairing) throw new Error(r.ok ? 'no code' : r.message);
    return r.status.pairing.code;
  });
  await expect.poll(async () => (await nodesStatus(win)).state).toBe('listening');
  return code;
}

/** Type Main's address and a code in the node's window, as a person would. */
export async function typePairing(page: Page, port: number, code: string): Promise<void> {
  const form = page.getByTestId('node-pair-form');
  await form.getByLabel('Main’s address').fill(`127.0.0.1:${port}`);
  await form.getByLabel('Code').fill(code);
  await form.getByRole('button', { name: 'Pair with Main' }).click();
}

/** Pair the node with Main and wait until it is online on both sides. Returns the node's id on Main. */
export async function pairNode(main: MainRun, node: NodeRun): Promise<string> {
  await typePairing(node.page, main.port, await nodeCode(main.win));
  await expect(node.page.getByTestId('node-link-state')).toHaveText('Online', { timeout: 20_000 });
  await expect
    .poll(async () => (await nodesStatus(main.win)).nodes.find((n) => n.online)?.id ?? '')
    .not.toBe('');
  return (await nodesStatus(main.win)).nodes[0]?.id ?? '';
}

export function nodesStatus(win: Page) {
  return win.evaluate(() => (globalThis as PageGlobals).drashti.nodes.status());
}
