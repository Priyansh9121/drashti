import { describe, expect, it } from 'vitest';
import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import { IPC, type InvokeChannel } from '../../shared/ipc';
import { SIMPLE_MODE_REFUSAL, SIMPLE_MODE_REFUSED_COMMANDS } from '../../shared/mode';
import { DEVICE_KINDS, type NetworkStatus, PAIRING_CODE_TTL_MS } from '../../shared/network';
import { DEVICE_OPS, type DeviceOp, REMOTE_COMMANDS } from '../../shared/network-api';
import { DEFAULT_PIP_PLACE } from '../../shared/pip';
import type { ScreenSwitches } from '../../shared/screen-switches';
import { openDatabase } from '../db/database';
import { DeviceRepo } from '../db/devices';
import { SIMPLE_MODE_LOCKED } from '../simple-mode';
import type { NetworkWorker } from './network-worker';
import { NetworkService, OP_CHANNEL } from './network-service';
import { hashToken } from './tokens';
import type { FromNetworkWorker, ToNetworkWorker } from './worker/protocol';

/* The main process's side of the network, with a stand-in worker; made-up tokens and placeholder names. */

/** A phone's address on the local network (made up). */
const PHONE = '192.168.1.20';

function setup(options: { locked?: boolean; lockEverything?: boolean } = {}) {
  const db = openDatabase(':memory:');
  const devices = new DeviceRepo(db);
  const settings = new Map<string, unknown>();
  const sent: ToNetworkWorker[] = [];
  let toMain: ((m: FromNetworkWorker) => void) | null = null;
  const worker: NetworkWorker = {
    send: (m) => sent.push(m),
    onMessage: (l) => {
      toMain = l;
    },
    onExit: () => undefined,
    kill: () => undefined,
  };
  const commands: EngineCommand[] = [];
  const announced: { device: string; address: string; input: unknown }[] = [];
  let now = 1_000_000;
  const statuses: NetworkStatus[] = [];
  const state = initialEngineState();
  /** Main's Audience and Stage (Session 50), as the test turns them. */
  const switches: ScreenSwitches = { audience: true, stage: true };
  const service = new NetworkService({
    devices,
    settings: { get: (k) => settings.get(k), set: (k, v) => settings.set(k, v) },
    spawn: () => worker,
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
        // As the engine does in Simple Mode (show-engine.ts, refuse).
        if (options.locked === true && SIMPLE_MODE_REFUSED_COMMANDS.includes(c.type))
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
      library: (offset, limit) => {
        const all = Array.from({ length: 250 }, (_, i) => ({
          id: `p${String(i).padStart(3, '0')}`,
          name: `Placeholder ${String(i).padStart(3, '0')}`,
          libraryName: 'Default',
          slideCount: 3,
          category: i % 2 === 0 ? 'Placeholder category' : null,
        }));
        return { total: all.length, presentations: all.slice(offset, offset + limit) };
      },
      search: (query) => ({
        query,
        hits:
          query === ''
            ? []
            : [
                {
                  presentationId: 'p007',
                  name: 'Placeholder 007',
                  libraryName: 'Default',
                  match: { kind: 'title' },
                },
              ],
        more: false,
        legacyCount: 0,
      }),
      messages: () => [{ id: 'm1', name: 'Car', template: 'Car {plate} please move', fields: {} }],
      logo: () => ({ id: 'logo', name: 'Placeholder logo', elements: [] }),
      mediaSource: () => null,
      stage: () => ({ groupId: 'stage-group', languages: ['gu'] }),
      // The groups the hall's picture is read from (Session 51): a hall with a screen on this computer that is on,
      // after a group left empty, so Main's Audience switch closes it.
      hallGroups: () => [
        { id: 'emptied-group', role: 'audience', screens: [] },
        {
          id: 'hall-group',
          role: 'audience',
          screens: [{ canvasWidth: 1280, canvasHeight: 720, scaling: 'fill', nodeId: null, enabled: true }],
        },
        { id: 'stage-group', role: 'stage', screens: [] },
      ],
      hall: () => ({ groupId: 'hall-group' }),
      switches: () => ({ ...switches }),
      looks: () => [
        { id: 'look-standard', name: 'Standard' },
        { id: 'look-lower', name: 'Placeholder lower thirds' },
      ],
      clockStyle: () => ({ locale: 'en-GB', timeZone: 'Europe/London' }),
      shastraTexts: () => [{ name: 'Placeholder Granth', abbreviation: 'PG', itemCount: 16 }],
      passage: (reference) =>
        reference === 'PG 14'
          ? {
              ok: true,
              passage: {
                passageId: 'shastra:pg#14',
                key: { text: 'pg', sections: [], from: 14, to: 14 },
                reference: 'Placeholder Granth 14',
              },
            }
          : {
              ok: false,
              message: `No loaded text is called “${reference.split(' ')[0] ?? ''}”. The texts are: PG.`,
            },
    },
    // The mirror's reads (Session 54, D5): mirror-ops.test.ts checks them.
    mirror: {
      props: () => [],
      prop: () => null,
      media: () => [],
      lowerThirds: () => [],
      music: () => [],
      keys: () => ({ platform: 'darwin', singleKeys: true }),
    },
    playMusic: () => ({ ok: true as const }),
    announcements: {
      submit: (device, address, input) => {
        announced.push({ device: device.id, address, input });
        return { status: 202, body: { ok: true } };
      },
      statusFor: () => ({ status: 404, body: { ok: false } }),
    },
    refused: (channel: InvokeChannel) =>
      options.lockEverything === true || (options.locked === true && SIMPLE_MODE_LOCKED.includes(channel)),
    changed: (s) => statuses.push(s),
    log: () => undefined,
    now: () => now,
  });
  const fromWorker = (m: FromNetworkWorker) => toMain?.(m);
  return {
    service,
    devices,
    settings,
    sent,
    commands,
    announced,
    statuses,
    state,
    switches,
    fromWorker,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

describe('the network in the main process', () => {
  it('is off until turned on, then starts the worker and hands it the devices and the state', () => {
    const { service, sent, fromWorker } = setup();
    expect(service.status()).toMatchObject({ on: false, state: 'off', port: 8740 });
    service.resume();
    expect(sent).toEqual([]);
    expect(service.setOn(true)).toMatchObject({ ok: true });
    // The devices and the state before it listens: a device reconnecting at once is known.
    expect(sent.map((m) => m.type)).toEqual(['devices', 'engine', 'start']);
    expect(sent[2]).toMatchObject({ type: 'start', options: { port: 8740 } });
    fromWorker({ type: 'started', result: { ok: true, port: 8740 } });
    expect(service.status().state).toBe('listening');
    expect(sent.map((m) => m.type)).toEqual(['devices', 'engine', 'start', 'devices', 'engine']);
    expect(service.setPort(80)).toMatchObject({ ok: false });
  });

  it('says why when the port is taken', () => {
    const { service, fromWorker } = setup();
    service.setOn(true);
    fromWorker({
      type: 'started',
      result: { ok: false, message: 'Port 8740 is in use by another program.' },
    });
    expect(service.status()).toMatchObject({
      on: true,
      state: 'failed',
      message: 'Port 8740 is in use by another program.',
    });
  });

  it('pairs a device once with its code, keeps only its token’s hash, and drops the code after it expires', () => {
    const { service, devices, tick } = setup();
    const offered = service.startPairing('remote', 'Placeholder phone');
    if (!offered.ok || !offered.status.pairing) throw new Error('no code');
    const code = offered.status.pairing.code;
    expect(code).toMatch(/^\d{6}$/u);
    expect(offered.status.pairing.url).toContain(`/pair#c=${code}`);
    const paired = service.pair(code, '192.168.1.50');
    if (!paired.ok) throw new Error(paired.message);
    expect(paired.device).toMatchObject({ name: 'Placeholder phone', kind: 'remote' });
    expect(devices.list()[0]?.tokenHash).toBe(hashToken(paired.token));
    expect(JSON.stringify(devices.list())).not.toContain(paired.token);
    // Used once.
    expect(service.pair(code, '192.168.1.51')).toMatchObject({ ok: false, status: 403 });
    // A new code expires after two minutes.
    const again = service.startPairing('stage', '');
    if (!again.ok || !again.status.pairing) throw new Error('no code');
    expect(again.status.pairing.name).toBe('Stage 1');
    tick(PAIRING_CODE_TTL_MS + 1);
    expect(service.pair(again.status.pairing.code, '192.168.1.50')).toMatchObject({ ok: false });
    expect(service.status().pairing).toBeNull();
  });

  it('drops a code after ten wrong tries, from anyone', () => {
    const { service } = setup();
    const offered = service.startPairing('remote', null);
    if (!offered.ok || !offered.status.pairing) throw new Error('no code');
    const code = offered.status.pairing.code;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 10; i++) expect(service.pair(wrong, `10.0.0.${i}`)).toMatchObject({ ok: false });
    expect(service.pair(code, '10.0.0.99')).toMatchObject({ ok: false });
  });

  it('removes a device at once, and the worker hears of it', () => {
    const { service, sent, fromWorker } = setup();
    service.setOn(true);
    fromWorker({ type: 'started', result: { ok: true, port: 8740 } });
    const { id } = service.pairForCheck('remote', 'Placeholder phone');
    expect(service.revokeDevice(id)).toMatchObject({ ok: true });
    const last = sent.filter((m) => m.type === 'devices').at(-1);
    expect(last).toEqual({ type: 'devices', devices: [] });
    expect(
      service.answer({ address: PHONE, deviceId: id, op: 'command', args: { type: 'next' } }).status,
    ).toBe(401);
  });

  it('lets a Remote take the picture-in-picture box off (Session 50), never set one up, swap or move it', () => {
    const { service, commands } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    const send = (args: Record<string, unknown>) =>
      service.answer({ address: PHONE, deviceId: remote, op: 'command', args }).status;
    for (const args of [
      { type: 'showPip', source: { kind: 'slides' } },
      { type: 'showPip', source: { kind: 'window', id: 'window:4021:0' } },
      { type: 'showPip', source: { kind: 'input', inputId: 'in-1' } },
      { type: 'swapPip' },
      { type: 'placePip', place: DEFAULT_PIP_PLACE },
    ])
      expect(send(args), JSON.stringify(args)).toBe(403);
    expect(commands).toEqual([]);
    // Take off, and the box's own clear (POST /api/v1/clear/pip): both play its out.
    expect(send({ type: 'hidePip' })).toBe(200);
    expect(send({ type: 'clearLayer', layer: 'pip' })).toBe(200);
    expect(commands).toEqual([{ type: 'hidePip' }, { type: 'clearLayer', layer: 'pip' }]);
    for (const type of ['showPip', 'swapPip', 'placePip'])
      expect(REMOTE_COMMANDS as readonly string[]).not.toContain(type);
  });

  it('lets a Remote move, pause and play on what plays, as the time bar under LIVE does (Session 54)', () => {
    const { service, commands } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    const send = (args: Record<string, unknown>) =>
      service.answer({ address: PHONE, deviceId: remote, op: 'command', args }).status;
    const sent = [
      { type: 'moveTo', playing: { layer: 'background' }, toMs: 12_000 },
      { type: 'pausePlaying', playing: { layer: 'pip' } },
      { type: 'resumePlaying', playing: { layer: 'slide', mediaId: 'placeholder-video' } },
    ];
    for (const args of sent) expect(send(args), JSON.stringify(args)).toBe(200);
    expect(commands).toEqual(sent);
    // Named wrongly, or a point before the file's start: refused before the engine hears of it.
    expect(send({ type: 'moveTo', playing: { layer: 'slide' }, toMs: 1000 })).toBe(400);
    expect(send({ type: 'moveTo', playing: { layer: 'background' }, toMs: -5 })).toBe(400);
    expect(commands).toHaveLength(3);
  });

  it('lets each kind of device do only its own things, and a Remote only run the show', () => {
    const { service, commands } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
    const poster = service.pairForCheck('announcements', 'Placeholder poster').id;
    expect(
      service.answer({ address: PHONE, deviceId: remote, op: 'command', args: { type: 'next' } }),
    ).toMatchObject({
      status: 200,
      body: { ok: true, rev: 1 },
    });
    expect(
      service.answer({ address: PHONE, deviceId: stage, op: 'command', args: { type: 'next' } }).status,
    ).toBe(403);
    expect(service.answer({ address: PHONE, deviceId: poster, op: 'playlists', args: {} }).status).toBe(403);
    // Not running the show: refused, though the engine would take it from the operator window. (The stage message
    // is a Remote's since Session 54, D5: mirror-ops.test.ts.)
    for (const args of [
      { type: 'setBackground', background: { kind: 'color', color: '#000000' } },
      { type: 'showProp', prop: { id: 'p', name: 'Placeholder', elements: [] } },
    ])
      expect(
        service.answer({ address: PHONE, deviceId: remote, op: 'command', args }).status,
        args.type,
      ).toBe(403);
    expect(
      service.answer({ address: PHONE, deviceId: remote, op: 'command', args: { type: 'goLive' } }).status,
    ).toBe(400);
    // The logo and messages are made here from what the operator marked and wrote, never sent whole.
    service.answer({ address: PHONE, deviceId: remote, op: 'logo.set', args: { on: true } });
    expect(commands.at(-1)).toMatchObject({ type: 'showLogo', prop: { id: 'logo' } });
    expect(
      service.answer({
        address: PHONE,
        deviceId: remote,
        op: 'message.show',
        args: { templateId: 'm1', values: {} },
      }),
    ).toMatchObject({
      status: 400,
      body: { message: 'Fill in {plate} first.' },
    });
    service.answer({
      address: PHONE,
      deviceId: remote,
      op: 'message.show',
      args: { templateId: 'm1', values: { plate: '12' } },
    });
    expect(commands.at(-1)).toMatchObject({
      type: 'showMessage',
      message: { id: 'message:m1', text: 'Car 12 please move' },
    });
    service.answer({ address: PHONE, deviceId: remote, op: 'message.hide', args: { templateId: 'm1' } });
    expect(commands.at(-1)).toEqual({ type: 'hideMessage', messageId: 'message:m1' });
    // Looks: a Remote reads them and switches the live one; a Stage device reads its group and languages.
    expect(service.answer({ address: PHONE, deviceId: remote, op: 'looks', args: {} })).toMatchObject({
      status: 200,
      body: { looks: [{ name: 'Standard' }, { name: 'Placeholder lower thirds' }] },
    });
    expect(
      service.answer({
        address: PHONE,
        deviceId: remote,
        op: 'command',
        args: { type: 'setLook', lookId: 'look-lower' },
      }).status,
    ).toBe(200);
    expect(commands.at(-1)).toEqual({ type: 'setLook', lookId: 'look-lower' });
    expect(service.answer({ address: PHONE, deviceId: stage, op: 'looks', args: {} }).status).toBe(403);
    expect(service.answer({ address: PHONE, deviceId: stage, op: 'stage', args: {} })).toMatchObject({
      status: 200,
      body: { groupId: 'stage-group', languages: ['gu'] },
    });
    // The hall's group and Main's clock, for a Remote's picture and time (Sessions 31–36); not a stage display's.
    // And the stage screens' group, whose layout's timers a Remote starts, pauses and resets (Session 54).
    expect(service.answer({ address: PHONE, deviceId: remote, op: 'hall', args: {} })).toMatchObject({
      status: 200,
      body: {
        groupId: 'hall-group',
        clock: { locale: 'en-GB', timeZone: 'Europe/London' },
        stageGroupId: 'stage-group',
      },
    });
    expect(service.answer({ address: PHONE, deviceId: stage, op: 'hall', args: {} }).status).toBe(403);
    // Shastra: a Remote lists the texts and puts up a reference; nonsense is refused with why.
    expect(service.answer({ address: PHONE, deviceId: remote, op: 'shastra.texts', args: {} })).toMatchObject(
      {
        status: 200,
        body: { texts: [{ abbreviation: 'PG' }] },
      },
    );
    expect(
      service.answer({ address: PHONE, deviceId: remote, op: 'shastra', args: { reference: 'PG 14' } }),
    ).toMatchObject({ status: 200, body: { ok: true, reference: 'Placeholder Granth 14' } });
    expect(commands.at(-1)).toEqual({ type: 'goLive', presentationId: 'shastra:pg#14', slideIndex: 0 });
    expect(
      service.answer({ address: PHONE, deviceId: remote, op: 'shastra', args: { reference: 'XY 1' } }),
    ).toEqual({
      status: 404,
      body: { ok: false, message: 'No loaded text is called “XY”. The texts are: PG.' },
    });
    expect(service.answer({ address: PHONE, deviceId: remote, op: 'shastra', args: {} }).status).toBe(400);
    expect(
      service.answer({ address: PHONE, deviceId: stage, op: 'shastra', args: { reference: 'PG 14' } }).status,
    ).toBe(403);
  });

  it('lets a Remote clear a video input, never choose one (Session 50)', () => {
    const { service, commands } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    const command = (args: Record<string, unknown>) =>
      service.answer({ address: PHONE, deviceId: remote, op: 'command', args }).status;
    expect(command({ type: 'showInput', inputId: 'in-1' })).toBe(403);
    expect(commands).toEqual([]);
    expect(command({ type: 'clearLayer', layer: 'background' })).toBe(200);
    expect(command({ type: 'clearAll' })).toBe(200);
    expect(commands).toEqual([{ type: 'clearLayer', layer: 'background' }, { type: 'clearAll' }]);
  });

  it('lets a Remote see Repeat Slides going round, and start and stop it (Session 26d)', () => {
    const { service, commands, state } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
    expect(service.answer({ address: PHONE, deviceId: remote, op: 'status', args: {} })).toMatchObject({
      status: 200,
      body: { status: { repeating: null } },
    });
    state.repeat = { playlistId: 'lobby', name: 'Placeholder Lobby' };
    expect(service.answer({ address: PHONE, deviceId: remote, op: 'status', args: {} })).toMatchObject({
      status: 200,
      body: { status: { repeating: { playlistId: 'lobby', name: 'Placeholder Lobby' } } },
    });
    expect(
      service.answer({ address: PHONE, deviceId: remote, op: 'command', args: { type: 'stopRepeat' } })
        .status,
    ).toBe(200);
    expect(commands.at(-1)).toEqual({ type: 'stopRepeat' });
    expect(
      service.answer({
        address: PHONE,
        deviceId: remote,
        op: 'command',
        args: { type: 'startRepeat', playlistId: 'lobby', slideIndex: 2 },
      }).status,
    ).toBe(200);
    expect(commands.at(-1)).toEqual({ type: 'startRepeat', playlistId: 'lobby', slideIndex: 2 });
    // A stage display shows it, and runs nothing.
    expect(
      service.answer({ address: PHONE, deviceId: stage, op: 'command', args: { type: 'stopRepeat' } }).status,
    ).toBe(403);
  });

  it('lets a Remote read the library a page at a time and search it, in Simple Mode too (Session 18)', () => {
    for (const locked of [false, true]) {
      const { service, commands } = setup({ locked });
      const remote = service.pairForCheck('remote', 'Placeholder phone').id;
      const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
      const read = (op: 'presentations' | 'search', args: Record<string, unknown>) =>
        service.answer({ address: PHONE, deviceId: remote, op, args });
      // A page of 100 from the start, with how many there are.
      const first = read('presentations', {});
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ ok: true, offset: 0, total: 250 });
      const firstPage = (first.body as { presentations: { id: string; category: string | null }[] })
        .presentations;
      expect(firstPage).toHaveLength(100);
      expect(firstPage[0]).toEqual({
        id: 'p000',
        name: 'Placeholder 000',
        libraryName: 'Default',
        slideCount: 3,
        category: 'Placeholder category',
      });
      // As a query string brings them: the last page, a page too big, numbers that are not.
      expect(read('presentations', { offset: '200', limit: '100' }).body).toMatchObject({ offset: 200 });
      expect(
        (read('presentations', { offset: '200' }).body as { presentations: unknown[] }).presentations,
      ).toHaveLength(50);
      expect(
        (read('presentations', { limit: '5000' }).body as { presentations: unknown[] }).presentations,
      ).toHaveLength(200);
      expect(read('presentations', { offset: '-3', limit: 'all' }).body).toMatchObject({ offset: 0 });
      // Searched as the window searches; nothing asked, nothing found.
      expect(read('search', { query: ' placeholder 7 ' }).body).toMatchObject({
        ok: true,
        query: 'placeholder 7',
        hits: [{ presentationId: 'p007' }],
      });
      expect(read('search', {}).body).toMatchObject({ ok: true, query: '', hits: [] });
      // A slide of a presentation found there goes up, as from the window (Simple Mode too).
      expect(
        service.answer({
          address: PHONE,
          deviceId: remote,
          op: 'command',
          args: { type: 'goLive', presentationId: 'p007', slideIndex: 1 },
        }).status,
      ).toBe(200);
      expect(commands.at(-1)).toMatchObject({ type: 'goLive', presentationId: 'p007', slideIndex: 1 });
      // A stage display reads neither.
      expect(service.answer({ address: PHONE, deviceId: stage, op: 'presentations', args: {} }).status).toBe(
        403,
      );
      expect(service.answer({ address: PHONE, deviceId: stage, op: 'search', args: {} }).status).toBe(403);
    }
    // The lock is asked for both, as for the window's own reads.
    const everything = setup({ lockEverything: true });
    const id = everything.service.pairForCheck('remote', 'Placeholder phone').id;
    for (const op of ['presentations', 'search'] as const)
      expect(everything.service.answer({ address: PHONE, deviceId: id, op, args: {} })).toEqual({
        status: 403,
        body: { ok: false, message: SIMPLE_MODE_REFUSAL },
      });
  });

  it('refuses over the network exactly what Simple Mode refuses in the window', () => {
    // Each network action is the window request that does the same thing, so it gets the same answer: none
    // is locked, as in the window (Session 44: running a macro was the one, and Macros are gone).
    for (const op of Object.keys(DEVICE_OPS) as DeviceOp[]) {
      const channel = OP_CHANNEL[op];
      if (channel) expect(SIMPLE_MODE_LOCKED.includes(channel), op).toBe(false);
    }
    // In Simple Mode the remote still runs the show, as the window does.
    const simple = setup({ locked: true });
    const remote = simple.service.pairForCheck('remote', 'Placeholder phone').id;
    expect(
      simple.service.answer({ address: PHONE, deviceId: remote, op: 'command', args: { type: 'next' } })
        .status,
    ).toBe(200);
    // And not switch the Look, which Simple Mode keeps (the engine refuses it, from anywhere).
    expect(
      simple.service.answer({
        address: PHONE,
        deviceId: remote,
        op: 'command',
        args: { type: 'setLook', lookId: 'look-lower' },
      }),
    ).toEqual({ status: 403, body: { ok: false, error: 'forbidden', message: SIMPLE_MODE_REFUSAL } });
    // And the lock is asked: an action whose window request were locked is refused with Simple Mode's words.
    const everything = setup({ lockEverything: true });
    const id = everything.service.pairForCheck('remote', 'Placeholder phone').id;
    expect(
      everything.service.answer({ address: PHONE, deviceId: id, op: 'command', args: { type: 'next' } }),
    ).toEqual({
      status: 403,
      body: { ok: false, message: SIMPLE_MODE_REFUSAL },
    });
    expect(DEVICE_KINDS).toEqual(['remote', 'stage', 'announcements']);
  });

  // Session 51 (S4-4): a tablet's stage display draws a layout's audience picture box as Main's stage screens do.
  it('tells a stage display the hall’s picture for a layout’s audience box, said off with Audience off', () => {
    const { service, switches } = setup();
    const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
    const answer = () => service.answer({ address: PHONE, deviceId: stage, op: 'stage', args: {} });
    const hall = { groupId: 'hall-group', canvasWidth: 1280, canvasHeight: 720, scaling: 'fill' };
    expect(answer()).toEqual({
      status: 200,
      body: {
        ok: true,
        groupId: 'stage-group',
        languages: ['gu'],
        clock: { locale: 'en-GB', timeZone: 'Europe/London' },
        hall,
      },
    });
    // Main's Audience off, as its switch has it (the same one a Remote is told of): said off from then.
    switches.audience = false;
    expect(answer()).toMatchObject({ status: 200, body: { hall: { ...hall, off: true } } });
    switches.audience = true;
    expect(answer()).toMatchObject({ status: 200, body: { hall } });
    expect(answer().body).not.toHaveProperty('hall.off');
    // Its pictures are the remote's small previews (the network server serves them, by the same rules), and the
    // remote's own hall stays the remote's.
    expect(DEVICE_OPS.preview).toEqual(['remote', 'stage']);
    expect(service.answer({ address: PHONE, deviceId: stage, op: 'hall', args: {} }).status).toBe(403);
  });

  it('tells a Remote which of Main’s screens are off, with the hall, and gives no way to turn them (Session 50)', () => {
    const { service, switches } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    const hall = () => service.answer({ address: PHONE, deviceId: remote, op: 'hall', args: {} });
    expect(hall()).toMatchObject({ status: 200, body: { switches: { audience: true, stage: true } } });
    switches.audience = false;
    expect(hall()).toMatchObject({ status: 200, body: { switches: { audience: false, stage: true } } });
    // Nothing a device can ask for turns them: no op of its own, and none reaches the window's request.
    expect(Object.keys(DEVICE_OPS).filter((op) => /switch/iu.test(op))).toEqual([]);
    expect(Object.values(OP_CHANNEL)).not.toContain(IPC.screenSwitches.turn);
  });
});
