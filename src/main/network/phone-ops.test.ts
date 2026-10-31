import { describe, expect, it } from 'vitest';
import { STOPPED_REFUSAL } from '../../shared/access';
import type { CommandResult } from '../../shared/engine/commands';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import { IPC, type InvokeChannel } from '../../shared/ipc';
import { SIMPLE_MODE_REFUSAL } from '../../shared/mode';
import { DEVICE_OPS, type DeviceOp } from '../../shared/network-api';
import { PLAIN, type PictureLook } from '../../shared/picture-look';
import type { QuickPin } from '../../shared/quick-bar';
import type { WallpapersView } from '../../shared/wallpapers';
import { openDatabase } from '../db/database';
import { DeviceRepo } from '../db/devices';
import { SIMPLE_MODE_BOUNDED, SIMPLE_MODE_LOCKED, type SimpleScope, simpleModeBounds } from '../simple-mode';
import type { SimplePhoneScope } from '../simple-mode-phones';
import { NetworkService, OP_CHANNEL } from './network-service';

/*
 * The phone (Session 55, Part 9): what Parts 4–8 gave the operator window that a phone can do too, each a request of
 * its own, checked as every phone request is (Drashti let in, the device and its kind, Simple Mode) and done by the very
 * functions the window's own requests call (stand-ins here, which record what they were asked): the wallpapers, the
 * quick bar, a picture's look, Rename… and a video row's When it ends. In Simple Mode a phone does what Simple Mode's
 * window does: the wallpapers, and its one playlist's rows' Rename and Remove (with Undo), each within the window's own
 * bounds; the rest is refused before anything runs. And the hall tells a phone about Simple Mode, so it shows only what
 * Simple Mode allows. Placeholder names, made-up ids.
 */

const PHONE = '192.168.1.20';

const PHONE_WORDS =
  'Simple Mode on Drashti’s computer: a phone does only what Simple Mode does there (its playlist “Sabha, 30 Oct 2026”, Next and Back, Clear all, Black-out and the Wallpaper). On the Drashti computer, a double-click on Pro Mode leaves it.';

/** Simple Mode's one playlist: a talk and a picture; another playlist has a kirtan and a video. */
const ROWS: Record<string, { playlist: string; presentation?: string; media?: string }> = {
  'one-talk': { playlist: 'one', presentation: 'p-talk' },
  'one-picture': { playlist: 'one', media: 'm-picture' },
  'other-kirtan': { playlist: 'other', presentation: 'p-kirtan' },
  'other-video': { playlist: 'other', media: 'm-video' },
};
const SCOPE: SimpleScope = {
  playlistId: 'one',
  playlistOf: (itemId) => ROWS[itemId]?.playlist ?? null,
  holdsMedia: (mediaId) => Object.values(ROWS).some((r) => r.playlist === 'one' && r.media === mediaId),
  holdsPresentation: (id) => Object.values(ROWS).some((r) => r.playlist === 'one' && r.presentation === id),
};
const SIMPLE: SimplePhoneScope = {
  ...SCOPE,
  plays: (id) => SCOPE.holdsPresentation(id),
  refusal: () => PHONE_WORDS,
};

const WALLPAPERS: WallpapersView = {
  wallpapers: [
    {
      id: 'w-1',
      name: 'Placeholder dusk',
      pictures: [{ mediaId: 'm-picture', name: 'Placeholder backdrop', missing: false }],
      secondsEach: 10,
      fadeMs: 1500,
    },
    {
      id: 'w-2',
      name: 'Placeholder round',
      pictures: [
        { mediaId: 'm-a', name: 'Placeholder a', missing: false },
        { mediaId: 'm-b', name: 'Placeholder b', missing: true },
      ],
      secondsEach: 8,
      fadeMs: 1000,
    },
  ],
  chosenId: 'w-1',
  quotesToDraw: null,
};

const PIN: QuickPin = { kind: 'media', mediaId: 'm-picture', media: 'image', label: 'Placeholder backdrop' };

interface Call {
  what: string;
  args: unknown[];
}

function setup(options: { simple?: boolean; letIn?: boolean } = {}) {
  const db = openDatabase(':memory:');
  const devices = new DeviceRepo(db);
  const calls: Call[] = [];
  let simple = options.simple === true;
  let letIn = options.letIn ?? true;
  let clock = 1_000_000;
  let pins: QuickPin[] = [PIN];
  const bounds = simpleModeBounds(() => SCOPE);
  const record =
    <T>(what: string, answer: T) =>
    (...args: unknown[]): T => {
      calls.push({ what, args });
      return answer;
    };
  const state = initialEngineState();
  const service = new NetworkService({
    devices,
    settings: { get: () => undefined, set: () => undefined },
    spawn: () => {
      throw new Error('no worker here');
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
      dispatch: (): CommandResult => ({ ok: true, changed: true, rev: 1 }),
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
      hall: () => ({ groupId: 'hall-group' }),
      switches: () => ({ audience: true, stage: true }),
      clockStyle: () => ({ locale: 'en-GB', timeZone: 'Europe/London' }),
      shastraTexts: () => [],
      passage: () => ({ ok: false, message: 'No.' }),
    },
    mirror: {
      media: () => [],
      lowerThirds: () => [],
      music: () => [],
      keys: () => ({ platform: 'darwin', singleKeys: true }),
      repeatStep: () => null,
    },
    playMusic: () => ({ ok: true as const }),
    announcements: {
      submit: () => ({ status: 202, body: { ok: true } }),
      statusFor: () => ({ status: 404, body: { ok: false } }),
    },
    // The playlists' changes a phone makes as the window does (Session 54), recorded.
    desktop: {
      screens: {
        snapshot: () => ({ displays: [], groups: [], status: [], nodes: [], uses: [] }),
        controlsDisplayId: () => null,
        createGroup: () => ({ ok: false, message: 'No.' }),
        renameGroup: () => ({ ok: false, message: 'No.' }),
        setGroupRole: () => ({ ok: false, message: 'No.' }),
        deleteGroup: () => ({ ok: false, message: 'No.' }),
        assignDisplay: () => ({ ok: false, message: 'No.' }),
        updateScreen: () => ({ ok: false, message: 'No.' }),
        setDisplayJob: () => ({ ok: false, message: 'No.' }),
        removeScreen: () => ({ ok: false, message: 'No.' }),
        identify: () => undefined,
        pending: () => null,
        keep: () => ({ ok: false, message: 'No.' }),
        goBack: () => ({ ok: false, message: 'No.' }),
      },
      switches: {
        get: () => ({ audience: true, stage: true }),
        asksFirst: () => false,
        turn: () => ({ ok: false, message: 'No.' }),
      },
      inputs: {
        view: () => ({ inputs: [] }),
        access: () => 'granted',
        cameras: () => null,
        add: () => ({ ok: false, message: 'No.' }),
        update: () => ({ ok: false, message: 'No.' }),
        remove: () => ({ ok: false, message: 'No.' }),
      },
      windows: {
        list: () => Promise.resolve({ ok: true, windows: [] }),
        show: () => ({ ok: false }) as never,
      },
      library: {
        newFromWords: () => ({ ok: false, message: 'No.' }),
        removePresentations: () => ({ ok: false, message: 'No.' }),
        restorePresentations: () => ({ ok: false, message: 'No.' }),
        playlists: () => ({
          create: () => ({ ok: false, message: 'No.' }),
          rename: () => ({ ok: false, message: 'No.' }),
          remove: () => ({ ok: false, message: 'No.' }),
          restore: () => ({ ok: false, message: 'No.' }),
          addItems: () => ({ ok: false, message: 'No.' }),
          moveItems: () => ({ ok: false, message: 'No.' }),
          removeItems: (ids) => {
            calls.push({ what: 'removeItems', args: [ids] });
            return { ok: true, ids: ids as string[] };
          },
          restoreItems: (ids) => {
            calls.push({ what: 'restoreItems', args: [ids] });
            return { ok: true, ids: ids as string[] };
          },
          setWhenEnds: () => ({ ok: false, message: 'No.' }),
        }),
      },
      simple: () => simple,
      confirmCover: () => Promise.resolve(false),
    },
    // The phone's own (Part 9), each recorded and answered as the window's own request is.
    phone: {
      wallpapers: {
        view: () => WALLPAPERS,
        choose: record('chooseWallpaper', { ok: true as const, ids: ['w-2'] }),
        rename: record('renameWallpaper', { ok: true as const, ids: ['w-1'] }),
        remove: record('removeWallpaper', { ok: true as const, ids: ['w-1'] }),
        restore: record('restoreWallpaper', { ok: true as const, ids: ['w-1'] }),
      },
      quickBar: {
        view: () => pins,
        set: (next: QuickPin[]) => {
          calls.push({ what: 'setPins', args: [next] });
          pins = next;
          return { ok: true as const, pins };
        },
      },
      looks: {
        look: (mediaId: string): PictureLook | null =>
          mediaId === 'm-picture' ? { ...PLAIN, turn: 90, size: { width: 320, height: 180 } } : null,
        photo: (mediaId: string) => mediaId === 'm-picture',
        set: record('setLook', { ok: true as const }),
      },
      rename: {
        media: record('renameMedia', { ok: true as const }),
        presentation: record('renamePresentation', { ok: true as const }),
      },
      whenEnds: record('whenEnds', { ok: true as const, ids: ['other-video'] }),
    },
    // As refusalFor answers, with the arguments given (ipc/handle.ts): Simple Mode's lock and its bounds.
    refused: (channel: InvokeChannel, args?: readonly unknown[]) =>
      simple &&
      (SIMPLE_MODE_LOCKED.includes(channel) ||
        (SIMPLE_MODE_BOUNDED.has(channel) && !(args !== undefined && bounds.get(channel)?.(args) === true))),
    refusal: () => SIMPLE_MODE_REFUSAL,
    simple: () => (simple ? SIMPLE : null),
    changed: () => undefined,
    log: () => undefined,
    now: () => clock,
    letIn: () => letIn,
  });
  const remote = service.pairForCheck('remote', 'Placeholder phone').id;
  const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
  const poster = service.pairForCheck('announcements', 'Placeholder poster').id;
  const ask = (deviceId: string, op: DeviceOp, args: Record<string, unknown> = {}) => {
    clock += 1000;
    return service.answer({ address: PHONE, deviceId, op, args });
  };
  return {
    service,
    calls,
    remote,
    stage,
    poster,
    ask,
    setSimple: (on: boolean) => {
      simple = on;
    },
    setLetIn: (on: boolean) => {
      letIn = on;
    },
    pins: () => pins,
  };
}

/** The phone's own requests (Part 9). */
const PHONE_OPS = [
  'wallpapers',
  'wallpaper.choose',
  'wallpaper.rename',
  'wallpaper.remove',
  'wallpaper.restore',
  'quickBar',
  'quickBar.set',
  'media.look',
  'media.setLook',
  'media.rename',
  'presentation.rename',
  'playlist.whenEnds',
] as const;

describe('the phone’s own requests (Session 55, Part 9)', () => {
  it('reads the wallpapers, and chooses, renames, deletes and puts one back as the window’s own requests do', () => {
    const { ask, remote, calls } = setup();
    const read = ask(remote, 'wallpapers');
    expect(read).toEqual({
      status: 200,
      body: {
        ok: true,
        chosenId: 'w-1',
        wallpapers: [
          {
            id: 'w-1',
            name: 'Placeholder dusk',
            pictures: [{ mediaId: 'm-picture', name: 'Placeholder backdrop', missing: false }],
          },
          {
            id: 'w-2',
            name: 'Placeholder round',
            pictures: [
              { mediaId: 'm-a', name: 'Placeholder a', missing: false },
              { mediaId: 'm-b', name: 'Placeholder b', missing: true },
            ],
          },
        ],
      },
    });
    // Each answered with the wallpapers as they are after it (the phone draws them again at once).
    expect(ask(remote, 'wallpaper.choose', { wallpaperId: 'w-2' })).toMatchObject({
      status: 200,
      body: { ok: true, ids: ['w-2'], chosenId: 'w-1' },
    });
    expect(ask(remote, 'wallpaper.choose', { wallpaperId: null }).status).toBe(200);
    expect(ask(remote, 'wallpaper.rename', { wallpaperId: 'w-1', name: '  Placeholder dawn ' }).status).toBe(
      200,
    );
    expect(ask(remote, 'wallpaper.remove', { wallpaperId: 'w-1' }).status).toBe(200);
    expect(ask(remote, 'wallpaper.restore', { wallpaperId: 'w-1' }).status).toBe(200);
    expect(calls.map((c) => [c.what, c.args])).toEqual([
      ['chooseWallpaper', ['w-2']],
      ['chooseWallpaper', [null]],
      ['renameWallpaper', ['w-1', 'Placeholder dawn']],
      ['removeWallpaper', ['w-1']],
      ['restoreWallpaper', ['w-1']],
    ]);
  });

  it('reads the quick bar’s pins and changes the bar whole, as the window does: at most 8, each once', () => {
    const { ask, remote, calls, pins } = setup();
    expect(ask(remote, 'quickBar')).toEqual({ status: 200, body: { ok: true, pins: [PIN] } });
    const slide: QuickPin = {
      kind: 'slide',
      presentationId: 'p-talk',
      slideId: 's-3',
      playlistId: 'one',
      itemId: 'one-talk',
      label: 'Placeholder talk_3',
    };
    expect(ask(remote, 'quickBar.set', { pins: [slide, PIN] })).toEqual({
      status: 200,
      body: { ok: true, pins: [slide, PIN] },
    });
    expect(pins()).toEqual([slide, PIN]);
    // Nine, the same twice, or a pin that is not one: refused, the bar as it was.
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...PIN, mediaId: `m-${String(i)}` }));
    for (const bad of [nine, [PIN, PIN], [{ kind: 'file', path: '/placeholder/file.png', label: 'x' }]])
      expect(ask(remote, 'quickBar.set', { pins: bad }).status, JSON.stringify(bad)).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it('reads a picture’s kept look and whether it is a photo, and keeps one as the Picture editor’s Save does', () => {
    const { ask, remote, calls } = setup();
    expect(ask(remote, 'media.look', { mediaId: 'm-picture' })).toEqual({
      status: 200,
      body: { ok: true, look: { ...PLAIN, turn: 90, size: { width: 320, height: 180 } }, photo: true },
    });
    expect(ask(remote, 'media.look', { mediaId: 'm-other' })).toEqual({
      status: 200,
      body: { ok: true, look: null, photo: false },
    });
    const turned: PictureLook = {
      ...PLAIN,
      turn: 180,
      flipX: true,
      crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      cropShape: '1:1',
      size: { width: 320, height: 180 },
      fill: false,
    };
    expect(ask(remote, 'media.setLook', { mediaId: 'm-picture', look: turned }).status).toBe(200);
    // As it was taken: no look at all.
    expect(ask(remote, 'media.setLook', { mediaId: 'm-picture', look: null }).status).toBe(200);
    // A look it cannot keep: refused.
    for (const look of [{ ...PLAIN, zoom: 9 }, { ...PLAIN, turn: 45 }, 'plain'])
      expect(ask(remote, 'media.setLook', { mediaId: 'm-picture', look }).status, JSON.stringify(look)).toBe(
        400,
      );
    expect(calls.map((c) => [c.what, c.args])).toEqual([
      ['setLook', ['m-picture', turned]],
      ['setLook', ['m-picture', null]],
    ]);
  });

  it('renames a picture, video, sound or presentation as Rename… does, and sets a video row’s When it ends', () => {
    const { ask, remote, calls } = setup();
    expect(ask(remote, 'media.rename', { mediaId: 'm-video', name: ' Placeholder clip, cut ' }).status).toBe(
      200,
    );
    expect(
      ask(remote, 'presentation.rename', { presentationId: 'p-kirtan', name: 'Placeholder' }).status,
    ).toBe(200);
    expect(ask(remote, 'playlist.whenEnds', { itemId: 'other-video', whenEnds: 'loop' }).status).toBe(200);
    for (const [op, args] of [
      ['media.rename', { mediaId: 'm-video', name: '   ' }],
      ['media.rename', { mediaId: 'm-video', name: 'x'.repeat(201) }],
      ['presentation.rename', { presentationId: 'p-kirtan' }],
      ['playlist.whenEnds', { itemId: 'other-video', whenEnds: 'forever' }],
      // Never anything but what it names: a path, say.
      ['media.rename', { mediaId: 'm-video', name: 'Placeholder', path: '/placeholder/file.mp4' }],
    ] as const)
      expect(ask(remote, op, args as Record<string, unknown>).status, JSON.stringify(args)).toBe(400);
    expect(calls.map((c) => [c.what, c.args])).toEqual([
      ['renameMedia', ['m-video', 'Placeholder clip, cut']],
      ['renamePresentation', ['p-kirtan', 'Placeholder']],
      ['whenEnds', ['other-video', 'loop']],
    ]);
  });

  it('is a Remote’s alone (never a Stage device or the announcements poster), and nothing while Drashti is not let in', () => {
    const { ask, remote, stage, poster, calls, setLetIn } = setup();
    for (const op of PHONE_OPS) {
      expect(DEVICE_OPS[op], op).toEqual(['remote']);
      expect(ask(stage, op, { wallpaperId: 'w-1' }).status, op).toBe(403);
      expect(ask(poster, op, { wallpaperId: 'w-1' }).status, op).toBe(403);
    }
    setLetIn(false);
    for (const op of PHONE_OPS)
      expect(ask(remote, op, { wallpaperId: 'w-1' }), op).toMatchObject({
        status: 503,
        body: { message: STOPPED_REFUSAL },
      });
    expect(calls).toEqual([]);
  });

  it('limits a phone’s changes, thirty at once, as a person tapping makes them; reading is never limited', () => {
    const { service, remote, calls } = setup();
    const at = (op: DeviceOp, args: Record<string, unknown>) =>
      service.answer({ address: PHONE, deviceId: remote, op, args }).status;
    for (let i = 0; i < 30; i += 1)
      expect(at('wallpaper.choose', { wallpaperId: 'w-1' }), `change ${String(i + 1)}`).toBe(200);
    expect(at('wallpaper.choose', { wallpaperId: 'w-1' })).toBe(429);
    expect(at('wallpapers', {})).toBe(200);
    expect(calls).toHaveLength(30);
  });

  it('in Simple Mode: the wallpapers, and its one playlist’s rows’ Rename and Remove with Undo, as its window does; the rest refused before anything runs', () => {
    const { ask, remote, calls } = setup({ simple: true });
    // The wallpapers: Simple Mode's window has them (Part 18), all but their seconds and fade.
    for (const [op, args] of [
      ['wallpapers', {}],
      ['wallpaper.choose', { wallpaperId: 'w-2' }],
      ['wallpaper.rename', { wallpaperId: 'w-1', name: 'Placeholder dawn' }],
      ['wallpaper.remove', { wallpaperId: 'w-1' }],
      ['wallpaper.restore', { wallpaperId: 'w-1' }],
    ] as const)
      expect(ask(remote, op, args).status, op).toBe(200);
    // Its one playlist's rows: renamed, taken out and put back (Undo), as its window's right-click menu does.
    expect(ask(remote, 'media.rename', { mediaId: 'm-picture', name: 'Placeholder dawn' }).status).toBe(200);
    expect(ask(remote, 'presentation.rename', { presentationId: 'p-talk', name: 'Placeholder' }).status).toBe(
      200,
    );
    expect(ask(remote, 'playlist.removeItems', { ids: ['one-picture'] }).status).toBe(200);
    expect(ask(remote, 'playlist.restoreItems', { ids: ['one-picture'] }).status).toBe(200);
    // Another playlist's, or a file it does not hold: refused, as its window is.
    for (const [op, args] of [
      ['media.rename', { mediaId: 'm-video', name: 'Placeholder' }],
      ['presentation.rename', { presentationId: 'p-kirtan', name: 'Placeholder' }],
      ['playlist.removeItems', { ids: ['other-video'] }],
      ['playlist.removeItems', { ids: ['one-picture', 'other-video'] }],
      ['playlist.restoreItems', { ids: ['other-kirtan'] }],
    ] as const)
      expect(ask(remote, op, args as Record<string, unknown>).status, JSON.stringify(args)).toBe(403);
    // Pro Mode's, in the window's own words (Simple Mode's lock): the quick bar's changes, the Picture editor, When it
    // ends. Reading the bar and a look stays.
    for (const [op, args] of [
      ['quickBar.set', { pins: [] }],
      ['media.setLook', { mediaId: 'm-picture', look: null }],
      ['playlist.whenEnds', { itemId: 'one-picture', whenEnds: 'loop' }],
    ] as const)
      expect(ask(remote, op, args as Record<string, unknown>), op).toEqual({
        status: 403,
        body: { ok: false, message: SIMPLE_MODE_REFUSAL },
      });
    expect(ask(remote, 'quickBar').status).toBe(200);
    expect(ask(remote, 'media.look', { mediaId: 'm-picture' }).status).toBe(200);
    expect(calls.map((c) => [c.what, c.args])).toEqual([
      ['chooseWallpaper', ['w-2']],
      ['renameWallpaper', ['w-1', 'Placeholder dawn']],
      ['removeWallpaper', ['w-1']],
      ['restoreWallpaper', ['w-1']],
      ['renameMedia', ['m-picture', 'Placeholder dawn']],
      ['renamePresentation', ['p-talk', 'Placeholder']],
      ['removeItems', [['one-picture']]],
      ['restoreItems', [['one-picture']]],
    ]);
  });

  it('each of its requests is the window’s own, so Simple Mode’s lock is asked of it (a bounded one with the phone’s arguments)', () => {
    expect(OP_CHANNEL['wallpaper.choose']).toBe(IPC.wallpapers.choose);
    expect(OP_CHANNEL['wallpaper.rename']).toBe(IPC.wallpapers.rename);
    expect(OP_CHANNEL['wallpaper.remove']).toBe(IPC.wallpapers.remove);
    expect(OP_CHANNEL['wallpaper.restore']).toBe(IPC.wallpapers.restore);
    expect(OP_CHANNEL['quickBar.set']).toBe(IPC.quickBar.set);
    expect(OP_CHANNEL['media.setLook']).toBe(IPC.media.setLook);
    expect(OP_CHANNEL['media.rename']).toBe(IPC.media.rename);
    expect(OP_CHANNEL['presentation.rename']).toBe(IPC.library.renamePresentation);
    expect(OP_CHANNEL['playlist.whenEnds']).toBe(IPC.playlists.setWhenEnds);
  });
});

describe('Simple Mode, as the hall tells a phone (Session 55, Part 9)', () => {
  it('says Simple Mode is on, its one playlist and the words the phone shows once; in Pro Mode, nothing', () => {
    const { ask, remote, setSimple } = setup({ simple: true });
    expect(ask(remote, 'hall')).toMatchObject({
      status: 200,
      body: { ok: true, simple: { playlistId: 'one', words: PHONE_WORDS } },
    });
    setSimple(false);
    expect(ask(remote, 'hall')).toMatchObject({ status: 200, body: { ok: true, simple: null } });
  });
});
