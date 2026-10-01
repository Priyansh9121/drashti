import { useCallback, useState } from 'react';

/*
 * Small things the operator window remembers on this computer (panel sizes,
 * folded panels, the chosen tab). Kept in the window's own storage, so a
 * missing or blocked store only means the defaults come back.
 */

const PREFIX = 'drashti.ui.';

export function readPersisted<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePersisted(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Not remembered this time.
  }
}

/** Like useState, remembered under `key` (null: not remembered). */
export function usePersistentState<T>(
  key: string | null,
  initial: T,
  valid: (v: unknown) => v is T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => (key ? readPersisted(key, initial, valid) : initial));
  const set = useCallback(
    (next: T) => {
      setValue(next);
      if (key) writePersisted(key, next);
    },
    [key],
  );
  return [value, set];
}
