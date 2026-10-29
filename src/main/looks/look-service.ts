import type { EngineState } from '../../shared/engine/state';
import type { GroupLook, LiveGroupLook, LiveLook, Movement } from '../../shared/looks';
import { NO_LOOK, roleLook, storedGroupLook } from '../../shared/looks';
import type { Lang } from '../../shared/model';
import type { ScreenRole } from '../../shared/screens';
import type { LookRepo } from '../db/looks';
import type { LookSource } from '../engine/show-engine';

/*
 * Each screen group's settings, as the engine reads them (LookSource) and Screens changes them (Session 55, Part 12:
 * Looks are gone from the window, the menus, the phone and the API). A group's languages are set in Screens and kept
 * where Drashti kept them since Session 11: in the library's first Look, the one Drashti always started with; the
 * rest of what a group draws its role gives it (shared/looks.ts roleLook). Nothing of the library's Looks is deleted:
 * every Look, and every other setting in them (layers, slide style, a mask, the idle rotation, Movement, a stage
 * layout), stays as it was, unread, so an older library or a backup opens and a restore loses nothing. Every change
 * is saved, then the engine reads the groups again, so the screens follow at once.
 */

export interface LookServiceDeps {
  repo: LookRepo;
  engine: { current: EngineState; refreshLook(): unknown };
  log(message: string): void;
}

/** Every group's settings, ready to draw: its role's, in its languages (shared/looks.ts roleLook). */
export function liveLook(
  look: { id: string; name: string; groups: Record<string, Pick<GroupLook, 'languages'>> },
  roles: readonly { id: string; role: ScreenRole }[],
): LiveLook {
  const groups: Record<string, LiveGroupLook> = {};
  for (const { id, role } of roles) groups[id] = roleLook(role, look.groups[id]?.languages ?? null);
  return { id: look.id, name: look.name, groups };
}

export class LookService implements LookSource {
  /** How every group moves: Calm, unless the performance check asks for Bold (moveAll). */
  private movement: Movement = 'calm';

  constructor(private readonly deps: LookServiceDeps) {}

  // ---- the engine's LookSource -------------------------------------------------------------

  start(): LiveLook {
    const info = this.deps.repo.get(this.deps.repo.firstId());
    if (!info) return NO_LOOK;
    const look = liveLook(info, this.deps.repo.groupRoles());
    if (this.movement === 'calm') return look;
    const moved = Object.fromEntries(
      Object.entries(look.groups).map(([id, g]) => [id, { ...g, movement: this.movement }]),
    );
    return { ...look, groups: moved };
  }

  /**
   * The performance check's Bold transitions only (perf-scenarios.ts bold-transitions): every group moves this way
   * until Drashti quits. Nothing in a show asks for it (Session 55: Movement went with Looks; every group is Calm).
   */
  moveAll(movement: Movement): void {
    this.movement = movement;
    this.done();
  }

  /** Something changed: the engine reads the groups again. */
  private done(): void {
    this.deps.engine.refreshLook();
  }

  // ---- Screens' changes (outputs/screens-service.ts ScreenLooks) ---------------------------------------------

  /** A group's languages (Screens' and the setup wizard's language choice), kept in the first Look. */
  setLiveLanguages(groupId: string, languages: Lang[] | null): boolean {
    const first = this.deps.repo.firstId();
    const look = this.deps.repo.get(first);
    if (!look || !(groupId in look.groups)) return false;
    this.deps.repo.setGroup(first, groupId, { languages });
    this.done();
    return true;
  }

  /** A group's languages, as its screens show them. */
  liveLanguages(groupId: string): Lang[] | null {
    const languages = this.deps.engine.current.look.groups[groupId]?.languages ?? null;
    return languages ? [...languages] : null;
  }

  /** A new group starts with these languages (the setup wizard's choice), in every Look as before. */
  groupMade(groupId: string, languages: Lang[] | null = null): void {
    if (languages !== null) this.deps.repo.setGroupEverywhere(groupId, { languages });
    this.done();
  }

  /**
   * The stage layout the first Look gives its first stage group, as Looks chose them before Session 55 (null for the
   * Standard stage screen): read once, at the first start after the update, as the one chosen for every stage screen.
   */
  liveStageLayoutId(): string | null {
    return this.deps.repo.stageLayoutIdOf(this.deps.engine.current.look.id || this.deps.repo.firstId());
  }

  /** Groups were added, removed or changed role in Screens: the screens draw each as it is now. */
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
