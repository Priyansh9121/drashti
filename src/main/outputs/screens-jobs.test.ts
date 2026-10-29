import { beforeEach, describe, expect, it } from 'vitest';
import { NO_LOOK } from '../../shared/looks';
import type { DisplayInfo, ScreensResult } from '../../shared/screens';
import type { Db } from '../db/database';
import { openDatabase } from '../db/database';
import { LookRepo } from '../db/looks';
import { ScreenRepo } from '../db/screens';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport } from '../engine/testing';
import { NO_PLAYLISTS } from '../engine/playlist-source';
import { LookService } from '../looks/look-service';
import type { NotUsedDisplays } from './auto-screens';
import { AutoScreens, memoryNotUsed } from './auto-screens';
import { OutputManager, type OutputWindow } from './output-manager';
import { ScreensService } from './screens-service';

/*
 * Screens that set themselves (Session 55), in the screens themselves: the jobs displays plugged in are given (a
 * screen in the first audience or stage group, made when there is none), a job changed by hand in one click, and
 * Not used remembered by the display, so it is never taken by itself again. Placeholder display names.
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

function display(
  id: number,
  label: string,
  x: number,
  hardwareId: string | null,
  internal = false,
): DisplayInfo {
  return {
    id,
    label,
    bounds: { x, y: 0, width: 1920, height: 1080 },
    workArea: { x, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    pixelWidth: 1920,
    pixelHeight: 1080,
    refreshHz: 60,
    rotation: 0,
    internal,
    primary: x === 0,
    key: { id, label, pixelWidth: 1920, pixelHeight: 1080, x, y: 0, internal, hardwareId },
  };
}

const laptop = display(1, 'Built-in', 0, null, true);
const pjA = display(5, 'PLACEHOLDER PJ', 1920, 'edid:4183:1234:n1111');
const pjB = display(6, 'PLACEHOLDER PJ', 3840, 'edid:4183:1234:n2222');

let displays: DisplayInfo[];
let repo: ScreenRepo;
let looks: LookService;
let manager: OutputManager;
let service: ScreensService;
let notUsed: NotUsedDisplays;
let operatorDisplay: number | null;
let open: string[];

/** Screens as made with a library (a restart: the same database, new services). */
function start(db: Db): void {
  repo = new ScreenRepo(db);
  looks = looksOf(db);
  manager = new OutputManager({
    listDisplays: () => displays,
    screens: () => repo.screens(),
    saveDisplayKey: (id, key) => {
      repo.setDisplayKey(id, key);
    },
    openWindow: (sc, d): OutputWindow => {
      open.push(`${sc.name}@${String(d.id)}`);
      let closed = false;
      return {
        webContentsId: open.length,
        setBounds: () => undefined,
        close: () => {
          closed = true;
          open = open.filter((o) => o !== `${sc.name}@${String(d.id)}`);
        },
        isDestroyed: () => closed,
        hide: () => undefined,
        show: () => undefined,
      };
    },
    onChange: () => undefined,
  });
  service = new ScreensService(
    repo,
    manager,
    () => displays,
    () => operatorDisplay,
    looks,
    undefined,
    notUsed,
  );
}

/** The screens as groups: each group's role, and its screens' displays now. */
const shape = () => {
  const uses = service.uses();
  return repo.groups().map((g) => ({
    role: g.role,
    name: g.name,
    on: g.screens.map((sc) => uses.find((u) => u.screenId === sc.id)?.displayId ?? null),
  }));
};

const auto = () =>
  new AutoScreens({
    on: true,
    displays: () => displays,
    uses: () => service.uses(),
    controlsDisplayId: () => 1,
    notUsed,
    give: (jobs) => service.giveJobs(jobs),
    said: () => undefined,
    mirroredOnto: () => [],
    platform: 'darwin',
    log: () => undefined,
  });

const ok = (r: ScreensResult) => {
  if (!r.ok) throw new Error(r.message);
  return r.snapshot;
};

let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
  displays = [laptop];
  notUsed = memoryNotUsed();
  operatorDisplay = 1;
  open = [];
  start(db);
  manager.reconcile();
});

describe('displays plugged in, given their jobs', () => {
  it('the first a screen in a new Audience group, the next in a new Stage group, each named after its display', () => {
    displays = [laptop, pjA, pjB];
    manager.reconcile();
    auto().check();
    expect(shape()).toEqual([
      { role: 'audience', name: 'Audience', on: [5] },
      { role: 'stage', name: 'Stage', on: [6] },
    ]);
    expect(open.sort()).toEqual(['PLACEHOLDER PJ@5', 'PLACEHOLDER PJ@6']);
    // What each display does, as Screens and a phone show it.
    expect(service.snapshot().uses.map((u) => [u.displayId, u.role])).toEqual([
      [1, null],
      [5, 'audience'],
      [6, 'stage'],
    ]);
  });

  it('into the first group there is with that role, keeping its name and its languages', () => {
    ok(service.createGroup('Main Hall'));
    const hall = repo.groups()[0]?.id ?? '';
    ok(service.setGroupLanguages(hall, ['gu']));
    displays = [laptop, pjA];
    auto().check();
    expect(shape()).toEqual([{ role: 'audience', name: 'Main Hall', on: [5] }]);
    expect(looks.liveLanguages(hall)).toEqual(['gu']);
  });

  it('two projectors swapped between ports, or after a restart: each goes straight back to its job', () => {
    displays = [laptop, pjA, pjB];
    auto().check();
    // Swapped: each on the other's port (the other's id and place), told apart by its own identity.
    displays = [
      laptop,
      { ...pjA, id: 6, bounds: pjB.bounds, key: { ...pjA.key, id: 6, x: 3840 } },
      { ...pjB, id: 5, bounds: pjA.bounds, key: { ...pjB.key, id: 5, x: 1920 } },
    ];
    manager.reconcile();
    expect(shape()).toEqual([
      { role: 'audience', name: 'Audience', on: [6] },
      { role: 'stage', name: 'Stage', on: [5] },
    ]);
    // A restart: the same library, the screens as they were.
    open = [];
    start(db);
    manager.reconcile();
    auto().check();
    expect(shape()).toEqual([
      { role: 'audience', name: 'Audience', on: [6] },
      { role: 'stage', name: 'Stage', on: [5] },
    ]);
    expect(open.sort()).toEqual(['PLACEHOLDER PJ@5', 'PLACEHOLDER PJ@6']);
  });
});

describe('a job changed by hand, one click, and remembered by the display', () => {
  it('two projectors: the second, given the stage, shows the audience picture too; unplugged and back, it still does', () => {
    displays = [laptop, pjA, pjB];
    auto().check();
    ok(service.setDisplayJob(6, 'audience'));
    expect(shape()).toEqual([
      { role: 'audience', name: 'Audience', on: [5, 6] },
      { role: 'stage', name: 'Stage', on: [] },
    ]);
    displays = [laptop, pjA];
    manager.reconcile();
    auto().check();
    displays = [laptop, pjA, pjB];
    manager.reconcile();
    auto().check();
    expect(shape()).toEqual([
      { role: 'audience', name: 'Audience', on: [5, 6] },
      { role: 'stage', name: 'Stage', on: [] },
    ]);
  });

  it('Not used: its screen goes, and it is never taken by itself again, after a restart too, until given a job', () => {
    displays = [laptop, pjA];
    auto().check();
    ok(service.setDisplayJob(5, 'none'));
    expect(shape()).toEqual([{ role: 'audience', name: 'Audience', on: [] }]);
    auto().check();
    expect(shape()).toEqual([{ role: 'audience', name: 'Audience', on: [] }]);
    open = [];
    start(db);
    manager.reconcile();
    auto().check();
    expect(open).toEqual([]);
    ok(service.setDisplayJob(5, 'stage'));
    expect(shape()).toEqual([
      { role: 'audience', name: 'Audience', on: [] },
      { role: 'stage', name: 'Stage', on: [5] },
    ]);
  });

  it('a screen removed, or a group deleted, by hand leaves its display Not used', () => {
    displays = [laptop, pjA, pjB];
    auto().check();
    const [hallScreen] = repo.groups()[0]?.screens ?? [];
    ok(service.removeScreen(hallScreen?.id));
    ok(service.deleteGroup(repo.groups().find((g) => g.role === 'stage')?.id));
    auto().check();
    expect(shape()).toEqual([{ role: 'audience', name: 'Audience', on: [] }]);
    expect(open).toEqual([]);
  });

  it('Set Up Screens…’s Not used is remembered the same way, and its Audience or Stage given back', () => {
    displays = [laptop, pjA];
    ok(service.applySetup([{ displayId: 5, use: 'none', languages: null }]));
    auto().check();
    expect(open).toEqual([]);
    ok(service.applySetup([{ displayId: 5, use: 'stage', languages: null }]));
    ok(service.applySetup([{ displayId: 5, use: 'none', languages: null }]));
    ok(service.applySetup([{ displayId: 5, use: 'audience', languages: null }]));
    ok(service.setDisplayJob(5, 'none'));
    ok(service.assignDisplay(repo.groups()[0]?.id, 5));
    auto().check();
    expect(open).toEqual(['PLACEHOLDER PJ@5']);
  });

  it('the controls’ display asks first, as ever; a display that does the job already is left as it is', () => {
    displays = [laptop, pjA];
    auto().check();
    expect(service.setDisplayJob(1, 'audience')).toEqual({
      ok: false,
      confirm: 'covers-operator',
      message: 'The Drashti controls are on this display. An output here would cover them.',
    });
    expect(shape()).toEqual([{ role: 'audience', name: 'Audience', on: [5] }]);
    ok(service.setDisplayJob(1, 'audience', { coverOperator: true }));
    expect(shape()).toEqual([{ role: 'audience', name: 'Audience', on: [5, 1] }]);
    const before = JSON.stringify(repo.saved());
    ok(service.setDisplayJob(5, 'audience'));
    expect(JSON.stringify(repo.saved())).toBe(before);
    expect(service.setDisplayJob(99, 'stage')).toEqual({
      ok: false,
      message: 'That display is not connected any more.',
    });
    expect(service.setDisplayJob(5, 'lobby')).toMatchObject({ ok: false });
  });

  it('what each display does: its screen on or off, its group and role; none for one without', () => {
    displays = [laptop, pjA, pjB];
    auto().check();
    const stageScreen = repo.groups().find((g) => g.role === 'stage')?.screens[0];
    ok(service.updateScreen(stageScreen?.id, { enabled: false }));
    expect(service.uses().map((u) => [u.displayId, u.role, u.screenId !== null])).toEqual([
      [1, null, false],
      [5, 'audience', true],
      [6, 'stage', true],
    ]);
    // Off, it keeps its job: nothing takes its display.
    auto().check();
    expect(shape()).toEqual([
      { role: 'audience', name: 'Audience', on: [5] },
      { role: 'stage', name: 'Stage', on: [6] },
    ]);
  });
});
