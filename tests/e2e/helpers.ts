import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DrashtiBridge } from '../../src/shared/bridge';

/** Globals inside our pages, for code passed to page.evaluate(). */
export type PageGlobals = typeof globalThis & { drashti: DrashtiBridge };

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

/** Launch the built app (out/) with a fresh, empty data folder. */
export async function launchApp(
  extraEnv: Record<string, string> = {},
): Promise<{ app: ElectronApplication; userData: string }> {
  const userData = mkdtempSync(join(tmpdir(), 'drashti-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    env: appEnv({ DRASHTI_USER_DATA_DIR: userData, ...extraEnv }),
  });
  return { app, userData };
}
