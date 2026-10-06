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

/** While `locked()` is true, these channels answer their refusal instead of running (Simple Mode). */
let lock: { locked: () => boolean; refusals: ReadonlyMap<string, () => unknown> } | null = null;

/** Refuse the listed channels while `locked()` says so; each answers what its refusal gives. */
export function lockChannels(
  locked: () => boolean,
  refusals: ReadonlyMap<InvokeChannel, () => unknown>,
): void {
  lock = { locked, refusals };
}

/**
 * With roles on (Session 14), admin requests answer their refusal while
 * admin is locked; one that goes through keeps admin unlocked for a while.
 */
let adminLock: {
  locked: () => boolean;
  refusals: ReadonlyMap<string, () => unknown>;
  touched: () => void;
} | null = null;

/** Refuse the listed (admin) channels while `locked()` says so; `touched` hears of each that went through. */
export function lockAdminChannels(
  locked: () => boolean,
  refusals: ReadonlyMap<InvokeChannel, () => unknown>,
  touched: () => void,
): void {
  adminLock = { locked, refusals, touched };
}

/**
 * What a request on this channel gets instead of running now, or undefined
 * when it may run: Simple Mode's refusal first, then the admin's.
 */
export function refusalFor(channel: string): (() => unknown) | undefined {
  const simple = lock?.locked() ? lock.refusals.get(channel) : undefined;
  if (simple) return simple;
  return adminLock?.locked() ? adminLock.refusals.get(channel) : undefined;
}

/** Whether a request on this channel would be refused now (Simple Mode, or admin locked): the network asks the same. */
export function refusedNow(channel: InvokeChannel): boolean {
  return refusalFor(channel) !== undefined;
}

/** The performance check's watch (Session 15): told of every request answered, and how long it took. */
let heard: ((channel: string, ms: number) => void) | null = null;

export function hearHandled(listener: ((channel: string, ms: number) => void) | null): void {
  heard = listener;
}

function note(channel: string, started: number): void {
  const ms = performance.now() - started;
  if (ms > (handlerTimes.get(channel) ?? 0)) handlerTimes.set(channel, ms);
  heard?.(channel, ms);
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
    const refusal = refusalFor(channel);
    if (refusal) return refusal();
    if (adminLock?.refusals.has(channel)) adminLock.touched();
    const started = performance.now();
    const result = handler(event, ...args);
    // Time the synchronous part: that is what blocks the main process.
    note(channel, started);
    return result;
  });
}
