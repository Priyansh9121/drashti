import type { ElectronApplication, Page } from '@playwright/test';
import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DrashtiBridge } from '../../src/shared/bridge';

/** Globals inside our pages, for code passed to page.evaluate(). */
export type PageGlobals = typeof globalThis & { drashti: DrashtiBridge };

/** Globals inside an output window: its history of painted engine revisions. */
export type OutputGlobals = typeof globalThis & {
  drashtiPaintLog?: { rev: number; sentAt: number; paintedAt: number }[];
};

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

/** Launch the built app (out/), with a fresh data folder unless one is given (to test restarts). */
export async function launchApp(
  extraEnv: Record<string, string> = {},
  userDataDir?: string,
): Promise<{ app: ElectronApplication; userData: string }> {
  const userData = userDataDir ?? mkdtempSync(join(tmpdir(), 'drashti-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    env: appEnv({ DRASHTI_USER_DATA_DIR: userData, DRASHTI_NO_QUIT_CONFIRM: '1', ...extraEnv }),
  });
  return { app, userData };
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

/** The first output window's page, waiting for it to open. */
export async function outputPage(app: ElectronApplication): Promise<Page> {
  const existing = app.windows().find((w) => w.url().includes('output.html'));
  if (existing) return existing;
  return app.waitForEvent('window', { predicate: (w) => w.url().includes('output.html') });
}

/** Every open output window's page. */
export function outputPages(app: ElectronApplication): Page[] {
  return app.windows().filter((w) => w.url().includes('output.html'));
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
