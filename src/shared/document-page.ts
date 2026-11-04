import { z } from 'zod';

/** A native page can have its own paper size without claiming an imported original. */
export interface PageSize {
  width: number;
  height: number;
}

export const pageSizeSchema: z.ZodType<PageSize> = z.object({
  width: z.number().min(16).max(16384),
  height: z.number().min(16).max(16384),
});

export function pageSizeFromJson(text: string | null | undefined): PageSize | undefined {
  if (!text) return undefined;
  try {
    const parsed = pageSizeSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** A page occurrence, independent of its position and of deduplicated preview pictures. */
export interface DocumentPageRef {
  sha256: string;
  ext: 'pdf' | 'pptx' | 'ppt' | 'key';
  /** Zero based, in the immutable source, including hidden slides. */
  page: number;
  /** Only an acknowledged content edit changes source playback into native elements. */
  edited?: boolean;
  /** The native page canvas; absent on older, unchanged source playback. */
  width?: number;
  height?: number;
  rotation?: 0 | 90 | 180 | 270;
  /** Main pins untouched saved playback when the presentation default changes. */
  playbackSize?: PageSize;
}

export const documentPageSchema: z.ZodType<DocumentPageRef> = z
  .object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    ext: z.enum(['pdf', 'pptx', 'ppt', 'key']),
    page: z.number().int().min(0).max(1999),
    edited: z.boolean().optional(),
    playbackSize: pageSizeSchema.optional(),
    width: z.number().min(16).max(16384).optional(),
    height: z.number().min(16).max(16384).optional(),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  })
  .refine(
    (page) => (page.width === undefined) === (page.height === undefined),
    'A page needs both dimensions.',
  );

export function documentPageFromJson(text: string | null | undefined): DocumentPageRef | undefined {
  if (!text) return undefined;
  try {
    const parsed = documentPageSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function documentCanvas(
  page: DocumentPageRef | undefined,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  if (!page?.edited || page.width === undefined || page.height === undefined)
    return page?.playbackSize ?? { width: fallback.width, height: fallback.height };
  return editingCanvas(page, fallback);
}

/** An unsaved prepared working page also previews at its own size. */
export function editingCanvas(
  page: DocumentPageRef | undefined,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  if (page?.width === undefined || page.height === undefined)
    return { width: fallback.width, height: fallback.height };
  return page.rotation === 90 || page.rotation === 270
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

/** The selected editor page takes precedence over the presentation's default size. */
export function slideCanvas(
  slide: { pageSize?: PageSize; documentPage?: DocumentPageRef } | undefined,
  fallback: PageSize,
): PageSize {
  return slide?.pageSize ?? editingCanvas(slide?.documentPage, fallback);
}
