import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState } from '../../shared/engine/state';
import type { ScreenSwitch, ScreenSwitches } from '../../shared/screen-switches';
import type { ScreenGroupConfig, ScreenState, ScreensSnapshot } from '../../shared/screens';
import { ONLY_ON_IN_SIMPLE_MODE, ScreenSwitchService } from './screen-switches';

/*
 * Audience and Stage in the main process (Session 50): every request checked, Simple Mode only turning them on,
 * and the View menu asking first while the screens show something. The output windows are stood in for by a
 * set of switches turned off; placeholder screens only.
 */

function setUp(options: { simple?: boolean; open?: Partial<Record<ScreenSwitch, ScreenState>> } = {}) {
  const off = new Set<ScreenSwitch>();
  const changes: ScreenSwitches[] = [];
  const logged: string[] = [];
  const t = {
    simple: options.simple ?? false,
    state: initialEngineState() as EngineState,
    hall: options.open?.audience ?? ('showing' as ScreenState),
    stage: options.open?.stage ?? ('showing' as ScreenState),
  };
  const groups: ScreenGroupConfig[] = [
    {
      id: 'hall',
      name: 'Main Hall',
      role: 'audience',
      screens: [
        {
          id: 'hall-1',
          groupId: 'hall',
          name: 'Hall',
          displayKey: null,
          canvasWidth: 1920,
          canvasHeight: 1080,
          scaling: 'fit',
          enabled: true,
          feed: null,
          nodeId: null,
        },
      ],
    },
    {
      id: 'stage',
      name: 'Stage',
      role: 'stage',
      screens: [
        {
          id: 'stage-1',
          groupId: 'stage',
          name: 'Stage',
          displayKey: null,
          canvasWidth: 1920,
          canvasHeight: 1080,
          scaling: 'fit',
          enabled: true,
          feed: null,
          nodeId: null,
        },
      ],
    },
  ];
  const service = new ScreenSwitchService({
    outputs: {
      switches: () => ({ audience: !off.has('audience'), stage: !off.has('stage') }),
      setSwitch: (which, on) => {
        if (off.has(which) === !on) return false;
        if (on) off.delete(which);
        else off.add(which);
        return true;
      },
    },
    simple: () => t.simple,
    screens: (): Pick<ScreensSnapshot, 'groups' | 'status'> => ({
      groups,
      status: [
        { screenId: 'hall-1', state: off.has('audience') ? 'switched-off' : t.hall, displayId: 2 },
        { screenId: 'stage-1', state: off.has('stage') ? 'switched-off' : t.stage, displayId: 3 },
      ],
    }),
    state: () => t.state,
    log: (message) => logged.push(message),
  });
  service.onChanged((switches) => changes.push(switches));
  return { service, off, changes, logged, t };
}

/** The View menu's question, answered as the test says, and what it was asked about. */
function answering(answer: boolean) {
  const asked: ScreenSwitch[] = [];
  return {
    asked,
    ask: (which: ScreenSwitch) => {
      asked.push(which);
      return Promise.resolve(answer);
    },
  };
}

describe('Audience and Stage in the main process (Session 50)', () => {
  it('turns one off and on, telling the listeners once for each change, and the log', () => {
    const { service, changes, logged } = setUp();
    expect(service.get()).toEqual({ audience: true, stage: true });
    expect(service.turn('audience', false)).toEqual({ ok: true, switches: { audience: false, stage: true } });
    // Off again: nothing changes, nobody is told again.
    expect(service.turn('audience', false)).toEqual({ ok: true, switches: { audience: false, stage: true } });
    expect(service.turn('stage', false)).toEqual({ ok: true, switches: { audience: false, stage: false } });
    expect(service.turn('audience', true)).toEqual({ ok: true, switches: { audience: true, stage: false } });
    expect(changes).toEqual([
      { audience: false, stage: true },
      { audience: false, stage: false },
      { audience: true, stage: false },
    ]);
    expect(logged).toHaveLength(3);
    expect(logged[0]).toContain('Audience turned off');
    expect(logged[2]).toContain('Audience turned on');
  });

  it('refuses anything that is not Audience or Stage, on or off', () => {
    const { service, changes } = setUp();
    for (const [which, on] of [
      ['hall', false],
      ['stream', false],
      ['audience', 'off'],
      [null, true],
      ['stage', 0],
    ] as const)
      expect(service.turn(which, on)).toMatchObject({ ok: false });
    expect(changes).toEqual([]);
  });

  it('lets Simple Mode turn them on, never off', () => {
    const { service, t, changes } = setUp();
    service.turn('stage', false);
    t.simple = true;
    expect(service.turn('audience', false)).toEqual({ ok: false, message: ONLY_ON_IN_SIMPLE_MODE });
    expect(service.turn('stage', true)).toEqual({ ok: true, switches: { audience: true, stage: true } });
    expect(changes).toHaveLength(2);
  });

  it('the View menu asks first while the hall’s screens show something: Cancel leaves them on', async () => {
    const { service, t } = setUp();
    t.state = { ...t.state, blackout: true };
    const no = answering(false);
    await service.toggle('audience', no.ask);
    expect(no.asked).toEqual(['audience']);
    expect(service.get().audience).toBe(true);
    const yes = answering(true);
    await service.toggle('audience', yes.ask);
    expect(service.get().audience).toBe(false);
    // On again: never asked.
    const never = answering(false);
    await service.toggle('audience', never.ask);
    expect(never.asked).toEqual([]);
    expect(service.get().audience).toBe(true);
  });

  it('turns off without asking while the hall’s screens show nothing, or none is open; Stage asks while one is open', async () => {
    const { service } = setUp();
    const never = answering(false);
    // Nothing up on the hall's screens.
    await service.toggle('audience', never.ask);
    expect(service.get().audience).toBe(false);
    expect(never.asked).toEqual([]);
    expect(service.asksFirst('stage')).toBe(true);
    const closed = setUp({ open: { stage: 'missing-display' } });
    expect(closed.service.asksFirst('stage')).toBe(false);
    await closed.service.toggle('stage', never.ask);
    expect(closed.service.get().stage).toBe(false);
    expect(never.asked).toEqual([]);
  });

  it('asks one question at a time: chosen again while it asks, the menu does nothing', async () => {
    const { service } = setUp();
    let answer: (yes: boolean) => void = () => undefined;
    const asked: ScreenSwitch[] = [];
    const slow = (which: ScreenSwitch) => {
      asked.push(which);
      return new Promise<boolean>((resolve) => (answer = resolve));
    };
    const first = service.toggle('stage', slow);
    await service.toggle('stage', slow);
    await service.toggle('audience', slow);
    expect(asked).toEqual(['stage']);
    answer(true);
    await first;
    expect(service.get()).toEqual({ audience: true, stage: false });
  });

  it('never asks or turns them off in Simple Mode from the menu, which only turns them on there', async () => {
    const { service, t } = setUp();
    t.simple = true;
    const yes = answering(true);
    await service.toggle('stage', yes.ask);
    expect(yes.asked).toEqual([]);
    expect(service.get().stage).toBe(true);
  });
});
