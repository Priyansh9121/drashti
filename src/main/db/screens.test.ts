import { beforeEach, describe, expect, it } from 'vitest';
import type { DisplayKey } from '../../shared/screens';
import { type Db, openDatabase } from './database';
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
