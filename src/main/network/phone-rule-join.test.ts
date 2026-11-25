import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_REFUSAL } from '../../shared/chat';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import { IPC, type InvokeChannel } from '../../shared/ipc';
import type { DeviceOp } from '../../shared/network-api';
import { PHONE_REFUSAL } from '../../shared/phone-rule';
import type { SabhaFlow } from '../../shared/sabha-flow';
import type { SimpleFeature } from '../../shared/simple-features';
import { ChatService } from '../chat/chat-service';
import { ChatStore } from '../chat/chat-store';
import { openDatabase } from '../db/database';
import { DeviceRepo } from '../db/devices';
import type { SimplePhoneScope } from '../simple-mode-phones';
import type { FlowReads } from './flow-answers';
import { type NetworkDeps, NetworkService } from './network-service';

/*
 * The phone rule joined with the chat and the Sabha flow (alpha.23, QA23-PHONE-1 with QA23-CHAT-1 and QA23-FLOW-1/2;
 * the owner's words: "in simple mode only show the flow, whats running in live, and chat. pro contains more features
 * than simple"). A Remote reads and writes the chat and reads the flow in Simple Mode as in Pro Mode, through every
 * check a phone's request meets; the other kinds that may make these requests are unchanged. Placeholder names and
 * words, made-up ids and a made-up few bytes for a PNG.
 */

const PHONE = '192.168.1.40';

const FLOW: SabhaFlow = {
  id: 'flow-placeholder-0002',
  fileName: 'Placeholder order.pdf',
  pageCount: 1,
  drawnPages: 1,
  status: 'read',
  lang: 'en',
  title: 'Placeholder Sabha',
  headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
  items: [{ no: '1', cells: ['Placeholder opening', 'Placeholder words', '10 min', 'Placeholder A'] }],
  total: 'Placeholder total 10 min',
};

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

/** Simple Mode's one playlist, empty: the chat and the flow never ask it. */
const SIMPLE: SimplePhoneScope = {
  playlistId: 'one',
  playlistOf: () => null,
  holdsMedia: () => false,
  holdsPresentation: () => false,
  kindOf: () => null,
  listsMedia: () => false,
  listsPresentation: () => false,
  activePlaylist: () => false,
  activeItem: () => false,
  plays: () => false,
  refusal: () => 'Placeholder words: Simple Mode on the computer.',
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(mode: 'pro' | 'simple') {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-phone-rule-join-'));
  dirs.push(dir);
  const devices = new DeviceRepo(openDatabase(':memory:'));
  const clock = { t: Date.UTC(2026, 10, 25, 10, 0) };
  const store = new ChatStore({
    file: join(dir, 'chat', 'today.json'),
    now: () => clock.t,
    timeZone: 'UTC',
    later: () => undefined,
    log: () => undefined,
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
    changed: () => undefined,
    devicesChanged: () => {
      service.chatDevicesChanged();
    },
    log: () => undefined,
  });
  const flow: FlowReads = {
    snapshot: () => ({ flow: FLOW, state: { flowId: FLOW.id, now: 0 } }),
    page: () => Promise.resolve(PNG),
  };
  const simple = mode === 'simple';
  // Sabha flow among Simple Mode's tools: whether a Simple phone shows it without (the owner's Q3) is the phone page's.
  const chosen: readonly SimpleFeature[] = ['sabha-flow'];
  const state = initialEngineState();
  service = new NetworkService({
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
    chatChanged: () => undefined,
    flow,
    // Simple Mode's lock as the window's requests meet it: only the flow's changes, none a phone's.
    refused: (channel: InvokeChannel) =>
      simple && ([IPC.flow.choose, IPC.flow.remove, IPC.flow.setNow] as InvokeChannel[]).includes(channel),
    simple: () => (simple ? SIMPLE : null),
    simpleFeatures: () => chosen,
    changed: () => undefined,
    log: () => undefined,
    now: () => clock.t,
  });
  const ask = (deviceId: string, op: DeviceOp, args: Record<string, unknown> = {}) =>
    service.answer({ address: PHONE, deviceId, op, args });
  const page = (deviceId: string) =>
    service.flowPage({ address: PHONE, deviceId, op: 'flow.page', args: { page: '0', flowId: FLOW.id } });
  return { service, ask, page };
}

describe('the phone rule with the chat and the Sabha flow (QA23-PHONE-1 joined)', () => {
  it('lets a phone in Simple Mode read and write the chat and read the Sabha flow and its page, as in Pro Mode', async () => {
    for (const mode of ['simple', 'pro'] as const) {
      const { service, ask, page } = setup(mode);
      const remote = service.pairForCheck('remote', 'Placeholder phone').id;
      expect(ask(remote, 'chat'), mode).toMatchObject({ status: 200, body: { ok: true } });
      expect(ask(remote, 'chat.name', { name: 'Person 1' }), mode).toMatchObject({
        status: 200,
        body: { ok: true, chat: { you: { name: 'Person 1' } } },
      });
      expect(ask(remote, 'chat.send', { text: 'Placeholder' }), mode).toMatchObject({
        status: 200,
        body: { ok: true, message: { text: 'Placeholder' } },
      });
      expect(ask(remote, 'flow'), mode).toEqual({
        status: 200,
        body: { ok: true, flow: FLOW, state: { flowId: FLOW.id, now: 0 } },
      });
      expect((await page(remote)).status, mode).toBe(200);
      // The rule still weighs the phone's other requests, the same in both modes.
      expect(ask(remote, 'timers'), mode).toEqual({
        status: 403,
        body: { ok: false, message: PHONE_REFUSAL.computer },
      });
    }
  });

  it('leaves the other kinds as they were: Announcements and Chat devices chat, a Stage device and the poster do not; the flow is a Remote’s only', async () => {
    for (const mode of ['simple', 'pro'] as const) {
      const { service, ask, page } = setup(mode);
      const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
      const sender = service.pairForCheck('announcements', 'Placeholder sender').id;
      service.makePoster();
      const poster = service.status().devices.find((d) => d.poster)?.id ?? '';
      const shown = service.startChatInvite();
      if (!shown.ok || !shown.status.chatInvite) throw new Error('no Chat QR');
      const paired = service.pair(shown.status.chatInvite.code, PHONE);
      if (!paired.ok) throw new Error(paired.message);
      const chatPhone = paired.device.id;

      // Each with a name of its own (a name someone else has is taken).
      for (const [id, name] of [
        [sender, 'Person 2'],
        [chatPhone, 'Person 3'],
      ] as const) {
        expect(ask(id, 'chat').status, `${mode} chat`).toBe(200);
        expect(ask(id, 'chat.name', { name }).status, `${mode} chat.name`).toBe(200);
        expect(ask(id, 'chat.send', { text: 'Placeholder' }).status, `${mode} chat.send`).toBe(200);
      }
      expect(ask(stage, 'chat').status, mode).toBe(403);
      expect(ask(poster, 'chat'), mode).toEqual({
        status: 403,
        body: { ok: false, message: CHAT_REFUSAL.notIn },
      });
      for (const id of [stage, sender, poster, chatPhone]) {
        const flow = ask(id, 'flow');
        expect(flow.status, mode).toBe(403);
        // Refused by its kind, never in the phone rule's words (those are a Remote's alone).
        expect(Object.values(PHONE_REFUSAL), mode).not.toContain((flow.body as { message?: string }).message);
        expect((await page(id)).status, mode).toBe(403);
      }
    }
  });
});
