import { describe, expect, it } from 'vitest';
import { STOPPED_REFUSAL } from '../../shared/access';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import type { InvokeChannel } from '../../shared/ipc';
import { SIMPLE_MODE_REFUSAL } from '../../shared/mode';
import { DEVICE_OPS, type DeviceOp } from '../../shared/network-api';
import {
  ASKED_AT_COMPUTER,
  CAMERA_AT_COMPUTER,
  CAMERAS_NOT_LISTED,
  COMPUTER_BUSY,
  NOT_A_LISTED_CAMERA,
  SCREEN_RECORDING_AT_COMPUTER,
  SWITCH_ASKS_FIRST,
} from '../../shared/network-desktop';
import type { WindowList } from '../../shared/live-window';
import type { MidiLearnable, MidiSeen, MidiSettings } from '../../shared/midi';
import { MIDI_NOT_LISTED, NOT_A_LISTED_MIDI_DEVICE } from '../../shared/network-desktop';
import type { CameraAccess, VideoInput } from '../../shared/video-inputs';
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
  // Media's video inputs, the computer's cameras as its window saw them, and the other apps' windows.
  const camera: VideoInput = { id: 'in-1', name: 'Input 1', device: 'Placeholder camera', fit: 'fit' };
  let inputs: VideoInput[] = [camera];
  let access: CameraAccess = 'granted';
  let cameras: string[] | null = ['Placeholder camera', 'Placeholder capture card'];
  let windows: WindowList = {
    ok: true,
    windows: [{ id: 'window:7:0', name: 'Placeholder meeting', picture: 'data:image/png;base64,AAAA' }],
  };
  const state = initialEngineState();
  let midiSettings: MidiSettings = {
    deviceName: 'Placeholder pad',
    mappings: [{ input: { type: 'note', channel: 0, number: 36 }, action: { kind: 'next' } }],
  };
  let midiSeen: MidiSeen | null = {
    access: 'on',
    devices: ['Placeholder pad', 'Placeholder keys'],
    connected: true,
  };
  let midiLearning: MidiLearnable | null = null;
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
      inputs: {
        view: () => ({ inputs }),
        access: () => access,
        cameras: () => cameras,
        add: (fields) => {
          calls.push({ what: 'addInput', args: [fields] });
          return { ok: true, view: { inputs } };
        },
        update: (id, fields) => {
          calls.push({ what: 'updateInput', args: [id, fields] });
          return { ok: true, view: { inputs } };
        },
        remove: (id) => {
          calls.push({ what: 'removeInput', args: [id] });
          return { ok: true, view: { inputs } };
        },
      },
      windows: {
        list: () => Promise.resolve(windows),
        show: (id) => {
          calls.push({ what: 'showWindow', args: [id] });
          return { ok: true };
        },
      },
      // MIDI (Session 54): the settings kept, the window's devices as it said them, learning asked of it.
      midi: {
        view: () => ({ settings: midiSettings, seen: midiSeen, learning: midiLearning }),
        listen: () => {
          calls.push({ what: 'midiListen', args: [] });
        },
        set: (next) => {
          calls.push({ what: 'midiSet', args: [next] });
          midiSettings = next;
          return { ok: true, settings: next };
        },
        learn: (action) => {
          calls.push({ what: 'midiLearn', args: [action] });
          midiLearning = action;
        },
      },
      // The library's changes (Session 54): each recorded, answered with the ids as the window's own are.
      library: {
        newFromWords: (name, words) => {
          calls.push({ what: 'newFromWords', args: [name, words] });
          return { ok: true, id: 'p-new' };
        },
        removePresentations: (ids) => {
          calls.push({ what: 'removePresentations', args: [ids] });
          return { ok: true, ids: ids as string[] };
        },
        restorePresentations: (ids) => {
          calls.push({ what: 'restorePresentations', args: [ids] });
          return { ok: true, ids: ids as string[] };
        },
        playlists: () => ({
          create: (...args) => {
            calls.push({ what: 'createPlaylist', args });
            return { ok: true, ids: ['pl-new'] };
          },
          rename: (...args) => {
            calls.push({ what: 'renamePlaylist', args });
            return { ok: true, ids: [String(args[0])] };
          },
          remove: (ids) => {
            calls.push({ what: 'removePlaylists', args: [ids] });
            return { ok: true, ids: ids as string[] };
          },
          restore: (ids) => {
            calls.push({ what: 'restorePlaylists', args: [ids] });
            return { ok: true, ids: ids as string[] };
          },
          addItems: (...args) => {
            calls.push({ what: 'addItems', args });
            return { ok: true, ids: ['item-new'] };
          },
          moveItems: (...args) => {
            calls.push({ what: 'moveItems', args });
            return { ok: true, ids: args[1] as string[] };
          },
          removeItems: (ids) => {
            calls.push({ what: 'removeItems', args: [ids] });
            return { ok: true, ids: ids as string[] };
          },
          restoreItems: (ids) => {
            calls.push({ what: 'restoreItems', args: [ids] });
            return { ok: true, ids: ids as string[] };
          },
        }),
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
  const listWindows = (deviceId: string) =>
    service.windows({ address: PHONE, deviceId, op: 'windows', args: {} });
  return {
    listWindows,
    setInputs: (v: { inputs?: VideoInput[]; access?: CameraAccess; cameras?: string[] | null }) => {
      inputs = v.inputs ?? inputs;
      access = v.access ?? access;
      cameras = v.cameras === undefined ? cameras : v.cameras;
    },
    setWindows: (w: WindowList) => {
      windows = w;
    },
    setMidiSeen: (seen: MidiSeen | null) => {
      midiSeen = seen;
    },
    midiNow: () => midiSettings,
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

describe('the phone as a full Drashti: video inputs and the other apps’ windows (Session 54)', () => {
  const OPS3: [DeviceOp, Record<string, unknown>][] = [
    ['inputs', {}],
    ['input.add', { name: 'Input 2', device: 'Placeholder capture card', fit: 'fill' }],
    ['input.change', { inputId: 'in-1', name: 'Placeholder stage camera' }],
    ['input.remove', { inputId: 'in-1' }],
    ['window.show', { id: 'window:7:0' }],
  ];

  it('lets a Remote alone name, change, remove and read them, and put a window up, and none while Drashti is not let in', async () => {
    const t = setup();
    for (const [op] of [...OPS3, ['windows', {}] as const]) expect(DEVICE_OPS[op], op).toEqual(['remote']);
    for (const [op, args] of OPS3) {
      expect(t.ask(t.stage, op, args).status, op).toBe(403);
      expect(t.ask(t.poster, op, args).status, op).toBe(403);
    }
    expect((await t.listWindows(t.stage)).status).toBe(403);
    expect((await t.listWindows(t.poster)).status).toBe(403);
    t.setLetIn(false);
    for (const [op, args] of OPS3) expect(t.ask(t.remote, op, args).status, op).toBe(503);
    expect((await t.listWindows(t.remote)).status).toBe(503);
    expect(t.calls).toEqual([]);
    t.setLetIn(true);
    for (const [op, args] of OPS3) expect(t.ask(t.remote, op, args).status, op).toBe(200);
    expect(t.calls).toEqual([
      { what: 'addInput', args: [{ name: 'Input 2', device: 'Placeholder capture card', fit: 'fill' }] },
      { what: 'updateInput', args: ['in-1', { name: 'Placeholder stage camera' }] },
      { what: 'removeInput', args: ['in-1'] },
      { what: 'showWindow', args: ['window:7:0'] },
    ]);
  });

  it('gives a phone Media’s inputs, the cameras the computer lists and whether Drashti may use them', () => {
    const t = setup();
    expect(t.ask(t.remote, 'inputs').body).toEqual({
      ok: true,
      inputs: [{ id: 'in-1', name: 'Input 1', device: 'Placeholder camera', fit: 'fit' }],
      access: 'granted',
      cameras: ['Placeholder camera', 'Placeholder capture card'],
    });
  });

  it('names an input only with a camera the computer lists now, never one a phone names, and says why not', () => {
    const t = setup();
    const add = (device: string) => t.ask(t.remote, 'input.add', { name: 'Input 2', device, fit: 'fit' });
    expect(add('Placeholder camera of the phone’s own naming')).toEqual({
      status: 409,
      body: { ok: false, message: NOT_A_LISTED_CAMERA },
    });
    // A change keeps the camera it has, listed or not; another must be listed.
    t.setInputs({ cameras: ['Placeholder capture card'] });
    expect(
      t.ask(t.remote, 'input.change', { inputId: 'in-1', device: 'Placeholder camera', fit: 'fill' }).status,
    ).toBe(200);
    expect(t.ask(t.remote, 'input.change', { inputId: 'in-1', device: 'Placeholder webcam' }).status).toBe(
      409,
    );
    t.setInputs({ cameras: null });
    expect(add('Placeholder capture card').body).toEqual({ ok: false, message: CAMERAS_NOT_LISTED });
    // The camera's own setting is the computer's to answer.
    t.setInputs({ cameras: ['Placeholder capture card'], access: 'not-determined' });
    expect(add('Placeholder capture card').body).toEqual({ ok: false, message: CAMERA_AT_COMPUTER });
    // Each request carries what it names, and nothing else.
    t.setInputs({ access: 'granted' });
    expect(
      t.ask(t.remote, 'input.add', {
        name: 'Input 2',
        device: 'Placeholder capture card',
        fit: 'fit',
        id: 'x',
      }).status,
    ).toBe(400);
    expect(t.ask(t.remote, 'window.show', { id: 'window:7:0', sourceId: 'screen:0:0' }).status).toBe(400);
    expect(t.calls).toEqual([
      { what: 'updateInput', args: ['in-1', { device: 'Placeholder camera', fit: 'fill' }] },
    ]);
  });

  it('lists the other apps’ windows by name, never a picture of them, and says when the computer must allow it', async () => {
    const t = setup();
    expect(await t.listWindows(t.remote)).toEqual({
      status: 200,
      body: { ok: true, windows: { ok: true, windows: [{ id: 'window:7:0', name: 'Placeholder meeting' }] } },
    });
    t.setWindows({ ok: false, reason: 'permission', message: 'Screen Recording, on the Mac.' });
    expect((await t.listWindows(t.remote)).body).toEqual({
      ok: true,
      windows: { ok: false, reason: 'permission', message: SCREEN_RECORDING_AT_COMPUTER },
    });
    // Answered once listed, never by the request's own answer.
    expect(t.ask(t.remote, 'windows').status).toBe(400);
  });

  it('refuses in Simple Mode just what the window’s Media refuses: naming, changing and removing an input, and the windows', async () => {
    const t = setup({ locked: true });
    for (const [op, args] of OPS3)
      expect(t.ask(t.remote, op, args), op).toEqual(
        op === 'inputs'
          ? expect.objectContaining({ status: 200 })
          : { status: 403, body: { ok: false, message: SIMPLE_MODE_REFUSAL } },
      );
    expect(await t.listWindows(t.remote)).toEqual({
      status: 403,
      body: { ok: false, message: SIMPLE_MODE_REFUSAL },
    });
    expect(t.calls).toEqual([]);
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

describe('the library from a phone (Session 54, the phone as a full Drashti)', () => {
  it('changes it as the window does, each through the window’s own functions, a delete answered with what its Undo puts back', () => {
    const { ask, remote, calls } = setup();
    const ok = (op: DeviceOp, args: Record<string, unknown>) => {
      const a = ask(remote, op, args);
      expect(a.status, op).toBe(200);
      return a.body;
    };
    expect(ok('library.new', { name: 'Placeholder words', words: 'Placeholder line one' })).toMatchObject({
      id: 'p-new',
    });
    // Deleted, then put back by the ids the delete answered with: the phone's Undo.
    const deleted = ok('library.remove', { ids: ['p-1', 'p-2'] });
    expect(deleted).toMatchObject({ ids: ['p-1', 'p-2'] });
    ok('library.restore', { ids: (deleted as { ids: string[] }).ids });
    ok('playlist.new', { name: 'Placeholder evening' });
    ok('playlist.rename', { playlistId: 'pl-1', name: 'Placeholder evening, again' });
    ok('playlist.remove', { ids: ['pl-1'] });
    ok('playlist.restore', { ids: ['pl-1'] });
    ok('playlist.add', {
      playlistId: 'pl-1',
      items: [
        { kind: 'presentation', presentationId: 'p-1' },
        { kind: 'media', mediaId: 'm-1' },
      ],
    });
    ok('playlist.move', { playlistId: 'pl-1', ids: ['item-2'], to: 0 });
    ok('playlist.removeItems', { ids: ['item-2'] });
    ok('playlist.restoreItems', { ids: ['item-2'] });
    expect(calls.map((c) => [c.what, c.args])).toEqual([
      ['newFromWords', ['Placeholder words', 'Placeholder line one']],
      ['removePresentations', [['p-1', 'p-2']]],
      ['restorePresentations', [['p-1', 'p-2']]],
      ['createPlaylist', ['Placeholder evening', null, false]],
      ['renamePlaylist', ['pl-1', 'Placeholder evening, again']],
      ['removePlaylists', [['pl-1']]],
      ['restorePlaylists', [['pl-1']]],
      [
        'addItems',
        [
          'pl-1',
          null,
          [
            { kind: 'presentation', presentationId: 'p-1' },
            { kind: 'media', mediaId: 'm-1' },
          ],
        ],
      ],
      ['moveItems', ['pl-1', ['item-2'], 0]],
      ['removeItems', [['item-2']]],
      ['restoreItems', [['item-2']]],
    ]);
  });

  it('takes things by their ids only, never a path, a file or a header’s words, and at most 50 at once', () => {
    const { ask, remote, calls } = setup();
    for (const [op, args] of [
      ['playlist.add', { playlistId: 'pl-1', items: [{ kind: 'media', path: '/placeholder/file.mp4' }] }],
      ['playlist.add', { playlistId: 'pl-1', items: [{ kind: 'header', label: 'Placeholder' }] }],
      [
        'playlist.add',
        { playlistId: 'pl-1', items: [{ kind: 'media', mediaId: 'm-1', url: 'https://example.com' }] },
      ],
      ['library.remove', { ids: Array.from({ length: 51 }, (_, i) => `p-${String(i)}`) }],
      ['library.remove', { ids: [] }],
      ['library.new', { name: 'Placeholder', words: 'x', file: '/placeholder' }],
      ['playlist.new', { name: '   ' }],
    ] as const)
      expect(ask(remote, op, args as Record<string, unknown>).status, JSON.stringify(args)).toBe(400);
    expect(calls).toEqual([]);
  });

  it('limits a phone’s library changes on their own, thirty at once, as a person tapping through a playlist makes them', () => {
    const { ask, remote, hold, calls } = setup();
    hold();
    const move = () => ask(remote, 'playlist.move', { playlistId: 'pl-1', ids: ['item-1'], to: 0 }).status;
    for (let i = 0; i < 30; i += 1) expect(move(), `change ${String(i + 1)}`).toBe(200);
    expect(move()).toBe(429);
    expect(calls).toHaveLength(30);
    // The screens' own limit is apart: still ten at once.
    expect(ask(remote, 'screens.identify').status).toBe(200);
  });

  it('is a Remote’s alone, nothing while Drashti is not let in, and refused in Simple Mode as the window refuses it', () => {
    const { ask, remote, stage, poster, calls, setLocked, setLetIn } = setup();
    const add = { playlistId: 'pl-1', items: [{ kind: 'presentation', presentationId: 'p-1' }] };
    for (const op of ['library.remove', 'playlist.add'] as const) {
      expect(DEVICE_OPS[op]).toEqual(['remote']);
      expect(OP_CHANNEL[op], op).not.toBeNull();
    }
    expect(ask(stage, 'playlist.add', add).status).toBe(403);
    expect(ask(poster, 'library.remove', { ids: ['p-1'] }).status).toBe(403);
    setLocked(true);
    const refused = ask(remote, 'playlist.add', add);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ message: SIMPLE_MODE_REFUSAL });
    expect(ask(remote, 'library.remove', { ids: ['p-1'] }).status).toBe(403);
    setLocked(false);
    setLetIn(false);
    expect(ask(remote, 'library.remove', { ids: ['p-1'] })).toMatchObject({
      status: 503,
      body: { message: STOPPED_REFUSAL },
    });
    expect(calls).toEqual([]);
  });
});

describe('MIDI from a phone (Session 54, the phone as a full Drashti)', () => {
  it('reads it and asks the computer’s window to listen until it has, so its devices are listed, never again after', () => {
    const { ask, remote, calls, setMidiSeen } = setup();
    setMidiSeen(null);
    expect(ask(remote, 'midi').status).toBe(200);
    setMidiSeen({ access: 'refused', devices: [], connected: false });
    expect(ask(remote, 'midi').status).toBe(200);
    setMidiSeen({ access: 'on', devices: ['Placeholder pad', 'Placeholder keys'], connected: true });
    expect(ask(remote, 'midi')).toMatchObject({
      status: 200,
      body: {
        midi: {
          settings: { deviceName: 'Placeholder pad' },
          seen: { devices: ['Placeholder pad', 'Placeholder keys'] },
        },
      },
    });
    // Asked once, while the window had not said: a refusal or a list never asks again (no loop of reads).
    expect(calls).toEqual([{ what: 'midiListen', args: [] }]);
  });

  it('chooses a device only among those the computer lists, forgets a mapping, and learns only with a device chosen', () => {
    const { ask, remote, calls, setMidiSeen, midiNow } = setup();
    expect(ask(remote, 'midi.device', { deviceName: 'Placeholder keys' }).status).toBe(200);
    expect(midiNow().deviceName).toBe('Placeholder keys');
    expect(ask(remote, 'midi.device', { deviceName: 'A device the phone made up' })).toMatchObject({
      status: 409,
      body: { message: NOT_A_LISTED_MIDI_DEVICE },
    });
    expect(ask(remote, 'midi.forget', { index: 0 }).status).toBe(200);
    expect(midiNow().mappings).toEqual([]);
    expect(ask(remote, 'midi.forget', { index: 0 }).status).toBe(400);
    expect(ask(remote, 'midi.learn', { action: 'blackout' }).status).toBe(200);
    expect(ask(remote, 'midi.learn', { action: null }).status).toBe(200);
    expect(ask(remote, 'midi.learn', { action: 'macro' }).status).toBe(400);
    expect(ask(remote, 'midi.device', { deviceName: null }).status).toBe(200);
    expect(ask(remote, 'midi.learn', { action: 'next' }).status).toBe(409);
    setMidiSeen(null);
    expect(ask(remote, 'midi.device', { deviceName: 'Placeholder keys' })).toMatchObject({
      status: 409,
      body: { message: MIDI_NOT_LISTED },
    });
    expect(calls.map((c) => c.what)).toEqual(['midiSet', 'midiSet', 'midiLearn', 'midiLearn', 'midiSet']);
  });

  it('is a Remote’s alone, and Simple Mode refuses its changes as the window’s MIDI… does, never its reading', () => {
    const { ask, remote, stage, calls, setLocked } = setup();
    expect(ask(stage, 'midi').status).toBe(403);
    expect(ask(stage, 'midi.learn', { action: 'next' }).status).toBe(403);
    setLocked(true);
    expect(ask(remote, 'midi').status).toBe(200);
    for (const [op, args] of [
      ['midi.device', { deviceName: null }],
      ['midi.forget', { index: 0 }],
      ['midi.learn', { action: 'next' }],
    ] as const)
      expect(ask(remote, op, args as Record<string, unknown>)).toMatchObject({
        status: 403,
        body: { message: SIMPLE_MODE_REFUSAL },
      });
    expect(calls.map((c) => c.what)).toEqual([]);
  });
});
