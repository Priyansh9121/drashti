import { useEffect, useReducer, useState } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import { engineNow } from './clock';
import { CuedStartKeeper } from './cued-start';

export function useCuedStart(state: EngineState): EngineState {
  const [keeper] = useState(() => new CuedStartKeeper());
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const start = state.videoStart;
  useEffect(() => {
    if (!start || engineNow() >= start.at) return;
    let frame = 0;
    const tick = () => {
      if (engineNow() >= start.at) refresh();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [start]);
  return keeper.at(state, engineNow()) ?? state;
}
