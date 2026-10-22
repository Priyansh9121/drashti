import { z } from 'zod';
import type { InvokeChannel } from './ipc';
import { IPC } from './ipc';

/*
 * Roles (Session 14, PLAN.md 3). PINs, not accounts:
 *
 * - A volunteer runs a sabha in Simple Mode, which changes nothing.
 * - An operator runs the show in Pro Mode: builds playlists, edits words and
 *   slides, makes props, messages, timers and lower thirds, switches Looks,
 *   approves announcements, goes live and records.
 * - An admin also sets Drashti up: imports and removes from the library;
 *   themes, Shastra texts, calendars, the idle rotation and every schedule
 *   (backups); MIDI; screens,
 *   Looks, stage layouts, masks and the sound output; the stream's settings
 *   and keys; phones and nodes; backups, restores and updates; the PINs.
 *
 * Roles stay off until an admin sets two PINs (an admin PIN and an operator
 * PIN); a computer that never does works as before. With roles on, leaving
 * Simple Mode takes either PIN (the admin PIN unlocks admin as well), and
 * an admin action in Pro Mode asks for the admin PIN, which then stays
 * unlocked until Lock, Simple Mode or quitting (Session 44: no time limit,
 * for an admin or an operator). The main process
 * checks every admin channel itself (ipc/handle.ts), as it does for Simple
 * Mode. PINs are kept only as a slow hash, outside the library (roles.json
 * in the data folder), so a backup never holds them and a restore never
 * turns roles off.
 */

export type Role = 'admin' | 'operator';

/** Wrong PINs in a row before waiting. */
export const PIN_FREE_TRIES = 5;
/** The first wait, doubling with each wrong PIN after it, up to the longest. */
export const PIN_FIRST_WAIT_MS = 60_000;
export const PIN_LONGEST_WAIT_MS = 15 * 60_000;

/** A PIN: 4 to 12 digits. */
export const PIN_PATTERN = /^\d{4,12}$/;
export const pinSchema = z.string().regex(PIN_PATTERN, 'A PIN is 4 to 12 digits.');

export const pinsSchema = z
  .object({ admin: pinSchema, operator: pinSchema })
  .strict()
  .refine((p) => p.admin !== p.operator, { message: 'The admin PIN and the operator PIN must differ.' });

export const pinChangeSchema = z.object({ role: z.enum(['admin', 'operator']), pin: pinSchema }).strict();

/** How the roles stand, for the operator window. */
export interface RolesView {
  /** Two PINs are set: roles are on. */
  on: boolean;
  /** Admin is unlocked (Session 44: until Lock, Simple Mode or quitting; there is no time limit). */
  admin: boolean;
  /** Too many wrong PINs: none is checked until then (ms since the epoch), or null. */
  waitUntil: number | null;
  /**
   * Locked because the PIN file could not be read (Sessions 31–36): Simple Mode, admin refused, no PIN
   * taken, until the admin guide's reset (roles.json and roles-held.json deleted at the computer).
   */
  held: boolean;
}

export const ROLES_OFF: RolesView = { on: false, admin: false, waitUntil: null, held: false };

/** Why nothing is unlocked while roles are held. */
export const ROLES_HELD =
  'Drashti could not read its PIN file, so roles are locked: Simple Mode, with admin refused. An admin resets them at the computer (the admin guide, “Resetting a forgotten admin PIN”).';

export type RolesResult = { ok: true; view: RolesView } | { ok: false; message: string; view: RolesView };

/** What an admin channel answers an operator. */
export const ADMIN_REFUSAL = 'Only an admin can change this. Unlock admin with the admin PIN.';

/** "Try again in 0:45" for a wait that ends at `until`. */
export function waitText(until: number, now: number): string {
  const s = Math.max(1, Math.ceil((until - now) / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Every request only an admin may make (with roles on). The rest of Pro
 * Mode is the operator's. Engine commands (running the show, switching the
 * Look, putting up a mask) are the operator's too; Simple Mode's own limits
 * (simple-mode.ts) come on top.
 */
export const ADMIN_CHANNELS: readonly InvokeChannel[] = [
  // The library: importing, removing, converting and finding media, and its settings.
  IPC.library.importPaths,
  IPC.library.pickImportPaths,
  IPC.library.relinkMedia,
  IPC.library.removePresentations,
  IPC.library.restorePresentations,
  IPC.library.setDefaultTransition,
  IPC.library.setExtras,
  // The single-letter keys (Session 37): B, ., L and ? on or off.
  IPC.app.setSingleKeys,
  IPC.kirtans.setTranslitStyle,
  IPC.media.convert,
  IPC.media.undoConversion,
  // Save as MP4… (Session 26e): it makes a file, and may import it, as converting does.
  IPC.media.saveTrim,
  IPC.media.remove,
  IPC.media.restore,
  // Video inputs (Session 50): naming this computer's inputs, as media is the admin's.
  IPC.videoInputs.add,
  IPC.videoInputs.update,
  IPC.videoInputs.remove,
  // A smart playlist (Session 26c) imports what its folder holds: made as importing is.
  IPC.playlists.createSmart,
  // Themes, the logo, Shastra texts, calendars and the idle rotation.
  IPC.themes.save,
  IPC.themes.remove,
  IPC.themes.setDefault,
  IPC.themes.apply,
  IPC.themes.fromPresentation,
  IPC.themes.fromSlide,
  IPC.props.setLogo,
  IPC.shastra.setTheme,
  IPC.shastra.remove,
  IPC.calendar.remove,
  IPC.idle.saveSettings,
  IPC.idle.saveQuote,
  IPC.idle.removeQuote,
  // Every schedule.
  IPC.backups.save,
  IPC.backups.pickFolder,
  IPC.backups.runNow,
  // Events out (Session 28): every request, looking too.
  IPC.events.view,
  IPC.events.add,
  IPC.events.update,
  IPC.events.remove,
  IPC.events.rotate,
  IPC.events.test,
  // The drop folder (Session 28): every request, looking too.
  IPC.drop.view,
  IPC.drop.pickFolder,
  IPC.drop.setOn,
  IPC.drop.importAnyway,
  // The MIDI controller.
  IPC.midi.set,
  // Screens, Looks, stage layouts, masks and the sound output.
  IPC.screens.createGroup,
  IPC.screens.renameGroup,
  IPC.screens.setGroupRole,
  IPC.screens.setGroupLanguages,
  IPC.screens.deleteGroup,
  IPC.screens.assignDisplay,
  IPC.screens.updateScreen,
  IPC.screens.removeScreen,
  IPC.screens.assignNodeDisplay,
  IPC.looks.create,
  IPC.looks.rename,
  IPC.looks.remove,
  IPC.looks.move,
  IPC.looks.setGroup,
  IPC.stageLayouts.save,
  IPC.stageLayouts.remove,
  IPC.masks.save,
  IPC.masks.remove,
  IPC.audio.setOutput,
  IPC.setup.finish,
  // The stream's settings and keys (going live, ending and recording are the operator's).
  IPC.stream.saveProfile,
  IPC.stream.setInputs,
  IPC.stream.removeProfile,
  IPC.stream.useProfile,
  IPC.stream.setKey,
  IPC.stream.removeKey,
  IPC.stream.pickFolder,
  // Import from a Link (Session 25b): looking at a link, choosing the folder, downloading; and the
  // highest video quality, for YouTube and Dropbox (Session 25c).
  IPC.links.look,
  IPC.links.pickFolder,
  IPC.links.download,
  IPC.links.addWaiting,
  IPC.links.setMaxHeight,
  // Updates: downloading, installing when Drashti quits, the daily look.
  IPC.updates.download,
  IPC.updates.setInstallOnQuit,
  IPC.updates.setAutoCheck,
  // Phones and nodes.
  IPC.network.setOn,
  IPC.network.setPort,
  IPC.network.startPairing,
  IPC.network.cancelPairing,
  IPC.network.renameDevice,
  IPC.network.revokeDevice,
  IPC.network.makePoster,
  IPC.nodes.startPairing,
  IPC.nodes.cancelPairing,
  IPC.nodes.rename,
  IPC.nodes.remove,
  IPC.nodes.newIdentity,
  IPC.nodes.everything,
  IPC.nodes.reload,
  // The PINs themselves.
  IPC.roles.setPins,
  IPC.roles.changePin,
  IPC.roles.turnOff,
];

const ADMIN_SET = new Set<string>(ADMIN_CHANNELS);

/** Whether only an admin may make this request (with roles on). */
export const isAdminChannel = (channel: string): boolean => ADMIN_SET.has(channel);
