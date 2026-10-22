import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  DisplayKey,
  ScalingMode,
  ScreenConfig,
  ScreenFeed,
  ScreenGroupConfig,
  ScreenPatch,
  ScreenRole,
} from '../../shared/screens';
import type { Db } from './database';

/** A group as stored, to put back exactly (Keep these screens?, Session 50). */
export interface SavedGroup {
  id: string;
  name: string;
  role: ScreenRole;
  position: number;
}

/** A screen as stored, to put back exactly. */
export interface SavedScreen {
  id: string;
  groupId: string;
  nodeId: string | null;
  name: string;
  /** Its display's fingerprint as stored (JSON), or null. */
  displayKey: string | null;
  canvasWidth: number;
  canvasHeight: number;
  scaling: ScalingMode;
  enabled: boolean;
  feed: ScreenFeed | null;
  position: number;
}

/** Every group and screen, as stored. */
export interface SavedScreens {
  groups: SavedGroup[];
  screens: SavedScreen[];
}

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

/** Groups in Screens' order, the stream's (YouTube, Session 26) after the rest. */
const STREAM_LAST = "role = 'stream', position, rowid";

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
      .prepare(`SELECT id, name, role FROM screen_groups ORDER BY ${STREAM_LAST}`)
      .all() as { id: string; name: string; role: ScreenRole }[];
    const screens = this.allScreens();
    return groups.map((g) => ({ ...g, screens: screens.filter((s) => s.groupId === g.id) }));
  }

  /** Every group's id and role, in order (cheap: no screens). */
  groupIds(): { id: string; role: ScreenRole }[] {
    return this.db.prepare(`SELECT id, role FROM screen_groups ORDER BY ${STREAM_LAST}`).all() as {
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

  /**
   * The stream's group, made (named "Stream", every language in every Look) when the library opens: at the
   * first start, or the first after an upgrade (Session 26). One already there keeps its name.
   */
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

  /** Every group and screen as stored (Keep these screens?, Session 50): what Go back puts back. */
  saved(): SavedScreens {
    const groups = this.db
      .prepare('SELECT id, name, role, position FROM screen_groups ORDER BY position, id')
      .all() as SavedGroup[];
    const rows = this.db.prepare('SELECT * FROM screens ORDER BY id').all() as (ScreenRow & {
      position: number;
    })[];
    return {
      groups,
      screens: rows.map((r) => ({
        id: r.id,
        groupId: r.group_id,
        nodeId: r.node_id,
        name: r.name,
        displayKey: r.display_key,
        canvasWidth: r.canvas_width,
        canvasHeight: r.canvas_height,
        scaling: r.scaling,
        enabled: r.enabled === 1,
        feed: r.feed,
        position: r.position,
      })),
    };
  }

  /**
   * Put every group and screen back exactly as saved (Go back, Session 50), in one transaction: those made
   * since are removed (never the stream's group: YouTube in Screens stays), the rest put back as they were,
   * those removed since made again with their own ids. A screen on a node removed since stays gone. Answers
   * the ids of the groups removed, whose settings leave the Looks.
   */
  putBack(saved: SavedScreens): string[] {
    return this.db.transaction(() => {
      const keepGroups = new Set(saved.groups.map((g) => g.id));
      const removed: string[] = [];
      for (const g of this.groupIds())
        if (!keepGroups.has(g.id) && g.role !== 'stream' && this.deleteGroup(g.id)) removed.push(g.id);
      const putGroup = this.db.prepare(
        `INSERT INTO screen_groups (id, name, role, position) VALUES (?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, role = excluded.role, position = excluded.position,
             updated_at = ${NOW}`,
      );
      for (const g of saved.groups) putGroup.run(g.id, g.name, g.role, g.position);
      const keepScreens = new Set(saved.screens.map((s) => s.id));
      const removeScreen = this.db.prepare('DELETE FROM screens WHERE id = ?');
      for (const { id } of this.db.prepare('SELECT id FROM screens').all() as { id: string }[])
        if (!keepScreens.has(id)) removeScreen.run(id);
      const nodes = new Set(
        (this.db.prepare('SELECT id FROM nodes').all() as { id: string }[]).map((n) => n.id),
      );
      const putScreen = this.db.prepare(
        `INSERT INTO screens (id, group_id, node_id, name, display_key, canvas_width, canvas_height, scaling,
             enabled, feed, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET group_id = excluded.group_id, node_id = excluded.node_id,
             name = excluded.name, display_key = excluded.display_key, canvas_width = excluded.canvas_width,
             canvas_height = excluded.canvas_height, scaling = excluded.scaling, enabled = excluded.enabled,
             feed = excluded.feed, position = excluded.position, updated_at = ${NOW}`,
      );
      for (const s of saved.screens)
        if (s.nodeId === null || nodes.has(s.nodeId))
          putScreen.run(
            s.id,
            s.groupId,
            s.nodeId,
            s.name,
            s.displayKey,
            s.canvasWidth,
            s.canvasHeight,
            s.scaling,
            s.enabled ? 1 : 0,
            s.feed,
            s.position,
          );
      return removed;
    })();
  }
}
