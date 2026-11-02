import { z } from 'zod';
import { EDITABLE_SOURCE_LIMITS, type EditablePdfPageWire } from '../../shared/editable-source';
import { slideElementSchema } from '../../shared/model-schema';

const bytes = z.instanceof(Uint8Array);
const token = z.string().min(1).max(512);
const pageSchema = z
  .object({
    mode: z.literal('editable-source'),
    jobId: token,
    sourceIndex: z.number().int().min(0),
    width: z.number().min(16).max(16_384),
    height: z.number().min(16).max(16_384),
    elements: z.array(slideElementSchema).max(EDITABLE_SOURCE_LIMITS.pageElements),
    assets: z.array(z.object({ token, png: bytes })).max(EDITABLE_SOURCE_LIMITS.pageElements),
    issues: z.array(z.string().max(300)).max(100),
  })
  .strict();
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function validateEditablePdfPage(
  raw: unknown,
  jobId: string,
  requested: ReadonlySet<number>,
): { page: EditablePdfPageWire; assetBytes: number; metadataBytes: number } | null {
  const parsed = pageSchema.safeParse(raw);
  if (!parsed.success || parsed.data.jobId !== jobId || !requested.has(parsed.data.sourceIndex)) return null;
  const page = parsed.data;
  const elementIds = new Set<string>();
  const needed = new Set<string>();
  for (const element of page.elements) {
    if (elementIds.has(element.id) || (element.kind !== 'text' && element.kind !== 'image')) return null;
    elementIds.add(element.id);
    if (element.kind === 'image') needed.add(element.mediaId);
    // Schemas allow deliberately broad coordinates; this private extraction reply is bounded tighter.
    const values = Object.values(element.frame);
    if (
      !values.every(
        (value: unknown) =>
          typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000,
      )
    )
      return null;
  }
  const tokens = new Set<string>();
  let assetBytes = 0;
  for (const asset of page.assets) {
    if (tokens.has(asset.token) || !needed.has(asset.token) || !PNG.every((byte, i) => asset.png[i] === byte))
      return null;
    tokens.add(asset.token);
    assetBytes += asset.png.byteLength;
    if (assetBytes > EDITABLE_SOURCE_LIMITS.pageAssetBytes) return null;
  }
  if (tokens.size !== needed.size) return null;
  const metadataBytes = Buffer.byteLength(
    JSON.stringify({
      sourceIndex: page.sourceIndex,
      width: page.width,
      height: page.height,
      elements: page.elements,
      issues: page.issues,
      tokens: [...tokens],
    }),
    'utf8',
  );
  if (metadataBytes > EDITABLE_SOURCE_LIMITS.pageMetadataBytes) return null;
  return { page, assetBytes, metadataBytes };
}
