import { useEffect, useReducer, useState } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import { engineNow } from './clock';
import { CuedStartKeeper } from './cued-start';
import { afterCueStart, heldUntilStarted } from './cue-started';
import { atGoMoment } from './go-moment';

/**
 * The scene a page draws while a cue waits for its Go (render/cued-start.ts). `startFirst`: the operator's LIVE preview
 * (QA23-CUELIVE-1), which keeps it past Go until its cued picture has started, even through Main's patch at Go, and
 * swaps after that start, never ahead of it. Every other page swaps on its first frame past Go, as before. `raw`: the
 * engine's own state, which `state` (Scene's prepared copy) was drawn from.
 */
export function useCuedStart(state: EngineState, startFirst = false, raw: EngineState = state): EngineState {
  const [keeper] = useState(() => new CuedStartKeeper(startFirst ? heldUntilStarted : undefined));
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const start = state.videoStart;
  const view = keeper.at(state, engineNow(), raw) ?? state;
  const holding = startFirst ? keeper.holding() : null;
  const heldId = holding?.id ?? null;
  const heldAt = holding?.at ?? null;
  useEffect(() => {
    if (startFirst || !start || engineNow() >= start.at) return;
    return atGoMoment(start.at, () => refresh(), { checkNow: false });
  }, [start, startFirst]);
  // LIVE: by the cue held, not by videoStart (which Main clears at Go): after its picture's start, or 250 ms past Go.
  useEffect(() => {
    if (heldId === null || heldAt === null) return;
    return atGoMoment(heldAt, () => refresh(), { checkNow: true, afterStart: afterCueStart(heldId) });
  }, [heldId, heldAt]);
  return view;
}
