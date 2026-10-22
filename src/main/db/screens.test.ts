import { beforeEach, describe, expect, it } from 'vitest';
import type { DisplayKey } from '../../shared/screens';
import { type Db, openDatabase } from './database';
import { NodeRepo } from './nodes';
import { ScreenRepo } from './screens';

let db: Db;
let repo: ScreenRepo;
const key: DisplayKey = {
  id: 2,
  label: 'Hall TV',
  pixelWidth: 1920,
  pixelHeight: 1080,
  x: 1440,
  y: 0,
  internal: false,
};

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new ScreenRepo(db);
});

describe('ScreenRepo', () => {
  it('creates groups in order and screens with the default canvas', () => {
    const hall = repo.createGroup('Main Hall');
    const lobby = repo.createGroup('Lobby', 'other');
    const id = repo.addScreen(hall, 'Hall TV', key);
    expect(repo.groups().map((g) => [g.name, g.role, g.screens.length])).toEqual([
      ['Main Hall', 'audience', 1],
      ['Lobby', 'other', 0],
    ]);
    expect(repo.screen(id)).toEqual({
      id,
      groupId: hall,
      name: 'Hall TV',
      displayKey: key,
      canvasWidth: 1920,
      canvasHeight: 1080,
      scaling: 'fit',
      enabled: true,
      feed: null,
      nodeId: null,
    });
    expect(repo.groupName(lobby)).toBe('Lobby');
  });

  it('updates canvas size, scaling, name and enabled', () => {
    const g = repo.createGroup('G');
    const id = repo.addScreen(g, 'S', null);
    expect(
      repo.updateScreen(id, {
        canvasWidth: 1536,
        canvasHeight: 384,
        scaling: 'stretch',
        name: 'LED wall',
        enabled: false,
      }),
    ).toBe(true);
    expect(repo.screen(id)).toMatchObject({
      canvasWidth: 1536,
      canvasHeight: 384,
      scaling: 'stretch',
      name: 'LED wall',
      enabled: false,
    });
    expect(repo.updateScreen('missing', { name: 'x' })).toBe(false);
    expect(repo.updateScreen(id, {})).toBe(true);
  });

  it('saves and clears the display assignment', () => {
    const g = repo.createGroup('G');
    const id = repo.addScreen(g, 'S', null);
    repo.setDisplayKey(id, key);
    expect(repo.screen(id)?.displayKey).toEqual(key);
    repo.setDisplayKey(id, null);
    expect(repo.screen(id)?.displayKey).toBeNull();
  });

  it('treats a corrupt display key as unassigned', () => {
    const g = repo.createGroup('G');
    const id = repo.addScreen(g, 'S', null);
    db.prepare('UPDATE screens SET display_key = ? WHERE id = ?').run('{"id": "two"}', id);
    expect(repo.screen(id)?.displayKey).toBeNull();
  });

  it('renames and deletes groups; deleting a group removes its screens', () => {
    const g = repo.createGroup('G');
    repo.addScreen(g, 'S', key);
    expect(repo.renameGroup(g, 'Hall')).toBe(true);
    expect(repo.groups()[0]?.name).toBe('Hall');
    expect(repo.deleteGroup(g)).toBe(true);
    expect(repo.screens()).toEqual([]);
    expect(repo.deleteGroup(g)).toBe(false);
  });

  it('removes a single screen', () => {
    const g = repo.createGroup('G');
    const id = repo.addScreen(g, 'S', key);
    expect(repo.removeScreen(id)).toBe(true);
    expect(repo.screen(id)).toBeNull();
  });
});

describe('putting the screens back exactly (Keep these screens?, Session 50)', () => {
  const node = (nodes: NodeRepo, hash: string) =>
    nodes.add({ name: 'Placeholder Lobby PC', tokenHash: hash.repeat(64), address: null, version: '1.0.0' });

  it('saves every group and screen as stored, and puts them back exactly after any change', () => {
    const nodes = new NodeRepo(db);
    const hall = repo.createGroup('Main Hall');
    const stage = repo.createGroup('Stage', 'stage');
    repo.ensureStreamGroup();
    const tv = repo.addScreen(hall, 'Hall TV', key);
    repo.updateScreen(tv, { canvasWidth: 1280, canvasHeight: 720, scaling: 'fill' });
    const off = repo.addScreen(stage, 'Stage TV', { ...key, id: 3, label: 'Stage TV', x: 3360 });
    repo.updateScreen(off, { enabled: false });
    const lobby = repo.addScreen(
      hall,
      'Lobby TV',
      { ...key, id: 7, label: 'Placeholder TV' },
      node(nodes, 'c').id,
    );
    const saved = repo.saved();
    const groups = repo.groups();

    // Everything a change can do: a group made with a screen, one renamed and given another role, a screen
    // moved and turned on, one removed, a group deleted.
    const made = repo.createGroup('Audience');
    repo.addScreen(made, 'Extra', { ...key, id: 4, label: 'Extra', x: 5280 });
    repo.renameGroup(stage, 'Performers');
    repo.setGroupRole(stage, 'audience');
    repo.moveScreen(tv, made);
    repo.updateScreen(off, { enabled: true });
    repo.removeScreen(lobby);
    repo.deleteGroup(hall);
    expect(repo.groups()).not.toEqual(groups);

    // The group made since is the one removed (its settings leave the Looks).
    expect(repo.putBack(saved)).toEqual([made]);
    expect(repo.groups()).toEqual(groups);
    expect(repo.saved()).toEqual(saved);
    expect(repo.screen(tv)).toMatchObject({
      groupId: hall,
      canvasWidth: 1280,
      canvasHeight: 720,
      scaling: 'fill',
    });
    expect(repo.screen(off)?.enabled).toBe(false);
  });

  it('never removes the stream’s group, and a screen on a node removed since stays gone', () => {
    const nodes = new NodeRepo(db);
    const hall = repo.createGroup('Hall');
    const n = node(nodes, 'd');
    repo.addScreen(hall, 'Lobby TV', key, n.id);
    const saved = repo.saved();
    // Made after the setup was taken: YouTube in Screens stays.
    const stream = repo.ensureStreamGroup().id;
    nodes.remove(n.id);
    expect(repo.putBack(saved)).toEqual([]);
    expect(repo.groups().map((g) => [g.name, g.screens.length])).toEqual([
      ['Hall', 0],
      ['Stream', 0],
    ]);
    expect(repo.streamGroup()).toEqual({ id: stream });
  });
});
