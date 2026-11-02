import type { Rect, SlideElement, TextElement } from '../../../shared/model';
import type { EditDoc, SlideLook } from '../../../shared/slide-edit';
import {
  alignMoves,
  boundsOf,
  centerOf,
  distributeMoves,
  normalizeAngle,
  unionOf,
  type Alignment,
  type Point,
} from './geometry';
import { findSlide, mapElements, newId } from './ops';
import { groupedSelection } from '../../../shared/element-groups';

export interface ArrangementUnit {
  ids: string[];
  frame: Rect;
}

/** A persistent group is one object for alignment and distribution, never a stack of collapsing members. */
export function arrangementUnits(
  elements: readonly SlideElement[],
  ids: readonly string[],
): ArrangementUnit[] {
  const picked = new Set(groupedSelection(elements, ids));
  const groups = new Map<string, SlideElement[]>();
  for (const el of elements) {
    if (!picked.has(el.id)) continue;
    const key = el.groupId ? `group:${el.groupId}` : `element:${el.id}`;
    const members = groups.get(key) ?? [];
    members.push(el);
    groups.set(key, members);
  }
  return [...groups.values()].flatMap((members) => {
    const frame = unionOf(members.map(boundsOf));
    return frame ? [{ ids: members.map((el) => el.id), frame }] : [];
  });
}

function moveUnits(doc: EditDoc, slideId: string, units: ArrangementUnit[], moves: Point[]): EditDoc {
  const byId = new Map<string, Point>();
  units.forEach((unit, i) => {
    for (const id of unit.ids) byId.set(id, moves[i] ?? { x: 0, y: 0 });
  });
  // One exact translation per unit: rounding each member separately can change the group's internal spacing.
  return mapElements(doc, slideId, [...byId.keys()], (el) => {
    const move = byId.get(el.id) ?? { x: 0, y: 0 };
    return { ...el, frame: { ...el.frame, x: el.frame.x + move.x, y: el.frame.y + move.y } };
  });
}

export function lineUpElements(
  doc: EditDoc,
  slideId: string,
  ids: readonly string[],
  how: Alignment,
): EditDoc {
  const units = arrangementUnits(findSlide(doc, slideId)?.elements ?? [], ids);
  return units.length
    ? moveUnits(
        doc,
        slideId,
        units,
        alignMoves(
          units.map((unit) => unit.frame),
          how,
          doc,
        ),
      )
    : doc;
}

export function spaceElements(
  doc: EditDoc,
  slideId: string,
  ids: readonly string[],
  axis: 'x' | 'y',
): EditDoc {
  const units = arrangementUnits(findSlide(doc, slideId)?.elements ?? [], ids);
  return units.length >= 3
    ? moveUnits(
        doc,
        slideId,
        units,
        distributeMoves(
          units.map((unit) => unit.frame),
          axis,
        ),
      )
    : doc;
}

export function groupElements(doc: EditDoc, slideId: string, ids: readonly string[]): EditDoc {
  if (ids.length < 2) return doc;
  const groupId = newId();
  return mapElements(doc, slideId, ids, (el) => ({ ...el, groupId }));
}

export function ungroupElements(doc: EditDoc, slideId: string, ids: readonly string[]): EditDoc {
  return mapElements(doc, slideId, ids, (el) => {
    const { groupId: _group, ...rest } = el;
    return rest;
  });
}

/** Mirror the whole selection, including each member's content and its rotation. Twice restores it. */
export function flipElements(
  doc: EditDoc,
  slideId: string,
  ids: readonly string[],
  axis: 'x' | 'y',
): EditDoc {
  const selected = findSlide(doc, slideId)?.elements.filter((el) => ids.includes(el.id)) ?? [];
  const box = unionOf(selected.map(boundsOf));
  if (!box) return doc;
  const center = centerOf(box);
  return mapElements(doc, slideId, ids, (el) => {
    const c = centerOf(el.frame);
    const flag = axis === 'x' ? 'flipX' : 'flipY';
    const next = {
      ...el,
      frame: {
        ...el.frame,
        x: axis === 'x' ? 2 * center.x - c.x - el.frame.width / 2 : el.frame.x,
        y: axis === 'y' ? 2 * center.y - c.y - el.frame.height / 2 : el.frame.y,
      },
    };
    if (el[flag]) {
      if (flag === 'flipX') delete next.flipX;
      else delete next.flipY;
    } else next[flag] = true;
    const rotation = normalizeAngle(-(el.rotation ?? 0));
    if (rotation) next.rotation = rotation;
    else delete next.rotation;
    return next;
  });
}

/** A table is a group of ordinary editable text cells and bordered rectangles, drawn by every existing output. */
export function tableElements(
  rows: number,
  columns: number,
  look: SlideLook,
  size: { width: number; height: number },
): SlideElement[] {
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(columns) ||
    rows < 1 ||
    columns < 1 ||
    rows > 10 ||
    columns > 10
  )
    return [];
  const groupId = newId();
  const width = (size.width * 0.8) / columns;
  const height = (size.height * 0.6) / rows;
  return Array.from({ length: rows * columns }, (_, i): SlideElement[] => {
    const frame = {
      x: size.width * 0.1 + (i % columns) * width,
      y: size.height * 0.2 + Math.floor(i / columns) * height,
      width,
      height,
    };
    const text: TextElement = {
      id: newId(),
      groupId,
      kind: 'text',
      text: '',
      lang: null,
      frame: {
        x: frame.x + 8,
        y: frame.y + 8,
        width: Math.max(1, width - 16),
        height: Math.max(1, height - 16),
      },
      style: {
        ...look.style,
        fontSize: Math.max(14, Math.min(look.style.fontSize, height * 0.4)),
        color: '#ffffff',
        shadow: false,
      },
    };
    return [
      {
        id: newId(),
        groupId,
        kind: 'shape',
        shape: 'rectangle',
        frame,
        fill: i < columns ? '#283a6e' : '#151f38',
        outline: { color: '#a4b0cf', width: 2 },
        opacity: 1,
        cornerRadius: 0,
      },
      text,
    ];
  }).flat();
}
