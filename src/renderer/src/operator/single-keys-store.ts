import { create } from 'zustand';
import type { KeyBinding } from '../../../shared/keymap';
import { KEYMAP, withoutSingleKeys } from '../../../shared/keymap';

/*
 * Single-letter keys (Session 37, WCAG 2.1.4): B and . (Black-out), L (the Logo) and ? (the keys sheet) act
 * unless an admin turned them off with the switch in the keys sheet. Off, the window answers the keymap
 * without them and names none of them beside its buttons or in its key lines. Null until the main process
 * has said: the window shows nothing before it knows (App), so no key is ever heard before then.
 */

export const useSingleKeys = create<{ on: boolean | null }>(() => ({ on: null }));

let connected = false;

export function connectSingleKeys(): void {
  if (connected) return;
  connected = true;
  window.drashti.app.onSingleKeysChanged((on) => {
    useSingleKeys.setState({ on });
  });
  void window.drashti.app.singleKeys().then((on) => {
    useSingleKeys.setState({ on });
  });
}

/** The keys the window answers now: `keymap` as it is, or without B, ., L and ? while they are off. */
export function useKeymapNow(keymap: readonly KeyBinding[] = KEYMAP): readonly KeyBinding[] {
  const on = useSingleKeys((s) => s.on !== false);
  return on ? keymap : withoutSingleKeys(keymap);
}
