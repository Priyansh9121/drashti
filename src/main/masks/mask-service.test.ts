import { describe, expect, it } from 'vitest';
import { maskSvg, newMaskShape } from '../../shared/masks';
import { NO_LOOK } from '../../shared/looks';
import { openDatabase } from '../db/database';
import { LookRepo } from '../db/looks';
import { MaskRepo } from '../db/masks';
import { ScreenRepo } from '../db/screens';
import { NO_PLAYLISTS } from '../engine/playlist-source';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport } from '../engine/testing';
import { LookService } from '../looks/look-service';
import { MaskService } from './mask-service';

/* The mask library: made in the editor, a group's own shape in a Look, or up on the Masks layer. */

function setup() {
  const db = openDatabase(':memory:');
  const hall = new ScreenRepo(db).createGroup('Hall');
  const repo = new MaskRepo(db);
  const lookRepo = new LookRepo(db);
  let looks: LookService | null = null;
  const engine = new ShowEngine(makeSource(), new RecordingTransport(), Date.now, NO_PLAYLISTS, {
    looks: { look: (id) => looks?.look(id) ?? null, start: () => looks?.start() ?? NO_LOOK },
  });
  looks = new LookService({
    repo: lookRepo,
    mask: (id) => repo.get(id),
    engine,
    changed: () => undefined,
    log: () => undefined,
  });
  engine.refreshLook();
  const lookService = looks;
  const masks = new MaskService({
    repo,
    forgetInLooks: (id) => {
      lookRepo.forgetMask(id);
    },
    layer: {
      shown: () => engine.current.layers.masks,
      show: (mask) => {
        engine.dispatch({ type: 'setMask', mask });
      },
      clear: () => {
        engine.dispatch({ type: 'clearLayer', layer: 'masks' });
      },
    },
    changed: () => {
      lookService.masksChanged();
    },
    log: () => undefined,
  });
  return { db, hall, repo, lookRepo, looks: lookService, engine, masks };
}

const wall = (id = 'shape-1') => newMaskShape('ellipse', id, { width: 1920, height: 1080 });

describe('masks', () => {
  it('are made and saved, checked as they come in', () => {
    const t = setup();
    const made = t.masks.save(null, {
      name: 'Placeholder wall',
      width: 1920,
      height: 1080,
      mode: 'show',
      shapes: [wall()],
    });
    expect(made).toMatchObject({ ok: true, masks: [{ name: 'Placeholder wall', mode: 'show' }] });
    for (const bad of [
      { name: '', width: 1920, height: 1080, mode: 'hide', shapes: [] },
      { name: 'X', width: 8, height: 1080, mode: 'hide', shapes: [] },
      { name: 'X', width: 1920, height: 1080, mode: 'blur', shapes: [] },
      { name: 'X', width: 1920, height: 1080, mode: 'hide', shapes: [{ ...wall(), kind: 'star' }] },
      { name: 'X', width: 1920, height: 1080, mode: 'hide', shapes: [wall('a'), wall('a')] },
    ])
      expect(t.masks.save(null, bad)).toMatchObject({ ok: false });
  });

  it('give a group its own shape in a Look, kept out of every Look when removed', () => {
    const t = setup();
    const made = t.masks.save(null, {
      name: 'Placeholder wall',
      width: 1920,
      height: 1080,
      mode: 'show',
      shapes: [wall()],
    });
    const maskId = made.ok ? made.id : '';
    const standard = t.lookRepo.firstId();
    expect(t.looks.setGroup(standard, t.hall, { maskId }).ok).toBe(true);
    expect(t.engine.current.look.groups[t.hall]?.mask).toMatchObject({ id: maskId, mode: 'show' });
    expect(t.looks.setGroup(standard, t.hall, { maskId: 'gone' })).toMatchObject({ ok: false });
    // Saved again: the screens follow.
    t.masks.save(maskId, {
      name: 'Placeholder wall',
      width: 1920,
      height: 1080,
      mode: 'hide',
      shapes: [wall()],
    });
    expect(t.engine.current.look.groups[t.hall]?.mask?.mode).toBe('hide');
    // Clear all and F7 never take a group's own mask away.
    t.engine.dispatch({ type: 'clearAll' });
    t.engine.dispatch({ type: 'clearLayer', layer: 'masks' });
    expect(t.engine.current.look.groups[t.hall]?.mask?.id).toBe(maskId);
    expect(t.masks.remove(maskId).ok).toBe(true);
    expect(t.engine.current.look.groups[t.hall]?.mask).toBeNull();
    expect(t.lookRepo.get(standard)?.groups[t.hall]?.maskId).toBeNull();
  });

  it('go up on the Masks layer; saving one that is up shows the new shapes, removing it takes it down', () => {
    const t = setup();
    const made = t.masks.save(null, {
      name: 'Placeholder circle',
      width: 1920,
      height: 1080,
      mode: 'show',
      shapes: [wall()],
    });
    const mask = made.ok ? made.masks[0] : undefined;
    if (!mask) throw new Error('no mask');
    t.engine.dispatch({ type: 'setMask', mask });
    expect(t.engine.current.layers.masks?.id).toBe(mask.id);
    t.masks.save(mask.id, { ...mask, shapes: [wall('a'), wall('b')] });
    expect(t.engine.current.layers.masks?.shapes.map((s) => s.id)).toEqual(['a', 'b']);
    // Put it back brings it back after Clear all, as any layer.
    t.engine.dispatch({ type: 'clearAll' });
    expect(t.engine.current.layers.masks).toBeNull();
    t.engine.dispatch({ type: 'putBack' });
    expect(t.engine.current.layers.masks?.id).toBe(mask.id);
    t.masks.remove(mask.id);
    expect(t.engine.current.layers.masks).toBeNull();
  });

  it('draw as an image that is opaque where the picture shows', () => {
    const svg = maskSvg({
      width: 100,
      height: 50,
      mode: 'hide',
      shapes: [{ id: 's', kind: 'rounded', frame: { x: 10, y: 10, width: 20, height: 10 }, radius: 99 }],
    });
    // Hide: the canvas shows (white in the mask), the shape does not (black); the corners never exceed half a side.
    expect(svg).toContain('<rect width="100" height="50" fill="#fff"/>');
    expect(svg).toContain('<g fill="#000"><rect x="10" y="10" width="20" height="10" rx="5"/></g>');
    const inverse = maskSvg({
      width: 100,
      height: 50,
      mode: 'show',
      shapes: [{ id: 'e', kind: 'ellipse', frame: { x: 0, y: 0, width: 100, height: 50 } }],
    });
    expect(inverse).toContain('<rect width="100" height="50" fill="#000"/>');
    expect(inverse).toContain('<g fill="#fff"><ellipse cx="50" cy="25" rx="50" ry="25"/></g>');
  });
});
