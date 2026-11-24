import { type EngineState, isLayerEmpty, LAYER_NAMES } from './engine/state';
import type { DeviceInfo, NetworkStatus } from './network';
import type { ScreenRole, ScreensSnapshot, ScreenState } from './screens';

/*
 * Audience and Stage (Session 50): two switches. Audience off closes this computer's output windows of its kind so
 * their displays go back to the computer, and on opens them again where they were. Stage off (Session 55) keeps the
 * stage screens, and they show exactly the audience picture instead of their layout, every stage screen alike (a
 * node's and a tablet's too, from the engine's state); on, their layout again. The show carries on, and nothing the
 * stage does changes the audience screens. Audience is on again at every start. Stage (alpha.22; the owner, 24 Nov
 * 2026: "by default it should be off. keep it off. i can turn on, and then turn off") starts off on a new library,
 * and once after the update, then as it was left (main/outputs/stage-switch-setting.ts).
 */

export type ScreenSwitch = 'audience' | 'stage';
export const SCREEN_SWITCHES = ['audience', 'stage'] as const satisfies readonly ScreenSwitch[];

/** Which are on: true for on. */
export interface ScreenSwitches {
  audience: boolean;
  stage: boolean;
}

export type ScreenSwitchResult = { ok: true; switches: ScreenSwitches } | { ok: false; message: string };

/** Both on. */
export const ALL_ON: Readonly<ScreenSwitches> = { audience: true, stage: true };

/** How a new library's first start finds them (alpha.22): Audience on, Stage off. */
export const STARTS: Readonly<ScreenSwitches> = { audience: true, stage: false };

/**
 * Said when Stage goes on with no screen set to Stage (alpha.22: until then, Stage On with no stage screen started
 * nothing and said nothing), with the button that opens Screens, where one click gives a display the Stage job.
 */
export const NO_STAGE_SCREEN = 'No screen is set to Stage.';
export const SET_UP_STAGE = 'Set up Stage screen…';

/**
 * What the status bar says beside "Stage off" while tablets are paired as Stage (`tablets`, stageDevicesPaired: only
 * while the Network is on), or nothing with none (alpha.23; the owner's QA23-STAGE8-2, "Keep Off, say so (Rec.)"):
 * Stage starts off, and until it is on a stage tablet shows the audience picture, far from the operator.
 */
export function stageOffHint(tablets: number): string | null {
  if (tablets <= 0) return null;
  return tablets === 1
    ? 'the stage tablet shows the audience picture'
    : 'the stage tablets show the audience picture';
}

/** Each one's name, as the top bar, the View menu, the status bar and a phone say it. */
export const SWITCH_NAMES: Readonly<Record<ScreenSwitch, string>> = { audience: 'Audience', stage: 'Stage' };

/** What turning one off does, said before it happens (the user's words). */
export const SWITCH_OFF_WORDS: Readonly<Record<ScreenSwitch, string>> = {
  audience: 'The hall’s screens will show this computer’s desktop.',
  // Session 55: the stage screens stay, and show what the hall's screens show.
  stage: 'The stage screens will show the audience picture.',
};

/**
 * Whether turning it off closes its screens' windows, giving their displays back to the computer (Session 55):
 * Audience's do; Stage's stay, showing exactly the audience picture (render/StageScreen.tsx).
 */
export const CLOSES_WINDOWS: Readonly<Record<ScreenSwitch, boolean>> = { audience: true, stage: false };

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
 * A stage screen's states that count as set to Stage: showing (with Stage off too: its window stays), stopped and
 * tried again, and (alpha.23, a22-review-stage S8) on a display that is unplugged now, or on a node that is offline
 * now: it shows the stage again as they come back, and the status bar and Screens already say they are away.
 */
const SET_TO_STAGE: ReadonlySet<ScreenState> = new Set<ScreenState>([
  'showing',
  'stopped',
  'missing-display',
  'node-offline',
]);

/**
 * How many screens are set to Stage now (alpha.22): a stage group's screens on a display, this computer's or a
 * node's (SET_TO_STAGE), and (alpha.23) the tablets paired as Stage (`stageDevices`, stageDevicesPaired), each a
 * stage display in a browser. None: Stage has nothing to show on, and says so as it goes on.
 */
export function stageScreensSet(
  snapshot: Pick<ScreensSnapshot, 'groups' | 'status'>,
  stageDevices = 0,
): number {
  const staged = new Set(
    snapshot.groups.filter((g) => g.role === 'stage').flatMap((g) => g.screens.map((s) => s.id)),
  );
  return (
    snapshot.status.filter((st) => staged.has(st.screenId) && SET_TO_STAGE.has(st.state)).length +
    stageDevices
  );
}

/**
 * The devices paired as Stage (alpha.23): each shows the stage display in its browser (`/stage`), whether it is
 * connected now or not, as a stage screen whose display is unplugged is still set; but only while the Network
 * (phones and tablets) is on (a22-review-stage8 S5): with it off a tablet can show nothing, so none counts. Never a
 * Remote, an Announcements phone or the announcements poster link.
 */
export function stageDevicesPaired(network: {
  on: NetworkStatus['on'];
  devices: readonly Pick<DeviceInfo, 'kind' | 'poster'>[];
}): number {
  if (!network.on) return 0;
  return network.devices.filter((d) => d.kind === 'stage' && !d.poster).length;
}

/**
 * Whether the audience screens show anything at all: a layer with a picture (sound has none), black-out (the hall
 * sees black) or the Wallpaper (Session 55, Part 13).
 */
export function showsSomething(state: EngineState): boolean {
  if (state.blackout || state.wallpaper) return true;
  return LAYER_NAMES.some((layer) => layer !== 'audio' && !isLayerEmpty(state.layers, layer));
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
