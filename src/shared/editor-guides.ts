import { z } from 'zod';

/** Editor-only guide positions, in slide pixels; never drawn on an audience screen. */
export const editorGuidesSchema = z.object({
  x: z.array(z.number().min(0).max(16384)).max(32),
  y: z.array(z.number().min(0).max(16384)).max(32),
});
export type EditorGuides = z.infer<typeof editorGuidesSchema>;

export function editorGuidesFromJson(text: string | null | undefined): EditorGuides | undefined {
  if (!text) return undefined;
  try {
    const parsed = editorGuidesSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
