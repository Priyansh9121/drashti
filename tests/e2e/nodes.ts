import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NodeView } from '../../src/shared/nodes';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, relaunchApp, windowShowing } from './helpers';
import { freePort } from './stream-helpers';

/*
 * Main and its output nodes in the end-to-end tests (Session 13): two
 * Drashti instances on this computer, each with its own data folder. The
 * node link listens on this computer only, on a free port; outputs are
 * windows (each instance has one pretend extra display). Codes and tokens
 * are made at run time and never printed.
 */

/** Both instances: outputs as windows, one extra pretend display, the network on this computer only. */
export const COMMON = {
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
  const page = await windowShowing(app, isNode, 'node');
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
  // A link that does not listen says why (alpha.20.1's full rerun, CI's Windows: "failed" for 20 s, its reason unseen).
  await expect
    .poll(async () => {
      const s = await nodesStatus(win);
      return s.state === 'failed' ? `failed: ${s.message ?? '(no message)'}` : s.state;
    })
    .toBe('listening');
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
  let code: string;
  try {
    code = await nodeCode(main.win);
  } catch (error) {
    // With Main's own lines about its link (its warnings and the worker's own output), then the same failure.
    console.log(`Main's node link, from its log:\n${linkTrouble(main.userData).join('\n') || '(none)'}`);
    if (process.platform === 'win32')
      console.log(`What holds port ${String(main.port)}:\n${portHolders(main.port)}`);
    throw error;
  }
  await typePairing(node.page, main.port, code);
  await expect(node.page.getByTestId('node-link-state')).toHaveText('Online', { timeout: 20_000 });
  await expect
    .poll(async () => (await nodesStatus(main.win)).nodes.find((n) => n.online)?.id ?? '')
    .not.toBe('');
  return (await nodesStatus(main.win)).nodes[0]?.id ?? '';
}

export function nodesStatus(win: Page) {
  return win.evaluate(() => (globalThis as PageGlobals).drashti.nodes.status());
}

/**
 * On Windows, for a link that did not listen: what holds its port now (netstat, and each holder's program), and the
 * ports Windows keeps back from programs (its excluded ranges) and hands out itself (its dynamic range).
 */
function portHolders(port: number): string {
  const run = (cmd: string, args: string[]) => {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8', timeout: 20_000, windowsHide: true });
    } catch (error) {
      return `(${cmd} failed: ${(error as Error).message})`;
    }
  };
  const held = run('netstat', ['-ano'])
    .split(/\r?\n/u)
    .filter((l) => l.includes(`:${String(port)} `));
  const pids = [...new Set(held.map((l) => l.trim().split(/\s+/u).at(-1) ?? ''))].filter((p) =>
    /^\d+$/u.test(p),
  );
  const who = pids.map((pid) => run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']).trim());
  const kept = run('netsh', ['int', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp']);
  const range = run('netsh', ['int', 'ipv4', 'show', 'dynamicport', 'tcp']);
  return [...(held.length ? held : ['(netstat: nothing on it)']), ...who, kept, range].join('\n');
}

/** Main's log lines about its node link not listening or stopping (none carries a code or a token), oldest first. */
function linkTrouble(userData: string): string[] {
  const dir = join(userData, 'logs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^drashti(\.\d+)?\.log$/u.test(f))
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n'))
    .filter((l) => /Nodes:|node link/u.test(l))
    .sort();
}

/**
 * An instance's log lines about the link and media copies, oldest first, each marked with whose
 * they are (for a failing test's diagnostics). None of them carries a code or a token.
 */
export function linkLog(userData: string, who: string): string[] {
  const dir = join(userData, 'logs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^drashti(\.\d+)?\.log$/u.test(f))
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n'))
    .filter((l) => /Media copies|Node: link|Nodes: .*(connected|disconnected|listening)/u.test(l))
    .sort()
    .map((l) => `${who} ${l}`);
}
