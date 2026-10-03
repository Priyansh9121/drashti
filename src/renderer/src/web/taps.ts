import { create } from 'zustand';
import { useEngine } from '../engine/engine-store';
import type { ApiAnswer } from './device';

/*
 * Taps on a remote take effect in turn, as keys and buttons do in the
 * operator window (src/renderer/src/operator/actions.ts): each waits until
 * this device has seen what the one before it did, so Next pressed twice
 * quickly at the start of a playlist item goes on to its second slide
 * instead of starting the item again. A step that never ends (Drashti
 * gone) holds the next tap up three seconds at most.
 */

/** The last problem to show (for example "Nothing is live"), or null. */
export const useTapNotice = create<{ text: string | null }>(() => ({ text: null }));

/** Until this page's copy of the state has reached `rev` (a second at most). */
function seen(rev: number, ms = 1000): Promise<void> {
  return new Promise((resolve) => {
    if (useEngine.getState().rev >= rev) {
      resolve();
      return;
    }
    const stop = useEngine.subscribe((s) => {
      if (s.rev < rev) return;
      stop();
      clearTimeout(timer);
      resolve();
    });
    const timer = setTimeout(() => {
      stop();
      resolve();
    }, ms);
  });
}

function within(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}

let turn: Promise<void> = Promise.resolve();

/** Run a tap's request after the taps before it have been seen to take effect. */
export function tap(run: () => Promise<ApiAnswer<{ rev?: number }>>): Promise<void> {
  const mine = turn.then(async () => {
    const answer = await run();
    useTapNotice.setState({ text: answer.ok ? null : answer.message });
    if (answer.ok && typeof answer.rev === 'number') await seen(answer.rev);
  });
  turn = within(
    mine.catch(() => undefined),
    3000,
  );
  return mine;
}
