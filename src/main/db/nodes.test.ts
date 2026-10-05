import { describe, expect, it } from 'vitest';
import type { DisplayInfo } from '../../shared/screens';
import { openDatabase } from './database';
import { NodeRepo } from './nodes';
import { ScreenRepo } from './screens';

/* Paired nodes and the screens on their displays (migration 30); made-up names and hashes only. */

const display = (id: number, label: string): DisplayInfo => ({
  id,
  label,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  pixelWidth: 1920,
  pixelHeight: 1080,
  refreshHz: 60,
  rotation: 0,
  internal: false,
  primary: id === 1,
  key: { id, label, pixelWidth: 1920, pixelHeight: 1080, x: 0, y: 0, internal: false },
});

describe('NodeRepo', () => {
  it('keeps a paired node by its token’s hash, its displays, and when it was last seen', () => {
    const db = openDatabase(':memory:');
    const nodes = new NodeRepo(db);
    const n = nodes.add({
      name: 'Placeholder Lobby PC',
      tokenHash: 'a'.repeat(64),
      address: '192.168.1.30',
      version: '1.0.0',
    });
    expect(nodes.list()).toEqual([
      expect.objectContaining({ id: n.id, name: 'Placeholder Lobby PC', everything: false, displays: [] }),
    ]);
    expect(nodes.setDisplays(n.id, [display(7, 'Placeholder TV')])).toBe(true);
    expect(nodes.setDisplays(n.id, [display(7, 'Placeholder TV')])).toBe(false);
    expect(nodes.get(n.id)?.displays.map((d) => d.label)).toEqual(['Placeholder TV']);
    expect(nodes.setEverything(n.id, true)).toBe(true);
    expect(nodes.rename(n.id, 'Placeholder Hall PC')).toBe(true);
    // Seen a minute after pairing (times from now: pairing itself counts as seen).
    const later = new Date(Date.now() + 60_000).toISOString();
    nodes.touch(new Map([[n.id, { at: later, address: '192.168.1.31', version: null }]]));
    expect(nodes.get(n.id)).toMatchObject({
      name: 'Placeholder Hall PC',
      everything: true,
      lastSeenAt: later,
      address: '192.168.1.31',
      version: '1.0.0',
    });
    // A sighting older than the last one never moves it back.
    const earlier = new Date(Date.now() - 3_600_000).toISOString();
    nodes.touch(new Map([[n.id, { at: earlier, address: '192.168.1.32', version: null }]]));
    expect(nodes.get(n.id)).toMatchObject({ lastSeenAt: later, address: '192.168.1.31' });
    // The same token cannot be kept twice.
    expect(() =>
      nodes.add({ name: 'Copy', tokenHash: 'a'.repeat(64), address: null, version: '1.0.0' }),
    ).toThrow();
  });

  it('screens on a node are listed with their groups, not as this computer’s, and go with the node', () => {
    const db = openDatabase(':memory:');
    const nodes = new NodeRepo(db);
    const screens = new ScreenRepo(db);
    const hall = screens.createGroup('Hall');
    const local = screens.addScreen(hall, 'Hall TV', display(1, 'Built-in').key);
    const n = nodes.add({
      name: 'Placeholder Lobby PC',
      tokenHash: 'b'.repeat(64),
      address: null,
      version: '1.0.0',
    });
    const remote = screens.addScreen(hall, 'Lobby TV', display(7, 'Placeholder TV').key, n.id);
    expect(screens.screens().map((s) => s.id)).toEqual([local]);
    expect(screens.groups()[0]?.screens.map((s) => [s.id, s.nodeId])).toEqual([
      [local, null],
      [remote, n.id],
    ]);
    expect(screens.nodeScreens(n.id).map((s) => s.name)).toEqual(['Lobby TV']);
    expect(nodes.remove(n.id)).toBe(true);
    expect(screens.allScreens().map((s) => s.id)).toEqual([local]);
  });

  it('a playlist counts as changed whenever its items change (the week’s playlists)', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      "INSERT INTO playlists (id, name, updated_at) VALUES ('p', 'Placeholder', '2020-01-01T00:00:00.000Z')",
    ).run();
    db.prepare(
      "INSERT INTO playlist_items (id, playlist_id, position, kind, label) VALUES ('i', 'p', 0, 'header', 'Placeholder')",
    ).run();
    const at = (db.prepare("SELECT updated_at AS t FROM playlists WHERE id = 'p'").get() as { t: string }).t;
    expect(at > '2020-01-02').toBe(true);
  });
});
