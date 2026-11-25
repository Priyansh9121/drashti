import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SabhaFlow } from '../../../shared/sabha-flow';

/*
 * The operator window's Sabha flow store (a22-review-flow round 2, S10): a Remove that Main refuses (it throws: the
 * access gate's stop, say) keeps the flow shown and says why, never an unhandled rejection. A placeholder flow only.
 */

const shown: SabhaFlow = {
  id: 'flow-0001-test',
  fileName: 'placeholder-flow.pdf',
  pageCount: 1,
  status: 'read',
  lang: 'en',
  headers: ['No.', 'Program'],
  items: [{ no: '1', cells: ['Opening'] }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Remove', () => {
  it('refused by Main: the flow stays, with a plain word why', async () => {
    vi.stubGlobal('window', {
      drashti: { flow: { remove: () => Promise.reject(new Error('Refused while Drashti is stopped')) } },
    });
    const { removeFlow, useFlow } = await import('./flow-store');
    useFlow.setState({ flow: shown, now: 0, loaded: true, problem: null });
    await expect(removeFlow()).resolves.toBeUndefined();
    expect(useFlow.getState().flow).toEqual(shown);
    expect(useFlow.getState().now).toBe(0);
    expect(useFlow.getState().problem).toBe('Drashti couldn’t remove the Sabha flow. Try again.');
  });

  it('done: the flow and Now go', async () => {
    vi.stubGlobal('window', { drashti: { flow: { remove: () => Promise.resolve(null) } } });
    const { removeFlow, useFlow } = await import('./flow-store');
    useFlow.setState({ flow: shown, now: 0, loaded: true, problem: null });
    await removeFlow();
    expect(useFlow.getState().flow).toBeNull();
    expect(useFlow.getState().now).toBeNull();
    expect(useFlow.getState().problem).toBeNull();
  });
});
