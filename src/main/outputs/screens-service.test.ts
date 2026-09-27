import { beforeEach, describe, expect, it } from 'vitest';
import type { DisplayInfo } from '../../shared/screens';
import { openDatabase } from '../db/database';
import { ScreenRepo } from '../db/screens';
import { OutputManager, type OutputWindow } from './output-manager';
import { ScreensService } from './screens-service';

const hall: DisplayInfo = {
  id: 2,
  label: 'Hall TV',
  bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  pixelWidth: 1920,
  pixelHeight: 1080,
  refreshHz: 60,
  rotation: 0,
  internal: false,
  primary: false,
  key: { id: 2, label: 'Hall TV', pixelWidth: 1920, pixelHeight: 1080, x: 1440, y: 0, internal: false },
};

let service: ScreensService;
let repo: ScreenRepo;
let windows: number;

beforeEach(() => {
  const db = openDatabase(':memory:');
  repo = new ScreenRepo(db);
  windows = 0;
  const outputs = new OutputManager({
    listDisplays: () => [hall],
    screens: () => repo.screens(),
    saveDisplayKey: (id, key) => {
      repo.setDisplayKey(id, key);
    },
    openWindow: (): OutputWindow => ({
      webContentsId: ++windows,
      setBounds: () => undefined,
      close: () => undefined,
      isDestroyed: () => false,
    }),
    onChange: () => undefined,
  });
  service = new ScreensService(repo, outputs, () => [hall]);
});

describe('ScreensService', () => {
  it('creates a group, assigns a display, and opens its output', () => {
    const created = service.createGroup('  Main Hall ');
    expect(created.ok).toBe(true);
    const groupId = repo.groups()[0]?.id;
    const assigned = service.assignDisplay(groupId, 2);
    expect(assigned).toMatchObject({ ok: true });
    if (!assigned.ok) return;
    expect(assigned.snapshot.groups[0]).toMatchObject({ name: 'Main Hall', screens: [{ name: 'Hall TV' }] });
    expect(assigned.snapshot.status).toEqual([
      { screenId: expect.any(String) as string, state: 'showing', displayId: 2 },
    ]);
    expect(windows).toBe(1);
  });

  it('refuses to use one display twice', () => {
    service.createGroup('A');
    const groupId = repo.groups()[0]?.id;
    service.assignDisplay(groupId, 2);
    expect(service.assignDisplay(groupId, 2)).toEqual({
      ok: false,
      message: 'That display is already used by "Hall TV".',
    });
  });

  it('validates every input', () => {
    expect(service.createGroup('')).toMatchObject({ ok: false });
    expect(service.createGroup('x'.repeat(81))).toMatchObject({ ok: false });
    expect(service.createGroup(42)).toMatchObject({ ok: false });
    expect(service.assignDisplay('nope', 2)).toEqual({ ok: false, message: 'That group no longer exists.' });
    service.createGroup('A');
    const groupId = repo.groups()[0]?.id;
    expect(service.assignDisplay(groupId, 99)).toEqual({
      ok: false,
      message: 'That display is not connected any more.',
    });
    expect(service.assignDisplay(groupId, -1)).toMatchObject({ ok: false });
    service.assignDisplay(groupId, 2);
    const screenId = repo.screens()[0]?.id;
    expect(service.updateScreen(screenId, { canvasWidth: 15 })).toMatchObject({ ok: false });
    expect(service.updateScreen(screenId, { canvasWidth: 1920.5 })).toMatchObject({ ok: false });
    expect(service.updateScreen(screenId, { scaling: 'zoom' })).toMatchObject({ ok: false });
    expect(service.updateScreen('missing', { name: 'x' })).toMatchObject({ ok: false });
  });

  it('sets a custom canvas size and scaling', () => {
    service.createGroup('LED');
    service.assignDisplay(repo.groups()[0]?.id, 2);
    const screenId = repo.screens()[0]?.id;
    const result = service.updateScreen(screenId, {
      canvasWidth: 1536,
      canvasHeight: 384,
      scaling: 'fill',
      ignored: true,
    });
    expect(result.ok).toBe(true);
    expect(repo.screen(screenId ?? '')).toMatchObject({
      canvasWidth: 1536,
      canvasHeight: 384,
      scaling: 'fill',
    });
  });

  it('renames and deletes groups, and removes screens', () => {
    service.createGroup('A');
    const groupId = repo.groups()[0]?.id;
    expect(service.renameGroup(groupId, 'Lobby').ok).toBe(true);
    service.assignDisplay(groupId, 2);
    expect(service.removeScreen(repo.screens()[0]?.id).ok).toBe(true);
    expect(service.deleteGroup(groupId).ok).toBe(true);
    expect(service.snapshot().groups).toEqual([]);
    expect(service.deleteGroup(groupId)).toMatchObject({ ok: false });
  });
});
