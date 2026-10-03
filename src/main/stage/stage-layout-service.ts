import { z } from 'zod';
import { idSchema } from '../../shared/model-schema';
import type { StageLayout, StageLayoutResult } from '../../shared/stage-layouts';
import { stageLayoutDefinitionSchema, stageLayoutNameSchema } from '../../shared/stage-layouts';
import type { StageLayoutRepo } from '../db/stage-layouts';

/*
 * Stage layouts as the layout editor changes them. Each change is saved,
 * then the Looks are read again (a stage group whose Look uses the layout
 * shows the change at once) and the operator window is told. Removing a
 * layout puts the Standard stage screen back wherever a Look used it.
 */

export interface StageLayoutServiceDeps {
  repo: StageLayoutRepo;
  /** A layout was removed: no Look uses it any more. */
  forgetInLooks(layoutId: string): void;
  /** Layouts changed: the live Look draws them again. */
  changed(layouts: StageLayout[]): void;
  log(message: string): void;
}

const inputSchema = z.object({ name: stageLayoutNameSchema }).and(stageLayoutDefinitionSchema);

export class StageLayoutService {
  constructor(private readonly deps: StageLayoutServiceDeps) {}

  list(): StageLayout[] {
    return this.deps.repo.list();
  }

  private done(id: string): StageLayoutResult {
    const layouts = this.deps.repo.list();
    this.deps.changed(layouts);
    return { ok: true, layouts, id };
  }

  /** Make a layout (no id) or save one: its name, background and boxes. */
  save(rawId: unknown, raw: unknown): StageLayoutResult {
    const id = idSchema.nullable().safeParse(rawId ?? null);
    const input = inputSchema.safeParse(raw);
    if (!id.success) return { ok: false, message: 'That stage layout no longer exists.' };
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
    if (!this.deps.repo.save(id.data, name, { background, boxes }))
      return { ok: false, message: 'That stage layout no longer exists.' };
    return this.done(id.data);
  }

  remove(rawId: unknown): StageLayoutResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success || !this.deps.repo.remove(id.data))
      return { ok: false, message: 'That stage layout no longer exists.' };
    this.deps.forgetInLooks(id.data);
    this.deps.log('Stage layouts: removed one');
    return this.done(id.data);
  }
}
