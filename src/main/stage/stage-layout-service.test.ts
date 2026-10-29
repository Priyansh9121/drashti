import { describe, expect, it } from 'vitest';
import { NO_LOOK } from '../../shared/looks';
import type { StageLayout } from '../../shared/stage-layouts';
import { newStageBox, standardAsBoxes } from '../../shared/stage-layouts';
import { openDatabase } from '../db/database';
import { LookRepo } from '../db/looks';
import { ScreenRepo } from '../db/screens';
import { SettingsRepo } from '../db/settings';
import { StageLayoutRepo } from '../db/stage-layouts';
import { NO_PLAYLISTS } from '../engine/playlist-source';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport } from '../engine/testing';
import { LookService } from '../looks/look-service';
import { StageLayoutService } from './stage-layout-service';

/*
 * Stage layouts: made and saved in the editor; since Session 55 one is chosen for every stage screen (no longer per
 * Look), kept in the library's settings, and drawn from the engine's state.
 */

type Db = ReturnType<typeof openDatabase>;

/** A library with a stage group, its Looks and stage layouts, the engine, and the service; `db` to start again on. */
function setup(given?: Db) {
  const db = given ?? openDatabase(':memory:');
  const screens = new ScreenRepo(db);
  const stage = screens.groups().find((g) => g.role === 'stage')?.id ?? screens.createGroup('Stage', 'stage');
  const repo = new StageLayoutRepo(db);
  const settings = new SettingsRepo(db);
  const lookRepo = new LookRepo(db);
  let looks: LookService | null = null;
  const engine = new ShowEngine(makeSource(), new RecordingTransport(), Date.now, NO_PLAYLISTS, {
    looks: { look: (id) => looks?.look(id) ?? null, start: () => looks?.start() ?? NO_LOOK },
  });
  const lookService = new LookService({
    repo: lookRepo,
    engine,
    changed: () => undefined,
    log: () => undefined,
  });
  looks = lookService;
  engine.refreshLook();
  const told: StageLayout[][] = [];
  const logged: string[] = [];
  const layouts = new StageLayoutService({
    repo,
    settings,
    lookLayoutId: () => lookService.liveStageLayoutId(),
    show: (layout) => {
      engine.setStage({ layout });
    },
    forgetInLooks: (id) => {
      lookRepo.forgetStageLayout(id);
    },
    changed: (list) => {
      told.push(list);
    },
    log: (line) => {
      logged.push(line);
    },
  });
  let n = 0;
  const id = () => `box-${++n}`;
  return { db, stage, repo, settings, lookRepo, looks: lookService, engine, layouts, told, logged, id };
}

/** Make a layout of one box of this kind; its id. */
function made(t: ReturnType<typeof setup>, name: string, kind: Parameters<typeof newStageBox>[0] = 'clock') {
  const saved = t.layouts.save(null, { name, background: '#000000', boxes: [newStageBox(kind, t.id())] });
  if (!saved.ok) throw new Error(saved.message);
  return saved.id;
}

/** The layout every stage screen draws now, from the engine's state: its id, or null for Standard. */
const drawn = (t: ReturnType<typeof setup>) => t.engine.current.stage?.layout?.id ?? null;

describe('stage layouts', () => {
  it('are made and saved with their boxes, checked as they come in', () => {
    const t = setup();
    const made = t.layouts.save(null, {
      name: 'Placeholder band',
      background: '#101010',
      boxes: standardAsBoxes(t.id),
    });
    expect(made).toMatchObject({ ok: true, layouts: [{ name: 'Placeholder band', background: '#101010' }] });
    const layoutId = made.ok ? made.id : '';
    expect(t.repo.get(layoutId)?.boxes.map((b) => b.kind)).toEqual([
      'stageMessage',
      'current',
      'screensState',
      'notes',
      'clock',
      'timer',
      'next',
    ]);
    const clock = newStageBox('clock', 'only');
    expect(t.layouts.save(layoutId, { name: 'Renamed', background: '#000000', boxes: [clock] }).ok).toBe(
      true,
    );
    expect(t.repo.list()).toEqual([{ id: layoutId, name: 'Renamed', background: '#000000', boxes: [clock] }]);
    expect(t.told).toHaveLength(2);
    // Refused: no name, a bad colour, a box off any canvas, a kind it does not know, two boxes the same.
    for (const bad of [
      { name: '', background: '#000000', boxes: [] },
      { name: 'X', background: 'black', boxes: [] },
      { name: 'X', background: '#000000', boxes: [{ ...clock, frame: { x: 0, y: 0, width: 2, height: 2 } }] },
      { name: 'X', background: '#000000', boxes: [{ ...clock, kind: 'weather' }] },
      { name: 'X', background: '#000000', boxes: [clock, clock] },
    ])
      expect(t.layouts.save(null, bad)).toMatchObject({ ok: false });
    expect(t.layouts.save('gone', { name: 'X', background: '#000000', boxes: [] })).toMatchObject({
      ok: false,
    });
  });

  it('one is chosen for every stage screen: Standard until one is, then that one at once, kept over a restart', () => {
    const t = setup();
    t.layouts.start();
    expect(t.layouts.chosenId()).toBeNull();
    expect(t.engine.current.stage).toEqual({ layout: null });
    const band = made(t, 'Placeholder band');
    // Made, not chosen: the stage screens show what they showed.
    expect(drawn(t)).toBeNull();
    expect(t.layouts.choose(band)).toEqual({ ok: true, chosenId: band });
    expect(drawn(t)).toBe(band);
    expect(t.engine.current.stage?.layout).toMatchObject({
      name: 'Placeholder band',
      boxes: [{ kind: 'clock' }],
    });
    // No Look holds it: the live Look's groups carry no stage layout at all.
    expect(JSON.stringify(t.engine.current.look)).not.toContain(band);
    // One that does not exist is refused, and nothing changes; null is Standard.
    expect(t.layouts.choose('gone')).toMatchObject({ ok: false });
    expect(t.layouts.choose(42)).toMatchObject({ ok: false });
    expect(drawn(t)).toBe(band);
    // A restart (the same library, a new engine and service): chosen still.
    const again = setup(t.db);
    again.layouts.start();
    expect(drawn(again)).toBe(band);
    expect(again.layouts.choose(null)).toEqual({ ok: true, chosenId: null });
    expect(drawn(again)).toBeNull();
    const third = setup(t.db);
    third.layouts.start();
    expect(drawn(third)).toBeNull();
  });

  it('the chosen layout saved or renamed changes every stage screen at once; another one changes nothing there', () => {
    const t = setup();
    t.layouts.start();
    const band = made(t, 'Placeholder band');
    const other = made(t, 'Placeholder other');
    t.layouts.choose(band);
    const before = t.engine.current.stage;
    t.layouts.save(other, { name: 'Placeholder other', background: '#000000', boxes: [] });
    expect(t.engine.current.stage).toBe(before);
    t.layouts.save(band, {
      name: 'Placeholder band',
      background: '#000000',
      boxes: [newStageBox('notes', 'n')],
    });
    expect(t.engine.current.stage?.layout?.boxes.map((b) => b.kind)).toEqual(['notes']);
    expect(t.layouts.rename(band, '  Placeholder renamed  ')).toMatchObject({ ok: true, id: band });
    expect(t.engine.current.stage?.layout?.name).toBe('Placeholder renamed');
    expect(t.repo.get(band)?.boxes.map((b) => b.kind)).toEqual(['notes']);
    // A name it cannot have, or a layout that is gone: refused, nothing changed.
    expect(t.layouts.rename(band, '   ')).toMatchObject({ ok: false });
    expect(t.layouts.rename(band, 'x'.repeat(61))).toMatchObject({ ok: false });
    expect(t.layouts.rename('gone', 'Placeholder')).toMatchObject({ ok: false });
    expect(t.repo.get(band)?.name).toBe('Placeholder renamed');
  });

  it('deleting the layout in use goes to Standard; put back (Undo), it is where it was, and chosen again', () => {
    const t = setup();
    t.layouts.start();
    const first = made(t, 'Placeholder first');
    const band = made(t, 'Placeholder band', 'videoInput');
    const last = made(t, 'Placeholder last');
    t.layouts.choose(band);
    const kept = t.repo.get(band);
    if (!kept) throw new Error('no layout');
    expect(t.layouts.remove(band).ok).toBe(true);
    expect(drawn(t)).toBeNull();
    expect(t.layouts.chosenId()).toBeNull();
    // Another deleted while it is not in use changes nothing on the stage.
    expect(t.layouts.remove(last).ok).toBe(true);
    expect(drawn(t)).toBeNull();
    // Put back as it was, in its place, and chosen again: the stage screens show it once more.
    expect(t.layouts.restore({ layout: kept, at: 1, chosen: true })).toMatchObject({ ok: true, id: band });
    expect(t.repo.list().map((l) => l.id)).toEqual([first, band]);
    expect(t.repo.get(band)).toEqual(kept);
    expect(drawn(t)).toBe(band);
    // Not twice, and never a layout that does not read.
    expect(t.layouts.restore({ layout: kept, at: 1, chosen: true })).toMatchObject({ ok: false });
    expect(
      t.layouts.restore({ layout: { ...kept, id: 'x', boxes: 'none' }, at: 0, chosen: false }),
    ).toMatchObject({
      ok: false,
    });
    // Put back unchosen, after the end of the list: last, and the stage as it is.
    const lastKept = { id: last, name: 'Placeholder last', background: '#000000', boxes: [] };
    expect(t.layouts.restore({ layout: lastKept, at: 99, chosen: false })).toMatchObject({ ok: true });
    expect(t.repo.list().map((l) => l.id)).toEqual([first, band, last]);
    expect(drawn(t)).toBe(band);
  });

  it('on the first start after the update, the layout the Look in use gave its stage group is the one chosen', () => {
    const t = setup();
    const band = made(t, 'Placeholder band');
    // As alpha.13 kept it: the live Look gives the stage group the layout.
    t.db
      .prepare('UPDATE looks SET definition = ? WHERE id = ?')
      .run(JSON.stringify({ groups: { [t.stage]: { stageLayoutId: band } } }), t.lookRepo.firstId());
    t.looks.groupsChanged();
    expect(t.layouts.chosenId()).toBeNull();
    t.layouts.start();
    expect(t.layouts.chosenId()).toBe(band);
    expect(drawn(t)).toBe(band);
    expect(t.settings.get('stage.layout')).toEqual({ id: band });
    expect(t.logged.join('\n')).toContain(
      'the layout of the Look in use is now the one every stage screen shows',
    );
    // Only that once: chosen again since, the Looks no longer count.
    t.layouts.choose(null);
    const again = setup(t.db);
    again.layouts.start();
    expect(drawn(again)).toBeNull();
  });

  it('on that first start, a Look whose layout is gone, or none, gives Standard', () => {
    const t = setup();
    t.db
      .prepare('UPDATE looks SET definition = ? WHERE id = ?')
      .run(JSON.stringify({ groups: { [t.stage]: { stageLayoutId: 'gone' } } }), t.lookRepo.firstId());
    t.looks.groupsChanged();
    t.layouts.start();
    expect(drawn(t)).toBeNull();
    expect(t.settings.get('stage.layout')).toEqual({ id: null });
    const none = setup();
    none.layouts.start();
    expect(none.settings.get('stage.layout')).toEqual({ id: null });
  });

  it('keep the audience picture box, and draw it under the stage message on every stage screen (Session 50)', () => {
    const t = setup();
    t.layouts.start();
    const boxes = [
      { ...newStageBox('audience', 'hall'), frame: { x: 0, y: 0, width: 1920, height: 1080 } },
      newStageBox('stageMessage', 'message'),
    ];
    const made = t.layouts.save(null, { name: 'Placeholder hall picture', background: '#000000', boxes });
    expect(made).toMatchObject({ ok: true });
    const layoutId = made.ok ? made.id : '';
    expect(t.repo.get(layoutId)?.boxes).toEqual(boxes);
    expect(t.layouts.choose(layoutId).ok).toBe(true);
    // Bottom to top: the picture first, so the stage message draws over it.
    expect(t.engine.current.stage?.layout?.boxes.map((b) => b.kind)).toEqual(['audience', 'stageMessage']);
    // A layout kept before there was such a box reads as it did.
    const before = { background: '#101010', boxes: standardAsBoxes(t.id) };
    const kept = t.repo.create('Placeholder kept layout', before);
    expect(t.repo.get(kept)).toEqual({ id: kept, name: 'Placeholder kept layout', ...before });
  });
});
