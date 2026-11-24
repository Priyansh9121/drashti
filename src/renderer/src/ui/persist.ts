import { useCallback, useState } from 'react';

/*
 * Small things the operator window remembers on this computer (panel sizes,
 * folded panels, the chosen tab). Kept in the window's own storage, so a
 * missing or blocked store only means the defaults come back.
 *
 * Some are remembered only while Drashti runs (alpha.22: the sections under
 * LIVE, folded at each start): in the window's session storage, which a
 * reload of the window keeps and a new start of Drashti begins empty.
 */

const PREFIX = 'drashti.ui.';

/** How long a thing is remembered: on this computer, or while Drashti runs. */
export type Keep = 'computer' | 'run';

const storeFor = (keep: Keep): Storage => (keep === 'run' ? window.sessionStorage : window.localStorage);

export function readPersisted<T>(
  key: string,
  fallback: T,
  valid: (v: unknown) => v is T,
  keep: Keep = 'computer',
): T {
  try {
    const raw = storeFor(keep).getItem(PREFIX + key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePersisted(key: string, value: unknown, keep: Keep = 'computer'): void {
  try {
    storeFor(keep).setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Not remembered this time.
  }
}

/** Like useState, remembered under `key` (null: not remembered), on this computer or while Drashti runs. */
export function usePersistentState<T>(
  key: string | null,
  initial: T,
  valid: (v: unknown) => v is T,
  keep: Keep = 'computer',
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => (key ? readPersisted(key, initial, valid, keep) : initial));
  const set = useCallback(
    (next: T) => {
      setValue(next);
      if (key) writePersisted(key, next, keep);
    },
    [key, keep],
  );
  return [value, set];
}
