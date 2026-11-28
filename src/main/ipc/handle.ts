import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { STOPPED_REFUSAL } from '../../shared/access';
import type { InvokeChannel, InvokeResult } from '../../shared/ipc';
import { ipcRequestAllowed } from '../security/ipc-authority';

/**
 * The slowest time each channel's handler has taken in the main process
 * since the last reset (milliseconds). Everything the show does passes
 * through the main process, so a slow handler delays it: diagnostics and
 * tests read this.
 */
export const handlerTimes = new Map<string, number>();

/**
 * Access by Gmail (Session 54): whether a request may run, asked before every one. While this computer is not let
 * in, only the lock screen's requests and Quit run (and, in a self-test, Drashti's own pages but the operator
 * window, showing only the self-test's placeholder content): anything else is refused before its handler runs,
 * whatever page sent it and whatever its devtools typed.
 */
let access: ((channel: string, event: IpcMainInvokeEvent) => boolean) | null = null;

/** Set the gate every request passes (null: none, as in the tests that need none). */
export function gateChannels(mayRun: ((channel: string, event: IpcMainInvokeEvent) => boolean) | null): void {
  access = mayRun;
}

/**
 * While `locked()` is true, these channels answer their refusal instead of running (Simple Mode), but a request a
 * channel's bounds say is within them (Simple Mode's offers since Session 55, Part 18).
 */
let lock: {
  locked: () => boolean;
  refusals: ReadonlyMap<string, () => unknown>;
  bounds: ReadonlyMap<string, (args: readonly unknown[]) => boolean>;
} | null = null;

/**
 * Refuse the listed channels while `locked()` says so; each answers what its refusal gives. `bounds`: of those, the
 * ones that run while locked when a request (its arguments as sent) is within their bounds. Left out, none runs: the
 * lock fails closed.
 */
export function lockChannels(
  locked: () => boolean,
  refusals: ReadonlyMap<InvokeChannel, () => unknown>,
  bounds: ReadonlyMap<InvokeChannel, (args: readonly unknown[]) => boolean> = new Map(),
): void {
  lock = { locked, refusals, bounds };
}

/**
 * What a request on this channel gets instead of running now, or undefined when it may run: Simple Mode's
 * refusal (Session 54, E5: roles, and their admin lock, are gone). A bounded channel's request runs when its
 * arguments (`args`, as sent) are within its bounds; asked with none (the network's refusedNow), it is refused.
 */
export function refusalFor(channel: string, args?: readonly unknown[]): (() => unknown) | undefined {
  if (!lock?.locked()) return undefined;
  const within = lock.bounds.get(channel);
  if (within && args !== undefined && within(args)) return undefined;
  return lock.refusals.get(channel);
}

/**
 * Whether a request on this channel would be refused now (Simple Mode): the network asks the same, with no arguments,
 * so a bounded channel is refused to a phone or Companion (Simple Mode's offers are its window's).
 */
export function refusedNow(channel: InvokeChannel): boolean {
  return refusalFor(channel) !== undefined;
}

/**
 * Before a request that may write to the library runs, what to wait for (Session 16): while an
 * import runs, it gives way between files, so the write never waits for the import's group inside
 * the main process (where every slide change would wait with it). Null: run at once. The wait
 * resolves with what to call once the request has run.
 */
let giveWay: ((channel: string) => Promise<() => void> | null) | null = null;

export function setGiveWay(wait: ((channel: string) => Promise<() => void> | null) | null): void {
  giveWay = wait;
}

/** The performance check's watch (Session 15): told of every request answered, and how long it took. */
let heard: ((channel: string, ms: number) => void) | null = null;

export function hearHandled(listener: ((channel: string, ms: number) => void) | null): void {
  heard = listener;
}

/**
 * The log of every operator request (alpha.21, logs for 100+ installs (a)): told, for each channel `logged` says,
 * how each request went (done, not done, refused, failed). Never its arguments or its answer.
 */
let told: {
  logged: (channel: string) => boolean;
  tell: (channel: string, outcome: string, error?: unknown) => void;
} | null = null;
const loggedChannels = new Map<string, boolean>();

export function tellRequests(listener: typeof told): void {
  told = listener;
  loggedChannels.clear();
}

/** The listener, for a channel it logs; null for any other (asked once a channel). */
function tellerFor(channel: string): ((outcome: string, error?: unknown) => void) | null {
  const t = told;
  if (!t) return null;
  let logged = loggedChannels.get(channel);
  if (logged === undefined) {
    logged = t.logged(channel);
    loggedChannels.set(channel, logged);
  }
  return logged
    ? (outcome, error) => {
        try {
          t.tell(channel, outcome, error);
        } catch {
          // The log is never in a request's way.
        }
      }
    : null;
}

/** How an answer went: an `{ ok: false }` answer is not done. */
const outcomeOf = (answer: unknown): string =>
  answer !== null && typeof answer === 'object' && (answer as { ok?: unknown }).ok === false
    ? 'not done'
    : 'done';

function note(channel: string, started: number): void {
  const ms = performance.now() - started;
  if (ms > (handlerTimes.get(channel) ?? 0)) handlerTimes.set(channel, ms);
  heard?.(channel, ms);
}

/**
 * Register a handler for a request/response channel from the shared contract.
 * Arguments arrive as `unknown`: handlers must validate them. Calls from pages
 * outside their Main-assigned window, main frame or channel authority are rejected before the handler runs.
 */
export function handle<C extends InvokeChannel>(
  channel: C,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => InvokeResult<C> | Promise<InvokeResult<C>>,
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!ipcRequestAllowed(event, channel)) throw new Error('Refused IPC request.');
    const tell = tellerFor(channel);
    if (access && !access(channel, event)) {
      tell?.('refused (not let in)');
      throw new Error(STOPPED_REFUSAL);
    }
    const refusal = refusalFor(channel, args);
    if (refusal) {
      tell?.('refused (Simple Mode)');
      return refusal();
    }
    const run = () => {
      const started = performance.now();
      let result: InvokeResult<C> | Promise<InvokeResult<C>>;
      try {
        result = handler(event, ...args);
      } catch (error) {
        tell?.('failed', error);
        throw error;
      }
      // Time the synchronous part: that is what blocks the main process.
      note(channel, started);
      if (tell) {
        if (result instanceof Promise)
          void result.then(
            (answer: unknown) => {
              tell(outcomeOf(answer));
            },
            (error: unknown) => {
              tell('failed', error);
            },
          );
        else tell(outcomeOf(result));
      }
      return result;
    };
    const waiting = giveWay?.(channel) ?? null;
    if (!waiting) return run();
    return waiting.then(async (done) => {
      try {
        if (!ipcRequestAllowed(event, channel)) throw new Error('Refused IPC request.');
        return await run();
      } finally {
        done();
      }
    });
  });
}

/**
 * A request a page's preload makes synchronously, answered at once (Sessions 39–40: the appearance a page draws
 * in, before it draws anything). Only Drashti's own pages are answered; any other gets null.
 */
export function handleSync(channel: string, answer: () => unknown): void {
  ipcMain.on(channel, (event) => {
    event.returnValue = ipcRequestAllowed(event, channel) ? answer() : null;
  });
}
