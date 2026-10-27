import { describe, expect, it } from 'vitest';
import type { ScalingMode } from './screens';
import type { StageBox, StageLayout } from './stage-layouts';
import {
  arrangeBoxes,
  hallPicture,
  hallPictureOfScreens,
  hallPictureSchema,
  newStageBox,
  showsHall,
  smallestBox,
  STAGE_BOX_KINDS,
  STAGE_BOX_LABELS,
  STAGE_BOX_NAMES,
  stageBoxSchema,
  stageLayoutDefinitionSchema,
  standardAsBoxes,
  typedFrame,
  withBoxAdded,
} from './stage-layouts';

/* The audience picture, live, as a stage layout's box (Session 50), and the hall's picture it draws. */

const layout = (boxes: StageLayout['boxes']): StageLayout => ({
  id: 'placeholder-layout',
  name: 'Placeholder layout',
  background: '#000000',
  boxes,
});

describe('the audience picture box', () => {
  it('is a kind of box of its own, made 16:9 in the middle of the canvas, with no label', () => {
    expect(STAGE_BOX_KINDS).toContain('audience');
    expect(STAGE_BOX_NAMES.audience).toBe('The audience picture, live');
    expect(STAGE_BOX_LABELS.audience).toBe('');
    const box = newStageBox('audience', 'hall');
    expect(box).toMatchObject({ kind: 'audience', label: '' });
    expect(box.frame).toEqual({ x: 480, y: 270, width: 960, height: 540 });
    expect(stageBoxSchema.safeParse(box).success).toBe(true);
  });

  it('is in no built-in layout: Standard as boxes (Duplicate starts from it) has none', () => {
    let n = 0;
    const kinds = standardAsBoxes(() => `box-${String(++n)}`).map((b) => b.kind);
    expect(kinds).not.toContain('audience');
    expect(kinds).toEqual(['stageMessage', 'current', 'screensState', 'notes', 'clock', 'timer', 'next']);
  });

  it('goes under the boxes already there when added, so they draw over it; any other box goes on top', () => {
    const message = newStageBox('stageMessage', 'message');
    const clock = newStageBox('clock', 'clock');
    const hall = newStageBox('audience', 'hall');
    expect(withBoxAdded([message, clock], hall).map((b) => b.id)).toEqual(['hall', 'message', 'clock']);
    const timer = newStageBox('timer', 'timer');
    expect(withBoxAdded([hall, message, clock], timer).map((b) => b.id)).toEqual([
      'hall',
      'message',
      'clock',
      'timer',
    ]);
    expect(withBoxAdded([], hall)).toEqual([hall]);
  });

  it('is kept in a stored layout, and a layout stored before it reads as it did', () => {
    let n = 0;
    const before = { background: '#101010', boxes: standardAsBoxes(() => `box-${String(++n)}`) };
    expect(stageLayoutDefinitionSchema.parse(JSON.parse(JSON.stringify(before)))).toEqual(before);
    const withHall = {
      background: '#000000',
      boxes: [
        { ...newStageBox('audience', 'hall'), frame: { x: 0, y: 0, width: 1920, height: 1080 } },
        newStageBox('stageMessage', 'message'),
      ],
    };
    expect(stageLayoutDefinitionSchema.parse(JSON.parse(JSON.stringify(withHall)))).toEqual(withHall);
  });

  // Session 53 (question 5): the editor made it as small as any box (8 x 8), where its line ("No audience screens",
  // "Audience off") cannot keep to the stage's smallest words (30 px).
  it('is made no smaller in the editor than a sixth of the stage each way, where its line keeps to 30 px', () => {
    expect(smallestBox('audience')).toEqual({ width: 320, height: 180 });
    for (const kind of STAGE_BOX_KINDS.filter((k) => k !== 'audience'))
      expect(smallestBox(kind), kind).toEqual({ width: 8, height: 8 });
    // A new one is larger already.
    const hall = newStageBox('audience', 'hall');
    expect(hall.frame.width).toBeGreaterThanOrEqual(smallestBox('audience').width);
    expect(hall.frame.height).toBeGreaterThanOrEqual(smallestBox('audience').height);
    // A size typed in its fields: never below it, in whole pixels.
    expect(typedFrame(hall, 'width', 100)).toEqual({ ...hall.frame, width: 320 });
    expect(typedFrame(hall, 'height', 50.4)).toEqual({ ...hall.frame, height: 180 });
    expect(typedFrame(hall, 'width', 400.6)).toEqual({ ...hall.frame, width: 401 });
    // Its place as typed; another kind of box 8 px each way at the least, as before.
    expect(typedFrame(hall, 'x', -50)).toEqual({ ...hall.frame, x: -50 });
    expect(typedFrame(hall, 'y', 12.2)).toEqual({ ...hall.frame, y: 12 });
    const clock = newStageBox('clock', 'clock');
    expect(typedFrame(clock, 'width', 3)).toEqual({ ...clock.frame, width: 8 });
    expect(typedFrame(clock, 'height', 40)).toEqual({ ...clock.frame, height: 40 });
  });

  it('saved smaller than that before, is read and drawn as it was, its size kept as its place is typed', () => {
    const small = { ...newStageBox('audience', 'hall'), frame: { x: 900, y: 500, width: 96, height: 54 } };
    const before = { background: '#000000', boxes: [small] };
    expect(stageLayoutDefinitionSchema.parse(JSON.parse(JSON.stringify(before)))).toEqual(before);
    expect(typedFrame(small, 'x', 901)).toEqual({ ...small.frame, x: 901 });
    expect(typedFrame(small, 'y', 480)).toEqual({ ...small.frame, y: 480 });
  });

  it('marks a layout that draws the hall’s picture', () => {
    expect(showsHall(null)).toBe(false);
    expect(showsHall(layout([newStageBox('clock', 'clock')]))).toBe(false);
    expect(showsHall(layout([newStageBox('audience', 'hall'), newStageBox('clock', 'clock')]))).toBe(true);
  });
});

describe('the hall’s picture', () => {
  const screen = (canvasWidth: number, canvasHeight: number, scaling: ScalingMode = 'fit') => ({
    canvasWidth,
    canvasHeight,
    scaling,
  });

  it('is the first audience group’s, at its first screen’s canvas and scaling', () => {
    expect(
      hallPicture([
        { id: 'stage', role: 'stage', screens: [screen(1920, 1080)] },
        { id: 'keyfill', role: 'keyfill', screens: [screen(1920, 1080)] },
        { id: 'hall', role: 'audience', screens: [screen(1280, 720, 'fill'), screen(1920, 1080)] },
        { id: 'side', role: 'audience', screens: [screen(1024, 768)] },
      ]),
    ).toEqual({ groupId: 'hall', canvasWidth: 1280, canvasHeight: 720, scaling: 'fill' });
  });

  it('is 1920 x 1080, fitted, while that group has no screen; none without an audience group', () => {
    expect(hallPicture([{ id: 'hall', role: 'audience', screens: [] }])).toEqual({
      groupId: 'hall',
      canvasWidth: 1920,
      canvasHeight: 1080,
      scaling: 'fit',
    });
    expect(
      hallPicture([
        { id: 'stage', role: 'stage', screens: [screen(1920, 1080)] },
        { id: 'stream', role: 'stream', screens: [] },
      ]),
    ).toBeNull();
    expect(hallPicture([])).toBeNull();
    // A key and fill pair alone is no audience group: the stage's boxes say No audience screens (Session 52, kept).
    expect(hallPicture([{ id: 'keyfill', role: 'keyfill', screens: [screen(1920, 1080)] }])).toBeNull();
  });

  // Section 4 review (Session 50): "this computer's audience screens" — an audience group left empty by Set Up
  // Screens…, or one whose screens are all a node's or turned off, is not the hall this computer shows.
  it('is the first audience group with a screen on this computer that is on', () => {
    const local = (w: number, h: number) => ({ ...screen(w, h), nodeId: null, enabled: true });
    expect(
      hallPicture([
        { id: 'emptied', role: 'audience', screens: [] },
        {
          id: 'node-hall',
          role: 'audience',
          screens: [{ ...screen(1920, 1080), nodeId: 'n1', enabled: true }],
        },
        {
          id: 'off-hall',
          role: 'audience',
          screens: [{ ...screen(1920, 1080), nodeId: null, enabled: false }],
        },
        { id: 'hall', role: 'audience', screens: [local(1280, 720)] },
      ]),
    ).toEqual({ groupId: 'hall', canvasWidth: 1280, canvasHeight: 720, scaling: 'fit' });
    // With no such screen anywhere, the first audience group, as before.
    expect(hallPicture([{ id: 'emptied', role: 'audience', screens: [] }])?.groupId).toBe('emptied');
  });

  it('on a node is its own first audience screen’s: the node knows only its own screens', () => {
    const on = (groupId: string, role: 'audience' | 'stage', canvas: ReturnType<typeof screen>) => ({
      groupId,
      role,
      ...canvas,
    });
    expect(
      hallPictureOfScreens([
        on('stage', 'stage', screen(1920, 1080)),
        on('side', 'audience', screen(1280, 720, 'stretch')),
        on('hall', 'audience', screen(1920, 1080)),
      ]),
    ).toEqual({ groupId: 'side', canvasWidth: 1280, canvasHeight: 720, scaling: 'stretch' });
    expect(hallPictureOfScreens([on('stage', 'stage', screen(1920, 1080))])).toBeNull();
    expect(hallPictureOfScreens([])).toBeNull();
  });

  // Session 51 (S4-2): a node with no audience screen drew every layer and language; it draws Main's hall now, the
  // Look's first audience group as Main's own stage screens draw it.
  it('on a node with no audience screen of its own is Main’s, Audience off too; its own comes first', () => {
    const stage = { groupId: 'stage', role: 'stage' as const, ...screen(1920, 1080) };
    const main = {
      groupId: 'hall',
      canvasWidth: 1280,
      canvasHeight: 720,
      scaling: 'fill' as const,
      off: true,
    };
    expect(hallPictureOfScreens([stage], main)).toEqual(main);
    expect(hallPictureOfScreens([], main)).toEqual(main);
    // Main's switch never closes a node's own screens: the node's own audience picture, never said off.
    expect(
      hallPictureOfScreens([stage, { groupId: 'side', role: 'audience', ...screen(1024, 768) }], main),
    ).toEqual({ groupId: 'side', canvasWidth: 1024, canvasHeight: 768, scaling: 'fit' });
    expect(hallPictureOfScreens([stage], null)).toBeNull();
  });

  // Session 51 review: a node's audience screen turned off in Screens shows nothing, so it is not the hall there.
  it('on a node whose only audience screen is turned off is Main’s; its own when Main’s is not known', () => {
    const stage = { groupId: 'stage', role: 'stage' as const, ...screen(1920, 1080), enabled: true };
    const side = { groupId: 'side', role: 'audience' as const, ...screen(1024, 768), enabled: false };
    const main = {
      groupId: 'hall',
      canvasWidth: 1280,
      canvasHeight: 720,
      scaling: 'fill' as const,
      off: true,
    };
    expect(hallPictureOfScreens([stage, side], main)).toEqual(main);
    expect(hallPictureOfScreens([stage, { ...side, enabled: true }], main)).toEqual({
      groupId: 'side',
      canvasWidth: 1024,
      canvasHeight: 768,
      scaling: 'fit',
    });
    // Main's hall not known yet (a node's screens kept from before, Main away): its own group's Look, never every
    // layer and language.
    expect(hallPictureOfScreens([stage, side], null)?.groupId).toBe('side');
  });

  // Session 51 (S4-3): Audience off closes this computer's screens of the hall, and the box keeps its picture and
  // says so, so the performers are not misled. Only a hall shown here is closed by this computer's switch.
  it('is said off while Audience is off and the hall is shown on this computer, and only then', () => {
    const here = (w: number, h: number) => ({ ...screen(w, h), nodeId: null, enabled: true });
    const groups = [
      { id: 'stage', role: 'stage' as const, screens: [here(1920, 1080)] },
      { id: 'hall', role: 'audience' as const, screens: [here(1280, 720)] },
    ];
    const on = { groupId: 'hall', canvasWidth: 1280, canvasHeight: 720, scaling: 'fit' };
    expect(hallPicture(groups)).toEqual(on);
    expect(hallPicture(groups, true)).toEqual(on);
    expect(hallPicture(groups, false)).toEqual({ ...on, off: true });
    // A hall whose screens are all a node's, or all turned off in Screens: this computer's switch closes none.
    const elsewhere = [
      {
        id: 'hall',
        role: 'audience' as const,
        screens: [
          { ...screen(1920, 1080), nodeId: 'n1', enabled: true },
          { ...screen(1920, 1080), nodeId: null, enabled: false },
        ],
      },
    ];
    expect(hallPicture(elsewhere, false)).toEqual({
      groupId: 'hall',
      canvasWidth: 1920,
      canvasHeight: 1080,
      scaling: 'fit',
    });
    expect(hallPicture([{ id: 'emptied', role: 'audience', screens: [] }], false)).not.toHaveProperty('off');
    expect(hallPicture([], false)).toBeNull();
  });

  it('is read from another computer or a page only whole and in bounds', () => {
    const on = { groupId: 'hall', canvasWidth: 1280, canvasHeight: 720, scaling: 'fill' };
    const hall = { ...on, off: true };
    expect(hallPictureSchema.parse(hall)).toEqual(hall);
    expect(hallPictureSchema.parse(on)).toEqual(on);
    for (const bad of [
      { ...hall, groupId: '' },
      { ...hall, canvasWidth: 0 },
      { ...hall, canvasHeight: 1.5 },
      { ...hall, scaling: 'placeholder' },
      { ...hall, off: 'yes' },
      null,
      'hall',
    ])
      expect(hallPictureSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

// Session 54 (Part A2): every box's own fill, weight, outline, shadow and place up and down; a timer box's format,
// warning, colour when over and flash; a clock box's hours and seconds. All left out of a layout saved before.
describe('a box’s own settings', () => {
  /** A box as Session 53's editor made it: none of the settings since. */
  const before: StageBox = {
    id: 'placeholder-clock',
    kind: 'clock',
    frame: { x: 1162, y: 186, width: 710, height: 130 },
    size: 'fit',
    color: '#ffffff',
    align: 'right',
    label: '',
  };

  it('are none in a layout saved before, which reads exactly as it was', () => {
    const def = {
      background: '#000000',
      boxes: [before, { ...before, id: 'timer', kind: 'timer', timerId: null }],
    };
    expect(stageLayoutDefinitionSchema.parse(JSON.parse(JSON.stringify(def)))).toEqual(def);
  });

  it('are kept in a stored layout', () => {
    const timer: StageBox = {
      ...before,
      id: 'placeholder-timer',
      kind: 'timer',
      timerId: 'placeholder-countdown',
      valign: 'middle',
      fitWhole: true,
      bold: true,
      fill: { color: '#000000', seeThrough: 0.4 },
      outline: { color: '#101010', width: 3 },
      shadow: true,
      format: 'hmmss',
      warn: { color: '#f5a524', fromMs: 60_000 },
      overColor: '#ef4444',
      flash: true,
    };
    const clock: StageBox = { ...before, hours: 24, seconds: true, valign: 'bottom' };
    const def = { background: '#000000', boxes: [timer, clock] };
    expect(stageLayoutDefinitionSchema.parse(JSON.parse(JSON.stringify(def)))).toEqual(def);
  });

  it('are refused when they cannot be drawn', () => {
    for (const bad of [
      { valign: 'centre' },
      { fitWhole: 'yes' },
      { fill: { color: 'black', seeThrough: 0.5 } },
      { fill: { color: '#000000', seeThrough: 1.5 } },
      { outline: { color: '#000000', width: 0 } },
      { outline: { color: '#000000', width: 500 } },
      { format: 'seconds' },
      { warn: { color: '#f5a524', fromMs: -1 } },
      { overColor: 'red' },
      { flash: 1 },
      { hours: 13 },
      { seconds: 'on' },
    ])
      expect(stageBoxSchema.safeParse({ ...before, ...bad }).success, JSON.stringify(bad)).toBe(false);
  });

  it('make a new box’s words as large as its box holds when they fit; one saved before keeps to 400 px', () => {
    for (const kind of STAGE_BOX_KINDS.filter((k) => k !== 'audience'))
      expect(newStageBox(kind, kind).fitWhole, kind).toBe(true);
    expect(newStageBox('audience', 'hall')).not.toHaveProperty('fitWhole');
    expect(before).not.toHaveProperty('fitWhole');
  });

  it('put a box in front of the others or behind them, all the way or one step (bottom to top)', () => {
    const boxes = ['a', 'b', 'c', 'd'].map((id) => ({ ...before, id }));
    const order = (how: Parameters<typeof arrangeBoxes>[2], id: string) =>
      arrangeBoxes(boxes, id, how)
        .map((b) => b.id)
        .join('');
    expect(order('front', 'b')).toBe('acdb');
    expect(order('back', 'c')).toBe('cabd');
    expect(order('forward', 'b')).toBe('acbd');
    expect(order('backward', 'c')).toBe('acbd');
    // Already there: as it was.
    expect(order('front', 'd')).toBe('abcd');
    expect(order('forward', 'd')).toBe('abcd');
    expect(order('back', 'a')).toBe('abcd');
    expect(order('backward', 'a')).toBe('abcd');
    expect(order('front', 'placeholder-none')).toBe('abcd');
  });
});
