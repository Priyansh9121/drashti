import { create } from 'zustand';
import type {
  RemoteInputs,
  RemoteMidi,
  RemoteScreens,
  RemoteWindows,
} from '../../../../shared/network-desktop';
import type { ScreenSwitch } from '../../../../shared/screen-switches';
import { api } from '../device';
import { onListsChanged, onOnline } from '../feed';
import { loadMedia } from './mirror-store';

/*
 * The phone as a full Drashti (Session 54, the owner's item 3): the Drashti computer's own things a phone sets up,
 * starting with its screens and Audience and Stage. Read over the network as the window reads them, while their
 * sheet is open (or a change of this phone's waits for Keep these screens?), and again when Drashti says they
 * changed. Each change goes to the main process, which makes it as the window's own request does and answers with
 * the screens as they are after it; the window's questions (Keep these screens?, Turn Audience off?) are answered
 * here, and covering the controls is asked of the computer itself, never said yes to here.
 */

/** The sheets a phone opens over the remote to set up the computer's things. */
export type DesktopSheet = 'screens' | 'inputs' | 'pip' | 'library' | 'midi';

interface DesktopView {
  /** The sheet open now, or null. */
  sheet: DesktopSheet | null;
  /** The screens as last read (null until read). */
  screens: RemoteScreens | null;
  /** A change is on its way: its buttons wait. */
  busy: boolean;
  /** The last change's problem, in Drashti's words, or null. */
  problem: string | null;
  /** A change of this phone's waits for Keep these screens?: the question stays here, whatever is open, until it goes. */
  mine: boolean;
  /** The window's question before a switch goes off, asked here now (null: none). */
  askingOff: ScreenSwitch | null;
  /** Media's video inputs and the computer's cameras (null until read). */
  inputs: RemoteInputs | null;
  /** The other apps' windows as last listed (null until looked for), and whether a look is on its way. */
  windows: RemoteWindows | null;
  lookingForWindows: boolean;
  /** MIDI as the computer has it (Session 54; null until read). */
  midi: RemoteMidi | null;
}

export const useDesktop = create<DesktopView>(() => ({
  sheet: null,
  screens: null,
  busy: false,
  problem: null,
  mine: false,
  askingOff: null,
  inputs: null,
  windows: null,
  lookingForWindows: false,
  midi: null,
}));

/**
 * Take the screens as read: a change the computer agreed to for this phone, now waiting, is this phone's to answer
 * too; one no longer waiting is no longer its to answer.
 */
function take(screens: RemoteScreens): void {
  useDesktop.setState((s) => {
    const agreed = s.screens?.asked?.state === 'waiting' && screens.asked?.state === 'agreed';
    return { screens, mine: (s.mine || agreed) && screens.pending !== null };
  });
}

export async function loadScreens(): Promise<void> {
  const r = await api<{ screens: RemoteScreens }>('/api/v1/screens');
  if (r.ok) take(r.screens);
}

export async function loadInputs(): Promise<void> {
  const r = await api<RemoteInputs>('/api/v1/video-inputs');
  if (r.ok) useDesktop.setState({ inputs: { inputs: r.inputs, access: r.access, cameras: r.cameras } });
}

export async function loadMidi(): Promise<void> {
  const r = await api<{ midi: RemoteMidi }>('/api/v1/midi');
  if (r.ok) useDesktop.setState({ midi: r.midi });
}

/** A change to MIDI, sent and answered with MIDI as it is after it; false with the problem said. */
export async function changeMidi(path: string, body: unknown): Promise<boolean> {
  if (useDesktop.getState().busy) return false;
  useDesktop.setState({ busy: true, problem: null });
  const r = await api<{ midi: RemoteMidi }>(path, { method: 'POST', body });
  useDesktop.setState({ busy: false });
  if (!r.ok) {
    useDesktop.setState({ problem: r.message });
    return false;
  }
  useDesktop.setState({ midi: r.midi });
  return true;
}

export function openSheet(sheet: DesktopSheet): void {
  useDesktop.setState({ sheet, problem: null, ...(sheet !== 'screens' ? { windows: null } : {}) });
  if (sheet === 'screens') void loadScreens();
  else if (sheet === 'inputs' || sheet === 'pip') void loadInputs();
  else if (sheet === 'midi') void loadMidi();
  // The box takes a picture or video from Media too (Session 54); the library's sheet reads its own lists.
  if (sheet === 'pip') void loadMedia();
}

/**
 * A change to Media's video inputs, sent and answered with them as they are after it; false with the problem said,
 * when nothing changed.
 */
export async function changeInputs(path: string, body?: unknown): Promise<boolean> {
  if (useDesktop.getState().busy) return false;
  useDesktop.setState({ busy: true, problem: null });
  const r = await api<RemoteInputs>(path, { method: 'POST', body });
  useDesktop.setState({ busy: false });
  if (!r.ok) {
    useDesktop.setState({ problem: r.message });
    return false;
  }
  useDesktop.setState({ inputs: { inputs: r.inputs, access: r.access, cameras: r.cameras } });
  return true;
}

/** The other apps' windows, as the computer lists them now (Show a Window…'s list, by name). */
export async function lookForWindows(): Promise<void> {
  if (useDesktop.getState().lookingForWindows) return;
  useDesktop.setState({ lookingForWindows: true, problem: null });
  const r = await api<{ windows: RemoteWindows }>('/api/v1/windows');
  useDesktop.setState({ lookingForWindows: false });
  if (r.ok) useDesktop.setState({ windows: r.windows });
  else useDesktop.setState({ problem: r.message });
}

export function closeSheet(): void {
  useDesktop.setState({ sheet: null, problem: null });
}

/**
 * A change to the screens, sent and answered: the screens as they are after it, a Keep these screens? it began
 * (this phone's to answer now), or the computer asked to agree first (the sheet says how that stands). False with
 * the problem said, when nothing changed.
 */
export async function changeScreens(path: string, body?: unknown): Promise<boolean> {
  if (useDesktop.getState().busy) return false;
  useDesktop.setState({ busy: true, problem: null });
  const r = await api<{ screens?: RemoteScreens }>(path, { method: 'POST', body });
  useDesktop.setState({ busy: false });
  if (!r.ok) {
    useDesktop.setState({ problem: r.message });
    return false;
  }
  if (r.screens) {
    const waiting = r.screens.pending !== null;
    take(r.screens);
    if (waiting) useDesktop.setState({ mine: true });
  }
  return true;
}

/** Keep these screens?: Keep (true) or Go back. */
export async function answerKeep(keep: boolean): Promise<void> {
  await changeScreens(keep ? '/api/v1/screens/keep' : '/api/v1/screens/go-back');
  useDesktop.setState({ mine: false });
}

/**
 * Audience or Stage off or on, as the window's switch turns it: off asks the window's question here first while its
 * screens show something (Drashti says so), and goes off once it is answered with Turn off.
 */
export async function turnSwitch(which: ScreenSwitch, on: boolean, confirmed = false): Promise<void> {
  useDesktop.setState({ problem: null });
  const r = await api<{ screens?: RemoteScreens }>(`/api/v1/switches/${which}`, {
    method: 'POST',
    body: confirmed ? { on, confirmed: true } : { on },
  });
  if (r.ok) {
    if (r.screens) take(r.screens);
    return;
  }
  if (r.confirm === 'switch-off') useDesktop.setState({ askingOff: which });
  else useDesktop.setState({ problem: r.message });
}

/** The question before a switch goes off, answered: Turn off (true), or Cancel. */
export async function answerOff(yes: boolean): Promise<void> {
  const which = useDesktop.getState().askingOff;
  useDesktop.setState({ askingOff: null });
  if (yes && which) await turnSwitch(which, false, true);
}

let started = false;

/** Read them again when the feed is back, and when Drashti says they changed, while this phone needs them. */
export function startDesktop(): void {
  if (started) return;
  started = true;
  const needed = () => {
    const s = useDesktop.getState();
    return s.sheet === 'screens' || s.mine || s.screens?.asked?.state === 'waiting';
  };
  onOnline(() => {
    if (needed()) void loadScreens();
    if (useDesktop.getState().sheet === 'inputs' || useDesktop.getState().sheet === 'pip') void loadInputs();
  });
  onListsChanged((what) => {
    if ((what === 'setup' || what === 'screens') && needed()) void loadScreens();
    const sheet = useDesktop.getState().sheet;
    if (what === 'setup' && (sheet === 'inputs' || sheet === 'pip')) void loadInputs();
    if (what === 'setup' && sheet === 'midi') void loadMidi();
  });
}
