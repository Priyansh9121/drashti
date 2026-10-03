import { z } from 'zod';
import { idSchema } from './model-schema';

/*
 * MIDI (Session 11): a controller (a pad, a keyboard, a foot switch) plugged
 * into the computer, used in the operator window only (Web MIDI, which only
 * that page is allowed; never SysEx). The operator chooses the device, then
 * Learn maps a note or a controller to a macro, or to Next, Back, Clear all,
 * Black-out or Logo. The mappings are kept in the library's settings; the
 * device is found again by its name, whenever it is plugged in.
 */

/** What a MIDI message is: a note going down, or a controller moving above its middle. */
export interface MidiInput {
  type: 'note' | 'cc';
  /** 0 to 15 (shown as 1 to 16). */
  channel: number;
  /** The note or controller number, 0 to 127. */
  number: number;
}

/** What a mapped input does. Simple Mode's own actions work in Simple Mode; macros do not. */
export type MidiAction =
  | { kind: 'next' }
  | { kind: 'back' }
  | { kind: 'clearAll' }
  | { kind: 'blackout' }
  | { kind: 'logo' }
  | { kind: 'macro'; macroId: string };

export interface MidiMapping {
  input: MidiInput;
  action: MidiAction;
}

export interface MidiSettings {
  /** The device listened to, by name; null for none. */
  deviceName: string | null;
  mappings: MidiMapping[];
}

export const NO_MIDI: MidiSettings = { deviceName: null, mappings: [] };

export const MIDI_ACTION_NAMES: Record<Exclude<MidiAction['kind'], 'macro'>, string> = {
  next: 'Next',
  back: 'Back',
  clearAll: 'Clear all',
  blackout: 'Black-out',
  logo: 'Logo',
};

const inputSchema = z.object({
  type: z.enum(['note', 'cc']),
  channel: z.number().int().min(0).max(15),
  number: z.number().int().min(0).max(127),
});

const actionSchema: z.ZodType<MidiAction> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('next') }),
  z.object({ kind: z.literal('back') }),
  z.object({ kind: z.literal('clearAll') }),
  z.object({ kind: z.literal('blackout') }),
  z.object({ kind: z.literal('logo') }),
  z.object({ kind: z.literal('macro'), macroId: idSchema }),
]);

export const midiSettingsSchema: z.ZodType<MidiSettings> = z.object({
  deviceName: z.string().min(1).max(200).nullable(),
  mappings: z.array(z.object({ input: inputSchema, action: actionSchema })).max(128),
});

export type MidiResult = { ok: true; settings: MidiSettings } | { ok: false; message: string };

/** The same input (a note and a controller with one number are different inputs). */
export const sameInput = (a: MidiInput, b: MidiInput): boolean =>
  a.type === b.type && a.channel === b.channel && a.number === b.number;

/**
 * A MIDI message as an input that sets something off: a note going down
 * (velocity above 0), or a controller rising past its middle (64). Anything
 * else (a note up, SysEx, clock) is ignored.
 */
export function inputOf(data: ArrayLike<number>): MidiInput | null {
  const status = data[0] ?? 0;
  const kind = status & 0xf0;
  const channel = status & 0x0f;
  const number = data[1] ?? 0;
  const value = data[2] ?? 0;
  if (kind === 0x90 && value > 0) return { type: 'note', channel, number };
  if (kind === 0xb0 && value >= 64) return { type: 'cc', channel, number };
  return null;
}

/** How an input is written for people: "Note 36, channel 1", "Controller 20, channel 10". */
export const inputName = (i: MidiInput): string =>
  `${i.type === 'note' ? 'Note' : 'Controller'} ${i.number}, channel ${i.channel + 1}`;
