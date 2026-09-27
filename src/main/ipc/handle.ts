import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { InvokeChannel, InvokeResult } from '../../shared/ipc';
import { isAppUrl } from '../windows/navigation';
import { devServerUrl, rendererDir } from '../windows/renderer';

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
    return handler(event, ...args);
  });
}
