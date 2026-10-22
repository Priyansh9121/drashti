import { create } from 'zustand';
import { useEngine } from '../engine/engine-store';
import type { AudioDevice } from '../../../shared/audio';
import type { Lang } from '../../../shared/model';
import type { DisplayInfo, ScreensSnapshot } from '../../../shared/screens';
import type { OutputUse, SetupPlan } from '../../../shared/setup';
import { displayToOffer } from '../../../shared/setup';
import type { DeviceChoice, StreamLayout } from '../../../shared/stream';
import type { Theme } from '../../../shared/themes';
import { useKeepScreens } from '../operator/keep-screens-store';
import { useScreens } from '../screens/screens-store';

/*
 * The setup wizard (PLAN.md 3): what each output shows and in which
 * languages, the sound output and the default theme, chosen step by step.
 * Nothing is applied until Finish; closing it, or skipping a step, keeps
 * things as they are.
 */

export const STEPS = ['Welcome', 'Screens', 'Sound', 'Stream', 'Theme', 'PINs', 'Finish'] as const;

export interface StreamChoice {
  layout: StreamLayout;
  camera: DeviceChoice | null;
  sound: DeviceChoice | null;
  languages: Lang[] | null;
}

/** Two PINs to turn roles on at Finish (Session 14), each typed twice; or 'skip' to leave roles as they are. */
export type PinChoice =
  { admin: string; adminAgain: string; operator: string; operatorAgain: string } | 'skip';

export interface OutputChoice {
  use: OutputUse;
  languages: Lang[] | null;
}

interface SetupView {
  open: boolean;
  step: number;
  displays: DisplayInfo[];
  /** The display the Drashti controls are on (outputs there cover them). */
  operatorDisplayId: number | null;
  /** The display the controls are on, windowed outputs or not (Session 50: marked wherever a display is offered). */
  controlsDisplayId: number | null;
  outputs: Record<number, OutputChoice>;
  /** The step was skipped: the screens stay as they are. */
  outputsSkipped: boolean;
  devices: AudioDevice[];
  /** The sound output chosen (null: the system default), or 'skip'. */
  sound: AudioDevice | null | 'skip';
  themes: Theme[];
  /**
   * The stream's settings, as YouTube's card in Screens has them (Session 26): its layout, the camera and
   * sound input of the profile in use and a kirtan's languages; or 'skip' to keep them.
   */
  stream: StreamChoice | 'skip';
  /** The default theme chosen, or null to keep it. */
  themeId: string | null;
  /** PINs to turn roles on with, or 'skip' (always skipped once roles are on). */
  pins: PinChoice;
  /** Roles are on already: the PINs step only says where to change them. */
  rolesOn: boolean;
  defaultThemeId: string | null;
  busy: boolean;
  problem: string | null;
  /** Finish asked first: an output would cover the controls. */
  askCover: boolean;
  /** Finished: how many screens show the test slide. */
  finished: { tested: number } | null;
  /** What Done or Finish set on each display, while Keep these screens? waits (Session 50). */
  applied: Record<number, OutputUse> | null;
  /** Keep these screens? went back: the displays again, the choices as made, to change and press Done again. */
  wentBack: boolean;
}

const closed: SetupView = {
  open: false,
  step: 0,
  displays: [],
  operatorDisplayId: null,
  controlsDisplayId: null,
  outputs: {},
  outputsSkipped: false,
  devices: [],
  sound: 'skip',
  stream: 'skip',
  themes: [],
  themeId: null,
  pins: 'skip',
  rolesOn: false,
  defaultThemeId: null,
  busy: false,
  problem: null,
  askCover: false,
  finished: null,
  applied: null,
  wentBack: false,
};

export const useSetup = create<SetupView>(() => closed);

/**
 * Open the wizard, starting from the setup as it is: at its Welcome, or (from the first start's own
 * welcome, which has just said hello) at a later step.
 */
export async function openSetup(from = 0): Promise<void> {
  useSetup.setState({ ...closed, open: true, busy: true, step: from });
  const [state, snapshot, sound, themes, roles] = await Promise.all([
    window.drashti.setup.state(),
    window.drashti.screens.get(),
    window.drashti.audio.getOutput(),
    window.drashti.themes.list(),
    window.drashti.roles.view(),
  ]);
  useScreens.setState({ snapshot });
  // Each display as it is used now: by a screen showing on it, in a group with its role, and its
  // languages in the live Look.
  const look = useEngine.getState().state?.look;
  const outputs: Record<number, OutputChoice> = {};
  for (const d of snapshot.displays) {
    // A screen switched off (Session 50) still has its display: Finish must not take it away.
    const st = snapshot.status.find(
      (x) => x.displayId === d.id && (x.state === 'showing' || x.state === 'switched-off'),
    );
    const group = st ? snapshot.groups.find((g) => g.screens.some((sc) => sc.id === st.screenId)) : undefined;
    const languages = group ? (look?.groups[group.id]?.languages ?? null) : null;
    outputs[d.id] = group
      ? { use: group.role === 'stage' ? 'stage' : 'audience', languages: languages ? [...languages] : null }
      : { use: 'none', languages: null };
  }
  // No hall screen yet (Session 44): the first display free for it starts as the hall's, the obvious choice.
  const offered = displayToOffer(snapshot, state.controlsDisplayId);
  if (offered) outputs[offered.id] = { use: 'audience', languages: null };
  useSetup.setState({
    busy: false,
    displays: snapshot.displays,
    operatorDisplayId: state.operatorDisplayId,
    controlsDisplayId: state.controlsDisplayId,
    outputs,
    devices: sound.devices,
    sound: sound.chosen,
    themes: themes.themes,
    themeId: themes.defaultId,
    defaultThemeId: themes.defaultId,
    rolesOn: roles.on,
  });
}

/** Close it: nothing changes (and it does not open by itself again). */
export function closeSetup(): void {
  useSetup.setState(closed);
  void window.drashti.setup.setSeen();
}

export function goTo(step: number): void {
  useSetup.setState({ step: Math.max(0, Math.min(STEPS.length - 1, step)), problem: null });
}

/** Skip this step: what it sets stays as it is. */
export function skipStep(): void {
  const { step } = useSetup.getState();
  if (STEPS[step] === 'Screens') useSetup.setState({ outputsSkipped: true });
  if (STEPS[step] === 'Sound') useSetup.setState({ sound: 'skip' });
  if (STEPS[step] === 'Stream') useSetup.setState({ stream: 'skip' });
  if (STEPS[step] === 'Theme') useSetup.setState({ themeId: null });
  if (STEPS[step] === 'PINs') useSetup.setState({ pins: 'skip' });
  goTo(step + 1);
}

export function chooseOutput(displayId: number, choice: Partial<OutputChoice>): void {
  useSetup.setState((s) => ({
    outputsSkipped: false,
    wentBack: false,
    outputs: {
      ...s.outputs,
      [displayId]: { ...(s.outputs[displayId] ?? { use: 'none', languages: null }), ...choice },
    },
  }));
}

/** The plan Finish applies. */
export function planOf(s: SetupView): SetupPlan {
  return {
    outputs: s.outputsSkipped
      ? null
      : s.displays.map((d) => {
          const o = s.outputs[d.id] ?? { use: 'none' as const, languages: null };
          return { displayId: d.id, use: o.use, languages: o.use === 'none' ? null : o.languages };
        }),
    sound: s.sound,
    themeId: s.themeId,
  };
}

/** The PINs as chosen, ready to set; or why they cannot be, or null when the step is skipped. */
export function pinsReady(pins: PinChoice): { admin: string; operator: string } | string | null {
  if (pins === 'skip') return null;
  const pin = /^\d{4,12}$/u;
  if (!pin.test(pins.admin) || !pin.test(pins.operator)) return 'Each PIN is 4 to 12 digits.';
  if (pins.admin !== pins.adminAgain || pins.operator !== pins.operatorAgain)
    return 'Each PIN typed twice must match.';
  if (pins.admin === pins.operator) return 'The admin PIN and the operator PIN must differ.';
  return { admin: pins.admin, operator: pins.operator };
}

/** Done on the displays (Session 44): the screens as chosen, and nothing else (sound, stream, theme and PINs as they are). */
export async function finishScreens(coverOperator = false): Promise<void> {
  useSetup.setState({ sound: 'skip', stream: 'skip', themeId: null, pins: 'skip' });
  await finishSetup(coverOperator);
}

/** Apply everything chosen; with consent, outputs may cover the controls. */
export async function finishSetup(coverOperator = false): Promise<void> {
  const s = useSetup.getState();
  const pins = s.rolesOn ? null : pinsReady(s.pins);
  if (typeof pins === 'string') {
    useSetup.setState({ problem: `PINs: ${pins}` });
    return;
  }
  useSetup.setState({ busy: true, problem: null, askCover: false, wentBack: false });
  const plan = planOf(s);
  const result = await window.drashti.setup.finish(plan, { coverOperator });
  if (!result.ok) {
    useSetup.setState({
      busy: false,
      askCover: result.confirm === 'covers-operator',
      problem: result.confirm ? null : result.message,
    });
    return;
  }
  useScreens.setState({ snapshot: result.snapshot });
  // Keep these screens? (Session 50): the main process asked it before answering. Watched until it goes.
  if (plan.outputs && useKeepScreens.getState().pending) {
    watchKeepScreens();
    useSetup.setState({ applied: Object.fromEntries(plan.outputs.map((o) => [o.displayId, o.use])) });
  }
  // The stream's settings, where YouTube's card in Screens keeps them: the inputs on the profile in use
  // (its key can be added later, in Stream settings), the layout, and the languages in the live Look.
  if (s.stream !== 'skip') {
    const stream = s.stream;
    const group = result.snapshot.groups.find((g) => g.role === 'stream');
    for (const step of [
      () => window.drashti.stream.setInputs(stream.camera, stream.sound),
      () => window.drashti.stream.setLayout(stream.layout),
      ...(group ? [() => window.drashti.screens.setGroupLanguages(group.id, stream.languages)] : []),
    ]) {
      const done = await step();
      if (!done.ok) useSetup.setState({ problem: done.message });
    }
  }
  // Roles on, last: whoever finished the setup is the admin from now (admin unlocked for a while).
  if (pins) {
    const set = await window.drashti.roles.setPins(pins);
    if (!set.ok) useSetup.setState({ problem: set.message });
  }
  // Gone back already (answered at once): the displays again, not Done.
  if (useSetup.getState().wentBack) useSetup.setState({ busy: false });
  else useSetup.setState({ busy: false, finished: { tested: result.tested } });
}

// ---- Keep these screens? (Session 50) ------------------------------------------------------------------------

/** What each display shows now, as the wizard offers it: the audience picture, the stage view, or nothing. */
export function usesOf(
  snapshot: Pick<ScreensSnapshot, 'displays' | 'groups' | 'status'>,
): Record<number, OutputUse> {
  const uses: Record<number, OutputUse> = {};
  for (const d of snapshot.displays) {
    const st = snapshot.status.find((x) => x.displayId === d.id && x.state === 'showing');
    const group = st ? snapshot.groups.find((g) => g.screens.some((sc) => sc.id === st.screenId)) : undefined;
    uses[d.id] = group ? (group.role === 'stage' ? 'stage' : 'audience') : 'none';
  }
  return uses;
}

/**
 * Whether what Done or Finish set was kept, as Keep these screens? goes: as this window answered it, or else
 * (nothing pressed, or answered on the output over the controls) whether every display shows what was chosen.
 */
export function screensKept(
  applied: Readonly<Record<number, OutputUse>>,
  now: Readonly<Record<number, OutputUse>>,
  answered: 'kept' | 'went-back' | null,
): boolean {
  if (answered !== null) return answered === 'kept';
  return Object.entries(applied).every(([id, use]) => (now[Number(id)] ?? 'none') === use);
}

let watching = false;

/**
 * Follow Keep these screens? while the wizard waits on it (once per page): gone back, the wizard is at its
 * displays again with the choices as made, saying why, so a mistake is put right and Done pressed again.
 */
export function watchKeepScreens(): void {
  if (watching) return;
  watching = true;
  useKeepScreens.subscribe((now, before) => {
    if (!before.pending || now.pending) return;
    const s = useSetup.getState();
    if (!s.open || !s.applied) return;
    // The screens as the main process put them back: it says so before the question goes.
    const snapshot = useScreens.getState().snapshot;
    const kept = snapshot
      ? screensKept(s.applied, usesOf(snapshot), now.answered)
      : now.answered !== 'went-back';
    useSetup.setState(
      kept
        ? { applied: null }
        : { applied: null, finished: null, step: STEPS.indexOf('Screens'), wentBack: true, problem: null },
    );
  });
}
