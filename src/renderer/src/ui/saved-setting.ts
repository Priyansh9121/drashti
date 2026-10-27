import { useState } from 'react';

/*
 * A setting the main process saves, as its boxes show it and change it (Session 54, Session 53's question 6): a
 * Look's layers and a kirtan's languages for a group, what an Events out address gets. Each box showed what was
 * saved, and each tick sent the whole setting made from that: a second tick made before the first was saved (the
 * main process slow for a moment, CI's Windows) was made to what was saved before the first, and put it back. Now a
 * change is shown at once, and the next is made to it; once every change has answered, what the main process saved
 * is shown again (so a change it refused goes back). And one save at a time for each setting (Session 54 review):
 * during an import the main process holds each save until the import gives way, each waiting on its own, so a second
 * could be written before the first and then be overwritten by it. A change made while a save is on its way waits,
 * only the latest, and goes once that save has answered.
 */

/** A change to one setting not saved yet: which setting, and the latest value, which its boxes show. */
export interface Unsaved<T> {
  key: string;
  value: T;
}

/** What the boxes show: the latest change while one to this setting is on its way or waiting, else what was saved. */
export function shownValue<T>(saved: T, unsaved: Unsaved<T> | null, key: string): T {
  return unsaved?.key === key ? unsaved.value : saved;
}

/**
 * One save at a time for each setting (by its key), in the order the changes were made: a change made while one is
 * on its way waits, only the latest, and is sent once that one has answered (saved or refused). `settled` hears of a
 * setting with nothing more on its way or waiting.
 */
export class SaveQueue<T> {
  private readonly going = new Map<string, { waiting: { value: T } | null }>();

  constructor(private readonly settled: (key: string) => void) {}

  save(key: string, value: T, save: (value: T) => Promise<unknown>): void {
    const going = this.going.get(key);
    if (going) {
      going.waiting = { value };
      return;
    }
    this.going.set(key, { waiting: null });
    void save(value).finally(() => {
      const waiting = this.going.get(key)?.waiting ?? null;
      this.going.delete(key);
      if (waiting) this.save(key, waiting.value, save);
      else this.settled(key);
    });
  }
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
  const [queue] = useState(
    () =>
      new SaveQueue<T>((done) => {
        setUnsaved((u) => (u?.key === done ? null : u));
      }),
  );
  const change = (value: T) => {
    setUnsaved({ key, value });
    queue.save(key, value, save);
  };
  return [shownValue(saved, unsaved, key), change];
}
