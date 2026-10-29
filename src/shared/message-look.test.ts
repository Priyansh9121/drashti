import { describe, expect, it } from 'vitest';
import { animationById, animationFrame, animationLength, isAnimation, REST } from './lower-third-animations';
import {
  DEFAULT_MESSAGE_LOOK,
  draggedTo,
  isDefaultLook,
  keptLook,
  MESSAGE_FIRST_ANIMATIONS,
  messageBoxStyle,
  messageTextPx,
  placeWords,
  readLook,
  readSeconds,
  sizeWords,
} from './message-look';
import { fillMessage, messageTemplateSchema } from './messages';

/*
 * A hall message's look (Session 55, Part 15): the standard one is none at all (so a message shows as every message
 * did before, and an older library reads whole); where it goes on the picture; its size in steps; how it comes in,
 * from the animations the Lower Thirds use, with a slide in from each edge of the picture; its look and time up
 * carried from its template into what the engine shows.
 */

const CANVAS = { width: 1920, height: 1080 };

describe('a message’s look', () => {
  it('the standard one is kept as none, so the message shows as every message did before', () => {
    expect(isDefaultLook(DEFAULT_MESSAGE_LOOK)).toBe(true);
    expect(keptLook(DEFAULT_MESSAGE_LOOK)).toBeUndefined();
    expect(keptLook({ ...DEFAULT_MESSAGE_LOOK, color: '#FFFFFF' })).toBeUndefined();
    const yellow = { ...DEFAULT_MESSAGE_LOOK, color: '#fde68a' };
    expect(keptLook(yellow)).toEqual(yellow);
    expect(keptLook({ ...DEFAULT_MESSAGE_LOOK, place: { x: 0.5, y: 0.9 } })).toBeDefined();
  });

  it('reads an older library’s message (no look, no time) and a look it cannot read as the standard', () => {
    expect(readLook(undefined)).toBeUndefined();
    expect(readLook({ place: 'somewhere' })).toBeUndefined();
    expect(readLook({ ...DEFAULT_MESSAGE_LOOK, animation: 'not-in-the-library' })).toBeUndefined();
    expect(readLook({ ...DEFAULT_MESSAGE_LOOK, size: 3 })).toEqual({ ...DEFAULT_MESSAGE_LOOK, size: 3 });
    expect(readSeconds(undefined)).toBeUndefined();
    expect(readSeconds(30)).toBe(30);
    expect(readSeconds(1)).toBeUndefined();
    expect(readSeconds(2.5)).toBeUndefined();
  });

  it('its size: the standard banner’s, a fifth bigger or smaller a step', () => {
    expect(messageTextPx({ size: 0 }, 1080)).toBe(49);
    expect(messageTextPx({ size: 1 }, 1080)).toBe(58);
    expect(messageTextPx({ size: -1 }, 1080)).toBe(41);
    expect(messageTextPx({ size: 99 }, 1080)).toBe(messageTextPx({ size: 8 }, 1080));
    expect(sizeWords(0)).toBe('Standard');
    expect(sizeWords(2)).toBe('2 steps bigger');
    expect(sizeWords(-1)).toBe('1 step smaller');
  });

  it('where it goes: a band across at its row, a box at its place inside the edges, or where it was dragged', () => {
    expect(messageBoxStyle(DEFAULT_MESSAGE_LOOK, CANVAS, 81)).toEqual({
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 81,
    });
    expect(messageBoxStyle({ place: { row: 'top', column: 'left' }, behind: 'box' }, CANVAS)).toMatchObject({
      top: 54,
      left: 96,
    });
    expect(
      messageBoxStyle({ place: { row: 'middle', column: 'centre' }, behind: 'none' }, CANVAS),
    ).toMatchObject({ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
    expect(
      messageBoxStyle({ place: { row: 'bottom', column: 'right' }, behind: 'box' }, CANVAS, 81),
    ).toMatchObject({ bottom: 54 + 81, right: 96 });
    expect(messageBoxStyle({ place: { x: 0.25, y: 0.75 }, behind: 'box' }, CANVAS)).toMatchObject({
      left: 480,
      top: 810,
      transform: 'translate(-50%, -50%)',
    });
    expect(draggedTo(-1, 2)).toEqual({ x: 0.02, y: 0.98 });
    expect(placeWords({ row: 'bottom', column: 'left' })).toBe('Bottom left');
    expect(placeWords({ x: 0.3, y: 0.3 })).toBe('Where it was dragged');
  });

  it('comes in from each edge of the picture, across to its place, starting unseen and ending at rest', () => {
    for (const id of MESSAGE_FIRST_ANIMATIONS) expect(isAnimation(id), id).toBe(true);
    for (const [id, edge] of [
      ['across-left-steady', '--from-left'],
      ['across-right-steady', '--from-right'],
      ['across-up-steady', '--from-bottom'],
      ['across-down-steady', '--from-top'],
    ] as const) {
      const a = animationById(id);
      const length = animationLength(a, 'in', 0);
      expect(animationFrame(a, 'in', 0, 0).box.opacity, id).toBe(0);
      expect(animationFrame(a, 'in', 1, 0).box.transform, id).toContain(`var(${edge}, 100%)`);
      expect(animationFrame(a, 'in', length, 0).box, id).toEqual(REST);
      expect(animationFrame(a, 'out', animationLength(a, 'out', 0), 0).box.opacity, id).toBe(0);
    }
    expect(animationById('across-left-steady').name).toBe('Slide in from the left edge');
  });

  it('goes from its template into what the engine shows, with its time up; the standard look stays none', () => {
    const own = {
      ...DEFAULT_MESSAGE_LOOK,
      place: { row: 'top', column: 'right' } as const,
      behind: 'box' as const,
    };
    const filled = fillMessage(
      {
        id: 'tpl',
        name: 'Placeholder',
        template: 'Placeholder car {plate}',
        fields: {},
        look: own,
        seconds: 20,
      },
      { plate: 'PLACEHOLDER-1' },
      () => 'timer',
    );
    expect(filled.message).toMatchObject({ text: 'Placeholder car PLACEHOLDER-1', look: own, seconds: 20 });
    const plain = fillMessage(
      { id: 'tpl', name: 'P', template: 'Placeholder', fields: {}, look: DEFAULT_MESSAGE_LOOK },
      {},
      () => 'timer',
    );
    expect(plain.message).not.toHaveProperty('look');
    expect(plain.message).not.toHaveProperty('seconds');
    // What a window may save.
    expect(
      messageTemplateSchema.safeParse({
        name: 'P',
        template: 'Placeholder',
        fields: {},
        look: own,
        seconds: 20,
      }).success,
    ).toBe(true);
    expect(
      messageTemplateSchema.safeParse({ name: 'P', template: 'Placeholder', fields: {}, seconds: 1 }).success,
    ).toBe(false);
  });
});
