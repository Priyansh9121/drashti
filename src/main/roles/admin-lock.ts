import type { AudioOutputStatus } from '../../shared/audio';
import type { InvokeChannel } from '../../shared/ipc';
import { IPC } from '../../shared/ipc';
import type { RolesView } from '../../shared/roles';
import { ADMIN_CHANNELS, ADMIN_REFUSAL, ROLES_OFF } from '../../shared/roles';

/*
 * What each admin request answers an operator (with roles on, admin locked):
 * a refusal in its own result's shape, as Simple Mode's refusals are
 * (simple-mode.ts). The window asks for the admin PIN before it makes one
 * (the preload), so an operator sees this only after cancelling that.
 */

const refused = () => ({ ok: false as const, message: ADMIN_REFUSAL });

export function adminRefusals(
  sound: () => AudioOutputStatus,
  roles: () => RolesView = () => ROLES_OFF,
): Map<InvokeChannel, () => unknown> {
  const answers = new Map<InvokeChannel, () => unknown>(ADMIN_CHANNELS.map((c) => [c, refused]));
  // These answer in shapes of their own: no files picked, the sound output as it is, the roles as they are.
  answers.set(IPC.library.pickImportPaths, () => []);
  answers.set(IPC.audio.setOutput, sound);
  for (const c of [IPC.roles.setPins, IPC.roles.changePin, IPC.roles.turnOff])
    answers.set(c, () => ({ ok: false as const, message: ADMIN_REFUSAL, view: roles() }));
  return answers;
}
