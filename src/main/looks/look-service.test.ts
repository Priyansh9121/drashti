import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUP_LOOK,
  DEFAULT_LIVE_GROUP_LOOK,
  GROUP_LAYERS,
  LOOK_LAYERS,
  NO_LOOK,
  readGroupLook,
  storedGroupLook,
} from '../../shared/looks';
import { openDatabase } from '../db/database';
import { LookRepo } from '../db/looks';
import { ScreenRepo } from '../db/screens';
import { NO_PLAYLISTS } from '../engine/playlist-source';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport } from '../engine/testing';
import { LookService } from './look-service';

/*
 * Each screen group's settings (Session 55, Part 12: Looks gone from the window): its languages, set in Screens and
 * kept in the library's first Look as since Session 11, and what its role gives it; every Look the library keeps,
 * and every other setting in them, stays as it was, unread. Placeholder names only.
 */

function setup() {
  const db = openDatabase(':memory:');
  const screens = new ScreenRepo(db);
  const hall = screens.createGroup('Hall');
  const stage = screens.createGroup('Stage', 'stage');
  const repo = new LookRepo(db);
  const transport = new RecordingTransport();
  let looks: LookService | null = null;
  const engine = new ShowEngine(makeSource(), transport, Date.now, NO_PLAYLISTS, {
    looks: { start: () => looks?.start() ?? NO_LOOK },
  });
  looks = new LookService({ repo, engine, log: () => undefined });
  engine.refreshLook();
  const standard = repo.firstId();
  return { db, screens, repo, engine, looks, transport, hall, stage, standard };
}

/** A Look's stored definition, as the library has it. */
const definitionOf = (db: ReturnType<typeof openDatabase>, id: string): unknown =>
  JSON.parse(
    (db.prepare('SELECT definition FROM looks WHERE id = ?').get(id) as { definition: string }).definition,
  );

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

describe('each group’s settings (Session 55, Part 12)', () => {
  it('are its role’s, in its languages: every layer and slides as designed, a key and fill pair the words as a lower third and messages alone; every group Calm', () => {
    const t = setup();
    const keyfill = t.screens.createGroup('Switcher', 'keyfill');
    t.looks.groupsChanged();
    const groups = t.engine.current.look.groups;
    expect(groups[t.hall]).toEqual(DEFAULT_LIVE_GROUP_LOOK);
    expect(groups[t.hall]?.layers).toEqual(GROUP_LAYERS);
    expect(groups[t.stage]).toEqual(DEFAULT_LIVE_GROUP_LOOK);
    expect(groups[keyfill]).toEqual({
      layers: ['slide', 'messages'],
      languages: null,
      slides: 'lowerThird',
      movement: 'calm',
    });
    // Languages from Screens: on that group's screens at once, kept in the first Look.
    expect(t.looks.setLiveLanguages(t.hall, ['gu', 'translit'])).toBe(true);
    expect(t.engine.current.look.groups[t.hall]?.languages).toEqual(['gu', 'translit']);
    expect(t.looks.liveLanguages(t.hall)).toEqual(['gu', 'translit']);
    expect(t.repo.get(t.standard)?.groups[t.hall]?.languages).toEqual(['gu', 'translit']);
    expect(t.looks.setLiveLanguages('no-such-group', ['gu'])).toBe(false);
  });

  it('read a library’s Looks without showing them: layers, slide style, a mask, the idle rotation, Bold and another Look are kept as they were, unread', () => {
    const t = setup();
    // As alpha.13 kept them: the hall's own settings in the first Look, and a second Look.
    const stored = {
      groups: {
        [t.hall]: {
          layers: ['slide', 'props'],
          languages: ['gu'],
          slides: 'lowerThird',
          maskId: 'placeholder-mask',
          idle: 'always',
          movement: 'bold',
        },
      },
    };
    t.db.prepare('UPDATE looks SET definition = ? WHERE id = ?').run(JSON.stringify(stored), t.standard);
    const festival = t.repo.create('Placeholder festival');
    t.db
      .prepare('UPDATE looks SET definition = ? WHERE id = ?')
      .run(JSON.stringify({ groups: { [t.hall]: { languages: ['en'] } } }), festival);
    t.looks.groupsChanged();
    // Drawn: its languages only (the first Look's), everything else its role's.
    expect(t.engine.current.look.groups[t.hall]).toEqual({ ...DEFAULT_LIVE_GROUP_LOOK, languages: ['gu'] });
    expect(t.engine.current.look.id).toBe(t.standard);
    // Kept: both Looks, as they were.
    expect(definitionOf(t.db, t.standard)).toEqual(stored);
    expect(t.repo.list().map((l) => l.name)).toEqual(['Standard', 'Placeholder festival']);
    // A change of languages in Screens changes the languages alone: the rest stays as an older Drashti reads it.
    t.looks.setLiveLanguages(t.hall, ['hi']);
    const after = t.repo.get(t.standard)?.groups[t.hall];
    expect(after).toMatchObject({
      layers: ['slide', 'props', 'pip'],
      languages: ['hi'],
      slides: 'lowerThird',
      maskId: 'placeholder-mask',
      idle: 'always',
      movement: 'bold',
    });
    expect(t.repo.get(festival)?.groups[t.hall]?.languages).toEqual(['en']);
  });

  it('give a group the wizard makes its languages in every Look; a deleted group leaves them all', () => {
    const t = setup();
    t.repo.create('Second');
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

  it('move Bold only for the performance check (moveAll), and Calm again after', () => {
    const t = setup();
    t.looks.moveAll('bold');
    expect(Object.values(t.engine.current.look.groups).map((g) => g.movement)).toEqual(['bold', 'bold']);
    t.looks.moveAll('calm');
    expect(Object.values(t.engine.current.look.groups).map((g) => g.movement)).toEqual(['calm', 'calm']);
  });
});

describe('the stage layout a Look chose before Session 55', () => {
  it('is read once, without error: the first Look’s first stage group’s; none reaches the screens', () => {
    const t = setup();
    expect(t.looks.liveStageLayoutId()).toBeNull();
    const second = t.screens.createGroup('Side stage', 'stage');
    // As alpha.13 kept them: the hall's languages, and each stage group's layout.
    t.db.prepare('UPDATE looks SET definition = ? WHERE id = ?').run(
      JSON.stringify({
        groups: {
          [t.hall]: { languages: ['gu'] },
          [t.stage]: { stageLayoutId: 'placeholder-first' },
          [second]: { stageLayoutId: 'placeholder-second' },
        },
      }),
      t.standard,
    );
    t.looks.groupsChanged();
    expect(t.engine.current.look.groups[t.hall]?.languages).toEqual(['gu']);
    expect(t.engine.current.look.groups[t.stage]).toEqual(DEFAULT_LIVE_GROUP_LOOK);
    for (const group of Object.values(t.engine.current.look.groups))
      expect(group).not.toHaveProperty('stageLayout');
    expect(t.looks.liveStageLayoutId()).toBe('placeholder-first');
  });
});
