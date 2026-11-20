import { useSyncExternalStore } from 'react';
import { playingNow } from '../../../shared/engine/playing';
import type { EngineState } from '../../../shared/engine/state';

/*
 * Tests only (DRASHTI_TEST_RENDER_ERRORS: a packaged Drashti never sends it): a hall screen whose scene fails each time
 * it draws while one file is up (x53; the owner's Q60-31 bug hunt, x52's D6a), as a layer whose data makes a component
 * throw would. Main names the file (null: none), and this page keeps it until it loads again. Until a test names one,
 * nothing here runs but the subscription.
 */

let named: string | null = null;
const listeners = new Set<() => void>();
let listening = false;

function subscribe(listener: () => void): () => void {
  if (!listening) {
    listening = true;
    window.drashti.output.onTestThrowWhile((mediaId) => {
      named = mediaId;
      for (const told of listeners) told();
    });
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const current = (): string | null => named;

/** Whether `mediaId` is up: the background's file (a picture or a video), or a video playing on the slide or in the box. */
export function failsWhileUp(state: EngineState, mediaId: string | null): boolean {
  if (mediaId === null) return false;
  const bg = state.layers.background;
  if (bg?.kind === 'media' && bg.mediaId === mediaId) return true;
  return playingNow(state).some((p) => p.mediaId === mediaId);
}

/** Whether this screen's scene is to fail as it draws now: a test named a file, and it is up. */
export function useTestFailsWhileUp(state: EngineState): boolean {
  return failsWhileUp(state, useSyncExternalStore(subscribe, current, current));
}
