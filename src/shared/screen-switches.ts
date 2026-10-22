import { type EngineState, isLayerEmpty, LAYER_NAMES } from './engine/state';
import type { ScreenRole, ScreensSnapshot, ScreenState } from './screens';

/*
 * Audience and Stage (Session 50): two switches, each closing this computer's output windows of its kind so their
 * displays go back to the computer, and opening them again where they were. The show carries on. Both are on
 * again at every start; off is never remembered.
 */

export type ScreenSwitch = 'audience' | 'stage';
export const SCREEN_SWITCHES = ['audience', 'stage'] as const satisfies readonly ScreenSwitch[];

/** Which are on: true for on. */
export interface ScreenSwitches {
  audience: boolean;
  stage: boolean;
}

export type ScreenSwitchResult = { ok: true; switches: ScreenSwitches } | { ok: false; message: string };

/** How every start finds them: both on. */
export const ALL_ON: Readonly<ScreenSwitches> = { audience: true, stage: true };

/** Each one's name, as the top bar, the View menu, the status bar and a phone say it. */
export const SWITCH_NAMES: Readonly<Record<ScreenSwitch, string>> = { audience: 'Audience', stage: 'Stage' };

/** What turning one off does, said before it happens (the user's words). */
export const SWITCH_OFF_WORDS: Readonly<Record<ScreenSwitch, string>> = {
  audience: 'The hall’s screens will show this computer’s desktop.',
  stage: 'The stage screens will show this computer’s desktop.',
};

/**
 * The question before one goes off and its button, the same words in the window, on an output over the controls
 * and in the View menu's own box (Session 51, S2-7: in the app's case, "Turn off", never "Turn Off").
 */
export const switchOffQuestion = (which: ScreenSwitch): string => `Turn ${SWITCH_NAMES[which]} off?`;
export const TURN_OFF = 'Turn off';

/**
 * What the screens dashboard shows of a switched-off screen in place of its picture (Session 51, S2-5): its
 * display shows the computer's desktop, so its last picture is never shown.
 */
export const SWITCHED_OFF_PICTURE = 'This computer’s desktop';

/** The picture of a screen the dashboard shows: none while it is switched off, whatever it had before. */
export function pictureWhile<T>(state: ScreenState | null, picture: T | null): T | null {
  return state === 'switched-off' ? null : picture;
}

/**
 * The switch a group's screens answer to: Audience for every group that shows the audience picture (key and fill
 * too, and an older group of no named kind, which draws it as well), Stage for the stage view; the stream's
 * picture is drawn off screen, so neither.
 */
export function switchFor(role: ScreenRole): ScreenSwitch | null {
  if (role === 'stage') return 'stage';
  return role === 'stream' ? null : 'audience';
}

/**
 * How many of this computer's windows a switch covers are open now: showing, or stopped (black, and tried again
 * on its display). A node's screens are another computer's, and never count.
 */
export function openUnder(snapshot: Pick<ScreensSnapshot, 'groups' | 'status'>, which: ScreenSwitch): number {
  const covered = new Set(
    snapshot.groups
      .filter((g) => switchFor(g.role) === which)
      .flatMap((g) => g.screens.filter((s) => s.nodeId === null).map((s) => s.id)),
  );
  return snapshot.status.filter(
    (st) => covered.has(st.screenId) && (st.state === 'showing' || st.state === 'stopped'),
  ).length;
}

/**
 * Whether the audience screens show anything at all: a layer with a picture (sound has none), black-out (the hall
 * sees black), the logo, or the idle rotation with something to show, started or on a group that shows it
 * whenever nothing is up.
 */
export function showsSomething(state: EngineState): boolean {
  if (state.blackout || state.logo !== null) return true;
  if (LAYER_NAMES.some((layer) => layer !== 'audio' && !isLayerEmpty(state.layers, layer))) return true;
  return (
    state.idle.items.length > 0 &&
    (state.idle.startedAt !== null || Object.values(state.look.groups).some((g) => g.idle === 'always'))
  );
}

/**
 * Turning one off asks first while its screens show something: none of its kind open, there is nothing to ask
 * about. Stage screens always show the stage view, so Stage asks whenever one is open; Audience asks while one
 * is open and anything is up, and while the state is not known yet (the safe side). How many are open not known
 * yet (`open` null: the window's first moments, before it has the screens, Session 51, S2-4), it asks too.
 */
export function asksFirst(which: ScreenSwitch, open: number | null, state: EngineState | null): boolean {
  if (open === null) return true;
  if (open === 0) return false;
  return which === 'stage' || state === null || showsSomething(state);
}
