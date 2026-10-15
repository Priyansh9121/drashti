import type { OutEvent, Outcome, TryResult } from './delivery';

/*
 * Messages between the main process and the events worker (Session 28): the main process says where each
 * address is and with which secret, and hands it each event; the worker sends them, and says how each went.
 */

/** An address as the worker needs it: never logged, never sent to a window. */
export interface WorkerAddress {
  id: string;
  url: string;
  secret: string;
  /** The secret before Rotate, signed with too until `until` (ms), so a receiver can change over. */
  oldSecret: { secret: string; until: number } | null;
  allowInternet: boolean;
}

export type ToEventsWorker =
  | { type: 'start'; onlyThisComputer: boolean }
  | { type: 'addresses'; list: WorkerAddress[] }
  | { type: 'event'; addressId: string; event: OutEvent }
  /** Send a test now, once, outside the queue. */
  | { type: 'test'; requestId: string; addressId: string; event: OutEvent }
  /** Take an address's queue away (turned on again after a 410, or removed). */
  | { type: 'reset'; addressId: string };

export type FromEventsWorker =
  | { type: 'outcome'; addressId: string; eventType: string; outcome: Outcome }
  | { type: 'test-result'; requestId: string; result: TryResult }
  /** A request refused by the test guard: the main process logs it loudly. */
  | { type: 'guard'; message: string };
