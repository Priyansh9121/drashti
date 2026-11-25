import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_INVITE_TTL_MS, CHAT_OPERATOR_ID, CHAT_PEOPLE_MAX, CHAT_REFUSAL } from '../../shared/chat';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import { IPC, type InvokeChannel } from '../../shared/ipc';
import { SIMPLE_MODE_REFUSAL } from '../../shared/mode';
import type { NetworkStatus } from '../../shared/network';
import type { DeviceOp } from '../../shared/network-api';
import { ChatService } from '../chat/chat-service';
import { ChatStore } from '../chat/chat-store';
import { openDatabase } from '../db/database';
import { DeviceRepo } from '../db/devices';
import { PHONE_OPS_IN_SIMPLE_MODE, type SimplePhoneScope } from '../simple-mode-phones';
import type { NetworkWorker } from './network-worker';
import { NetworkService, type NetworkDeps, OP_CHANNEL } from './network-service';
import { hashToken } from './tokens';
import type { FromNetworkWorker, ToNetworkWorker } from './worker/protocol';

/*
 * The chat in the network's main-process side (alpha.23, QA23-CHAT-1): the Chat QR (each phone that scans it paired
 * by itself, for the day), the chat's requests through the existing checks, a person removed (cut off at once), the
 * chat's events to the network's process, and nothing of the chat in a log line. Placeholder names and words only.
 */

const PHONE = '192.168.1.20';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(
  options: {
    refused?: (channel: InvokeChannel) => boolean;
    letIn?: { now: boolean };
    simple?: boolean;
    /** The network's own clock, apart from the chat's (a test clock moves the chat's alone). */
    network?: { t: number };
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-network-chat-'));
  dirs.push(dir);
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
  const clock = { t: Date.UTC(2026, 10, 25, 10, 0) };
  const logs: string[] = [];
  const statuses: NetworkStatus[] = [];
  let chatChanges = 0;
  const log = (_level: 'info' | 'warn', line: string) => {
    logs.push(line);
  };
  const store = new ChatStore({
    file: join(dir, 'chat', 'today.json'),
    now: () => clock.t,
    timeZone: 'UTC',
    later: () => undefined,
    log,
  });
  store.load();
  // eslint-disable-next-line prefer-const -- the chat and the network each need the other.
  let service: NetworkService;
  const chat = new ChatService({
    store,
    now: () => clock.t,
    toPhones: (event) => {
      service.chatEvent(event);
    },
    changed: () => {
      chatChanges++;
    },
    devicesChanged: () => {
      service.chatDevicesChanged();
    },
    log,
  });
  const state = initialEngineState();
  service = new NetworkService({
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
    interfaceAddresses: () => ['192.168.1.10'],
    engine: {
      dispatch: () => ({ ok: true, changed: true, rev: 1 }),
      snapshot: () => ({ kind: 'snapshot', version: ENGINE_STATE_VERSION, rev: 0, state, sentAt: 0 }),
      state: () => state,
    },
    reads: {} as NetworkDeps['reads'],
    mirror: {} as NetworkDeps['mirror'],
    playMusic: () => ({ ok: true as const }),
    announcements: {
      submit: () => ({ status: 202, body: { ok: true } }),
      statusFor: () => ({ status: 404, body: { ok: false } }),
    },
    chat,
    chatChanged: () => {
      chatChanges++;
    },
    refused: (channel) => options.refused?.(channel) ?? false,
    // Simple Mode on (a phone does only what its window does); the chat's requests never ask its playlist.
    ...(options.simple ? { simple: () => ({}) as SimplePhoneScope } : {}),
    changed: (s) => statuses.push(s),
    log,
    now: () => (options.network ? options.network.t : clock.t),
    ...(options.network ? { chatNow: () => clock.t } : {}),
    ...(options.letIn ? { letIn: () => options.letIn?.now ?? false } : {}),
  });
  const listen = () => {
    service.setOn(true);
    toMain?.({ type: 'started', result: { ok: true, port: 8740 } });
  };
  const lastDevices = () => {
    const m = sent.filter((s) => s.type === 'devices').at(-1);
    return m?.type === 'devices' ? m.devices : [];
  };
  const ask = (deviceId: string, op: DeviceOp, args: unknown = {}) =>
    service.answer({ address: PHONE, deviceId, op, args });
  return {
    service,
    chat,
    devices,
    sent,
    clock,
    logs,
    statuses,
    listen,
    lastDevices,
    ask,
    chatChanges: () => chatChanges,
    fromWorker: (m: FromNetworkWorker) => toMain?.(m),
  };
}

/** The Chat QR shown, and a phone that scans it: its token and device. */
function scan(service: NetworkService, code: string, address = PHONE) {
  const paired = service.pair(code, address);
  if (!paired.ok) throw new Error(paired.message);
  return paired;
}

function invite(service: NetworkService): string {
  const shown = service.startChatInvite();
  if (!shown.ok || !shown.status.chatInvite) throw new Error('no Chat QR');
  return shown.status.chatInvite.code;
}

describe('the Chat QR', () => {
  it('pairs each phone that scans it by itself, as a chat phone kept by its token’s hash only, for 10 minutes', () => {
    const { service, chat, clock, listen, lastDevices, devices } = setup();
    listen();
    const shown = service.startChatInvite();
    if (!shown.ok || !shown.status.chatInvite) throw new Error('no Chat QR');
    const { code, url, expiresAt } = shown.status.chatInvite;
    expect(code).toMatch(/^\d{6}$/u);
    // The chat's own page (a22-chat-phone's): a phone already paired keeps its pairing and joins with it.
    expect(url).toBe(`http://192.168.1.10:8740/chat#c=${code}`);
    expect(expiresAt).toBe(clock.t + CHAT_INVITE_TTL_MS);
    const one = scan(service, code);
    const two = scan(service, code, '192.168.1.21');
    expect(one.device).toMatchObject({ kind: 'chat', name: 'Chat 1' });
    expect(two.device).toMatchObject({ kind: 'chat', name: 'Chat 2' });
    expect(one.token).not.toBe(two.token);
    expect(chat.devices().map((d) => d.tokenHash)).toEqual([hashToken(one.token), hashToken(two.token)]);
    expect(JSON.stringify(chat.devices())).not.toContain(one.token);
    // Never in the library.
    expect(devices.list()).toEqual([]);
    // The network's process knows them at once.
    expect(
      lastDevices()
        .filter((d) => d.kind === 'chat')
        .map((d) => d.id),
    ).toEqual([one.device.id, two.device.id]);
    // Still shown; gone after its time.
    expect(service.status().chatInvite?.code).toBe(code);
    clock.t += CHAT_INVITE_TTL_MS + 1;
    expect(service.pair(code, PHONE)).toEqual({ ok: false, status: 410, message: CHAT_REFUSAL.ended });
    expect(service.status().chatInvite).toBeNull();
  });

  it('stops when the operator stops it, and after ten wrong codes; a pairing code still works beside it', () => {
    const { service } = setup();
    const code = invite(service);
    expect(service.endChatInvite()).toMatchObject({ ok: true });
    expect(service.status().chatInvite).toBeNull();
    expect(service.pair(code, PHONE)).toEqual({ ok: false, status: 410, message: CHAT_REFUSAL.ended });
    const again = invite(service);
    const pairing = service.startPairing('remote', 'Placeholder phone');
    if (!pairing.ok || !pairing.status.pairing) throw new Error('no code');
    expect(pairing.status.pairing.code).not.toBe(again);
    const remote = scan(service, pairing.status.pairing.code);
    expect(remote.device.kind).toBe('remote');
    const wrong = again === '000000' ? '111111' : '000000';
    for (let i = 0; i < 10; i++)
      expect(service.pair(wrong, `10.0.0.${String(i)}`)).toMatchObject({ ok: false });
    expect(service.pair(again, PHONE)).toMatchObject({ ok: false });
    expect(service.status().chatInvite).toBeNull();
  });

  it('takes at most CHAT_PEOPLE_MAX chat phones a day, and says so in plain words', () => {
    const { service, clock } = setup();
    const code = invite(service);
    // Each from its own phone, a second apart (the joins' own limits: round 1 of the review, M2).
    for (let i = 0; i < CHAT_PEOPLE_MAX; i++) {
      scan(service, code, `10.0.1.${String(i)}`);
      clock.t += 1000;
    }
    expect(service.pair(code, PHONE)).toEqual({ ok: false, status: 409, message: CHAT_REFUSAL.full });
  });

  it('is refused while Drashti is not let in', () => {
    const letIn = { now: true };
    const { service } = setup({ letIn });
    const code = invite(service);
    letIn.now = false;
    expect(service.pair(code, PHONE)).toMatchObject({ ok: false, status: 503 });
  });
});

describe('the chat’s requests', () => {
  it('a chat phone reads, gives its name and writes; nothing else', () => {
    const { service, ask } = setup();
    const phone = scan(service, invite(service)).device;
    expect(ask(phone.id, 'chat')).toMatchObject({
      status: 200,
      body: { ok: true, chat: { day: '2026-11-25', you: { id: phone.id, name: null } } },
    });
    expect(ask(phone.id, 'chat.name', { name: 'Person 1' })).toMatchObject({
      status: 200,
      body: { ok: true, chat: { you: { name: 'Person 1' } } },
    });
    expect(ask(phone.id, 'chat.send', { text: 'Placeholder' })).toMatchObject({
      status: 200,
      body: { ok: true, message: { from: { id: phone.id, name: 'Person 1' }, text: 'Placeholder' } },
    });
    for (const op of ['command', 'playlists', 'announce', 'queue'] as const)
      expect(ask(phone.id, op, { type: 'next' }).status, op).toBe(403);
  });

  it('a Remote and an Announcements device are in it; a Stage device and the poster link are not', () => {
    const { service, ask } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    const announce = service.pairForCheck('announcements', 'Placeholder sender').id;
    const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
    service.makePoster();
    const poster = service.status().devices.find((d) => d.poster)?.id ?? '';
    for (const id of [remote, announce]) expect(ask(id, 'chat').status).toBe(200);
    expect(ask(stage, 'chat').status).toBe(403);
    expect(ask(poster, 'chat')).toEqual({ status: 403, body: { ok: false, message: CHAT_REFUSAL.notIn } });
  });

  it('refuses in plain words what the chat’s rules refuse (sizes, rates, no name)', () => {
    const { service, ask } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    expect(ask(remote, 'chat.send', { text: 'Placeholder' })).toEqual({
      status: 409,
      body: { ok: false, message: CHAT_REFUSAL.noName },
    });
    ask(remote, 'chat.name', { name: 'Person 1' });
    expect(ask(remote, 'chat.send', { text: 'x'.repeat(501) })).toEqual({
      status: 400,
      body: { ok: false, message: CHAT_REFUSAL.tooLong },
    });
  });

  it('works on a phone in Simple Mode whatever Simple Mode locks in the window (the owner: chat in the phone’s Simple Mode)', () => {
    for (const op of ['chat', 'chat.name', 'chat.send'] as const) {
      // Network-only, as an announcement is: Simple Mode's window lock never stands between a phone and the chat.
      expect(OP_CHANNEL[op], op).toBeNull();
      expect(['reads', 'apart'], op).toContain(PHONE_OPS_IN_SIMPLE_MODE[op]);
    }
    const { service, ask } = setup({ refused: () => true, simple: true });
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    expect(ask(remote, 'chat').status).toBe(200);
    expect(ask(remote, 'chat.name', { name: 'Person 1' }).status).toBe(200);
    expect(ask(remote, 'chat.send', { text: 'Placeholder' }).status).toBe(200);
    // The show's requests are refused there as before.
    expect(ask(remote, 'playlists')).toEqual({
      status: 403,
      body: { ok: false, message: SIMPLE_MODE_REFUSAL },
    });
  });

  it('refuses every chat request while Drashti is not let in', () => {
    const letIn = { now: true };
    const { service, ask } = setup({ letIn });
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    letIn.now = false;
    expect(ask(remote, 'chat').status).toBe(503);
  });
});

describe('the chat’s events and a person removed', () => {
  it('hands each event to the network’s process while it listens', () => {
    const { service, ask, sent, listen } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    ask(remote, 'chat.name', { name: 'Person 1' });
    expect(sent.some((m) => m.type === 'chat')).toBe(false);
    listen();
    ask(remote, 'chat.send', { text: 'Placeholder' });
    const events = sent.flatMap((m) => (m.type === 'chat' ? [m.event] : []));
    expect(events).toMatchObject([{ kind: 'message', message: { text: 'Placeholder' } }]);
  });

  it('removes a chat phone at once: unpaired, the network’s process told, its requests refused', () => {
    const { service, ask, listen, lastDevices } = setup();
    listen();
    const phone = scan(service, invite(service)).device;
    ask(phone.id, 'chat.name', { name: 'Person 1' });
    expect(service.removeChatPerson(phone.id)).toMatchObject({ ok: true });
    expect(lastDevices().some((d) => d.id === phone.id)).toBe(false);
    expect(ask(phone.id, 'chat').status).toBe(401);
    expect(service.chatView().people.map((p) => p.id)).toEqual([CHAT_OPERATOR_ID]);
  });

  it('removes a Remote from the chat by unpairing it, in Pro Mode only', () => {
    const locked = { now: true };
    const { service, ask, devices } = setup({
      refused: (channel) => locked.now && channel === IPC.network.revokeDevice,
    });
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    ask(remote, 'chat.name', { name: 'Person 1' });
    expect(service.removeChatPerson(remote)).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(devices.get(remote)).not.toBeNull();
    locked.now = false;
    expect(service.removeChatPerson(remote)).toMatchObject({ ok: true });
    expect(devices.get(remote)).toBeNull();
    expect(service.removeChatPerson(remote)).toEqual({ ok: false, message: CHAT_REFUSAL.gone });
  });

  it('a device removed under Phones and tablets leaves the chat too', () => {
    const { service, ask } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    ask(remote, 'chat.name', { name: 'Person 1' });
    service.revokeDevice(remote);
    expect(service.chatView().people.map((p) => p.id)).toEqual([CHAT_OPERATOR_ID]);
  });

  it('the day’s change unpairs the chat phones, and the network’s process hears of it', () => {
    const { service, chat, clock, listen, lastDevices } = setup();
    listen();
    const phone = scan(service, invite(service)).device;
    expect(lastDevices().some((d) => d.id === phone.id)).toBe(true);
    clock.t = Date.UTC(2026, 10, 26, 0, 1);
    chat.tick();
    expect(lastDevices().some((d) => d.id === phone.id)).toBe(false);
  });

  it('a chat phone unpaired (a new day, or removed) is cut off before the chat’s event goes out: it is never told to read again (CI run 45532541843)', () => {
    const { service, chat, clock, listen, sent } = setup();
    listen();
    const code = invite(service);
    const dayPhone = scan(service, code).device;
    const removed = scan(service, code, '10.0.6.2').device;
    const order = () =>
      sent.flatMap((m) =>
        m.type === 'devices'
          ? [
              `devices${m.devices.some((d) => d.id === dayPhone.id) ? '+day' : ''}${m.devices.some((d) => d.id === removed.id) ? '+removed' : ''}`,
            ]
          : m.type === 'chat'
            ? [`chat:${m.event.kind}`]
            : [],
      );
    chat.setName({ id: removed.id, kind: 'chat', poster: false }, { name: 'Person 2' });
    sent.length = 0;
    service.removeChatPerson(removed.id);
    expect(order()).toEqual(['devices+day', 'chat:people']);
    sent.length = 0;
    clock.t = Date.UTC(2026, 10, 26, 0, 1);
    chat.tick();
    expect(order()).toEqual(['devices', 'chat:cleared']);
  });

  it('the operator’s view: the people with their kinds and who is connected, the Chat QR, reachable', () => {
    const { service, ask, listen, fromWorker } = setup();
    expect(service.chatView()).toMatchObject({ reachable: false, invite: null, members: [] });
    listen();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    ask(remote, 'chat.name', { name: 'Person 1' });
    const code = invite(service);
    const phone = scan(service, code).device;
    ask(phone.id, 'chat.name', { name: 'Person 2' });
    fromWorker({ type: 'connected', deviceIds: [phone.id] });
    expect(service.chatView()).toMatchObject({
      reachable: true,
      invite: { code },
      members: [
        { id: remote, name: 'Person 1', kind: 'remote', connected: false },
        { id: phone.id, name: 'Person 2', kind: 'chat', connected: true },
      ],
    });
  });
});

describe('round 1 of the review (a22-review-chat)', () => {
  it('M2: one phone cannot pair a crowd: a third join from one address is refused, another address still joins', () => {
    const { service } = setup();
    const code = invite(service);
    scan(service, code, '10.0.2.1');
    scan(service, code, '10.0.2.1');
    expect(service.pair(code, '10.0.2.1')).toEqual({
      ok: false,
      status: 429,
      message: CHAT_REFUSAL.joinTooMany,
    });
    expect(service.pair(code, '10.0.2.2').ok).toBe(true);
  });

  it('M2: the Chat QR takes a few phones at once, then one a second, refused in plain words meanwhile', () => {
    const { service, clock } = setup();
    const code = invite(service);
    const joins = Array.from({ length: 11 }, (_, i) => service.pair(code, `10.0.3.${String(i)}`));
    expect(joins.filter((j) => j.ok)).toHaveLength(10);
    expect(joins.at(-1)).toEqual({ ok: false, status: 429, message: CHAT_REFUSAL.joinTooFast });
    clock.t += 1000;
    expect(service.pair(code, '10.0.3.99').ok).toBe(true);
  });

  it('M3: a chat phone that never gives a name is listed for the operator, and removing it cuts it off', () => {
    const { service, ask, listen, lastDevices } = setup();
    listen();
    const quiet = scan(service, invite(service)).device;
    expect(ask(quiet.id, 'chat').status).toBe(200);
    expect(service.chatView().members).toMatchObject([{ id: quiet.id, kind: 'chat', named: false }]);
    expect(service.removeChatPerson(quiet.id)).toMatchObject({ ok: true });
    expect(lastDevices().some((d) => d.id === quiet.id)).toBe(false);
    expect(ask(quiet.id, 'chat').status).toBe(401);
    expect(service.chatView().members).toEqual([]);
  });

  it('M4: a phone’s read passes what it has (after) to the chat', () => {
    const { service, ask } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    ask(remote, 'chat.name', { name: 'Person 1' });
    const sent = ask(remote, 'chat.send', { text: 'Placeholder' });
    const id = (sent.body as { message: { id: string } }).message.id;
    expect(ask(remote, 'chat', { after: id })).toMatchObject({
      status: 200,
      body: { chat: { messages: [], since: id } },
    });
  });

  it('S4: an ended Chat QR’s code says so, and never counts against the live Chat QR or a pairing code', () => {
    const { service } = setup();
    const old = invite(service);
    service.endChatInvite();
    const live = invite(service);
    const pairing = service.startPairing('remote', 'Placeholder phone');
    if (!pairing.ok || !pairing.status.pairing) throw new Error('no code');
    expect(old).not.toBe(live);
    for (let i = 0; i < 12; i++)
      expect(service.pair(old, `10.0.4.${String(i)}`)).toEqual({
        ok: false,
        status: 410,
        message: CHAT_REFUSAL.ended,
      });
    expect(service.pair(live, '10.0.4.50').ok).toBe(true);
    expect(service.pair(pairing.status.pairing.code, '10.0.4.51').ok).toBe(true);
  });

  it('S2: the operator’s section hears of connections only when someone in the chat comes or goes', () => {
    const { service, listen, fromWorker, chatChanges } = setup();
    listen();
    const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
    const phone = scan(service, invite(service)).device;
    const before = chatChanges();
    fromWorker({ type: 'connected', deviceIds: [stage] });
    expect(chatChanges()).toBe(before);
    fromWorker({ type: 'connected', deviceIds: [stage, phone.id] });
    expect(chatChanges()).toBe(before + 1);
  });

  it('a chat phone’s first request after midnight is refused: unpaired at once, before any minute’s check', () => {
    const { service, ask, clock, listen, lastDevices } = setup();
    listen();
    const phone = scan(service, invite(service)).device;
    ask(phone.id, 'chat.name', { name: 'Person 1' });
    clock.t = Date.UTC(2026, 10, 26, 0, 0, 5);
    expect(ask(phone.id, 'chat').status).toBe(401);
    expect(lastDevices().some((d) => d.id === phone.id)).toBe(false);
  });
});

describe('the chat’s clock (round 5, T-S1: a test steps midnight and the 10 minutes)', () => {
  it('the Chat QR’s 10 minutes and its join limits follow the chat’s clock, not the network’s', () => {
    const network = { t: Date.UTC(2026, 10, 25, 10, 0) };
    const { service, clock } = setup({ network });
    const code = invite(service);
    expect(service.status().chatInvite?.expiresAt).toBe(clock.t + CHAT_INVITE_TTL_MS);
    const joins = Array.from({ length: 11 }, (_, i) => service.pair(code, `10.0.5.${String(i)}`));
    expect(joins.at(-1)).toMatchObject({ ok: false, status: 429 });
    // A second on the chat's clock lets one more join, the network's clock standing still.
    clock.t += 1000;
    expect(service.pair(code, '10.0.5.50').ok).toBe(true);
    // 9:59 on, still shown; 10:01 on, ended.
    clock.t += CHAT_INVITE_TTL_MS - 2000;
    expect(service.status().chatInvite?.code).toBe(code);
    clock.t += 2000;
    expect(service.status().chatInvite).toBeNull();
    expect(service.pair(code, '10.0.5.51')).toMatchObject({ ok: false, status: 410 });
  });
});

describe('the log', () => {
  it('never has a person’s name or a message’s words', () => {
    const { service, ask, listen, fromWorker, logs } = setup();
    listen();
    const phone = scan(service, invite(service)).device;
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    ask(phone.id, 'chat.name', { name: 'Person Secretname' });
    ask(remote, 'chat.name', { name: 'Person Othersecret' });
    ask(phone.id, 'chat.send', { text: 'Placeholder secret words' });
    ask(remote, 'chat.send', { text: 'x'.repeat(600) });
    fromWorker({ type: 'connected', deviceIds: [phone.id, remote] });
    fromWorker({ type: 'connected', deviceIds: [] });
    service.removeChatPerson(phone.id);
    service.removeChatPerson(remote);
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toMatch(/secret/iu);
      expect(line).not.toContain('Person ');
    }
  });
});
