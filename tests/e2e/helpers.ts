import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { _electron as electron, expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DrashtiBridge } from '../../src/shared/bridge';

/** Globals inside our pages, for code passed to page.evaluate(). */
export type PageGlobals = typeof globalThis & { drashti: DrashtiBridge };

/** Globals inside an output window: its history of painted engine revisions. */
export type OutputGlobals = typeof globalThis & {
  drashtiPaintLog?: { rev: number; sentAt: number; paintedAt: number; wallAt: number }[];
  /** Frames that came late since the page loaded. */
  drashtiLateFrames?: number;
};

/**
 * Local runs are quiet: the app never becomes the active app or covers the
 * screen of whoever is using the computer (src/main/windows/quiet.ts). CI
 * runs it as an operator would, unless DRASHTI_E2E_QUIET=1 (to check the
 * quiet mode itself: scripts/quiet-check.mjs). DRASHTI_E2E_LOUD=1 runs
 * locally as CI does, only when the person at the computer has agreed to it.
 */
export const QUIET =
  process.env['DRASHTI_E2E_LOUD'] !== '1' &&
  (process.env['CI'] === undefined || process.env['DRASHTI_E2E_QUIET'] === '1');

/**
 * For a test that needs real focus, a real full-screen output or a whole
 * display: it runs on CI, and is skipped in quiet local runs.
 */
export function needsRealScreen(): void {
  test.skip(QUIET, 'Needs real focus or a full-screen output: runs on CI (or with DRASHTI_E2E_LOUD=1)');
}

/**
 * Environment for the app under test. ELECTRON_RUN_AS_NODE is removed because
 * some parents (for example VS Code's extension host) set it, and it would
 * start Electron as plain Node.
 */
function appEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  }
  return { ...env, ...extra };
}

/**
 * Launch the built app (out/), with a fresh data folder unless one is given (to test restarts).
 * The setup wizard, which opens by itself on a first start, stays shut unless a test asks for it
 * (DRASHTI_TEST_NO_WIZARD: '0'), and Drashti starts as Main without asking (DRASHTI_ROLE). Quiet
 * locally (see QUIET).
 */
export async function launchApp(
  extraEnv: Record<string, string> = {},
  userDataDir?: string,
): Promise<{ app: ElectronApplication; userData: string }> {
  const userData = userDataDir ?? mkdtempSync(join(tmpdir(), 'drashti-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    env: appEnv({
      DRASHTI_USER_DATA_DIR: userData,
      DRASHTI_NO_QUIT_CONFIRM: '1',
      DRASHTI_TEST_NO_WIZARD: '1',
      DRASHTI_TEST_QUIET: QUIET ? '1' : '0',
      // A first start asks whether the computer is Main or a node (Session 13): tests are Main
      // unless they say otherwise (tests/e2e/nodes.ts starts nodes).
      DRASHTI_ROLE: 'main',
      ...extraEnv,
    }),
  });
  sayIfItStops(app);
  return { app, userData };
}

/** Apps the tests stop dead on purpose (killApp). */
const killed = new WeakSet<ElectronApplication>();

/**
 * A crash says so in the test's output, with Windows' exit code (0xffff7003
 * is a crash with no crash handler: run again with DRASHTI_TEST_CRASH_DUMPS
 * to keep a dump, README "End-to-end tests").
 */
function sayIfItStops(app: ElectronApplication): void {
  app.process().once('exit', (code, signal) => {
    if ((code === 0 && signal === null) || killed.has(app)) return;
    const hex = code === null ? '' : ` (0x${(code >>> 0).toString(16)})`;
    console.log(`Drashti stopped unexpectedly: exit code ${String(code)}${hex}, signal ${String(signal)}`);
  });
}

/**
 * Press "Use this display" on a display row. If that display holds the
 * operator window, Drashti asks first; agree, as a test needs the output.
 */
export async function useDisplay(page: Page, row = page.getByTestId('display-row').first()): Promise<void> {
  await row.getByRole('button', { name: 'Use this display' }).click();
  const confirm = page.getByTestId('cover-confirm');
  const added = page.getByTestId('screen-row').first();
  await expect(confirm.or(added)).toBeVisible();
  if (await confirm.isVisible()) await confirm.getByRole('button', { name: 'Cover the controls' }).click();
  await expect(added).toBeVisible();
}

/**
 * The operator window's page, found by its page rather than by window order:
 * after a restart the outputs can open first.
 */
export async function operatorPage(app: ElectronApplication): Promise<Page> {
  const isOperator = (p: Page) => p.url().includes('index.html');
  const existing = app.windows().find(isOperator);
  if (existing) return existing;
  return app.waitForEvent('window', { predicate: isOperator });
}

/**
 * Wait until the operator window's page is up and listening to the main process: the status bar
 * shows the version once it is. A notice sent before then (a backup asked for from the menu the
 * moment the window appears) would not be seen.
 */
export async function operatorReady(win: Page): Promise<void> {
  await expect(win.getByRole('contentinfo', { name: 'Status' })).toContainText(/Electron \d/u);
}

/**
 * Choose an application menu item, as the operator would: from the main process's event loop.
 * Playwright's evaluate can otherwise run in the middle of other main-process work (between two
 * rows of a database query), where the item's own query is refused as the connection is busy.
 */
export async function chooseMenuItem(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(
    ({ Menu }, item) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          Menu.getApplicationMenu()?.getMenuItemById(item)?.click();
          resolve();
        }, 0);
      }),
    id,
  );
}

/** Stop the app dead, as a crash or power cut would: the whole process tree, with no chance to quit cleanly. */
export async function killApp(app: ElectronApplication): Promise<void> {
  killed.add(app);
  const child = app.process();
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', () => resolve());
  });
  if (process.platform === 'win32' && child.pid)
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill('SIGKILL');
  await exited;
}

/**
 * Start the app again on the same data folder. A killed instance can take a
 * moment to let go of the single-instance lock (slow Windows machines), and
 * a second instance started before then quits at once: try a few times.
 */
export async function relaunchApp(
  userDataDir: string,
  extraEnv: Record<string, string> = {},
): ReturnType<typeof launchApp> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await launchApp(extraEnv, userDataDir);
    } catch (error) {
      if (attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/** An output window's page (not the setup wizard's display numbers, which use the same page). */
const isOutput = (w: Page) => w.url().includes('output.html') && !w.url().includes('identify=');

/** The first output window's page, waiting for it to open. */
export async function outputPage(app: ElectronApplication): Promise<Page> {
  const existing = app.windows().find(isOutput);
  if (existing) return existing;
  return app.waitForEvent('window', { predicate: isOutput });
}

/** Every open output window's page. */
export function outputPages(app: ElectronApplication): Page[] {
  return app.windows().filter(isOutput);
}

/**
 * Create a screen group on a display through the bridge (covering the
 * operator window if it is there; a test needs the output). Returns the new screen's id.
 */
export async function setUpScreen(win: Page, name = 'Main Hall', displayIndex = 0): Promise<string> {
  return win.evaluate(
    async ({ name, displayIndex }) => {
      const d = (globalThis as PageGlobals).drashti;
      const created = await d.screens.createGroup(name);
      if (!created.ok) throw new Error(created.message);
      const group = created.snapshot.groups.find((g) => g.name === name);
      const displayId = created.snapshot.displays[displayIndex]?.id ?? -1;
      const assigned = await d.screens.assignDisplay(group?.id ?? '', displayId, { coverOperator: true });
      if (!assigned.ok) throw new Error(assigned.message);
      return assigned.snapshot.groups.find((g) => g.name === name)?.screens[0]?.id ?? '';
    },
    { name, displayIndex },
  );
}

/** Import files through the bridge and return the report's targets (library ids), in the order given. */
export async function importAndGetIds(win: Page, files: string[]): Promise<string[]> {
  return win.evaluate(async (paths) => {
    const d = (globalThis as PageGlobals).drashti;
    const result = await d.library.importPaths(paths);
    if (!result.ok) throw new Error(result.message);
    const report = await d.library.getImportReport(result.run.id);
    return paths.map((p) => report?.items.find((i) => i.sourcePath === p)?.target?.id ?? '');
  }, files);
}

/**
 * Drop files from disk onto an element, as a drag from the desktop does. A file
 * input gives the page File objects backed by the real files, so the preload
 * can tell their paths; they are then dropped with a DataTransfer.
 */
export async function dropFiles(page: Page, target: Locator, paths: string[]): Promise<void> {
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.id = 'e2e-drop-source';
    input.style.display = 'none';
    document.body.appendChild(input);
  });
  await page.setInputFiles('#e2e-drop-source', paths);
  const dataTransfer = await page.evaluateHandle(() => {
    const input = document.getElementById('e2e-drop-source') as HTMLInputElement;
    const dt = new DataTransfer();
    for (const file of Array.from(input.files ?? [])) dt.items.add(file);
    input.remove();
    return dt;
  });
  await target.dispatchEvent('dragenter', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  await expect(page.getByTestId('drop-overlay')).toBeVisible();
  await target.dispatchEvent('drop', { dataTransfer });
  await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
}
