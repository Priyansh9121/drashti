import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reportReference, type ReportCallReport } from '../../shared/report';
import { ReportOutbox, type OutboxDeps, type SendOutcome, type StoredReport } from './outbox';

/*
 * Help › Report a Problem…'s outbox (x49): a report Sent is kept in its own folder and goes by itself, once: at once if
 * it can; after no answer, again after 1, 5, 15, 30 and 60 minutes and whenever the network comes back; never while the
 * stream or a recording is on (the owner's "Yes, all A" to Q60-42, 3), an upload under way given up when it starts; at
 * most 5 a day from this computer (the sixth waits for the next day); refused for good only for what no retry changes.
 * Placeholder words and files only.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const START = Date.UTC(2026, 10, 20, 9, 0, 0);
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The timers, on a clock the test moves. */
class Clock {
  t = START;
  private n = 0;
  private timers: { at: number; run: () => void; id: number }[] = [];

  setTimer = (ms: number, run: () => void): (() => void) => {
    const id = ++this.n;
    this.timers.push({ at: this.t + ms, run, id });
    return () => {
      this.timers = this.timers.filter((x) => x.id !== id);
    };
  };

  async advance(ms: number): Promise<void> {
    const until = this.t + ms;
    await settle();
    for (;;) {
      const next = this.timers.filter((x) => x.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.timers = this.timers.filter((x) => x !== next);
      this.t = next.at;
      next.run();
      await settle();
      await settle();
    }
    this.t = until;
    await settle();
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Harness {
  dir: string;
  clock: Clock;
  outbox: ReportOutbox;
  tries: string[];
  reached: string[];
  onAir: { on: boolean };
  letIn: { on: boolean };
  outcomes: (SendOutcome | ((stop: AbortSignal) => Promise<SendOutcome>))[];
}

const OK = (id: string): SendOutcome => ({ ok: true, reference: reportReference(id), again: false });
const NO_ANSWER: SendOutcome = { ok: false, kind: 'no-answer', stopped: false };

function harness(o: { dir?: string; clock?: Clock } = {}): Harness {
  const dir =
    o.dir ??
    (() => {
      const d = mkdtempSync(join(tmpdir(), 'drashti-outbox-'));
      dirs.push(d);
      return d;
    })();
  const clock = o.clock ?? new Clock();
  const h: Partial<Harness> & { tries: string[]; reached: string[]; outcomes: Harness['outcomes'] } = {
    tries: [],
    reached: [],
    outcomes: [],
  };
  const onAir = { on: false };
  const letIn = { on: true };
  const deps: OutboxDeps = {
    dir,
    send: (report, data, stop) => {
      h.tries.push(report.id);
      expect(JSON.parse(data.toString('utf8'))).toEqual(
        JSON.parse(readFileSync(join(dir, report.id, 'data.json'), 'utf8')),
      );
      const next = h.outcomes.shift() ?? OK(report.id);
      return typeof next === 'function' ? next(stop) : Promise.resolve(next);
    },
    canSend: () => letIn.on,
    onAir: () => onAir.on,
    now: () => clock.t,
    setTimer: clock.setTimer,
    retryMs: [MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, 60 * MINUTE],
    startDelayMs: 2 * MINUTE,
    pollMs: 2000,
    changed: () => undefined,
    reached: (r) => {
      h.reached.push(r.id);
    },
    log: () => undefined,
    // Read at once, so the timers here are the only clock.
    readData: (file) => Promise.resolve(readFileSync(file)),
  };
  return Object.assign(h, { dir, clock, outbox: new ReportOutbox(deps), onAir, letIn });
}

const FILE = Buffer.from('== Drashti diagnostics ==\nPlaceholder\n', 'utf8');
const FILE_NAME = 'Drashti diagnostics 2026-11-20 09-00.txt';

/** A report as Review leaves it: its folder (as the report worker writes it) and its report.json, prepared. */
function prepare(h: Harness, id = randomBytes(16).toString('hex')): string {
  mkdirSync(join(h.dir, id, 'files'), { recursive: true });
  writeFileSync(join(h.dir, id, 'files', FILE_NAME), FILE);
  const sha = createHash('sha256').update(FILE).digest('hex');
  writeFileSync(join(h.dir, id, 'data.json'), JSON.stringify({ [sha]: FILE.toString('base64') }));
  const call: ReportCallReport = {
    id,
    written: h.clock.t,
    from: 'pro',
    features: [{ chapter: 'Stream', name: 'Going live', what: 'Placeholder words.' }],
    files: [{ kind: 'diagnostics', name: FILE_NAME, type: 'text/plain', bytes: FILE.length, sha256: sha }],
  };
  const reference = reportReference(id);
  h.outbox.prepared({
    id,
    reference,
    prepared: h.clock.t,
    subject: `Drashti problem: Going live (${reference})`,
    text: `Drashti problem ${reference}\n\nPlaceholder text as reviewed.`,
    call,
  });
  return id;
}

const stateOf = (h: Harness, id: string) => h.outbox.list().find((r) => r.id === id)?.state;
const kept = (h: Harness, id: string) =>
  (JSON.parse(readFileSync(join(h.dir, id, 'report.json'), 'utf8')) as StoredReport).state;

describe('the outbox', () => {
  it('Send tries a report at once: received, it is sent, with its reference, and its folder is kept', async () => {
    const h = harness();
    const id = prepare(h);
    expect(stateOf(h, id)).toEqual({ kind: 'prepared' });
    const state = await h.outbox.send(id);
    expect(state).toEqual({ kind: 'sent', reference: reportReference(id), at: START });
    expect(h.tries).toEqual([id]);
    expect(kept(h, id)).toMatchObject({ kind: 'sent' });
    expect(h.outbox.list()[0]).toMatchObject({ id, sentAt: START, tries: 1 });
    // Sent at its first try: the window says so itself.
    expect(h.reached).toEqual([]);
  });

  it('with no answer it is kept, and tried again after 1, 5, 15, 30 and 60 minutes, and at once when woken; once it goes, that is told', async () => {
    const h = harness();
    const id = prepare(h);
    h.outcomes.push(NO_ANSWER, NO_ANSWER, NO_ANSWER, NO_ANSWER);
    expect(await h.outbox.send(id)).toEqual({ kind: 'waiting', why: 'unreachable', next: START + MINUTE });
    await h.clock.advance(MINUTE - 1);
    expect(h.tries).toHaveLength(1);
    await h.clock.advance(1);
    expect(h.tries).toHaveLength(2);
    expect(stateOf(h, id)).toEqual({ kind: 'waiting', why: 'unreachable', next: h.clock.t + 5 * MINUTE });
    h.outbox.wake();
    await h.clock.advance(0);
    expect(h.tries).toHaveLength(3);
    await h.clock.advance(15 * MINUTE);
    expect(h.tries).toHaveLength(4);
    await h.clock.advance(30 * MINUTE);
    expect(h.tries).toHaveLength(5);
    expect(stateOf(h, id)).toMatchObject({ kind: 'sent' });
    expect(h.reached).toEqual([id]);
    // Sent: never tried again.
    await h.clock.advance(DAY);
    expect(h.tries).toHaveLength(5);
  });

  it('waits while the stream or a recording is on, and goes once it has ended; an upload under way is given up when one starts, and goes again after', async () => {
    const h = harness();
    const id = prepare(h);
    h.onAir.on = true;
    expect(await h.outbox.send(id)).toEqual({ kind: 'waiting', why: 'on-air', next: null });
    await h.clock.advance(10 * MINUTE);
    expect(h.tries).toEqual([]);
    h.onAir.on = false;
    await h.clock.advance(2000);
    expect(h.tries).toEqual([id]);
    expect(stateOf(h, id)).toMatchObject({ kind: 'sent' });

    const second = prepare(h);
    let given = false;
    h.outcomes.push(
      (stop) =>
        new Promise<SendOutcome>((resolve) => {
          stop.addEventListener('abort', () => {
            given = true;
            resolve({ ok: false, kind: 'no-answer', stopped: true });
          });
        }),
    );
    const sending = h.outbox.send(second);
    await h.clock.advance(0);
    expect(stateOf(h, second)).toEqual({ kind: 'sending' });
    h.onAir.on = true;
    await h.clock.advance(2000);
    expect(given).toBe(true);
    expect(await sending).toEqual({ kind: 'waiting', why: 'on-air', next: null });
    await h.clock.advance(5 * MINUTE);
    expect(h.tries.filter((t) => t === second)).toHaveLength(1);
    h.onAir.on = false;
    await h.clock.advance(2000);
    expect(h.tries.filter((t) => t === second)).toHaveLength(2);
    expect(stateOf(h, second)).toMatchObject({ kind: 'sent' });
  });

  it('refused for the day (too-many, mail-limit): kept until the list’s next day', async () => {
    for (const error of ['too-many', 'mail-limit'] as const) {
      const h = harness();
      const id = prepare(h);
      h.outcomes.push({ ok: false, kind: 'refused', error });
      const tomorrow = (Math.floor(START / DAY) + 1) * DAY + MINUTE;
      expect(await h.outbox.send(id)).toEqual({ kind: 'waiting', why: 'tomorrow', next: tomorrow });
      await h.clock.advance(tomorrow - START - 1);
      expect(h.tries).toHaveLength(1);
      await h.clock.advance(1);
      expect(h.tries).toHaveLength(2);
      expect(stateOf(h, id)).toMatchObject({ kind: 'sent' });
    }
  });

  it('refused not-in, or bad-request by a list that takes no reports yet: kept and tried every hour, never dropped; too-large: refused for good', async () => {
    const h = harness();
    const id = prepare(h);
    h.outcomes.push(
      { ok: false, kind: 'refused', error: 'bad-request' },
      { ok: false, kind: 'refused', error: 'not-in' },
    );
    expect(await h.outbox.send(id)).toEqual({ kind: 'waiting', why: 'list', next: START + 60 * MINUTE });
    await h.clock.advance(60 * MINUTE);
    expect(h.tries).toHaveLength(2);
    await h.clock.advance(60 * MINUTE);
    expect(h.tries).toHaveLength(3);
    expect(stateOf(h, id)).toMatchObject({ kind: 'sent' });

    const large = prepare(h);
    h.outcomes.push({ ok: false, kind: 'refused', error: 'too-large' });
    expect(await h.outbox.send(large)).toEqual({ kind: 'refused', why: 'too-large' });
    await h.clock.advance(DAY);
    expect(h.tries.filter((t) => t === large)).toHaveLength(1);
  });

  it('sends 5 a day from this computer: the sixth waits for the next day without asking the list', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) expect(await h.outbox.send(prepare(h))).toMatchObject({ kind: 'sent' });
    expect(h.outbox.sentToday()).toBe(5);
    const sixth = prepare(h);
    const tomorrow = (Math.floor(START / DAY) + 1) * DAY + MINUTE;
    expect(await h.outbox.send(sixth)).toEqual({ kind: 'waiting', why: 'tomorrow', next: tomorrow });
    expect(h.tries).toHaveLength(5);
    await h.clock.advance(tomorrow - START);
    expect(h.tries).toHaveLength(6);
    expect(stateOf(h, sixth)).toMatchObject({ kind: 'sent' });
  });

  it('nothing goes while this computer is not let in; let in again, it goes', async () => {
    const h = harness();
    const id = prepare(h);
    h.letIn.on = false;
    expect(await h.outbox.send(id)).toEqual({ kind: 'waiting', why: 'unreachable', next: null });
    await h.clock.advance(DAY);
    expect(h.tries).toEqual([]);
    h.letIn.on = true;
    h.outbox.wake();
    await h.clock.advance(0);
    expect(h.tries).toEqual([id]);
  });

  it('after a restart, the reports kept are tried 2 minutes after the start; a report prepared and never sent is cleared', async () => {
    const first = harness();
    const id = prepare(first);
    first.outcomes.push(NO_ANSWER);
    await first.outbox.send(id);
    const unsent = prepare(first);
    first.outbox.dispose();
    const again = harness({ dir: first.dir, clock: first.clock });
    again.outbox.start();
    expect(again.outbox.list().map((r) => r.id)).toEqual([id]);
    expect(existsSync(join(first.dir, unsent))).toBe(false);
    await again.clock.advance(2 * MINUTE - 1);
    expect(again.tries).toEqual([]);
    await again.clock.advance(1);
    expect(again.tries).toEqual([id]);
    expect(stateOf(again, id)).toMatchObject({ kind: 'sent' });
  });

  it('Remove: a kept report is never sent; Save a Copy… writes the email’s text and its files in a folder of its own', async () => {
    const h = harness();
    const id = prepare(h);
    h.outcomes.push(NO_ANSWER);
    await h.outbox.send(id);
    const into = mkdtempSync(join(tmpdir(), 'drashti-copy-'));
    dirs.push(into);
    const folder = h.outbox.saveCopy(id, into);
    expect(folder).toBe(join(into, `Drashti report ${reportReference(id)}`));
    expect(readdirSync(folder ?? '').sort()).toEqual([FILE_NAME, 'report.txt']);
    expect(readFileSync(join(folder ?? '', 'report.txt'), 'utf8')).toBe(
      `Subject: Drashti problem: Going live (${reportReference(id)})\n\nDrashti problem ${reportReference(id)}\n\nPlaceholder text as reviewed.\n`,
    );
    expect(readFileSync(join(folder ?? '', FILE_NAME))).toEqual(FILE);
    expect(h.outbox.remove(id)).toBe(true);
    expect(existsSync(join(h.dir, id))).toBe(false);
    expect(h.outbox.list()).toEqual([]);
    await h.clock.advance(2 * 60 * MINUTE);
    expect(h.tries).toEqual([id]);
  });
});
