import { useEffect, useReducer, useState } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import { engineNow } from './clock';
import { CuedStartKeeper } from './cued-start';
import { afterCueStart } from './cue-started';
import { atGoMoment } from './go-moment';

/** `startFirst`: the operator's LIVE preview, its swap after its cued picture's start (QA23-CUELIVE-1). */
export function useCuedStart(state: EngineState, startFirst = false): EngineState {
  const [keeper] = useState(() => new CuedStartKeeper());
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const start = state.videoStart;
  useEffect(() => {
    if (!start || engineNow() >= start.at) return;
    const afterStart = startFirst ? afterCueStart(start.id) : undefined;
    return atGoMoment(start.at, () => refresh(), { checkNow: false, ...(afterStart ? { afterStart } : {}) });
  }, [start, startFirst]);
  return keeper.at(state, engineNow()) ?? state;
}
