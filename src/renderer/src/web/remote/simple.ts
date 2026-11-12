import type { RemoteSimple } from '../../../../shared/network-phone';
import { useRemote } from './remote-store';

/*
 * Simple Mode on Drashti's computer, as the hall tells a phone: the computer's open playlist and the words the
 * phone shows once. The phone starts with that playlist and can open another. Main checks the phone's actions
 * against the Simple Mode rules in main/simple-mode-phones.ts.
 */

/** Simple Mode now (null: Pro Mode, or not read yet). */
export function useSimple(): RemoteSimple | null {
  return useRemote((s) => s.hall?.simple ?? null);
}

/** Whether Simple Mode is on now, outside React. */
export function simpleNow(): RemoteSimple | null {
  return useRemote.getState().hall?.simple ?? null;
}
