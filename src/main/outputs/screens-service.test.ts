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
import type { PendingScreens } from '../../shared/keep-screens';
import { switchFor } from '../../shared/screen-switches';
import { coveringScreens, KeepScreens } from './keep-screens';
import { OutputManager, type OutputWindow } from './output-manager';
import { ScreensService, type ScreensSetup } from './screens-service';

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
      hide: () => undefined,
      show: () => undefined,
    }),
    onChange: () => undefined,
  });
  service = new ScreensService(
    repo,
    outputs,
    () => [hall],
    () => operatorDisplay,
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

  it('keeps one stream group: off screen, listed last, with its languages, and never deleted (YouTube, Session 26)', () => {
    service.createGroup('Hall');
    const stream = repo.ensureStreamGroup();
    expect(stream.made).toBe(true);
    expect(repo.ensureStreamGroup()).toEqual({ id: stream.id, made: false });
    service.createGroup('Side room');
    // Listed after every other group, whenever it was made.
    expect(repo.groups().map((g) => [g.name, g.role])).toEqual([
      ['Hall', 'audience'],
      ['Side room', 'audience'],
      ['Stream', 'stream'],
    ]);
    expect(repo.groupIds().map((g) => g.role)).toEqual(['audience', 'audience', 'stream']);
    // It has no displays, and keeps its role.
    expect(service.assignDisplay(stream.id, 2)).toMatchObject({ ok: false });
    expect(service.setGroupRole(stream.id, 'audience')).toMatchObject({ ok: false });
    // Its languages are set as any group's are (in the live Look).
    looks.groupsChanged();
    expect(service.setGroupLanguages(stream.id, ['translit', 'en']).ok).toBe(true);
    expect(looks.liveLanguages(stream.id)).toEqual(['translit', 'en']);
    // It is YouTube in Screens: it stays.
    expect(service.deleteGroup(stream.id)).toMatchObject({
      ok: false,
      message: 'The stream’s group stays: it is YouTube in Screens.',
    });
    expect(repo.streamGroup()).toEqual({ id: stream.id });
  });

  it('a library that had its stream group keeps it and its name', () => {
    const id = repo.createGroup('Stream', 'audience');
    const stream = repo.ensureStreamGroup();
    expect(repo.groupName(stream.id)).toBe('Stream 2');
    repo.renameGroup(id, 'Hall');
    expect(repo.ensureStreamGroup()).toEqual({ id: stream.id, made: false });
    expect(repo.groupName(stream.id)).toBe('Stream 2');
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

  it('makes a key and fill pair: the first screen the fill, the next the key, and the words as a lower third', () => {
    const stageTv: DisplayInfo = {
      ...hall,
      id: 3,
      label: 'Stage TV',
      bounds: { ...hall.bounds, x: 3360 },
      key: { ...hall.key, id: 3, label: 'Stage TV', x: 3360 },
    };
    const db = openDatabase(':memory:');
    const r = new ScreenRepo(db);
    const l = looksOf(db);
    const outputs = new OutputManager({
      listDisplays: () => [hall, stageTv],
      screens: () => r.screens(),
      saveDisplayKey: () => undefined,
      openWindow: (): OutputWindow => ({
        webContentsId: ++windows,
        setBounds: () => undefined,
        close: () => undefined,
        isDestroyed: () => false,
        hide: () => undefined,
        show: () => undefined,
      }),
      onChange: () => undefined,
    });
    const s = new ScreensService(
      r,
      outputs,
      () => [hall, stageTv],
      () => null,
      l,
    );
    s.createGroup('Switcher');
    const id = r.groups()[0]?.id ?? '';
    s.assignDisplay(id, 2);
    expect(r.screens().map((sc) => sc.feed)).toEqual([null]);
    expect(s.setGroupRole(id, 'keyfill').ok).toBe(true);
    s.assignDisplay(id, 3);
    expect(r.screens().map((sc) => [sc.name, sc.feed])).toEqual([
      ['Hall TV', 'fill'],
      ['Stage TV', 'key'],
    ]);
    // Typically the words as a lower third, props and messages, with no background, in every Look.
    expect(l.view().looks[0]?.groups[id]).toMatchObject({
      layers: ['slide', 'props', 'messages'],
      slides: 'lowerThird',
    });
    // Swapped by hand; back to an audience group, the screens have no feed.
    const [fill, key] = r.screens();
    expect(s.updateScreen(fill?.id, { feed: 'key' }).ok).toBe(true);
    expect(s.updateScreen(key?.id, { feed: 'fill' }).ok).toBe(true);
    expect(r.screens().map((sc) => sc.feed)).toEqual(['key', 'fill']);
    expect(s.updateScreen(fill?.id, { feed: 'both' })).toMatchObject({ ok: false });
    s.setGroupRole(id, 'audience');
    expect(r.screens().map((sc) => sc.feed)).toEqual([null, null]);
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
        hide: () => undefined,
        show: () => undefined,
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

describe('Keep these screens? (Session 50): the setup put back exactly, and what each display shows', () => {
  const stageTv: DisplayInfo = {
    ...hall,
    id: 3,
    label: 'Stage TV',
    bounds: { ...hall.bounds, x: 3360 },
    key: { ...hall.key, id: 3, label: 'Stage TV', x: 3360 },
  };
  /** Two displays, the output windows counted as they open and close. */
  function two() {
    const db = openDatabase(':memory:');
    const r = new ScreenRepo(db);
    const l = looksOf(db);
    const open = new Set<number>();
    const outputs = new OutputManager({
      listDisplays: () => [hall, stageTv],
      screens: () => r.screens(),
      saveDisplayKey: (id, key) => {
        r.setDisplayKey(id, key);
      },
      openWindow: (): OutputWindow => {
        const id = ++windows;
        open.add(id);
        return {
          webContentsId: id,
          setBounds: () => undefined,
          close: () => {
            open.delete(id);
          },
          isDestroyed: () => !open.has(id),
          hide: () => undefined,
          show: () => undefined,
        };
      },
      onChange: () => undefined,
    });
    const s = new ScreensService(
      r,
      outputs,
      () => [hall, stageTv],
      () => operatorDisplay,
      l,
    );
    return { service: s, repo: r, looks: l, outputs, open };
  }
  const shape = (t: { repo: ScreenRepo; looks: LookService }) =>
    t.repo.groups().map((g) => [g.name, g.role, t.looks.liveLanguages(g.id), g.screens.map((sc) => sc.name)]);

  it('puts back exactly the screens as they were before Finish: the groups, their screens, roles and languages', () => {
    const t = two();
    t.service.createGroup('Main Hall');
    const groupId = t.repo.groups()[0]?.id ?? '';
    t.service.assignDisplay(groupId, 2);
    t.service.setGroupLanguages(groupId, ['gu']);
    const screens = t.repo.saved();
    const was = shape(t);
    const setup: ScreensSetup = t.service.setup();
    expect(setup.languages[groupId]).toEqual(['gu']);

    // Finish: the hall's display becomes the stage's, in English; the other the audience's (a group made).
    t.service.applySetup([
      { displayId: 2, use: 'stage', languages: ['en'] },
      { displayId: 3, use: 'audience', languages: null },
    ]);
    expect(t.open.size).toBe(2);
    expect(shape(t)).not.toEqual(was);

    expect(t.service.putBack(setup)).toMatchObject({ ok: true });
    expect(shape(t)).toEqual(was);
    expect(t.repo.saved()).toEqual(screens);
    // The outputs follow: one, on the hall's display.
    expect(t.open.size).toBe(1);
    expect(t.service.snapshot().status).toEqual([
      { screenId: t.repo.screens()[0]?.id, state: 'showing', displayId: 2 },
    ]);
    // A group the change made leaves every Look.
    expect(Object.keys(t.looks.view().looks[0]?.groups ?? {})).toEqual([groupId]);
  });

  it('as Drashti quits, only saves the setup: no window opens or closes', () => {
    const t = two();
    t.service.createGroup('Main Hall');
    const setup = t.service.setup();
    t.service.assignDisplay(t.repo.groups()[0]?.id, 2);
    expect(t.open.size).toBe(1);
    expect(t.service.putBack(setup, true)).toMatchObject({ ok: true });
    expect(t.repo.screens()).toEqual([]);
    expect(t.open.size).toBe(1);
  });

  it('what each display shows: each output on a connected display, by its screen, group and role', () => {
    const t = two();
    expect(t.service.placed()).toEqual(new Map());
    t.service.createGroup('Main Hall');
    const groupId = t.repo.groups()[0]?.id ?? '';
    t.service.assignDisplay(groupId, 2);
    const screenId = t.repo.screens()[0]?.id ?? '';
    expect(t.service.placed()).toEqual(new Map([['here 2', `${screenId} ${groupId} audience`]]));
    t.service.setGroupRole(groupId, 'stage');
    expect(t.service.placed()).toEqual(new Map([['here 2', `${screenId} ${groupId} stage`]]));
    // Turned off, or its display gone: nothing on a display.
    t.service.updateScreen(screenId, { enabled: false });
    expect(t.service.placed()).toEqual(new Map());
  });

  it('asks after Use this display and On; Go back closes the output it opened; says when the controls are covered', () => {
    const t = two();
    const told: (PendingScreens | null)[] = [];
    const keep = new KeepScreens<ScreensSetup>({
      capture: () => t.service.setup(),
      restore: (setup, quitting) => t.service.putBack(setup, quitting),
      placed: () => t.service.placed(),
      coversControls: () => coveringScreens(t.outputs.status(), operatorDisplay).length > 0,
      snapshot: () => t.service.snapshot(),
      changed: (pending) => {
        told.push(pending);
      },
      now: () => 0,
      later: () => () => undefined,
    });
    operatorDisplay = 2;
    t.service.createGroup('Hall');
    const groupId = t.repo.groups()[0]?.id ?? '';

    // On the display the controls are on (agreed to): it covers them, and says so.
    expect(keep.change(() => t.service.assignDisplay(groupId, 2, { coverOperator: true })).ok).toBe(true);
    expect(keep.current()).toMatchObject({ coversControls: true });
    expect(t.open.size).toBe(1);
    expect(keep.goBack()).toMatchObject({ ok: true });
    expect(t.repo.screens()).toEqual([]);
    expect(t.open.size).toBe(0);
    expect(told.at(-1)).toBeNull();

    // On the other display: asked, not covering; kept.
    keep.change(() => t.service.assignDisplay(groupId, 3));
    expect(keep.current()).toMatchObject({ coversControls: false });
    keep.keep();
    const screenId = t.repo.screens()[0]?.id ?? '';
    // Off asks nothing; On again asks.
    keep.change(() => t.service.updateScreen(screenId, { enabled: false }));
    expect(keep.current()).toBeNull();
    keep.change(() => t.service.updateScreen(screenId, { enabled: true }));
    expect(keep.current()).not.toBeNull();
    keep.goBack();
    expect(t.repo.screen(screenId)?.enabled).toBe(false);
    expect(t.open.size).toBe(0);
  });
});

describe('Audience or Stage off (Session 51, S2-1): a switched-off screen shows nothing on its display', () => {
  /** One display; the output windows counted as they open and close; each screen answers to its group's switch. */
  function switched() {
    const db = openDatabase(':memory:');
    const r = new ScreenRepo(db);
    const open = new Set<number>();
    const outputs = new OutputManager({
      listDisplays: () => [hall],
      screens: () => r.screens(),
      saveDisplayKey: (id, key) => {
        r.setDisplayKey(id, key);
      },
      openWindow: (): OutputWindow => {
        const id = ++windows;
        open.add(id);
        return {
          webContentsId: id,
          setBounds: () => undefined,
          close: () => {
            open.delete(id);
          },
          isDestroyed: () => !open.has(id),
          hide: () => undefined,
          show: () => undefined,
        };
      },
      onChange: () => undefined,
      switchOf: (sc) => switchFor(r.groupRole(sc.groupId) ?? 'audience'),
    });
    const s = new ScreensService(
      r,
      outputs,
      () => [hall],
      () => operatorDisplay,
      looksOf(db),
    );
    const keep = new KeepScreens<ScreensSetup>({
      capture: () => s.setup(),
      restore: (setup, quitting) => s.putBack(setup, quitting),
      placed: () => s.placed(),
      coversControls: () => false,
      snapshot: () => s.snapshot(),
      changed: () => undefined,
      now: () => 0,
      later: () => () => undefined,
    });
    s.createGroup('Main Hall');
    s.assignDisplay(r.groups()[0]?.id, 2);
    return { service: s, repo: r, outputs, open, keep, screenId: r.screens()[0]?.id ?? '' };
  }

  it('turned off and on again in Screens while Audience is off asks nothing; Audience on, it is back where it was', () => {
    const t = switched();
    expect(t.open.size).toBe(1);
    t.outputs.setSwitch('audience', false);
    expect(t.open.size).toBe(0);
    // Its display shows the computer's desktop: nothing of Drashti's is on it.
    expect(t.service.placed()).toEqual(new Map());
    t.keep.change(() => t.service.updateScreen(t.screenId, { enabled: false }));
    expect(t.keep.current()).toBeNull();
    t.keep.change(() => t.service.updateScreen(t.screenId, { enabled: true }));
    expect(t.keep.current()).toBeNull();
    expect(t.open.size).toBe(0);
    expect(t.service.snapshot().status).toEqual([
      { screenId: t.screenId, state: 'switched-off', displayId: 2 },
    ]);
    // Audience on again: on the display it was on, never asked.
    t.outputs.setSwitch('audience', true);
    expect(t.open.size).toBe(1);
    expect(t.service.snapshot().status).toEqual([{ screenId: t.screenId, state: 'showing', displayId: 2 }]);
    expect(t.keep.current()).toBeNull();
  });

  it('still asks when a change does put something on a display: the hall’s screen made a stage screen while Audience is off', () => {
    const t = switched();
    t.outputs.setSwitch('audience', false);
    t.keep.change(() => t.service.applySetup([{ displayId: 2, use: 'stage', languages: null }]));
    expect(t.keep.current()).not.toBeNull();
    expect(t.open.size).toBe(1);
    // Go back: the hall's again, so switched off with Audience.
    t.keep.goBack();
    expect(t.open.size).toBe(0);
    expect(t.service.snapshot().status).toEqual([
      { screenId: t.screenId, state: 'switched-off', displayId: 2 },
    ]);
  });
});
