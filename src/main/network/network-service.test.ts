import { describe, expect, it, vi } from 'vitest';
import type { PresentationDoc } from '../../shared/library';
import type { CapturedPicture } from '../../shared/pdf-copy';
import type { RenderSlide } from '../../shared/model';
import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import { IPC, type InvokeChannel } from '../../shared/ipc';
import { STOPPED_REFUSAL } from '../../shared/access';
import { SIMPLE_MODE_REFUSAL, simpleModeRefuses } from '../../shared/mode';
import { DEVICE_KINDS, type NetworkStatus, PAIRING_CODE_TTL_MS } from '../../shared/network';
import { DEVICE_OPS, type DeviceOp, type DeviceRequest, REMOTE_COMMANDS } from '../../shared/network-api';
import { messageItemId } from '../../shared/messages';
import { PHONE_REFUSAL, type PhoneWords } from '../../shared/phone-rule';
import { DEFAULT_PIP_PLACE } from '../../shared/pip';
import type { ScreenSwitches } from '../../shared/screen-switches';
import { openDatabase } from '../db/database';
import { DeviceRepo } from '../db/devices';
import { simpleModeRefusesWhole } from '../simple-mode';
import type { OscAction } from '../osc/mapping';
import type { SimplePhoneScope } from '../simple-mode-phones';
import type { NetworkWorker } from './network-worker';
import { NetworkService, OP_CHANNEL, type NetworkDeps } from './network-service';
import { hashToken } from './tokens';
import type { FromNetworkWorker, ToNetworkWorker } from './worker/protocol';

/* The main process's side of the network, with a stand-in worker; made-up tokens and placeholder names. */

/*
 * Since alpha.23 (QA23-PHONE-1, the owner: "no video access in either of simple or pro mode in phone ... only ppts an
 * pdfs, that also in pro mode, in simple mode only show the flow, whats running in live, and chat") a phone is refused
 * most of what these tests had it do: each proves that refusal in the phone rule's words, nothing run, then what the
 * request did by a caller the rule never weighs (the paired controller or OSC: runShowAction) or, where none is left,
 * with the rule aside (its code stays until alpha.24 deletes it). phone-rule-service.test.ts has the rule itself.
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

/** A phone's address on the local network (made up). */
const PHONE = '192.168.1.20';

/** What a phone is told in Simple Mode for what its window does not do (shared/mode.ts simplePhoneRefusalText). */
const PHONE_WORDS =
  'Simple Mode on Drashti’s computer: a phone does only what Simple Mode does there (playlists, playback and Audio). On the Drashti computer, a double-click on Pro Mode leaves it.';

/**
 * Simple Mode's one playlist as the main process reads it (index.ts): a talk (p001) and a picture; another playlist
 * has p007 (Session 55, the owner's answer of 30 Oct 2026: a phone does only what Simple Mode's window does).
 */
const ROWS: Record<string, { playlist: string; presentation?: string; media?: string }> = {
  'one-talk': { playlist: 'one-playlist', presentation: 'p001' },
  'one-picture': { playlist: 'one-playlist', media: 'm-picture' },
  'other-item': { playlist: 'other-playlist', presentation: 'p007' },
};
const activePlaylist = (id: string) => id === 'one-playlist' || id === 'other-playlist';
const testLists = {
  kindOf: (id: string) =>
    activePlaylist(id) ? ('playlist' as const) : id === 'template' ? ('template' as const) : null,
  activePlaylist,
  activeItem: (id: string, itemId: string) => ROWS[itemId]?.playlist === id,
  listsMedia: (mediaId: string) => Object.values(ROWS).some((r) => r.media === mediaId),
  listsPresentation: (id: string) => Object.values(ROWS).some((r) => r.presentation === id),
};
const ONE: SimplePhoneScope = {
  ...testLists,
  playlistId: 'one-playlist',
  playlistOf: (itemId) => ROWS[itemId]?.playlist ?? null,
  holdsMedia: (mediaId) =>
    Object.values(ROWS).some((r) => r.playlist === 'one-playlist' && r.media === mediaId),
  holdsPresentation: (id) =>
    Object.values(ROWS).some((r) => r.playlist === 'one-playlist' && r.presentation === id),
  plays: (id, from?: { playlistId: string; itemId: string }) =>
    from
      ? ROWS[from.itemId]?.playlist === from.playlistId && ROWS[from.itemId]?.presentation === id
      : Object.values(ROWS).some((r) => r.presentation === id),
  refusal: () => PHONE_WORDS,
};

function setup(
  options: {
    locked?: boolean;
    lockEverything?: boolean;
    letIn?: { now: boolean };
    presentation?: NetworkDeps['reads']['presentation'];
    capture?: NetworkDeps['nativeSlidePicture'];
    onAir?: NetworkDeps['onAir'];
    /** This computer's addresses and name on the network as a test gives them (the guides' pictures, Session 55). */
    shown?: { addresses: string[]; localName: string };
    /** The log's lines, for a test that reads them. */
    logs?: string[];
    notices?: string[];
  } = {},
) {
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
    localName: () => options.shown?.localName ?? null,
    ...(options.shown ? { interfaceAddresses: () => options.shown?.addresses ?? [] } : {}),
    engine: {
      dispatch: (c): CommandResult => {
        // As the engine does in Simple Mode (show-engine.ts, refuse).
        if (options.locked === true && simpleModeRefuses(c, state))
          return { ok: false, error: 'forbidden', message: SIMPLE_MODE_REFUSAL };
        commands.push(c);
        return { ok: true, changed: true, rev: commands.length };
      },
      snapshot: () => ({ kind: 'snapshot', version: ENGINE_STATE_VERSION, rev: 0, state, sentAt: 0 }),
      state: () => state,
    },
    nativeSlidePicture: options.capture,
    ...(options.onAir ? { onAir: options.onAir } : {}),
    reads: {
      playlists: () => [],
      items: () => [],
      presentation: options.presentation ?? (() => null),
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
      mediaSource: () => null,
      // A sound a playlist shared with phones has (Session 54, D3): its file, for a phone to play.
      sharedSound: (mediaId) => (mediaId === 'm-shared-sound' ? '/placeholder/Media/ab/tone.wav' : null),
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
              message: `No loaded book is called “${reference.split(' ')[0] ?? ''}”. The books are: PG.`,
            },
    },
    // The mirror's reads (Session 54, D5): mirror-ops.test.ts checks them.
    mirror: {
      media: () => [],
      lowerThirds: () => [],
      music: () => [],
      keys: () => ({ platform: 'darwin', singleKeys: true }),
      repeatStep: () => null,
    },
    playMusic: () => ({ ok: true as const }),
    announcements: {
      submit: (device, address, input) => {
        announced.push({ device: device.id, address, input });
        return { status: 202, body: { ok: true } };
      },
      statusFor: () => ({ status: 404, body: { ok: false } }),
    },
    // As refusedNow answers a request with none of its arguments: every channel Simple Mode locks or bounds.
    refused: (channel: InvokeChannel) =>
      options.lockEverything === true || (options.locked === true && simpleModeRefusesWhole(channel)),
    // Simple Mode as a phone's request is weighed (Session 55, the owner's answer of 30 Oct 2026).
    simple: () => (options.locked === true ? ONE : null),
    changed: (s) => statuses.push(s),
    notice: (text) => options.notices?.push(text),
    log: (_level, line) => {
      options.logs?.push(line);
    },
    now: () => now,
    ...(options.letIn ? { letIn: () => options.letIn?.now ?? false } : {}),
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

const slideForPicture: RenderSlide = {
  id: 'placeholder-slide',
  width: 960,
  height: 540,
  background: '#ffffff',
  elements: [
    {
      id: 'placeholder-image',
      kind: 'image',
      mediaId: 'placeholder-picture',
      fit: 'fit',
      frame: { x: 0, y: 0, width: 960, height: 540 },
    },
  ],
  deck: {
    steps: [],
    media: [],
    motion: { stepsMs: [0, 300], effects: [], approximate: false },
  },
};

/** Two captured pixels (made-up values): the network's process makes them a PNG (png.ts). */
const captured: CapturedPicture = {
  width: 2,
  height: 1,
  pixels: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]),
  order: 'bgra',
};

function pictureSetup() {
  const capture = vi.fn<NonNullable<NetworkDeps['nativeSlidePicture']>>(() => Promise.resolve(captured));
  const doc: PresentationDoc = {
    id: 'placeholder-deck',
    name: 'Placeholder deck',
    width: 960,
    height: 540,
    arrangements: [],
    selectedArrangementId: null,
    transition: null,
    loop: false,
    kirtan: null,
    source: null,
    groups: [
      {
        id: 'placeholder-group',
        name: '',
        color: null,
        slides: [
          {
            id: slideForPicture.id,
            index: 0,
            label: '',
            notes: '',
            slide: slideForPicture,
            cues: [],
            transition: null,
            autoAdvanceMs: null,
            macroId: null,
          },
        ],
      },
    ],
  };
  const letIn = { now: true };
  const onAir = { now: false };
  const t = setup({
    capture,
    presentation: (id) => (id === doc.id ? doc : null),
    letIn,
    onAir: () => onAir.now,
  });
  const remote = t.devices.add({
    name: 'Placeholder phone',
    kind: 'remote',
    tokenHash: hashToken('placeholder-remote'),
  });
  const stage = t.devices.add({
    name: 'Placeholder stage',
    kind: 'stage',
    tokenHash: hashToken('placeholder-stage'),
  });
  const request: DeviceRequest = {
    deviceId: remote.id,
    op: 'presentation',
    address: PHONE,
    args: {
      format: 'png',
      presentationId: doc.id,
      slideId: slideForPicture.id,
      click: '1',
    },
  };
  /**
   * A phone's Save picture (QA23-PHONE-1, the owner's Q8: Look closer is view only): refused in the media's words,
   * nothing captured; then the rule aside, for the capture's own behaviour, which no other caller reaches.
   */
  const refusedThenAside = async () => {
    expect(await t.service.presentationPicture(request)).toEqual(refusedAs('media'));
    expect(capture).not.toHaveBeenCalled();
    ruleAside(t.service);
  };
  return { ...t, capture, letIn, onAir, stage, request, refusedThenAside };
}

describe('saving a native click from a paired phone: refused since alpha.23 (QA23-PHONE-1, the owner’s Q8), the capture as before with the rule aside', () => {
  it('uses presentation read authority, refuses unknown slides or clicks, and bounds the phone’s requests', async () => {
    const t = pictureSetup();
    await t.refusedThenAside();
    const args = t.request.args as Record<string, unknown>;
    const save = (change: Record<string, unknown>) =>
      t.service.presentationPicture({ ...t.request, args: { ...args, ...change } });
    expect(await t.service.presentationPicture({ ...t.request, deviceId: 'unpaired' })).toMatchObject({
      status: 401,
    });
    expect(await t.service.presentationPicture({ ...t.request, deviceId: t.stage.id })).toMatchObject({
      status: 403,
    });
    expect(await save({ click: '1.5' })).toMatchObject({ status: 400 });
    expect(await save({ click: '2' })).toMatchObject({ status: 404 });
    expect(await save({ slideId: 'missing-slide' })).toMatchObject({ status: 404 });
    expect(t.capture).not.toHaveBeenCalled();
    expect(await save({})).toMatchObject({ status: 200, body: { picture: captured } });
    expect(t.capture.mock.calls[0]?.[0]).not.toHaveProperty('deck');
    for (let i = 0; i < 27; i++) expect(await save({})).toMatchObject({ status: 200 });
    expect(await save({})).toMatchObject({ status: 429 });
  });

  it('waits for the native effect, holds one capture slot and rechecks access before replying', async () => {
    vi.useFakeTimers();
    try {
      const t = pictureSetup();
      t.state.layers.slide = {
        presentationId: 'placeholder-deck',
        slideIndex: 0,
        slide: slideForPicture,
        notes: '',
        shownAt: 1_000_000,
        stepAt: 1_000_000,
        step: 1,
      };
      await t.refusedThenAside();
      const pending = t.service.presentationPicture(t.request);
      expect(await t.service.presentationPicture(t.request)).toMatchObject({
        status: 200,
        body: {
          mediaId: 'placeholder-picture',
          message: 'This is a picture from the slide. Try saving this click again in a moment.',
        },
      });
      expect(t.capture).not.toHaveBeenCalled();
      t.tick(299);
      await vi.advanceTimersByTimeAsync(299);
      expect(t.capture).not.toHaveBeenCalled();
      t.capture.mockImplementationOnce(() => {
        t.letIn.now = false;
        return Promise.resolve(captured);
      });
      t.tick(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.capture).toHaveBeenCalledTimes(1);
      expect(await pending).toMatchObject({ status: 503 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back without capturing when a slow zoom outlasts the settle wait', async () => {
    const t = pictureSetup();
    t.state.layers.slide = {
      presentationId: 'placeholder-deck',
      slideIndex: 0,
      slide: slideForPicture,
      notes: '',
      shownAt: 1_000_000,
      transition: { kind: 'zoom', durationMs: 500 },
    };
    await t.refusedThenAside();
    expect(await t.service.presentationPicture(t.request)).toMatchObject({
      status: 200,
      body: {
        mediaId: 'placeholder-picture',
        message: 'This is a picture from the slide. Try again when the screens are still to save this click.',
      },
    });
    expect(t.capture).not.toHaveBeenCalled();
  });

  it('answers with a picture from the slide while the stream is on air or recording, and stops a capture then', async () => {
    const t = pictureSetup();
    // C6's review, MEDIUM 3: no new background work while the stream is on air or recording.
    t.onAir.now = true;
    await t.refusedThenAside();
    expect(await t.service.presentationPicture(t.request)).toMatchObject({
      status: 200,
      body: {
        mediaId: 'placeholder-picture',
        message:
          'This is a picture from the slide. Try again after streaming or recording stops to save this click.',
      },
    });
    expect(t.capture).not.toHaveBeenCalled();
    t.onAir.now = false;
    t.capture.mockImplementationOnce((_slide, _looks, current) => {
      // The stream goes on air while the capture runs: its next step finds it no longer wanted.
      t.onAir.now = true;
      expect(current()).toBe(false);
      return Promise.resolve(captured);
    });
    expect(await t.service.presentationPicture(t.request)).toMatchObject({
      status: 200,
      body: {
        mediaId: 'placeholder-picture',
        message:
          'This is a picture from the slide. Try again after streaming or recording stops to save this click.',
      },
    });
    expect(t.capture).toHaveBeenCalledTimes(1);
  });

  it('answers with a picture from the slide when the slide moves on by itself within the capture’s time', async () => {
    const t = pictureSetup();
    // Repeat Slides or the slide's timing: on to the next in 4 s (C6's review, MEDIUM 2).
    t.state.autoAdvance = { startedAt: 1_000_000 - 1_000, durationMs: 5_000 };
    await t.refusedThenAside();
    expect(await t.service.presentationPicture(t.request)).toMatchObject({
      status: 200,
      body: {
        mediaId: 'placeholder-picture',
        message: 'This is a picture from the slide. Try again when the screens are still to save this click.',
      },
    });
    expect(t.capture).not.toHaveBeenCalled();
  });

  it('stops capture a second before the quiet window closes so the network can make the PNG', async () => {
    vi.useFakeTimers();
    try {
      const t = pictureSetup();
      t.state.layers.slide = {
        presentationId: 'placeholder-deck',
        slideIndex: 0,
        slide: slideForPicture,
        notes: '',
        shownAt: 1_000_000,
        transition: { kind: 'dissolve', durationMs: 2_000 },
      };
      await t.refusedThenAside();
      let signal: AbortSignal | undefined;
      let current: (() => boolean) | undefined;
      let done: ((value: null) => void) | undefined;
      t.capture.mockImplementationOnce((...args: unknown[]) => {
        current = args[2] as (() => boolean) | undefined;
        signal = args[3] as AbortSignal | undefined;
        return new Promise<null>((resolve) => {
          done = resolve;
        });
      });
      const pending = t.service.presentationPicture(t.request);
      t.tick(2_000);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(t.capture).toHaveBeenCalledTimes(1);
      // The quiet window ends nine seconds after the ask. The network keeps the last second.
      t.tick(5_999);
      await vi.advanceTimersByTimeAsync(5_999);
      expect(signal?.aborted).toBe(false);
      expect(current?.()).toBe(true);
      t.tick(1);
      expect(current?.()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      done?.(null);
      // Stopped at its end with the screens still: worth asking again soon.
      expect(await pending).toMatchObject({
        status: 200,
        body: {
          mediaId: 'placeholder-picture',
          message: 'This is a picture from the slide. Try saving this click again in a moment.',
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the network in the main process', () => {
  it('is off until turned on, then starts the worker and hands it the devices and the state', () => {
    const { service, sent, fromWorker } = setup();
    expect(service.status()).toMatchObject({ on: false, state: 'off', port: 8740 });
    service.resume();
    expect(sent).toEqual([]);
    expect(service.setOn(true)).toMatchObject({ ok: true });
    // The devices, whether Drashti is let in (Session 54) and the state before it listens: a device reconnecting at
    // once is known.
    expect(sent.map((m) => m.type)).toEqual(['devices', 'access', 'engine', 'start']);
    expect(sent[1]).toEqual({ type: 'access', letIn: true });
    expect(sent[3]).toMatchObject({ type: 'start', options: { port: 8740 } });
    fromWorker({ type: 'started', result: { ok: true, port: 8740 } });
    expect(service.status().state).toBe('listening');
    expect(sent.map((m) => m.type)).toEqual(['devices', 'access', 'engine', 'start', 'devices', 'engine']);
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

  it('shows the address and name it is given in place of this computer’s own, in its pairing and poster links too (the guides’ pictures, Session 55)', () => {
    const { service } = setup({ shown: { addresses: ['192.168.1.20'], localName: 'placeholder-mac.local' } });
    expect(service.status()).toMatchObject({
      addresses: ['http://192.168.1.20:8740'],
      localName: 'http://placeholder-mac.local:8740',
    });
    const offered = service.startPairing('remote', 'Placeholder phone');
    if (!offered.ok || !offered.status.pairing) throw new Error('no code');
    expect(offered.status.pairing.url).toMatch(/^http:\/\/192\.168\.1\.20:8740\/pair#c=\d{6}$/u);
    const poster = service.makePoster();
    if (!poster.ok) throw new Error(poster.message);
    expect(poster.status.poster?.url).toMatch(/^http:\/\/192\.168\.1\.20:8740\/announce#k=/u);
  });

  it('cleans a device’s name as Rename… cleans one, and refuses one with nothing visible (C15, FT-1)', () => {
    const { service } = setup();
    expect(service.startPairing('remote', '\u200B\u2060\u00AD')).toMatchObject({ ok: false });
    const offered = service.startPairing('remote', 'Placeholder\u200E phone');
    if (!offered.ok || !offered.status.pairing) throw new Error('no code');
    expect(offered.status.pairing.name).toBe('Placeholder phone');
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

  it('refuses a Remote the picture-in-picture box (QA23-PHONE-1); the paired controller sets it up, swaps it, moves it and takes it off, as Picture in Picture… does (Session 54; a phone until alpha.23)', () => {
    const { service, commands } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    const phone = (args: Record<string, unknown>) =>
      service.answer({ address: PHONE, deviceId: remote, op: 'command', args });
    const send = (args: Record<string, unknown>) => fromController(service, 'command', args).status;
    const sent = [
      { type: 'showPip', source: { kind: 'slides' } },
      { type: 'showPip', source: { kind: 'window', id: 'window:4021:0' } },
      { type: 'showPip', source: { kind: 'input', inputId: 'in-1' } },
      { type: 'showPip', source: { kind: 'media', mediaId: 'placeholder-video' }, place: DEFAULT_PIP_PLACE },
      { type: 'swapPip' },
      { type: 'placePip', place: DEFAULT_PIP_PLACE },
      // Take off, and the box's own clear (POST /api/v1/clear/pip): both play its out.
      { type: 'hidePip' },
      { type: 'clearLayer', layer: 'pip' },
    ];
    // A phone: the computer's, every one (Clear slide alone is a phone's: the owner's Q7).
    for (const args of sent) expect(phone(args), JSON.stringify(args)).toEqual(refusedAs('computer'));
    expect(commands).toEqual([]);
    for (const args of sent) expect(send(args), JSON.stringify(args)).toBe(200);
    expect(commands).toEqual(sent);
    // Never a file or an address for what it holds: refused before the engine hears of it.
    expect(send({ type: 'showPip', source: { kind: 'media', path: '/placeholder/file.mp4' } })).toBe(400);
    expect(send({ type: 'showPip', source: { kind: 'window', url: 'https://example.com' } })).toBe(400);
    // A Stage device: none of it.
    const stage = service.pairForCheck('stage', 'Placeholder stage').id;
    expect(
      service.answer({ address: PHONE, deviceId: stage, op: 'command', args: { type: 'swapPip' } }).status,
    ).toBe(403);
    expect(commands).toHaveLength(sent.length);
    for (const type of ['showPip', 'swapPip', 'placePip', 'hidePip'])
      expect(REMOTE_COMMANDS as readonly string[]).toContain(type);
  });

  it('refuses a Remote the time bar under LIVE (QA23-PHONE-1: no video access); the paired controller moves, pauses and plays on what plays, as the time bar does (Session 54)', () => {
    const { service, commands } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    const send = (args: Record<string, unknown>) => fromController(service, 'command', args).status;
    const sent = [
      { type: 'moveTo', playing: { layer: 'background' }, toMs: 12_000 },
      { type: 'pausePlaying', playing: { layer: 'pip' } },
      { type: 'resumePlaying', playing: { layer: 'slide', mediaId: 'placeholder-video' } },
    ];
    for (const args of sent)
      expect(
        service.answer({ address: PHONE, deviceId: remote, op: 'command', args }),
        JSON.stringify(args),
      ).toEqual(refusedAs('media'));
    expect(commands).toEqual([]);
    for (const args of sent) expect(send(args), JSON.stringify(args)).toBe(200);
    expect(commands).toEqual(sent);
    // Named wrongly, or a point before the file's start: refused before the engine hears of it.
    expect(send({ type: 'moveTo', playing: { layer: 'slide' }, toMs: 1000 })).toBe(400);
    expect(send({ type: 'moveTo', playing: { layer: 'background' }, toMs: -5 })).toBe(400);
    expect(commands).toHaveLength(3);
  });

  it('refuses a Simple Mode phone the time bar and Audio in Simple Mode’s words (QA23-PHONE-1); in Simple Mode the paired controller moves, pauses and plays what is live, and uses Audio’s skips only on music', () => {
    const { service, commands, state } = setup({ locked: true });
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    for (const args of [
      { type: 'moveTo', playing: { layer: 'background' }, toMs: 12_000 },
      { type: 'pausePlaying', playing: { layer: 'audio' } },
      { type: 'pauseMusic' },
      { type: 'skip', layer: 'audio', jump: 'forward' },
    ])
      expect(
        service.answer({ address: PHONE, deviceId: remote, op: 'command', args }),
        JSON.stringify(args),
      ).toEqual(refusedAs('simple'));
    expect(commands).toEqual([]);
    const answer = (args: Record<string, unknown>) => fromController(service, 'command', args);
    const sound = {
      id: 'placeholder-sound',
      title: 'Placeholder tone',
      mediaId: 'placeholder-tone',
      volume: 1,
      loop: false,
      startedAt: 1,
    };
    state.layers.audio = sound;
    for (const layer of ['background', 'audio'])
      expect(answer({ type: 'skip', layer, jump: 'back' })).toMatchObject({
        status: 403,
        body: { ok: false, message: SIMPLE_MODE_REFUSAL },
      });
    const timeBar = [
      { type: 'moveTo', playing: { layer: 'background' }, toMs: 12_000 },
      { type: 'pausePlaying', playing: { layer: 'background' } },
      { type: 'pausePlaying', playing: { layer: 'audio' } },
      { type: 'resumePlaying', playing: { layer: 'background' } },
      { type: 'resumePlaying', playing: { layer: 'audio' } },
    ];
    for (const args of timeBar) expect(answer(args).status, JSON.stringify(args)).toBe(200);
    state.layers.audio = {
      ...sound,
      music: {
        playlistId: 'placeholder-list',
        name: 'Placeholder',
        tracks: [],
        index: 0,
        loop: false,
        shuffle: false,
      },
    };
    const audio = [
      { type: 'pauseMusic' },
      { type: 'musicNext' },
      { type: 'musicPrevious' },
      { type: 'skip', layer: 'audio', jump: 'forward' },
    ];
    for (const args of audio) expect(answer(args).status, JSON.stringify(args)).toBe(200);
    expect(answer({ type: 'skip', layer: 'background', jump: 'back' }).status).toBe(403);
    expect(commands).toEqual([...timeBar, ...audio]);
  });

  it('lets each kind of device do only its own things, and a Remote only what the phone rule lets it (QA23-PHONE-1); the paired controller runs the show and fills a message, and Shastra goes up as before with the rule aside', () => {
    const { service, commands } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
    const poster = service.pairForCheck('announcements', 'Placeholder poster').id;
    const controller = (op: 'command' | 'message.show' | 'message.hide', args: Record<string, unknown>) =>
      fromController(service, op, args);
    // A phone's Next with no PowerPoint or PDF on the screens: refused in words, nothing sent (Next inside one that
    // is: phone-rule-service.test.ts).
    expect(
      service.answer({ address: PHONE, deviceId: remote, op: 'command', args: { type: 'next' } }),
    ).toEqual(refusedAs('noDeck'));
    expect(commands).toEqual([]);
    expect(controller('command', { type: 'next' })).toMatchObject({
      status: 200,
      body: { ok: true, rev: 1 },
    });
    expect(
      service.answer({ address: PHONE, deviceId: stage, op: 'command', args: { type: 'next' } }).status,
    ).toBe(403);
    expect(service.answer({ address: PHONE, deviceId: poster, op: 'playlists', args: {} }).status).toBe(403);
    // Not running the show: refused, though the engine would take it from the operator window. (The stage message
    // is a Remote's since Session 54, D5: mirror-ops.test.ts.)
    for (const [args, words] of [
      [{ type: 'setBackground', background: { kind: 'color', color: '#000000' } }, 'media'],
      [{ type: 'showMessage', message: { id: 'm', text: 'Placeholder' } }, 'computer'],
    ] as const)
      expect(service.answer({ address: PHONE, deviceId: remote, op: 'command', args }), args.type).toEqual(
        refusedAs(words),
      );
    expect(
      service.answer({ address: PHONE, deviceId: remote, op: 'command', args: { type: 'goLive' } }).status,
    ).toBe(400);
    // The Wallpaper (Session 55, the Logo's place) is a command; messages are made here from what the operator wrote,
    // never sent whole. A phone neither (QA23-PHONE-1); the paired controller both.
    expect(
      service.answer({
        address: PHONE,
        deviceId: remote,
        op: 'command',
        args: { type: 'setWallpaper', on: true },
      }),
    ).toEqual(refusedAs('media'));
    for (const [op, args] of [
      ['message.show', { templateId: 'm1', values: { plate: '12' } }],
      ['message.hide', { templateId: 'm1' }],
    ] as const)
      expect(service.answer({ address: PHONE, deviceId: remote, op, args }), op).toEqual(
        refusedAs('computer'),
      );
    expect(commands).toEqual([{ type: 'next' }]);
    controller('command', { type: 'setWallpaper', on: true });
    expect(commands.at(-1)).toEqual({ type: 'setWallpaper', on: true });
    expect(controller('message.show', { templateId: 'm1', values: {} })).toMatchObject({
      status: 400,
      body: { message: 'Fill in {plate} first.' },
    });
    controller('message.show', { templateId: 'm1', values: { plate: '12' } });
    expect(commands.at(-1)).toMatchObject({
      type: 'showMessage',
      message: { id: 'message:m1', text: 'Car 12 please move' },
    });
    controller('message.hide', { templateId: 'm1' });
    expect(commands.at(-1)).toEqual({ type: 'hideMessage', messageId: 'message:m1' });
    // Looks went (Session 55): a Remote can no longer switch one. A Stage device reads its group and languages.
    expect(
      service.answer({
        address: PHONE,
        deviceId: remote,
        op: 'command',
        args: { type: 'setLook', lookId: 'look-lower' },
      }).status,
    ).toBe(400);
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
    // Shastra: never a phone's (QA23-PHONE-1, the owner's Q4: only a PowerPoint or a PDF), nothing put up.
    const sent = commands.length;
    // The books' list is a read: the library's words (the review's S4).
    expect(service.answer({ address: PHONE, deviceId: remote, op: 'shastra.texts', args: {} })).toEqual(
      refusedAs('library'),
    );
    expect(
      service.answer({ address: PHONE, deviceId: remote, op: 'shastra', args: { reference: 'PG 14' } }),
    ).toEqual(refusedAs('notDeck'));
    expect(commands).toHaveLength(sent);
    // With the rule aside, as a Remote had it: it lists the texts and puts up a reference; nonsense is refused with why.
    ruleAside(service);
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
      body: { ok: false, message: 'No loaded book is called “XY”. The books are: PG.' },
    });
    expect(service.answer({ address: PHONE, deviceId: remote, op: 'shastra', args: {} }).status).toBe(400);
    expect(
      service.answer({ address: PHONE, deviceId: stage, op: 'shastra', args: { reference: 'PG 14' } }).status,
    ).toBe(403);
  });

  it('refuses a Remote a video input and every clear but the slide’s (QA23-PHONE-1); the paired controller clears one (Session 50) and puts one up by its id as Media does (Session 54)', () => {
    const { service, commands } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    for (const args of [
      { type: 'showInput', inputId: 'in-1' },
      { type: 'clearLayer', layer: 'background' },
      { type: 'clearAll' },
    ])
      expect(
        service.answer({ address: PHONE, deviceId: remote, op: 'command', args }),
        JSON.stringify(args),
      ).toEqual(refusedAs('computer'));
    expect(commands).toEqual([]);
    const command = (args: Record<string, unknown>) => fromController(service, 'command', args).status;
    expect(command({ type: 'showInput', inputId: 'in-1' })).toBe(200);
    expect(command({ type: 'clearLayer', layer: 'background' })).toBe(200);
    expect(command({ type: 'clearAll' })).toBe(200);
    expect(commands).toEqual([
      { type: 'showInput', inputId: 'in-1' },
      { type: 'clearLayer', layer: 'background' },
      { type: 'clearAll' },
    ]);
    // Simple Mode refuses it, as the window's Media does (the engine's refusal, from anywhere).
    const simple = setup({ locked: true });
    const phone = simple.service.pairForCheck('remote', 'Placeholder phone').id;
    expect(
      simple.service.answer({
        address: PHONE,
        deviceId: phone,
        op: 'command',
        args: { type: 'showInput', inputId: 'in-1' },
      }),
    ).toEqual(refusedAs('simple'));
    expect(fromController(simple.service, 'command', { type: 'showInput', inputId: 'in-1' }).status).toBe(
      403,
    );
    expect(simple.commands).toEqual([]);
  });

  it('lets a Remote see Repeat Slides going round, never start or stop it (QA23-PHONE-1); the paired controller starts and stops it (Session 26d)', () => {
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
    for (const args of [{ type: 'stopRepeat' }, { type: 'startRepeat', playlistId: 'lobby', slideIndex: 2 }])
      expect(service.answer({ address: PHONE, deviceId: remote, op: 'command', args }), args.type).toEqual(
        refusedAs('notDeck'),
      );
    expect(commands).toEqual([]);
    const controller = (args: Record<string, unknown>) => fromController(service, 'command', args).status;
    expect(controller({ type: 'stopRepeat' })).toBe(200);
    expect(commands.at(-1)).toEqual({ type: 'stopRepeat' });
    expect(controller({ type: 'startRepeat', playlistId: 'lobby', slideIndex: 2 })).toBe(200);
    expect(commands.at(-1)).toEqual({ type: 'startRepeat', playlistId: 'lobby', slideIndex: 2 });
    // A stage display shows it, and runs nothing.
    expect(
      service.answer({ address: PHONE, deviceId: stage, op: 'command', args: { type: 'stopRepeat' } }).status,
    ).toBe(403);
  });

  it('refuses a Remote the library’s pages and its search in both modes, and a presentation that is no PowerPoint or PDF (QA23-PHONE-1, the owner’s Q2 and Q4); with the rule aside, it read them a page at a time and searched, in Simple Mode too (Session 18)', () => {
    for (const locked of [false, true]) {
      const { service, commands } = setup({ locked });
      const remote = service.pairForCheck('remote', 'Placeholder phone').id;
      const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
      // A phone: the playlist only, a PowerPoint's or a PDF's rows only; nothing put up.
      // Reads, in the library's words (the review's S4).
      for (const op of ['presentations', 'search'] as const)
        expect(service.answer({ address: PHONE, deviceId: remote, op, args: {} }), op).toEqual(
          refusedAs('library'),
        );
      expect(
        service.answer({
          address: PHONE,
          deviceId: remote,
          op: 'command',
          args: { type: 'goLive', presentationId: 'p007', slideIndex: 1 },
        }),
      ).toEqual(refusedAs(locked ? 'simple' : 'notDeck'));
      expect(commands).toEqual([]);
      ruleAside(service);
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
      // Simple Mode still plays only a presentation with a row in a playlist.
      const slide = (presentationId: string) =>
        service.answer({
          address: PHONE,
          deviceId: remote,
          op: 'command',
          args: { type: 'goLive', presentationId, slideIndex: 1 },
        });
      if (locked) {
        expect(slide('p008')).toEqual({
          status: 403,
          body: { ok: false, error: 'forbidden', message: PHONE_WORDS },
        });
        expect(commands).toEqual([]);
        expect(slide('p007').status).toBe(200);
        expect(commands.at(-1)).toMatchObject({ type: 'goLive', presentationId: 'p007', slideIndex: 1 });
      } else {
        expect(slide('p007').status).toBe(200);
        expect(commands.at(-1)).toMatchObject({ type: 'goLive', presentationId: 'p007', slideIndex: 1 });
      }
      // A stage display reads neither.
      expect(service.answer({ address: PHONE, deviceId: stage, op: 'presentations', args: {} }).status).toBe(
        403,
      );
      expect(service.answer({ address: PHONE, deviceId: stage, op: 'search', args: {} }).status).toBe(403);
    }
    // The lock is asked for both, as for the window's own reads (the phone rule's words first, the rule aside after).
    const everything = setup({ lockEverything: true });
    const id = everything.service.pairForCheck('remote', 'Placeholder phone').id;
    for (const op of ['presentations', 'search'] as const)
      expect(everything.service.answer({ address: PHONE, deviceId: id, op, args: {} })).toEqual(
        refusedAs('library'),
      );
    ruleAside(everything.service);
    for (const op of ['presentations', 'search'] as const)
      expect(everything.service.answer({ address: PHONE, deviceId: id, op, args: {} })).toEqual({
        status: 403,
        body: { ok: false, message: SIMPLE_MODE_REFUSAL },
      });
  });

  it('refuses over the network exactly what Simple Mode refuses in the window: a phone in the phone rule’s words first (QA23-PHONE-1), the paired controller as the window', () => {
    // Each network action is the window request that does the same thing, so it gets the same answer: the only
    // ones locked are the screens' setup, which a phone changes as Screens does since Session 54 (the phone as a
    // full Drashti), refused in Simple Mode as in the window (Session 44: running a macro was one, and Macros are
    // gone).
    const locked = (Object.keys(DEVICE_OPS) as DeviceOp[]).filter((op) => {
      const channel = OP_CHANNEL[op];
      // Locked, or one Simple Mode's window may use within bounds (Session 55, Part 18: its one playlist's rows),
      // which a phone, asking with none of the window's arguments, is refused.
      return channel !== null && simpleModeRefusesWhole(channel);
    });
    expect(locked).toEqual([
      'music.new',
      'music.rename',
      'music.remove',
      'music.restore',
      'music.options',
      'music.addTracks',
      'music.moveTrack',
      'music.removeTrack',
      'music.restoreTrack',
      'music.stepsAside',
      'screens.addGroup',
      'screens.renameGroup',
      'screens.groupRole',
      'screens.deleteGroup',
      'screens.useDisplay',
      'screens.change',
      'screens.displayJob',
      'screens.remove',
      // Media's video inputs and Show a Window… (Session 54), Pro Mode's as in the window.
      'input.add',
      'input.change',
      'input.remove',
      'windows',
      'window.show',
      // The library's changes (Session 54), as the window's are.
      'library.new',
      'library.remove',
      'library.restore',
      'playlist.new',
      'playlist.rename',
      'playlist.remove',
      'playlist.restore',
      'playlist.add',
      'playlist.move',
      'playlist.removeItems',
      'playlist.restoreItems',
      // MIDI's changes (Session 54), as the window's MIDI… are; reading it stays open.
      'midi.device',
      'midi.forget',
      'midi.learn',
      // The announcements' decisions (Session 54), as the window's are.
      'queue.approve',
      'queue.reject',
      'queue.takeOff',
      // The stage layout every stage screen shows (Session 55), chosen as the Stage screen panel's Layout does.
      'stage.layout',
      // The phone's own (Session 55, Part 9): the wallpapers (bounded: Simple Mode's window has them, so with the
      // phone's arguments they run), the quick bar's changes, a picture's look, Rename… (bounded to Simple Mode's
      // playlist) and When it ends.
      'wallpaper.choose',
      'wallpaper.rename',
      'wallpaper.remove',
      'wallpaper.restore',
      'quickBar.set',
      'media.setLook',
      'media.rename',
      'presentation.rename',
      'playlist.whenEnds',
    ]);
    // In Simple Mode a phone runs nothing (QA23-PHONE-1): Simple Mode's words for each command, nothing sent.
    const simple = setup({ locked: true });
    const remote = simple.service.pairForCheck('remote', 'Placeholder phone').id;
    for (const args of [
      { type: 'next' },
      { type: 'zoomLive', zoom: 2, x: 0.5, y: 0.5 },
      { type: 'skip', layer: 'background', jump: 'forward' },
    ])
      expect(
        simple.service.answer({ address: PHONE, deviceId: remote, op: 'command', args }),
        args.type,
      ).toEqual(refusedAs('simple'));
    expect(simple.commands).toEqual([]);
    const controller = (t: ReturnType<typeof setup>, args: Record<string, unknown>) =>
      fromController(t.service, 'command', args);
    // In Simple Mode the paired controller still runs the show, as the window does.
    expect(controller(simple, { type: 'next' }).status).toBe(200);
    // And zooms the live picture too (Session 55, Part 5), but never jumps what plays, which the engine refuses in
    // Simple Mode, from anywhere (Session 54: Simple Mode shows the time bar and moves nothing).
    expect(controller(simple, { type: 'zoomLive', zoom: 2, x: 0.5, y: 0.5 }).status).toBe(200);
    expect(controller(simple, { type: 'skip', layer: 'background', jump: 'forward' })).toEqual({
      status: 403,
      body: { ok: false, error: 'forbidden', message: SIMPLE_MODE_REFUSAL },
    });
    // And the lock is asked: an action whose window request were locked is refused with Simple Mode's words (a
    // phone's Next, with no PowerPoint or PDF up, in the phone rule's first).
    const everything = setup({ lockEverything: true });
    const id = everything.service.pairForCheck('remote', 'Placeholder phone').id;
    expect(
      everything.service.answer({ address: PHONE, deviceId: id, op: 'command', args: { type: 'next' } }),
    ).toEqual(refusedAs('noDeck'));
    expect(controller(everything, { type: 'next' })).toEqual({
      status: 403,
      body: { ok: false, message: SIMPLE_MODE_REFUSAL },
    });
    expect(everything.commands).toEqual([]);
    expect(DEVICE_KINDS).toEqual(['remote', 'stage', 'announcements']);
  });

  it('in Simple Mode, a phone reads only what is live and runs nothing (QA23-PHONE-1); the paired controller does only what Simple Mode’s window does, refusing the rest in words before anything runs (Session 55, the owner’s answer of 30 Oct 2026); Shastra, Audio and the reads as before with the rule aside', () => {
    const { service, commands } = setup({ locked: true });
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    const ask = (op: DeviceOp, args: Record<string, unknown> = {}) =>
      service.answer({ address: PHONE, deviceId: remote, op, args });
    const controller = (op: 'command' | 'message.show' | 'message.hide', args: Record<string, unknown>) =>
      fromController(service, op, args);
    // What its window has no way to do: refused in the phone's words, nothing sent to the engine.
    const refused = [
      { type: 'setStageMessage', text: 'Placeholder: five minutes' },
      { type: 'startTimer', timerId: 'timer-1' },
      { type: 'pauseTimer', timerId: 'timer-1' },
      { type: 'resetTimer', timerId: 'timer-1' },
      { type: 'showTimer', timerId: 'timer-1' },
      { type: 'showAudienceTimer', timerId: 'timer-1' },
      { type: 'jumpToMarker', layer: 'background', markerId: 'marker-1' },
      { type: 'playItem', playlistId: 'one-playlist', itemId: 'other-item' },
      {
        type: 'goLive',
        presentationId: 'p001',
        slideIndex: 0,
        playlist: { playlistId: 'other-playlist', itemId: 'other-item' },
      },
      { type: 'startRepeat', playlistId: 'template' },
    ];
    // What its window does, and taking anything off the screens.
    const through = [
      { type: 'next' },
      { type: 'back' },
      { type: 'previous' },
      { type: 'nextItem' },
      { type: 'previousItem' },
      { type: 'playItem', playlistId: 'one-playlist', itemId: 'one-picture' },
      { type: 'playItem', playlistId: 'other-playlist', itemId: 'other-item' },
      { type: 'startRepeat', playlistId: 'other-playlist' },
      {
        type: 'goLive',
        presentationId: 'p007',
        slideIndex: 0,
        playlist: { playlistId: 'other-playlist', itemId: 'other-item' },
      },
      {
        type: 'goLive',
        presentationId: 'p001',
        slideIndex: 2,
        playlist: { playlistId: 'one-playlist', itemId: 'one-talk' },
      },
      { type: 'clearAll' },
      { type: 'putBack' },
      { type: 'clearLayer', layer: 'messages' },
      { type: 'toggleBlackout' },
      { type: 'setWallpaper', on: true },
      { type: 'hideLowerThird' },
      { type: 'hideAudienceTimer' },
      { type: 'clearStageMessage' },
      { type: 'hidePip' },
      { type: 'stopRepeat' },
    ];
    // A phone in Simple Mode (QA23-PHONE-1): every command in Simple Mode's words, its other requests in their group's,
    // nothing sent; it reads what is live (status, hall), never the playlists, the library, messages or timers.
    for (const args of [...refused, { type: 'showPip', source: { kind: 'slides' } }, ...through])
      expect(ask('command', args), JSON.stringify(args)).toEqual(refusedAs('simple'));
    for (const [op, args, words] of [
      ['message.show', { templateId: 'm1', values: { plate: 'AB 123' } }, 'computer'],
      ['message.hide', { templateId: 'm1' }, 'computer'],
      ['shastra', { reference: 'PG 14' }, 'notDeck'],
      ['playlists', {}, 'simple'],
      ['presentations', {}, 'library'],
      ['messages', {}, 'computer'],
      ['timers', {}, 'computer'],
    ] as const)
      expect(ask(op, args), op).toEqual(refusedAs(words));
    for (const op of ['status', 'hall'] as const) expect(ask(op).status, op).toBe(200);
    expect(commands).toEqual([]);

    // The paired controller, as Simple Mode's window: the refused in the phone's words, nothing sent to the engine.
    for (const args of refused)
      expect(controller('command', args), JSON.stringify(args)).toEqual({
        status: 403,
        body: { ok: false, error: 'forbidden', message: PHONE_WORDS },
      });
    expect(controller('message.show', { templateId: 'm1', values: { plate: 'AB 123' } })).toEqual({
      status: 403,
      body: { ok: false, message: PHONE_WORDS },
    });
    expect(commands).toEqual([]);
    // What the window is refused too keeps the window's own words (the engine's refusal, shared/mode.ts).
    expect(controller('command', { type: 'showPip', source: { kind: 'slides' } })).toEqual({
      status: 403,
      body: { ok: false, error: 'forbidden', message: SIMPLE_MODE_REFUSAL },
    });
    // What its window does, and taking anything off the screens: they run.
    for (const args of through) expect(controller('command', args).status, JSON.stringify(args)).toBe(200);
    expect(controller('message.hide', { templateId: 'm1' }).status).toBe(200);
    expect(commands).toEqual([...through, { type: 'hideMessage', messageId: messageItemId('m1') }]);
    // With the rule aside, as a phone had them: Shastra refused in the phone's words; the playlists, the library, the
    // messages and timers it may not show read.
    ruleAside(service);
    expect(ask('shastra', { reference: 'PG 14' })).toEqual({
      status: 403,
      body: { ok: false, message: PHONE_WORDS },
    });
    for (const op of ['status', 'playlists', 'presentations', 'messages', 'timers', 'hall'] as const)
      expect(ask(op).status, op).toBe(200);

    // In Pro Mode a phone is refused them too, in their group's words; the paired controller runs them, as before.
    const pro = setup();
    const phone = pro.service.pairForCheck('remote', 'Placeholder phone').id;
    const asked = (op: DeviceOp, args: Record<string, unknown>) =>
      pro.service.answer({ address: PHONE, deviceId: phone, op, args });
    const proCommands: [Record<string, unknown>, PhoneWords][] = [
      [{ type: 'setStageMessage', text: 'Placeholder: five minutes' }, 'computer'],
      [{ type: 'startTimer', timerId: 'timer-1' }, 'computer'],
      [{ type: 'showAudienceTimer', timerId: 'timer-1' }, 'computer'],
      [{ type: 'pauseMusic' }, 'media'],
      // p007 is no PowerPoint or PDF (the owner's Q4).
      [{ type: 'playItem', playlistId: 'other-playlist', itemId: 'other-item' }, 'notDeck'],
      [{ type: 'goLive', presentationId: 'p007', slideIndex: 0 }, 'notDeck'],
    ];
    for (const [args, words] of proCommands)
      expect(asked('command', args), JSON.stringify(args)).toEqual(refusedAs(words));
    expect(asked('message.show', { templateId: 'm1', values: { plate: 'AB 123' } })).toEqual(
      refusedAs('computer'),
    );
    expect(asked('shastra', { reference: 'PG 14' })).toEqual(refusedAs('notDeck'));
    expect(asked('music.play', { playlistId: 'music-1' })).toEqual(refusedAs('media'));
    expect(pro.commands).toEqual([]);
    const proController = (op: 'command' | 'message.show', args: Record<string, unknown>) =>
      fromController(pro.service, op, args).status;
    for (const [args] of proCommands) expect(proController('command', args), JSON.stringify(args)).toBe(200);
    expect(proController('message.show', { templateId: 'm1', values: { plate: 'AB 123' } })).toBe(200);
    ruleAside(pro.service);
    expect(asked('shastra', { reference: 'PG 14' }).status).toBe(200);
    expect(asked('music.play', { playlistId: 'music-1' }).status).toBe(200);
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

  it('tells a Remote which of Main’s screens are off, with the hall (Session 50), and turns them only as the window’s own request does (Session 54)', () => {
    const { service, switches } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    const hall = () => service.answer({ address: PHONE, deviceId: remote, op: 'hall', args: {} });
    expect(hall()).toMatchObject({ status: 200, body: { switches: { audience: true, stage: true } } });
    switches.audience = false;
    expect(hall()).toMatchObject({ status: 200, body: { switches: { audience: false, stage: true } } });
    // Since Session 54 (the phone as a full Drashti) one op turns them, a Remote's only, as the window's own
    // request (desktop-ops.test.ts has the rest).
    expect(Object.keys(DEVICE_OPS).filter((op) => /switch/iu.test(op))).toEqual(['switch']);
    expect(DEVICE_OPS.switch).toEqual(['remote']);
    expect(OP_CHANNEL.switch).toBe(IPC.screenSwitches.turn);
  });
});

describe('full quality and the zoom from a phone (Session 54, D1 and D2)', () => {
  it('refuses a Remote the zoom on the screens and back to whole, in both modes (QA23-PHONE-1, the owner’s Q8: Look closer is view only); the paired controller puts them on the screens, in Simple Mode too, as in the window (Session 55, Part 5)', () => {
    const { service, commands } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    for (const args of [{ type: 'zoomLive', zoom: 2, x: 0.25, y: 0 }, { type: 'resetLiveZoom' }])
      expect(service.answer({ address: PHONE, deviceId: remote, op: 'command', args }), args.type).toEqual(
        refusedAs('media'),
      );
    expect(commands).toEqual([]);
    const send = (args: Record<string, unknown>) => fromController(service, 'command', args);
    expect(send({ type: 'zoomLive', zoom: 2, x: 0.25, y: 0 }).status).toBe(200);
    expect(send({ type: 'resetLiveZoom' }).status).toBe(200);
    expect(commands).toEqual([{ type: 'zoomLive', zoom: 2, x: 0.25, y: 0 }, { type: 'resetLiveZoom' }]);
    // Within the live zoom's own limits (100 to 400 %).
    expect(send({ type: 'zoomLive', zoom: 9, x: 0, y: 0 }).status).toBe(400);
    expect(send({ type: 'zoomLive' }).status).toBe(400);
    // Simple Mode zooms the screens too (Session 55, Part 5: it refused both before).
    const simple = setup({ locked: true });
    const phone = simple.service.pairForCheck('remote', 'Placeholder phone').id;
    for (const args of [{ type: 'zoomLive', zoom: 2, x: 0, y: 0 }, { type: 'resetLiveZoom' }])
      expect(simple.service.answer({ address: PHONE, deviceId: phone, op: 'command', args })).toEqual(
        refusedAs('simple'),
      );
    expect(simple.commands).toEqual([]);
    for (const args of [{ type: 'zoomLive', zoom: 2, x: 0, y: 0 }, { type: 'resetLiveZoom' }])
      expect(fromController(simple.service, 'command', args).status).toBe(200);
    expect(simple.commands).toEqual([{ type: 'zoomLive', zoom: 2, x: 0, y: 0 }, { type: 'resetLiveZoom' }]);
    // A Stage device never zooms the screens.
    const stage = service.pairForCheck('stage', 'Placeholder tablet').id;
    expect(
      service.answer({ address: PHONE, deviceId: stage, op: 'command', args: { type: 'resetLiveZoom' } })
        .status,
    ).toBe(403);
  });

  it('leaves a picture at a width to the network server, by the previews’ rules, and refuses a phone a file’s original (QA23-PHONE-1), which the network server answered itself', () => {
    // A picture: what a preview was, for a Remote and a Stage device's picture box; a file in pieces: a Remote's.
    expect(DEVICE_OPS['media.picture']).toEqual(DEVICE_OPS.preview);
    expect(DEVICE_OPS['media.original']).toEqual(['remote']);
    // Looking is no change: Simple Mode lets it be, as it does previews.
    expect(OP_CHANNEL['media.picture']).toBeNull();
    expect(OP_CHANNEL['media.original']).toBeNull();
    const { service } = setup();
    const remote = service.pairForCheck('remote', 'Placeholder phone').id;
    expect(service.answer({ address: PHONE, deviceId: remote, op: 'media.picture', args: {} }).status).toBe(
      400,
    );
    expect(service.answer({ address: PHONE, deviceId: remote, op: 'media.original', args: {} })).toEqual(
      refusedAs('media'),
    );
    ruleAside(service);
    expect(service.answer({ address: PHONE, deviceId: remote, op: 'media.original', args: {} }).status).toBe(
      400,
    );
  });

  it('tells the worker a sound’s file only from the shared playlists, and a picture’s or video’s as before (D3)', async () => {
    const { service, sent, fromWorker } = setup();
    service.setOn(true);
    fromWorker({ type: 'started', result: { ok: true, port: 8740 } });
    fromWorker({ type: 'ask', id: 41, question: { kind: 'sound', mediaId: 'm-shared-sound' } });
    fromWorker({ type: 'ask', id: 42, question: { kind: 'sound', mediaId: 'm-other-sound' } });
    fromWorker({ type: 'ask', id: 43, question: { kind: 'media', mediaId: 'm-shared-sound' } });
    const answers = () => sent.filter((m) => m.type === 'answer');
    await vi.waitFor(() => {
      expect(answers()).toHaveLength(3);
    });
    expect(answers()).toEqual([
      { type: 'answer', id: 41, answer: '/placeholder/Media/ab/tone.wav' },
      { type: 'answer', id: 42, answer: null },
      { type: 'answer', id: 43, answer: null },
    ]);
  });
});

describe('while Drashti is not let in (Session 54, access by Gmail)', () => {
  it('refuses every device request and every pairing, and the worker hears at each change', () => {
    const letIn = { now: true };
    const { service, sent, commands, fromWorker } = setup({ letIn });
    service.setOn(true);
    const offered = service.startPairing('remote', 'Placeholder phone');
    if (!offered.ok || !offered.status.pairing) throw new Error('no code');
    const paired = service.pair(offered.status.pairing.code, PHONE);
    if (!paired.ok) throw new Error(paired.message);
    const again = service.startPairing('stage', 'Placeholder tablet');
    if (!again.ok || !again.status.pairing) throw new Error('no code');
    letIn.now = false;
    service.accessChanged();
    expect(sent.filter((m) => m.type === 'access').at(-1)).toEqual({ type: 'access', letIn: false });
    for (const op of Object.keys(DEVICE_OPS) as DeviceOp[]) {
      const answer = service.answer({ deviceId: paired.device.id, op, args: {}, address: PHONE });
      expect(answer, op).toEqual({ status: 503, body: { ok: false, message: STOPPED_REFUSAL } });
    }
    expect(commands).toEqual([]);
    expect(service.pair(again.status.pairing.code, PHONE)).toEqual({
      ok: false,
      status: 503,
      message: STOPPED_REFUSAL,
    });
    // A file asked for by the worker (a preview, a picture, an original): none.
    fromWorker({ type: 'ask', id: 7, question: { kind: 'media', mediaId: 'placeholder-media' } });
    return Promise.resolve().then(() => {
      expect(sent.filter((m) => m.type === 'answer').at(-1)).toEqual({ type: 'answer', id: 7, answer: null });
    });
  });
});

describe('OSC uses the API action layer without a paired phone', () => {
  it('validates commands, uses the engine, and never accepts an action that changes settings', async () => {
    const t = setup();
    expect(t.service.status().on).toBe(false);
    expect(t.service.runShowAction({ op: 'command', args: { type: 'next' } }).status).toBe(200);
    expect(t.commands).toEqual([{ type: 'next' }]);
    expect(
      t.service.runShowAction({
        op: 'command',
        args: { type: 'setStageMessage', text: 'Placeholder stage call' },
      }).status,
    ).toBe(200);
    expect(
      t.service.runShowAction({
        op: 'command',
        args: { type: 'setBackground', background: { kind: 'color', color: '#000000' } },
      }).status,
    ).toBe(403);
    expect(
      t.service.runShowAction({
        op: 'command',
        args: { type: 'goLive', presentationId: 'p001', slideIndex: -1 },
      }).status,
    ).toBe(400);
    await t.service.close();
  });

  it('retains the access gate and Simple Mode bounds, including the permitted playlist', async () => {
    const letIn = { now: false };
    const t = setup({ letIn });
    expect(t.service.runShowAction({ op: 'command', args: { type: 'next' } }).status).toBe(503);
    expect(t.commands).toHaveLength(0);
    letIn.now = true;
    expect(t.service.runShowAction({ op: 'command', args: { type: 'next' } }).status).toBe(200);
    await t.service.close();
    const u = setup({ locked: true });
    expect(
      u.service.runShowAction({ op: 'command', args: { type: 'setStageMessage', text: 'Placeholder' } })
        .status,
    ).toBe(403);
    expect(
      u.service.runShowAction({
        op: 'command',
        args: { type: 'goLive', presentationId: 'outside-all-playlists', slideIndex: 0 },
      }).status,
    ).toBe(403);
    expect(
      u.service.runShowAction({
        op: 'command',
        args: { type: 'goLive', presentationId: 'p001', slideIndex: 0 },
      }).status,
    ).toBe(200);
    expect(u.commands).toEqual([{ type: 'goLive', presentationId: 'p001', slideIndex: 0 }]);
    await u.service.close();
  });

  it('names who asked in the log: the OSC sender, or the caller the action layer is given (x28: a paired controller)', async () => {
    const logs: string[] = [];
    const t = setup({ logs });
    expect(t.service.runShowAction({ op: 'command', args: { type: 'next' } }).status).toBe(200);
    expect(
      t.service.runShowAction({ op: 'command', args: { type: 'next' } }, 'the paired controller').status,
    ).toBe(200);
    const asked = logs.filter((line) => /^Network: (OSC sender|the paired controller) /u.test(line));
    expect(asked.map((line) => line.split(' ').slice(1, 3).join(' '))).toEqual(['OSC sender', 'the paired']);
    await t.service.close();
  });

  it('uses API message template filling and the existing hide id, never raw showMessage content', async () => {
    const t = setup();
    expect(
      t.service.runShowAction({ op: 'message.show', args: { templateId: 'missing', values: {} } }).status,
    ).toBe(404);
    expect(t.commands).toHaveLength(0);
    expect(
      t.service.runShowAction({ op: 'message.hide', args: { templateId: 'placeholder-template' } }).status,
    ).toBe(200);
    expect(t.commands).toEqual([{ type: 'hideMessage', messageId: messageItemId('placeholder-template') }]);
    expect(
      t.service.runShowAction({
        op: 'command',
        args: { type: 'showMessage', message: { id: 'raw', text: 'Placeholder' } },
      }).status,
    ).toBe(403);
    await t.service.close();
  });
});

it('shows the general paired-device notice from its worker without changing network state', () => {
  const notices: string[] = [];
  const t = setup({ notices });
  t.service.setOn(true);
  t.fromWorker({ type: 'started', result: { ok: true, port: 8740 } });
  t.fromWorker({ type: 'busy' });
  expect(notices).toEqual(['Drashti is busy with new connections. Paired devices keep their places.']);
  expect(t.service.status().state).toBe('listening');
});

it('identifies public poster links separately from individually paired announcement devices', () => {
  const t = setup();
  t.service.setOn(true);
  t.fromWorker({ type: 'started', result: { ok: true, port: 8740 } });
  const personal = t.service.pairForCheck('announcements', 'Placeholder paired announcer');
  t.service.makePoster();
  const last = t.sent.filter((message) => message.type === 'devices').at(-1);
  expect(last?.devices.some((device) => device.poster === true)).toBe(true);
  expect(last?.devices.find((device) => device.id === personal.id)?.poster === true).toBe(false);
});
