import { z } from 'zod';
import { matchDisplays } from '../../shared/display-match';
import { GROUP_ROLES } from '../../shared/screens';
import type {
  CoverOptions,
  DisplayInfo,
  ScreenPatch,
  ScreensResult,
  ScreensSnapshot,
} from '../../shared/screens';
import {
  coverOptionsSchema,
  displayIdSchema,
  groupLanguagesSchema,
  idSchema,
  nameSchema,
  screenPatchSchema,
} from '../../shared/screens-schema';
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
    /** The display the operator window is on (null when outputs cannot cover it, e.g. windowed outputs). */
    private readonly operatorDisplayId: () => number | null = () => null,
  ) {}

  /** An output on this display would cover the operator window, and the operator has not agreed. */
  private needsCoverConsent(displayId: number | null | undefined, rawOptions: unknown): ScreensResult | null {
    if (displayId === null || displayId === undefined || displayId !== this.operatorDisplayId()) return null;
    const options = coverOptionsSchema.safeParse(rawOptions ?? {});
    const agreed: CoverOptions = options.success ? options.data : {};
    if (agreed.coverOperator) return null;
    return {
      ok: false,
      confirm: 'covers-operator',
      message: 'The Drashti controls are on this display. An output here would cover them.',
    };
  }

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

  /** Audience screens show the picture; stage screens show the performers' view. */
  setGroupRole(rawId: unknown, rawRole: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    const role = z.enum(GROUP_ROLES).safeParse(rawRole);
    if (!id.success || !role.success)
      return this.fail('A group shows the audience picture or the stage view.');
    if (!this.repo.setGroupRole(id.data, role.data)) return this.fail('That group no longer exists.');
    return this.done();
  }

  /** The languages a group shows of a kirtan's slides, in order; null for all of them. */
  setGroupLanguages(rawId: unknown, rawLanguages: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    const languages = groupLanguagesSchema.safeParse(rawLanguages);
    if (!id.success || !languages.success)
      return this.fail('A group shows every language, or one to four of them, each once.');
    if (!this.repo.setGroupLanguages(id.data, languages.data))
      return this.fail('That group no longer exists.');
    return this.done();
  }

  deleteGroup(rawId: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success || !this.repo.deleteGroup(id.data)) return this.fail('That group no longer exists.');
    return this.done();
  }

  assignDisplay(rawGroupId: unknown, rawDisplayId: unknown, rawOptions?: unknown): ScreensResult {
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
    const consent = this.needsCoverConsent(display.id, rawOptions);
    if (consent) return consent;
    const count = this.repo.screens().length;
    this.repo.addScreen(groupId.data, display.label || `Screen ${count + 1}`, display.key);
    return this.done();
  }

  updateScreen(rawId: unknown, rawPatch: unknown, rawOptions?: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    const patch = screenPatchSchema.safeParse(rawPatch);
    if (!id.success) return this.fail('That screen no longer exists.');
    if (!patch.success)
      return this.fail('Canvas sizes are whole numbers from 16 to 16384; names need 1 to 80 characters.');
    const clean: ScreenPatch = patch.data;
    const current = this.repo.screen(id.data);
    if (!current) return this.fail('That screen no longer exists.');
    if (clean.enabled === true && !current.enabled && current.displayKey) {
      // Turning a screen back on: where would its output open?
      const displayId = matchDisplays(
        [{ screenId: current.id, key: current.displayKey }],
        this.listDisplays(),
      ).get(current.id);
      const consent = this.needsCoverConsent(displayId, rawOptions);
      if (consent) return consent;
    }
    if (!this.repo.updateScreen(id.data, clean)) return this.fail('That screen no longer exists.');
    return this.done();
  }

  /**
   * Turn off every output showing on the operator window's display, so the
   * controls can be reached again. They stay off (saved) until switched on.
   */
  uncoverOperator(): ScreensResult & { turnedOff?: string[] } {
    const operatorDisplay = this.operatorDisplayId();
    const covering = this.outputs
      .status()
      .filter((s) => s.state === 'showing' && s.displayId !== null && s.displayId === operatorDisplay);
    const turnedOff: string[] = [];
    for (const s of covering) {
      if (this.repo.updateScreen(s.screenId, { enabled: false }))
        turnedOff.push(this.repo.screen(s.screenId)?.name ?? s.screenId);
    }
    return { ...this.done(), turnedOff };
  }

  removeScreen(rawId: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success || !this.repo.removeScreen(id.data)) return this.fail('That screen no longer exists.');
    return this.done();
  }
}
