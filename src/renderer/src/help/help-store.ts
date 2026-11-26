import { create } from 'zustand';
import { readPersisted, writePersisted } from '../ui/persist';

/*
 * Help on demand (alpha.24, the owner's "we also want a really innovative and non-congusted UI"): one Help switch, in
 * the status bar where its ? was (HelpSwitch.tsx), shows every "?" (WhatIsThis.tsx) and the keys beside the buttons'
 * words (help.css); while it is off, no ? is drawn at all and the keys are hidden to the eye, kept for screen readers.
 * Alt (Option on a Mac) held down on its own shows the keys while it is held, Help on or off. The switch is off at a
 * first start, so the window starts calm, and is remembered on this computer (ui/persist.ts: the window's own storage).
 */

/** Where the switch is remembered, on this computer. */
const HELP_KEY = 'help.on';

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

export interface HelpState {
  /** The switch: every ? and every button's key shown. */
  on: boolean;
  /** Alt (Option) held down on its own: the buttons' keys shown while it is. */
  alt: boolean;
  /** How many times it has been turned on in this window: a ? card left open does not come back open with it. */
  round: number;
}

export const useHelp = create<HelpState>(() => ({
  on: readPersisted(HELP_KEY, false, isBoolean),
  alt: false,
  round: 0,
}));

/** Turn Help on or off, and remember it on this computer. */
export function setHelp(on: boolean): void {
  writePersisted(HELP_KEY, on);
  const was = useHelp.getState();
  if (was.on !== on) useHelp.setState({ on, round: on ? was.round + 1 : was.round });
}

export function toggleHelp(): void {
  setHelp(!useHelp.getState().on);
}

/** The buttons' keys are shown: Help on, or Alt held on its own. */
export const keysShown = (s: HelpState): boolean => s.on || s.alt;

/** What a key or pointer event says of the keys held (a KeyboardEvent's or a PointerEvent's own parts). */
export interface AltEvent {
  type: string;
  key?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Whether Alt is held on its own after `e`, `held` before it: from Alt's own press with no other key held, until it is
 * let go or another key is pressed (Alt+1, the quick bar's, is a shortcut, not Alt on its own). A pointer moved or
 * pressed without Alt says it was let go where this window could not see it; a pointer never starts it.
 */
export function altAfter(held: boolean, e: AltEvent): boolean {
  if (e.type === 'keydown')
    return e.key === 'Alt' && e.ctrlKey !== true && e.metaKey !== true && e.shiftKey !== true;
  if (e.type === 'keyup') return e.key === 'Alt' ? false : held;
  return held && e.altKey === true;
}

/**
 * Follow Alt in `win` and keep its root saying when the buttons' keys are hidden (`data-keys-hidden`, help.css) until
 * the returned stop, which leaves the keys shown as before alpha.24. The operator window's status bar starts it, in Pro
 * and Simple Mode (before its first drawing, so no key shows and then goes); no other window does.
 */
export function connectKeyHints(win: Window): () => void {
  const root = win.document.documentElement;
  const follow = (e: Event) => {
    const was = useHelp.getState().alt;
    const alt = altAfter(was, e as AltEvent);
    if (alt !== was) useHelp.setState({ alt });
  };
  // The window losing the keyboard (Alt+Tab to another program): Alt's letting go goes there.
  const letGo = () => {
    if (useHelp.getState().alt) useHelp.setState({ alt: false });
  };
  const say = (s: HelpState) => {
    if (keysShown(s)) delete root.dataset['keysHidden'];
    else root.dataset['keysHidden'] = '';
  };
  const stop = new AbortController();
  // Before anything else sees them (a dialog's own keys stop there), only read: nothing is taken.
  for (const kind of ['keydown', 'keyup', 'pointerdown', 'pointermove'])
    win.addEventListener(kind, follow, { capture: true, signal: stop.signal });
  win.addEventListener('blur', letGo, { signal: stop.signal });
  say(useHelp.getState());
  const unsubscribe = useHelp.subscribe(say);
  return () => {
    stop.abort();
    unsubscribe();
    if (useHelp.getState().alt) useHelp.setState({ alt: false });
    delete root.dataset['keysHidden'];
  };
}
