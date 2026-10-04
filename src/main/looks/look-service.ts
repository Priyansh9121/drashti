import { z } from 'zod';
import type { EngineState } from '../../shared/engine/state';
import type { LiveGroupLook, LiveLook, LookInfo, LookResult, LooksView } from '../../shared/looks';
import { groupLookPatchSchema, lookNameSchema, NO_LOOK } from '../../shared/looks';
import type { Lang } from '../../shared/model';
import { idSchema } from '../../shared/model-schema';
import type { Mask } from '../../shared/masks';
import type { StageLayout } from '../../shared/stage-layouts';
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
  /** A stage layout made in Drashti, or null (gone, or none: the Standard stage screen). */
  stageLayout?: (id: string) => StageLayout | null;
  /** A mask from the library, or null (gone). */
  mask?: (id: string) => Mask | null;
  engine: { current: EngineState; refreshLook(): unknown };
  /** The Looks changed: the operator window (and the phones) are told. */
  changed(view: LooksView): void;
  log(message: string): void;
}

/** A Look ready to draw: every group's settings, each stage group's layout and each group's mask in full. */
export function liveLook(
  info: LookInfo,
  stageLayout: (id: string) => StageLayout | null = () => null,
  mask: (id: string) => Mask | null = () => null,
): LiveLook {
  const groups: Record<string, LiveGroupLook> = {};
  for (const [id, g] of Object.entries(info.groups))
    groups[id] = {
      layers: [...g.layers],
      languages: g.languages ? [...g.languages] : null,
      slides: g.slides,
      stageLayout: g.stageLayoutId ? stageLayout(g.stageLayoutId) : null,
      mask: g.maskId ? mask(g.maskId) : null,
      idle: g.idle,
    };
  return { id: info.id, name: info.name, groups };
}

export class LookService implements LookSource {
  constructor(private readonly deps: LookServiceDeps) {}

  // ---- the engine's LookSource -------------------------------------------------------------

  look(lookId: string): LiveLook | null {
    const info = this.deps.repo.get(lookId);
    return info ? liveLook(info, this.deps.stageLayout, this.deps.mask) : null;
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
    const patch = groupLookPatchSchema.safeParse(rawPatch);
    if (!patch.success)
      return this.fail(
        'A group shows some layers, every language or one to four of them, and slides as designed or as a lower third.',
      );
    const look = lookId.success ? this.deps.repo.get(lookId.data) : null;
    if (!look) return this.fail('That Look no longer exists.');
    if (!groupId.success || !(groupId.data in look.groups)) return this.fail('That group no longer exists.');
    const layoutId = patch.data.stageLayoutId;
    if (layoutId && !this.deps.stageLayout?.(layoutId))
      return this.fail('That stage layout no longer exists.');
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

  /** Stage layouts changed (made, saved, removed): the live Look's stage groups draw them at once. */
  layoutsChanged(): void {
    this.done();
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
}
