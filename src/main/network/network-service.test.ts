import { describe, expect, it } from 'vitest';
import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import type { InvokeChannel } from '../../shared/ipc';
import { SIMPLE_MODE_REFUSAL, SIMPLE_MODE_REFUSED_COMMANDS } from '../../shared/mode';
import { DEVICE_KINDS, type NetworkStatus, PAIRING_CODE_TTL_MS } from '../../shared/network';
import { DEVICE_OPS, type DeviceOp } from '../../shared/network-api';
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
      messages: () => [{ id: 'm1', name: 'Car', template: 'Car {plate} please move', fields: {} }],
      logo: () => ({ id: 'logo', name: 'Placeholder logo', elements: [] }),
      mediaSource: () => null,
      stage: () => ({ groupId: 'stage-group', languages: ['gu'] }),
      looks: () => [
        { id: 'look-standard', name: 'Standard' },
        { id: 'look-lower', name: 'Placeholder lower thirds' },
      ],
      macros: () => [{ id: 'macro-1', name: 'Placeholder arti', color: '#3e63dd' }],
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
    runMacro: (id) =>
      options.locked === true
        ? { ok: false, message: SIMPLE_MODE_REFUSAL }
        : id === 'macro-1'
          ? { ok: true, rev: 1, changed: true }
          : { ok: false, message: 'That macro no longer exists.' },
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
    expect(sent[0]).toMatchObject({ type: 'start', options: { port: 8740 } });
    fromWorker({ type: 'started', result: { ok: true, port: 8740 } });
    expect(service.status().state).toBe('listening');
    expect(sent.map((m) => m.type)).toEqual(['start', 'devices', 'engine']);
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
    // Not running the show: refused, though the engine would take it from the operator window.
    for (const args of [
      { type: 'setStageMessage', text: 'Placeholder' },
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
    // Macros: a Remote lists and runs them; one that is gone is refused.
    expect(service.answer({ address: PHONE, deviceId: remote, op: 'macros', args: {} })).toMatchObject({
      status: 200,
      body: { macros: [{ id: 'macro-1', name: 'Placeholder arti' }] },
    });
    expect(
      service.answer({ address: PHONE, deviceId: remote, op: 'macro.run', args: { macroId: 'macro-1' } }),
    ).toMatchObject({ status: 200, body: { ok: true, rev: 1 } });
    expect(
      service.answer({ address: PHONE, deviceId: remote, op: 'macro.run', args: { macroId: 'gone' } }).status,
    ).toBe(409);
    expect(
      service.answer({ address: PHONE, deviceId: stage, op: 'macro.run', args: { macroId: 'macro-1' } })
        .status,
    ).toBe(403);
    expect(service.answer({ address: PHONE, deviceId: stage, op: 'stage', args: {} })).toMatchObject({
      status: 200,
      body: { groupId: 'stage-group', languages: ['gu'] },
    });
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

  it('refuses over the network exactly what Simple Mode refuses in the window', () => {
    // Each network action is the window request that does the same thing, so it gets the same answer:
    // only running a macro is locked, as it is in the window (Simple Mode runs no macros).
    for (const op of Object.keys(DEVICE_OPS) as DeviceOp[]) {
      const channel = OP_CHANNEL[op];
      if (channel) expect(SIMPLE_MODE_LOCKED.includes(channel), op).toBe(op === 'macro.run');
    }
    // In Simple Mode the remote still runs the show, as the window does.
    const simple = setup({ locked: true });
    const remote = simple.service.pairForCheck('remote', 'Placeholder phone').id;
    expect(
      simple.service.answer({ address: PHONE, deviceId: remote, op: 'command', args: { type: 'next' } })
        .status,
    ).toBe(200);
    // Not run a macro.
    expect(
      simple.service.answer({
        address: PHONE,
        deviceId: remote,
        op: 'macro.run',
        args: { macroId: 'macro-1' },
      }),
    ).toEqual({ status: 403, body: { ok: false, message: SIMPLE_MODE_REFUSAL } });
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
});
