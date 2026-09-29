import { z } from 'zod';

/*
 * Where Drashti's sound goes. One hidden audio player window plays every
 * sound (videos' sound and audio cues) on the output the operator chooses,
 * usually the mixer; output windows are always muted.
 */

/** A sound output device, as the audio player sees it. */
export interface AudioDevice {
  /** The browser's id for it: stable for Drashti's pages on this computer. */
  id: string;
  label: string;
}

/** Where sound is playing: the chosen output, the system default, or the default because the chosen one is missing. */
export type AudioOutputState = 'chosen' | 'default' | 'missing';

export interface AudioOutputStatus {
  /** The operator's choice, remembered across restarts; null for the system default. */
  chosen: AudioDevice | null;
  /** The outputs the audio player can see (empty until it has looked). */
  devices: AudioDevice[];
  state: AudioOutputState;
  /** False until the audio player has looked for outputs. */
  checked: boolean;
}

/**
 * The output to play on: the chosen one if it is connected (found by id, or
 * by name when the system gave it a new id), else the system default ('').
 */
export function resolveOutput(
  chosen: AudioDevice | null,
  devices: readonly AudioDevice[],
): { sinkId: string; state: AudioOutputState } {
  if (!chosen) return { sinkId: '', state: 'default' };
  const found = devices.find((d) => d.id === chosen.id) ?? devices.find((d) => d.label === chosen.label);
  return found ? { sinkId: found.id, state: 'chosen' } : { sinkId: '', state: 'missing' };
}

export const audioDeviceSchema: z.ZodType<AudioDevice> = z
  .object({ id: z.string().min(1).max(512), label: z.string().max(300) })
  .strict();
export const audioDevicesSchema = z.array(audioDeviceSchema).max(64);
