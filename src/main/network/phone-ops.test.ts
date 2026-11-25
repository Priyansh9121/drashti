import { describe, expect, it } from 'vitest';
import { STOPPED_REFUSAL } from '../../shared/access';
import type { CommandResult } from '../../shared/engine/commands';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import { IPC, type InvokeChannel } from '../../shared/ipc';
import { SIMPLE_MODE_REFUSAL } from '../../shared/mode';
import { DEVICE_OPS, type DeviceOp } from '../../shared/network-api';
import { PHONE_REFUSAL, phoneOpRefusal } from '../../shared/phone-rule';
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
 *
 * Since alpha.23 (QA23-PHONE-1, the owner's "Only PPT and PDF") a Remote is refused each of them, in both modes: the
 * tests below show each refused and nothing done; a Stage device, the poster and the hall as before.
 */

const PHONE = '192.168.1.20';

const PHONE_WORDS =
  'Simple Mode on Drashti’s computer: a phone does only what Simple Mode does there (playlists, playback and Audio). On the Drashti computer, a double-click on Pro Mode leaves it.';

/** Simple Mode's one playlist: a talk and a picture; another playlist has a kirtan and a video. */
const ROWS: Record<string, { playlist: string; presentation?: string; media?: string }> = {
  'one-talk': { playlist: 'one', presentation: 'p-talk' },
  'one-picture': { playlist: 'one', media: 'm-picture' },
  'other-kirtan': { playlist: 'other', presentation: 'p-kirtan' },
  'other-video': { playlist: 'other', media: 'm-video' },
  'template-video': { playlist: 'template', media: 'm-template' },
};
const SCOPE: SimpleScope = {
  playlistId: 'one',
  playlistOf: (itemId) => ROWS[itemId]?.playlist ?? null,
  holdsMedia: (mediaId) => Object.values(ROWS).some((r) => r.playlist === 'one' && r.media === mediaId),
  holdsPresentation: (id) => Object.values(ROWS).some((r) => r.playlist === 'one' && r.presentation === id),
  kindOf: (id) => (id === 'one' || id === 'other' ? 'playlist' : id === 'template' ? 'template' : null),
  listsMedia: (mediaId) => Object.values(ROWS).some((r) => r.playlist !== 'template' && r.media === mediaId),
  listsPresentation: (id) => Object.values(ROWS).some((r) => r.presentation === id),
};
const active = {
  activePlaylist: (id: string) => SCOPE.kindOf(id) === 'playlist',
  activeItem: (id: string, itemId: string) => ROWS[itemId]?.playlist === id,
};
const SIMPLE: SimplePhoneScope = {
  ...SCOPE,
  ...active,
  plays: (id) => SCOPE.listsPresentation(id),
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

/**
 * QA23-PHONE-1 (the owner's "Only PPT and PDF", shared/phone-rule.ts): each of these, from a Remote, refused before
 * anything runs, 403 in its group's words, in Pro Mode and Simple Mode alike; the handlers (phone-answers.ts) stay until
 * alpha.24, no phone reaching them.
 */
const refusal = (op: DeviceOp, words: keyof typeof PHONE_REFUSAL) => {
  expect(phoneOpRefusal(op, false), op).toBe(PHONE_REFUSAL[words]);
  return { status: 403, body: { ok: false, message: PHONE_REFUSAL[words] } };
};

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
  it('never reads, chooses, renames, deletes or puts back a wallpaper from a phone (QA23-PHONE-1)', () => {
    const { ask, remote, calls } = setup();
    for (const [op, args] of [
      ['wallpapers', {}],
      ['wallpaper.choose', { wallpaperId: 'w-2' }],
      ['wallpaper.choose', { wallpaperId: null }],
      ['wallpaper.rename', { wallpaperId: 'w-1', name: '  Placeholder dawn ' }],
      ['wallpaper.rename', { wallpaperId: 'w-1', name: 'Placeholder\u202E dawn\u200F' }],
      ['wallpaper.rename', { wallpaperId: 'w-1', name: '\u200B\u2060' }],
      ['wallpaper.remove', { wallpaperId: 'w-1' }],
      ['wallpaper.restore', { wallpaperId: 'w-1' }],
    ] as const)
      expect(ask(remote, op, args), JSON.stringify(args)).toEqual(refusal(op, 'media'));
    expect(calls).toEqual([]);
  });

  it('never reads or changes the quick bar from a phone, a good bar or a bad one', () => {
    const { ask, remote, calls, pins } = setup();
    expect(ask(remote, 'quickBar')).toEqual(refusal('quickBar', 'computer'));
    const slide: QuickPin = {
      kind: 'slide',
      presentationId: 'p-talk',
      slideId: 's-3',
      playlistId: 'one',
      itemId: 'one-talk',
      label: 'Placeholder talk_3',
    };
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...PIN, mediaId: `m-${String(i)}` }));
    for (const bar of [
      [slide, PIN],
      nine,
      [PIN, PIN],
      [{ kind: 'file', path: '/placeholder/file.png', label: 'x' }],
    ])
      expect(ask(remote, 'quickBar.set', { pins: bar }), JSON.stringify(bar)).toEqual(
        refusal('quickBar.set', 'computer'),
      );
    expect(pins()).toEqual([PIN]);
    expect(calls).toEqual([]);
  });

  it('never reads or keeps a picture’s look from a phone', () => {
    const { ask, remote, calls } = setup();
    expect(ask(remote, 'media.look', { mediaId: 'm-picture' })).toEqual(refusal('media.look', 'media'));
    expect(ask(remote, 'media.look', { mediaId: 'm-other' })).toEqual(refusal('media.look', 'media'));
    const turned: PictureLook = {
      ...PLAIN,
      turn: 180,
      flipX: true,
      crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      cropShape: '1:1',
      size: { width: 320, height: 180 },
      fill: false,
    };
    for (const look of [turned, null, { ...PLAIN, zoom: 9 }, { ...PLAIN, turn: 45 }, 'plain'])
      expect(ask(remote, 'media.setLook', { mediaId: 'm-picture', look }), JSON.stringify(look)).toEqual(
        refusal('media.setLook', 'media'),
      );
    expect(calls).toEqual([]);
  });

  it('never renames a picture, video, sound or presentation from a phone, nor sets a video row’s When it ends', () => {
    const { ask, remote, calls } = setup();
    for (const [op, args, words] of [
      ['media.rename', { mediaId: 'm-video', name: ' Placeholder clip, cut ' }, 'media'],
      ['presentation.rename', { presentationId: 'p-kirtan', name: 'Placeholder' }, 'computer'],
      ['playlist.whenEnds', { itemId: 'other-video', whenEnds: 'loop' }, 'computer'],
      ['media.rename', { mediaId: 'm-video', name: '   ' }, 'media'],
      ['media.rename', { mediaId: 'm-video', name: 'x'.repeat(201) }, 'media'],
      ['media.rename', { mediaId: 'm-video', name: '\u200B' }, 'media'],
      ['presentation.rename', { presentationId: 'p-kirtan', name: '\u200D \u00AD' }, 'computer'],
      ['presentation.rename', { presentationId: 'p-kirtan' }, 'computer'],
      ['playlist.whenEnds', { itemId: 'other-video', whenEnds: 'forever' }, 'computer'],
      ['media.rename', { mediaId: 'm-video', name: 'Placeholder', path: '/placeholder/file.mp4' }, 'media'],
    ] as const)
      expect(ask(remote, op, args as Record<string, unknown>), JSON.stringify(args)).toEqual(
        refusal(op, words),
      );
    expect(calls).toEqual([]);
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

  it('refuses a phone’s changes before its limit counts them, and its reading too: never 429', () => {
    const { service, remote, calls } = setup();
    const at = (op: DeviceOp, args: Record<string, unknown>) =>
      service.answer({ address: PHONE, deviceId: remote, op, args });
    for (let i = 0; i < 31; i += 1)
      expect(at('wallpaper.choose', { wallpaperId: 'w-1' }), `change ${String(i + 1)}`).toEqual(
        refusal('wallpaper.choose', 'media'),
      );
    expect(at('wallpapers', {})).toEqual(refusal('wallpapers', 'media'));
    expect(calls).toEqual([]);
  });

  it('in Simple Mode too, each refused in the phone rule’s words, never the window lock’s, before anything runs', () => {
    const { ask, remote, calls } = setup({ simple: true });
    for (const [op, args, words] of [
      ['wallpapers', {}, 'media'],
      ['wallpaper.choose', { wallpaperId: 'w-2' }, 'media'],
      ['wallpaper.rename', { wallpaperId: 'w-1', name: 'Placeholder dawn' }, 'media'],
      ['wallpaper.remove', { wallpaperId: 'w-1' }, 'media'],
      ['wallpaper.restore', { wallpaperId: 'w-1' }, 'media'],
      ['media.rename', { mediaId: 'm-picture', name: 'Placeholder dawn' }, 'media'],
      ['presentation.rename', { presentationId: 'p-talk', name: 'Placeholder' }, 'computer'],
      ['media.rename', { mediaId: 'm-video', name: 'Placeholder video' }, 'media'],
      ['presentation.rename', { presentationId: 'p-kirtan', name: 'Placeholder talk' }, 'computer'],
      ['playlist.removeItems', { ids: ['one-picture', 'other-video'] }, 'computer'],
      ['playlist.restoreItems', { ids: ['one-picture', 'other-video'] }, 'computer'],
      ...(['wallpaper', 'next', 'loop', 'freeze'] as const).map(
        (whenEnds) => ['playlist.whenEnds', { itemId: 'other-video', whenEnds }, 'computer'] as const,
      ),
      ['media.rename', { mediaId: 'm-template', name: 'Placeholder' }, 'media'],
      ['playlist.removeItems', { ids: ['one-picture', 'template-video'] }, 'computer'],
      ['playlist.restoreItems', { ids: ['template-video'] }, 'computer'],
      ['playlist.whenEnds', { itemId: 'template-video', whenEnds: 'loop' }, 'computer'],
      ['quickBar.set', { pins: [] }, 'computer'],
      ['media.setLook', { mediaId: 'm-picture', look: null }, 'media'],
      ['quickBar', {}, 'computer'],
      ['media.look', { mediaId: 'm-picture' }, 'media'],
    ] as const)
      expect(ask(remote, op, args), JSON.stringify(args)).toEqual(refusal(op, words));
    expect(calls).toEqual([]);
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
