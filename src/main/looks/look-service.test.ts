import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUP_LOOK,
  DEFAULT_LIVE_GROUP_LOOK,
  LOOK_LAYER_NAMES,
  LOOK_LAYERS,
  NO_LOOK,
  readGroupLook,
  storedGroupLook,
} from '../../shared/looks';
import type { LooksView } from '../../shared/looks';
import { SIMPLE_MODE_REFUSAL } from '../../shared/mode';
import { openDatabase } from '../db/database';
import { LookRepo } from '../db/looks';
import { ScreenRepo } from '../db/screens';
import { NO_PLAYLISTS } from '../engine/playlist-source';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport } from '../engine/testing';
import { LookService } from './look-service';

/* Looks: kept in the library, read by the engine, changed from Screens. Placeholder names only. */

function setup(options: { simple?: boolean } = {}) {
  const db = openDatabase(':memory:');
  const screens = new ScreenRepo(db);
  const hall = screens.createGroup('Hall');
  const stage = screens.createGroup('Stage', 'stage');
  const repo = new LookRepo(db);
  const transport = new RecordingTransport();
  let looks: LookService | null = null;
  const engine = new ShowEngine(makeSource(), transport, Date.now, NO_PLAYLISTS, {
    looks: { look: (id) => looks?.look(id) ?? null, start: () => looks?.start() ?? NO_LOOK },
    refuse: (c) => (options.simple === true && c.type === 'setLook' ? SIMPLE_MODE_REFUSAL : null),
  });
  const told: LooksView[] = [];
  looks = new LookService({ repo, engine, changed: (v) => told.push(v), log: () => undefined });
  engine.refreshLook();
  const standard = repo.firstId();
  return { db, screens, repo, engine, looks, told, transport, hall, stage, standard };
}

describe('a group’s settings in a Look', () => {
  it('store only what differs from the defaults, and read anything damaged as the default', () => {
    expect(storedGroupLook(DEFAULT_GROUP_LOOK)).toEqual({});
    expect(
      storedGroupLook({
        layers: ['slide', 'props'],
        languages: ['gu'],
        slides: 'lowerThird',
        stageLayoutId: 'l1',
        maskId: 'm1',
        idle: 'always',
        movement: 'bold',
      }),
    ).toEqual({
      layers: ['slide', 'props'],
      // The picture-in-picture box (Session 50) left out too, said apart (see below).
      leftOut: ['pip'],
      languages: ['gu'],
      slides: 'lowerThird',
      stageLayoutId: 'l1',
      maskId: 'm1',
      idle: 'always',
      movement: 'bold',
    });
    expect(readGroupLook(undefined)).toEqual(DEFAULT_GROUP_LOOK);
    expect(
      readGroupLook({
        layers: ['props', 'slide'],
        languages: ['gu', 'gu'],
        slides: 'sideways',
        idle: 'often',
        movement: 'wild',
      }),
    ).toEqual({
      // The layers in drawing order (a list from before Session 50 shows the box); the languages, slide style,
      // idle setting and Movement unreadable, so the defaults (a Look from before Session 27 has no Movement: Calm).
      layers: ['slide', 'props', 'pip'],
      languages: null,
      slides: 'designed',
      stageLayoutId: null,
      maskId: null,
      idle: 'off',
      movement: 'calm',
    });
    expect(readGroupLook({ movement: 'bold' }).movement).toBe('bold');
  });

  it('a group’s layers saved before the picture-in-picture box (Session 50) show it; only a Look saved with it left out hides it', () => {
    expect(LOOK_LAYERS).toEqual(['background', 'slide', 'props', 'pip', 'messages', 'ticker', 'masks']);
    expect(LOOK_LAYER_NAMES.pip).toBe('Picture in picture');
    // A list from before: the box shows, where it draws (above the props).
    expect(readGroupLook({ layers: ['slide', 'props', 'messages'] }).layers).toEqual([
      'slide',
      'props',
      'pip',
      'messages',
    ]);
    // Left out since: hidden, with the other layers as they are.
    expect(readGroupLook({ layers: ['slide'], leftOut: ['pip'] }).layers).toEqual(['slide']);
    expect(readGroupLook({ leftOut: ['pip'] }).layers).toEqual([
      'background',
      'slide',
      'props',
      'messages',
      'ticker',
      'masks',
    ]);
    // Anything unreadable there shows it (the default).
    for (const leftOut of [['pip', 'pip'], ['slide'], 'pip', [7]])
      expect(readGroupLook({ leftOut }).layers, JSON.stringify(leftOut)).toEqual(LOOK_LAYERS);
    // Stored: the earlier layers as before, so an older Drashti reads a group's layers as they were.
    const noBox = LOOK_LAYERS.filter((l) => l !== 'pip');
    expect(storedGroupLook({ ...DEFAULT_GROUP_LOOK, layers: noBox })).toEqual({ leftOut: ['pip'] });
    expect(storedGroupLook({ ...DEFAULT_GROUP_LOOK, layers: ['slide', 'pip'] })).toEqual({
      layers: ['slide'],
    });
    expect(
      readGroupLook(storedGroupLook({ ...DEFAULT_GROUP_LOOK, layers: ['slide', 'pip'] })).layers,
    ).toEqual(['slide', 'pip']);
  });

  it('a key and fill group leaves the box out unless its Look turns it on (Session 51), however it was kept', () => {
    const noBox = LOOK_LAYERS.filter((l) => l !== 'pip');
    // Nothing said of it, or a group kept before: left out, old and new alike.
    expect(readGroupLook(undefined, 'keyfill').layers).toEqual(noBox);
    expect(readGroupLook({}, 'keyfill').layers).toEqual(noBox);
    expect(
      readGroupLook({ layers: ['slide', 'props', 'messages'], slides: 'lowerThird' }, 'keyfill').layers,
    ).toEqual(['slide', 'props', 'messages']);
    // Left out by Session 50's own way of keeping a new key and fill group: still out.
    expect(readGroupLook({ layers: ['slide'], leftOut: ['pip'] }, 'keyfill').layers).toEqual(['slide']);
    // Turned on in a Look: shown, where it draws (above the props).
    expect(
      readGroupLook({ layers: ['slide', 'props', 'messages'], turnedOn: ['pip'] }, 'keyfill').layers,
    ).toEqual(['slide', 'props', 'pip', 'messages']);
    // Anything unreadable there: the role's own default.
    for (const turnedOn of [['pip', 'pip'], ['slide'], 'pip', [7]])
      expect(readGroupLook({ turnedOn }, 'keyfill').layers, JSON.stringify(turnedOn)).toEqual(noBox);
    // Kept: only what differs from the role's default, the earlier layers as an older Drashti reads them.
    expect(storedGroupLook({ ...DEFAULT_GROUP_LOOK, layers: noBox }, 'keyfill')).toEqual({});
    expect(storedGroupLook({ ...DEFAULT_GROUP_LOOK, layers: ['slide', 'pip'] }, 'keyfill')).toEqual({
      layers: ['slide'],
      turnedOn: ['pip'],
    });
    expect(
      readGroupLook(
        storedGroupLook({ ...DEFAULT_GROUP_LOOK, layers: ['slide', 'pip'] }, 'keyfill'),
        'keyfill',
      ).layers,
    ).toEqual(['slide', 'pip']);
    // Every other role as before: the box shows unless left out, and turned on means nothing more there.
    for (const role of ['audience', 'stage', 'stream', 'other'] as const) {
      expect(readGroupLook(undefined, role).layers, role).toEqual(LOOK_LAYERS);
      expect(readGroupLook({ turnedOn: ['pip'] }, role).layers, role).toEqual(LOOK_LAYERS);
      expect(storedGroupLook({ ...DEFAULT_GROUP_LOOK, layers: ['slide', 'pip'] }, role), role).toEqual({
        layers: ['slide'],
      });
    }
  });
});

describe('Looks', () => {
  it('start with Standard live, every group with the defaults, in the engine state', () => {
    const t = setup();
    expect(t.engine.current.look).toEqual({
      id: t.standard,
      name: 'Standard',
      groups: { [t.hall]: DEFAULT_LIVE_GROUP_LOOK, [t.stage]: DEFAULT_LIVE_GROUP_LOOK },
    });
    expect(t.looks.view()).toMatchObject({ liveId: t.standard, looks: [{ name: 'Standard' }] });
  });

  it('switch with setLook: every group changes in one patch', () => {
    const t = setup();
    expect(t.looks.create('Placeholder lower thirds', t.standard).ok).toBe(true);
    const lower = t.repo.list()[1]?.id ?? '';
    t.looks.setGroup(lower, t.hall, { slides: 'lowerThird', layers: ['slide', 'props', 'messages'] });
    t.looks.setGroup(lower, t.stage, { languages: ['gu'] });
    // Changing a Look that is not live changes nothing on the screens.
    expect(t.engine.current.look.id).toBe(t.standard);
    const before = t.transport.messages.length;
    expect(t.engine.dispatch({ type: 'setLook', lookId: lower })).toMatchObject({ ok: true, changed: true });
    expect(t.transport.messages.length).toBe(before + 1);
    expect(t.engine.current.look.groups).toEqual({
      [t.hall]: {
        layers: ['slide', 'props', 'messages'],
        languages: null,
        slides: 'lowerThird',
        stageLayout: null,
        mask: null,
        idle: 'off',
        movement: 'calm',
      },
      [t.stage]: { ...DEFAULT_LIVE_GROUP_LOOK, languages: ['gu'] },
    });
    // A Look that is gone cannot go live.
    expect(t.engine.dispatch({ type: 'setLook', lookId: 'gone' })).toMatchObject({
      ok: false,
      error: 'unknown-look',
    });
  });

  it('a Look saved before the picture-in-picture box (Session 50) shows it; a group can leave it out, and have it back', () => {
    const t = setup();
    // A Look as an earlier Drashti kept it: the hall leaves out the background and the ticker.
    t.db
      .prepare('UPDATE looks SET definition = ? WHERE id = ?')
      .run(
        JSON.stringify({ groups: { [t.hall]: { layers: ['slide', 'props', 'messages', 'masks'] } } }),
        t.standard,
      );
    t.looks.groupsChanged();
    expect(t.engine.current.look.groups[t.hall]?.layers).toEqual([
      'slide',
      'props',
      'pip',
      'messages',
      'masks',
    ]);
    // Another setting changed on that group: the box still shows.
    t.looks.setGroup(t.standard, t.hall, { languages: ['gu'] });
    expect(t.repo.get(t.standard)?.groups[t.hall]?.layers).toContain('pip');
    // Left out from Screens (its tick taken off): hidden on the hall's screens only, and kept so.
    expect(t.looks.setGroup(t.standard, t.hall, { layers: ['slide', 'props', 'messages', 'masks'] }).ok).toBe(
      true,
    );
    expect(t.engine.current.look.groups[t.hall]?.layers).toEqual(['slide', 'props', 'messages', 'masks']);
    expect(t.engine.current.look.groups[t.stage]?.layers).toContain('pip');
    const row = t.db.prepare('SELECT definition FROM looks WHERE id = ?').get(t.standard) as {
      definition: string;
    };
    expect(JSON.parse(row.definition)).toEqual({
      groups: {
        [t.hall]: { layers: ['slide', 'props', 'messages', 'masks'], leftOut: ['pip'], languages: ['gu'] },
      },
    });
    // Ticked again: back, and nothing kept about it.
    t.looks.setGroup(t.standard, t.hall, { layers: ['slide', 'props', 'pip', 'messages', 'masks'] });
    expect(t.engine.current.look.groups[t.hall]?.layers).toContain('pip');
    expect(t.repo.get(t.standard)?.groups[t.hall]).toMatchObject({ languages: ['gu'] });
    expect(
      (t.db.prepare('SELECT definition FROM looks WHERE id = ?').get(t.standard) as { definition: string })
        .definition,
    ).not.toContain('leftOut');
  });

  it('a group made a key and fill pair leaves the box out, as it leaves out the background', () => {
    const t = setup();
    t.screens.setGroupRole(t.hall, 'keyfill');
    t.looks.becameKeyFill(t.hall);
    expect(t.engine.current.look.groups[t.hall]).toMatchObject({
      layers: ['slide', 'props', 'messages'],
      slides: 'lowerThird',
    });
  });

  it('a key and fill pair leaves the box out in every Look, old and new alike, until a Look turns it on (Session 51)', () => {
    const t = setup();
    const definition = (lookId: string): unknown =>
      JSON.parse(
        (t.db.prepare('SELECT definition FROM looks WHERE id = ?').get(lookId) as { definition: string })
          .definition,
      );
    // A key and fill group as an earlier Drashti kept it in a Look: the words as a lower third, props, messages.
    const switcher = t.screens.createGroup('Placeholder switcher', 'keyfill');
    t.db.prepare('UPDATE looks SET definition = ? WHERE id = ?').run(
      JSON.stringify({
        groups: { [switcher]: { layers: ['slide', 'props', 'messages'], slides: 'lowerThird' } },
      }),
      t.standard,
    );
    t.looks.groupsChanged();
    expect(t.engine.current.look.groups[switcher]?.layers).toEqual(['slide', 'props', 'messages']);
    expect(t.looks.view().looks[0]?.groups[switcher]?.layers).not.toContain('pip');
    // The hall's group shows it, as before.
    expect(t.engine.current.look.groups[t.hall]?.layers).toContain('pip');
    // A Look made since, from nothing: the key and fill group leaves it out there too, the hall shows it.
    t.looks.create('Placeholder blank', null);
    const blank = t.repo.list()[1];
    expect(blank?.groups[switcher]?.layers).toEqual(LOOK_LAYERS.filter((l) => l !== 'pip'));
    expect(blank?.groups[t.hall]?.layers).toEqual(LOOK_LAYERS);
    // A group made a key and fill pair now: left out, kept as an earlier Drashti keeps it (nothing said of it).
    const lobby = t.screens.createGroup('Placeholder lobby');
    t.screens.setGroupRole(lobby, 'keyfill');
    t.looks.becameKeyFill(lobby);
    expect(t.engine.current.look.groups[lobby]?.layers).toEqual(['slide', 'props', 'messages']);
    expect(definition(t.standard)).toMatchObject({
      groups: { [lobby]: { layers: ['slide', 'props', 'messages'], slides: 'lowerThird' } },
    });
    expect(JSON.stringify(definition(t.standard))).not.toContain('leftOut');
    // Turned on in the live Look (its tick in Screens): shown on that group's screens, and kept so.
    expect(t.looks.setGroup(t.standard, switcher, { layers: ['slide', 'props', 'pip', 'messages'] }).ok).toBe(
      true,
    );
    expect(t.engine.current.look.groups[switcher]?.layers).toEqual(['slide', 'props', 'pip', 'messages']);
    expect(t.engine.current.look.groups[lobby]?.layers).toEqual(['slide', 'props', 'messages']);
    expect(definition(t.standard)).toMatchObject({
      groups: {
        [switcher]: { layers: ['slide', 'props', 'messages'], turnedOn: ['pip'], slides: 'lowerThird' },
      },
    });
    // Another setting changed: it stays on. Ticked off again: out, and nothing kept about it.
    t.looks.setGroup(t.standard, switcher, { movement: 'bold' });
    expect(t.engine.current.look.groups[switcher]?.layers).toContain('pip');
    t.looks.setGroup(t.standard, switcher, { layers: ['slide', 'props', 'messages'] });
    expect(t.engine.current.look.groups[switcher]?.layers).toEqual(['slide', 'props', 'messages']);
    expect(JSON.stringify(definition(t.standard))).not.toContain('turnedOn');
  });

  it('follow edits to the live Look at once, and fall back to the first when it is removed', () => {
    const t = setup();
    t.looks.setGroup(t.standard, t.hall, { languages: ['translit', 'en'] });
    expect(t.engine.current.look.groups[t.hall]?.languages).toEqual(['translit', 'en']);
    // Bold for the hall reaches the hall's screens only (Session 27); the stage group stays Calm.
    expect(t.looks.setGroup(t.standard, t.hall, { movement: 'bold' }).ok).toBe(true);
    expect(t.engine.current.look.groups[t.hall]?.movement).toBe('bold');
    expect(t.engine.current.look.groups[t.stage]?.movement).toBe('calm');
    expect(t.repo.get(t.standard)?.groups[t.hall]?.movement).toBe('bold');
    t.looks.create('Placeholder festival', null);
    const festival = t.repo.list()[1]?.id ?? '';
    t.engine.dispatch({ type: 'setLook', lookId: festival });
    expect(t.looks.remove(festival).ok).toBe(true);
    expect(t.engine.current.look.id).toBe(t.standard);
    // The last Look stays.
    expect(t.looks.remove(t.standard)).toMatchObject({
      ok: false,
      message: 'There must always be one Look.',
    });
    // The operator window was told each time.
    expect(t.told.at(-1)?.looks.map((l) => l.name)).toEqual(['Standard']);
  });

  it('are made, copied, renamed and put in order; the first is the one Drashti starts with', () => {
    const t = setup();
    t.looks.setGroup(t.standard, t.hall, { languages: ['gu'] });
    t.looks.create('Copy', t.standard);
    t.looks.create('Blank', null);
    const [, copy, blank] = t.repo.list();
    expect(copy?.groups[t.hall]?.languages).toEqual(['gu']);
    expect(blank?.groups[t.hall]).toEqual(DEFAULT_GROUP_LOOK);
    expect(t.looks.rename(blank?.id, '  Placeholder evening  ').ok).toBe(true);
    expect(t.looks.move(blank?.id, 0).ok).toBe(true);
    expect(t.repo.list().map((l) => l.name)).toEqual(['Placeholder evening', 'Standard', 'Copy']);
    expect(t.repo.firstId()).toBe(blank?.id);
    // Names and changes are checked.
    expect(t.looks.create('', null)).toMatchObject({ ok: false });
    expect(t.looks.create('x'.repeat(61), null)).toMatchObject({ ok: false });
    expect(t.looks.create('Copy of nothing', 'gone')).toMatchObject({ ok: false });
    expect(t.looks.setGroup(t.standard, t.hall, { languages: [] })).toMatchObject({ ok: false });
    expect(t.looks.setGroup(t.standard, t.hall, { layers: ['slide', 'slide'] })).toMatchObject({ ok: false });
    expect(t.looks.setGroup(t.standard, t.hall, { slides: 'sideways' })).toMatchObject({ ok: false });
    expect(t.looks.setGroup(t.standard, t.hall, { movement: 'wild' })).toMatchObject({ ok: false });
    expect(t.looks.setGroup(t.standard, t.hall, { shape: 'x' })).toMatchObject({ ok: false });
    expect(t.looks.setGroup(t.standard, 'gone', { languages: ['gu'] })).toMatchObject({ ok: false });
    expect(t.looks.setGroup('gone', t.hall, { languages: ['gu'] })).toMatchObject({ ok: false });
  });

  it('give a group the wizard makes its languages in every Look; a deleted group leaves them all', () => {
    const t = setup();
    t.looks.create('Second', null);
    const lobby = t.screens.createGroup('Lobby');
    t.looks.groupMade(lobby, ['hi']);
    expect(t.repo.list().map((l) => l.groups[lobby]?.languages)).toEqual([['hi'], ['hi']]);
    expect(t.engine.current.look.groups[lobby]?.languages).toEqual(['hi']);
    t.screens.deleteGroup(lobby);
    t.looks.groupGone(lobby);
    for (const row of t.db.prepare('SELECT definition FROM looks').all() as { definition: string }[])
      expect(row.definition).not.toContain(lobby);
    expect(t.engine.current.look.groups[lobby]).toBeUndefined();
  });

  it('cannot be switched in Simple Mode', () => {
    const t = setup({ simple: true });
    t.looks.create('Second', null);
    const second = t.repo.list()[1]?.id ?? '';
    expect(t.engine.dispatch({ type: 'setLook', lookId: second })).toEqual({
      ok: false,
      error: 'forbidden',
      message: SIMPLE_MODE_REFUSAL,
    });
    expect(t.engine.current.look.id).toBe(t.standard);
    // Running the show is not refused.
    expect(t.engine.dispatch({ type: 'toggleBlackout' }).ok).toBe(true);
  });

  it('come back after an unexpected stop, and say so only for a Look other than the first', () => {
    const t = setup();
    t.looks.create('Second', null);
    const second = t.repo.list()[1]?.id ?? '';
    expect(t.engine.restore({ slide: null, background: null, blackout: false, lookId: second }).look).toBe(
      'Second',
    );
    expect(t.engine.current.look.id).toBe(second);
    const again = setup();
    expect(
      again.engine.restore({ slide: null, background: null, blackout: false, lookId: again.standard }).look,
    ).toBeNull();
    expect(
      again.engine.restore({ slide: null, background: null, blackout: false, lookId: 'gone' }).look,
    ).toBeNull();
    expect(again.engine.current.look.id).toBe(again.standard);
  });
});
