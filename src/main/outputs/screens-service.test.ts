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
  workArea: { x: 1440, y: 0, width: 1920, height: 1080 },
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
let operatorDisplay: number | null;

beforeEach(() => {
  const db = openDatabase(':memory:');
  repo = new ScreenRepo(db);
  windows = 0;
  operatorDisplay = null;
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
  service = new ScreensService(
    repo,
    outputs,
    () => [hall],
    () => operatorDisplay,
  );
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

  it('gives a group the audience or the stage role', () => {
    service.createGroup('Stage');
    const groupId = repo.groups()[0]?.id;
    expect(repo.groups()[0]?.role).toBe('audience');
    expect(service.setGroupRole(groupId, 'stage').ok).toBe(true);
    expect(repo.groups()[0]?.role).toBe('stage');
    expect(service.setGroupRole(groupId, 'stream')).toMatchObject({ ok: false });
    expect(service.setGroupRole('gone', 'audience')).toMatchObject({ ok: false });
  });

  it('sets the languages a group shows of a kirtan, in order, or all of them', () => {
    service.createGroup('Hall');
    const groupId = repo.groups()[0]?.id;
    expect(repo.groups()[0]?.languages).toBeNull();
    expect(service.setGroupLanguages(groupId, ['translit', 'gu']).ok).toBe(true);
    expect(repo.groups()[0]?.languages).toEqual(['translit', 'gu']);
    expect(repo.groupLanguages(groupId ?? '')).toEqual(['translit', 'gu']);
    // None, twice the same, or an unknown language: refused, and the choice stays.
    for (const bad of [[], ['gu', 'gu'], ['fr'], ['en', 'gu', 'hi', 'translit', 'en'], 'gu'])
      expect(service.setGroupLanguages(groupId, bad)).toMatchObject({ ok: false });
    expect(repo.groups()[0]?.languages).toEqual(['translit', 'gu']);
    expect(service.setGroupLanguages(groupId, null).ok).toBe(true);
    expect(repo.groups()[0]?.languages).toBeNull();
    expect(service.setGroupLanguages('gone', ['gu'])).toMatchObject({ ok: false });
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

  describe('the display the operator window is on', () => {
    beforeEach(() => {
      operatorDisplay = 2;
      service.createGroup('Hall');
    });

    it('asks before putting an output there, and changes nothing until agreed', () => {
      const groupId = repo.groups()[0]?.id;
      const asked = service.assignDisplay(groupId, 2);
      expect(asked).toMatchObject({ ok: false, confirm: 'covers-operator' });
      expect(repo.screens()).toEqual([]);
      expect(windows).toBe(0);
      expect(service.assignDisplay(groupId, 2, { coverOperator: false })).toMatchObject({
        confirm: 'covers-operator',
      });
      expect(service.assignDisplay(groupId, 2, { coverOperator: true })).toMatchObject({ ok: true });
      expect(windows).toBe(1);
    });

    it('turns covering outputs off with uncoverOperator, and asks again before they come back on', () => {
      const groupId = repo.groups()[0]?.id;
      service.assignDisplay(groupId, 2, { coverOperator: true });
      const screenId = repo.screens()[0]?.id ?? '';
      const uncovered = service.uncoverOperator();
      expect(uncovered).toMatchObject({ ok: true, turnedOff: ['Hall TV'] });
      expect(repo.screen(screenId)?.enabled).toBe(false);
      expect(service.snapshot().status[0]?.state).toBe('disabled');

      expect(service.updateScreen(screenId, { enabled: true })).toMatchObject({ confirm: 'covers-operator' });
      expect(repo.screen(screenId)?.enabled).toBe(false);
      expect(service.updateScreen(screenId, { enabled: true }, { coverOperator: true })).toMatchObject({
        ok: true,
      });
      expect(repo.screen(screenId)?.enabled).toBe(true);
    });

    it('does not ask for other changes or other displays', () => {
      const groupId = repo.groups()[0]?.id;
      service.assignDisplay(groupId, 2, { coverOperator: true });
      const screenId = repo.screens()[0]?.id ?? '';
      expect(service.updateScreen(screenId, { canvasWidth: 1280 })).toMatchObject({ ok: true });
      operatorDisplay = 7;
      expect(service.uncoverOperator()).toMatchObject({ ok: true, turnedOff: [] });
      expect(service.updateScreen(screenId, { enabled: false })).toMatchObject({ ok: true });
      expect(service.updateScreen(screenId, { enabled: true })).toMatchObject({ ok: true });
    });
  });
});
