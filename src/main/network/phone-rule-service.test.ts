import { describe, expect, it } from 'vitest';
import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import { ENGINE_STATE_VERSION, type EngineState, initialEngineState } from '../../shared/engine/state';
import type { PresentationDoc } from '../../shared/library';
import type { DeviceOp, DeviceRequest } from '../../shared/network-api';
import { PHONE_REFUSAL } from '../../shared/phone-rule';
import type { PlaylistItemInfo } from '../../shared/playlists';
import { openDatabase } from '../db/database';
import { DeviceRepo } from '../db/devices';
import type { SimplePhoneScope } from '../simple-mode-phones';
import type { NetworkWorker } from './network-worker';
import { NetworkService } from './network-service';
import { hashToken } from './tokens';

/*
 * The phone rule as the main process applies it (alpha.23, QA23-PHONE-1, the owner's words: "no video access in either
 * of simple or pro mode in phone, they cant change videos, only ppts an pdfs, that also in pro mode, in simple mode
 * only show the flow, whats running in live, and chat", then "Only PPT and PDF"): one refusal for each group, in both
 * modes, nothing reaching the engine; Simple Mode reading only; Pro Mode putting up a PowerPoint or a PDF from its
 * playlist row and stepping inside it; Stage and Announcements devices, the poster and OSC as before. Made-up tokens,
 * placeholder names and ids only.
 */

const PHONE = '192.168.1.30';

/** Simple Mode's words for what its window does not do (as Main gives them: shared/mode.ts). */
const SIMPLE_TABLE_WORDS = 'Simple Mode on Drashti’s computer: placeholder words.';

const slide = (id: string): PresentationDoc['groups'][number]['slides'][number] => ({
  id,
  index: 0,
  label: '',
  notes: '',
  slide: { id, width: 1920, height: 1080, background: '#000000', elements: [] },
  cues: [],
  transition: null,
  autoAdvanceMs: null,
  macroId: null,
});

const doc = (id: string, more: Partial<PresentationDoc>): PresentationDoc => ({
  id,
  name: `Placeholder ${id}`,
  width: 1920,
  height: 1080,
  groups: [{ id: `${id}-group`, name: '', color: null, slides: [slide(`${id}-1`), slide(`${id}-2`)] }],
  arrangements: [],
  selectedArrangementId: null,
  transition: null,
  loop: false,
  kirtan: null,
  source: null,
  ...more,
});

/** A PDF's pages (a deck), a kirtan, and a presentation of words. */
const DOCS: Record<string, PresentationDoc> = {
  deck: doc('deck', { source: { kind: 'pictures', path: null, ref: null, importedAt: null } }),
  kirtan: doc('kirtan', {
    source: { kind: 'pp6', path: null, ref: null, importedAt: null },
    kirtan: { category: 'Kirtan', kavi: null, raag: null, occasions: [], audioMediaId: null, tracks: [] },
  }),
  words: doc('words', { source: { kind: 'text', path: null, ref: null, importedAt: null } }),
};

const row = (id: string, presentationId: string): PlaylistItemInfo => ({
  id,
  kind: 'presentation',
  label: `Placeholder ${presentationId}`,
  presentationId,
  presentationName: `Placeholder ${presentationId}`,
  order: { mode: 'presentation' },
  arrangementName: null,
  timers: [],
  ...(presentationId === 'deck' ? { deck: true } : {}),
});

/** The sabha's playlist: the deck, a kirtan, words and a video; a deck nowhere in a playlist is 'loose'. */
const ITEMS: PlaylistItemInfo[] = [
  row('i-deck', 'deck'),
  row('i-kirtan', 'kirtan'),
  row('i-words', 'words'),
  {
    id: 'i-video',
    kind: 'media',
    label: 'Placeholder video',
    mediaId: 'm-video',
    media: 'video',
    missing: false,
    unplayable: null,
    timers: [],
  },
];

const ONE: SimplePhoneScope = {
  playlistId: 'sabha',
  kindOf: (id) => (id === 'sabha' ? 'playlist' : null),
  activePlaylist: (id) => id === 'sabha',
  activeItem: (id, itemId) => id === 'sabha' && ITEMS.some((i) => i.id === itemId),
  listsMedia: (mediaId) => mediaId === 'm-video',
  listsPresentation: (id) => ['deck', 'kirtan', 'words'].includes(id),
  playlistOf: (itemId) => (ITEMS.some((i) => i.id === itemId) ? 'sabha' : null),
  holdsMedia: (mediaId) => mediaId === 'm-video',
  holdsPresentation: (id) => ['deck', 'kirtan', 'words'].includes(id),
  plays: (id, from) =>
    from
      ? from.playlistId === 'sabha' &&
        ITEMS.some((i) => i.id === from.itemId && i.kind === 'presentation' && i.presentationId === id)
      : ['deck', 'kirtan', 'words'].includes(id),
  refusal: () => SIMPLE_TABLE_WORDS,
};

function setup(mode: 'pro' | 'simple') {
  const db = openDatabase(':memory:');
  const devices = new DeviceRepo(db);
  const worker: NetworkWorker = {
    send: () => undefined,
    onMessage: () => undefined,
    onExit: () => undefined,
    kill: () => undefined,
  };
  const commands: EngineCommand[] = [];
  const announced: string[] = [];
  let state: EngineState = initialEngineState();
  const service = new NetworkService({
    devices,
    settings: { get: () => undefined, set: () => undefined },
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
        commands.push(c);
        return { ok: true, changed: true, rev: commands.length };
      },
      snapshot: () => ({ kind: 'snapshot', version: ENGINE_STATE_VERSION, rev: 0, state, sentAt: 0 }),
      state: () => state,
    },
    reads: {
      playlists: () => [],
      items: (id) => (id === 'sabha' ? ITEMS : []),
      presentation: (id) => DOCS[id] ?? null,
      library: () => ({ total: 0, presentations: [] }),
      search: (query) => ({ query, hits: [], more: false, legacyCount: 0 }),
      messages: () => [{ id: 'm1', name: 'Car', template: 'Car {plate} please move', fields: {} }],
      mediaSource: () => null,
      sharedSound: () => null,
      stage: () => ({ groupId: 'stage-group', languages: null }),
      hallGroups: () => [],
      hall: () => ({ groupId: 'hall-group' }),
      switches: () => ({ audience: true, stage: true }),
      clockStyle: () => ({ locale: 'en-GB', timeZone: 'Europe/London' }),
      shastraTexts: () => [{ name: 'Placeholder Granth', abbreviation: 'PG', itemCount: 2 }],
      passage: () => ({
        ok: true,
        passage: {
          passageId: 'shastra:pg#1',
          key: { text: 'pg', sections: [], from: 1, to: 1 },
          reference: 'Placeholder Granth 1',
        },
      }),
    },
    mirror: {
      media: () => [],
      lowerThirds: () => [],
      music: () => [],
      keys: () => ({ platform: 'darwin', singleKeys: true }),
      repeatStep: () => 0,
    },
    playMusic: () => ({ ok: true as const }),
    announcements: {
      submit: (device) => {
        announced.push(device.id);
        return { status: 202, body: { ok: true } };
      },
      statusFor: () => ({ status: 404, body: { ok: false } }),
    },
    refused: () => false,
    simple: () => (mode === 'simple' ? ONE : null),
    phoneLists: {
      activePlaylist: (id: string) => id === 'sabha',
      plays: (id: string, from?: { playlistId: string; itemId: string }) => ONE.plays(id, from),
    },
    changed: () => undefined,
    log: () => undefined,
    now: () => 1_000_000,
  });
  const phone = devices.add({ name: 'Placeholder phone', kind: 'remote', tokenHash: hashToken('p-remote') });
  const stage = devices.add({ name: 'Placeholder tablet', kind: 'stage', tokenHash: hashToken('p-stage') });
  const poster = devices.add({
    name: 'Announcements poster',
    kind: 'announcements',
    tokenHash: hashToken('p-poster'),
    poster: true,
  });
  const sender = devices.add({
    name: 'Placeholder sender',
    kind: 'announcements',
    tokenHash: hashToken('p-sender'),
  });
  const ask = (op: DeviceOp, args: Record<string, unknown> = {}, deviceId = phone.id) =>
    service.answer({ deviceId, op, args, address: PHONE } satisfies DeviceRequest);
  return {
    service,
    commands,
    announced,
    phone,
    stage,
    poster,
    sender,
    ask,
    /** What is live, as the engine would have it. */
    live: (presentationId: string | null, slideIndex = 0) => {
      state = {
        ...state,
        live: {
          ...state.live,
          presentationId,
          slideIndex: presentationId === null ? null : slideIndex,
          playlist: presentationId === 'deck' ? { playlistId: 'sabha', itemId: 'i-deck' } : null,
        },
      };
    },
  };
}

type Words = keyof typeof PHONE_REFUSAL;
type Asked = [op: DeviceOp, args?: Record<string, unknown>];

/**
 * Each request is refused (403, the group's words; a command in Simple Mode Simple Mode's, as 'command' is Pro Mode's
 * request), in both modes, and nothing reaches the engine.
 */
function refusesInBoth(asked: readonly Asked[], words: Words) {
  for (const mode of ['pro', 'simple'] as const) {
    const t = setup(mode);
    t.live('deck');
    for (const [op, args] of asked) {
      const said = op === 'command' && mode === 'simple' ? PHONE_REFUSAL.simple : PHONE_REFUSAL[words];
      expect(t.ask(op, args), `${mode} ${op} ${JSON.stringify(args ?? {})}`).toEqual({
        status: 403,
        body: { ok: false, message: said },
      });
    }
    expect(t.commands, mode).toEqual([]);
  }
}

describe('the phone rule in the main process (QA23-PHONE-1)', () => {
  it('refuses videos and the time bar, in both modes', () => {
    refusesInBoth(
      [
        ['media.original', { mediaId: 'm-video' }],
        ['media.show', { mediaId: 'm-video' }],
        ['command', { type: 'cueVideo', mediaId: 'm-video' }],
        ['command', { type: 'goVideoCue', cueId: 'placeholder-cue' }],
        ['command', { type: 'moveTo', playing: { layer: 'background', mediaId: 'm-video' }, toMs: 1000 }],
        ['command', { type: 'jumpToMarker', layer: 'background', markerId: 'placeholder-marker' }],
        ['command', { type: 'skip', layer: 'background', jump: 'forward' }],
        // The owner's Q8: Look closer is the phone's own view, never a zoom on the screens.
        ['command', { type: 'zoomLive', zoom: 2, x: 0, y: 0 }],
        ['command', { type: 'resetLiveZoom' }],
      ],
      'media',
    );
  });

  it('refuses pictures: putting one up, its look, its name and a deck click’s picture, in both modes', () => {
    refusesInBoth(
      [
        ['media', {}],
        ['media.show', { mediaId: 'm-picture' }],
        ['media.look', { mediaId: 'm-picture' }],
        ['media.setLook', { mediaId: 'm-picture' }],
        ['media.rename', { mediaId: 'm-picture', name: 'Placeholder' }],
      ],
      'media',
    );
    // Save picture of a deck's click: never; the presentation as JSON stays Pro Mode's (below).
    const t = setup('pro');
    expect(
      t.ask('presentation', { presentationId: 'deck', format: 'png', slideId: 'deck-1', click: '0' }),
    ).toEqual({ status: 403, body: { ok: false, message: PHONE_REFUSAL.media } });
  });

  it('refuses sounds and music, in both modes', () => {
    refusesInBoth(
      [
        ['music', {}],
        ['music.play', { playlistId: 'placeholder-music' }],
        ['music.audio', {}],
        ['music.addTracks', { playlistId: 'placeholder-music', mediaIds: ['m-sound'] }],
        ['command', { type: 'pauseMusic' }],
        ['command', { type: 'musicNext' }],
        ['command', { type: 'resumeMusic' }],
      ],
      'media',
    );
  });

  it('refuses the wallpapers, in both modes; black-out with the other covers', () => {
    refusesInBoth(
      [
        ['wallpapers', {}],
        ['wallpaper.choose', { id: 'placeholder-wallpaper' }],
        ['command', { type: 'toggleWallpaper' }],
        ['command', { type: 'setWallpaper', on: true }],
      ],
      'media',
    );
    refusesInBoth([['command', { type: 'toggleBlackout' }]], 'computer');
  });

  it('refuses files from phones and the playlists shared with them, in both modes', () => {
    refusesInBoth(
      [
        ['shared', {}],
        ['shared.items', { playlistId: 'sabha' }],
        ['uploads', {}],
        ['upload', { name: 'placeholder.jpg', bytes: 10 }],
        ['upload.status', { id: 'placeholder-upload' }],
      ],
      'files',
    );
  });

  it('refuses the timers, in both modes', () => {
    refusesInBoth(
      [
        ['timers', {}],
        ['command', { type: 'startTimer', timerId: 'placeholder-timer' }],
        ['command', { type: 'showAudienceTimer', timerId: 'placeholder-timer' }],
      ],
      'computer',
    );
  });

  it('refuses messages, lower thirds and the stage, in both modes', () => {
    refusesInBoth(
      [
        ['messages', {}],
        ['message.show', { templateId: 'm1', values: { plate: 'AB 123' } }],
        ['message.hide', { templateId: 'm1' }],
        ['lowerThirds', {}],
        ['lowerThird.show', { id: 'placeholder-lower-third' }],
        ['stage.layouts', {}],
        ['stage.layout', { id: 'placeholder-layout' }],
        ['command', { type: 'setStageMessage', text: 'Placeholder words' }],
        ['command', { type: 'clearStageMessage' }],
      ],
      'computer',
    );
  });

  it('refuses the announcements’ queue, in both modes', () => {
    refusesInBoth(
      [
        ['queue', {}],
        ['queue.approve', { id: 'placeholder-announcement' }],
        ['queue.takeOff', { id: 'placeholder-announcement' }],
      ],
      'computer',
    );
  });

  it('refuses the screens, inputs, windows, picture in picture and MIDI, in both modes', async () => {
    refusesInBoth(
      [
        ['screens', {}],
        ['screens.change', { screenId: 'placeholder-screen' }],
        ['switch', { which: 'audience', on: true }],
        ['inputs', {}],
        ['input.add', { name: 'Placeholder input', device: 'placeholder', fit: 'fit' }],
        ['window.show', { id: 'placeholder-window' }],
        ['midi', {}],
        ['midi.learn', {}],
        ['command', { type: 'showPip', source: { kind: 'slides' } }],
        ['command', { type: 'hidePip' }],
        ['command', { type: 'showInput', inputId: 'placeholder-input' }],
      ],
      'computer',
    );
    for (const mode of ['pro', 'simple'] as const) {
      const t = setup(mode);
      expect(
        await t.service.windows({ deviceId: t.phone.id, op: 'windows', args: {}, address: PHONE }),
      ).toEqual({ status: 403, body: { ok: false, message: PHONE_REFUSAL.computer } });
    }
  });

  it('refuses every change to the library and the playlists, in both modes', () => {
    refusesInBoth(
      [
        ['library.new', { name: 'Placeholder', words: 'Placeholder words' }],
        ['library.remove', { ids: ['words'] }],
        ['playlist.new', { name: 'Placeholder' }],
        ['playlist.rename', { id: 'sabha', name: 'Placeholder' }],
        ['playlist.add', { playlistId: 'sabha', items: [] }],
        ['playlist.removeItems', { playlistId: 'sabha', itemIds: ['i-words'] }],
        ['presentation.rename', { presentationId: 'words', name: 'Placeholder' }],
        // A video row's When it ends is the playlist's (the plan's map: library and playlist changes).
        ['playlist.whenEnds', { playlistId: 'sabha', itemId: 'i-video', whenEnds: 'next' }],
        ['quickBar.set', { pins: [] }],
      ],
      'computer',
    );
  });

  it('refuses slides that are not a PowerPoint’s or a PDF’s, in both modes, and the library sheet', () => {
    refusesInBoth(
      [
        ['shastra', { reference: 'PG 1' }],
        ['shastra.texts', {}],
        ['repeat.start', { playlistId: 'placeholder-repeat' }],
        ['presentations', {}],
        ['search', { query: 'Placeholder' }],
        ['command', { type: 'goLive', presentationId: 'kirtan', slideIndex: 0 }],
        [
          'command',
          {
            type: 'goLive',
            presentationId: 'words',
            slideIndex: 0,
            playlist: { playlistId: 'sabha', itemId: 'i-words' },
          },
        ],
        ['command', { type: 'playItem', playlistId: 'sabha', itemId: 'i-kirtan' }],
        ['command', { type: 'playItem', playlistId: 'sabha', itemId: 'i-video' }],
        ['command', { type: 'startRepeat', playlistId: 'placeholder-repeat' }],
        ['command', { type: 'nextItem' }],
        ['command', { type: 'previousItem' }],
      ],
      'notDeck',
    );
    // A passage's id, Repeat Slides' id, a deck in no playlist or played from another row: never from a phone.
    const t = setup('pro');
    for (const command of [
      { type: 'goLive', presentationId: 'shastra:pg#1', slideIndex: 0 },
      { type: 'goLive', presentationId: 'repeat:placeholder-repeat', slideIndex: 0 },
      {
        type: 'goLive',
        presentationId: 'deck',
        slideIndex: 0,
        playlist: { playlistId: 'sabha', itemId: 'i-kirtan' },
      },
      {
        type: 'goLive',
        presentationId: 'deck',
        slideIndex: 0,
        playlist: { playlistId: 'other', itemId: 'i-deck' },
      },
      { type: 'playItem', playlistId: 'other', itemId: 'i-deck' },
      { type: 'playItem', playlistId: 'sabha', itemId: 'i-gone' },
    ])
      expect(t.ask('command', command), JSON.stringify(command)).toEqual({
        status: 403,
        body: { ok: false, message: PHONE_REFUSAL.notDeck },
      });
    expect(t.commands).toEqual([]);
  });

  it('refuses Next, Previous, Back and Clear slide with no PowerPoint or PDF live, in both modes', () => {
    for (const mode of ['pro', 'simple'] as const)
      for (const live of [null, 'kirtan', 'words', 'shastra:pg#1']) {
        const t = setup(mode);
        t.live(live);
        for (const command of [
          { type: 'next' },
          { type: 'previous' },
          { type: 'back' },
          { type: 'clearLayer', layer: 'slide' },
        ])
          expect(t.ask('command', command), `${mode} ${String(live)} ${command.type}`).toEqual({
            status: 403,
            body: { ok: false, message: mode === 'pro' ? PHONE_REFUSAL.noDeck : PHONE_REFUSAL.simple },
          });
        expect(t.commands).toEqual([]);
      }
  });

  it('clears the slide only, while a PowerPoint or a PDF is live, never another layer (the owner’s Q7)', () => {
    refusesInBoth(
      [
        ['command', { type: 'clearLayer', layer: 'background' }],
        ['command', { type: 'clearLayer', layer: 'audio' }],
        ['command', { type: 'clearLayer', layer: 'messages' }],
        ['command', { type: 'clearAll' }],
        ['command', { type: 'putBack' }],
      ],
      'computer',
    );
    const t = setup('pro');
    t.live('deck');
    expect(t.ask('command', { type: 'clearLayer', layer: 'slide' }).status).toBe(200);
    expect(t.commands).toEqual([{ type: 'clearLayer', layer: 'slide' }]);
  });

  it('lets Simple Mode read only what is live: the status and the hall; the playlists and every command are Pro Mode’s', () => {
    const t = setup('simple');
    t.live('deck');
    expect(t.ask('status').status).toBe(200);
    expect(t.ask('hall')).toMatchObject({ status: 200, body: { ok: true, groupId: 'hall-group' } });
    // Answered by the network's own process: never refused here.
    for (const op of ['me', 'state', 'preview', 'media.picture'] as const)
      expect(t.ask(op, { mediaId: 'm-picture' }).status, op).toBe(400);
    for (const [op, args] of [
      ['playlists', {}],
      ['items', { playlistId: 'sabha' }],
      ['presentation', { presentationId: 'deck' }],
      ['command', { type: 'next' }],
      ['command', { type: 'playItem', playlistId: 'sabha', itemId: 'i-deck' }],
    ] as const)
      expect(t.ask(op, args), op).toEqual({
        status: 403,
        body: { ok: false, message: PHONE_REFUSAL.simple },
      });
    expect(t.commands).toEqual([]);
  });

  it('lets Pro Mode put up a PowerPoint or a PDF from its playlist row and step inside it', () => {
    const t = setup('pro');
    expect(t.ask('playlists').status).toBe(200);
    expect(t.ask('presentation', { presentationId: 'deck' })).toMatchObject({
      status: 200,
      body: { presentation: { id: 'deck' } },
    });
    expect(t.ask('command', { type: 'playItem', playlistId: 'sabha', itemId: 'i-deck' })).toMatchObject({
      status: 200,
    });
    expect(
      t.ask('command', {
        type: 'goLive',
        presentationId: 'deck',
        slideIndex: 1,
        playlist: { playlistId: 'sabha', itemId: 'i-deck' },
      }).status,
    ).toBe(200);
    t.live('deck', 1);
    // Next, Previous and Back stay inside it: the main process says which presentation (whatever a phone sends).
    for (const type of ['next', 'previous', 'back'])
      expect(t.ask('command', { type, within: 'kirtan' }).status, type).toBe(200);
    expect(t.commands).toEqual([
      { type: 'playItem', playlistId: 'sabha', itemId: 'i-deck' },
      {
        type: 'goLive',
        presentationId: 'deck',
        slideIndex: 1,
        playlist: { playlistId: 'sabha', itemId: 'i-deck' },
      },
      { type: 'next', within: 'deck' },
      { type: 'previous', within: 'deck' },
      { type: 'back', within: 'deck' },
    ]);
  });

  it('marks the playlist rows a phone may put up: a PowerPoint’s or a PDF’s only', () => {
    const t = setup('pro');
    const listed = t.ask('items', { playlistId: 'sabha' });
    expect(listed.status).toBe(200);
    const items = (listed.body as { items: (PlaylistItemInfo & { phonePlays?: boolean })[] }).items;
    expect(items.map((i) => [i.id, i.kind === 'presentation' ? i.phonePlays : undefined])).toEqual([
      ['i-deck', true],
      ['i-kirtan', false],
      ['i-words', false],
      ['i-video', undefined],
    ]);
  });

  it('leaves Stage and Announcements devices, the poster and OSC as they were', () => {
    for (const mode of ['pro', 'simple'] as const) {
      const t = setup(mode);
      expect(t.ask('status', {}, t.stage.id).status, mode).toBe(200);
      expect(t.ask('stage', {}, t.stage.id).status, mode).toBe(200);
      expect(t.ask('announce', { text: 'Placeholder' }, t.sender.id).status, mode).toBe(202);
      expect(t.ask('announce', { text: 'Placeholder' }, t.poster.id).status, mode).toBe(202);
      expect(t.announced).toEqual([t.sender.id, t.poster.id]);
    }
    // OSC and the paired controller run the show as before: a Next without `within`, never weighed as a phone.
    const t = setup('pro');
    t.live('kirtan');
    expect(t.service.runShowAction({ op: 'command', args: { type: 'next' } }).status).toBe(200);
    expect(t.service.runShowAction({ op: 'command', args: { type: 'toggleBlackout' } }).status).toBe(200);
    expect(t.commands).toEqual([{ type: 'next' }, { type: 'toggleBlackout' }]);
  });
});
