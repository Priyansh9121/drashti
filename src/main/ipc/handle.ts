import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { InvokeChannel, InvokeResult } from '../../shared/ipc';
import { isAppUrl } from '../windows/navigation';
import { devServerUrl, rendererDir } from '../windows/renderer';

/**
 * The slowest time each channel's handler has taken in the main process
 * since the last reset (milliseconds). Everything the show does passes
 * through the main process, so a slow handler delays it: diagnostics and
 * tests read this.
 */
export const handlerTimes = new Map<string, number>();

function note(channel: string, started: number): void {
  const ms = performance.now() - started;
  if (ms > (handlerTimes.get(channel) ?? 0)) handlerTimes.set(channel, ms);
}

/**
 * Register a handler for a request/response channel from the shared contract.
 * Arguments arrive as `unknown`: handlers must validate them. Calls from pages
 * other than our own are rejected before the handler runs.
 */
export function handle<C extends InvokeChannel>(
  channel: C,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => InvokeResult<C> | Promise<InvokeResult<C>>,
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    const url = event.senderFrame?.url ?? '';
    if (!isAppUrl(url, { devServerUrl: devServerUrl(), rendererDir: rendererDir() })) {
      throw new Error(`Refused ${channel} from ${url || 'an unknown frame'}`);
    }
    const started = performance.now();
    const result = handler(event, ...args);
    // Time the synchronous part: that is what blocks the main process.
    note(channel, started);
    return result;
  });
}
