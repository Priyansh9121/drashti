import { z } from 'zod';
import type { SlideElement } from './model';
import { slideElementSchema } from './model-schema';

/*
 * Props (PLAN.md 4.3): a logo or a fixed line of text that stays up
 * whatever slide is live, on the props layer, over the slides.
 */

export interface PropInfo {
  id: string;
  name: string;
  /** The canvas its elements are placed on (usually 1920 x 1080); screens scale it as they do slides. */
  width: number;
  height: number;
  elements: SlideElement[];
  /** Came from a ProPresenter props file (importing that file again replaces it). */
  imported: boolean;
}

export type PropFields = Pick<PropInfo, 'name' | 'width' | 'height' | 'elements'>;

export type PropResult = { ok: true; id: string } | { ok: false; message: string };

export const propFieldsSchema: z.ZodType<PropFields> = z
  .object({
    name: z.string().trim().min(1).max(80),
    width: z.number().int().min(16).max(16384),
    height: z.number().int().min(16).max(16384),
    elements: z.array(slideElementSchema).min(1).max(50),
  })
  .strict();
