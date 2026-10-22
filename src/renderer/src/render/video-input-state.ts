/*
 * A video input as a screen's page opens it (Session 50): the parts that need no browser, tested on their own.
 * The input is found among this computer's devices by its name (its label), as Media named it: never the first
 * camera there is, and never a microphone.
 */

/** A device as the page sees it (navigator.mediaDevices.enumerateDevices()). */
export interface SeenDevice {
  kind: string;
  deviceId: string;
  label: string;
}

/** The camera or capture input of exactly this name among the page's devices: its id, or null. */
export function findInputDevice(devices: readonly SeenDevice[], label: string): string | null {
  if (label === '') return null;
  return (
    devices.find((d) => d.kind === 'videoinput' && d.deviceId !== '' && d.label === label)?.deviceId ?? null
  );
}

/** This computer's cameras and capture inputs by name, each once, in the computer's order (Add a Video Input…). */
export function inputDeviceNames(devices: readonly SeenDevice[]): string[] {
  const names: string[] = [];
  for (const d of devices)
    if (d.kind === 'videoinput' && d.label !== '' && !names.includes(d.label)) names.push(d.label);
  return names;
}

/**
 * How a page's capture of an input stands: opening, live, stopped (its last picture kept), or not on this
 * computer (a node's screens: the input is on Main's computer), which draws nothing.
 */
export type InputCaptureState = 'opening' | 'live' | 'stopped' | 'absent';

/**
 * Why it has no live picture: the computer refused it, it is not there (unplugged), it could not start (another
 * app has it), it ended (unplugged while up), or its frames paused (it plays again when they come back).
 */
export type StopReason = 'refused' | 'missing' | 'busy' | 'ended' | 'muted';

/** What a failed getUserMedia means. */
export function stopReasonOf(error: unknown): StopReason {
  const name =
    typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
      ? error.name
      : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'refused';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  return 'busy';
}

/** How soon it is tried again by itself (it is tried again too as the computer's devices change), or never. */
export function retryAfterMs(reason: StopReason): number | null {
  if (reason === 'muted') return null;
  return reason === 'refused' ? 10_000 : 3000;
}

/** What the page says of the input up now (shared/video-inputs.ts VideoInputReport), or nothing yet. */
export function reportOf(state: InputCaptureState): 'playing' | 'stopped' | null {
  if (state === 'live') return 'playing';
  return state === 'stopped' ? 'stopped' : null;
}
