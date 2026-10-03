import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { langSchema } from '../shared/model-schema';
import type { DisplayInfo } from '../shared/screens';
import { openDatabase } from './db/database';
import { MIGRATIONS } from './db/migrate';

/*
 * For the end-to-end tests only (DRASHTI_SELFTEST=old-library, never in a
 * packaged Drashti): a library written as an older Drashti kept it, at the
 * schema version given, with screen groups and screens as that version
 * stored them. The test then starts Drashti on it, so the upgrade runs in the
 * real app (Session 11: each group's languages moving into the Looks).
 */

const requestSchema = z.object({
  /** The schema version to stop at (19: Session 10, before Looks). */
  schema: z.number().int().min(12).max(19),
  groups: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        role: z.enum(['audience', 'stage']),
        languages: z.array(langSchema).min(1).max(4).nullable(),
        /** Which display (by its place in the list) its one screen uses. */
        display: z.number().int().min(0).max(8),
      }),
    )
    .max(8),
});

export function writeOldLibrary(file: string, raw: string, displays: readonly DisplayInfo[]): void {
  const request = requestSchema.parse(JSON.parse(raw));
  const db = openDatabase(
    file,
    MIGRATIONS.filter((m) => m.version <= request.schema),
  );
  try {
    db.transaction(() => {
      request.groups.forEach((g, position) => {
        const groupId = randomUUID();
        db.prepare(
          'INSERT INTO screen_groups (id, name, role, position, languages) VALUES (?, ?, ?, ?, ?)',
        ).run(groupId, g.name, g.role, position, g.languages ? JSON.stringify(g.languages) : null);
        const display = displays[g.display];
        if (!display) throw new Error(`There is no display ${g.display}`);
        db.prepare(
          'INSERT INTO screens (id, group_id, name, display_key, position) VALUES (?, ?, ?, ?, 0)',
        ).run(randomUUID(), groupId, `${g.name} screen`, JSON.stringify(display.key));
      });
    })();
  } finally {
    db.close();
  }
}
