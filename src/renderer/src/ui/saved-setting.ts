import { useState } from 'react';

/*
 * A setting the main process saves, as its boxes show it and change it (Session 54, Session 53's question 6): a
 * Look's layers and a kirtan's languages for a group, what an Events out address gets. Each box showed what was
 * saved, and each tick sent the whole setting made from that: a second tick made before the first was saved (the
 * main process slow for a moment, CI's Windows) was made to what was saved before the first, and put it back. Now a
 * change is shown at once, and the next is made to it; once every change has answered, what the main process saved
 * is shown again (so a change it refused goes back).
 */

/** Changes to one setting not all answered yet: the latest, which setting, and how many saves have to answer. */
export interface Unsaved<T> {
  key: string;
  value: T;
  waiting: number;
}

/** What the boxes show: the latest change while any to this setting has to answer, else what was saved. */
export function shownValue<T>(saved: T, unsaved: Unsaved<T> | null, key: string): T {
  return unsaved?.key === key ? unsaved.value : saved;
}

/** A change made: shown from now on, with one more save to answer (one to another setting starts afresh). */
export function changed<T>(unsaved: Unsaved<T> | null, key: string, value: T): Unsaved<T> {
  return { key, value, waiting: unsaved?.key === key ? unsaved.waiting + 1 : 1 };
}

/** A save has answered (saved or refused): once every one has, what the main process saved is shown again. */
export function answered<T>(unsaved: Unsaved<T> | null, key: string): Unsaved<T> | null {
  if (unsaved?.key !== key) return unsaved;
  return unsaved.waiting > 1 ? { ...unsaved, waiting: unsaved.waiting - 1 } : null;
}

/**
 * A setting the main process saves (`saved`, as its store has it now), named by `key` (a Look, a group and which of
 * its settings: one card can show another Look's), and how to save it, answered once its store has what was saved:
 * what the boxes show, and the change a box makes, computed from what they show.
 */
export function useSavedSetting<T>(
  key: string,
  saved: T,
  save: (value: T) => Promise<unknown>,
): [T, (value: T) => void] {
  const [unsaved, setUnsaved] = useState<Unsaved<T> | null>(null);
  const change = (value: T) => {
    setUnsaved((u) => changed(u, key, value));
    void save(value).finally(() => {
      setUnsaved((u) => answered(u, key));
    });
  };
  return [shownValue(saved, unsaved, key), change];
}
