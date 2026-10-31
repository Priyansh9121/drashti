import { describe, expect, it } from 'vitest';
import { freshGroups, groupedSelection } from '../../../shared/element-groups';
import { slideElementSchema } from '../../../shared/model-schema';
import type { ShapeElement } from '../../../shared/model';
import type { EditDoc, SlideLook } from '../../../shared/slide-edit';
import { flipElements, groupElements, tableElements, ungroupElements } from './arrange-ops';

const first: ShapeElement = {
  id: 'first',
  kind: 'shape',
  shape: 'arrow',
  frame: { x: 50, y: 70, width: 100, height: 80 },
  rotation: 25,
  fill: '#ffffff',
  opacity: 1,
  cornerRadius: 0,
};
const second: ShapeElement = {
  ...first,
  id: 'second',
  rotation: 210,
  frame: { x: 300, y: 180, width: 70, height: 40 },
};
const makeDoc = (): EditDoc => ({
  presentationId: 'placeholder',
  name: 'Placeholder',
  width: 1920,
  height: 1080,
  transition: null,
  loop: false,
  groups: [
    {
      id: 'slides',
      name: '',
      color: null,
      slides: [
        {
          id: 'slide',
          label: '',
          notes: '',
          background: null,
          darken: null,
          enabled: true,
          transition: null,
          autoAdvanceMs: null,
          macroId: null,
          cues: [],
          elements: [first, second],
        },
      ],
    },
  ],
});
const look: SlideLook = {
  frame: first.frame,
  background: null,
  langs: {},
  style: {
    fontFamily: null,
    fontSize: 48,
    fontWeight: 400,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.4,
    shadow: false,
  },
};

describe('persistent groups and reflections', () => {
  it('selects the whole group from either member, preserves unrelated selections, and ungroups without mutating the old document', () => {
    const before = makeDoc();
    const grouped = groupElements(before, 'slide', ['first', 'second']);
    const elements = grouped.groups[0]?.slides[0]?.elements ?? [];
    expect(elements[0]?.groupId).toBeTruthy();
    expect(elements[1]?.groupId).toBe(elements[0]?.groupId);
    expect(groupedSelection([...elements, { ...first, id: 'other' }], ['second', 'other'])).toEqual([
      'first',
      'second',
      'other',
    ]);
    expect(ungroupElements(grouped, 'slide', ['first', 'second'])).toEqual(before);
    expect(first).not.toHaveProperty('groupId');
  });

  it('copies each group to a distinct identity while keeping its members together', () => {
    const grouped = [
      { ...first, groupId: 'one' },
      { ...second, groupId: 'one' },
      { ...first, id: 'other', groupId: 'two' },
    ];
    const copied = freshGroups(grouped);
    expect(copied[0]?.groupId).toBe(copied[1]?.groupId);
    expect(new Set([...grouped, ...copied].map((el) => el.groupId)).size).toBe(4);
    expect(freshGroups(grouped)[0]?.groupId).not.toBe(copied[0]?.groupId);
    expect(grouped[0]?.groupId).toBe('one');
  });

  for (const axis of ['x', 'y'] as const)
    it(`reflects the complete selection on ${axis}; twice restores positions, rotations and content`, () => {
      const before = makeDoc();
      const once = flipElements(before, 'slide', ['first', 'second'], axis);
      const twice = flipElements(once, 'slide', ['first', 'second'], axis);
      const elements = twice.groups[0]?.slides[0]?.elements ?? [];
      for (const [i, original] of [first, second].entries()) {
        const el = elements[i];
        expect(el?.frame.x).toBeCloseTo(original.frame.x, 8);
        expect(el?.frame.y).toBeCloseTo(original.frame.y, 8);
        expect(el?.rotation).toBe(original.rotation);
        expect(el).not.toHaveProperty('flipX');
        expect(el).not.toHaveProperty('flipY');
      }
      expect(before.groups[0]?.slides[0]?.elements).toEqual([first, second]);
    });
});

describe('editable tables', () => {
  it('makes a single group of text cells and borders that all existing renderers can read', () => {
    const cells = tableElements(2, 3, look, { width: 1920, height: 1080 });
    expect(cells).toHaveLength(12);
    expect(cells.filter((el) => el.kind === 'text')).toHaveLength(6);
    expect(new Set(cells.map((el) => el.groupId)).size).toBe(1);
    expect(new Set(cells.map((el) => el.id)).size).toBe(12);
    for (const cell of cells) expect(slideElementSchema.parse(cell)).toEqual(cell);
  });
  for (const rows of [0, 11, 2.5, NaN])
    it(`refuses an invalid table row count ${String(rows)}`, () => {
      expect(tableElements(rows, 2, look, { width: 1920, height: 1080 })).toEqual([]);
    });
});
