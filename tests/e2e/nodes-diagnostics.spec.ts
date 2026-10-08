import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OutputGlobals, PageGlobals } from './helpers';
import { chooseMenuItem, needsRealScreen, outputPage, QUIET } from './helpers';
import { COMMON, launchMain, launchNode, pairNode, type MainRun, type NodeRun } from './nodes';

/*
 * A node's diagnostics (Session 17): Help > Save Diagnostics… writes one
 * file to the Desktop as on Main, without the library's parts, and the
 * node's own watchdog self-test proves its screens keep their picture while
 * its window crashes or reloads and come back from a crash showing Main's
 * live slide. Playwright cannot stay attached to a renderer that crashes,
 * so the self-test runs as the node's own headless self-test
 * (DRASHTI_SELFTEST=node-watchdog), with the node's data folder (its
 * pairing) and Main still running under the test. Placeholder words only.
 */

interface SelfTestResult {
  passed: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

/** Main and a paired node, a node display in a group of its own, and a slide of words up. */
async function nodeShowing(): Promise<{ main: MainRun; node: NodeRun; output: Page }> {
  const main = await launchMain();
  const node = await launchNode();
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
  const assigned = await main.win.evaluate(
    async ({ nodeId, displayId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.screens.createGroup('Lobby');
      if (!made.ok) throw new Error(made.message);
      const groupId = made.snapshot.groups.find((g) => g.name === 'Lobby')?.id ?? '';
      const r = await d.screens.assignNodeDisplay(groupId, nodeId, displayId);
      const first = (await d.library.listPresentations())[0]?.id ?? '';
      await d.engine.dispatch({ type: 'goLive', presentationId: first, slideIndex: 0 });
      return r.ok;
    },
    { nodeId, displayId: (await displays())[1] ?? -1 },
  );
  expect(assigned).toBe(true);
  const output = await outputPage(node.app);
  // The node's screen has painted Main's slide.
  await expect
    .poll(() =>
      output.evaluate(() => ((globalThis as OutputGlobals).drashtiPaintLog ?? []).at(-1)?.rev ?? -1),
    )
    .toBeGreaterThan(0);
  return { main, node, output };
}

test("a node's Save Diagnostics writes the link, its screens and its copies, and no token", async () => {
  const { main, node } = await nodeShowing();
  try {
    const desktop = mkdtempSync(join(tmpdir(), 'drashti-node-desktop-'));
    await node.app.evaluate(({ app }, dir) => {
      app.setPath('desktop', dir);
    }, desktop);
    await chooseMenuItem(node.app, 'save-diagnostics');
    await expect(node.page.getByTestId('node-notice')).toContainText('Diagnostics saved on the Desktop');
    const [file] = readdirSync(desktop);
    expect(file).toMatch(/^Drashti diagnostics \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.txt$/u);
    const text = readFileSync(join(desktop, file ?? ''), 'utf8');
    expect(text).toContain('== Drashti diagnostics (node) ==');
    expect(text).toContain('== Displays ==');
    expect(text).toMatch(/Follows Main ".+" at 127\.0\.0\.1 port \d+, paired /u);
    expect(text).toContain('Link: online since');
    expect(text).toMatch(/Clock: Main's is [+-]?\d+ ms from this computer's/u);
    expect(text).toContain('Group "Lobby" (audience):');
    expect(text).toMatch(/: canvas \d+×\d+ \w+, on, showing on /u);
    expect(text).toMatch(/\d+ of \d+ files ready/u);
    expect(text).toContain('== Watchdog (this run) ==');
    expect(text).toContain('Node: link online');
    // No library part, and never the node's own key to Main or where its files are.
    expect(text).not.toContain('== Library');
    expect(text).not.toContain('== Recent imports');
    const token = (JSON.parse(readFileSync(join(node.userData, 'node.json'), 'utf8')) as { token: string })
      .token;
    expect(token.length).toBeGreaterThan(19);
    expect(text).not.toContain(token);
    expect(text).not.toContain(homedir());
  } finally {
    await node.app.close();
    await main.app.close();
  }
});

/** The node's own watchdog self-test, headless, with its data folder (and so its pairing). */
function runNodeSelfTest(
  userData: string,
): Promise<{ code: number | null; result: SelfTestResult | null; log: string }> {
  const electron = createRequire(__filename)('electron') as string;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, COMMON, {
    DRASHTI_USER_DATA_DIR: userData,
    DRASHTI_SELFTEST: 'node-watchdog',
    DRASHTI_NO_QUIT_CONFIRM: '1',
    DRASHTI_TEST_NO_WIZARD: '1',
    DRASHTI_TEST_QUIET: QUIET ? '1' : '0',
  });
  return new Promise((resolve) => {
    const child = spawn(electron, ['.'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d: Buffer) => (log += d.toString()));
    child.stderr.on('data', (d: Buffer) => (log += d.toString()));
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const line = log.split('\n').find((l) => l.startsWith('DRASHTI_SELFTEST_RESULT '));
      resolve({
        code,
        result: line ? (JSON.parse(line.slice('DRASHTI_SELFTEST_RESULT '.length)) as SelfTestResult) : null,
        log,
      });
    });
  });
}

test("a node's watchdog self-test: its window crashes and reloads under a steady screen, a crashed output comes back", async () => {
  needsRealScreen();
  test.setTimeout(240_000);
  const { main, node } = await nodeShowing();
  try {
    // The node as an admin starts it for the self-test: the same data folder, nothing attached.
    await node.app.close();
    const { code, result, log } = await runNodeSelfTest(node.userData);
    expect(result, log.slice(-3000)).not.toBeNull();
    for (const c of result?.checks ?? []) expect.soft(c.ok, `${c.name} ${c.detail}`).toBe(true);
    expect(result?.checks.map((c) => c.name)).toEqual([
      'the node follows Main',
      'an output window is open',
      "the output shows Main's live slide",
      'the output shows something',
      "while the node's window is crashed, the output keeps the same frame",
      "the watchdog reloads the node's window",
      "the reloaded node's window works",
      'the output was never reloaded or redrawn',
      "while the node's window reloads, the output keeps the same frame",
      "the node's window comes back after a reload",
      'the watchdog reloads a crashed output',
      "the reloaded output shows Main's live slide again",
      'the node still follows Main',
    ]);
    expect(result?.passed).toBe(true);
    expect(code).toBe(0);
    test.info().annotations.push({
      type: 'self-test',
      description: (result?.checks ?? []).map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('; '),
    });
  } finally {
    await main.app.close();
  }
});
