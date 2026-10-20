import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { _electron as electron, expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DrashtiBridge } from '../../src/shared/bridge';
import type { EngineState } from '../../src/shared/engine/state';

/** Globals inside our pages, for code passed to page.evaluate(). */
export type PageGlobals = typeof globalThis & { drashti: DrashtiBridge };

/** Globals inside an output window: its history of painted engine revisions. */
export type OutputGlobals = typeof globalThis & {
  drashtiPaintLog?: { rev: number; sentAt: number; committedAt: number; paintedAt: number; wallAt: number }[];
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
 * For a test of what Drashti starts in by itself (Follow the computer, the default, a choice kept over a
 * restart): no test appearance, whatever the run's own switch. CI's Black job (Session 41) starts every other
 * Drashti in Black (DRASHTI_TEST_APPEARANCE=black), which would hide what such a test checks.
 */
export const OWN_APPEARANCE = { DRASHTI_TEST_APPEARANCE: '' } as const;

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
    // Another build of Drashti can be run instead (an earlier commit's, for audience-pixels.spec.ts).
    args: [process.env['DRASHTI_E2E_APP_DIR'] ?? '.'],
    env: appEnv({
      DRASHTI_USER_DATA_DIR: userData,
      DRASHTI_NO_QUIT_CONFIRM: '1',
      DRASHTI_TEST_NO_WIZARD: '1',
      DRASHTI_TEST_QUIET: QUIET ? '1' : '0',
      // A first start asks whether the computer is Main or a node (Session 13): tests are Main
      // unless they say otherwise (tests/e2e/nodes.ts starts nodes).
      DRASHTI_ROLE: 'main',
      // Crash files go into the test's own output folder (Session 39), which Playwright keeps only when the
      // test fails (playwright.config.ts, preserveOutput), so a failed run's report carries them.
      ...crashFilesHere(),
      ...extraEnv,
    }),
  });
  sayIfItStops(app);
  sayIfQuittingIsSlow(app, userData);
  return { app, userData };
}

/** The running test's own folder for crash files, or nothing outside a test. */
function crashFilesHere(): { DRASHTI_TEST_CRASH_DUMPS?: string } {
  try {
    return { DRASHTI_TEST_CRASH_DUMPS: test.info().outputPath('crash-files') };
  } catch {
    return {};
  }
}

/** Quitting this long is said, with the end of Drashti's own log (a quit that took 60 s once on CI Windows). */
const SLOW_QUIT_MS = 20_000;

/**
 * Closing Drashti: a slow quit is said, and a quit that ends in a crash (a signal, or a crash's exit code) fails
 * the test that closed it (Session 37: quit.spec's restarted Drashti had quit on SIGSEGV unseen since Session 31,
 * as the test passed). A Drashti stopped dead on purpose (killApp, killMainOnly) is never asked.
 */
function sayIfQuittingIsSlow(app: ElectronApplication, userData: string): void {
  const close = app.close.bind(app);
  app.close = async () => {
    // Asked for before closing: once closed, Playwright no longer gives it.
    const child = app.process();
    const timer = setTimeout(() => {
      const file = join(userData, 'logs', 'drashti.log');
      const tail = existsSync(file)
        ? readFileSync(file, 'utf8').split('\n').slice(-40).join('\n')
        : '(no log)';
      console.log(
        `Drashti has taken over ${String(SLOW_QUIT_MS / 1000)} s to quit. The end of its log:\n${tail}`,
      );
    }, SLOW_QUIT_MS);
    try {
      await close();
    } finally {
      clearTimeout(timer);
    }
    const crashed = child.signalCode !== null || (child.exitCode !== null && child.exitCode !== 0);
    if (crashed && !killed.has(app))
      throw new Error(
        `Drashti crashed as it quit: exit code ${String(child.exitCode)}, signal ${String(child.signalCode)}. Run again with DRASHTI_TEST_CRASH_DUMPS to keep its dump (README, "End-to-end tests").`,
      );
  };
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
 * The first window showing this page, looked for again every 100 ms until it is there (30 s at most). Not
 * waited for as a "window" event with a test of its address: a window can open before its page's address
 * is known, and an event tested then is passed over for good (a 30 s wait for a window already open, as on
 * the Mac VM in Session 31). If none comes, the error names the windows that are open.
 */
export async function windowShowing(
  app: ElectronApplication,
  is: (p: Page) => boolean,
  what: string,
): Promise<Page> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const found = app.windows().find(is);
    if (found) return found;
    if (Date.now() > deadline) {
      const open = app.windows().map((w) => w.url() || '(no address yet)');
      throw new Error(`No ${what} window after 30 s. Open: ${open.join(', ') || 'none'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * The operator window's page, found by its page rather than by window order:
 * after a restart the outputs can open first.
 */
export function operatorPage(app: ElectronApplication): Promise<Page> {
  return windowShowing(app, (p) => p.url().includes('index.html'), 'operator');
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
 * Stop only Drashti's main process dead, as a crash of it would (Session 31): never the programs it started
 * (on Windows too: no /T), which a crash leaves running. Answers once that process has gone.
 */
export async function killMainOnly(app: ElectronApplication): Promise<void> {
  killed.add(app);
  // Drashti's own main process (on Windows CI the process Playwright started is not it).
  const pid = await app.evaluate(() => process.pid);
  if (process.platform === 'win32')
    spawnSync(join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'taskkill.exe'), [
      '/PID',
      String(pid),
      '/F',
    ]);
  else process.kill(pid, 'SIGKILL');
  const gone = () => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  };
  await expect.poll(gone, { timeout: 15_000 }).toBe(true);
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
export function outputPage(app: ElectronApplication): Promise<Page> {
  return windowShowing(app, isOutput, 'output');
}

/** Every open output window's page. */
export function outputPages(app: ElectronApplication): Page[] {
  return app.windows().filter(isOutput);
}

/**
 * An output ready to draw the show: its fonts in and its GPU warmed up, unseen (Session 27). A window that
 * draws no frames (under another, on a CI computer) takes the warm-up's longest, 8 s; a slow one longer.
 */
export async function outputReady(page: Page): Promise<void> {
  await expect(page.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
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

/**
 * The library's sheet, opened from the Library button if it is shut (Session 44: the playlists have the
 * whole left column, and the library opens over it).
 */
export async function openLibrary(win: Page): Promise<Locator> {
  const sheet = win.getByTestId('library-sheet');
  if ((await sheet.count()) === 0) await win.getByTestId('library-button').click();
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Shut the library's sheet if it is open, so the playlists show again in the left column. */
export async function closeLibrary(win: Page): Promise<void> {
  const sheet = win.getByTestId('library-sheet');
  if ((await sheet.count()) > 0) await win.getByTestId('library-close').click();
  await expect(sheet).toHaveCount(0);
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
 * can tell their paths; they are then dropped with a DataTransfer. The
 * presentation list shows its overlay meanwhile; elsewhere (`overlay: false`)
 * the window takes the drop without one.
 */
export async function dropFiles(
  page: Page,
  target: Locator,
  paths: string[],
  {
    overlay = true,
    at,
  }: {
    overlay?: boolean;
    /** Where on the target it lands (the top, middle or bottom of it); by default nowhere in particular. */
    at?: 'top' | 'middle' | 'bottom';
  } = {},
): Promise<void> {
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
  const box = at ? await target.boundingBox() : null;
  const point = box
    ? {
        clientX: box.x + box.width / 2,
        clientY: box.y + (at === 'top' ? 3 : at === 'bottom' ? box.height - 3 : box.height / 2),
      }
    : {};
  await target.dispatchEvent('dragenter', { dataTransfer, ...point });
  await target.dispatchEvent('dragover', { dataTransfer, ...point });
  if (overlay) await expect(page.getByTestId('drop-overlay')).toBeVisible();
  await target.dispatchEvent('drop', { dataTransfer, ...point });
  await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
}

/**
 * Turn on View › Show Shastra, Templates and Kirtan Details (Session 26a: off to begin with), as an admin
 * would, for tests of the Shastra tab, templates and the kirtan filters; waits until the window shows them.
 */
export async function showExtras(page: Page): Promise<void> {
  const result = await page.evaluate(() => (globalThis as PageGlobals).drashti.library.setExtras(true));
  if (!result.ok) throw new Error(result.message);
  // Shown once the window has heard: the playlists' Templates tab (the library's Shastra tab is in its sheet,
  // Session 44, open or not).
  await expect(page.getByTestId('playlist-view-tab-templates')).toBeVisible();
}

/** Unfold More tools (Session 26a; Session 44: Lower Thirds, Masks, the Idle rotation and MIDI, folded away to begin with). */
export async function openMoreTools(page: Page): Promise<void> {
  const toggle = page.getByTestId('group-more-tools-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

// ---- waits that say what they wait for (Sessions 31–36, TST-6, TST-7) ------------------------------------
// A test waits for a condition (a locator, expect.poll), never for a while: eslint.config.mjs refuses a raw
// waitForTimeout or a sleeping setTimeout in tests/ outside this file. Where time itself is what is tested,
// letTimePass says why; where something must not happen, holdStill keeps checking it does not; before a test
// stops Drashti dead, savedLive and nodeSaved wait for what it saved.

/**
 * Time itself is what is tested (a recording grows, a video plays on, a dissolve is part-way, a file is written
 * slowly): let `ms` pass, saying why. It shows as a step in the report.
 */
export async function letTimePass(page: Page, ms: number, why: string): Promise<void> {
  await test.step(`let ${String(ms)} ms pass: ${why}`, async () => {
    await page.waitForTimeout(ms);
  });
}

/**
 * Something must not happen: `still` stays true for `ms`, asked every 100 ms, and the test fails at once when
 * it does not ("no message was sent", "nothing was imported").
 */
export async function holdStill(
  still: () => boolean | Promise<boolean>,
  ms: number,
  why: string,
): Promise<void> {
  await test.step(`hold still ${String(ms)} ms: ${why}`, async () => {
    const until = Date.now() + ms;
    for (;;) {
      expect(await still(), why).toBe(true);
      const left = until - Date.now();
      if (left <= 0) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, left)));
    }
  });
}

/** What Drashti saved of the show (live-state.json, src/main/recovery/live-state.ts), as far as tests read it. */
export interface SavedLive {
  session?: string;
  slide?: { presentationId?: string; slideIndex?: number } | null;
  background?: { kind?: string; mediaId?: string; startedAt?: number } | null;
  blackout?: boolean;
  audio?: { mediaId?: string; startedAt?: number } | null;
  messages?: { id: string; text: string }[];
  ticker?: { items: { id: string; text: string }[]; startedAt: number } | null;
  stageMessage?: string | null;
  timers?: { id: string; startedAt: number | null; elapsedMs: number }[];
  lookId?: string | null;
  [more: string]: unknown;
}

/**
 * Wait until Drashti has saved the show as `check` wants it (live-state.json, written in the background as the
 * show changes): before a test stops it dead, so the next start finds it.
 */
export async function savedLive(
  userData: string,
  check: (saved: SavedLive) => boolean,
  timeout = 10_000,
): Promise<SavedLive> {
  const file = join(userData, 'live-state.json');
  const read = (): SavedLive | null => {
    try {
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SavedLive) : null;
    } catch {
      return null; // part-written: asked again
    }
  };
  await expect
    .poll(
      () => {
        const saved = read();
        return saved !== null && check(saved);
      },
      { timeout, message: 'Drashti saved the show as the test wants it (live-state.json)' },
    )
    .toBe(true);
  return read() ?? {};
}

/**
 * Wait until a node has saved the show as `check` wants it (node-show.json, its last picture, kept at most a
 * second after it changes): before a test stops the node or its Main.
 */
export async function nodeSaved(
  userData: string,
  check: (state: EngineState) => boolean,
  timeout = 10_000,
): Promise<void> {
  const file = join(userData, 'node-show.json');
  await expect
    .poll(
      () => {
        try {
          if (!existsSync(file)) return false;
          const saved = JSON.parse(readFileSync(file, 'utf8')) as { snapshot?: { state?: EngineState } };
          return saved.snapshot?.state ? check(saved.snapshot.state) : false;
        } catch {
          return false; // part-written: asked again
        }
      },
      { timeout, message: 'the node saved the show as the test wants it (node-show.json)' },
    )
    .toBe(true);
}
