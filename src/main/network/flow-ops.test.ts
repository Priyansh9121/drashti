import { describe, expect, it } from 'vitest';
import { STOPPED_REFUSAL } from '../../shared/access';
import type { CommandResult } from '../../shared/engine/commands';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import { IPC, type InvokeChannel } from '../../shared/ipc';
import { SIMPLE_MODE_REFUSAL } from '../../shared/mode';
import { DEVICE_OPS, type DeviceOp } from '../../shared/network-api';
import type { SabhaFlow, SabhaFlowSnapshot } from '../../shared/sabha-flow';
import type { SimpleFeature } from '../../shared/simple-features';
import { openDatabase } from '../db/database';
import { DeviceRepo } from '../db/devices';
import { PHONE_OPS_IN_SIMPLE_MODE, type SimplePhoneScope } from '../simple-mode-phones';
import type { FlowReads } from './flow-answers';
import { NetworkService, OP_CHANNEL } from './network-service';

/*
 * Sabha flow on a phone (alpha.23, QA23-FLOW-1 and QA23-FLOW-2): a Remote reads the operator's current flow and its
 * Now as the operator window's flow:get answers it, and a page as flow:page draws it, each checked as every phone
 * request is (Drashti let in, the device and its kind, Simple Mode's tables with the window's own channel), read only.
 * A page is given only for the flow that is the current one, and only as a PNG. Placeholder words, made-up ids and a
 * made-up few bytes for a PNG.
 */

const PHONE = '192.168.1.20';

const FLOW: SabhaFlow = {
  id: 'flow-placeholder-0001',
  fileName: 'Placeholder evening order.pdf',
  pageCount: 2,
  drawnPages: 2,
  status: 'read',
  lang: 'en',
  title: 'Placeholder Evening',
  headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
  items: [
    { no: '1', cells: ['Placeholder opening', 'Placeholder words', '10 min', 'Placeholder A'] },
    { no: '2', cells: ['Placeholder talk', 'Placeholder topic', '10 min', 'Placeholder A'] },
  ],
  total: 'Placeholder total 20 min',
};

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);

/** Simple Mode's one playlist, empty: what the phone may do there is weighed by its table, not by a playlist. */
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

function setup(options: { simple?: boolean; flow?: boolean } = {}) {
  const db = openDatabase(':memory:');
  const devices = new DeviceRepo(db);
  let simple = options.simple === true;
  let chosen: readonly SimpleFeature[] = [];
  let letIn = true;
  let snapshot: SabhaFlowSnapshot = { flow: FLOW, state: { flowId: FLOW.id, now: 0 } };
  let pages: Record<number, Uint8Array | null> = { 0: PNG, 1: PNG };
  const asked: [flowId: string, page: number][] = [];
  const flow: FlowReads = {
    snapshot: () => snapshot,
    page: (flowId, page) => {
      asked.push([flowId, page]);
      return Promise.resolve(pages[page] ?? null);
    },
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
    ...(options.flow === false ? {} : { flow }),
    // Simple Mode's lock as the window's requests meet it: only what it locks for the window (none of the flow's reads).
    refused: (channel: InvokeChannel) =>
      simple && ([IPC.flow.choose, IPC.flow.remove, IPC.flow.setNow] as InvokeChannel[]).includes(channel),
    refusal: () => SIMPLE_MODE_REFUSAL,
    simple: () => (simple ? SIMPLE : null),
    simpleFeatures: () => chosen,
    changed: () => undefined,
    log: () => undefined,
    now: () => 1_000_000,
    letIn: () => letIn,
  });
  const remote = service.pairForCheck('remote', 'Placeholder phone').id;
  const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
  const poster = service.pairForCheck('announcements', 'Placeholder poster').id;
  const ask = (deviceId: string, op: DeviceOp, args: Record<string, unknown> = {}) =>
    service.answer({ address: PHONE, deviceId, op, args });
  const page = (deviceId: string, args: Record<string, unknown>) =>
    service.flowPage({ address: PHONE, deviceId, op: 'flow.page', args });
  return {
    ask,
    page,
    remote,
    stage,
    poster,
    asked,
    setSnapshot: (s: SabhaFlowSnapshot) => {
      snapshot = s;
    },
    setPages: (p: Record<number, Uint8Array | null>) => {
      pages = p;
    },
    setSimple: (on: boolean) => {
      simple = on;
    },
    choose: (tools: readonly SimpleFeature[]) => {
      chosen = tools;
    },
    setLetIn: (on: boolean) => {
      letIn = on;
    },
  };
}

describe('Sabha flow on a phone (alpha.23)', () => {
  it('is a Remote’s only, read through the window’s own flow:get and flow:page', () => {
    expect(DEVICE_OPS.flow).toEqual(['remote']);
    expect(DEVICE_OPS['flow.page']).toEqual(['remote']);
    expect(OP_CHANNEL.flow).toBe(IPC.flow.get);
    expect(OP_CHANNEL['flow.page']).toBe(IPC.flow.page);
    // Reads: nothing changes, so Simple Mode's own lock (none on flow:get or flow:page) says what it says to the window.
    expect(PHONE_OPS_IN_SIMPLE_MODE.flow).toBe('reads');
    expect(PHONE_OPS_IN_SIMPLE_MODE['flow.page']).toBe('reads');
  });

  it('answers the current flow and its Now, as flow:get answers the window', () => {
    const { ask, remote, setSnapshot } = setup();
    expect(ask(remote, 'flow')).toEqual({
      status: 200,
      body: { ok: true, flow: FLOW, state: { flowId: FLOW.id, now: 0 } },
    });
    // Now moved on: the next read says so.
    setSnapshot({ flow: FLOW, state: { flowId: FLOW.id, now: 1 } });
    expect(ask(remote, 'flow').body).toMatchObject({ state: { now: 1 } });
    // Removed: no flow, plainly (never a refusal).
    setSnapshot({ flow: null, state: null });
    expect(ask(remote, 'flow')).toEqual({ status: 200, body: { ok: true, flow: null, state: null } });
  });

  it('answers no flow where Drashti has none to give (a test of something else, or no store)', () => {
    const { ask, remote } = setup({ flow: false });
    expect(ask(remote, 'flow')).toEqual({ status: 200, body: { ok: true, flow: null, state: null } });
  });

  it('gives a page of the current flow as its PNG, by its number from 0', async () => {
    const { page, remote, asked } = setup();
    expect(await page(remote, { page: '0', flowId: FLOW.id })).toEqual({
      status: 200,
      body: { ok: true, png: PNG },
    });
    expect(await page(remote, { page: '1', flowId: FLOW.id })).toMatchObject({ status: 200 });
    expect(asked).toEqual([
      [FLOW.id, 0],
      [FLOW.id, 1],
    ]);
  });

  it('refuses a page of a flow replaced or removed since, so a phone reads the flow again', async () => {
    const { page, remote, setSnapshot, asked } = setup();
    expect((await page(remote, { page: '0', flowId: 'flow-placeholder-0000' })).status).toBe(409);
    setSnapshot({ flow: null, state: null });
    expect((await page(remote, { page: '0', flowId: FLOW.id })).status).toBe(409);
    expect(asked).toEqual([]);
  });

  it('refuses a page it does not have, or one asked for wrongly, in plain words', async () => {
    const { page, remote, setPages, asked } = setup();
    // Past the flow's pages: never asked of the store.
    expect((await page(remote, { page: '2', flowId: FLOW.id })).status).toBe(404);
    expect(asked).toEqual([]);
    for (const args of [
      { page: '0' },
      { page: 'one', flowId: FLOW.id },
      { page: '-1', flowId: FLOW.id },
      { page: '0', flowId: '../placeholder' },
      { page: 0, flowId: FLOW.id },
    ]) {
      const answer = await page(remote, args);
      expect(answer.status, JSON.stringify(args)).toBe(400);
      const body = answer.body as { ok: boolean; message: unknown };
      expect(body.ok, JSON.stringify(args)).toBe(false);
      expect(typeof body.message, JSON.stringify(args)).toBe('string');
    }
    // Not drawn, or not a PNG: no page.
    setPages({ 0: null, 1: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]) });
    expect((await page(remote, { page: '0', flowId: FLOW.id })).status).toBe(404);
    expect((await page(remote, { page: '1', flowId: FLOW.id })).status).toBe(404);
  });

  it('refuses both to a Stage device, the announcements poster, and every device while Drashti is not let in', async () => {
    const { ask, page, stage, poster, remote, setLetIn, asked } = setup();
    for (const device of [stage, poster]) {
      expect(ask(device, 'flow').status).toBe(403);
      expect((await page(device, { page: '0', flowId: FLOW.id })).status).toBe(403);
    }
    setLetIn(false);
    expect(ask(remote, 'flow')).toEqual({ status: 503, body: { ok: false, message: STOPPED_REFUSAL } });
    expect((await page(remote, { page: '0', flowId: FLOW.id })).status).toBe(503);
    expect(asked).toEqual([]);
  });

  it('tells a phone in the hall which tools Simple Mode Features brought into Simple Mode, so it shows the flow only while it is one (QA23-FLOWP-1)', () => {
    const { ask, remote, setSimple, choose } = setup();
    // Pro Mode: no Simple Mode to tell of.
    expect(ask(remote, 'hall').body).toMatchObject({ simple: null });
    setSimple(true);
    expect(ask(remote, 'hall').body).toMatchObject({ simple: { features: [] } });
    choose(['timers', 'sabha-flow']);
    expect(ask(remote, 'hall').body).toMatchObject({ simple: { features: ['timers', 'sabha-flow'] } });
  });

  it('reads in Simple Mode as the window reads (Simple Mode locks only the flow’s changes)', async () => {
    const { ask, page, remote } = setup({ simple: true });
    expect(ask(remote, 'flow').status).toBe(200);
    expect((await page(remote, { page: '0', flowId: FLOW.id })).status).toBe(200);
  });
});
