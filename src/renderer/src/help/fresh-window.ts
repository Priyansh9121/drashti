import { vi } from 'vitest';
import type { OperatorMode } from '../../../shared/mode';

/*
 * For the Help tests drawn to markup (what-is-this.test.ts, help-switch.test.ts): a new start of the operator window,
 * in this mode, with Help as this computer remembers it. A server drawing reads each store as it began (zustand), so
 * each start imports its modules anew: the window's storage holding Help's switch, and the mode as the main process
 * said it.
 */
export async function freshWindow(mode: OperatorMode, helpOn: boolean): Promise<void> {
  vi.resetModules();
  const kept = new Map([['drashti.ui.help.on', JSON.stringify(helpOn)]]);
  const storage = {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => {
      kept.set(key, value);
    },
  };
  vi.stubGlobal('window', { localStorage: storage, sessionStorage: storage });
  vi.doMock('../operator/mode-store', async (original) => {
    const { create } = await import('zustand');
    return { ...(await original<object>()), useMode: create(() => ({ mode })) };
  });
}

/** Back to the modules as they are. */
export function endWindow(): void {
  vi.doUnmock('../operator/mode-store');
  vi.unstubAllGlobals();
}
