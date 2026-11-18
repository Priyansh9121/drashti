import { z } from 'zod';
import type { ContentRows } from '../db/content';
import { editDocOf } from '../library/slides';
import { editDocSchema } from '../../shared/slide-edit';
import { idSchema, langSchema } from '../../shared/model-schema';
import { mediaMarkersSchema } from '../../shared/markers';

export const BUNDLE_LIMITS = {
  archive: 2 * 1024 ** 3,
  total: 2 * 1024 ** 3,
  entry: 512 * 1024 ** 2,
  document: 16 * 1024 ** 2,
  documents: 64 * 1024 ** 2,
  manifest: 1024 ** 2,
  entries: 4096,
  kirtans: 1000,
  ratio: 200,
  reserve: 2 * 1024 ** 3,
} as const;

const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const uuid = z.uuid();
const text = z.string().max(2000);
const json = z.string().max(BUNDLE_LIMITS.document);
const pos = z.number().int().nonnegative().max(100_000);
const bit = z.union([z.literal(0), z.literal(1)]);
const nullableText = text.nullable();

/** Portable data only: no source paths, library theme ids or executable macro bindings. */
const contentSchema: z.ZodType<ContentRows> = z
  .object({
    presentationId: idSchema,
    width: z.number().int().min(16).max(16384),
    height: z.number().int().min(16).max(16384),
    editorMaster: json.nullable().optional(),
    selectedArrangementId: idSchema.nullable(),
    themeId: z.null(),
    transition: json.nullable(),
    loop: bit,
    groups: z
      .array(z.object({ id: idSchema, name: text, color: nullableText, position: pos }).strict())
      .min(1)
      .max(500),
    slides: z
      .array(
        z
          .object({
            id: idSchema,
            group_id: idSchema,
            position: pos,
            label: text,
            notes: z.string().max(100_000),
            background: nullableText,
            darken: json.nullable(),
            transition: json.nullable(),
            auto_advance_ms: z
              .number()
              .int()
              .min(0)
              .max(7 * 24 * 3600 * 1000)
              .nullable(),
            enabled: bit,
            macro_id: z.null(),
            deck: json.nullable().optional(),
            editor_guides: json.nullable().optional(),
            editor_design: json.nullable().optional(),
            document_page: json.nullable().optional(),
            page_size: json.nullable().optional(),
          })
          .strict(),
      )
      .max(2000),
    elements: z
      .array(
        z
          .object({
            id: idSchema,
            slide_id: idSchema,
            position: pos,
            kind: z.enum(['text', 'shape', 'image', 'video', 'timer']),
            x: z.number(),
            y: z.number(),
            width: z.number().nonnegative(),
            height: z.number().nonnegative(),
            rotation: z.number(),
            props: json,
          })
          .strict(),
      )
      .max(100_000),
    cues: z
      .array(
        z
          .object({
            id: idSchema,
            slide_id: idSchema,
            position: pos,
            kind: z.enum(['background', 'audio', 'media', 'clear', 'message', 'timer', 'other']),
            label: text,
            media_id: idSchema.nullable(),
            props: z.string().max(20_000),
          })
          .strict(),
      )
      .max(20_000),
    arrangements: z
      .array(z.object({ id: idSchema, name: text, position: pos, source_ref: z.null() }).strict())
      .max(500),
    arrangementEntries: z
      .array(z.object({ arrangement_id: idSchema, position: pos, group_id: idSchema }).strict())
      .max(20_000),
    kirtan: z
      .object({
        row: z
          .object({
            category: z.string().max(120).nullable(),
            kavi: z.string().max(120).nullable(),
            raag: z.string().max(120).nullable(),
            occasions: z
              .string()
              .max(10_000)
              .refine((s) => {
                try {
                  return z.array(z.string().max(120)).max(50).safeParse(JSON.parse(s)).success;
                } catch {
                  return false;
                }
              }),
            audio_media_id: idSchema.nullable(),
          })
          .strict(),
      })
      .strict(),
    autoLines: z
      .array(z.object({ slide_id: idSchema, lang: langSchema, text: z.string().max(100_000) }).strict())
      .max(12_000),
  })
  .strict()
  .superRefine((rows, ctx) => {
    const groups = new Set(rows.groups.map((g) => g.id));
    const slides = new Set(rows.slides.map((s) => s.id));
    const arrangements = new Set(rows.arrangements.map((a) => a.id));
    const ids = [...rows.groups, ...rows.slides, ...rows.elements, ...rows.cues, ...rows.arrangements].map(
      (r) => r.id,
    );
    const valid =
      new Set(ids).size === ids.length &&
      rows.slides.every((s) => groups.has(s.group_id)) &&
      [...rows.elements, ...rows.cues, ...rows.autoLines].every((r) => slides.has(r.slide_id)) &&
      rows.arrangementEntries.every((r) => arrangements.has(r.arrangement_id) && groups.has(r.group_id)) &&
      (rows.selectedArrangementId === null || arrangements.has(rows.selectedArrangementId));
    if (!valid) ctx.addIssue({ code: 'custom', message: 'The kirtan has broken or repeated references.' });
    try {
      const { doc, unreadable } = editDocOf(rows, 'Placeholder');
      if (unreadable > 0 || !editDocSchema.safeParse(doc).success)
        ctx.addIssue({ code: 'custom', message: 'The kirtan has unreadable slides.' });
    } catch {
      ctx.addIssue({ code: 'custom', message: 'The kirtan has invalid slide settings.' });
    }
  });

export const bundleKirtanSchema = z
  .object({
    name: z.string().min(1).max(200),
    notes: z.string().max(100_000),
    content: contentSchema,
  })
  .strict();
export type BundleKirtan = z.infer<typeof bundleKirtanSchema>;

const file = z.object({
  entry: z.string().max(200),
  sha256: hash,
  bytes: z.number().int().min(1).max(BUNDLE_LIMITS.document),
});
export const bundleManifestSchema = z
  .object({
    format: z.literal('drashti-kirtans'),
    version: z.literal(1),
    kirtans: z
      .array(file.extend({ id: uuid }).strict())
      .min(1)
      .max(BUNDLE_LIMITS.kirtans),
    media: z
      .array(
        z
          .object({
            id: idSchema,
            name: z
              .string()
              .min(1)
              .max(255)
              .refine((n) => !/[\\/]/u.test(n) && !/\p{Cc}/u.test(n)),
            kind: z.enum(['image', 'video', 'audio']),
            entry: z.string().max(200).nullable(),
            sha256: hash.nullable(),
            bytes: z.number().int().nonnegative().max(BUNDLE_LIMITS.entry),
            markers: mediaMarkersSchema.nullable(),
          })
          .strict(),
      )
      .max(3000),
  })
  .strict()
  .superRefine((m, ctx) => {
    const ids = [...m.kirtans.map((k) => k.id), ...m.media.map((f) => f.id)];
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'An identity is repeated.' });
    for (const k of m.kirtans)
      if (k.entry !== `kirtans/${k.id}.json`)
        ctx.addIssue({ code: 'custom', message: 'Unsafe kirtan path.' });
    for (const f of m.media)
      if (
        f.entry !== null &&
        (!f.sha256 || !new RegExp(`^media/${f.sha256}\\.[a-z0-9]{1,10}$`, 'u').test(f.entry))
      )
        ctx.addIssue({ code: 'custom', message: 'Unsafe media path.' });
  });
export type BundleManifest = z.infer<typeof bundleManifestSchema>;
