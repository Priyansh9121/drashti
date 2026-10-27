import { describe, expect, it } from 'vitest';
import { STOPPED_REFUSAL } from '../../shared/access';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import type { InvokeChannel } from '../../shared/ipc';
import { SIMPLE_MODE_REFUSAL } from '../../shared/mode';
import { DEVICE_OPS, type DeviceOp } from '../../shared/network-api';
import { ASKED_AT_COMPUTER, COMPUTER_BUSY, SWITCH_ASKS_FIRST } from '../../shared/network-desktop';
import type { ScreenSwitch, ScreenSwitches } from '../../shared/screen-switches';
import type {
  CoverOptions,
  DisplayInfo,
  ScreenConfig,
  ScreenGroupConfig,
  ScreensResult,
  ScreenStatus,
} from '../../shared/screens';
import { openDatabase } from '../db/database';
import { DeviceRepo } from '../db/devices';
import { ONLY_ON_IN_SIMPLE_MODE } from '../outputs/screen-switches';
import { SIMPLE_MODE_LOCKED } from '../simple-mode';
import { opensOverControls } from './desktop-answers';
import { NetworkService, OP_CHANNEL } from './network-service';

/*
 * The phone as a full Drashti (Session 54, the owner's item 3): a Remote sets up the computer's own screens as
 * Screens does, answers Keep these screens?, and turns Audience and Stage, each through the very functions the
 * window's requests call (a stand-in here, which records what it was asked). Never a Stage or Announcements
 * device, nothing while Drashti is not let in, Simple Mode refusing on a phone what it refuses in the window, the
 * window's questions answered on the phone, and never the operator's consent to cover the controls from a phone:
 * only the computer's own box gives that. Placeholder names, made-up ids.
 */

const PHONE = '192.168.1.20';

const display = (id: number, label: string, primary: boolean): DisplayInfo => ({
  id,
  label,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  pixelWidth: 1920,
  pixelHeight: 1080,
  refreshHz: 60,
  rotation: 0,
  internal: primary,
  primary,
  key: { id, label, pixelWidth: 1920, pixelHeight: 1080, x: 0, y: 0, internal: primary },
});

/** The controls' display (1) and the projector (2). */
const DISPLAYS = [
  display(1, 'Placeholder built-in display', true),
  display(2, 'Placeholder projector', false),
];

/** The projector's screen, in the hall's group. */
const PROJECTOR: ScreenConfig = {
  id: 's-1',
  groupId: 'g-hall',
  name: 'Placeholder projector',
  displayKey: display(2, 'Placeholder projector', false).key,
  canvasWidth: 1920,
  canvasHeight: 1080,
  scaling: 'fit',
  enabled: true,
  feed: null,
  nodeId: null,
};
const HALL: ScreenGroupConfig = {
  id: 'g-hall',
  name: 'Placeholder Hall',
  role: 'audience',
  screens: [PROJECTOR],
};
const GROUPS: ScreenGroupConfig[] = [HALL, { id: 'g-stream', name: 'YouTube', role: 'stream', screens: [] }];

interface Call {
  what: string;
  args: unknown[];
}

function setup(options: { locked?: boolean; letIn?: boolean } = {}) {
  const db = openDatabase(':memory:');
  const devices = new DeviceRepo(db);
  const calls: Call[] = [];
  const boxes: { question: { who: string; what: string }; answer: (yes: boolean) => void }[] = [];
  const hints: string[] = [];
  let letIn = options.letIn ?? true;
  // A second passes with each request (a phone tapping), unless held still.
  let clock = 1_000_000;
  let ticking = true;
  let locked = options.locked === true;
  let switches: ScreenSwitches = { audience: true, stage: true };
  let status: ScreenStatus[] = [{ screenId: 's-1', state: 'showing', displayId: 2 }];
  const asks: Record<ScreenSwitch, boolean> = { audience: true, stage: false };
  const state = initialEngineState();
  const snapshot = () => ({ displays: DISPLAYS, groups: GROUPS, status, nodes: [] });
  const done = (): ScreensResult => ({ ok: true, snapshot: snapshot() });
  /** As ScreensService answers: an output on the controls' display (1) waits for the operator's consent. */
  const coverCheck = (displayId: unknown, options?: CoverOptions): ScreensResult =>
    displayId === 1 && options?.coverOperator !== true
      ? { ok: false, confirm: 'covers-operator', message: 'The Drashti controls are on this display.' }
      : done();
  const record =
    (what: string, answer: (...args: unknown[]) => ScreensResult = () => done()) =>
    (...args: unknown[]) => {
      calls.push({ what, args });
      return answer(...args);
    };
  const service = new NetworkService({
    devices,
    settings: { get: () => undefined, set: () => undefined },
    spawn: () => {
      throw new Error('no worker in these tests');
    },
    serverOptions: (port) => ({
      port,
      bind: '127.0.0.1',
      webDir: '',
      ffmpeg: null,
      previewDir: '',
      localName: null,
    }),
    localName: () => null,
    engine: {
      dispatch: () => ({ ok: true, changed: true, rev: 1 }),
      snapshot: () => ({ kind: 'snapshot', version: ENGINE_STATE_VERSION, rev: 0, state, sentAt: 0 }),
      state: () => state,
    },
    reads: {
      playlists: () => [],
      items: () => [],
      presentation: () => null,
      library: () => ({ total: 0, presentations: [] }),
      search: (query) => ({ query, hits: [], more: false, legacyCount: 0 }),
      messages: () => [],
      logo: () => null,
      mediaSource: () => null,
      sharedSound: () => null,
      stage: () => ({ groupId: null, languages: null }),
      hallGroups: () => [],
      hall: () => ({ groupId: null }),
      switches: () => switches,
      looks: () => [],
      clockStyle: () => ({ locale: 'en-GB', timeZone: 'Europe/London' }),
      shastraTexts: () => [],
      passage: () => ({ ok: false, message: 'No texts.' }),
    },
    mirror: {
      props: () => [],
      prop: () => null,
      media: () => [],
      lowerThirds: () => [],
      music: () => [],
      keys: () => ({ platform: 'darwin', singleKeys: true }),
      repeatStep: () => null,
    },
    desktop: {
      screens: {
        snapshot,
        controlsDisplayId: () => 1,
        createGroup: record('createGroup'),
        renameGroup: record('renameGroup'),
        setGroupRole: record('setGroupRole'),
        deleteGroup: record('deleteGroup'),
        assignDisplay: record('assignDisplay', (_g, displayId, options) =>
          coverCheck(displayId, options as CoverOptions | undefined),
        ),
        updateScreen: record('updateScreen', (_id, patch, options) =>
          (patch as { enabled?: boolean }).enabled === true
            ? coverCheck(1, options as CoverOptions | undefined)
            : done(),
        ),
        removeScreen: record('removeScreen'),
        identify: () => {
          calls.push({ what: 'identify', args: [] });
        },
        pending: () => ({ deadline: 1_015_000, coversControls: false }),
        keep: record('keep'),
        goBack: record('goBack'),
      },
      switches: {
        get: () => switches,
        asksFirst: (which) => asks[which],
        turn: (which, on) => {
          calls.push({ what: 'turn', args: [which, on] });
          if (!on && locked) return { ok: false, message: ONLY_ON_IN_SIMPLE_MODE };
          switches = { ...switches, [which]: on };
          return { ok: true, switches };
        },
      },
      simple: () => locked,
      confirmCover: (question) =>
        new Promise<boolean>((resolve) => {
          boxes.push({ question, answer: resolve });
        }),
    },
    playMusic: () => ({ ok: true as const }),
    announcements: {
      submit: () => ({ status: 202, body: { ok: true } }),
      statusFor: () => ({ status: 404, body: { ok: false } }),
    },
    refused: (channel: InvokeChannel) => locked && SIMPLE_MODE_LOCKED.includes(channel),
    changed: () => undefined,
    log: () => undefined,
    now: () => clock,
    letIn: () => letIn,
  });
  // The hints the phones are sent go to the worker: here, kept.
  Object.assign(service, {
    hint: (what: string) => {
      hints.push(what);
    },
  });
  const remote = service.pairForCheck('remote', 'Placeholder phone').id;
  const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
  const poster = service.pairForCheck('announcements', 'Placeholder poster').id;
  const ask = (deviceId: string, op: DeviceOp, args: Record<string, unknown> = {}) => {
    if (ticking) clock += 1000;
    return service.answer({ address: PHONE, deviceId, op, args });
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    ask,
    remote,
    stage,
    poster,
    calls,
    boxes,
    hints,
    devices,
    settle,
    later: (ms: number) => {
      clock += ms;
    },
    hold: () => {
      ticking = false;
    },
    setLocked: (on: boolean) => {
      locked = on;
    },
    setLetIn: (on: boolean) => {
      letIn = on;
    },
    setSwitches: (s: ScreenSwitches) => {
      switches = s;
    },
    setStatus: (s: ScreenStatus[]) => {
      status = s;
    },
  };
}

/** Every op of this item, with arguments it takes. */
const OPS: [DeviceOp, Record<string, unknown>][] = [
  ['screens', {}],
  ['screens.addGroup', { name: 'Placeholder Stage' }],
  ['screens.renameGroup', { groupId: 'g-hall', name: 'Placeholder Main Hall' }],
  ['screens.groupRole', { groupId: 'g-hall', role: 'stage' }],
  ['screens.deleteGroup', { groupId: 'g-hall' }],
  ['screens.useDisplay', { groupId: 'g-hall', displayId: 2 }],
  ['screens.change', { screenId: 's-1', patch: { name: 'Placeholder left projector' } }],
  ['screens.remove', { screenId: 's-1' }],
  ['screens.keep', {}],
  ['screens.goBack', {}],
  ['screens.identify', {}],
  ['switch', { which: 'stage', on: false }],
];

describe('the phone as a full Drashti: the computer’s screens and Audience and Stage (Session 54)', () => {
  it('lets a Remote alone do them, and none at all while Drashti is not let in', () => {
    const t = setup();
    for (const [op] of OPS) expect(DEVICE_OPS[op], op).toEqual(['remote']);
    for (const [op, args] of OPS) {
      expect(t.ask(t.stage, op, args).status, op).toBe(403);
      expect(t.ask(t.poster, op, args).status, op).toBe(403);
    }
    expect(t.calls).toEqual([]);
    t.setLetIn(false);
    for (const [op, args] of OPS)
      expect(t.ask(t.remote, op, args), op).toEqual({
        status: 503,
        body: { ok: false, message: STOPPED_REFUSAL },
      });
    expect(t.calls).toEqual([]);
  });

  it('does each as the window’s own request does, and gives the phone the screens as they are then', () => {
    const t = setup();
    for (const [op, args] of OPS) expect(t.ask(t.remote, op, args).status, op).toBe(200);
    expect(t.calls).toEqual([
      { what: 'createGroup', args: ['Placeholder Stage'] },
      { what: 'renameGroup', args: ['g-hall', 'Placeholder Main Hall'] },
      { what: 'setGroupRole', args: ['g-hall', 'stage'] },
      { what: 'deleteGroup', args: ['g-hall'] },
      // Never with a consent to cover the controls.
      { what: 'assignDisplay', args: ['g-hall', 2] },
      { what: 'updateScreen', args: ['s-1', { name: 'Placeholder left projector' }] },
      { what: 'removeScreen', args: ['s-1'] },
      { what: 'keep', args: [] },
      { what: 'goBack', args: [] },
      { what: 'identify', args: [] },
      { what: 'turn', args: ['stage', false] },
    ]);
    // The displays as the computer sees them, the controls' display said, and the stream's group left out.
    expect(t.ask(t.remote, 'screens').body).toEqual({
      ok: true,
      screens: {
        displays: DISPLAYS,
        controlsDisplayId: 1,
        groups: [HALL],
        status: [{ screenId: 's-1', state: 'showing', displayId: 2 }],
        nodes: [],
        switches: { audience: true, stage: false },
        asksFirst: { audience: true, stage: false },
        pending: { deadline: 1_015_000, coversControls: false },
        asked: null,
      },
    });
  });

  it('refuses in Simple Mode just what the window refuses: the setup’s changes, never Keep, Go back or a screen turned on', () => {
    const t = setup({ locked: true });
    for (const [op, args] of OPS) {
      const channel = OP_CHANNEL[op];
      const answer = t.ask(t.remote, op, args);
      if (channel !== null && SIMPLE_MODE_LOCKED.includes(channel))
        expect(answer, op).toEqual({ status: 403, body: { ok: false, message: SIMPLE_MODE_REFUSAL } });
      else if (op !== 'switch') expect(answer.status, op).toBe(200);
    }
    // The setup's changes are each refused; reading, Keep, Go back and Identify are not.
    const refused = OPS.filter(([op]) => {
      const channel = OP_CHANNEL[op];
      return channel !== null && SIMPLE_MODE_LOCKED.includes(channel);
    }).map(([op]) => op);
    expect(refused).toEqual([
      'screens.addGroup',
      'screens.renameGroup',
      'screens.groupRole',
      'screens.deleteGroup',
      'screens.useDisplay',
      'screens.change',
      'screens.remove',
    ]);
    expect(t.calls.map((c) => c.what)).toEqual(['keep', 'goBack', 'identify']);
    // Simple Mode only turns the screens on, as in the window: Off is refused before any question.
    expect(t.ask(t.remote, 'switch', { which: 'audience', on: false })).toEqual({
      status: 403,
      body: { ok: false, message: ONLY_ON_IN_SIMPLE_MODE },
    });
    t.setSwitches({ audience: false, stage: true });
    expect(t.ask(t.remote, 'switch', { which: 'audience', on: true }).status).toBe(200);
    expect(t.calls.at(-1)).toEqual({ what: 'turn', args: ['audience', true] });
  });

  it('asks the window’s question on the phone before a switch goes off, as the window does while its screens show something', () => {
    const t = setup();
    expect(t.ask(t.remote, 'switch', { which: 'audience', on: false })).toEqual({
      status: 409,
      body: { ok: false, confirm: 'switch-off', message: SWITCH_ASKS_FIRST },
    });
    expect(t.calls).toEqual([]);
    expect(t.ask(t.remote, 'switch', { which: 'audience', on: false, confirmed: true }).body).toMatchObject({
      ok: true,
      switches: { audience: false, stage: true },
    });
    // Stage shows nothing here: it goes off at once, as in the window.
    expect(t.ask(t.remote, 'switch', { which: 'stage', on: false }).status).toBe(200);
    expect(t.calls.map((c) => c.args)).toEqual([
      ['audience', false],
      ['stage', false],
    ]);
  });

  it('never takes a phone’s word for the operator’s consent to cover the controls', () => {
    const t = setup();
    // Each request carries what it changes, and nothing else: the window's consent is refused outright.
    expect(
      t.ask(t.remote, 'screens.useDisplay', { groupId: 'g-hall', displayId: 1, coverOperator: true }).status,
    ).toBe(400);
    expect(
      t.ask(t.remote, 'screens.change', { screenId: 's-1', patch: { enabled: true, coverOperator: true } })
        .status,
    ).toBe(400);
    expect(
      t.ask(t.remote, 'screens.addGroup', { name: 'Placeholder', options: { coverOperator: true } }).status,
    ).toBe(400);
    expect(t.ask(t.remote, 'switch', { which: 'audience', on: false, confirmed: 'yes' }).status).toBe(400);
    expect(t.calls).toEqual([]);
    expect(t.boxes).toEqual([]);
  });

  it('asks the computer itself before an output a phone puts on the controls’ display, and changes it only on its yes', async () => {
    const t = setup();
    const asked = t.ask(t.remote, 'screens.useDisplay', { groupId: 'g-hall', displayId: 1 });
    expect(asked).toMatchObject({
      status: 202,
      body: { ok: true, asked: true, message: ASKED_AT_COMPUTER, screens: { asked: { state: 'waiting' } } },
    });
    expect(t.boxes.map((b) => b.question)).toEqual([
      {
        who: 'Remote “Placeholder phone”',
        what: 'to put “Placeholder Hall” on Placeholder built-in display · 1920 × 1080 · 60 Hz',
      },
    ]);
    // Asked once, without the consent: nothing changed yet.
    expect(t.calls).toEqual([{ what: 'assignDisplay', args: ['g-hall', 1] }]);
    // One question at a time.
    expect(t.ask(t.remote, 'screens.change', { screenId: 's-1', patch: { enabled: true } })).toEqual({
      status: 409,
      body: { ok: false, message: COMPUTER_BUSY },
    });
    t.boxes[0]?.answer(true);
    await t.settle();
    expect(t.calls.at(-1)).toEqual({ what: 'assignDisplay', args: ['g-hall', 1, { coverOperator: true }] });
    expect((t.ask(t.remote, 'screens').body as { screens: { asked: unknown } }).screens.asked).toEqual({
      state: 'agreed',
      message: 'The Drashti computer agreed.',
    });
    // The phones were told as it was asked and as it was answered.
    expect(t.hints).toEqual(['setup', 'setup']);
  });

  it('changes nothing when the computer says no, or once that phone may no longer change the screens', async () => {
    const t = setup();
    t.ask(t.remote, 'screens.change', { screenId: 's-1', patch: { enabled: true } });
    t.boxes[0]?.answer(false);
    await t.settle();
    expect(t.calls).toEqual([{ what: 'updateScreen', args: ['s-1', { enabled: true }] }]);
    // Told no, it waits a moment before asking again.
    t.later(15_000);
    // Simple Mode came on while the box was up: the yes changes nothing.
    t.ask(t.remote, 'screens.useDisplay', { groupId: 'g-hall', displayId: 1 });
    t.setLocked(true);
    t.boxes[1]?.answer(true);
    await t.settle();
    t.setLocked(false);
    // Drashti stopped meanwhile.
    t.ask(t.remote, 'screens.useDisplay', { groupId: 'g-hall', displayId: 1 });
    t.setLetIn(false);
    t.boxes[2]?.answer(true);
    await t.settle();
    t.setLetIn(true);
    // The phone was removed in Drashti meanwhile.
    t.ask(t.remote, 'screens.useDisplay', { groupId: 'g-hall', displayId: 1 });
    t.devices.remove(t.remote);
    t.boxes[3]?.answer(true);
    await t.settle();
    // Each was asked, and none changed anything.
    expect(t.boxes).toHaveLength(4);
    expect(t.calls.filter((c) => c.args.length === 3)).toEqual([]);
  });

  it('asks the computer before a switch turned on from a phone opens an output over the controls', async () => {
    const t = setup();
    t.setSwitches({ audience: false, stage: true });
    t.setStatus([{ screenId: 's-1', state: 'switched-off', displayId: 1 }]);
    expect(t.ask(t.remote, 'switch', { which: 'audience', on: true }).status).toBe(202);
    expect(t.calls).toEqual([]);
    t.boxes[0]?.answer(true);
    await t.settle();
    expect(t.calls).toEqual([{ what: 'turn', args: ['audience', true] }]);
  });

  it('limits a phone’s changes, never its reading of the screens', () => {
    const t = setup();
    t.hold();
    const answers = Array.from({ length: 12 }, () => t.ask(t.remote, 'screens.identify').status);
    expect(answers.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 200));
    expect(answers.slice(10)).toEqual([429, 429]);
    expect(t.ask(t.remote, 'screens').status).toBe(200);
  });
});

describe('whether a switch turned on opens an output over the controls', () => {
  const groups: ScreenGroupConfig[] = [
    HALL,
    {
      id: 'g-stage',
      name: 'Placeholder Stage',
      role: 'stage',
      screens: [{ ...PROJECTOR, id: 's-2', groupId: 'g-stage' }],
    },
  ];
  it('is so only for a switched-off screen of its own opening again on the controls’ display', () => {
    const off = (screenId: string, displayId: number): ScreenStatus => ({
      screenId,
      state: 'switched-off',
      displayId,
    });
    expect(opensOverControls({ groups, status: [off('s-1', 1)] }, 'audience', 1)).toBe(true);
    expect(opensOverControls({ groups, status: [off('s-1', 2)] }, 'audience', 1)).toBe(false);
    expect(opensOverControls({ groups, status: [off('s-2', 1)] }, 'audience', 1)).toBe(false);
    expect(opensOverControls({ groups, status: [off('s-2', 1)] }, 'stage', 1)).toBe(true);
    expect(opensOverControls({ groups, status: [off('s-1', 1)] }, 'audience', null)).toBe(false);
    expect(
      opensOverControls(
        { groups, status: [{ screenId: 's-1', state: 'showing', displayId: 1 }] },
        'audience',
        1,
      ),
    ).toBe(false);
  });
});
