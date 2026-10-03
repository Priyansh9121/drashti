import { beforeEach, describe, expect, it } from 'vitest';
import { NO_LOOK } from '../../shared/looks';
import type { DisplayInfo } from '../../shared/screens';
import type { Db } from '../db/database';
import { openDatabase } from '../db/database';
import { LookRepo } from '../db/looks';
import { ScreenRepo } from '../db/screens';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport } from '../engine/testing';
import { NO_PLAYLISTS } from '../engine/playlist-source';
import { LookService } from '../looks/look-service';
import { OutputManager, type OutputWindow } from './output-manager';
import { ScreensService } from './screens-service';

/** The library's Looks, with an engine that keeps the live one (each group's languages are there). */
function looksOf(db: Db): LookService {
  let looks: LookService | null = null;
  const engine = new ShowEngine(makeSource(), new RecordingTransport(), Date.now, NO_PLAYLISTS, {
    looks: { look: (id) => looks?.look(id) ?? null, start: () => looks?.start() ?? NO_LOOK },
  });
  looks = new LookService({ repo: new LookRepo(db), engine, changed: () => undefined, log: () => undefined });
  engine.refreshLook();
  return looks;
}

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
let looks: LookService;
let windows: number;
let operatorDisplay: number | null;

beforeEach(() => {
  const db = openDatabase(':memory:');
  repo = new ScreenRepo(db);
  looks = looksOf(db);
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
    () => false,
    looks,
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

  it('keeps one stream group: off screen, with its languages, and gone only while the stream is off', () => {
    const stream = repo.ensureStreamGroup();
    expect(repo.ensureStreamGroup().id).toBe(stream.id);
    expect(repo.groups().filter((g) => g.role === 'stream')).toHaveLength(1);
    expect(repo.groups().find((g) => g.id === stream.id)?.name).toBe('Stream');
    // It has no displays, and keeps its role.
    expect(service.assignDisplay(stream.id, 2)).toMatchObject({ ok: false });
    expect(service.setGroupRole(stream.id, 'audience')).toMatchObject({ ok: false });
    // Its languages are set as any group's are (in the live Look).
    looks.groupsChanged();
    expect(service.setGroupLanguages(stream.id, ['translit', 'en']).ok).toBe(true);
    expect(looks.liveLanguages(stream.id)).toEqual(['translit', 'en']);
    // While the stream is on air or recording it stays; afterwards it can go (and comes back when needed).
    let inUse = true;
    const guarded = new ScreensService(
      repo,
      new OutputManager({
        listDisplays: () => [hall],
        screens: () => repo.screens(),
        saveDisplayKey: () => undefined,
        openWindow: (): OutputWindow => ({
          webContentsId: 99,
          setBounds: () => undefined,
          close: () => undefined,
          isDestroyed: () => false,
        }),
        onChange: () => undefined,
      }),
      () => [hall],
      () => null,
      () => inUse,
    );
    expect(guarded.deleteGroup(stream.id)).toMatchObject({ ok: false });
    inUse = false;
    expect(guarded.deleteGroup(stream.id).ok).toBe(true);
    expect(repo.streamGroup()).toBeNull();
  });

  it('sets the languages a group shows of a kirtan in the live Look, in order, or all of them', () => {
    service.createGroup('Hall');
    const groupId = repo.groups()[0]?.id ?? '';
    expect(looks.liveLanguages(groupId)).toBeNull();
    expect(service.setGroupLanguages(groupId, ['translit', 'gu']).ok).toBe(true);
    expect(looks.liveLanguages(groupId)).toEqual(['translit', 'gu']);
    expect(looks.view().looks[0]?.groups[groupId]?.languages).toEqual(['translit', 'gu']);
    // None, twice the same, or an unknown language: refused, and the choice stays.
    for (const bad of [[], ['gu', 'gu'], ['fr'], ['en', 'gu', 'hi', 'translit', 'en'], 'gu'])
      expect(service.setGroupLanguages(groupId, bad)).toMatchObject({ ok: false });
    expect(looks.liveLanguages(groupId)).toEqual(['translit', 'gu']);
    expect(service.setGroupLanguages(groupId, null).ok).toBe(true);
    expect(looks.liveLanguages(groupId)).toBeNull();
    expect(service.setGroupLanguages('gone', ['gu'])).toMatchObject({ ok: false });
    // A deleted group's settings leave every Look.
    expect(service.setGroupLanguages(groupId, ['gu']).ok).toBe(true);
    expect(service.deleteGroup(groupId).ok).toBe(true);
    expect(Object.keys(looks.view().looks[0]?.groups ?? {})).toEqual([]);
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

describe('the setup wizard’s outputs, applied at Finish', () => {
  const stageTv: DisplayInfo = {
    ...hall,
    id: 3,
    label: 'Stage TV',
    bounds: { ...hall.bounds, x: 3360 },
    key: { ...hall.key, id: 3, label: 'Stage TV', x: 3360 },
  };
  function withTwo(): { service: ScreensService; repo: ScreenRepo; looks: LookService } {
    const db = openDatabase(':memory:');
    const r = new ScreenRepo(db);
    const l = looksOf(db);
    const outputs = new OutputManager({
      listDisplays: () => [hall, stageTv],
      screens: () => r.screens(),
      saveDisplayKey: (id, key) => {
        r.setDisplayKey(id, key);
      },
      openWindow: (): OutputWindow => ({
        webContentsId: ++windows,
        setBounds: () => undefined,
        close: () => undefined,
        isDestroyed: () => false,
      }),
      onChange: () => undefined,
    });
    return {
      repo: r,
      looks: l,
      service: new ScreensService(
        r,
        outputs,
        () => [hall, stageTv],
        () => operatorDisplay,
        () => false,
        l,
      ),
    };
  }
  const shape = (t: { repo: ScreenRepo; looks: LookService }) =>
    t.repo.groups().map((g) => [g.name, g.role, t.looks.liveLanguages(g.id), g.screens.map((sc) => sc.name)]);

  it('makes Audience and Stage groups with their languages, and their outputs', () => {
    const t = withTwo();
    expect(
      t.service.applySetup([
        { displayId: 2, use: 'audience', languages: ['gu', 'translit'] },
        { displayId: 3, use: 'stage', languages: ['gu'] },
      ]).ok,
    ).toBe(true);
    expect(shape(t)).toEqual([
      ['Audience', 'audience', ['gu', 'translit'], ['Hall TV']],
      ['Stage', 'stage', ['gu'], ['Stage TV']],
    ]);
  });

  it('run again: a group changes in place, keeping its name and its screens’ settings; Not used removes one', () => {
    const t = withTwo();
    t.service.createGroup('Main Hall');
    t.service.assignDisplay(t.repo.groups()[0]?.id, 2);
    const screenId = t.repo.screens()[0]?.id ?? '';
    t.service.updateScreen(screenId, { canvasWidth: 1280, canvasHeight: 720 });
    t.service.applySetup([
      { displayId: 2, use: 'audience', languages: ['translit', 'en'] },
      { displayId: 3, use: 'none', languages: null },
    ]);
    expect(shape(t)).toEqual([['Main Hall', 'audience', ['translit', 'en'], ['Hall TV']]]);
    expect(t.repo.screen(screenId)).toMatchObject({ canvasWidth: 1280, canvasHeight: 720 });
    // A display moved to the stage keeps its screen, in the new Stage group.
    t.service.applySetup([
      { displayId: 2, use: 'audience', languages: ['translit', 'en'] },
      { displayId: 3, use: 'stage', languages: null },
    ]);
    t.service.applySetup([{ displayId: 3, use: 'none', languages: null }]);
    expect(shape(t)).toEqual([
      ['Main Hall', 'audience', ['translit', 'en'], ['Hall TV']],
      ['Stage', 'stage', null, []],
    ]);
  });

  it('asks before covering the operator’s display, and changes nothing until it may', () => {
    const t = withTwo();
    operatorDisplay = 2;
    const asked = t.service.applySetup([
      { displayId: 3, use: 'stage', languages: null },
      { displayId: 2, use: 'audience', languages: null },
    ]);
    expect(asked).toMatchObject({ ok: false, confirm: 'covers-operator' });
    expect(t.repo.groups()).toEqual([]);
    expect(
      t.service.applySetup([{ displayId: 2, use: 'audience', languages: null }], { coverOperator: true }).ok,
    ).toBe(true);
    expect(shape(t)).toEqual([['Audience', 'audience', null, ['Hall TV']]]);
  });
});
