import { describe, expect, it } from 'vitest';
import type { ScreenRole } from '../../shared/screens';
import { followOutputs, type WarmUpWindow, WarmUpChoices, warmUpFact, warmsUp } from './warm-up-choice';

/*
 * No warm-up where Chromium draws without a graphics chip (Session 57: the owner's Q57-17 A, Session 55's Q-P1). An
 * output warms up exactly as before with a chip, while Chromium has not yet said how it draws, and where its status
 * cannot be read; without a chip it draws the show without one, and the log says which, once for each output.
 */

/** Every gpu_compositing value Chromium gives (chrome://gpu's Graphics Feature Status), by what it says. */
const WITH_A_CHIP = ['enabled', 'enabled_on', 'enabled_force', 'enabled_force_on', 'enabled_readback'];
const WITHOUT_A_CHIP = [
  'disabled_software',
  'disabled_off',
  'disabled_off_ok',
  'unavailable_software',
  'unavailable_off',
  'unavailable_off_ok',
];

/** A feature status as Electron gives one, its other features as CI's Windows has them (h-help7's round 2). */
function status(compositing: unknown): Record<string, unknown> {
  return {
    '2d_canvas': 'unavailable_software',
    gpu_compositing: compositing,
    rasterization: 'disabled_software',
    webgl: 'unavailable_software',
  };
}

describe('whether an output warms up, by Chromium’s gpu_compositing (the decision)', () => {
  it('every enabled value warms up exactly as before', () => {
    for (const value of WITH_A_CHIP) expect(warmsUp(status(value)), value).toBe(true);
  });

  it('no disabled or unavailable value does', () => {
    for (const value of WITHOUT_A_CHIP) expect(warmsUp(status(value)), value).toBe(false);
  });

  it('a status it cannot read warms up, the safe side', () => {
    const throws = Object.defineProperty({}, 'gpu_compositing', {
      get: () => {
        throw new Error('no status');
      },
    });
    const unreadable: [string, unknown][] = [
      ['nothing', undefined],
      ['null', null],
      ['a word, not a status', 'disabled_software'],
      ['a number', 0],
      ['a list', []],
      ['no features', {}],
      ['a status that throws', throws],
      ['no gpu_compositing', status(undefined)],
      ['gpu_compositing null', status(null)],
      ['gpu_compositing a number', status(0)],
      ['gpu_compositing empty', status('')],
      ['a value Chromium has not given', status('software')],
      ['a word that only begins the same', status('disabledness')],
    ];
    for (const [what, value] of unreadable) expect(warmsUp(value), what).toBe(true);
  });
});

/** Main's choices over fake output windows: what its log said, and which outputs were sent their context again. */
function main(compositing: () => unknown) {
  const lines: string[] = [];
  const sent: string[] = [];
  const choices = new WarmUpChoices({
    status: () => status(compositing()),
    log: (line) => {
      lines.push(line);
    },
  });
  const windows = new Map<string, WarmUpWindow>();
  const names = new Map<string, string>();
  /** Screens whose sending fails (a page going as Drashti quits). */
  const failing = new Set<string>();
  /** An output window, open, or gone (the window, or only its page: as Drashti quits, the page goes first). */
  const open = (screenId: string, id: number, name: string, gone: 'window' | 'page' | null = null) => {
    windows.set(screenId, {
      isDestroyed: () => gone === 'window',
      webContents: { id, isDestroyed: () => gone !== null },
    });
    names.set(screenId, `output "${name}"`);
  };
  /** What its context says (Main's contextFor). */
  const fact = (screenId: string, role?: ScreenRole) =>
    warmUpFact(choices, windows.get(screenId), names.get(screenId) ?? '', role);
  followOutputs(choices, windows, names, (screenId) => {
    if (failing.has(screenId)) throw new Error('Object has been destroyed');
    sent.push(screenId);
  });
  return { choices, lines, sent, open, fact, failing };
}

const skipped = (compositing: string, name: string) =>
  `Warm-up: skipped, no graphics chip (gpu_compositing ${compositing}), for output "${name}"`;
const asBefore = (compositing: string, name: string) =>
  `Warm-up: as before, a graphics chip (gpu_compositing ${compositing}), for output "${name}"`;

describe('Main’s choice for each output window', () => {
  it.each([
    { feature: 'enabled', context: {} },
    { feature: 'disabled_software', context: { noGpu: true } },
  ])('logs none (stage) for a stage output with $feature compositing', ({ feature, context }) => {
    const m = main(() => feature);
    m.choices.gpuSaid();
    m.open('stage', 7, 'Stage');
    expect(m.fact('stage', 'stage')).toEqual(context);
    expect(m.fact('stage', 'stage')).toEqual(context);
    expect(m.lines).toEqual(['Warm-up: none (stage), for output "Stage"']);
    expect(m.sent).toEqual([]);
  });

  it('until Chromium has said how it draws, every output warms up: its status says disabled then, chip or not', () => {
    // Measured 12 Nov 2026 on a Mac with a graphics chip: disabled_software until the first gpu-info-update.
    const m = main(() => 'disabled_software');
    m.open('hall', 7, 'Hall');
    expect(m.fact('hall')).toEqual({});
    expect(m.lines).toEqual([]);
    expect(m.sent).toEqual([]);
  });

  it('without a graphics chip an output skips its warm-up from its first context, said once', () => {
    const m = main(() => 'disabled_software');
    m.choices.gpuSaid();
    m.open('hall', 7, 'Hall');
    expect(m.fact('hall')).toEqual({ noGpu: true });
    expect(m.fact('hall')).toEqual({ noGpu: true });
    m.choices.gpuSaid();
    expect(m.lines).toEqual([skipped('disabled_software', 'Hall')]);
    // Opened after Chromium said: its context says so from the first, nothing sent again.
    expect(m.sent).toEqual([]);
  });

  it('with a graphics chip every output warms up exactly as before, said once for each, and none is sent anything', () => {
    const m = main(() => 'enabled');
    m.open('hall', 7, 'Hall');
    m.open('stage', 8, 'Stage');
    m.choices.gpuSaid();
    m.choices.gpuSaid();
    expect(m.fact('hall')).toEqual({});
    expect(m.fact('stage')).toEqual({});
    expect(m.lines).toEqual([asBefore('enabled', 'Hall'), asBefore('enabled', 'Stage')]);
    expect(m.sent).toEqual([]);
  });

  it('an output open before Chromium said is sent its context again once it skips its warm-up, only once', () => {
    const m = main(() => 'unavailable_software');
    m.open('hall', 7, 'Hall');
    m.open('stage', 8, 'Stage');
    // As it opened: a warm-up.
    expect(m.fact('hall')).toEqual({});
    m.choices.gpuSaid();
    expect(m.sent).toEqual(['hall', 'stage']);
    expect(m.fact('hall')).toEqual({ noGpu: true });
    m.choices.gpuSaid();
    expect(m.sent).toEqual(['hall', 'stage']);
    expect(m.lines).toEqual([
      skipped('unavailable_software', 'Hall'),
      skipped('unavailable_software', 'Stage'),
    ]);
  });

  it('Chromium leaving its chip later skips from then, said once more; an output told to skip is never told to warm up', () => {
    let now = 'enabled';
    const m = main(() => now);
    m.open('hall', 7, 'Hall');
    m.choices.gpuSaid();
    expect(m.fact('hall')).toEqual({});
    // Its GPU process stopped too often: Chromium draws in software from then.
    now = 'disabled_software';
    m.choices.gpuSaid();
    expect(m.sent).toEqual(['hall']);
    expect(m.fact('hall')).toEqual({ noGpu: true });
    now = 'enabled';
    m.choices.gpuSaid();
    expect(m.fact('hall')).toEqual({ noGpu: true });
    expect(m.sent).toEqual(['hall']);
    expect(m.lines).toEqual([asBefore('enabled', 'Hall'), skipped('disabled_software', 'Hall')]);
  });

  it('once Chromium has said, a status it cannot read warms up as before, and the log says why', () => {
    const lines: string[] = [];
    const choices = new WarmUpChoices({
      status: () => {
        throw new Error('no status');
      },
      log: (line) => {
        lines.push(line);
      },
    });
    choices.gpuSaid();
    expect(choices.skips(7, 'output "Hall"')).toBe(false);
    expect(choices.skips(7, 'output "Hall"')).toBe(false);
    expect(lines).toEqual([
      'Warm-up: as before, the graphics status unclear (gpu_compositing unreadable), for output "Hall"',
    ]);
  });

  it('a closed output, or one whose page has gone, is neither asked nor sent anything; a window forgotten is decided afresh', () => {
    let now = 'disabled_software';
    const m = main(() => now);
    m.open('hall', 7, 'Hall', 'window');
    m.open('foyer', 9, 'Foyer', 'page');
    m.choices.gpuSaid();
    expect(m.sent).toEqual([]);
    expect(m.fact('hall')).toEqual({});
    expect(m.fact('foyer')).toEqual({});
    expect(m.lines).toEqual([]);
    m.open('stage', 8, 'Stage');
    expect(m.fact('stage')).toEqual({ noGpu: true });
    m.choices.forget(8);
    now = 'enabled';
    expect(m.fact('stage')).toEqual({});
    expect(m.lines).toEqual([skipped('disabled_software', 'Stage'), asBefore('enabled', 'Stage')]);
  });

  it('an output whose context cannot be sent again does not keep the others from theirs, and the log says so', () => {
    const m = main(() => 'disabled_software');
    m.open('hall', 7, 'Hall');
    m.open('stage', 8, 'Stage');
    m.failing.add('hall');
    m.choices.gpuSaid();
    expect(m.sent).toEqual(['stage']);
    expect(m.lines).toEqual([
      skipped('disabled_software', 'Hall'),
      'Warm-up: its context not sent again (Object has been destroyed), for output "Hall"',
      skipped('disabled_software', 'Stage'),
    ]);
  });
});
