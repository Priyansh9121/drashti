import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUP_LOOK,
  DEFAULT_LIVE_GROUP_LOOK,
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
      }),
    ).toEqual({
      layers: ['slide', 'props'],
      languages: ['gu'],
      slides: 'lowerThird',
      stageLayoutId: 'l1',
      maskId: 'm1',
      idle: 'always',
    });
    expect(readGroupLook(undefined)).toEqual(DEFAULT_GROUP_LOOK);
    expect(
      readGroupLook({
        layers: ['props', 'slide'],
        languages: ['gu', 'gu'],
        slides: 'sideways',
        idle: 'often',
      }),
    ).toEqual({
      // The layers in drawing order; the languages, slide style and idle setting unreadable, so the defaults.
      layers: ['slide', 'props'],
      languages: null,
      slides: 'designed',
      stageLayoutId: null,
      maskId: null,
      idle: 'off',
    });
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
      },
      [t.stage]: { ...DEFAULT_LIVE_GROUP_LOOK, languages: ['gu'] },
    });
    // A Look that is gone cannot go live.
    expect(t.engine.dispatch({ type: 'setLook', lookId: 'gone' })).toMatchObject({
      ok: false,
      error: 'unknown-look',
    });
  });

  it('follow edits to the live Look at once, and fall back to the first when it is removed', () => {
    const t = setup();
    t.looks.setGroup(t.standard, t.hall, { languages: ['translit', 'en'] });
    expect(t.engine.current.look.groups[t.hall]?.languages).toEqual(['translit', 'en']);
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
