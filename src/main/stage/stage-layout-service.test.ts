import { describe, expect, it } from 'vitest';
import { NO_LOOK } from '../../shared/looks';
import type { StageLayout } from '../../shared/stage-layouts';
import { newStageBox, standardAsBoxes } from '../../shared/stage-layouts';
import { openDatabase } from '../db/database';
import { LookRepo } from '../db/looks';
import { ScreenRepo } from '../db/screens';
import { StageLayoutRepo } from '../db/stage-layouts';
import { NO_PLAYLISTS } from '../engine/playlist-source';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport } from '../engine/testing';
import { LookService } from '../looks/look-service';
import { StageLayoutService } from './stage-layout-service';

/* Stage layouts: made and saved in the editor, drawn by stage groups through the live Look. */

function setup() {
  const db = openDatabase(':memory:');
  const stage = new ScreenRepo(db).createGroup('Stage', 'stage');
  const repo = new StageLayoutRepo(db);
  const lookRepo = new LookRepo(db);
  let looks: LookService | null = null;
  const engine = new ShowEngine(makeSource(), new RecordingTransport(), Date.now, NO_PLAYLISTS, {
    looks: { look: (id) => looks?.look(id) ?? null, start: () => looks?.start() ?? NO_LOOK },
  });
  looks = new LookService({
    repo: lookRepo,
    stageLayout: (id) => repo.get(id),
    engine,
    changed: () => undefined,
    log: () => undefined,
  });
  engine.refreshLook();
  const told: StageLayout[][] = [];
  const layouts = new StageLayoutService({
    repo,
    forgetInLooks: (id) => {
      lookRepo.forgetStageLayout(id);
    },
    changed: (list) => {
      told.push(list);
      looks.layoutsChanged();
    },
    log: () => undefined,
  });
  let n = 0;
  const id = () => `box-${++n}`;
  return { db, stage, repo, lookRepo, looks, engine, layouts, told, id };
}

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

  it('reach a stage group through the live Look, and change on its screens when saved', () => {
    const t = setup();
    expect(t.engine.current.look.groups[t.stage]?.stageLayout).toBeNull();
    const made = t.layouts.save(null, {
      name: 'Placeholder band',
      background: '#000000',
      boxes: [newStageBox('clock', 'c')],
    });
    const layoutId = made.ok ? made.id : '';
    const standard = t.lookRepo.firstId();
    expect(t.looks.setGroup(standard, t.stage, { stageLayoutId: layoutId }).ok).toBe(true);
    expect(t.engine.current.look.groups[t.stage]?.stageLayout).toMatchObject({
      id: layoutId,
      boxes: [{ kind: 'clock' }],
    });
    // Saved again: the live Look draws the new boxes at once.
    t.layouts.save(layoutId, {
      name: 'Placeholder band',
      background: '#000000',
      boxes: [newStageBox('notes', 'n')],
    });
    expect(t.engine.current.look.groups[t.stage]?.stageLayout?.boxes.map((b) => b.kind)).toEqual(['notes']);
    // A layout that does not exist cannot be chosen.
    expect(t.looks.setGroup(standard, t.stage, { stageLayoutId: 'gone' })).toMatchObject({ ok: false });
    // Removed: the group shows the Standard stage screen, and no Look names it any more.
    expect(t.layouts.remove(layoutId).ok).toBe(true);
    expect(t.engine.current.look.groups[t.stage]?.stageLayout).toBeNull();
    expect(t.lookRepo.get(standard)?.groups[t.stage]?.stageLayoutId).toBeNull();
    expect(t.layouts.remove(layoutId)).toMatchObject({ ok: false });
  });
});
