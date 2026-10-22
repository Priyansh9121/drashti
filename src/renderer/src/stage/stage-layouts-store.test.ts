import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_STAGE_BOXES, newStageBox } from '../../../shared/stage-layouts';
import { addBox, useStageLayouts } from './stage-layouts-store';

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
