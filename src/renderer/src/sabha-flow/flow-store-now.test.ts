import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SabhaFlow, SabhaFlowNowResult } from '../../../shared/sabha-flow';
import { flowBack, flowNext, NOW_NOT_MARKED, setFlowNow, useFlow } from './flow-store';

/*
 * Marking Now from the Sabha flow panel (alpha.23, QA23-FLOW-2; a22-review-flow M3): Back and Next step from the Now
 * last asked of Main, not from the one Main has answered, so two quick presses are two steps; Main's answer to the
 * latest ask says where Now is (an answer a newer ask overtook is not shown); a flow replaced meanwhile is refused and
 * never stepped from. Main stood in for: each ask answered when the test says. Placeholder words only.
 */

const flow = (id: string, count = 4): SabhaFlow => ({
  id,
  fileName: 'placeholder-flow.pdf',
  pageCount: 1,
  drawnPages: 1,
  status: 'read',
  lang: 'en',
  headers: ['No.', 'Program'],
  items: Array.from({ length: count }, (_, i) => ({
    no: String(i + 1),
    cells: [`Placeholder ${String(i + 1)}`],
  })),
});

interface Ask {
  flowId: string;
  now: number | null;
  answer: (result: SabhaFlowNowResult) => void;
}

let asks: Ask[] = [];

/** Main's answer to an ask: Now as asked. */
const kept = (ask: Ask | undefined): void => {
  if (!ask) throw new Error('no such ask');
  ask.answer({ ok: true, state: { flowId: ask.flowId, now: ask.now } });
};

const STALE = 'The Sabha flow has been replaced since: Now was not moved.';

/** Every answer given so far has been taken in. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** What was asked of Main, in order. */
const asked = () => asks.map((a) => [a.flowId, a.now]);

beforeEach(() => {
  asks = [];
  vi.stubGlobal('window', {
    drashti: {
      flow: {
        setNow: (flowId: string, now: number | null) =>
          new Promise<SabhaFlowNowResult>((answer) => {
            asks.push({ flowId, now, answer });
          }),
      },
    },
  });
});

afterEach(async () => {
  // Every ask answered, so none is left waiting for the next test.
  for (const a of asks) a.answer({ ok: false, message: STALE });
  await settled();
  vi.unstubAllGlobals();
});

const showing = (f: SabhaFlow, now: number | null) => {
  useFlow.setState({ flow: f, now, loaded: true, problem: null });
};

describe('Back and Next in the Sabha flow panel (a22-review-flow M3)', () => {
  it('two quick presses of Next, before Main answers, are two steps', async () => {
    showing(flow('flow-quick-0001'), null);
    flowNext();
    flowNext();
    expect(asked()).toEqual([
      ['flow-quick-0001', 0],
      ['flow-quick-0001', 1],
    ]);
    kept(asks[0]);
    kept(asks[1]);
    await settled();
    expect(useFlow.getState().now).toBe(1);
  });

  it('Next then Back quickly lands back where it began', async () => {
    showing(flow('flow-quick-0002'), 1);
    flowNext();
    flowBack();
    expect(asked()).toEqual([
      ['flow-quick-0002', 2],
      ['flow-quick-0002', 1],
    ]);
    kept(asks[0]);
    kept(asks[1]);
    await settled();
    expect(useFlow.getState().now).toBe(1);
  });

  it('a row clicked, then Next at once, steps from the row', () => {
    showing(flow('flow-quick-0003'), null);
    void setFlowNow(2);
    flowNext();
    expect(asked()).toEqual([
      ['flow-quick-0003', 2],
      ['flow-quick-0003', 3],
    ]);
  });

  it('asks nothing past the last item, nor back past not started, counting the asks on their way', () => {
    showing(flow('flow-quick-0004', 2), 0);
    flowNext();
    flowNext();
    expect(asked()).toEqual([['flow-quick-0004', 1]]);
    showing(flow('flow-quick-0005', 2), 1);
    flowBack();
    flowBack();
    flowBack();
    expect(asked().slice(1)).toEqual([
      ['flow-quick-0005', 0],
      ['flow-quick-0005', null],
    ]);
  });

  it('shows only the latest ask’s answer: one a newer ask overtook neither moves Now nor says a problem', async () => {
    showing(flow('flow-quick-0006', 6), 0);
    flowNext();
    flowNext();
    // Main answers the older ask as overtaken, after the newer one or before it.
    asks[0]?.answer({ ok: false, message: STALE });
    await settled();
    expect(useFlow.getState().problem).toBeNull();
    kept(asks[1]);
    await settled();
    expect(useFlow.getState()).toMatchObject({ now: 2, problem: null });
    // The newer answered first, then the older: Now stays the newer's.
    flowNext();
    flowNext();
    expect(asked().slice(2)).toEqual([
      ['flow-quick-0006', 3],
      ['flow-quick-0006', 4],
    ]);
    kept(asks[3]);
    await settled();
    kept(asks[2]);
    await settled();
    expect(useFlow.getState().now).toBe(4);
  });

  it('a refusal of the latest ask says why, and the next press steps from Main’s Now again', async () => {
    showing(flow('flow-quick-0007'), 1);
    flowNext();
    asks[0]?.answer({ ok: false, message: 'There is no such item in the Sabha flow.' });
    await settled();
    expect(useFlow.getState()).toMatchObject({ now: 1, problem: 'There is no such item in the Sabha flow.' });
    flowNext();
    expect(asked()[1]).toEqual(['flow-quick-0007', 2]);
  });

  it('never steps from a Now asked of a flow replaced meanwhile; that ask’s answer is not this flow’s', async () => {
    showing(flow('flow-old-00001'), 1);
    flowNext();
    // Another PDF chosen (its flow told by Main) while that ask is on its way.
    showing(flow('flow-new-00001'), null);
    flowNext();
    expect(asked()).toEqual([
      ['flow-old-00001', 2],
      ['flow-new-00001', 0],
    ]);
    asks[0]?.answer({ ok: false, message: STALE });
    kept(asks[1]);
    await settled();
    expect(useFlow.getState()).toMatchObject({ now: 0, problem: null });
  });

  it('an ask that fails on its way (no answer from Main) says so in plain words, and the next press steps from Main’s Now', async () => {
    showing(flow('flow-quick-0008'), 1);
    vi.stubGlobal('window', {
      drashti: { flow: { setNow: () => Promise.reject(new Error('placeholder: the ask failed')) } },
    });
    await setFlowNow(2);
    expect(useFlow.getState()).toMatchObject({ now: 1, problem: NOW_NOT_MARKED });
    expect(NOW_NOT_MARKED).toMatch(/^Drashti couldn’t mark Now\b.*\.$/u);
    const tried: (number | null)[] = [];
    vi.stubGlobal('window', {
      drashti: {
        flow: {
          setNow: (_id: string, now: number | null) => {
            tried.push(now);
            return new Promise<SabhaFlowNowResult>(() => undefined);
          },
        },
      },
    });
    flowNext();
    expect(tried).toEqual([2]);
  });
});
