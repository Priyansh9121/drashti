import { useEffect, useState } from 'react';
import { engineNow } from './clock';

/** The time now, redrawn every `everyMs`. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => engineNow());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(engineNow());
    }, everyMs);
    return () => {
      clearInterval(t);
    };
  }, [everyMs]);
  return now;
}
