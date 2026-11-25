import { describe, expect, it } from 'vitest';
import { STOPPED_REFUSAL } from '../../shared/access';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import { IPC, type InvokeChannel } from '../../shared/ipc';
import { DEVICE_OPS, type DeviceOp } from '../../shared/network-api';
import type { Announcement, AnnouncementsView } from '../../shared/announcements';
import type { WindowList } from '../../shared/live-window';
import type { MidiLearnable, MidiSeen, MidiSettings } from '../../shared/midi';
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
import { SIMPLE_MODE_LOCKED, simpleModeBounds, type SimpleScope } from '../simple-mode';
import { phoneOpRefusal } from '../../shared/phone-rule';
import { opensOverControls } from './desktop-answers';
import { NetworkService, OP_CHANNEL } from './network-service';

/*
 * The phone as a full Drashti (Session 54, the owner's item 3): a Remote sets up the computer's own screens as
 * Screens does, answers Keep these screens?, and turns Audience and Stage, each through the very functions the
 * window's requests call (a stand-in here, which records what it was asked). Never a Stage or Announcements
 * device, nothing while Drashti is not let in, Simple Mode refusing on a phone what it refuses in the window, the
 * window's questions answered on the phone, and never the operator's consent to cover the controls from a phone:
 * only the computer's own box gives that. Placeholder names, made-up ids.
 *
 * Since alpha.23 (QA23-PHONE-1, the owner's "Only PPT and PDF") a Remote is refused every one of these before anything
 * runs, in both modes: the tests below show each refused, nothing asked of the window's functions or the computer's box.
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

/** One announcement waiting, one showing, and one decided earlier (never sent to a phone). */
const announcement = (id: string, status: Announcement['status']): Announcement => ({
  id,
  text: `Placeholder announcement ${id}`,
  sentText: `Placeholder announcement ${id}`,
  from: 'Placeholder volunteer',
  minutes: 5,
  deviceName: 'Placeholder poster',
  status,
  shownAs: status === 'showing' ? 'ticker' : null,
  sentAt: '2026-10-28T10:00:00.000Z',
  decidedAt: null,
  until: null,
  endedAt: null,
});
const QUEUE: AnnouncementsView = {
  waiting: [announcement('a-1', 'waiting')],
  showing: [announcement('a-2', 'showing')],
  earlier: [announcement('a-3', 'ended')],
};

function setup(options: { locked?: boolean; letIn?: boolean; audioTrackIds?: readonly string[] } = {}) {
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
  const lookups = { playlists: 0, items: 0 };
  const scope: SimpleScope = {
    playlistId: 'pl-1',
    playlistOf: (id) => {
      lookups.items++;
      return id === 'item-1' ? 'pl-1' : id === 'template-item' ? 'template' : null;
    },
    holdsMedia: () => false,
    holdsPresentation: () => false,
    kindOf: (id) => {
      lookups.playlists++;
      return id === 'pl-1' ? 'playlist' : id === 'folder' ? 'folder' : id === 'template' ? 'template' : null;
    },
    listsMedia: () => false,
    inMusic: (id) => options.audioTrackIds?.includes(id) === true,
    listsPresentation: () => false,
  };
  const playScope = {
    activePlaylist: (id: string) => id === 'pl-1',
    activeItem: (id: string, itemId: string) => id === 'pl-1' && itemId === 'item-1',
  };
  const bounds = simpleModeBounds(() => scope);
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
  // The stage layouts (Session 55): two, and the one every stage screen shows.
  const layouts = [
    { id: 'l-1', name: 'Placeholder band' },
    { id: 'l-2', name: 'Placeholder anchoring' },
  ];
  let chosenLayout: string | null = null;
  const snapshot = () => ({ displays: DISPLAYS, groups: GROUPS, status, nodes: [], uses: [] });
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
  const unexpectedPhoneAction = () => {
    throw new Error('This fixture supports only renaming a track.');
  };
  const refused = (channel: InvokeChannel, args?: readonly unknown[]) => {
    if (!locked) return false;
    const within = bounds.get(channel);
    return within ? args === undefined || !within(args) : SIMPLE_MODE_LOCKED.includes(channel);
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
      mediaSource: () => null,
      sharedSound: () => null,
      stage: () => ({ groupId: null, languages: null }),
      hallGroups: () => [],
      hall: () => ({ groupId: null }),
      switches: () => switches,
      clockStyle: () => ({ locale: 'en-GB', timeZone: 'Europe/London' }),
      shastraTexts: () => [],
      passage: () => ({ ok: false, message: 'No texts.' }),
    },
    mirror: {
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
        setDisplayJob: record('setDisplayJob', (displayId, job, options) =>
          job === 'none' ? done() : coverCheck(displayId, options as CoverOptions | undefined),
        ),
        removeScreen: record('removeScreen'),
        identify: () => {
          calls.push({ what: 'identify', args: [] });
        },
        pending: () => ({ deadline: 1_015_000, coversControls: false }),
        keep: record('keep'),
        goBack: record('goBack'),
      },
      stageLayouts: {
        list: () => layouts,
        chosenId: () => chosenLayout,
        choose: (id) => {
          calls.push({ what: 'chooseLayout', args: [id] });
          if (id !== null && !layouts.some((l) => l.id === id))
            return { ok: false, message: 'That stage layout no longer exists.' };
          chosenLayout = id as string | null;
          return { ok: true, chosenId: chosenLayout };
        },
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
      // The announcements' queue (Session 54): the service's own functions, recorded.
      queue: {
        view: () => QUEUE,
        approve: (input) => {
          calls.push({ what: 'approve', args: [input] });
          return { ok: true, view: QUEUE };
        },
        reject: (input) => {
          calls.push({ what: 'reject', args: [input] });
          return { ok: true, view: QUEUE };
        },
        takeOff: (input) => {
          calls.push({ what: 'takeOff', args: [input] });
          return { ok: true, view: QUEUE };
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
          // A video row's When it ends (Session 55, Part 9: a phone's too).
          setWhenEnds: (...args) => {
            calls.push({ what: 'setWhenEnds', args });
            return { ok: true, ids: [String(args[0])] };
          },
        }),
      },
      simple: () => locked,
      confirmCover: (question) =>
        new Promise<boolean>((resolve) => {
          boxes.push({ question, answer: resolve });
        }),
    },
    phone: options.audioTrackIds
      ? {
          wallpapers: {
            view: unexpectedPhoneAction,
            choose: unexpectedPhoneAction,
            rename: unexpectedPhoneAction,
            remove: unexpectedPhoneAction,
            restore: unexpectedPhoneAction,
          },
          quickBar: { view: unexpectedPhoneAction, set: unexpectedPhoneAction },
          looks: { look: unexpectedPhoneAction, photo: unexpectedPhoneAction, set: unexpectedPhoneAction },
          rename: {
            media: (id, name) => {
              calls.push({ what: 'renameMedia', args: [id, name] });
              return { ok: true };
            },
            presentation: unexpectedPhoneAction,
          },
          whenEnds: unexpectedPhoneAction,
        }
      : undefined,
    playMusic: () => ({ ok: true as const }),
    announcements: {
      submit: () => ({ status: 202, body: { ok: true } }),
      statusFor: () => ({ status: 404, body: { ok: false } }),
    },
    refused,
    simple: () =>
      locked
        ? {
            ...scope,
            ...playScope,
            plays: () => false,
            refusal: () => 'Simple Mode on Drashti’s computer: placeholder words.',
          }
        : null,
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
    refused,
    lookups,
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

/**
 * QA23-PHONE-1 (the owner's "Only PPT and PDF", shared/phone-rule.ts): what a Remote asks of the computer's own things,
 * refused before anything runs, 403 in its group's words, in Pro Mode and Simple Mode alike. The handlers stay
 * (desktop-answers.ts) until alpha.24; no phone reaches them.
 */
const refusal = (op: DeviceOp) => ({ status: 403, body: { ok: false, message: phoneOpRefusal(op, false) } });

/** Every op of this item, with arguments it takes. */
const OPS: [DeviceOp, Record<string, unknown>][] = [
  ['screens', {}],
  ['screens.addGroup', { name: 'Placeholder Stage' }],
  ['screens.renameGroup', { groupId: 'g-hall', name: 'Placeholder Main Hall' }],
  ['screens.groupRole', { groupId: 'g-hall', role: 'stage' }],
  ['screens.deleteGroup', { groupId: 'g-hall' }],
  ['screens.useDisplay', { groupId: 'g-hall', displayId: 2 }],
  ['screens.change', { screenId: 's-1', patch: { name: 'Placeholder left projector' } }],
  ['screens.displayJob', { displayId: 2, job: 'stage' }],
  ['screens.remove', { screenId: 's-1' }],
  ['screens.keep', {}],
  ['screens.goBack', {}],
  ['screens.identify', {}],
  ['switch', { which: 'stage', on: false }],
];

it('refuses a bounded Simple Mode channel when no window arguments were supplied', () => {
  const { refused } = setup({ locked: true });
  expect(refused(IPC.library.importPaths, [])).toBe(false);
  expect(refused(IPC.library.importPaths)).toBe(true);
});

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

  it('refuses a Remote each of them before the window’s own functions are asked, in its group’s words (QA23-PHONE-1)', () => {
    const t = setup();
    for (const [op, args] of OPS) expect(t.ask(t.remote, op, args), op).toEqual(refusal(op));
    // Not even the screens as they are: a phone cannot change this.
    expect(t.ask(t.remote, 'screens')).toEqual(refusal('screens'));
    expect(t.calls).toEqual([]);
    expect(t.boxes).toEqual([]);
    expect(t.hints).toEqual([]);
  });

  it('refuses them in Simple Mode too, in the phone rule’s words, never the window lock’s: Keep, Go back and the switches as well', () => {
    const t = setup({ locked: true });
    for (const [op, args] of OPS) expect(t.ask(t.remote, op, args), op).toEqual(refusal(op));
    // Off and on alike: Audience and Stage are the computer's.
    expect(t.ask(t.remote, 'switch', { which: 'audience', on: false })).toEqual(refusal('switch'));
    t.setSwitches({ audience: false, stage: true });
    expect(t.ask(t.remote, 'switch', { which: 'audience', on: true })).toEqual(refusal('switch'));
    expect(t.calls).toEqual([]);
  });

  it('never asks the window’s question on the phone before a switch goes off: the switch is refused first', () => {
    const t = setup();
    for (const args of [
      { which: 'audience', on: false },
      { which: 'audience', on: false, confirmed: true },
      { which: 'stage', on: false },
    ])
      expect(t.ask(t.remote, 'switch', args), JSON.stringify(args)).toEqual(refusal('switch'));
    expect(t.calls).toEqual([]);
  });

  it('never takes a phone’s word for the operator’s consent to cover the controls: refused before its arguments are read', () => {
    const t = setup();
    for (const [op, args] of [
      ['screens.useDisplay', { groupId: 'g-hall', displayId: 1, coverOperator: true }],
      ['screens.change', { screenId: 's-1', patch: { enabled: true, coverOperator: true } }],
      ['screens.addGroup', { name: 'Placeholder', options: { coverOperator: true } }],
      ['switch', { which: 'audience', on: false, confirmed: 'yes' }],
    ] as const)
      expect(t.ask(t.remote, op, args), op).toEqual(refusal(op));
    expect(t.calls).toEqual([]);
    expect(t.boxes).toEqual([]);
  });

  it('never asks the computer about an output a phone would put on the controls’ display: refused at once', async () => {
    const t = setup();
    expect(t.ask(t.remote, 'screens.useDisplay', { groupId: 'g-hall', displayId: 1 })).toEqual(
      refusal('screens.useDisplay'),
    );
    expect(t.ask(t.remote, 'screens.change', { screenId: 's-1', patch: { enabled: true } })).toEqual(
      refusal('screens.change'),
    );
    await t.settle();
    expect(t.boxes).toEqual([]);
    expect(t.calls).toEqual([]);
    expect(t.hints).toEqual([]);
  });

  it('never sets a display’s job from a phone, on the controls’ display or any other', async () => {
    const t = setup();
    for (const args of [
      { displayId: 2, job: 'audience' },
      { displayId: 2, job: 'lobby' },
      { displayId: 2, job: 'stage', coverOperator: true },
      { displayId: 1, job: 'audience' },
    ])
      expect(t.ask(t.remote, 'screens.displayJob', args), JSON.stringify(args)).toEqual(
        refusal('screens.displayJob'),
      );
    await t.settle();
    expect(t.boxes).toEqual([]);
    expect(t.calls).toEqual([]);
  });

  it('changes nothing and asks nothing, whatever the computer, Simple Mode or the phone’s pairing do meanwhile', async () => {
    const t = setup();
    expect(t.ask(t.remote, 'screens.change', { screenId: 's-1', patch: { enabled: true } })).toEqual(
      refusal('screens.change'),
    );
    t.later(15_000);
    t.setLocked(true);
    expect(t.ask(t.remote, 'screens.useDisplay', { groupId: 'g-hall', displayId: 1 })).toEqual(
      refusal('screens.useDisplay'),
    );
    t.setLocked(false);
    expect(t.ask(t.remote, 'screens.useDisplay', { groupId: 'g-hall', displayId: 1 })).toEqual(
      refusal('screens.useDisplay'),
    );
    await t.settle();
    // Never asked, so nothing to answer; and nothing changed.
    expect(t.boxes).toEqual([]);
    expect(t.calls).toEqual([]);
    // Removed in Drashti: as before, it is told to pair again.
    t.devices.remove(t.remote);
    expect(t.ask(t.remote, 'screens.useDisplay', { groupId: 'g-hall', displayId: 1 }).status).toBe(401);
  });

  it('never turns a switch on from a phone, over the controls or not', async () => {
    const t = setup();
    t.setSwitches({ audience: false, stage: true });
    t.setStatus([{ screenId: 's-1', state: 'switched-off', displayId: 1 }]);
    expect(t.ask(t.remote, 'switch', { which: 'audience', on: true })).toEqual(refusal('switch'));
    await t.settle();
    expect(t.boxes).toEqual([]);
    expect(t.calls).toEqual([]);
  });

  it('refuses a phone’s changes before its limit counts them, and its reading of the screens too: never 429', () => {
    const t = setup();
    t.hold();
    const answers = Array.from({ length: 12 }, () => t.ask(t.remote, 'screens.identify'));
    expect(answers).toEqual(Array.from({ length: 12 }, () => refusal('screens.identify')));
    expect(t.ask(t.remote, 'screens')).toEqual(refusal('screens'));
    expect(t.calls).toEqual([]);
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

  it('are a Remote’s requests alone, none while Drashti is not let in, and a Remote is refused each (QA23-PHONE-1)', async () => {
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
    for (const [op, args] of OPS3) expect(t.ask(t.remote, op, args), op).toEqual(refusal(op));
    expect(await t.listWindows(t.remote)).toEqual(refusal('windows'));
    expect(t.calls).toEqual([]);
  });

  it('never gives a phone Media’s inputs or the cameras the computer lists', () => {
    const t = setup();
    expect(t.ask(t.remote, 'inputs')).toEqual(refusal('inputs'));
  });

  it('never names or changes an input from a phone, with a camera listed or not, nor puts a window up', () => {
    const t = setup();
    const add = (device: string) => t.ask(t.remote, 'input.add', { name: 'Input 2', device, fit: 'fit' });
    expect(add('Placeholder camera of the phone’s own naming')).toEqual(refusal('input.add'));
    t.setInputs({ cameras: ['Placeholder capture card'] });
    for (const args of [
      { inputId: 'in-1', device: 'Placeholder camera', fit: 'fill' },
      { inputId: 'in-1', device: 'Placeholder webcam' },
    ])
      expect(t.ask(t.remote, 'input.change', args), JSON.stringify(args)).toEqual(refusal('input.change'));
    t.setInputs({ cameras: null });
    expect(add('Placeholder capture card')).toEqual(refusal('input.add'));
    t.setInputs({ cameras: ['Placeholder capture card'], access: 'not-determined' });
    expect(add('Placeholder capture card')).toEqual(refusal('input.add'));
    expect(t.ask(t.remote, 'window.show', { id: 'window:7:0', sourceId: 'screen:0:0' })).toEqual(
      refusal('window.show'),
    );
    expect(t.calls).toEqual([]);
  });

  it('never lists the other apps’ windows to a phone, by either way of asking', async () => {
    const t = setup();
    expect(await t.listWindows(t.remote)).toEqual(refusal('windows'));
    t.setWindows({ ok: false, reason: 'permission', message: 'Screen Recording, on the Mac.' });
    expect(await t.listWindows(t.remote)).toEqual(refusal('windows'));
    expect(t.ask(t.remote, 'windows')).toEqual(refusal('windows'));
  });

  it('refuses them in Simple Mode too, the inputs’ reading as well, in the phone rule’s words', async () => {
    const t = setup({ locked: true });
    for (const [op, args] of OPS3) expect(t.ask(t.remote, op, args), op).toEqual(refusal(op));
    expect(await t.listWindows(t.remote)).toEqual(refusal('windows'));
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
  it('never changes it from a phone: each refused in its group’s words, nothing asked of the window’s functions (QA23-PHONE-1)', () => {
    const { ask, remote, calls } = setup();
    for (const [op, args] of [
      ['library.new', { name: 'Placeholder words', words: 'Placeholder line one' }],
      ['library.remove', { ids: ['p-1', 'p-2'] }],
      ['library.restore', { ids: ['p-1', 'p-2'] }],
      ['playlist.new', { name: 'Placeholder evening' }],
      ['playlist.new', { name: 'Placeholder folder', isFolder: true }],
      ['playlist.new', { name: 'Placeholder nested playlist', parentId: 'folder' }],
      ['playlist.rename', { playlistId: 'pl-1', name: 'Placeholder evening, again' }],
      ['playlist.remove', { ids: ['pl-1'] }],
      ['playlist.restore', { ids: ['pl-1'] }],
      [
        'playlist.add',
        {
          playlistId: 'pl-1',
          items: [
            { kind: 'presentation', presentationId: 'p-1' },
            { kind: 'media', mediaId: 'm-1' },
          ],
        },
      ],
      ['playlist.move', { playlistId: 'pl-1', ids: ['item-2'], to: 0 }],
      ['playlist.removeItems', { ids: ['item-2'] }],
      ['playlist.restoreItems', { ids: ['item-2'] }],
    ] as const)
      expect(ask(remote, op, args as Record<string, unknown>), op).toEqual(refusal(op));
    expect(calls).toEqual([]);
  });

  it('refuses a path, a file, a header’s words or too many ids before reading them: the request itself is never a phone’s', () => {
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
      expect(ask(remote, op, args as Record<string, unknown>), JSON.stringify(args)).toEqual(refusal(op));
    expect(calls).toEqual([]);
  });

  it('refuses a name with nothing visible in it as every other name from a phone: the rule first, the name never read', () => {
    const { ask, remote, calls } = setup();
    // A zero-width space, a word joiner and a soft hyphen: nothing a person sees (X3's cleaning empties it).
    const nothing = '\u200B\u2060\u00AD';
    for (const [op, args] of [
      ['playlist.rename', { playlistId: 'pl-1', name: nothing }],
      ['playlist.new', { name: nothing }],
      ['library.new', { name: nothing, words: 'Placeholder words' }],
    ] as const)
      expect(ask(remote, op, args), op).toEqual(refusal(op));
    expect(calls).toEqual([]);
  });

  it('refuses a restore before the library limit is taken or any playlist ID is looked up: never 429', () => {
    const { ask, remote, hold, lookups, calls } = setup({ locked: true });
    hold();
    const restore = () => ask(remote, 'playlist.restore', { ids: ['template'] });
    for (let i = 0; i < 31; i++)
      expect(restore(), `restore ${String(i + 1)}`).toEqual(refusal('playlist.restore'));
    expect(lookups).toEqual({ playlists: 0, items: 0 });
    expect(calls).toEqual([]);
  });

  it('refuses a phone’s library changes before its limit counts them: thirty-one and more, never 429', () => {
    const { ask, remote, hold, calls } = setup();
    hold();
    const move = () => ask(remote, 'playlist.move', { playlistId: 'pl-1', ids: ['item-1'], to: 0 });
    for (let i = 0; i < 31; i += 1)
      expect(move(), `change ${String(i + 1)}`).toEqual(refusal('playlist.move'));
    expect(calls).toEqual([]);
    expect(ask(remote, 'screens.identify')).toEqual(refusal('screens.identify'));
  });

  it('is a Remote’s alone, nothing while Drashti is not let in, and a Remote is refused in both modes', () => {
    const { ask, remote, stage, poster, calls, setLocked, setLetIn } = setup();
    const add = { playlistId: 'pl-1', items: [{ kind: 'presentation', presentationId: 'p-1' }] };
    for (const op of ['library.remove', 'playlist.add'] as const) {
      expect(DEVICE_OPS[op]).toEqual(['remote']);
      expect(OP_CHANNEL[op], op).not.toBeNull();
    }
    expect(ask(stage, 'playlist.add', add).status).toBe(403);
    expect(ask(poster, 'library.remove', { ids: ['p-1'] }).status).toBe(403);
    setLocked(true);
    // Within Simple Mode's bounds and outside them alike.
    for (const [op, args] of [
      ['playlist.new', { name: 'Placeholder playlist' }],
      ['playlist.new', { name: 'Placeholder nested playlist', parentId: 'folder' }],
      ['playlist.new', { name: 'Placeholder folder', isFolder: true }],
      ['playlist.rename', { playlistId: 'folder', name: 'Placeholder renamed' }],
      ['playlist.remove', { ids: ['folder'] }],
      ['playlist.restore', { ids: ['folder'] }],
      ['playlist.move', { playlistId: 'pl-1', ids: ['item-1'], to: 0 }],
      ['playlist.removeItems', { ids: ['item-1'] }],
      ['playlist.restoreItems', { ids: ['item-1'] }],
      ['playlist.new', { name: 'Placeholder bad parent', parentId: 'template' }],
      ['playlist.rename', { playlistId: 'template', name: 'Placeholder' }],
      ['playlist.remove', { ids: ['template', 'folder'] }],
      ['playlist.restore', { ids: ['template'] }],
      ['playlist.add', add],
      ['playlist.add', { ...add, playlistId: 'template' }],
      ['playlist.move', { playlistId: 'template', ids: ['template-item'], to: 0 }],
      ['playlist.removeItems', { ids: ['item-1', 'template-item'] }],
      ['playlist.restoreItems', { ids: ['template-item'] }],
      ['library.remove', { ids: ['p-1'] }],
      ['playlist.new', { name: 'Placeholder smart list', path: '/placeholder' }],
    ] as const)
      expect(ask(remote, op, args as Record<string, unknown>), op).toEqual(refusal(op));
    setLocked(false);
    expect(ask(remote, 'playlist.add', add)).toEqual(refusal('playlist.add'));
    setLetIn(false);
    expect(ask(remote, 'library.remove', { ids: ['p-1'] })).toMatchObject({
      status: 503,
      body: { message: STOPPED_REFUSAL },
    });
    expect(calls).toEqual([]);
  });

  it('never renames a sound from a phone, on an Audio playlist or not, in Simple Mode', () => {
    const { ask, remote, calls } = setup({ locked: true, audioTrackIds: ['sound-in-audio'] });
    const name = 'Placeholder renamed track';
    expect(ask(remote, 'media.rename', { mediaId: 'sound-in-audio', name })).toEqual(refusal('media.rename'));
    expect(ask(remote, 'media.rename', { mediaId: 'sound-unlisted', name })).toEqual(refusal('media.rename'));
    expect(calls).toEqual([]);
  });

  it('refuses playlist and row id lists of any length in Simple Mode before looking up any ids', () => {
    const { ask, remote, calls, lookups } = setup({ locked: true });
    for (const [op, limit, id] of [
      ['playlist.remove', 50, 'pl-1'],
      ['playlist.restore', 1000, 'pl-1'],
      ['playlist.removeItems', 50, 'item-1'],
      ['playlist.restoreItems', 50, 'item-1'],
    ] as const) {
      const ids = Array.from({ length: limit + 1 }, () => id);
      expect(ask(remote, op, { ids }), op).toEqual(refusal(op));
      expect(lookups, op).toEqual({ playlists: 0, items: 0 });
    }
    const ids = Array.from({ length: 1000 }, () => 'folder');
    expect(ask(remote, 'playlist.restore', { ids })).toEqual(refusal('playlist.restore'));
    expect(lookups).toEqual({ playlists: 0, items: 0 });
    expect(calls).toEqual([]);
  });
});

describe('MIDI from a phone (Session 54, the phone as a full Drashti)', () => {
  it('never reads it for a phone, so the computer’s window is never asked to listen', () => {
    const { ask, remote, calls, setMidiSeen } = setup();
    setMidiSeen(null);
    expect(ask(remote, 'midi')).toEqual(refusal('midi'));
    setMidiSeen({ access: 'on', devices: ['Placeholder pad', 'Placeholder keys'], connected: true });
    expect(ask(remote, 'midi')).toEqual(refusal('midi'));
    expect(calls).toEqual([]);
  });

  it('never chooses a device, forgets a mapping or learns from a phone', () => {
    const { ask, remote, calls, midiNow } = setup();
    const before = midiNow();
    for (const [op, args] of [
      ['midi.device', { deviceName: 'Placeholder keys' }],
      ['midi.device', { deviceName: 'A device the phone made up' }],
      ['midi.forget', { index: 0 }],
      ['midi.learn', { action: 'blackout' }],
      ['midi.learn', { action: null }],
      ['midi.device', { deviceName: null }],
    ] as const)
      expect(ask(remote, op, args as Record<string, unknown>), op).toEqual(refusal(op));
    expect(midiNow()).toEqual(before);
    expect(calls).toEqual([]);
  });

  it('is a Remote’s alone, and a Remote is refused in Simple Mode too, its reading as well', () => {
    const { ask, remote, stage, calls, setLocked } = setup();
    expect(ask(stage, 'midi').status).toBe(403);
    expect(ask(stage, 'midi.learn', { action: 'next' }).status).toBe(403);
    setLocked(true);
    expect(ask(remote, 'midi')).toEqual(refusal('midi'));
    for (const [op, args] of [
      ['midi.device', { deviceName: null }],
      ['midi.forget', { index: 0 }],
      ['midi.learn', { action: 'next' }],
    ] as const)
      expect(ask(remote, op, args as Record<string, unknown>), op).toEqual(refusal(op));
    expect(calls).toEqual([]);
  });
});

describe('the announcements’ queue from a phone (Session 54, the phone as a full Drashti)', () => {
  it('never reads or decides the queue from a phone: Announcements at the computer does', () => {
    const { ask, remote, calls } = setup();
    expect(ask(remote, 'queue')).toEqual(refusal('queue'));
    expect(ask(remote, 'queue.approve', { id: 'a-1', as: 'ticker' })).toEqual(refusal('queue.approve'));
    expect(ask(remote, 'queue.reject', { id: 'a-1' })).toEqual(refusal('queue.reject'));
    expect(ask(remote, 'queue.takeOff', { id: 'a-2' })).toEqual(refusal('queue.takeOff'));
    expect(calls).toEqual([]);
  });

  it('is a Remote’s alone, never the poster’s, and a Remote is refused in Simple Mode too, its reading as well', () => {
    const { ask, remote, stage, poster, calls, setLocked } = setup();
    for (const device of [stage, poster]) {
      expect(ask(device, 'queue').status).toBe(403);
      expect(ask(device, 'queue.approve', { id: 'a-1', as: 'ticker' }).status).toBe(403);
    }
    setLocked(true);
    expect(ask(remote, 'queue')).toEqual(refusal('queue'));
    for (const op of ['queue.approve', 'queue.reject', 'queue.takeOff'] as const)
      expect(ask(remote, op, { id: 'a-1', as: 'ticker' }), op).toEqual(refusal(op));
    expect(calls).toEqual([]);
  });
});

describe('the stage layout from a phone (Session 55)', () => {
  it('never reads the layouts for a phone nor chooses one from it', () => {
    const t = setup();
    expect(t.ask(t.remote, 'stage.layouts')).toEqual(refusal('stage.layouts'));
    for (const args of [{ layoutId: 'l-2' }, { layoutId: null }, { layoutId: 'gone' }, {}, { layoutId: 7 }])
      expect(t.ask(t.remote, 'stage.layout', args), JSON.stringify(args)).toEqual(refusal('stage.layout'));
    expect(t.calls.filter((c) => c.what === 'chooseLayout')).toEqual([]);
  });

  it('is a Remote’s alone, nothing while Drashti is not let in, and a Remote is refused in Simple Mode too', () => {
    const t = setup();
    for (const device of [t.stage, t.poster])
      expect(t.ask(device, 'stage.layout', { layoutId: 'l-1' })).toMatchObject({ status: 403 });
    t.setLocked(true);
    expect(t.ask(t.remote, 'stage.layouts')).toEqual(refusal('stage.layouts'));
    expect(t.ask(t.remote, 'stage.layout', { layoutId: 'l-1' })).toEqual(refusal('stage.layout'));
    t.setLocked(false);
    t.setLetIn(false);
    expect(t.ask(t.remote, 'stage.layouts')).toEqual({
      status: 503,
      body: { ok: false, message: STOPPED_REFUSAL },
    });
    expect(t.calls.filter((c) => c.what === 'chooseLayout')).toEqual([]);
  });
});
