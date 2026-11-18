import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db/database';
import type { ContentRows } from '../db/content';
import { readContent } from '../db/content';
import { SettingsRepo } from '../db/settings';

const sha = z.string().regex(/^[0-9a-f]{64}$/u);
const stateSchema = z.object({
  presentationId: z.string(),
  incomingHash: sha.nullable(),
  localHash: sha,
  ids: z.record(z.string(), z.string()),
});
export type BundleState = z.infer<typeof stateSchema>;
const identityKey = (id: string) => `kirtanBundle.identity.${id}`;
const stateKey = (id: string) => `kirtanBundle.received.${id}`;

export function bundleState(db: Db, id: string): BundleState | null {
  const state = stateSchema.safeParse(new SettingsRepo(db).get(stateKey(id)));
  return state.success ? state.data : null;
}

export function keepBundleState(db: Db, id: string, state: BundleState): void {
  const settings = new SettingsRepo(db);
  settings.set(stateKey(id), state);
  settings.set(identityKey(state.presentationId), id);
}

/** All local content, title and presentation notes participate in conflict detection. */
export function bundleLocalHash(db: Db, id: string): string | null {
  const rows = readContent(db, id);
  const p = db
    .prepare('SELECT name, notes FROM presentations WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { name: string; notes: string } | undefined;
  return rows && p
    ? createHash('sha256')
        .update(JSON.stringify({ ...p, rows }))
        .digest('hex')
    : null;
}

/** Kept in the existing namespaced library metadata; no account or machine identity is exported. */
export function bundleIdentity(db: Db, presentationId: string): string {
  const settings = new SettingsRepo(db);
  const found = z.uuid().safeParse(settings.get(identityKey(presentationId)));
  if (found.success) return found.data;
  const made = randomUUID();
  settings.set(identityKey(presentationId), made);
  return made;
}

const entityKeys = new Set([
  'id',
  'presentationId',
  'group_id',
  'slide_id',
  'arrangement_id',
  'selectedArrangementId',
  'groupId',
  'sourceOccurrenceId',
]);
const mediaKeys = new Set([
  'media_id',
  'audio_media_id',
  'mediaId',
  'sourceStillId',
  'soundId',
  'posterId',
  'after',
]);
const jsonKeys = new Set(['props', 'deck', 'editor_design', 'editorMaster']);

/** Rewrite references only, never words. JSON settings are walked rather than searched as strings. */
export function mapBundleContent(
  rows: ContentRows,
  entity: (id: string) => string,
  media: (id: string) => string,
): ContentRows {
  const walk = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') {
      if (entityKeys.has(key)) return entity(value);
      if (mediaKeys.has(key)) return media(value);
      if (jsonKeys.has(key)) return JSON.stringify(walk(JSON.parse(value)));
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => walk(item));
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
    return value;
  };
  return walk(rows) as ContentRows;
}
