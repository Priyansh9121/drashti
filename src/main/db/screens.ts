import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  DisplayKey,
  ScalingMode,
  ScreenConfig,
  ScreenGroupConfig,
  ScreenPatch,
  ScreenRole,
} from '../../shared/screens';
import type { Lang } from '../../shared/model';
import { groupLanguagesSchema } from '../../shared/screens-schema';
import type { Db } from './database';

const displayKeySchema: z.ZodType<DisplayKey> = z.object({
  id: z.number(),
  label: z.string(),
  pixelWidth: z.number(),
  pixelHeight: z.number(),
  x: z.number(),
  y: z.number(),
  internal: z.boolean(),
});

interface ScreenRow {
  id: string;
  group_id: string;
  name: string;
  display_key: string | null;
  canvas_width: number;
  canvas_height: number;
  scaling: ScalingMode;
  enabled: number;
}

function parseKey(json: string | null): DisplayKey | null {
  if (!json) return null;
  try {
    const parsed = displayKeySchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A group's languages as stored; anything unreadable shows them all. */
function parseLangs(json: string | null): Lang[] | null {
  if (!json) return null;
  try {
    const parsed = groupLanguagesSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toScreen(r: ScreenRow): ScreenConfig {
  return {
    id: r.id,
    groupId: r.group_id,
    name: r.name,
    displayKey: parseKey(r.display_key),
    canvasWidth: r.canvas_width,
    canvasHeight: r.canvas_height,
    scaling: r.scaling,
    enabled: r.enabled === 1,
  };
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Screen groups and screens, persisted in SQLite. */
export class ScreenRepo {
  constructor(private readonly db: Db) {}

  screens(): ScreenConfig[] {
    const rows = this.db
      .prepare(
        `SELECT s.* FROM screens s JOIN screen_groups g ON g.id = s.group_id
          WHERE s.node_id IS NULL ORDER BY g.position, g.rowid, s.position, s.rowid`,
      )
      .all() as ScreenRow[];
    return rows.map(toScreen);
  }

  screen(id: string): ScreenConfig | null {
    const row = this.db.prepare('SELECT * FROM screens WHERE id = ?').get(id) as ScreenRow | undefined;
    return row ? toScreen(row) : null;
  }

  groups(): ScreenGroupConfig[] {
    const groups = this.db
      .prepare('SELECT id, name, role, languages FROM screen_groups ORDER BY position, rowid')
      .all() as { id: string; name: string; role: ScreenRole; languages: string | null }[];
    const screens = this.screens();
    return groups.map((g) => ({
      ...g,
      languages: parseLangs(g.languages),
      screens: screens.filter((s) => s.groupId === g.id),
    }));
  }

  /** The languages a group shows, in order; null for all of them. */
  groupLanguages(id: string): Lang[] | null {
    const row = this.db.prepare('SELECT languages FROM screen_groups WHERE id = ?').get(id) as
      { languages: string | null } | undefined;
    return parseLangs(row?.languages ?? null);
  }

  setGroupLanguages(id: string, languages: readonly Lang[] | null): boolean {
    return (
      this.db
        .prepare(`UPDATE screen_groups SET languages = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(languages ? JSON.stringify(languages) : null, id).changes > 0
    );
  }

  groupName(id: string): string | null {
    const row = this.db.prepare('SELECT name FROM screen_groups WHERE id = ?').get(id) as
      { name: string } | undefined;
    return row?.name ?? null;
  }

  groupRole(id: string): ScreenRole | null {
    const row = this.db.prepare('SELECT role FROM screen_groups WHERE id = ?').get(id) as
      { role: ScreenRole } | undefined;
    return row?.role ?? null;
  }

  setGroupRole(id: string, role: ScreenRole): boolean {
    return (
      this.db.prepare(`UPDATE screen_groups SET role = ?, updated_at = ${NOW} WHERE id = ?`).run(role, id)
        .changes > 0
    );
  }

  createGroup(name: string, role: ScreenRole = 'audience'): string {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO screen_groups (id, name, role, position) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM screen_groups))',
      )
      .run(id, name, role);
    return id;
  }

  /** The languages the first stage group shows (by its place in Screens); null for all, or when there is none. */
  stageLanguages(): Lang[] | null {
    const row = this.db
      .prepare("SELECT languages FROM screen_groups WHERE role = 'stage' ORDER BY position, rowid LIMIT 1")
      .get() as { languages: string | null } | undefined;
    return parseLangs(row?.languages ?? null);
  }

  /** The stream's group (role 'stream'): there is at most one, and it has no screens. */
  streamGroup(): { id: string; languages: Lang[] | null } | null {
    const row = this.db
      .prepare(
        "SELECT id, languages FROM screen_groups WHERE role = 'stream' ORDER BY position, rowid LIMIT 1",
      )
      .get() as { id: string; languages: string | null } | undefined;
    return row ? { id: row.id, languages: parseLangs(row.languages) } : null;
  }

  /** The stream's group, made (named "Stream", every language) the first time it is needed. */
  ensureStreamGroup(): { id: string; languages: Lang[] | null } {
    const found = this.streamGroup();
    if (found) return found;
    const names = new Set(this.groups().map((g) => g.name));
    let name = 'Stream';
    for (let n = 2; names.has(name); n++) name = `Stream ${n}`;
    return { id: this.createGroup(name, 'stream'), languages: null };
  }

  renameGroup(id: string, name: string): boolean {
    return (
      this.db.prepare(`UPDATE screen_groups SET name = ?, updated_at = ${NOW} WHERE id = ?`).run(name, id)
        .changes > 0
    );
  }

  deleteGroup(id: string): boolean {
    return this.db.prepare('DELETE FROM screen_groups WHERE id = ?').run(id).changes > 0;
  }

  addScreen(groupId: string, name: string, displayKey: DisplayKey | null): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO screens (id, group_id, name, display_key, position)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM screens WHERE group_id = ?))`,
      )
      .run(id, groupId, name, displayKey ? JSON.stringify(displayKey) : null, groupId);
    return id;
  }

  updateScreen(id: string, patch: ScreenPatch): boolean {
    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      sets.push(`${column} = ?`);
      values.push(value);
    };
    if (patch.name !== undefined) set('name', patch.name);
    if (patch.canvasWidth !== undefined) set('canvas_width', patch.canvasWidth);
    if (patch.canvasHeight !== undefined) set('canvas_height', patch.canvasHeight);
    if (patch.scaling !== undefined) set('scaling', patch.scaling);
    if (patch.enabled !== undefined) set('enabled', patch.enabled ? 1 : 0);
    if (sets.length === 0) return this.screen(id) !== null;
    return (
      this.db
        .prepare(`UPDATE screens SET ${sets.join(', ')}, updated_at = ${NOW} WHERE id = ?`)
        .run(...values, id).changes > 0
    );
  }

  setDisplayKey(id: string, key: DisplayKey | null): void {
    this.db
      .prepare(`UPDATE screens SET display_key = ?, updated_at = ${NOW} WHERE id = ?`)
      .run(key ? JSON.stringify(key) : null, id);
  }

  /** Move a screen to another group (its settings stay), switched on. */
  moveScreen(id: string, groupId: string): boolean {
    return (
      this.db
        .prepare(`UPDATE screens SET group_id = ?, enabled = 1, updated_at = ${NOW} WHERE id = ?`)
        .run(groupId, id).changes > 0
    );
  }

  removeScreen(id: string): boolean {
    return this.db.prepare('DELETE FROM screens WHERE id = ?').run(id).changes > 0;
  }
}
