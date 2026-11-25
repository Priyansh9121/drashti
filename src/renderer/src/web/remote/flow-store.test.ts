import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkChange } from '../../../../shared/network';
import type { SabhaFlow, SabhaFlowSnapshot } from '../../../../shared/sabha-flow';
import {
  closeFlow,
  flowViews,
  loadFlow,
  loadFlowPage,
  openFlow,
  pictureKey,
  showFlowView,
  startFlow,
  turnPage,
  useFlow,
  zoomBy,
  zoomFit,
} from './flow-store';

/*
 * Sabha flow on a phone (alpha.23, QA23-FLOW-1 and QA23-FLOW-2): the phone reads the operator's current flow and its
 * Now when it comes online and each time Drashti says the flow changed, and follows it: another PDF chosen on the
 * computer starts its view again (its first page, the read list when it could be read) and lets the old pages go; one
 * removed says so. A page is fetched as a picture with this phone's token, for the flow it belongs to only. A stand-in
 * for Drashti's answers and the browser's fetch; made-up ids, placeholder words and a few made-up bytes.
 */

const drashti = vi.hoisted(() => ({
  asked: [] as string[],
  answers: new Map<string, unknown>(),
  online: [] as (() => void)[],
  changed: [] as ((what: string) => void)[],
}));

vi.mock('../device', () => ({
  api: (path: string) => {
    drashti.asked.push(path);
    return Promise.resolve(drashti.answers.get(path) ?? { ok: false, status: 404, message: 'No.' });
  },
  current: () => ({ token: 'test-made-up-token-flow', name: 'Placeholder phone', kind: 'remote' }),
}));

vi.mock('../feed', () => ({
  onOnline: (l: () => void) => {
    drashti.online.push(l);
    return () => undefined;
  },
  onListsChanged: (l: (what: string) => void) => {
    drashti.changed.push(l);
    return () => undefined;
  },
}));

const flow = (id: string, over: Partial<SabhaFlow> = {}): SabhaFlow => ({
  id,
  fileName: 'Placeholder evening order.pdf',
  pageCount: 3,
  status: 'read',
  lang: 'en',
  headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
  items: [
    { no: '1', cells: ['Placeholder opening', 'Placeholder words', '10 min', 'Placeholder A'] },
    { no: '2', cells: ['Placeholder talk', 'Placeholder topic', '10 min', 'Placeholder A'] },
  ],
  ...over,
});

const A = flow('flow-placeholder-000a');
const B = flow('flow-placeholder-000b', { status: 'no-text', items: [], headers: [], pageCount: 1 });

const answer = (snapshot: SabhaFlowSnapshot) => {
  drashti.answers.set('/api/v1/flow', { ok: true, ...snapshot });
};

const fetched: { url: string; auth: string | null }[] = [];
const made: string[] = [];
const revoked: string[] = [];
let pageAnswer: () => Response = () => new Response(new Uint8Array([0x89, 0x50]), { status: 200 });

beforeEach(() => {
  drashti.asked = [];
  drashti.answers = new Map();
  fetched.length = 0;
  made.length = 0;
  revoked.length = 0;
  pageAnswer = () => new Response(new Uint8Array([0x89, 0x50]), { status: 200 });
  vi.stubGlobal('fetch', (url: string, init: { headers?: Record<string, string> } = {}) => {
    fetched.push({ url, auth: init.headers?.['Authorization'] ?? null });
    return Promise.resolve(pageAnswer());
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:placeholder-${String(made.length)}`;
    made.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(url);
  });
  useFlow.setState({
    snapshot: null,
    problem: null,
    open: false,
    view: 'list',
    page: 0,
    zoom: 1,
    pictures: {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Sabha flow on a phone (alpha.23)', () => {
  it('reads the flow and its Now as it comes online, and again each time Drashti says the flow or the mode changed', async () => {
    startFlow();
    answer({ flow: A, state: { flowId: A.id, now: 0 } });
    for (const l of drashti.online) l();
    await loadFlow();
    expect(useFlow.getState().snapshot).toEqual({ flow: A, state: { flowId: A.id, now: 0 } });
    // Now marked on the computer: Drashti says the flow changed, and the phone follows.
    answer({ flow: A, state: { flowId: A.id, now: 1 } });
    drashti.asked = [];
    for (const l of drashti.changed) l('flow' satisfies NetworkChange);
    await loadFlow();
    expect(drashti.asked).toContain('/api/v1/flow');
    expect(useFlow.getState().snapshot?.state).toEqual({ flowId: A.id, now: 1 });
    // Simple Mode came on or went: read again (what may be read can change with it).
    drashti.asked = [];
    for (const l of drashti.changed) l('mode' satisfies NetworkChange);
    await loadFlow();
    expect(drashti.asked).toContain('/api/v1/flow');
    // Other lists changing are not the flow's.
    drashti.asked = [];
    for (const l of drashti.changed) l('playlists' satisfies NetworkChange);
    expect(drashti.asked).toEqual([]);
  });

  it('says why when the flow cannot be read, in Drashti’s words, keeping the flow it had (a 429 in a burst, say)', async () => {
    drashti.answers.set('/api/v1/flow', { ok: false, status: 500, message: 'Placeholder words: not now.' });
    await loadFlow();
    expect(useFlow.getState()).toMatchObject({ snapshot: null, problem: 'Placeholder words: not now.' });
    answer({ flow: A, state: { flowId: A.id, now: null } });
    await loadFlow();
    drashti.answers.set('/api/v1/flow', {
      ok: false,
      status: 429,
      message: 'Placeholder words: too many requests.',
    });
    await loadFlow();
    expect(useFlow.getState()).toMatchObject({
      snapshot: { flow: A, state: { flowId: A.id, now: null } },
      problem: 'Placeholder words: too many requests.',
    });
    answer({ flow: null, state: null });
    await loadFlow();
    expect(useFlow.getState()).toMatchObject({ snapshot: { flow: null, state: null }, problem: null });
  });

  it('shows the read list and the page for a flow it could read, and only the page for one it could not', () => {
    expect(flowViews(A)).toEqual(['list', 'page']);
    for (const status of ['no-text', 'unreadable', 'no-items'] as const)
      expect(flowViews(flow('flow-placeholder-000c', { status })), status).toEqual(['page']);
    expect(flowViews(null)).toEqual([]);
  });

  it('starts again with another PDF chosen on the computer: its first page, its own view, the old pages let go', async () => {
    answer({ flow: A, state: { flowId: A.id, now: 0 } });
    await loadFlow();
    openFlow();
    showFlowView('page');
    turnPage(1);
    zoomBy(1);
    await loadFlowPage(A.id, 1);
    const old = useFlow.getState().pictures[pictureKey(A.id, 1)];
    expect(old).toBe('blob:placeholder-0');
    expect(useFlow.getState()).toMatchObject({ view: 'page', page: 1, open: true });
    // The same flow read again (Now moved): nothing starts again.
    answer({ flow: A, state: { flowId: A.id, now: 1 } });
    await loadFlow();
    expect(useFlow.getState()).toMatchObject({ view: 'page', page: 1 });
    expect(revoked).toEqual([]);
    // Replaced by a scan: its page only, from its first, at the screen's width; the sheet stays open.
    answer({ flow: B, state: { flowId: B.id, now: null } });
    await loadFlow();
    expect(useFlow.getState()).toMatchObject({ view: 'page', page: 0, zoom: 1, open: true, pictures: {} });
    expect(revoked).toEqual([old]);
    // Replaced by one read well: the read list first.
    answer({ flow: A, state: { flowId: A.id, now: null } });
    await loadFlow();
    expect(useFlow.getState().view).toBe('list');
  });

  it('lets the pages go once the flow is removed on the computer', async () => {
    answer({ flow: A, state: { flowId: A.id, now: 0 } });
    await loadFlow();
    await loadFlowPage(A.id, 0);
    answer({ flow: null, state: null });
    await loadFlow();
    expect(useFlow.getState().pictures).toEqual({});
    expect(revoked).toEqual(['blob:placeholder-0']);
  });

  it('fetches a page with this phone’s token, for its flow, once', async () => {
    answer({ flow: A, state: { flowId: A.id, now: 0 } });
    await loadFlow();
    await loadFlowPage(A.id, 2);
    await loadFlowPage(A.id, 2);
    expect(fetched).toEqual([
      { url: `/api/v1/flow/pages/2?flow=${A.id}`, auth: 'Bearer test-made-up-token-flow' },
    ]);
    expect(useFlow.getState().pictures).toEqual({ [pictureKey(A.id, 2)]: 'blob:placeholder-0' });
  });

  it('lets a page go that comes after its flow was replaced, and reads the flow again when Drashti says it changed', async () => {
    answer({ flow: A, state: { flowId: A.id, now: 0 } });
    await loadFlow();
    // Replaced on the computer while the page was on its way.
    let replace: () => void = () => undefined;
    pageAnswer = () => {
      replace();
      return new Response(new Uint8Array([0x89, 0x50]), { status: 200 });
    };
    replace = () => {
      useFlow.setState({ snapshot: { flow: B, state: { flowId: B.id, now: null } } });
    };
    await loadFlowPage(A.id, 0);
    expect(useFlow.getState().pictures).toEqual({});
    expect(revoked).toEqual(made);
    // Drashti says the flow is no longer the one asked for (409): the phone reads it again.
    replace = () => undefined;
    useFlow.setState({ snapshot: { flow: A, state: { flowId: A.id, now: 0 } } });
    answer({ flow: B, state: { flowId: B.id, now: null } });
    pageAnswer = () => new Response('{}', { status: 409 });
    drashti.asked = [];
    await loadFlowPage(A.id, 1);
    expect(drashti.asked).toContain('/api/v1/flow');
    expect(useFlow.getState().snapshot?.flow?.id).toBe(B.id);
  });

  it('asks again, waiting longer each time, for a page that failed for a passing reason (503, 429, 500), while its flow is current', async () => {
    vi.useFakeTimers();
    try {
      answer({ flow: A, state: { flowId: A.id, now: 0 } });
      await loadFlow();
      for (const status of [503, 429, 500]) {
        fetched.length = 0;
        useFlow.setState({ pictures: {} });
        let answers = [status, status, 200];
        pageAnswer = () => {
          const next = answers[0] ?? 200;
          answers = answers.slice(1);
          return next === 200
            ? new Response(new Uint8Array([0x89, 0x50]), { status: 200 })
            : new Response('{}', { status: next });
        };
        await loadFlowPage(A.id, 0);
        // Not marked as failed: not had yet.
        expect(useFlow.getState().pictures[pictureKey(A.id, 0)], String(status)).toBeUndefined();
        expect(fetched, String(status)).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(999);
        expect(fetched, String(status)).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetched, String(status)).toHaveLength(2);
        // Longer the second time.
        await vi.advanceTimersByTimeAsync(1999);
        expect(fetched, String(status)).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetched, String(status)).toHaveLength(3);
        expect(useFlow.getState().pictures[pictureKey(A.id, 0)], String(status)).toMatch(/^blob:/u);
      }
      // Replaced meanwhile: not asked again.
      fetched.length = 0;
      useFlow.setState({ pictures: {} });
      pageAnswer = () => new Response('{}', { status: 503 });
      await loadFlowPage(A.id, 1);
      useFlow.setState({ snapshot: { flow: B, state: { flowId: B.id, now: null } } });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetched).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks again for the page shown when Drashti next says the flow changed, once its own tries are over', async () => {
    vi.useFakeTimers();
    try {
      answer({ flow: A, state: { flowId: A.id, now: 0 } });
      await loadFlow();
      openFlow();
      showFlowView('page');
      pageAnswer = () => new Response('{}', { status: 503 });
      await loadFlowPage(A.id, 0);
      await vi.advanceTimersByTimeAsync(120_000);
      const tries = fetched.length;
      expect(tries).toBeGreaterThan(1);
      await vi.advanceTimersByTimeAsync(120_000);
      // Its tries are over: no more by itself.
      expect(fetched).toHaveLength(tries);
      // Now marked on the computer: the flow is read again, and the page shown is asked for again.
      pageAnswer = () => new Response(new Uint8Array([0x89, 0x50]), { status: 200 });
      answer({ flow: A, state: { flowId: A.id, now: 1 } });
      await loadFlow();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetched).toHaveLength(tries + 1);
      expect(useFlow.getState().pictures[pictureKey(A.id, 0)]).toMatch(/^blob:/u);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks a page that could not be had, so the view says so and does not ask again and again', async () => {
    answer({ flow: A, state: { flowId: A.id, now: 0 } });
    await loadFlow();
    pageAnswer = () => new Response('{}', { status: 404 });
    await loadFlowPage(A.id, 0);
    expect(useFlow.getState().pictures[pictureKey(A.id, 0)]).toBe('failed');
    await loadFlowPage(A.id, 0);
    expect(fetched).toHaveLength(1);
  });

  it('turns the pages within the flow’s and zooms from the screen’s width to four times it', async () => {
    answer({ flow: A, state: { flowId: A.id, now: 0 } });
    await loadFlow();
    turnPage(-1);
    expect(useFlow.getState().page).toBe(0);
    turnPage(1);
    turnPage(1);
    turnPage(1);
    expect(useFlow.getState().page).toBe(2);
    for (let i = 0; i < 10; i++) zoomBy(1);
    expect(useFlow.getState().zoom).toBe(4);
    zoomBy(-1);
    expect(useFlow.getState().zoom).toBeLessThan(4);
    zoomFit();
    expect(useFlow.getState().zoom).toBe(1);
    for (let i = 0; i < 10; i++) zoomBy(-1);
    expect(useFlow.getState().zoom).toBe(1);
  });

  it('opens and closes the sheet, its view one the flow has', async () => {
    answer({ flow: B, state: { flowId: B.id, now: null } });
    await loadFlow();
    openFlow();
    expect(useFlow.getState()).toMatchObject({ open: true, view: 'page' });
    // The read list is not one a scan has.
    showFlowView('list');
    expect(useFlow.getState().view).toBe('page');
    closeFlow();
    expect(useFlow.getState().open).toBe(false);
  });
});
