import { useEffect, useState } from 'react';
import { engineNow, onClockJump } from './clock';

/** The engine's time now, redrawn every `everyMs`, and at once when the clock jumps (held, or its offset set). */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => engineNow());
  useEffect(() => {
    const tick = () => {
      setNow(engineNow());
    };
    // eslint-disable-next-line no-restricted-syntax -- only asks for a new drawing: the time it draws is the engine's (engineNow)
    const t = setInterval(tick, everyMs);
    const off = onClockJump(tick);
    return () => {
      clearInterval(t);
      off();
    };
  }, [everyMs]);
  return now;
}
