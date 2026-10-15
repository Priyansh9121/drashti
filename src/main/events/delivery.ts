/*
 * Events out's deliveries (Session 28, decision 20), as the events worker runs them: one request at a time
 * for each address, in order; a bounded queue (the newest 500); slide changes within 250 ms of each other
 * collapse to the latest; retries on a network error, 408, 429 or 5xx at once, after 5 s, 30 s, 2 min,
 * 10 min and 30 min, then the event is dropped and counted; a 410 turns the address off; a 404, a redirect
 * (never followed) or another 4xx is a setup problem, tried twice more. Nothing survives a restart: the
 * events describe a show that has moved on. The clock and the sending are given, so tests run it alone.
 */

/** One event as it goes out: its id stays the same across retries (Standard Webhooks' webhook-id). */
export interface OutEvent {
  id: string;
  type: string;
  /** The event's own body, already JSON. */
  body: string;
  /** When it was made (ms). */
  at: number;
}

/** What a try came to: an HTTP status (and the receiver's Date header), or a failure to reach it. */
export type TryResult = { status: number; date?: string } | { error: string };

export type Outcome =
  | { kind: 'delivered'; status: number; date?: string }
  | { kind: 'retrying'; status: number | null; error?: string; attempt: number; at: number }
  | { kind: 'dropped'; status: number | null; error?: string; dropped: number }
  | { kind: 'gone' }
  | { kind: 'setup'; status: number | null };

export interface DeliveryDeps {
  now(): number;
  /** Send `event` to the address (one try; its own timeout). */
  send(addressId: string, event: OutEvent, attempt: number): Promise<TryResult>;
  /** What happened, for the address's last success and failure, and its notices. */
  report(addressId: string, event: OutEvent, outcome: Outcome): void;
  /** Wake again after `ms` (the worker's timer; a test's own). */
  later(ms: number, wake: () => void): () => void;
  /** 0 to 1, for the retries' jitter (Math.random in the worker). */
  random(): number;
}

/** The waits before each retry (ms): at once, then 5 s, 30 s, 2 min, 10 min, 30 min. */
export const RETRY_MS = [0, 5_000, 30_000, 120_000, 600_000, 1_800_000] as const;
/** A setup problem (404, a redirect, another 4xx) is tried this many more times. */
export const SETUP_TRIES = 2;
export const QUEUE_MAX = 500;
/** Slide changes this close together collapse to the latest (ms). */
export const COLLAPSE_MS = 250;
const COLLAPSING = new Set(['slide.changed']);

const retryable = (status: number) => status === 408 || status === 429 || status >= 500;

interface Queue {
  events: OutEvent[];
  busy: boolean;
  /** Tries made of the first event. */
  attempt: number;
  /** When the first may be tried again. */
  waitUntil: number;
  cancel: (() => void) | null;
  off: boolean;
  dropped: number;
}

export class Deliveries {
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly deps: DeliveryDeps) {}

  private queue(addressId: string): Queue {
    let q = this.queues.get(addressId);
    if (!q) {
      q = { events: [], busy: false, attempt: 0, waitUntil: 0, cancel: null, off: false, dropped: 0 };
      this.queues.set(addressId, q);
    }
    return q;
  }

  /** Queue an event for an address (an address turned off by a 410 takes none until it is turned on again). */
  add(addressId: string, event: OutEvent): void {
    const q = this.queue(addressId);
    if (q.off) return;
    const last = q.events.at(-1);
    // The latest slide change only, when they come close together (not the one being sent now).
    if (
      last &&
      COLLAPSING.has(event.type) &&
      last.type === event.type &&
      event.at - last.at < COLLAPSE_MS &&
      !(q.busy && q.events.length === 1)
    ) {
      q.events[q.events.length - 1] = event;
    } else {
      q.events.push(event);
      while (q.events.length > QUEUE_MAX) {
        const [gone] = q.events.splice(q.busy ? 1 : 0, 1);
        q.dropped += 1;
        if (gone)
          this.deps.report(addressId, gone, {
            kind: 'dropped',
            status: null,
            error: 'too many waiting',
            dropped: q.dropped,
          });
      }
    }
    this.pump(addressId);
  }

  /** Turn an address on again (after a 410), or forget it (removed): its queue goes. */
  reset(addressId: string): void {
    const q = this.queues.get(addressId);
    q?.cancel?.();
    this.queues.delete(addressId);
  }

  /** How many are waiting for an address, and how many were dropped. */
  waiting(addressId: string): { waiting: number; dropped: number; off: boolean } {
    const q = this.queues.get(addressId);
    return { waiting: q?.events.length ?? 0, dropped: q?.dropped ?? 0, off: q?.off ?? false };
  }

  private pump(addressId: string): void {
    const q = this.queue(addressId);
    if (q.busy || q.off || q.events.length === 0) return;
    const wait = q.waitUntil - this.deps.now();
    if (wait > 0) {
      q.cancel ??= this.deps.later(wait, () => {
        q.cancel = null;
        this.pump(addressId);
      });
      return;
    }
    const event = q.events[0];
    if (!event) return;
    q.busy = true;
    const attempt = q.attempt + 1;
    void this.deps.send(addressId, event, attempt).then((result) => {
      q.busy = false;
      if (this.queues.get(addressId) !== q) return;
      this.settle(addressId, q, event, attempt, result);
      this.pump(addressId);
    });
  }

  private next(q: Queue): void {
    q.events.shift();
    q.attempt = 0;
    q.waitUntil = 0;
  }

  private settle(addressId: string, q: Queue, event: OutEvent, attempt: number, result: TryResult): void {
    const status = 'status' in result ? result.status : null;
    if (status !== null && status >= 200 && status < 300) {
      this.next(q);
      this.deps.report(addressId, event, {
        kind: 'delivered',
        status,
        ...('date' in result && result.date ? { date: result.date } : {}),
      });
      return;
    }
    if (status === 410) {
      q.off = true;
      q.events = [];
      this.deps.report(addressId, event, { kind: 'gone' });
      return;
    }
    const error = 'error' in result ? result.error : undefined;
    const setup = status !== null && !retryable(status);
    const tries = setup ? SETUP_TRIES + 1 : RETRY_MS.length + 1;
    q.attempt = attempt;
    if (attempt >= tries) {
      this.next(q);
      q.dropped += 1;
      this.deps.report(addressId, event, {
        kind: 'dropped',
        status,
        ...(error ? { error } : {}),
        dropped: q.dropped,
      });
      if (setup) this.deps.report(addressId, event, { kind: 'setup', status });
      return;
    }
    // After the first try fails, at once; then each wait in turn.
    const base = RETRY_MS[attempt - 1] ?? 0;
    // A little jitter, so many screens' worth of retries do not all come at once.
    const wait = base === 0 ? 0 : Math.round(base * (0.9 + 0.2 * this.deps.random()));
    q.waitUntil = this.deps.now() + wait;
    this.deps.report(addressId, event, {
      kind: 'retrying',
      status,
      ...(error ? { error } : {}),
      attempt,
      at: q.waitUntil,
    });
    if (setup) this.deps.report(addressId, event, { kind: 'setup', status });
  }
}
