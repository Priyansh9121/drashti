import { create } from 'zustand';
import type { MidiAction, MidiInput, MidiSettings } from '../../../shared/midi';
import { inputOf, NO_MIDI, sameInput } from '../../../shared/midi';

/*
 * MIDI in the operator window (Web MIDI; only this page is allowed it, and
 * never SysEx). Listens to the chosen device, found by its name whenever it
 * is plugged in; a note going down, or a controller rising past its middle,
 * does what it is mapped to. Learn maps the next note or controller to an
 * action. Nothing asks the system for MIDI until a device is chosen or the
 * MIDI dialog is opened.
 *
 * What a mapped input does is the mounted window's (Pro Mode or Simple
 * Mode) to say: setMidiHandler.
 */

type Access = 'off' | 'asking' | 'on' | 'refused' | 'unsupported';

interface MidiStore {
  settings: MidiSettings;
  access: Access;
  /** Connected input devices, by name. */
  devices: string[];
  /** The chosen device is plugged in. */
  connected: boolean;
  /** Waiting for a note or controller to map to this action. */
  learning: MidiAction | null;
  /** The last note or controller seen (any device's, while the dialog is open). */
  last: MidiInput | null;
  problem: string | null;
}

export const useMidi = create<MidiStore>(() => ({
  settings: NO_MIDI,
  access: 'off',
  devices: [],
  connected: false,
  learning: null,
  last: null,
  problem: null,
}));

let handler: ((action: MidiAction) => void) | null = null;

/** What a mapped input does now (Pro Mode or Simple Mode sets it; null for nothing). */
export function setMidiHandler(h: ((action: MidiAction) => void) | null): void {
  handler = h;
}

let access: MIDIAccess | null = null;
/** Each controller's last value, so one only acts as it rises past its middle. */
const controllers = new Map<string, number>();

function attach(): void {
  if (!access) return;
  const { settings } = useMidi.getState();
  const inputs = [...access.inputs.values()];
  for (const input of inputs)
    input.onmidimessage = input.name === settings.deviceName ? onMessage : learnOnly;
  useMidi.setState({
    devices: [...new Set(inputs.filter((i) => i.state === 'connected').map((i) => i.name ?? ''))].filter(
      Boolean,
    ),
    connected: inputs.some((i) => i.name === settings.deviceName && i.state === 'connected'),
  });
}

/** A controller value: true only as it rises past its middle. */
function rising(data: Uint8Array): boolean {
  const status = data[0] ?? 0;
  if ((status & 0xf0) !== 0xb0) return true;
  const key = `${status & 0x0f}:${data[1] ?? 0}`;
  const before = controllers.get(key) ?? 0;
  const now = data[2] ?? 0;
  controllers.set(key, now);
  return before < 64 && now >= 64;
}

function seen(e: MIDIMessageEvent): MidiInput | null {
  const data = e.data;
  if (!data) return null;
  // Every controller value is kept (a low one too), so the next rise past the middle counts.
  const up = rising(data);
  const input = inputOf(data);
  if (!input || !up) return null;
  useMidi.setState({ last: input });
  return input;
}

/** Another device's message: only seen (so Learn can say what came), never acted on. */
function learnOnly(e: MIDIMessageEvent): void {
  seen(e);
}

function onMessage(e: MIDIMessageEvent): void {
  const input = seen(e);
  if (!input) return;
  const s = useMidi.getState();
  if (s.learning) {
    const action = s.learning;
    // One input does one thing: the new mapping replaces any for this action or this input.
    const mappings = [
      ...s.settings.mappings.filter(
        (m) => !sameInput(m.input, input) && JSON.stringify(m.action) !== JSON.stringify(action),
      ),
      { input, action },
    ];
    useMidi.setState({ learning: null });
    void saveMidi({ ...s.settings, mappings });
    return;
  }
  const mapped = s.settings.mappings.find((m) => sameInput(m.input, input));
  if (mapped) handler?.(mapped.action);
}

/** Ask for MIDI (the operator window only; never SysEx) and listen. */
async function open(): Promise<void> {
  if (access || useMidi.getState().access === 'asking') return;
  if (typeof navigator.requestMIDIAccess !== 'function') {
    useMidi.setState({ access: 'unsupported' });
    return;
  }
  useMidi.setState({ access: 'asking' });
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
    access.onstatechange = attach;
    useMidi.setState({ access: 'on' });
    attach();
  } catch {
    useMidi.setState({ access: 'refused' });
  }
}

/** At start: the saved settings, and listening if a device was chosen. */
export async function startMidi(): Promise<void> {
  const settings = await window.drashti.midi.get();
  useMidi.setState({ settings });
  if (settings.deviceName !== null) await open();
}

/** The MIDI dialog is open: listen, so devices can be chosen and learned from. */
export function openMidi(): Promise<void> {
  return open();
}

export async function saveMidi(settings: MidiSettings): Promise<boolean> {
  const result = await window.drashti.midi.set(settings);
  if (!result.ok) {
    useMidi.setState({ problem: result.message });
    return false;
  }
  useMidi.setState({ settings: result.settings, problem: null });
  attach();
  return true;
}

export function learn(action: MidiAction | null): void {
  useMidi.setState({ learning: action });
}
