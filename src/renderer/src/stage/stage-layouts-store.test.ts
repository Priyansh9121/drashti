import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_STAGE_BOXES, newStageBox } from '../../../shared/stage-layouts';
import {
  addBox,
  change,
  deleteBox,
  lastStep,
  remove,
  STANDARD,
  undoStage,
  useStageLayouts,
} from './stage-layouts-store';

/* Adding a box in the stage layout editor (Session 50: the audience picture goes under the others). */

describe('a box added in the stage layout editor', () => {
  beforeEach(() => {
    useStageLayouts.setState({
      layouts: [],
      open: true,
      shownId: 'placeholder-layout',
      editing: {
        id: 'placeholder-layout',
        name: 'Placeholder layout',
        background: '#000000',
        boxes: [newStageBox('stageMessage', 'message'), newStageBox('clock', 'clock')],
      },
      saved: null,
      boxId: null,
      problem: null,
    });
  });

  it('is the audience picture under the boxes already there, so they draw over it; any other on top; chosen', () => {
    addBox('audience');
    let s = useStageLayouts.getState();
    expect(s.editing?.boxes.map((b) => b.kind)).toEqual(['audience', 'stageMessage', 'clock']);
    expect(s.boxId).toBe(s.editing?.boxes[0]?.id);
    addBox('timer');
    s = useStageLayouts.getState();
    expect(s.editing?.boxes.map((b) => b.kind)).toEqual(['audience', 'stageMessage', 'clock', 'timer']);
    expect(s.boxId).toBe(s.editing?.boxes[3]?.id);
    // Each new box has an id of its own.
    expect(new Set(s.editing?.boxes.map((b) => b.id)).size).toBe(4);
  });

  it('is not added past the most a layout holds', () => {
    const full = Array.from({ length: MAX_STAGE_BOXES }, (_, i) => newStageBox('text', `text-${String(i)}`));
    useStageLayouts.setState((s) => ({ editing: s.editing ? { ...s.editing, boxes: full } : null }));
    addBox('audience');
    expect(useStageLayouts.getState().editing?.boxes).toEqual(full);
    expect(useStageLayouts.getState().boxId).toBeNull();
  });
});

/* Session 55: every step in the stage layout editor has Undo; a box deleted by its button, Delete or Backspace too. */

describe('Undo in the stage layout editor (Session 55)', () => {
  const editing = {
    id: 'placeholder-layout',
    name: 'Placeholder layout',
    background: '#000000',
    boxes: [newStageBox('stageMessage', 'message'), newStageBox('clock', 'clock')],
  };

  beforeEach(() => {
    useStageLayouts.setState({
      layouts: [{ ...editing }],
      open: true,
      shownId: 'placeholder-layout',
      editing,
      saved: editing,
      boxId: 'clock',
      problem: null,
      steps: [],
    });
  });

  it('a box deleted comes back where it was, chosen again, with one Undo', async () => {
    deleteBox('clock');
    let s = useStageLayouts.getState();
    expect(s.editing?.boxes.map((b) => b.id)).toEqual(['message']);
    expect(s.boxId).toBeNull();
    expect(lastStep(s)?.text).toBe('Deleted the box Clock');
    expect(await undoStage()).toBe(true);
    s = useStageLayouts.getState();
    expect(s.editing?.boxes.map((b) => b.id)).toEqual(['message', 'clock']);
    expect(s.editing).toBe(editing);
    expect(s.steps).toEqual([]);
    expect(await undoStage()).toBe(false);
  });

  it('takes back each change in turn, latest first; changes to one field in a row are one step', async () => {
    addBox('timer');
    deleteBox('message');
    change((e) => ({ ...e, name: 'Placeholder r' }), 'Changed the name');
    change((e) => ({ ...e, name: 'Placeholder renamed' }), 'Changed the name');
    expect(useStageLayouts.getState().steps.map((x) => x.text)).toEqual([
      'Added the box Timer',
      'Deleted the box Stage message',
      'Changed the name',
    ]);
    await undoStage();
    expect(useStageLayouts.getState().editing?.name).toBe('Placeholder layout');
    await undoStage();
    expect(useStageLayouts.getState().editing?.boxes.map((b) => b.kind)).toEqual([
      'stageMessage',
      'clock',
      'timer',
    ]);
    await undoStage();
    expect(useStageLayouts.getState().editing).toBe(editing);
  });

  it('a change to the list is taken back by what it says: the layout deleted is put back in its place, chosen again', async () => {
    const calls: unknown[][] = [];
    const listed = [{ ...editing }];
    (globalThis as { window?: unknown }).window = {
      drashti: {
        stageLayouts: {
          remove: (id: string) => {
            calls.push(['remove', id]);
            return Promise.resolve({ ok: true, layouts: [], id });
          },
          restore: (layout: unknown, at: number, chosen: boolean) => {
            calls.push(['restore', layout, at, chosen]);
            return Promise.resolve({ ok: true, layouts: listed, id: 'placeholder-layout' });
          },
        },
      },
    };
    try {
      expect(await remove(() => 'placeholder-layout')).toBe(true);
      expect(useStageLayouts.getState().shownId).toBe(STANDARD);
      expect(lastStep(useStageLayouts.getState())?.text).toBe('Deleted “Placeholder layout”');
      await undoStage();
      expect(calls).toEqual([
        ['remove', 'placeholder-layout'],
        ['restore', { ...editing }, 0, true],
      ]);
      expect(useStageLayouts.getState().shownId).toBe('placeholder-layout');
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});
