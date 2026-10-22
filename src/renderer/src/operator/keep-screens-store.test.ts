import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingScreens } from '../../../shared/keep-screens';
import type { ScreensResult } from '../../../shared/screens';
import type * as KeepStore from './keep-screens-store';

/*
 * Keep these screens? as the operator window learns it (Session 50): the change waiting for an answer, as the
 * main process says, and the answer, sent once. The main process stood in for by a fake bridge.
 */

type Store = typeof KeepStore;

const asked: PendingScreens = { deadline: 1_000_000, coversControls: false };
const covering: PendingScreens = { deadline: 1_005_000, coversControls: true };
const EMPTY = { displays: [], groups: [], status: [], nodes: [] };

/** A fresh store (it connects once per page), connected to a bridge whose first answer is `pending`. */
async function connected(pending: () => Promise<PendingScreens | null>): Promise<{
  store: Store;
  tell: (pending: PendingScreens | null) => void;
  sent: string[];
  answer: (result: ScreensResult) => void;
}> {
  vi.resetModules();
  let listener: (pending: PendingScreens | null) => void = () => undefined;
  const sent: string[] = [];
  let answer: (result: ScreensResult) => void = () => undefined;
  const reply = (what: string) => {
    sent.push(what);
    return new Promise<ScreensResult>((resolve) => (answer = resolve));
  };
  (globalThis as { window?: unknown }).window = {
    drashti: {
      screens: {
        pending,
        onPending: (l: (pending: PendingScreens | null) => void) => {
          listener = l;
          return () => undefined;
        },
        keep: () => reply('keep'),
        goBack: () => reply('goBack'),
      },
    },
  };
  const store = await import('./keep-screens-store');
  store.connectKeepScreens();
  return { store, tell: (p) => listener(p), sent, answer: (r) => answer(r) };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe('Keep these screens?, as the operator window learns it', () => {
  it('shows a question already waiting as the window opens, then follows the main process', async () => {
    const { store, tell } = await connected(() => Promise.resolve(asked));
    await vi.waitFor(() => {
      expect(store.useKeepScreens.getState().pending).toEqual(asked);
    });
    tell(covering);
    expect(store.useKeepScreens.getState().pending).toEqual(covering);
    tell(null);
    expect(store.useKeepScreens.getState().pending).toBeNull();
  });

  it('a question heard before the first answer arrives wins over that answer', async () => {
    let first: (pending: PendingScreens | null) => void = () => undefined;
    const { store, tell } = await connected(() => new Promise((resolve) => (first = resolve)));
    tell(asked);
    first(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.useKeepScreens.getState().pending).toEqual(asked);
  });

  it('sends one answer at a time: Keep, then nothing more until the main process has answered', async () => {
    const { store, tell, sent, answer } = await connected(() => Promise.resolve(null));
    tell(asked);
    const kept = store.answerKeepScreens(true);
    void store.answerKeepScreens(false);
    expect(sent).toEqual(['keep']);
    expect(store.useKeepScreens.getState().answering).toBe(true);
    // The question goes (the main process says so first), then the answer comes.
    tell(null);
    answer({ ok: true, snapshot: EMPTY });
    await kept;
    expect(store.useKeepScreens.getState()).toEqual({ pending: null, answering: false, answered: 'kept' });
    // An answer that came too late (the question had gone by itself) says nothing: the main process told.
    tell(asked);
    const late = store.answerKeepScreens(false);
    answer({ ok: false, message: 'No screen change is waiting for an answer now.' });
    await late;
    expect(sent).toEqual(['keep', 'goBack']);
    expect(store.useKeepScreens.getState().answering).toBe(false);
  });

  it('remembers the answer this window gave, until the next question (Set Up Screens… reads it)', async () => {
    const { store, tell, answer } = await connected(() => Promise.resolve(null));
    tell(asked);
    expect(store.useKeepScreens.getState().answered).toBeNull();
    const back = store.answerKeepScreens(false);
    // Known before the main process says the question went (Set Up Screens… reads it then).
    expect(store.useKeepScreens.getState().answered).toBe('went-back');
    tell(null);
    answer({ ok: true, snapshot: EMPTY });
    await back;
    expect(store.useKeepScreens.getState().answered).toBe('went-back');
    // A new question: not answered here yet. The same one again (whether it covers the controls): as it was.
    tell(asked);
    expect(store.useKeepScreens.getState().answered).toBeNull();
    void store.answerKeepScreens(true);
    tell({ ...asked, coversControls: true });
    expect(store.useKeepScreens.getState().answered).toBe('kept');
    // A second change starts the countdown again: a new question.
    tell(covering);
    expect(store.useKeepScreens.getState().answered).toBeNull();
  });

  it('counts whole seconds left, never below none', async () => {
    const { store } = await connected(() => Promise.resolve(null));
    expect(store.secondsLeft(15_000, 0)).toBe(15);
    expect(store.secondsLeft(15_000, 999)).toBe(15);
    expect(store.secondsLeft(15_000, 1000)).toBe(14);
    expect(store.secondsLeft(15_000, 14_999)).toBe(1);
    expect(store.secondsLeft(15_000, 15_000)).toBe(0);
    expect(store.secondsLeft(15_000, 20_000)).toBe(0);
  });
});
