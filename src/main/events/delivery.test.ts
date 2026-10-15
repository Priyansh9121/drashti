import { describe, expect, it } from 'vitest';
import type { DeliveryDeps, OutEvent, Outcome, TryResult } from './delivery';
import { COLLAPSE_MS, Deliveries, QUEUE_MAX, RETRY_MS } from './delivery';

/*
 * Events out's deliveries (Session 28, decision 20), on a clock of the test's own: in order, one at a time
 * for each address; slide changes within 250 ms collapse; retries at once, after 5 s, 30 s, 2 min, 10 min
 * and 30 min, then dropped and counted; a 410 turns the address off; a 404 is a setup problem tried twice
 * more; the newest 500 kept.
 */

function harness(answer: (event: OutEvent, attempt: number) => TryResult) {
  let now = 1_000_000;
  const timers: { at: number; wake: () => void }[] = [];
  const sent: { id: string; attempt: number; at: number }[] = [];
  const outcomes: Outcome[] = [];
  const pending: (() => void)[] = [];
  const deps: DeliveryDeps = {
    now: () => now,
    send: (_address, event, attempt) => {
      sent.push({ id: event.id, attempt, at: now });
      return new Promise((resolve) => {
        pending.push(() => resolve(answer(event, attempt)));
      });
    },
    report: (_address, _event, outcome) => outcomes.push(outcome),
    later: (ms, wake) => {
      const t = { at: now + ms, wake };
      timers.push(t);
      return () => timers.splice(timers.indexOf(t), 1);
    },
    random: () => 0.5,
  };
  const d = new Deliveries(deps);
  /** Answer what has been sent, and let the queue go on. */
  const answerAll = async () => {
    while (pending.length > 0) {
      pending.shift()?.();
      await new Promise((r) => setImmediate(r));
    }
  };
  /** Move the clock on, waking what is due, answering as it goes. */
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      await answerAll();
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      timers.splice(timers.indexOf(due), 1);
      due.wake();
    }
    now = end;
    await answerAll();
  };
  const event = (id: string, type = 'item.changed', at = now): OutEvent => ({ id, type, body: '{}', at });
  return { d, sent, outcomes, event, advance, answerAll, setNow: (t: number) => (now = t) };
}

describe("events out's deliveries", () => {
  it('sends in order, one at a time, each once on success', async () => {
    const h = harness(() => ({ status: 200 }));
    h.d.add('a', h.event('e1'));
    h.d.add('a', h.event('e2'));
    h.d.add('a', h.event('e3'));
    expect(h.sent.map((s) => s.id)).toEqual(['e1']);
    await h.answerAll();
    expect(h.sent.map((s) => s.id)).toEqual(['e1', 'e2', 'e3']);
    expect(h.outcomes.map((o) => o.kind)).toEqual(['delivered', 'delivered', 'delivered']);
  });

  it('retries at once, then after 5 s, 30 s, 2 min, 10 min and 30 min, the same event (same id), then drops it and counts it', async () => {
    const h = harness(() => ({ status: 503 }));
    h.d.add('a', h.event('e1'));
    await h.advance(3 * 60 * 60 * 1000);
    expect(h.sent.map((s) => s.id)).toEqual(Array(RETRY_MS.length + 1).fill('e1'));
    const waits = h.sent.slice(1).map((s, i) => s.at - (h.sent[i]?.at ?? 0));
    // The waits (with a 0.5 jitter roll: no jitter at all).
    expect(waits).toEqual([...RETRY_MS]);
    expect(h.outcomes.at(-1)).toMatchObject({ kind: 'dropped', status: 503, dropped: 1 });
    expect(h.d.waiting('a')).toMatchObject({ waiting: 0, dropped: 1 });
  });

  it('a 410 turns the address off: nothing more is queued or sent', async () => {
    const h = harness(() => ({ status: 410 }));
    h.d.add('a', h.event('e1'));
    h.d.add('a', h.event('e2'));
    await h.advance(60_000);
    expect(h.sent.map((s) => s.id)).toEqual(['e1']);
    expect(h.outcomes).toEqual([{ kind: 'gone' }]);
    h.d.add('a', h.event('e3'));
    await h.advance(60_000);
    expect(h.sent).toHaveLength(1);
    expect(h.d.waiting('a').off).toBe(true);
  });

  it('a 404 (and a redirect, never followed) is a setup problem, tried twice more, then dropped', async () => {
    for (const status of [404, 302]) {
      const h = harness(() => ({ status }));
      h.d.add('a', h.event('e1'));
      await h.advance(60 * 60 * 1000);
      expect(h.sent, String(status)).toHaveLength(3);
      expect(h.outcomes.some((o) => o.kind === 'setup')).toBe(true);
      expect(h.outcomes.filter((o) => o.kind === 'dropped')).toHaveLength(1);
    }
  });

  it('network errors, 408 and 429 are retried as 5xx are', async () => {
    let n = 0;
    const answers: TryResult[] = [
      { error: 'ECONNREFUSED' },
      { status: 408 },
      { status: 429 },
      { status: 204 },
    ];
    const h = harness(() => answers[n++] ?? { status: 200 });
    h.d.add('a', h.event('e1'));
    await h.advance(10 * 60 * 1000);
    expect(h.sent.map((s) => s.attempt)).toEqual([1, 2, 3, 4]);
    expect(h.outcomes.at(-1)).toMatchObject({ kind: 'delivered', status: 204 });
  });

  it('slide changes within 250 ms collapse to the latest, never the one being sent', async () => {
    const h = harness(() => ({ status: 200 }));
    h.d.add('a', h.event('s1', 'slide.changed'));
    // s1 is on its way: s2 waits behind it, and s3 (100 ms later) takes s2's place.
    h.d.add('a', h.event('s2', 'slide.changed'));
    h.setNow(1_000_100);
    h.d.add('a', h.event('s3', 'slide.changed'));
    // Later than 250 ms: kept.
    h.setNow(1_000_100 + COLLAPSE_MS + 1);
    h.d.add('a', h.event('s4', 'slide.changed'));
    await h.answerAll();
    expect(h.sent.map((s) => s.id)).toEqual(['s1', 's3', 's4']);
  });

  it('keeps the newest 500 waiting, counting those dropped', () => {
    const h = harness(() => ({ status: 200 }));
    for (let i = 0; i < QUEUE_MAX + 20; i++) h.d.add('a', h.event(`e${String(i)}`));
    expect(h.d.waiting('a')).toMatchObject({ waiting: QUEUE_MAX, dropped: 20 });
    // Each said, so the address's count of those dropped is right.
    expect(h.outcomes.filter((o) => o.kind === 'dropped')).toHaveLength(20);
  });

  it('one address waiting never holds another up', async () => {
    const h = harness((event) => (event.id.startsWith('slow') ? { status: 503 } : { status: 200 }));
    h.d.add('slow-address', h.event('slow1'));
    h.d.add('quick-address', h.event('quick1'));
    await h.answerAll();
    expect(h.sent.map((s) => s.id)).toContain('quick1');
    expect(h.outcomes.some((o) => o.kind === 'delivered')).toBe(true);
  });
});
