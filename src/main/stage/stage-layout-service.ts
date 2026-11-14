import { z } from 'zod';
import { idSchema } from '../../shared/model-schema';
import type { StageChoiceResult, StageLayout, StageLayoutResult } from '../../shared/stage-layouts';
import { stageLayoutDefinitionSchema, stageLayoutNameSchema } from '../../shared/stage-layouts';
import type { StageLayoutRepo } from '../db/stage-layouts';

/*
 * Stage layouts as the layout editor changes them, and (Session 55) the one chosen for every stage screen: the Stage
 * screen panel's Layout, kept in the library's settings over a restart, and given to the engine, whose state carries
 * it to every stage screen, node and tablet. Each change is saved, then the operator window is told; a change to the
 * chosen layout (saved, renamed) reaches the stage screens at once. Removing the chosen layout puts the Standard stage
 * screen on them; put back (Undo), it is chosen again. Looks no longer choose a layout: at the first start after the
 * update, the layout of the Look in use became the chosen one.
 */

/** Where the chosen layout is kept: `{ id }`, null for the Standard stage screen; never set before Session 55. */
export const CHOSEN_SETTING = 'stage.layout';

export interface StageLayoutServiceDeps {
  repo: StageLayoutRepo;
  /** The library's settings (db/settings.ts), where the chosen layout is kept. */
  settings: { get(name: string): unknown; set(name: string, value: unknown): void };
  /**
   * The layout the Look in use gave its first stage group, as Looks chose them before Session 55 (null for the
   * Standard stage screen): read at the first start after the update only.
   */
  lookLayoutId(): string | null;
  /** The chosen layout (null: the Standard stage screen) to every stage screen: the engine's state. */
  show(layout: StageLayout | null): void;
  /** A layout was removed: no Look names it any more. */
  forgetInLooks?(layoutId: string): void;
  /** Layouts changed: the operator window is told. */
  changed(layouts: StageLayout[]): void;
  log(message: string): void;
}

const inputSchema = z.object({ name: stageLayoutNameSchema }).and(stageLayoutDefinitionSchema);
const chosenSchema = z.object({ id: idSchema.nullable() });
/**
 * A removed layout put back (Undo of Delete): as it was, its place, and whether it was the chosen one. Its name is the
 * one it was kept with, never cleaned again (C15, FT-1: the cleaning is for names given, not names kept).
 */
const restoreSchema = z.object({
  layout: z.object({ id: idSchema, name: z.string().trim().min(1).max(60) }).and(stageLayoutDefinitionSchema),
  at: z.number().int().min(0).max(10_000),
  chosen: z.boolean(),
});

const GONE = 'That stage layout no longer exists.';

export class StageLayoutService {
  constructor(private readonly deps: StageLayoutServiceDeps) {}

  list(): StageLayout[] {
    return this.deps.repo.list();
  }

  /**
   * At every start: the chosen layout to the stage screens. At the first start after the update (nothing kept yet),
   * the layout the Look in use gave its stage group becomes the chosen one, and is kept as chosen.
   */
  start(): void {
    if (this.deps.settings.get(CHOSEN_SETTING) === undefined) {
      const was = this.deps.lookLayoutId();
      const id = was !== null && this.deps.repo.get(was) ? was : null;
      this.keep(id);
      this.deps.log(
        id === null
          ? 'Stage layouts: one layout is now chosen for every stage screen; the Look in use gave none, so they show Standard'
          : 'Stage layouts: the layout of the Look in use is now the one every stage screen shows (Looks no longer choose it)',
      );
    }
    this.deps.show(this.chosen());
  }

  /** The chosen layout's id: null for the Standard stage screen (and for one kept that is gone). */
  chosenId(): string | null {
    const kept = chosenSchema.safeParse(this.deps.settings.get(CHOSEN_SETTING));
    const id = kept.success ? kept.data.id : null;
    return id !== null && this.deps.repo.get(id) ? id : null;
  }

  /** The chosen layout, ready to draw, or null for the Standard stage screen. */
  chosen(): StageLayout | null {
    const id = this.chosenId();
    return id === null ? null : this.deps.repo.get(id);
  }

  /** The Stage screen panel's Layout: this one for every stage screen at once (null: Standard), and kept. */
  choose(rawId: unknown): StageChoiceResult {
    const id = idSchema.nullable().safeParse(rawId ?? null);
    if (!id.success || (id.data !== null && !this.deps.repo.get(id.data)))
      return { ok: false, message: GONE };
    this.keep(id.data);
    this.deps.show(this.chosen());
    this.deps.log(
      `Stage layouts: ${id.data === null ? 'Standard' : 'a layout'} chosen for every stage screen`,
    );
    return { ok: true, chosenId: id.data };
  }

  private keep(id: string | null): void {
    this.deps.settings.set(CHOSEN_SETTING, { id });
  }

  private done(id: string): StageLayoutResult {
    const layouts = this.deps.repo.list();
    this.deps.changed(layouts);
    return { ok: true, layouts, id };
  }

  /** A change to a layout: when it is the chosen one, every stage screen draws it at once. */
  private redraw(id: string): void {
    if (this.chosenId() === id) this.deps.show(this.chosen());
  }

  /** Make a layout (no id) or save one: its name, background and boxes. */
  save(rawId: unknown, raw: unknown): StageLayoutResult {
    const id = idSchema.nullable().safeParse(rawId ?? null);
    const input = inputSchema.safeParse(raw);
    if (!id.success) return { ok: false, message: GONE };
    if (!input.success)
      return {
        ok: false,
        message:
          'A stage layout needs a name, a background colour, and up to 40 boxes, each on the stage canvas.',
      };
    const { name, background, boxes } = input.data;
    if (new Set(boxes.map((b) => b.id)).size !== boxes.length)
      return { ok: false, message: 'Two boxes have the same id.' };
    if (id.data === null) {
      const made = this.deps.repo.create(name, { background, boxes });
      this.deps.log(`Stage layouts: made one with ${boxes.length} box(es)`);
      return this.done(made);
    }
    if (!this.deps.repo.save(id.data, name, { background, boxes })) return { ok: false, message: GONE };
    this.redraw(id.data);
    return this.done(id.data);
  }

  /** Rename… (Session 55): its name only, its boxes as they are. */
  rename(rawId: unknown, rawName: unknown): StageLayoutResult {
    const id = idSchema.safeParse(rawId);
    const name = stageLayoutNameSchema.safeParse(rawName);
    if (!name.success) return { ok: false, message: 'Give the layout a name (up to 60 characters).' };
    if (!id.success || !this.deps.repo.rename(id.data, name.data)) return { ok: false, message: GONE };
    this.redraw(id.data);
    return this.done(id.data);
  }

  /** Delete: the chosen one deleted, every stage screen shows the Standard stage screen. */
  remove(rawId: unknown): StageLayoutResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success) return { ok: false, message: GONE };
    const wasChosen = this.chosenId() === id.data;
    if (!this.deps.repo.remove(id.data)) return { ok: false, message: GONE };
    this.deps.forgetInLooks?.(id.data);
    this.deps.log('Stage layouts: removed one');
    if (wasChosen) {
      this.keep(null);
      this.deps.show(null);
      this.deps.log('Stage layouts: the one removed was chosen, so every stage screen shows Standard');
    }
    return this.done(id.data);
  }

  /** Undo of Delete (Session 55): put back as it was, in its place, and chosen again if it was. */
  restore(raw: unknown): StageLayoutResult {
    const parsed = restoreSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, message: 'That stage layout cannot be put back.' };
    const { layout, at, chosen } = parsed.data;
    if (new Set(layout.boxes.map((b) => b.id)).size !== layout.boxes.length)
      return { ok: false, message: 'Two boxes have the same id.' };
    const kept: StageLayout = {
      id: layout.id,
      name: layout.name,
      background: layout.background,
      boxes: layout.boxes,
    };
    if (!this.deps.repo.restore(kept, at))
      return { ok: false, message: 'That stage layout is there already.' };
    this.deps.log('Stage layouts: put one back');
    if (chosen) {
      this.keep(kept.id);
      this.deps.show(this.chosen());
    }
    return this.done(kept.id);
  }
}
