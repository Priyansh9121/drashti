import type { DisplayInfo, ScreenPatch, ScreensResult, ScreensSnapshot } from '../../shared/screens';
import { displayIdSchema, idSchema, nameSchema, screenPatchSchema } from '../../shared/screens-schema';
import type { ScreenRepo } from '../db/screens';
import type { OutputManager } from './output-manager';

/**
 * The operator's screen-setup actions. Every input is validated here (it
 * arrives over IPC), then saved, then the output windows are reconciled.
 */
export class ScreensService {
  constructor(
    private readonly repo: ScreenRepo,
    private readonly outputs: OutputManager,
    private readonly listDisplays: () => DisplayInfo[],
  ) {}

  snapshot(): ScreensSnapshot {
    return { displays: this.listDisplays(), groups: this.repo.groups(), status: this.outputs.status() };
  }

  private done(): ScreensResult {
    this.outputs.reconcile();
    return { ok: true, snapshot: this.snapshot() };
  }

  private fail(message: string): ScreensResult {
    return { ok: false, message };
  }

  createGroup(rawName: unknown): ScreensResult {
    const name = nameSchema.safeParse(rawName);
    if (!name.success) return this.fail('Give the group a name (up to 80 characters).');
    this.repo.createGroup(name.data);
    return this.done();
  }

  renameGroup(rawId: unknown, rawName: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    const name = nameSchema.safeParse(rawName);
    if (!id.success || !name.success) return this.fail('Give the group a name (up to 80 characters).');
    if (!this.repo.renameGroup(id.data, name.data)) return this.fail('That group no longer exists.');
    return this.done();
  }

  deleteGroup(rawId: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success || !this.repo.deleteGroup(id.data)) return this.fail('That group no longer exists.');
    return this.done();
  }

  assignDisplay(rawGroupId: unknown, rawDisplayId: unknown): ScreensResult {
    const groupId = idSchema.safeParse(rawGroupId);
    const displayId = displayIdSchema.safeParse(rawDisplayId);
    if (!groupId.success || !displayId.success) return this.fail('Choose a group and a display.');
    const groupName = this.repo.groupName(groupId.data);
    if (groupName === null) return this.fail('That group no longer exists.');
    const display = this.listDisplays().find((d) => d.id === displayId.data);
    if (!display) return this.fail('That display is not connected any more.');
    const user = this.outputs.status().find((s) => s.displayId === display.id);
    if (user) {
      const name = this.repo.screen(user.screenId)?.name ?? 'another screen';
      return this.fail(`That display is already used by "${name}".`);
    }
    const count = this.repo.screens().length;
    this.repo.addScreen(groupId.data, display.label || `Screen ${count + 1}`, display.key);
    return this.done();
  }

  updateScreen(rawId: unknown, rawPatch: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    const patch = screenPatchSchema.safeParse(rawPatch);
    if (!id.success) return this.fail('That screen no longer exists.');
    if (!patch.success)
      return this.fail('Canvas sizes are whole numbers from 16 to 16384; names need 1 to 80 characters.');
    const clean: ScreenPatch = patch.data;
    if (!this.repo.updateScreen(id.data, clean)) return this.fail('That screen no longer exists.');
    return this.done();
  }

  removeScreen(rawId: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success || !this.repo.removeScreen(id.data)) return this.fail('That screen no longer exists.');
    return this.done();
  }
}
