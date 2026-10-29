import { z } from 'zod';
import type { EngineState } from '../../shared/engine/state';
import type { GroupLook, LiveGroupLook, LiveLook, LookInfo, LookResult, LooksView } from '../../shared/looks';
import { groupLookPatchSchema, lookNameSchema, NO_LOOK, storedGroupLook } from '../../shared/looks';
import type { Lang } from '../../shared/model';
import { idSchema } from '../../shared/model-schema';
import type { Mask } from '../../shared/masks';
import type { LookRepo } from '../db/looks';
import type { LookSource } from '../engine/show-engine';

/*
 * Looks as the operator changes them (Screens), and as the engine reads them
 * (LookSource). Every change is saved, then the engine reads the live Look
 * again, so the screens follow at once; the operator window and the phones
 * are told. Switching the live Look is the engine's own command (setLook).
 */

export interface LookServiceDeps {
  repo: LookRepo;
  /** A mask from the library, or null (gone). */
  mask?: (id: string) => Mask | null;
  engine: { current: EngineState; refreshLook(): unknown };
  /** The Looks changed: the operator window (and the phones) are told. */
  changed(view: LooksView): void;
  log(message: string): void;
}

/**
 * A Look ready to draw: every group's settings and each group's mask in full. No stage layout since Session 55: one
 * is chosen for every stage screen, in the engine's own `stage` (main/stage/stage-layout-service.ts).
 */
export function liveLook(info: LookInfo, mask: (id: string) => Mask | null = () => null): LiveLook {
  const groups: Record<string, LiveGroupLook> = {};
  for (const [id, g] of Object.entries(info.groups))
    groups[id] = {
      layers: [...g.layers],
      languages: g.languages ? [...g.languages] : null,
      slides: g.slides,
      mask: g.maskId ? mask(g.maskId) : null,
      idle: g.idle,
      movement: g.movement,
    };
  return { id: info.id, name: info.name, groups };
}

export class LookService implements LookSource {
  constructor(private readonly deps: LookServiceDeps) {}

  // ---- the engine's LookSource -------------------------------------------------------------

  look(lookId: string): LiveLook | null {
    const info = this.deps.repo.get(lookId);
    return info ? liveLook(info, this.deps.mask) : null;
  }

  start(): LiveLook {
    return this.look(this.deps.repo.firstId()) ?? NO_LOOK;
  }

  // ---- the operator's changes ----------------------------------------------------------------

  view(): LooksView {
    return { looks: this.deps.repo.list(), liveId: this.deps.engine.current.look.id };
  }

  /** Something changed: the live Look is read again, and everyone is told. */
  private done(): LookResult {
    this.deps.engine.refreshLook();
    const view = this.view();
    this.deps.changed(view);
    return { ok: true, view };
  }

  private fail(message: string): LookResult {
    return { ok: false, message };
  }

  create(rawName: unknown, rawCopyOf: unknown): LookResult {
    const name = lookNameSchema.safeParse(rawName);
    const copyOf = idSchema.nullable().safeParse(rawCopyOf ?? null);
    if (!name.success) return this.fail('Give the Look a name (up to 60 characters).');
    if (!copyOf.success || (copyOf.data !== null && !this.deps.repo.get(copyOf.data)))
      return this.fail('That Look no longer exists.');
    this.deps.repo.create(name.data, copyOf.data);
    this.deps.log(`Looks: made one${copyOf.data ? ' (a copy)' : ''}`);
    return this.done();
  }

  rename(rawId: unknown, rawName: unknown): LookResult {
    const id = idSchema.safeParse(rawId);
    const name = lookNameSchema.safeParse(rawName);
    if (!name.success) return this.fail('Give the Look a name (up to 60 characters).');
    if (!id.success || !this.deps.repo.rename(id.data, name.data))
      return this.fail('That Look no longer exists.');
    return this.done();
  }

  remove(rawId: unknown): LookResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success || !this.deps.repo.get(id.data)) return this.fail('That Look no longer exists.');
    if (this.deps.repo.count() <= 1) return this.fail('There must always be one Look.');
    this.deps.repo.remove(id.data);
    this.deps.log('Looks: removed one');
    // Removing the live Look puts the first one live (refreshLook).
    return this.done();
  }

  move(rawId: unknown, rawTo: unknown): LookResult {
    const id = idSchema.safeParse(rawId);
    const to = z.number().int().min(0).max(1000).safeParse(rawTo);
    if (!id.success || !to.success || !this.deps.repo.move(id.data, to.data))
      return this.fail('That Look no longer exists.');
    return this.done();
  }

  setGroup(rawLookId: unknown, rawGroupId: unknown, rawPatch: unknown): LookResult {
    const lookId = idSchema.safeParse(rawLookId);
    const groupId = idSchema.safeParse(rawGroupId);
    // A Look no longer chooses a stage layout (Session 55): said plainly, not as a setting it does not know.
    if (typeof rawPatch === 'object' && rawPatch !== null && 'stageLayoutId' in rawPatch)
      return this.fail(
        'A Look no longer chooses the stage layout: choose it for every stage screen in the Stage screen panel.',
      );
    const patch = groupLookPatchSchema.safeParse(rawPatch);
    if (!patch.success)
      return this.fail(
        'A group shows some layers, every language or one to four of them, slides as designed or as a lower third, and moves Calm or Bold.',
      );
    const look = lookId.success ? this.deps.repo.get(lookId.data) : null;
    if (!look) return this.fail('That Look no longer exists.');
    if (!groupId.success || !(groupId.data in look.groups)) return this.fail('That group no longer exists.');
    const maskId = patch.data.maskId;
    if (maskId && !this.deps.mask?.(maskId)) return this.fail('That mask no longer exists.');
    this.deps.repo.setGroup(look.id, groupId.data, patch.data);
    return this.done();
  }

  /** A group's languages in the live Look (Screens' and the setup wizard's language choice). */
  setLiveLanguages(groupId: string, languages: Lang[] | null): boolean {
    const live = this.deps.engine.current.look.id || this.deps.repo.firstId();
    const look = this.deps.repo.get(live);
    if (!look || !(groupId in look.groups)) return false;
    this.deps.repo.setGroup(live, groupId, { languages });
    this.done();
    return true;
  }

  /** A group's languages in the live Look. */
  liveLanguages(groupId: string): Lang[] | null {
    const languages = this.deps.engine.current.look.groups[groupId]?.languages ?? null;
    return languages ? [...languages] : null;
  }

  /** A new group starts with these languages in every Look (the setup wizard's choice). */
  groupMade(groupId: string, languages: Lang[] | null = null): void {
    if (languages !== null) this.deps.repo.setGroupEverywhere(groupId, { languages });
    this.done();
  }

  /** Masks changed (made, saved, removed): the live Look's groups draw them at once. */
  masksChanged(): void {
    this.done();
  }

  /**
   * The stage layout the live Look gives its first stage group, as Looks chose them before Session 55 (null for the
   * Standard stage screen): read once, at the first start after the update, as the one chosen for every stage screen.
   */
  liveStageLayoutId(): string | null {
    const live = this.deps.engine.current.look.id || this.deps.repo.firstId();
    return this.deps.repo.stageLayoutIdOf(live);
  }

  /** A group became a key and fill pair: in every Look, the words as a lower third, props and messages. */
  becameKeyFill(groupId: string): void {
    this.deps.repo.setGroupEverywhere(groupId, {
      layers: ['slide', 'props', 'messages'],
      slides: 'lowerThird',
    });
    this.done();
  }

  /** Groups were added, removed or changed role in Screens: the live Look covers them again. */
  groupsChanged(): void {
    this.done();
  }

  /** A group was deleted: no Look keeps its settings. */
  groupGone(groupId: string): void {
    this.deps.repo.forgetGroup(groupId);
    this.done();
  }

  /** Every Look's settings for every group, by Look id (Keep these screens?: what Go back may put back). */
  everyLook(): Record<string, Record<string, GroupLook>> {
    return Object.fromEntries(this.deps.repo.list().map((look) => [look.id, look.groups]));
  }

  /**
   * Groups' settings put back in Looks as they were (Keep these screens?'s Go back, Session 51): by Look id, then
   * group id; only those that differ from now change, in Looks and groups there are.
   */
  putGroupsBack(settings: Record<string, Record<string, GroupLook>>): void {
    for (const look of this.deps.repo.list())
      for (const [groupId, now] of Object.entries(look.groups)) {
        const was = settings[look.id]?.[groupId];
        if (was && JSON.stringify(storedGroupLook(was)) !== JSON.stringify(storedGroupLook(now)))
          this.deps.repo.setGroup(look.id, groupId, was);
      }
    this.done();
  }
}
