import { describe, expect, it } from 'vitest';
import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import type { InvokeChannel } from '../../shared/ipc';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../shared/lower-thirds';
import { SIMPLE_MODE_REFUSAL, simpleModeRefuses } from '../../shared/mode';
import { DEVICE_OPS, type DeviceOp, REMOTE_COMMANDS } from '../../shared/network-api';
import type { RemoteMedia } from '../../shared/network-mirror';
import { openDatabase } from '../db/database';
import { DeviceRepo } from '../db/devices';
import { SIMPLE_MODE_LOCKED } from '../simple-mode';
import { NetworkService, OP_CHANNEL } from './network-service';

/*
 * The phone as a mirror of the operator window (Session 54, D5): a Remote reads the library's props, media, lower
 * thirds and audio playlists, and the keys the window answers; puts each up by its id, as the main process reads it
 * from the library, and takes it off; shows a timer alone, the stage message, Back 15 s and the rest. Never a Stage
 * or Announcements device, and Simple Mode's refusals as in the window. Placeholder names, made-up ids.
 */

const PHONE = '192.168.1.20';

const MEDIA: RemoteMedia[] = [
  { id: 'm-pic', name: 'Placeholder picture', kind: 'image', missing: false, unplayable: null },
  { id: 'm-vid', name: 'Placeholder video', kind: 'video', missing: false, unplayable: null },
  { id: 'm-tune', name: 'Placeholder tune', kind: 'audio', missing: false, unplayable: null },
  { id: 'm-gone', name: 'Placeholder gone picture', kind: 'image', missing: true, unplayable: null },
  { id: 'm-heic', name: 'Placeholder phone photo', kind: 'image', missing: false, unplayable: 'HEIC' },
];

function setup(options: { locked?: boolean; lockEverything?: boolean } = {}) {
  const db = openDatabase(':memory:');
  const devices = new DeviceRepo(db);
  const commands: EngineCommand[] = [];
  const played: (string | null | undefined)[] = [];
  const state = initialEngineState();
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
        if (options.locked === true && simpleModeRefuses(c))
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
      logo: () => null,
      mediaSource: () => null,
      stage: () => ({ groupId: null, languages: null }),
      hallGroups: () => [],
      hall: () => ({ groupId: null }),
      switches: () => ({ audience: true, stage: true }),
      looks: () => [],
      clockStyle: () => ({ locale: 'en-GB', timeZone: 'Europe/London' }),
      shastraTexts: () => [],
      passage: () => ({ ok: false, message: 'No texts.' }),
    },
    mirror: {
      props: () => [
        { id: 'prop-name', name: 'Placeholder mandir name', imported: false, logo: false },
        { id: 'prop-logo', name: 'Placeholder logo', imported: false, logo: true },
      ],
      prop: (id) =>
        id === 'prop-name'
          ? {
              id,
              name: 'Placeholder mandir name',
              elements: [],
              width: 1920,
              height: 1080,
            }
          : null,
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
    },
    playMusic: (_who, playlistId) => {
      played.push(playlistId);
      return { ok: true as const };
    },
    announcements: {
      submit: () => ({ status: 202, body: { ok: true } }),
      statusFor: () => ({ status: 404, body: { ok: false } }),
    },
    refused: (channel: InvokeChannel) =>
      options.lockEverything === true || (options.locked === true && SIMPLE_MODE_LOCKED.includes(channel)),
    changed: () => undefined,
    log: () => undefined,
    now: () => 1_000_000,
  });
  const remote = service.pairForCheck('remote', 'Placeholder phone').id;
  const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
  const poster = service.pairForCheck('announcements', 'Placeholder poster').id;
  const ask = (deviceId: string, op: DeviceOp, args: Record<string, unknown> = {}) =>
    service.answer({ address: PHONE, deviceId, op, args });
  return { service, commands, played, state, remote, stage, poster, ask };
}

/** The new reads and the actions that put something up. */
const READS = ['keys', 'props', 'media', 'lowerThirds', 'music'] as const satisfies readonly DeviceOp[];
const PUTS = ['prop.show', 'media.show', 'lowerThird.show'] as const satisfies readonly DeviceOp[];

describe('the phone as a mirror of the operator window (Session 54, D5)', () => {
  it('lets a Remote read the props, the media, the lower thirds, the audio playlists and the keys', () => {
    const { ask, remote } = setup();
    expect(ask(remote, 'keys')).toEqual({
      status: 200,
      body: { ok: true, keys: { platform: 'darwin', singleKeys: true } },
    });
    expect(ask(remote, 'props')).toMatchObject({
      status: 200,
      body: {
        props: [
          { id: 'prop-name', logo: false },
          { id: 'prop-logo', logo: true },
        ],
      },
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

  it('gives the media a page at a time, found by the words of their names', () => {
    const { ask, remote } = setup();
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

  it('puts a prop, a lower third, a picture, a video and a sound up by its id, as the library has it', () => {
    const { ask, remote, commands } = setup();
    expect(ask(remote, 'prop.show', { propId: 'prop-name' })).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(commands.at(-1)).toEqual({
      type: 'showProp',
      prop: { id: 'prop-name', name: 'Placeholder mandir name', elements: [], width: 1920, height: 1080 },
    });
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

  it('says why a missing file, one Drashti cannot play, or one no longer there does not go up', () => {
    const { ask, remote, commands } = setup();
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
    expect(ask(remote, 'prop.show', { propId: 'prop-nothing' }).status).toBe(404);
    expect(ask(remote, 'lowerThird.show', { lowerThirdId: 'lt-nothing' }).status).toBe(404);
    for (const op of PUTS) expect(ask(remote, op, { mediaId: '../x', propId: 7 }).status, op).toBe(404);
    expect(commands).toEqual([]);
  });

  it('takes them off, and shows a timer alone, the stage message, the skips and the idle rotation', () => {
    for (const locked of [false, true]) {
      const { ask, remote, commands } = setup({ locked });
      const sent: Record<string, unknown>[] = [
        { type: 'hideProp', propId: 'prop-name' },
        { type: 'hideLowerThird' },
        { type: 'showTimer', timerId: 'timer-1' },
        { type: 'setStageMessage', text: 'Placeholder: five minutes' },
        { type: 'clearStageMessage' },
        { type: 'skip', layer: 'background', jump: 'forward' },
        { type: 'skip', layer: 'audio', jump: 'last' },
        { type: 'startIdle' },
        { type: 'stopIdle' },
      ];
      // In Simple Mode too: running the show, as its window does; but Back 15 s and the rest, which move what plays,
      // are Pro Mode's (Session 54's review: Simple Mode shows the time bar and moves nothing).
      const refused = (args: Record<string, unknown>) => locked && args['type'] === 'skip';
      for (const args of sent)
        expect(ask(remote, 'command', args).status, JSON.stringify(args)).toBe(refused(args) ? 403 : 200);
      expect(commands).toEqual(sent.filter((args) => !refused(args)));
    }
  });

  it('never lets a Stage or Announcements device read or do any of it', () => {
    const { ask, stage, poster, commands } = setup();
    for (const device of [stage, poster]) {
      for (const op of [...READS, ...PUTS])
        expect(ask(device, op, { propId: 'prop-name' }).status, op).toBe(403);
      for (const type of ['hideProp', 'showTimer', 'setStageMessage', 'skip', 'startIdle'])
        expect(ask(device, 'command', { type }).status, type).toBe(403);
    }
    for (const op of [...READS, ...PUTS]) expect(DEVICE_OPS[op], op).toEqual(['remote']);
    expect(commands).toEqual([]);
  });

  it('keeps a phone from sending what it puts up whole, or setting up masks, the box or the background', () => {
    const { ask, remote, commands } = setup();
    for (const args of [
      { type: 'showProp', prop: { id: 'p', name: 'Placeholder', elements: [] } },
      { type: 'setBackground', background: { kind: 'color', color: '#000000' } },
      {
        type: 'playAudio',
        audio: { id: 'a', title: 'Placeholder', mediaId: null, volume: 1, loop: false },
      },
      { type: 'setMask', mask: { id: 'mask', name: 'Placeholder', shapes: [] } },
      { type: 'swapPip' },
      { type: 'showInput', inputId: 'in-1' },
    ])
      expect([400, 403], args.type).toContain(ask(remote, 'command', args).status);
    expect(commands).toEqual([]);
    for (const type of ['showProp', 'setBackground', 'playAudio', 'setMask', 'showLowerThird', 'swapPip'])
      expect(REMOTE_COMMANDS as readonly string[], type).not.toContain(type);
  });

  it('plays the audio playlist a phone chose, or on from where it was paused', () => {
    const { ask, remote, played } = setup();
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

  it('refuses each with Simple Mode’s words when its window request is locked, as the window would be', () => {
    for (const op of [...READS, ...PUTS]) {
      const channel = OP_CHANNEL[op];
      expect(channel, op).not.toBeNull();
      if (channel) expect(SIMPLE_MODE_LOCKED.includes(channel), op).toBe(false);
    }
    const { ask, remote, commands } = setup({ lockEverything: true });
    for (const op of [...READS, ...PUTS])
      expect(ask(remote, op, { propId: 'prop-name', mediaId: 'm-pic', lowerThirdId: 'lt-1' }), op).toEqual({
        status: 403,
        body: { ok: false, message: SIMPLE_MODE_REFUSAL },
      });
    expect(commands).toEqual([]);
  });
});
