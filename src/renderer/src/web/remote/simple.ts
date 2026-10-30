import type { RemoteSimple } from '../../../../shared/network-phone';
import { useRemote } from './remote-store';

/*
 * Simple Mode on Drashti's computer, as the hall tells a phone (Session 55, Part 9): its one playlist and the words the
 * phone shows once. While it is on, the phone shows only what Simple Mode's window has, dims what it may not do there,
 * and opens that playlist; the main process refuses the rest all the same (main/simple-mode-phones.ts).
 */

/** Simple Mode now (null: Pro Mode, or not read yet). */
export function useSimple(): RemoteSimple | null {
  return useRemote((s) => s.hall?.simple ?? null);
}

/** Whether Simple Mode is on now, outside React. */
export function simpleNow(): RemoteSimple | null {
  return useRemote.getState().hall?.simple ?? null;
}
