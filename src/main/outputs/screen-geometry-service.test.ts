import { describe, expect, it } from 'vitest';
import { NO_LOOK } from '../../shared/looks';
import { nodeScreenSchema } from '../../shared/nodes-schema';
import type { ScreenGeometry } from '../../shared/screen-geometry';
import { DEFAULT_CURVE, DEFAULT_GAMMA, drawnGeometry, NO_GEOMETRY } from '../../shared/screen-geometry';
import type { DisplayInfo } from '../../shared/screens';
import { openDatabase } from '../db/database';
import type { Db } from '../db/database';
import { LookRepo } from '../db/looks';
import { ScreenRepo } from '../db/screens';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport } from '../engine/testing';
import { NO_PLAYLISTS } from '../engine/playlist-source';
import { LookService } from '../looks/look-service';
import { OutputManager, type OutputWindow } from './output-manager';
import { ScreensService } from './screens-service';
import { undoChange } from './screens-setup';

/*
 * A screen's geometry in Main (x27): kept with the screen in the library, checked before it is saved (a page is never
 * trusted), a key and fill pair's key drawing its fill's, One wide picture made and undone, the adjusting grid, and Go
 * back putting it back as it was.
 */

function looksOf(db: Db): LookService {
  let looks: LookService | null = null;
  const engine = new ShowEngine(makeSource(), new RecordingTransport(), Date.now, NO_PLAYLISTS, {
    looks: { start: () => looks?.start() ?? NO_LOOK },
  });
  looks = new LookService({ repo: new LookRepo(db), engine, log: () => undefined });
  engine.refreshLook();
  return looks;
}

const display = (id: number, x: number, label: string): DisplayInfo => ({
  id,
  label,
  bounds: { x, y: 0, width: 1920, height: 1080 },
  workArea: { x, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  pixelWidth: 1920,
  pixelHeight: 1080,
  refreshHz: 60,
  rotation: 0,
  internal: false,
  primary: false,
  key: { id, label, pixelWidth: 1920, pixelHeight: 1080, x, y: 0, internal: false },
});
const LEFT = display(2, 1440, 'Left projector');
const RIGHT = display(3, 3360, 'Right projector');

function setUp(): { service: ScreensService; repo: ScreenRepo; db: Db; changes: () => number } {
  const db = openDatabase(':memory:');
  const repo = new ScreenRepo(db);
  let windows = 0;
  let changes = 0;
  const outputs = new OutputManager({
    listDisplays: () => [LEFT, RIGHT],
    screens: () => repo.screens(),
    saveDisplayKey: (id, key) => {
      repo.setDisplayKey(id, key);
    },
    openWindow: (): OutputWindow => ({
      webContentsId: ++windows,
      setBounds: () => undefined,
      close: () => undefined,
      isDestroyed: () => false,
      hide: () => undefined,
      show: () => undefined,
    }),
    onChange: () => {
      changes++;
    },
  });
  const service = new ScreensService(
    repo,
    outputs,
    () => [LEFT, RIGHT],
    () => null,
    looksOf(db),
  );
  return { service, repo, db, changes: () => changes };
}

/** A group with a screen on each projector: its id and the screens' ids, left first. */
function pair(
  service: ScreensService,
  repo: ScreenRepo,
  name = 'Wide hall',
): { groupId: string; ids: string[] } {
  expect(service.createGroup(name).ok).toBe(true);
  const groupId = repo.groups().find((g) => g.name === name)?.id ?? '';
  expect(service.assignDisplay(groupId, LEFT.id).ok).toBe(true);
  expect(service.assignDisplay(groupId, RIGHT.id).ok).toBe(true);
  return { groupId, ids: repo.screens().map((s) => s.id) };
}

const KEYSTONE: ScreenGeometry = {
  ...NO_GEOMETRY,
  zoom: 0.96,
  offsetX: 0.01,
  corners: [
    { x: 0.04, y: 0.02 },
    { x: -0.03, y: 0 },
    { x: 0, y: 0 },
    { x: 0.01, y: -0.02 },
  ],
};

describe('a screen’s geometry, kept with the screen (x27)', () => {
  it('has nothing set until it is set; then it is saved with the screen, read back exactly, and cleared again', () => {
    const { service, repo } = setUp();
    const { ids } = pair(service, repo);
    const id = ids[0] ?? '';
    expect(repo.screen(id)?.geometry ?? null).toBeNull();
    const set = service.updateScreen(id, { geometry: KEYSTONE });
    expect(set.ok).toBe(true);
    expect(repo.screen(id)?.geometry).toEqual(KEYSTONE);
    // Screens' snapshot carries it, and the other screen keeps nothing set.
    if (set.ok)
      expect(set.snapshot.groups[0]?.screens.map((s) => s.geometry ?? null)).toEqual([KEYSTONE, null]);
    // Other changes leave it as it is.
    expect(service.updateScreen(id, { scaling: 'fill' }).ok).toBe(true);
    expect(repo.screen(id)?.geometry).toEqual(KEYSTONE);
    expect(service.updateScreen(id, { geometry: null }).ok).toBe(true);
    expect(repo.screen(id)?.geometry ?? null).toBeNull();
  });

  it('refuses a geometry out of bounds, corners that fold the picture, and a part or overlap that does not fit', () => {
    const { service, repo } = setUp();
    const id = pair(service, repo).ids[0] ?? '';
    const refused = [
      { ...KEYSTONE, zoom: 3 },
      { ...KEYSTONE, zoom: Number.NaN },
      { ...KEYSTONE, offsetY: 0.8 },
      {
        ...KEYSTONE,
        corners: [
          { x: 0.45, y: 0.45 },
          { x: -0.3, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: -0.3 },
        ],
      },
      { ...KEYSTONE, corners: [{ x: 0, y: 0 }] },
      // A part beyond the canvas's right edge (1920 wide).
      { ...NO_GEOMETRY, part: { x: 1000, width: 1920 } },
      // An overlap wider than half its part.
      { ...NO_GEOMETRY, blend: { left: 0, right: 1000, gamma: DEFAULT_GAMMA, curve: DEFAULT_CURVE } },
      { ...NO_GEOMETRY, blend: { left: 0, right: 100, gamma: 0.5, curve: DEFAULT_CURVE } },
      'tilted',
    ];
    for (const geometry of refused) {
      const result = service.updateScreen(id, { geometry });
      expect(result.ok, JSON.stringify(geometry)).toBe(false);
    }
    expect(repo.screen(id)?.geometry ?? null).toBeNull();
  });

  it('reads a geometry stored wrong as nothing set, never as a broken picture', () => {
    const { service, repo, db } = setUp();
    const id = pair(service, repo).ids[0] ?? '';
    const store = (json: string) => db.prepare('UPDATE screens SET geometry = ? WHERE id = ?').run(json, id);
    store('{"zoom": 9');
    expect(repo.screen(id)?.geometry ?? null).toBeNull();
    store(JSON.stringify({ ...KEYSTONE, zoom: 40 }));
    expect(repo.screen(id)?.geometry ?? null).toBeNull();
    store(JSON.stringify(KEYSTONE));
    expect(repo.screen(id)?.geometry).toEqual(KEYSTONE);
  });

  it('a key and fill pair’s key draws its fill’s geometry, so the two stay pixel-aligned', () => {
    const { service, repo } = setUp();
    const { groupId, ids } = pair(service, repo, 'Switcher');
    expect(service.setGroupRole(groupId, 'keyfill').ok).toBe(true);
    const [fillId, keyId] = ids;
    expect(service.updateScreen(fillId, { geometry: KEYSTONE }).ok).toBe(true);
    const screens = repo.groups().find((g) => g.id === groupId)?.screens ?? [];
    const fill = screens.find((s) => s.id === fillId);
    const key = screens.find((s) => s.id === keyId);
    expect(key?.feed).toBe('key');
    expect(fill && drawnGeometry(fill, screens)).toEqual(KEYSTONE);
    expect(key && drawnGeometry(key, screens)).toEqual(KEYSTONE);
    // Whatever the key's own says.
    expect(service.updateScreen(keyId, { geometry: { ...KEYSTONE, zoom: 1.5 } }).ok).toBe(true);
    const again = repo.groups().find((g) => g.id === groupId)?.screens ?? [];
    const keyAgain = again.find((s) => s.id === keyId);
    expect(keyAgain && drawnGeometry(keyAgain, again)).toEqual(KEYSTONE);
    // Back to an audience group, each its own.
    expect(service.setGroupRole(groupId, 'audience').ok).toBe(true);
    const own = repo.groups().find((g) => g.id === groupId)?.screens ?? [];
    const keyOwn = own.find((s) => s.id === keyId);
    expect(keyOwn && drawnGeometry(keyOwn, own)?.zoom).toBe(1.5);
  });

  it('One wide picture: the group’s screens, left to right, share a wide canvas, each its part and the ramps between', () => {
    const { service, repo } = setUp();
    const { groupId, ids } = pair(service, repo);
    expect(service.updateScreen(ids[1], { geometry: KEYSTONE }).ok).toBe(true);
    const made = service.makeWidePicture(groupId, 256);
    expect(made.ok).toBe(true);
    const [left, right] = ids.map((id) => repo.screen(id));
    expect([left?.canvasWidth, left?.canvasHeight, right?.canvasWidth]).toEqual([3584, 1080, 3584]);
    expect(left?.geometry).toEqual({
      ...NO_GEOMETRY,
      part: { x: 0, width: 1920 },
      blend: { left: 0, right: 256, gamma: DEFAULT_GAMMA, curve: DEFAULT_CURVE },
    });
    // A screen's own corners, zoom and move stay: only its part and ramps are One wide picture's.
    expect(right?.geometry).toEqual({
      ...KEYSTONE,
      part: { x: 1664, width: 1920 },
      blend: { left: 256, right: 0, gamma: DEFAULT_GAMMA, curve: DEFAULT_CURVE },
    });
    // Too wide an overlap, too few or too many screens, or a stage group: refused, nothing changed.
    expect(service.makeWidePicture(groupId, 1000).ok).toBe(false);
    expect(service.makeWidePicture('nope', 256).ok).toBe(false);
    // Separate pictures: each screen its own canvas again (as its part was), its corners kept.
    expect(service.separatePictures(groupId).ok).toBe(true);
    const [l2, r2] = ids.map((id) => repo.screen(id));
    expect([l2?.canvasWidth, l2?.canvasHeight, r2?.canvasWidth]).toEqual([1920, 1080, 1920]);
    expect(l2?.geometry ?? null).toBeNull();
    expect(r2?.geometry).toEqual(KEYSTONE);
  });

  it('One wide picture needs two to four screens', () => {
    const { service, repo } = setUp();
    expect(service.createGroup('One').ok).toBe(true);
    const groupId = repo.groups()[0]?.id ?? '';
    expect(service.assignDisplay(groupId, LEFT.id).ok).toBe(true);
    expect(service.makeWidePicture(groupId, 256)).toMatchObject({ ok: false });
  });

  it('the grid while a screen is adjusted: said for that screen only, never kept, and gone when the adjusting stops', () => {
    const { service, repo, changes } = setUp();
    const [a, b] = pair(service, repo).ids;
    const before = changes();
    expect(service.setAdjusting(a, true).ok).toBe(true);
    expect(changes()).toBeGreaterThan(before);
    expect(service.adjusting(a ?? '')).toBe(true);
    expect(service.adjusting(b ?? '')).toBe(false);
    expect(service.setAdjusting('nope', true).ok).toBe(false);
    service.stopAdjusting();
    expect(service.adjusting(a ?? '')).toBe(false);
    // Never in the library.
    expect(JSON.stringify(repo.saved())).not.toContain('adjust');
  });

  it('Go back puts a screen’s geometry back as it was, where it is still as the change left it', () => {
    const { service, repo } = setUp();
    const id = pair(service, repo).ids[0] ?? '';
    const before = { ...repo.saved(), looks: {} };
    expect(service.updateScreen(id, { geometry: KEYSTONE }).ok).toBe(true);
    const after = { ...repo.saved(), looks: {} };
    expect(after.screens.find((s) => s.id === id)?.geometry).toBe(JSON.stringify(KEYSTONE));
    const undone = undoChange(after, { before, after });
    expect(undone.screens.find((s) => s.id === id)?.geometry ?? null).toBeNull();
    repo.putBack(undone);
    expect(repo.screen(id)?.geometry ?? null).toBeNull();
  });

  it('a node’s screen carries its geometry and the grid, checked as Main checks it', () => {
    const base = {
      screenId: 's1',
      name: 'Node: Left',
      groupId: 'g1',
      groupName: 'Wide hall',
      role: 'audience',
      feed: null,
      canvasWidth: 1920,
      canvasHeight: 1080,
      scaling: 'fit',
      enabled: true,
      displayKey: LEFT.key,
    };
    expect(nodeScreenSchema.safeParse({ ...base, geometry: KEYSTONE, grid: true }).data).toMatchObject({
      geometry: KEYSTONE,
      grid: true,
    });
    // A screen saved before x27 has none.
    expect(nodeScreenSchema.safeParse(base).success).toBe(true);
    expect(nodeScreenSchema.safeParse({ ...base, geometry: { ...KEYSTONE, zoom: 9 } }).success).toBe(false);
  });
});
