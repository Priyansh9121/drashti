import { z } from 'zod';
import type { Mask, MaskResult } from '../../shared/masks';
import { maskDefinitionSchema, maskNameSchema } from '../../shared/masks';
import { idSchema } from '../../shared/model-schema';
import type { MaskRepo } from '../db/masks';

/*
 * The mask library as the mask editor changes it. Each change is saved;
 * then the Looks are read again (a group whose Look has the mask shows the
 * change at once), the Masks layer shows the new shapes if the mask is up,
 * and the operator window is told. Removing a mask takes it off the Masks
 * layer and out of every Look.
 */

export interface MaskServiceDeps {
  repo: MaskRepo;
  /** A mask was removed: no Look keeps it. */
  forgetInLooks(maskId: string): void;
  /** The Masks layer: the mask up now (or null), and putting one up or taking it down. */
  layer: { shown(): Mask | null; show(mask: Mask): void; clear(): void };
  /** The masks changed: the live Look draws them again, and the operator window is told. */
  changed(masks: Mask[]): void;
  log(message: string): void;
}

const inputSchema = z.object({ name: maskNameSchema }).and(maskDefinitionSchema);

export class MaskService {
  constructor(private readonly deps: MaskServiceDeps) {}

  list(): Mask[] {
    return this.deps.repo.list();
  }

  private done(id: string): MaskResult {
    const masks = this.deps.repo.list();
    this.deps.changed(masks);
    return { ok: true, masks, id };
  }

  /** Make a mask (no id) or save one. */
  save(rawId: unknown, raw: unknown): MaskResult {
    const id = idSchema.nullable().safeParse(rawId ?? null);
    const input = inputSchema.safeParse(raw);
    if (!id.success) return { ok: false, message: 'That mask no longer exists.' };
    if (!input.success)
      return {
        ok: false,
        message: 'A mask needs a name, a canvas from 16 to 16384 pixels each way, and up to 40 shapes.',
      };
    const { name, width, height, mode, shapes } = input.data;
    if (new Set(shapes.map((s) => s.id)).size !== shapes.length)
      return { ok: false, message: 'Two shapes have the same id.' };
    const def = { width, height, mode, shapes };
    if (id.data === null) {
      const made = this.deps.repo.create(name, def);
      this.deps.log(`Masks: made one with ${shapes.length} shape(s)`);
      return this.done(made);
    }
    if (!this.deps.repo.save(id.data, name, def))
      return { ok: false, message: 'That mask no longer exists.' };
    // Up on the Masks layer: the screens show the new shapes.
    if (this.deps.layer.shown()?.id === id.data) {
      const saved = this.deps.repo.get(id.data);
      if (saved) this.deps.layer.show(saved);
    }
    return this.done(id.data);
  }

  remove(rawId: unknown): MaskResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success || !this.deps.repo.remove(id.data))
      return { ok: false, message: 'That mask no longer exists.' };
    if (this.deps.layer.shown()?.id === id.data) this.deps.layer.clear();
    this.deps.forgetInLooks(id.data);
    this.deps.log('Masks: removed one');
    return this.done(id.data);
  }
}
