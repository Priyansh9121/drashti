import { useEffect, useState } from 'react';

/** The time now, redrawn every `everyMs`. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, everyMs);
    return () => {
      clearInterval(t);
    };
  }, [everyMs]);
  return now;
}
