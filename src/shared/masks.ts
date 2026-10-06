import { z } from 'zod';
import type { Rect } from './model';
import { idSchema } from './model-schema';

/*
 * Masks (Session 11): shapes that hide what is under them, or the inverse
 * (show only what is inside them), drawn on a canvas of their own size and
 * stretched over a screen's. A mask makes what it hides see-through, not
 * black: an audience screen shows its black behind, and a key and fill pair
 * keys it out (render/Scene.tsx).
 *
 * Masks apply in two places:
 * - In a Look, a group's mask is its screens' own shape (an LED wall's
 *   outline, a projector hitting a pillar). It is always there in that Look,
 *   over everything including the logo; Clear all, F7 and Simple Mode never
 *   take it away.
 * - The Masks layer: the operator puts a mask from the library up on the
 *   audience screens for a while (a circle round a video, a band for the
 *   words) and takes it down with F7, Clear all or Put it back, as any layer.
 *   A group's Look can leave the Masks layer out.
 * Stage screens ignore masks. The stream keeps its own rules: in the Slides
 * layout it follows the Masks layer as the hall does; in Camera and words it
 * leaves masks out.
 */

export type MaskShapeKind = 'rectangle' | 'rounded' | 'ellipse';
export const MASK_SHAPE_KINDS = [
  'rectangle',
  'rounded',
  'ellipse',
] as const satisfies readonly MaskShapeKind[];
export const MASK_SHAPE_NAMES: Record<MaskShapeKind, string> = {
  rectangle: 'Rectangle',
  rounded: 'Rounded rectangle',
  ellipse: 'Ellipse',
};

export interface MaskShape {
  id: string;
  kind: MaskShapeKind;
  /** On the mask's canvas. */
  frame: Rect;
  /** A rounded rectangle's corners (canvas pixels). */
  radius?: number;
}

/** Hide what is inside the shapes, or show only what is inside them. */
export type MaskMode = 'hide' | 'show';

export interface Mask {
  id: string;
  name: string;
  /** The canvas it is drawn on (stretched over a screen's). */
  width: number;
  height: number;
  mode: MaskMode;
  shapes: MaskShape[];
}

export type MaskResult = { ok: true; masks: Mask[]; id: string } | { ok: false; message: string };

export const MAX_MASK_SHAPES = 40;

export const maskShapeSchema: z.ZodType<MaskShape> = z.object({
  id: idSchema,
  kind: z.enum(MASK_SHAPE_KINDS),
  frame: z.object({
    x: z.number().min(-16384).max(32768),
    y: z.number().min(-16384).max(32768),
    width: z.number().min(1).max(32768),
    height: z.number().min(1).max(32768),
  }),
  radius: z.number().min(0).max(16384).optional(),
});

/** What a mask keeps in the library (its id and name are columns of their own). */
export const maskDefinitionSchema = z.object({
  width: z.number().int().min(16).max(16384),
  height: z.number().int().min(16).max(16384),
  mode: z.enum(['hide', 'show']),
  shapes: z.array(maskShapeSchema).max(MAX_MASK_SHAPES),
});
export type MaskDefinition = z.infer<typeof maskDefinitionSchema>;

export const maskSchema: z.ZodType<Mask> = maskDefinitionSchema.extend({
  id: idSchema,
  name: z.string().max(60),
});

export const maskNameSchema = z.string().trim().min(1).max(60);

const n = (v: number) => String(Math.round(v * 100) / 100);

function shapeSvg(s: MaskShape): string {
  const f = s.frame;
  if (s.kind === 'ellipse')
    return `<ellipse cx="${n(f.x + f.width / 2)}" cy="${n(f.y + f.height / 2)}" rx="${n(f.width / 2)}" ry="${n(f.height / 2)}"/>`;
  const r = s.kind === 'rounded' ? Math.min(s.radius ?? 0, f.width / 2, f.height / 2) : 0;
  return `<rect x="${n(f.x)}" y="${n(f.y)}" width="${n(f.width)}" height="${n(f.height)}" rx="${n(r)}"/>`;
}

/**
 * The mask as an image whose opacity says what shows: opaque where the
 * picture shows, see-through where the mask hides it. Shapes that overlap
 * hide (or show) their whole area, whichever way they overlap.
 */
export function maskSvg(mask: Pick<Mask, 'width' | 'height' | 'mode' | 'shapes'>): string {
  const { width: w, height: h } = mask;
  const hide = mask.mode === 'hide';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">` +
    `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" fill="${hide ? '#fff' : '#000'}"/>` +
    `<g fill="${hide ? '#000' : '#fff'}">${mask.shapes.map(shapeSvg).join('')}</g>` +
    `</mask><rect width="${w}" height="${h}" fill="#000" mask="url(#m)"/></svg>`
  );
}

/** The mask as a CSS image (a data URL). */
export const maskImageUrl = (mask: Pick<Mask, 'width' | 'height' | 'mode' | 'shapes'>): string =>
  `url("data:image/svg+xml,${encodeURIComponent(maskSvg(mask))}")`;

/**
 * The mask's cover, as a CSS image: black where the mask hides, see-through
 * where the picture shows (the mask image the other way round). Laid over a
 * picture on black, it gives the same pixels as masking it.
 */
export const maskCoverUrl = (mask: Pick<Mask, 'width' | 'height' | 'mode' | 'shapes'>): string =>
  maskImageUrl({ ...mask, mode: mask.mode === 'hide' ? 'show' : 'hide' });

/** A new shape in the middle of a mask's canvas, a third of its size. */
export function newMaskShape(
  kind: MaskShapeKind,
  id: string,
  canvas: { width: number; height: number },
): MaskShape {
  const width = Math.round(canvas.width / 3);
  const height = Math.round(canvas.height / 3);
  return {
    id,
    kind,
    frame: {
      x: Math.round((canvas.width - width) / 2),
      y: Math.round((canvas.height - height) / 2),
      width,
      height,
    },
    ...(kind === 'rounded' ? { radius: Math.round(Math.min(width, height) / 8) } : {}),
  };
}
