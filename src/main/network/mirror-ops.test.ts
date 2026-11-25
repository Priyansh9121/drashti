import { describe, expect, it, vi } from 'vitest';
import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import { IPC, type InvokeChannel } from '../../shared/ipc';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../shared/lower-thirds';
import { SIMPLE_MODE_REFUSAL, simpleModeRefuses } from '../../shared/mode';
import type { MusicView } from '../../shared/music';
import { DEVICE_OPS, type DeviceOp, REMOTE_COMMANDS } from '../../shared/network-api';
import type { RemoteMedia } from '../../shared/network-mirror';
import { PHONE_REFUSAL, type PhoneWords } from '../../shared/phone-rule';
import { openDatabase } from '../db/database';
import { DeviceRepo } from '../db/devices';
import { SIMPLE_MODE_LOCKED, simpleModeBounds } from '../simple-mode';
import type { OscAction } from '../osc/mapping';
import type { SimplePhoneScope } from '../simple-mode-phones';
import { NetworkService, OP_CHANNEL } from './network-service';

/*
 * The phone as a mirror of the operator window (Session 54, D5): a Remote reads the library's media, lower thirds
 * and audio playlists (its props and masks went in Session 55), and the keys the window answers; puts each up by its
 * id, as the main process reads it from the library, and takes it off; shows a timer alone, the stage message,
 * Back 15 s and the rest. Never a Stage or Announcements device, and Simple Mode's refusals as in the window.
 * Placeholder names, made-up ids.
 *
 * Since alpha.23 (QA23-PHONE-1, the owner: "no video access in either of simple or pro mode in phone ... only ppts an
 * pdfs") a phone may do none of it: each test proves a phone's refusal in the phone rule's words first, nothing run.
 * The mirror's commands keep their callers the rule never weighs (OSC and the paired controller: runShowAction);
 * the rest stays until alpha.24 deletes it with no other caller, so its own behaviour is tested with the rule aside.
 */

/** A phone's answer in the phone rule's words (shared/phone-rule.ts), before anything runs. */
const refusedAs = (words: PhoneWords) => ({
  status: 403,
  body: { ok: false, message: PHONE_REFUSAL[words] },
});

/**
 * A command or a message from the paired controller (x28) or OSC, which the phone rule never weighs. Sent as a test
 * writes it, unchecked: runShowAction checks it again, as it did a phone's.
 */
const fromController = (service: NetworkService, op: OscAction['op'], args: unknown) =>
  service.runShowAction({ op, args } as OscAction, 'the paired controller');

/** The phone rule (the private phoneRule) stood aside on this service only: the request as Main ran it before. */
function ruleAside(service: NetworkService): void {
  const inner = service as unknown as {
    phoneRule(op: DeviceOp, args: Record<string, unknown>): { args: Record<string, unknown> };
  };
  vi.spyOn(inner, 'phoneRule').mockImplementation((_op, args) => ({ args }));
}

const PHONE = '192.168.1.20';

/** What a phone is told in Simple Mode for what its window does not do (shared/mode.ts simplePhoneRefusalText). */
const PHONE_WORDS =
  'Simple Mode on Drashti’s computer: a phone does only what Simple Mode does there (playlists, playback and Audio). On the Drashti computer, a double-click on Pro Mode leaves it.';

/**
 * Simple Mode's one playlist (Session 55, Part 18): here the Repeat Slides playlist "repeat-1", adopted from Pro Mode,
 * with a picture (m-pic) in it. A phone does only what Simple Mode's window does (the owner's answer of 30 Oct 2026).
 */
const repeatLists = {
  kindOf: (id: string) =>
    id === 'repeat-1' || id === 'repeat-2'
      ? ('playlist' as const)
      : id === 'template'
        ? ('template' as const)
        : null,
  listsMedia: (id: string) => id === 'm-pic',
  listsPresentation: () => false,
  activePlaylist: (id: string) => id === 'repeat-1' || id === 'repeat-2',
  activeItem: (id: string, itemId: string) => id === 'repeat-1' && ['item-1', 'item-2'].includes(itemId),
};
const ONE: SimplePhoneScope = {
  ...repeatLists,
  playlistId: 'repeat-1',
  playlistOf: (itemId) => (['item-1', 'item-2'].includes(itemId) ? 'repeat-1' : null),
  holdsMedia: (mediaId) => mediaId === 'm-pic',
  holdsPresentation: () => false,
  plays: () => false,
  refusal: () => PHONE_WORDS,
};

const MEDIA: RemoteMedia[] = [
  { id: 'm-pic', name: 'Placeholder picture', kind: 'image', missing: false, unplayable: null },
  { id: 'm-vid', name: 'Placeholder video', kind: 'video', missing: false, unplayable: null },
  { id: 'm-tune', name: 'Placeholder tune', kind: 'audio', missing: false, unplayable: null },
  { id: 'm-gone', name: 'Placeholder gone picture', kind: 'image', missing: true, unplayable: null },
  { id: 'm-heic', name: 'Placeholder phone photo', kind: 'image', missing: false, unplayable: 'HEIC' },
];

function setup(options: { locked?: boolean; lockEverything?: boolean } = {}) {
  const bounds = simpleModeBounds(() => ONE);
  const db = openDatabase(':memory:');
  const devices = new DeviceRepo(db);
  const commands: EngineCommand[] = [];
  const played: (string | null | undefined)[] = [];
  const audioView: MusicView = {
    playlists: [{ id: 'music-1', name: 'Placeholder tunes', loop: false, shuffle: false, tracks: [] }],
    lastId: null,
  };
  const audioCalls: unknown[][] = [];
  const playIndexes: (number | undefined)[] = [];
  let clock = 1_000_000;
  let stepsAside = true;
  const recordAudio =
    (action: string) =>
    (...args: unknown[]) => {
      audioCalls.push([action, ...args]);
      return { ok: true as const, id: 'music-1', view: audioView };
    };
  const audio = {
    music: {
      view: () => audioView,
      create: recordAudio('create'),
      rename: recordAudio('rename'),
      remove: recordAudio('remove'),
      restore: recordAudio('restore'),
      setOptions: recordAudio('options'),
      addTracks: recordAudio('addTracks'),
      moveTrack: recordAudio('moveTrack'),
      removeTrack: recordAudio('removeTrack'),
      restoreTrack: recordAudio('restoreTrack'),
    },
    stepsAside: () => stepsAside,
    setStepsAside: (on: boolean) => {
      stepsAside = on;
    },
  };
  const state = initialEngineState();
  const refused = (channel: InvokeChannel, args?: readonly unknown[]) => {
    if (options.lockEverything === true) return true;
    if (options.locked !== true) return false;
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
      dispatch: (c): CommandResult => {
        if (options.locked === true && simpleModeRefuses(c, state))
          return { ok: false, error: 'forbidden', message: SIMPLE_MODE_REFUSAL };
        commands.push(c);
        return { ok: true, changed: true, rev: commands.length };
      },
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
      switches: () => ({ audience: true, stage: true }),
      clockStyle: () => ({ locale: 'en-GB', timeZone: 'Europe/London' }),
      shastraTexts: () => [],
      passage: () => ({ ok: false, message: 'No texts.' }),
    },
    mirror: {
      media: () => MEDIA,
      lowerThirds: () => [
        {
          id: 'lt-1',
          lines: ['Placeholder Speaker', 'Placeholder title', ''],
          look: DEFAULT_LOWER_THIRD_LOOK,
          where: 'both',
          animation: 'fade',
        },
      ],
      music: () => [{ id: 'music-1', name: 'Placeholder tunes', trackCount: 3 }],
      keys: () => ({ platform: 'darwin', singleKeys: true }),
      // A Repeat Slides playlist's items, by their first step (Session 54, D5 review): its second item from step 2.
      repeatStep: (playlistId, itemId) =>
        playlistId === 'repeat-1'
          ? (({ 'item-1': 0, 'item-2': 2 } as Record<string, number>)[itemId] ?? null)
          : null,
    },
    audio,
    playMusic: (_who, playlistId, index) => {
      played.push(playlistId);
      playIndexes.push(index);
      return { ok: true as const };
    },
    announcements: {
      submit: () => ({ status: 202, body: { ok: true } }),
      statusFor: () => ({ status: 404, body: { ok: false } }),
    },
    refused,
    // Simple Mode as a phone's request is weighed (Session 55, the owner's answer of 30 Oct 2026).
    simple: () => (options.locked === true ? ONE : null),
    changed: () => undefined,
    log: () => undefined,
    now: () => clock,
  });
  const remote = service.pairForCheck('remote', 'Placeholder phone').id;
  const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
  const poster = service.pairForCheck('announcements', 'Placeholder poster').id;
  const ask = (deviceId: string, op: DeviceOp, args: Record<string, unknown> = {}) =>
    service.answer({ address: PHONE, deviceId, op, args });
  /** A command from the paired controller (x28) or OSC, which the phone rule never weighs. */
  const controller = (args: Record<string, unknown>) => fromController(service, 'command', args);
  const advance = (ms: number) => {
    clock += ms;
  };
  return {
    service,
    refused,
    commands,
    played,
    state,
    remote,
    stage,
    poster,
    ask,
    controller,
    audioView,
    audioCalls,
    playIndexes,
    advance,
  };
}

/** The new reads and the actions that put something up. */
const READS = ['keys', 'media', 'lowerThirds', 'music'] as const satisfies readonly DeviceOp[];
const PUTS = ['media.show', 'lowerThird.show'] as const satisfies readonly DeviceOp[];

it('refuses a bounded Simple Mode channel when no window arguments were supplied', () => {
  const { refused } = setup({ locked: true });
  expect(refused(IPC.library.importPaths, [])).toBe(false);
  expect(refused(IPC.library.importPaths)).toBe(true);
});

describe('the phone as a mirror of the operator window (Session 54, D5)', () => {
  it('refuses a Remote the media, the lower thirds, the audio playlists and the keys (QA23-PHONE-1); with the rule aside, they read as the window has them', () => {
    const { ask, remote, service } = setup();
    for (const [op, words] of [
      ['keys', 'computer'],
      ['lowerThirds', 'computer'],
      ['music', 'media'],
      ['media', 'media'],
    ] as const)
      expect(ask(remote, op), op).toEqual(refusedAs(words));
    ruleAside(service);
    expect(ask(remote, 'keys')).toEqual({
      status: 200,
      body: { ok: true, keys: { platform: 'darwin', singleKeys: true } },
    });
    expect(ask(remote, 'lowerThirds')).toEqual({
      status: 200,
      body: {
        ok: true,
        lowerThirds: [{ id: 'lt-1', lines: ['Placeholder Speaker', 'Placeholder title', ''] }],
      },
    });
    expect(ask(remote, 'music')).toEqual({
      status: 200,
      body: { ok: true, playlists: [{ id: 'music-1', name: 'Placeholder tunes', trackCount: 3 }] },
    });
    expect(ask(remote, 'media')).toEqual({
      status: 200,
      body: { ok: true, media: MEDIA, offset: 0, total: 5, query: '' },
    });
  });

  it('refuses a Remote the media’s pages (QA23-PHONE-1); with the rule aside, gives them a page at a time, found by the words of their names', () => {
    const { ask, remote, service } = setup();
    expect(ask(remote, 'media', { offset: '1', limit: '2' })).toEqual(refusedAs('media'));
    ruleAside(service);
    expect(ask(remote, 'media', { offset: '1', limit: '2' }).body).toMatchObject({
      media: [{ id: 'm-vid' }, { id: 'm-tune' }],
      offset: 1,
      total: 5,
    });
    expect(ask(remote, 'media', { query: ' PLACEHOLDER picture ' }).body).toMatchObject({
      media: [{ id: 'm-pic' }, { id: 'm-gone' }],
      total: 2,
      query: 'PLACEHOLDER picture',
    });
    expect(ask(remote, 'media', { limit: '5000' }).body).toMatchObject({ total: 5 });
    expect(ask(remote, 'media', { offset: '-4', limit: 'all' }).body).toMatchObject({ offset: 0, total: 5 });
  });

  it('puts up nothing from a Remote (QA23-PHONE-1); with the rule aside, a lower third, a picture, a video and a sound by its id, as the library has it', () => {
    const { ask, remote, commands, service } = setup();
    expect(ask(remote, 'lowerThird.show', { lowerThirdId: 'lt-1' })).toEqual(refusedAs('computer'));
    for (const mediaId of ['m-pic', 'm-vid', 'm-tune'])
      expect(ask(remote, 'media.show', { mediaId }), mediaId).toEqual(refusedAs('media'));
    expect(commands).toEqual([]);
    ruleAside(service);
    expect(ask(remote, 'lowerThird.show', { lowerThirdId: 'lt-1' }).status).toBe(200);
    expect(commands.at(-1)).toMatchObject({
      type: 'showLowerThird',
      lowerThird: { id: 'lt-1', lines: ['Placeholder Speaker', 'Placeholder title', ''] },
    });
    // A picture or a video goes up as a playlist's picture item does: the slide off, it the background.
    commands.length = 0;
    expect(ask(remote, 'media.show', { mediaId: 'm-pic' }).status).toBe(200);
    expect(ask(remote, 'media.show', { mediaId: 'm-vid' }).status).toBe(200);
    expect(ask(remote, 'media.show', { mediaId: 'm-tune' }).status).toBe(200);
    expect(commands).toEqual([
      { type: 'clearLayer', layer: 'slide' },
      {
        type: 'setBackground',
        background: { kind: 'media', mediaId: 'm-pic', media: 'image', fit: 'fit', loop: false },
      },
      { type: 'clearLayer', layer: 'slide' },
      {
        type: 'setBackground',
        background: { kind: 'media', mediaId: 'm-vid', media: 'video', fit: 'fit', loop: false },
      },
      // A sound plays as a playlist's sound item does, over whatever is up.
      {
        type: 'playAudio',
        audio: { id: 'm-tune', title: 'Placeholder tune', mediaId: 'm-tune', volume: 1, loop: false },
      },
    ]);
  });

  it('tells a Remote the phone rule’s words for any file (QA23-PHONE-1); with the rule aside, says why a missing file, one Drashti cannot play, or one no longer there does not go up', () => {
    const { ask, remote, commands, service } = setup();
    for (const mediaId of ['m-gone', 'm-heic', 'm-nothing'])
      expect(ask(remote, 'media.show', { mediaId }), mediaId).toEqual(refusedAs('media'));
    expect(ask(remote, 'lowerThird.show', { lowerThirdId: 'lt-nothing' })).toEqual(refusedAs('computer'));
    expect(commands).toEqual([]);
    ruleAside(service);
    expect(ask(remote, 'media.show', { mediaId: 'm-gone' })).toEqual({
      status: 409,
      body: { ok: false, message: '“Placeholder gone picture” is missing: Drashti cannot find its file.' },
    });
    expect(ask(remote, 'media.show', { mediaId: 'm-heic' })).toEqual({
      status: 409,
      body: {
        ok: false,
        message:
          'Drashti cannot play “Placeholder phone photo” as it is (HEIC): convert it in Drashti first.',
      },
    });
    expect(ask(remote, 'media.show', { mediaId: 'm-nothing' }).status).toBe(404);
    expect(ask(remote, 'lowerThird.show', { lowerThirdId: 'lt-nothing' }).status).toBe(404);
    for (const op of PUTS) expect(ask(remote, op, { mediaId: '../x', lowerThirdId: 7 }).status, op).toBe(404);
    expect(commands).toEqual([]);
  });

  it('refuses a Remote all of it (QA23-PHONE-1); from the paired controller, takes them off, and shows a timer alone, the stage message and the skips', () => {
    for (const locked of [false, true]) {
      const { ask, controller, remote, commands } = setup({ locked });
      const sent: Record<string, unknown>[] = [
        { type: 'hideLowerThird' },
        { type: 'showTimer', timerId: 'timer-1' },
        { type: 'setStageMessage', text: 'Placeholder: five minutes' },
        { type: 'clearStageMessage' },
        { type: 'skip', layer: 'background', jump: 'forward' },
        { type: 'skip', layer: 'audio', jump: 'back' },
      ];
      // A phone: in Simple Mode Simple Mode's words for any command; in Pro Mode the computer's or the media's.
      for (const args of sent)
        expect(ask(remote, 'command', args), JSON.stringify(args)).toEqual(
          refusedAs(locked ? 'simple' : args['type'] === 'skip' ? 'media' : 'computer'),
        );
      expect(commands).toEqual([]);
      // In Simple Mode: taking them off, as anything comes off the screens there. Back 15 s and the rest, which move
      // what plays, are Pro Mode's (Session 54's review: Simple Mode shows the time bar and moves nothing), and so are
      // a timer alone and the stage message since Session 55 (the owner's answer of 30 Oct 2026: a phone does only
      // what Simple Mode's window does, and its window has neither).
      const refused = (args: Record<string, unknown>) =>
        locked && ['skip', 'showTimer', 'setStageMessage'].includes(String(args['type']));
      for (const args of sent)
        expect(controller(args).status, JSON.stringify(args)).toBe(refused(args) ? 403 : 200);
      expect(commands).toEqual(sent.filter((args) => !refused(args)));
    }
  });

  it('in Simple Mode refuses a Remote Audio, lower thirds and Media in the phone rule’s words (QA23-PHONE-1); with the rule aside, plays Audio playlists and still refuses lower thirds and Media puts', () => {
    const { ask, remote, commands, played, state, service } = setup({ locked: true });
    expect(ask(remote, 'lowerThird.show', { lowerThirdId: 'lt-1' })).toEqual(refusedAs('computer'));
    expect(ask(remote, 'media.show', { mediaId: 'm-pic' })).toEqual(refusedAs('media'));
    expect(ask(remote, 'music.play', { playlistId: 'music-1' })).toEqual(refusedAs('media'));
    expect(ask(remote, 'command', { type: 'hideLowerThird' })).toEqual(refusedAs('simple'));
    expect(commands).toEqual([]);
    expect(played).toEqual([]);
    ruleAside(service);
    for (const [op, args] of [
      ['lowerThird.show', { lowerThirdId: 'lt-1' }],
      // Even a picture its one playlist has: Simple Mode's window puts up its rows, never Media's.
      ['media.show', { mediaId: 'm-pic' }],
      ['media.show', { mediaId: 'm-tune' }],
    ] as const)
      expect(ask(remote, op, args), `${op} ${JSON.stringify(args)}`).toEqual({
        status: 403,
        body: { ok: false, message: PHONE_WORDS },
      });
    // Not even Media's first step, the slide taken off.
    expect(commands).toEqual([]);
    expect(ask(remote, 'music.play', { playlistId: 'music-1' }).status).toBe(200);
    // Play with nothing paused starts the last audio playlist.
    expect(ask(remote, 'music.play', {}).status).toBe(200);
    // A paused track resumes from there.
    state.layers.audio = {
      id: 'track',
      title: 'Placeholder tune',
      mediaId: 'm-tune',
      volume: 1,
      loop: false,
      startedAt: 1,
      music: {
        playlistId: 'music-1',
        name: 'Placeholder tunes',
        tracks: [],
        index: 0,
        loop: false,
        shuffle: false,
      },
      pausedAtMs: 2000,
    };
    expect(ask(remote, 'music.play', {}).status).toBe(200);
    expect(ask(remote, 'music.play', { playlistId: 'music-1' }).status).toBe(200);
    expect(played).toEqual(['music-1', null, null, 'music-1']);
    // Taking a lower third off stays, so nothing can stay stuck on the screens.
    expect(ask(remote, 'command', { type: 'hideLowerThird' }).status).toBe(200);
    expect(commands).toEqual([{ type: 'hideLowerThird' }]);
  });

  it('never lets a Stage or Announcements device read or do any of it', () => {
    const { ask, stage, poster, commands } = setup();
    for (const device of [stage, poster]) {
      for (const op of [...READS, ...PUTS])
        expect(ask(device, op, { lowerThirdId: 'lt-1' }).status, op).toBe(403);
      for (const type of ['hideLowerThird', 'showTimer', 'setStageMessage', 'skip'])
        expect(ask(device, 'command', { type }).status, type).toBe(403);
    }
    for (const op of [...READS, ...PUTS]) expect(DEVICE_OPS[op], op).toEqual(['remote']);
    expect(commands).toEqual([]);
  });

  it('keeps a phone from sending what it puts up whole: a background, a sound or a lower third (the box’s setup goes by ids since Session 54, the phone as a full Drashti)', () => {
    const { ask, remote, commands } = setup();
    for (const args of [
      { type: 'setBackground', background: { kind: 'color', color: '#000000' } },
      {
        type: 'playAudio',
        audio: { id: 'a', title: 'Placeholder', mediaId: null, volume: 1, loop: false },
      },
    ])
      expect([400, 403], args.type).toContain(ask(remote, 'command', args).status);
    expect(commands).toEqual([]);
    for (const type of ['setBackground', 'playAudio', 'showLowerThird'])
      expect(REMOTE_COMMANDS as readonly string[], type).not.toContain(type);
  });

  it('starts no Repeat Slides from a Remote, in either mode (QA23-PHONE-1); with the rule aside, from its first step, a step given, or an item’s first step (D5 review)', () => {
    for (const locked of [false, true]) {
      const { ask, remote, stage, commands, service } = setup({ locked });
      for (const args of [{ playlistId: 'repeat-1' }, { playlistId: 'repeat-1', itemId: 'item-2' }])
        expect(ask(remote, 'repeat.start', args), JSON.stringify(args)).toEqual(refusedAs('notDeck'));
      expect(commands).toEqual([]);
      ruleAside(service);
      const start = (args: Record<string, unknown>) =>
        ask(remote, 'repeat.start', { playlistId: 'repeat-1', ...args });
      expect(start({}).status).toBe(200);
      expect(start({ slideIndex: 3 }).status).toBe(200);
      // An item tapped on the phone: its first step, as the window's Start on an item finds it.
      expect(start({ itemId: 'item-2' }).status).toBe(200);
      // One no longer in it: from the first, as the window does.
      expect(start({ itemId: 'item-gone' }).status).toBe(200);
      expect(commands).toEqual([
        { type: 'startRepeat', playlistId: 'repeat-1', slideIndex: 0 },
        { type: 'startRepeat', playlistId: 'repeat-1', slideIndex: 3 },
        { type: 'startRepeat', playlistId: 'repeat-1', slideIndex: 2 },
        { type: 'startRepeat', playlistId: 'repeat-1', slideIndex: 0 },
      ]);
      expect(ask(remote, 'repeat.start', { slideIndex: 1 }).status).toBe(locked ? 403 : 404);
      expect(ask(stage, 'repeat.start', { playlistId: 'repeat-1' }).status).toBe(403);
      if (locked) {
        expect(ask(remote, 'repeat.start', { playlistId: 'repeat-2' }).status).toBe(200);
        expect(ask(remote, 'repeat.start', { playlistId: 'template' })).toEqual({
          status: 403,
          body: { ok: false, message: PHONE_WORDS },
        });
      }
      expect(commands).toHaveLength(locked ? 5 : 4);
    }
    expect(DEVICE_OPS['repeat.start']).toEqual(['remote']);
  });

  it('plays no audio playlist from a Remote (QA23-PHONE-1); with the rule aside, the one a phone chose, or on from where it was paused', () => {
    const { ask, remote, played, service } = setup();
    expect(ask(remote, 'music.play', { playlistId: 'music-1' })).toEqual(refusedAs('media'));
    expect(ask(remote, 'music.play')).toEqual(refusedAs('media'));
    expect(played).toEqual([]);
    ruleAside(service);
    expect(ask(remote, 'music.play', { playlistId: 'music-1' })).toEqual({
      status: 200,
      body: { ok: true, playing: true },
    });
    expect(ask(remote, 'music.play').status).toBe(200);
    expect(ask(remote, 'music.play', { playlistId: null }).status).toBe(200);
    expect(ask(remote, 'music.play', { playlistId: 7 })).toEqual({
      status: 400,
      body: { ok: false, message: 'Which audio playlist?' },
    });
    expect(played).toEqual(['music-1', null, null]);
  });

  it('refuses a Remote’s Play, playOn too (QA23-PHONE-1); with the rule aside, plays an audio playlist on from the track it stopped on at a phone’s Play (playOn, alpha.20), the API as documented without it', () => {
    const { ask, remote, played, playIndexes, service } = setup();
    expect(ask(remote, 'music.play', { playlistId: 'music-1', playOn: true })).toEqual(refusedAs('media'));
    expect(played).toEqual([]);
    ruleAside(service);
    // A phone's Play, of a playlist or Play music: no track asked, so the music service plays on (music-service.ts).
    expect(ask(remote, 'music.play', { playlistId: 'music-1', playOn: true }).status).toBe(200);
    expect(ask(remote, 'music.play', { playOn: true }).status).toBe(200);
    // The API without it, as api.md says: a playlist from its first track, or the track named.
    expect(ask(remote, 'music.play', { playlistId: 'music-1' }).status).toBe(200);
    expect(ask(remote, 'music.play', { playlistId: 'music-1', index: 2, playOn: true }).status).toBe(200);
    expect(played).toEqual(['music-1', null, 'music-1', 'music-1']);
    expect(playIndexes).toEqual([undefined, undefined, 0, 2]);
  });

  it('refuses a Remote the sounds’ pages (QA23-PHONE-1); with the rule aside, filters audio before paging, leaving the unfiltered list alone', () => {
    const { ask, remote, service } = setup();
    expect(ask(remote, 'media', { kind: 'audio', limit: '1' })).toEqual(refusedAs('media'));
    ruleAside(service);
    expect(ask(remote, 'media', { kind: 'audio', limit: '1' })).toMatchObject({
      status: 200,
      body: { media: [MEDIA[2]], offset: 0, total: 1 },
    });
    expect(ask(remote, 'media', { kind: 'audio', offset: '1' })).toMatchObject({
      status: 200,
      body: { media: [], offset: 1, total: 1 },
    });
    expect(ask(remote, 'media', { limit: '1' })).toMatchObject({
      status: 200,
      body: { media: [MEDIA[0]], total: MEDIA.length },
    });
  });

  it.each([false, true])(
    'refuses a Remote Audio and its Play (QA23-PHONE-1); with the rule aside, lets it use Audio and play the chosen index, with Simple Mode %s',
    (locked) => {
      const { ask, remote, stage, poster, audioView, audioCalls, played, playIndexes, service } = setup({
        locked,
      });
      const cases = [
        ['music.new', { name: 'Placeholder tunes' }, ['create', 'Placeholder tunes']],
        [
          'music.rename',
          { playlistId: 'music-1', name: 'Placeholder sounds' },
          ['rename', 'music-1', 'Placeholder sounds'],
        ],
        ['music.remove', { playlistId: 'music-1' }, ['remove', 'music-1']],
        ['music.restore', { playlistId: 'music-1' }, ['restore', 'music-1']],
        [
          'music.options',
          { playlistId: 'music-1', loop: true, shuffle: false },
          ['options', 'music-1', { loop: true, shuffle: false }],
        ],
        [
          'music.addTracks',
          { playlistId: 'music-1', mediaIds: ['m-tune'] },
          ['addTracks', 'music-1', ['m-tune'], null],
        ],
        ['music.moveTrack', { trackId: 'track-1', to: 1 }, ['moveTrack', 'track-1', 1]],
        ['music.removeTrack', { trackId: 'track-1' }, ['removeTrack', 'track-1']],
        ['music.restoreTrack', { trackId: 'track-1', at: 1 }, ['restoreTrack', 'track-1', 1]],
      ] as const;
      // A phone, in either mode: none of it reaches the music service.
      expect(ask(remote, 'music.audio')).toEqual(refusedAs('media'));
      for (const [op, args] of cases) expect(ask(remote, op, args), op).toEqual(refusedAs('media'));
      expect(ask(remote, 'music.stepsAside', { on: false })).toEqual(refusedAs('media'));
      expect(ask(remote, 'music.play', { playlistId: 'music-1', index: 2 })).toEqual(refusedAs('media'));
      expect(audioCalls).toEqual([]);
      expect(played).toEqual([]);
      ruleAside(service);
      expect(ask(remote, 'music.audio')).toMatchObject({
        status: 200,
        body: { ok: true, view: audioView, stepsAside: true },
      });
      for (const [op, args] of cases) {
        expect(ask(remote, op, args), op).toMatchObject({
          status: 200,
          body: { ok: true, view: audioView, stepsAside: true, id: 'music-1' },
        });
        expect(ask(stage, op, args).status, op).toBe(403);
        expect(ask(poster, op, args).status, op).toBe(403);
      }
      expect(audioCalls).toEqual(cases.map(([, , call]) => call));
      expect(ask(remote, 'music.stepsAside', { on: false })).toMatchObject({
        status: 200,
        body: { ok: true, view: audioView, stepsAside: false },
      });
      expect(ask(remote, 'music.moveTrack', { trackId: 'track-1', to: -1 }).status).toBe(400);
      expect(ask(remote, 'music.moveTrack', { trackId: 'track-1', to: '1' }).status).toBe(locked ? 403 : 400);

      expect(ask(remote, 'music.options', { playlistId: 'music-1', loop: 'yes' }).status).toBe(400);
      expect(audioCalls).toHaveLength(cases.length);
      expect(ask(remote, 'music.play', { playlistId: 'music-1', index: 2 }).status).toBe(200);
      expect(ask(remote, 'music.play', { playlistId: 'music-1', index: -1 }).status).toBe(400);
      expect(played).toEqual(['music-1']);
      expect(playIndexes).toEqual([2]);
    },
  );

  it.each([false, true])(
    'refuses a Remote’s Audio changes before any limit (QA23-PHONE-1); with the rule aside, limits them to each phone, with Simple Mode %s',
    (locked) => {
      const { ask, service, remote, audioCalls, advance } = setup({ locked });
      const name = { name: 'Placeholder tunes' };
      // A phone: each refused in the rule's words, never a 429; nothing taken from its limit.
      for (let i = 0; i < 31; i++) expect(ask(remote, 'music.new', name)).toEqual(refusedAs('media'));
      expect(audioCalls).toEqual([]);
      ruleAside(service);
      for (let i = 0; i < 30; i++) expect(ask(remote, 'music.new', name).status).toBe(200);
      for (const [op, args] of [
        ['music.new', name],
        ['music.rename', { playlistId: 'music-1', name: 'Placeholder sounds' }],
        ['music.remove', { playlistId: 'music-1' }],
        ['music.restore', { playlistId: 'music-1' }],
        ['music.options', { playlistId: 'music-1', loop: true, shuffle: false }],
        ['music.addTracks', { playlistId: 'music-1', mediaIds: ['m-tune'] }],
        ['music.moveTrack', { trackId: 'track-1', to: 1 }],
        ['music.removeTrack', { trackId: 'track-1' }],
        ['music.restoreTrack', { trackId: 'track-1', at: 1 }],
        ['music.stepsAside', { on: false }],
      ] as const)
        expect(ask(remote, op, args).status, op).toBe(429);
      expect(audioCalls).toHaveLength(30);
      expect(ask(remote, 'music.audio')).toMatchObject({ status: 200, body: { stepsAside: true } });
      expect(ask(remote, 'music.play', { playlistId: 'music-1' }).status).toBe(200);
      const other = service.pairForCheck('remote', 'Placeholder second phone').id;
      expect(ask(other, 'music.new', name).status).toBe(200);
      advance(100);
      expect(ask(remote, 'music.new', name).status).toBe(429);
      advance(100);
      expect(ask(remote, 'music.new', name).status).toBe(200);
    },
  );

  it('refuses each from a Remote in the phone rule’s words (QA23-PHONE-1); with the rule aside, in Simple Mode’s words when its window request is locked, as the window would be', () => {
    for (const op of [...READS, ...PUTS]) {
      const channel = OP_CHANNEL[op];
      expect(channel, op).not.toBeNull();
      if (channel) expect(SIMPLE_MODE_LOCKED.includes(channel), op).toBe(false);
    }
    const { ask, remote, commands, service } = setup({ lockEverything: true });
    // A phone (QA23-PHONE-1): the phone rule's words come first, the lock never asked.
    const words: Record<(typeof READS)[number] | (typeof PUTS)[number], PhoneWords> = {
      keys: 'computer',
      media: 'media',
      lowerThirds: 'computer',
      music: 'media',
      'media.show': 'media',
      'lowerThird.show': 'computer',
    };
    for (const op of [...READS, ...PUTS])
      expect(ask(remote, op, { mediaId: 'm-pic', lowerThirdId: 'lt-1' }), op).toEqual(refusedAs(words[op]));
    expect(commands).toEqual([]);
    // With the rule aside, as the window would be.
    ruleAside(service);
    for (const op of [...READS, ...PUTS])
      expect(ask(remote, op, { mediaId: 'm-pic', lowerThirdId: 'lt-1' }), op).toEqual({
        status: 403,
        body: { ok: false, message: SIMPLE_MODE_REFUSAL },
      });
    expect(commands).toEqual([]);
  });
});

describe('what Session 55 took out, from a phone', () => {
  it('neither lists nor puts up props or masks, nor starts the idle rotation or switches a Look; the Wallpaper goes up and off from the paired controller, never a phone (QA23-PHONE-1)', () => {
    const { ask, controller, remote, commands } = setup();
    // No such request any more (the API's routes are gone too: 404 there).
    for (const op of ['props', 'prop.show', 'masks', 'mask.show', 'looks', 'logo', 'logo.set'])
      expect(ask(remote, op as DeviceOp, {}).status, op).toBe(403);
    for (const type of ['hideProp', 'startIdle', 'stopIdle', 'setLook', 'showLogo', 'hideLogo'])
      expect([400, 403], type).toContain(ask(remote, 'command', { type }).status);
    expect(commands).toEqual([]);
    expect(ask(remote, 'command', { type: 'toggleWallpaper' })).toEqual(refusedAs('media'));
    expect(ask(remote, 'command', { type: 'setWallpaper', on: false })).toEqual(refusedAs('media'));
    expect(commands).toEqual([]);
    expect(controller({ type: 'toggleWallpaper' }).status).toBe(200);
    expect(controller({ type: 'setWallpaper', on: false }).status).toBe(200);
    expect(commands).toEqual([{ type: 'toggleWallpaper' }, { type: 'setWallpaper', on: false }]);
  });
});
