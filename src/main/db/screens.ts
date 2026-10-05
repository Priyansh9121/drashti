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
  feed: 'fill' | 'key' | null;
  node_id: string | null;
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
    feed: r.feed,
    nodeId: r.node_id,
  };
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Screen groups and screens, persisted in SQLite. */
export class ScreenRepo {
  constructor(private readonly db: Db) {}

  /** This computer's own screens (the output manager opens their windows). */
  screens(): ScreenConfig[] {
    const rows = this.db
      .prepare(
        `SELECT s.* FROM screens s JOIN screen_groups g ON g.id = s.group_id
          WHERE s.node_id IS NULL ORDER BY g.position, g.rowid, s.position, s.rowid`,
      )
      .all() as ScreenRow[];
    return rows.map(toScreen);
  }

  /** Every screen, this computer's and the nodes' (Session 13). */
  allScreens(): ScreenConfig[] {
    const rows = this.db
      .prepare(
        `SELECT s.* FROM screens s JOIN screen_groups g ON g.id = s.group_id
          ORDER BY g.position, g.rowid, s.position, s.rowid`,
      )
      .all() as ScreenRow[];
    return rows.map(toScreen);
  }

  /** The screens on one node's displays. */
  nodeScreens(nodeId: string): ScreenConfig[] {
    return this.allScreens().filter((s) => s.nodeId === nodeId);
  }

  screen(id: string): ScreenConfig | null {
    const row = this.db.prepare('SELECT * FROM screens WHERE id = ?').get(id) as ScreenRow | undefined;
    return row ? toScreen(row) : null;
  }

  groups(): ScreenGroupConfig[] {
    const groups = this.db
      .prepare('SELECT id, name, role FROM screen_groups ORDER BY position, rowid')
      .all() as { id: string; name: string; role: ScreenRole }[];
    const screens = this.allScreens();
    return groups.map((g) => ({ ...g, screens: screens.filter((s) => s.groupId === g.id) }));
  }

  /** Every group's id and role, in order (cheap: no screens). */
  groupIds(): { id: string; role: ScreenRole }[] {
    return this.db.prepare('SELECT id, role FROM screen_groups ORDER BY position, rowid').all() as {
      id: string;
      role: ScreenRole;
    }[];
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

  /** The first group in this role, by its place in Screens (the stage display follows the first stage group). */
  firstGroup(role: ScreenRole): string | null {
    const row = this.db
      .prepare('SELECT id FROM screen_groups WHERE role = ? ORDER BY position, rowid LIMIT 1')
      .get(role) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /** The stream's group (role 'stream'): there is at most one, and it has no screens. */
  streamGroup(): { id: string } | null {
    const id = this.firstGroup('stream');
    return id ? { id } : null;
  }

  /** The stream's group, made (named "Stream", every language in every Look) the first time it is needed. */
  ensureStreamGroup(): { id: string; made: boolean } {
    const found = this.streamGroup();
    if (found) return { id: found.id, made: false };
    const names = new Set(this.groups().map((g) => g.name));
    let name = 'Stream';
    for (let n = 2; names.has(name); n++) name = `Stream ${n}`;
    return { id: this.createGroup(name, 'stream'), made: true };
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

  addScreen(
    groupId: string,
    name: string,
    displayKey: DisplayKey | null,
    nodeId: string | null = null,
  ): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO screens (id, group_id, name, display_key, node_id, position)
         VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM screens WHERE group_id = ?))`,
      )
      .run(id, groupId, name, displayKey ? JSON.stringify(displayKey) : null, nodeId, groupId);
    this.fixFeeds(groupId);
    return id;
  }

  /**
   * A key and fill group's screens each have a feed: one without is the
   * fill if the group has none yet, else the key. Other groups' screens have
   * none.
   */
  fixFeeds(groupId: string): void {
    const keyfill = this.groupRole(groupId) === 'keyfill';
    const screens = this.allScreens().filter((s) => s.groupId === groupId);
    if (!keyfill) {
      this.db.prepare('UPDATE screens SET feed = NULL WHERE group_id = ? AND feed IS NOT NULL').run(groupId);
      return;
    }
    let hasFill = screens.some((s) => s.feed === 'fill');
    for (const s of screens) {
      if (s.feed !== null) continue;
      const feed = hasFill ? 'key' : 'fill';
      hasFill = true;
      this.db.prepare(`UPDATE screens SET feed = ?, updated_at = ${NOW} WHERE id = ?`).run(feed, s.id);
    }
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
    if (patch.feed !== undefined) set('feed', patch.feed);
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
    const from = this.screen(id)?.groupId;
    const moved =
      this.db
        .prepare(
          `UPDATE screens SET group_id = ?, enabled = 1, feed = NULL, updated_at = ${NOW} WHERE id = ?`,
        )
        .run(groupId, id).changes > 0;
    if (moved) {
      this.fixFeeds(groupId);
      if (from) this.fixFeeds(from);
    }
    return moved;
  }

  removeScreen(id: string): boolean {
    return this.db.prepare('DELETE FROM screens WHERE id = ?').run(id).changes > 0;
  }
}
