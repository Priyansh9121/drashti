import { useEffect, useReducer, useState } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import { engineNow } from './clock';
import { CuedStartKeeper } from './cued-start';
import { atGoMoment } from './go-moment';

export function useCuedStart(state: EngineState): EngineState {
  const [keeper] = useState(() => new CuedStartKeeper());
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const start = state.videoStart;
  useEffect(() => {
    if (!start || engineNow() >= start.at) return;
    return atGoMoment(start.at, () => refresh(), { checkNow: false });
  }, [start]);
  return keeper.at(state, engineNow()) ?? state;
}
