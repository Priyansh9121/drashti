import { create } from 'zustand';
import { useEngine } from '../engine/engine-store';
import type { AudioDevice } from '../../../shared/audio';
import type { Lang } from '../../../shared/model';
import type { DisplayInfo } from '../../../shared/screens';
import type { OutputUse, SetupPlan } from '../../../shared/setup';
import type { DeviceChoice } from '../../../shared/stream';
import type { Theme } from '../../../shared/themes';
import { useScreens } from '../screens/screens-store';

/*
 * The setup wizard (PLAN.md 3): what each output shows and in which
 * languages, the sound output and the default theme, chosen step by step.
 * Nothing is applied until Finish; closing it, or skipping a step, keeps
 * things as they are.
 */

export const STEPS = ['Welcome', 'Screens', 'Sound', 'Stream', 'Theme', 'Finish'] as const;

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
  outputs: Record<number, OutputChoice>;
  /** The step was skipped: the screens stay as they are. */
  outputsSkipped: boolean;
  devices: AudioDevice[];
  /** The sound output chosen (null: the system default), or 'skip'. */
  sound: AudioDevice | null | 'skip';
  themes: Theme[];
  /** The stream's camera and sound input (for the profile in use), or 'skip' to keep them. */
  stream: { camera: DeviceChoice | null; sound: DeviceChoice | null } | 'skip';
  /** The default theme chosen, or null to keep it. */
  themeId: string | null;
  defaultThemeId: string | null;
  busy: boolean;
  problem: string | null;
  /** Finish asked first: an output would cover the controls. */
  askCover: boolean;
  /** Finished: how many screens show the test slide. */
  finished: { tested: number } | null;
}

const closed: SetupView = {
  open: false,
  step: 0,
  displays: [],
  operatorDisplayId: null,
  outputs: {},
  outputsSkipped: false,
  devices: [],
  sound: 'skip',
  stream: 'skip',
  themes: [],
  themeId: null,
  defaultThemeId: null,
  busy: false,
  problem: null,
  askCover: false,
  finished: null,
};

export const useSetup = create<SetupView>(() => closed);

/** Open the wizard, starting from the setup as it is. */
export async function openSetup(): Promise<void> {
  useSetup.setState({ ...closed, open: true, busy: true });
  const [state, snapshot, sound, themes] = await Promise.all([
    window.drashti.setup.state(),
    window.drashti.screens.get(),
    window.drashti.audio.getOutput(),
    window.drashti.themes.list(),
  ]);
  useScreens.setState({ snapshot });
  // Each display as it is used now: by a screen showing on it, in a group with its role, and its
  // languages in the live Look.
  const look = useEngine.getState().state?.look;
  const outputs: Record<number, OutputChoice> = {};
  for (const d of snapshot.displays) {
    const st = snapshot.status.find((x) => x.displayId === d.id && x.state === 'showing');
    const group = st ? snapshot.groups.find((g) => g.screens.some((sc) => sc.id === st.screenId)) : undefined;
    const languages = group ? (look?.groups[group.id]?.languages ?? null) : null;
    outputs[d.id] = group
      ? { use: group.role === 'stage' ? 'stage' : 'audience', languages: languages ? [...languages] : null }
      : { use: 'none', languages: null };
  }
  useSetup.setState({
    busy: false,
    displays: snapshot.displays,
    operatorDisplayId: state.operatorDisplayId,
    outputs,
    devices: sound.devices,
    sound: sound.chosen,
    themes: themes.themes,
    themeId: themes.defaultId,
    defaultThemeId: themes.defaultId,
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
  goTo(step + 1);
}

export function chooseOutput(displayId: number, choice: Partial<OutputChoice>): void {
  useSetup.setState((s) => ({
    outputsSkipped: false,
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

/** Apply everything chosen; with consent, outputs may cover the controls. */
export async function finishSetup(coverOperator = false): Promise<void> {
  const s = useSetup.getState();
  useSetup.setState({ busy: true, problem: null, askCover: false });
  const result = await window.drashti.setup.finish(planOf(s), { coverOperator });
  if (!result.ok) {
    useSetup.setState({
      busy: false,
      askCover: result.confirm === 'covers-operator',
      problem: result.confirm ? null : result.message,
    });
    return;
  }
  useScreens.setState({ snapshot: result.snapshot });
  // The stream's inputs go on the profile in use (its key can be added later, in Stream settings).
  if (s.stream !== 'skip') {
    const { profiles, activeId } = await window.drashti.stream.profiles();
    const p = profiles.find((x) => x.id === activeId);
    if (p) {
      const saved = await window.drashti.stream.saveProfile(p.id, {
        name: p.name,
        url: p.url,
        preset: p.preset,
        camera: s.stream.camera,
        sound: s.stream.sound,
        soundDelayMs: p.soundDelayMs,
        mixOwnSound: p.mixOwnSound,
      });
      if (!saved.ok) useSetup.setState({ problem: saved.message });
    }
  }
  useSetup.setState({ busy: false, finished: { tested: result.tested } });
}
