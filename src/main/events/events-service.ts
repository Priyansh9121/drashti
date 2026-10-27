import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  EVENT_ADDRESSES_MAX,
  EVENT_KINDS,
  type EventAddressStatus,
  type EventAddressView,
  type EventsOutResult,
  type EventsOutView,
  eventAddressPatchSchema,
  eventAddressSchema,
  WORDY_KINDS,
} from '../../shared/events-out';
import { idSchema } from '../../shared/model-schema';
import { parsePlain } from '../../shared/plain-parse';
import type { StreamKeyStore } from '../stream/key-store';
import type { OutEvent, Outcome, TryResult } from './delivery';
import { checkTarget, type Resolve } from './policy';
import type { FromEventsWorker, WorkerAddress } from './protocol';
import { newSecret } from './signing';
import type { Emitted } from './sources';
import type { EventsWorker } from './spawn-worker';

/*
 * Events out in the main process (Session 28, decision 20): the addresses set up in it, kept encrypted
 * as stream keys are (their own file; never the library, a backup, the log or a window); the events the
 * show makes, handed to the events worker for each address that ticked their kind; and how each address
 * stands. No address, no worker: nothing runs until one is added and a kind ticked.
 */

const savedSchema = z.object({
  url: z.string(),
  secret: z.string(),
  oldSecret: z.object({ secret: z.string(), until: z.number() }).nullable(),
  kinds: z.array(z.enum(EVENT_KINDS)),
  words: z.array(z.enum(EVENT_KINDS)),
  allowInternet: z.boolean(),
  off: z.boolean(),
});
type Saved = z.infer<typeof savedSchema>;

/** After Rotate, the old secret signs too for this long. */
export const OLD_SECRET_MS = 24 * 60 * 60 * 1000;
/** The worker started again this long after it stopped unexpectedly. */
const RESTART_MS = 1000;
/** A test's answer, at most this long (the request's own 15 s, and finding the name). */
const TEST_WAIT_MS = 20_000;
/** How an address stands goes to the operator window at most this often. */
const STATUS_MS = 1000;
/** A receiver's clock this far from this computer's is worth saying. */
const CLOCK_NOTE_MS = 60_000;

export const NO_SECURE_STORAGE_EVENTS =
  'This computer’s secure storage for passwords is not available, so Drashti will not keep an events address (its secret would have to be kept as plain text). Get the system’s keychain working, then add it again.';

const freshStatus = (): EventAddressStatus => ({
  lastSuccess: null,
  lastFailure: null,
  setupProblem: false,
  dropped: 0,
  clockOffBy: null,
});

/** A failure to reach a receiver, in words. */
export function plainError(error: string): string {
  switch (error) {
    case 'ECONNREFUSED':
      return 'Nothing is listening at that address. Is the receiver running?';
    case 'ETIMEDOUT':
    case 'timed out':
      return 'The receiver did not answer within 15 seconds.';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'This computer cannot find that address on the network.';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'This computer cannot reach that address on the network.';
    case 'ECONNRESET':
      return 'The receiver closed the connection.';
    default:
      return error.startsWith('E') && /^E[A-Z_]+$/u.test(error)
        ? `The receiver could not be reached (${error}).`
        : error;
  }
}

/** A receiver's answer to a test, in words. */
export function testAnswer(result: TryResult): { ok: boolean; message: string } {
  if ('error' in result) return { ok: false, message: plainError(result.error) };
  const s = result.status;
  if (s >= 200 && s < 300)
    return { ok: true, message: `The receiver answered ${String(s)}: events reach it.` };
  if (s === 410) return { ok: false, message: 'The receiver answered 410: it says this address is gone.' };
  if (s === 404)
    return {
      ok: false,
      message:
        'The receiver answered 404: nothing is at that address. Check it (in n8n, the workflow must be active and its production address used).',
    };
  if (s >= 300 && s < 400)
    return {
      ok: false,
      message: `The receiver answered ${String(s)}, sending it elsewhere. Drashti never follows that: give the final address.`,
    };
  return { ok: false, message: `The receiver answered ${String(s)}.` };
}

export interface EventsOutDeps {
  store: Pick<StreamKeyStore, 'status' | 'ids' | 'get' | 'set' | 'remove'>;
  spawn(): EventsWorker;
  /** Tests (never a packaged Drashti): events go only to 127.0.0.1. */
  onlyThisComputer: boolean;
  resolve: Resolve;
  now(): number;
  /** How the addresses stand changed: the operator window is told. */
  changed(view: EventsOutView): void;
  notice(text: string): void;
  log(level: 'info' | 'warn', message: string): void;
  later?(ms: number, run: () => void): () => void;
}

export class EventsOut {
  private readonly addresses = new Map<string, Saved>();
  private readonly statuses = new Map<string, EventAddressStatus>();
  private worker: EventsWorker | null = null;
  private restart: (() => void) | null = null;
  private statusTimer: (() => void) | null = null;
  private readonly tests = new Map<string, (result: TryResult) => void>();
  private closed = false;

  constructor(private readonly deps: EventsOutDeps) {}

  private later(ms: number, run: () => void): () => void {
    if (this.deps.later) return this.deps.later(ms, run);
    const timer = setTimeout(run, ms);
    return () => {
      clearTimeout(timer);
    };
  }

  /**
   * Read the addresses kept, once, at the start. The keychain is asked only when there are some: asking it
   * at every start blocked an Intel build on a Mac whose keychain item another build had made (macOS asks
   * for permission, and nothing answers), and stream keys are never read at the start either.
   */
  load(): void {
    const ids = this.deps.store.ids();
    if (ids.length === 0 || !this.deps.store.status().available) return;
    for (const id of ids) {
      const raw = this.deps.store.get(id);
      if (raw === null) continue;
      try {
        const parsed = savedSchema.safeParse(JSON.parse(raw));
        if (parsed.success) this.addresses.set(id, parsed.data);
      } catch {
        // Unreadable: left out (it is added again in File › Events Out…).
      }
    }
    this.sync();
  }

  private statusOf(id: string): EventAddressStatus {
    let s = this.statuses.get(id);
    if (!s) {
      s = freshStatus();
      this.statuses.set(id, s);
    }
    return s;
  }

  view(): EventsOutView {
    const storage = this.deps.store.status();
    const addresses: EventAddressView[] = [];
    for (const [id, a] of this.addresses) {
      const url = new URL(a.url);
      addresses.push({
        id,
        host: url.host,
        secure: url.protocol === 'https:',
        kinds: a.kinds,
        words: a.words,
        allowInternet: a.allowInternet,
        off: a.off,
        status: { ...this.statusOf(id) },
      });
    }
    return {
      available: storage.available,
      message: storage.available ? null : (storage.message ?? NO_SECURE_STORAGE_EVENTS),
      addresses,
    };
  }

  private changed(): void {
    this.deps.changed(this.view());
  }

  /** How an address stands changed: told within a second, not on every event. */
  private statusChanged(): void {
    this.statusTimer ??= this.later(STATUS_MS, () => {
      this.statusTimer = null;
      this.changed();
    });
  }

  private keep(id: string, saved: Saved): EventsOutResult | null {
    const result = this.deps.store.set(id, JSON.stringify(saved));
    if (!result.ok) return { ok: false, message: result.message };
    this.addresses.set(id, saved);
    return null;
  }

  /** Whether the address may be used (resolved and checked now; each event is checked again as it goes). */
  private async allowed(url: string, allowInternet: boolean): Promise<string | null> {
    const target = await checkTarget(url, {
      allowInternet,
      onlyThisComputer: this.deps.onlyThisComputer,
      resolve: this.deps.resolve,
    });
    if (target.ok) return null;
    if (target.loud) this.deps.log('warn', target.reason);
    return target.reason;
  }

  private internetTaken(except: string | null): string | null {
    for (const [id, a] of this.addresses) if (id !== except && a.allowInternet) return new URL(a.url).host;
    return null;
  }

  async add(rawUrl: unknown, rawAllowInternet: unknown): Promise<EventsOutResult> {
    const parsed = parsePlain(
      eventAddressSchema,
      rawUrl,
      'That is not an address Drashti can send to: type it as the receiver gives it, starting http:// or https://.',
    );
    if (!parsed.success) return { ok: false, message: parsed.message };
    const allowInternet = rawAllowInternet === true;
    if (this.addresses.size >= EVENT_ADDRESSES_MAX)
      return { ok: false, message: `At most ${String(EVENT_ADDRESSES_MAX)} addresses.` };
    const taken = allowInternet ? this.internetTaken(null) : null;
    if (taken !== null)
      return {
        ok: false,
        message: `Only one address may be on the internet, and ${taken} is. Turn that off first.`,
      };
    const refused = await this.allowed(parsed.data, allowInternet);
    if (refused !== null) return { ok: false, message: refused };
    const id = randomUUID();
    const secret = newSecret();
    // Nothing is sent until what it gets is ticked.
    const kept = this.keep(id, {
      url: parsed.data,
      secret,
      oldSecret: null,
      kinds: [],
      words: [],
      allowInternet,
      off: false,
    });
    if (kept) return kept;
    this.deps.log('info', `Events out: an address was added (${new URL(parsed.data).host})`);
    this.sync();
    this.changed();
    return { ok: true, view: this.view(), secret };
  }

  async update(rawId: unknown, rawPatch: unknown): Promise<EventsOutResult> {
    const id = idSchema.safeParse(rawId);
    const patch = eventAddressPatchSchema.safeParse(rawPatch);
    const was = id.success ? this.addresses.get(id.data) : undefined;
    if (!id.success || !was) return { ok: false, message: 'That address is not there now.' };
    if (!patch.success) return { ok: false, message: 'That change cannot be made.' };
    const p = patch.data;
    const allowInternet = p.allowInternet ?? was.allowInternet;
    if (allowInternet && !was.allowInternet) {
      const taken = this.internetTaken(id.data);
      if (taken !== null)
        return {
          ok: false,
          message: `Only one address may be on the internet, and ${taken} is. Turn that off first.`,
        };
    }
    // Allowed on the internet, or taken back to the local network: checked again.
    if (allowInternet !== was.allowInternet) {
      const refused = await this.allowed(was.url, allowInternet);
      if (refused !== null) return { ok: false, message: refused };
    }
    const kinds = p.kinds ? EVENT_KINDS.filter((k) => p.kinds?.includes(k)) : was.kinds;
    const words = (p.words ?? was.words).filter((k) => kinds.includes(k) && WORDY_KINDS.includes(k));
    const off = p.on === undefined ? was.off : !p.on;
    const kept = this.keep(id.data, { ...was, kinds, words: [...new Set(words)], allowInternet, off });
    if (kept) return kept;
    if (was.off && !off) {
      // On again (after a 410): a fresh start.
      this.worker?.post({ type: 'reset', addressId: id.data });
      this.statuses.set(id.data, freshStatus());
    }
    this.sync();
    this.changed();
    return { ok: true, view: this.view() };
  }

  remove(rawId: unknown): EventsOutResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success || !this.addresses.has(id.data)) return { ok: true, view: this.view() };
    this.deps.store.remove(id.data);
    this.addresses.delete(id.data);
    this.statuses.delete(id.data);
    this.deps.log('info', 'Events out: an address was removed');
    this.sync();
    this.changed();
    return { ok: true, view: this.view() };
  }

  /** A new secret, shown once; the old one signs too for a day, so the receiver can change over. */
  rotate(rawId: unknown): EventsOutResult {
    const id = idSchema.safeParse(rawId);
    const was = id.success ? this.addresses.get(id.data) : undefined;
    if (!id.success || !was) return { ok: false, message: 'That address is not there now.' };
    const secret = newSecret();
    const kept = this.keep(id.data, {
      ...was,
      secret,
      oldSecret: { secret: was.secret, until: this.deps.now() + OLD_SECRET_MS },
    });
    if (kept) return kept;
    this.deps.log('info', 'Events out: a secret was changed');
    this.sync();
    this.changed();
    return { ok: true, view: this.view(), secret };
  }

  /** Send a test event to an address now, once, and say how it went. */
  async test(rawId: unknown): Promise<{ ok: boolean; message: string }> {
    const id = idSchema.safeParse(rawId);
    if (!id.success || !this.addresses.has(id.data))
      return { ok: false, message: 'That address is not there now.' };
    const worker = this.ensureWorker();
    if (!worker) return { ok: false, message: 'Drashti is closing.' };
    const requestId = randomUUID();
    const event = this.event('drashti.test', {});
    const result = await new Promise<TryResult>((resolve) => {
      const cancel = this.later(TEST_WAIT_MS, () => {
        this.tests.delete(requestId);
        resolve({ error: 'timed out' });
      });
      this.tests.set(requestId, (r) => {
        cancel();
        resolve(r);
      });
      worker.post({ type: 'test', requestId, addressId: id.data, event });
    });
    this.noteResult(id.data, result);
    this.changed();
    // Started for the test alone: stopped again.
    this.sync();
    return testAnswer(result);
  }

  private event(
    type: string,
    data: Record<string, unknown>,
    id = `msg_${randomUUID().replace(/-/gu, '')}`,
  ): OutEvent {
    const at = this.deps.now();
    return { id, type, at, body: JSON.stringify({ type, timestamp: new Date(at).toISOString(), data }) };
  }

  /** The show made these: each goes to every address that is on and ticked its kind. */
  emit(events: readonly Emitted[]): void {
    if (this.closed || events.length === 0 || this.addresses.size === 0) return;
    for (const e of events) {
      const wanting = [...this.addresses].filter(([, a]) => !a.off && a.kinds.includes(e.kind));
      if (wanting.length === 0) continue;
      const worker = this.ensureWorker();
      if (!worker) return;
      // One id for the event, wherever it goes; with its words only where they were asked for.
      const id = `msg_${randomUUID().replace(/-/gu, '')}`;
      const plain = this.event(e.kind, e.data, id);
      const wordy = e.words ? this.event(e.kind, { ...e.data, ...e.words }, id) : plain;
      for (const [addressId, a] of wanting)
        worker.post({ type: 'event', addressId, event: a.words.includes(e.kind) ? wordy : plain });
    }
  }

  private workerAddresses(): WorkerAddress[] {
    return [...this.addresses]
      .filter(([, a]) => !a.off)
      .map(([id, a]) => ({
        id,
        url: a.url,
        secret: a.secret,
        oldSecret: a.oldSecret && a.oldSecret.until > this.deps.now() ? a.oldSecret : null,
        allowInternet: a.allowInternet,
      }));
  }

  /**
   * The worker told where the addresses are; started as soon as one is on with a kind ticked (so the first
   * event does not wait for a process to start), and stopped when none is (a test still waiting for its
   * answer keeps it till then).
   */
  private sync(): void {
    const wanted = [...this.addresses.values()].some((a) => !a.off && a.kinds.length > 0);
    if (wanted && !this.worker) {
      this.ensureWorker();
      return;
    }
    this.worker?.post({ type: 'addresses', list: this.workerAddresses() });
    if (!wanted && this.worker && this.tests.size === 0) {
      const worker = this.worker;
      this.worker = null;
      worker.kill();
    }
  }

  private ensureWorker(): EventsWorker | null {
    if (this.closed) return null;
    if (this.worker) return this.worker;
    this.restart?.();
    this.restart = null;
    const worker = this.deps.spawn();
    this.worker = worker;
    worker.onMessage((message) => {
      if (this.worker === worker) this.heard(message);
    });
    worker.onExit(() => {
      if (this.worker !== worker) return;
      this.worker = null;
      // Queued events go with it (they describe a show that has moved on); tests waiting are told.
      for (const [requestId, done] of this.tests) {
        this.tests.delete(requestId);
        done({ error: 'The events process stopped.' });
      }
      if (this.closed) return;
      this.deps.log('warn', 'Events out: the events process stopped; starting it again');
      this.restart = this.later(RESTART_MS, () => {
        this.restart = null;
        this.sync();
      });
    });
    worker.post({ type: 'start', onlyThisComputer: this.deps.onlyThisComputer });
    worker.post({ type: 'addresses', list: this.workerAddresses() });
    return worker;
  }

  private noteResult(addressId: string, result: TryResult): void {
    const s = this.statusOf(addressId);
    const now = this.deps.now();
    if ('status' in result && result.status >= 200 && result.status < 300) {
      s.lastSuccess = { at: now, status: result.status };
      s.setupProblem = false;
      const told = result.date ? Date.parse(result.date) : Number.NaN;
      s.clockOffBy = Number.isFinite(told) && Math.abs(told - now) > CLOCK_NOTE_MS ? told - now : null;
    } else {
      s.lastFailure = {
        at: now,
        status: 'status' in result ? result.status : null,
        error: 'error' in result ? plainError(result.error) : null,
      };
    }
  }

  private heard(message: FromEventsWorker): void {
    switch (message.type) {
      case 'guard':
        this.deps.log('warn', message.message);
        return;
      case 'test-result':
        this.tests.get(message.requestId)?.(message.result);
        this.tests.delete(message.requestId);
        return;
      case 'outcome':
        this.outcome(message.addressId, message.outcome);
        return;
    }
  }

  private outcome(addressId: string, outcome: Outcome): void {
    const saved = this.addresses.get(addressId);
    if (!saved) return;
    const s = this.statusOf(addressId);
    const host = new URL(saved.url).host;
    switch (outcome.kind) {
      case 'delivered':
        this.noteResult(addressId, {
          status: outcome.status,
          ...(outcome.date ? { date: outcome.date } : {}),
        });
        break;
      case 'retrying':
        this.noteResult(
          addressId,
          outcome.status !== null ? { status: outcome.status } : { error: outcome.error ?? 'failed' },
        );
        break;
      case 'dropped':
        this.noteResult(
          addressId,
          outcome.status !== null ? { status: outcome.status } : { error: outcome.error ?? 'failed' },
        );
        s.dropped += 1;
        break;
      case 'setup':
        if (!s.setupProblem)
          this.deps.log('warn', `Events out: ${host} answered ${String(outcome.status)}: set up wrongly?`);
        s.setupProblem = true;
        break;
      case 'gone': {
        s.lastFailure = { at: this.deps.now(), status: 410, error: null };
        this.keep(addressId, { ...saved, off: true });
        this.sync();
        this.deps.log('warn', `Events out: ${host} answered 410 (gone); sending to it stopped`);
        this.deps.notice(
          `Events out: ${host} said it is gone, so Drashti stopped sending to it. Turn it on again in File › Events Out….`,
        );
        this.changed();
        return;
      }
    }
    this.statusChanged();
  }

  close(): void {
    this.closed = true;
    this.restart?.();
    this.statusTimer?.();
    this.worker?.kill();
    this.worker = null;
  }
}
