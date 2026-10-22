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

/**
 * Why no camera of the input's name was found: not there (other cameras show their names, or there are none), or
 * refused when every camera's name is hidden (the computer has not let Drashti use them yet), which says nothing
 * of whether this one is there.
 */
export function notFoundReason(devices: readonly SeenDevice[], label: string): StopReason {
  const cameras = devices.filter((d) => d.kind === 'videoinput');
  return cameras.length > 0 && cameras.every((d) => d.label === '') && label !== '' ? 'refused' : 'missing';
}

/**
 * What the page says of the input up now (shared/video-inputs.ts VideoInputReport), or nothing yet. Missing only
 * when the page saw that no camera of its name is there (Session 50: restart recovery then takes it off and names
 * it); a stop for any other reason is said as stopped.
 */
export function reportOf(
  state: InputCaptureState,
  reason: StopReason | null = null,
): 'playing' | 'stopped' | 'missing' | null {
  if (state === 'live') return 'playing';
  if (state !== 'stopped') return null;
  return reason === 'missing' ? 'missing' : 'stopped';
}
