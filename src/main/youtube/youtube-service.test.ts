import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  googleStandIn,
  STANDIN_CHANNEL,
  STANDIN_CLIENT_ID,
  STANDIN_CLIENT_SECRET,
  type GoogleStandIn,
} from '../../../tests/youtube-standin';
import { YOUTUBE_KEY_STILL_GOES, YOUTUBE_WORDS, type YouTubeStatus } from '../../shared/youtube';
import { openDatabase, type Db } from '../db/database';
import { SettingsRepo } from '../db/settings';
import { StreamProfileRepo } from '../db/stream-profiles';
import { type SecureStorage, StreamKeyStore } from '../stream/key-store';
import { StreamService, type StreamServiceDeps } from '../stream/stream-service';
import {
  GOOGLE_ENDPOINTS,
  nodeGoogleTransport,
  standInEndpoints,
  type GoogleTransport,
} from './google-transport';
import { STATE_FIRST_MS, STATE_LIVE_MS, STATE_UNTIL_LIVE_MS, YouTubeService } from './youtube-service';

vi.mock('electron', () => ({
  dialog: {},
  MessageChannelMain: class {
    port1 = Object.assign(new EventEmitter(), { close: vi.fn(), start: vi.fn() });
    port2 = {};
  },
}));

/*
 * Scheduling a YouTube stream from Drashti (x31), as the main process keeps it, against the tests' stand-in for Google
 * on 127.0.0.1 and the stream service itself (its profiles and key store in a library in memory). Made-up clients,
 * tokens and keys only.
 */

const LISTENER = 'rtmp://127.0.0.1:1935/live2';

/** A stand-in for safeStorage: reversible, and never the plain text on disk. */
const fakeStorage = (available = true): SecureStorage => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from([...Buffer.from(s, 'utf8')].map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString('utf8'),
});

let dir: string;
let db: Db;
let standIn: GoogleStandIn;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-youtube-'));
  db = openDatabase(':memory:');
  standIn = await googleStandIn({ ingestion: LISTENER });
});
afterEach(async () => {
  await standIn.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Made {
  youtube: YouTubeService;
  stream: StreamService;
  keys: StreamKeyStore;
  logs: string[];
  statuses: YouTubeStatus[];
  opened: string[];
  /** Pretend the stream is on air or recording. */
  onAir(on: boolean): void;
  /** Run the timer set last (YouTube's state while on air), with how long it was set for. */
  timers: { run: () => void; ms: number }[];
}

function make(
  options: {
    storage?: SecureStorage;
    transport?: GoogleTransport;
    real?: boolean;
    /** The person never finishes in the browser. */
    away?: boolean;
  } = {},
): Made {
  const keys = new StreamKeyStore(join(dir, 'stream-keys.json'), fakeStorage());
  const settings = new SettingsRepo(db);
  const stream = new StreamService({
    profiles: new StreamProfileRepo(db, (id) => keys.has(id)),
    keys,
    settings,
    screens: { streamGroup: () => null, ensureStreamGroup: vi.fn() },
    sendToOperator: vi.fn(),
    platform: 'darwin',
    mediaAccess: () => 'granted',
    askMediaAccess: () => Promise.resolve(true),
    fakeDevices: true,
    ffmpegPath: () => null,
    now: Date.now,
    log: vi.fn(),
  } as unknown as StreamServiceDeps);
  let on = false;
  const logs: string[] = [];
  const statuses: YouTubeStatus[] = [];
  const opened: string[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  const youtube = new YouTubeService({
    secrets: new StreamKeyStore(
      join(dir, 'youtube-sign-in.json'),
      options.storage ?? fakeStorage(),
      false,
      YOUTUBE_WORDS.noStorage,
    ),
    settings,
    stream: {
      profilesView: () => stream.profilesView(),
      inUse: () => on,
      saveProfile: (id, input) => stream.saveProfile(id, input),
      setKey: (id, key) => stream.setKey(id, key),
    },
    call: {
      transport: options.transport ?? nodeGoogleTransport,
      onlyThisComputer: true,
      warn: (m) => logs.push(m),
    },
    endpoints: options.real ? GOOGLE_ENDPOINTS : standInEndpoints(standIn.base),
    // The person, in the computer's own browser.
    openBrowser: (url) => {
      opened.push(url);
      if (!options.away) void standIn.browse(url);
      return Promise.resolve();
    },
    changed: (s) => statuses.push(s),
    log: (level, message) => logs.push(`${level}: ${message}`),
    now: Date.now,
    setTimer: (run, ms) => {
      const timer = { run, ms };
      timers.push(timer);
      return () => {
        const at = timers.indexOf(timer);
        if (at >= 0) timers.splice(at, 1);
      };
    },
  });
  return {
    youtube,
    stream,
    keys,
    logs,
    statuses,
    opened,
    timers,
    onAir: (o) => {
      on = o;
    },
  };
}

async function signedIn(m: Made): Promise<void> {
  expect(m.youtube.setClient(STANDIN_CLIENT_ID, STANDIN_CLIENT_SECRET)).toMatchObject({ ok: true });
  expect(await m.youtube.signIn()).toMatchObject({ ok: true, status: { signingIn: true } });
  await vi.waitFor(() => expect(m.youtube.status().signedIn).toEqual({ channel: STANDIN_CHANNEL }));
}

/** The profile in use. */
function activeOf(m: Made): string {
  const id = m.stream.profilesView().activeId;
  if (id === null) throw new Error('no profile in use');
  return id;
}

const inAnHour = () => Date.now() + 3_600_000;
const schedule = (profileId: string | null, title = 'Placeholder sabha') => ({
  title,
  description: 'Placeholder words.',
  startsAt: inAnHour(),
  privacy: 'unlisted',
  madeForKids: false,
  profileId,
});

/** Every file Drashti's side wrote here, as text, and what the windows and the log were told. */
function everythingSaid(m: Made): string {
  const files = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'latin1'));
  const rows = db.prepare('SELECT key, value FROM app_meta').all() as { key: string; value: string }[];
  return [...files, JSON.stringify(rows), JSON.stringify(m.statuses), ...m.logs].join('\n');
}

function expectNoSecrets(m: Made): void {
  const said = everythingSaid(m);
  for (const s of standIn.secrets()) expect(said.includes(s.value), `${s.label} was found`).toBe(false);
}

describe('signing in', () => {
  it('opens Google’s page in the browser, keeps the lasting sign-in only in the secure storage, and shows the channel', async () => {
    const m = make();
    expect(m.youtube.status()).toMatchObject({ client: false, signedIn: null, signingIn: false });
    expect(await m.youtube.signIn()).toEqual({ ok: false, message: YOUTUBE_WORDS.noClient });
    expect(m.youtube.setClient('not-a-client-id', STANDIN_CLIENT_SECRET)).toMatchObject({ ok: false });
    await signedIn(m);
    expect(m.opened).toHaveLength(1);
    expect(new URL(m.opened[0] ?? '').origin).toBe(standIn.base);
    expect(m.youtube.status()).toMatchObject({ client: true, signingIn: false, message: null });
    expect(m.logs).toContain('info: YouTube: signed in');
    expectNoSecrets(m);
  });

  it('refused in the browser, or cancelled: nothing kept, and it says so', async () => {
    const m = make();
    m.youtube.setClient(STANDIN_CLIENT_ID, STANDIN_CLIENT_SECRET);
    standIn.consent = 'deny';
    await m.youtube.signIn();
    await vi.waitFor(() => expect(m.youtube.status().message).toBe(YOUTUBE_WORDS.denied));
    expect(m.youtube.status()).toMatchObject({ signedIn: null, signingIn: false });
    // A person who never finishes: Cancel.
    const away = make({ away: true });
    away.youtube.setClient(STANDIN_CLIENT_ID, STANDIN_CLIENT_SECRET);
    await away.youtube.signIn();
    expect(away.youtube.status().signingIn).toBe(true);
    // A second Sign in while waiting opens nothing more.
    await away.youtube.signIn();
    expect(away.opened).toHaveLength(1);
    away.youtube.cancelSignIn();
    await vi.waitFor(() => expect(away.youtube.status().signingIn).toBe(false));
    expect(away.youtube.status()).toMatchObject({ signedIn: null, message: null });
  });

  it('without secure storage, keeps no client and no sign-in, and says why', () => {
    const m = make({ storage: fakeStorage(false) });
    expect(m.youtube.setClient(STANDIN_CLIENT_ID, STANDIN_CLIENT_SECRET)).toEqual({
      ok: false,
      message: YOUTUBE_WORDS.noStorage,
    });
    expect(m.youtube.status()).toMatchObject({ client: false, signedIn: null });
  });

  it('a sign-in Google no longer takes is forgotten once, with Sign in to YouTube again: one try, never a loop', async () => {
    const m = make();
    await signedIn(m);
    standIn.refuseRefreshTokens();
    const before = standIn.calls.filter((c) => c === 'POST /token').length;
    const got = await m.youtube.upcoming();
    expect(got).toEqual({ ok: false, message: YOUTUBE_WORDS.signedOut });
    expect(standIn.calls.filter((c) => c === 'POST /token').length - before).toBe(1);
    expect(m.youtube.status()).toMatchObject({ signedIn: null, message: YOUTUBE_WORDS.signedOut });
    // Asked again: no call to Google at all, just the same plain words.
    const calls = standIn.calls.length;
    expect(await m.youtube.upcoming()).toEqual({ ok: false, message: YOUTUBE_WORDS.notSignedIn });
    expect(standIn.calls.length).toBe(calls);
  });

  it('an access token refused is renewed once and the call made once more', async () => {
    const m = make();
    await signedIn(m);
    standIn.expireAccessTokens();
    const got = await m.youtube.upcoming();
    expect(got).toMatchObject({ ok: true, broadcasts: [] });
    expect(standIn.calls.filter((c) => c === 'GET /youtube/v3/liveBroadcasts')).toHaveLength(2);
  });

  it('Sign out forgets the sign-in here only: nothing is sent to Google', async () => {
    const m = make();
    await signedIn(m);
    const calls = standIn.calls.length;
    expect(m.youtube.signOut()).toMatchObject({ ok: true, status: { signedIn: null, client: true } });
    expect(standIn.calls.length).toBe(calls);
    expect(readFileSync(join(dir, 'youtube-sign-in.json'), 'utf8')).not.toContain('refresh-token');
  });

  it('under the tests’ guard, Google’s own page is never opened and nothing is sent to it', async () => {
    const transport = vi.fn<GoogleTransport>();
    const m = make({ transport, real: true });
    m.youtube.setClient(STANDIN_CLIENT_ID, STANDIN_CLIENT_SECRET);
    expect(await m.youtube.signIn()).toEqual({ ok: false, message: YOUTUBE_WORDS.testGuard });
    expect(m.opened).toEqual([]);
    expect(transport).not.toHaveBeenCalled();
    expect(m.logs).toContain('warn: TEST GUARD: opening Google’s sign-in page was refused: not 127.0.0.1');
  });
});

describe('scheduling, and its key in the profile', () => {
  it('makes the broadcast and its own stream, saves the key into the profile in the key store, and links them', async () => {
    const m = make();
    await signedIn(m);
    const profile = activeOf(m);
    const got = await m.youtube.schedule(schedule(profile));
    expect(got).toMatchObject({ ok: true });
    const [broadcast] = [...standIn.broadcasts.values()];
    const [stream] = [...standIn.streams.values()];
    expect(broadcast).toMatchObject({
      title: 'Placeholder sabha',
      privacyStatus: 'unlisted',
      selfDeclaredMadeForKids: false,
      enableAutoStart: true,
      enableAutoStop: false,
      boundStreamId: stream?.id,
      lifeCycleStatus: 'ready',
    });
    expect(stream?.isReusable).toBe(false);
    // The key is in the stream key store, under the profile; its address is the broadcast's.
    expect(m.keys.get(profile)).toBe(stream?.key);
    const view = m.stream.profilesView().profiles.find((p) => p.id === profile);
    expect(view).toMatchObject({ url: LISTENER, hasKey: true });
    expect(m.youtube.status().links[profile]).toEqual({
      broadcastId: broadcast?.id,
      title: 'Placeholder sabha',
      startsAt: Date.parse(broadcast?.scheduledStartTime ?? ''),
      privacy: 'unlisted',
      address: LISTENER,
    });
    expectNoSecrets(m);
  });

  it('refuses a time behind now, before asking Google', async () => {
    const m = make();
    await signedIn(m);
    const calls = standIn.calls.length;
    expect(await m.youtube.schedule({ ...schedule(null), startsAt: Date.now() - 1000 })).toEqual({
      ok: false,
      message: YOUTUBE_WORDS.badTime,
    });
    expect(await m.youtube.schedule({ ...schedule(null), title: '   ' })).toEqual({
      ok: false,
      message: 'Give the broadcast a title.',
    });
    expect(standIn.calls.length).toBe(calls);
  });

  it('Stream to this one: a broadcast made in YouTube Studio gets its own stream; one with a stream gives its key', async () => {
    const m = make();
    await signedIn(m);
    const studio = standIn.addBroadcast({ title: 'Placeholder from Studio' });
    const listed = await m.youtube.upcoming();
    expect(listed).toMatchObject({
      ok: true,
      broadcasts: [{ id: studio.id, title: 'Placeholder from Studio' }],
    });
    const profile = activeOf(m);
    expect(await m.youtube.useBroadcast(profile, studio.id)).toMatchObject({ ok: true });
    expect(studio.boundStreamId).not.toBeNull();
    const key = standIn.streams.get(studio.boundStreamId ?? '')?.key;
    expect(m.keys.get(profile)).toBe(key);
    // Another profile, the same broadcast: its stream's key, no new stream.
    const second = m.stream.saveProfile(null, {
      name: 'Spare',
      url: 'rtmp://127.0.0.1:1935/live2',
      preset: 'weak',
      camera: null,
      sound: null,
      soundDelayMs: 0,
      mixOwnSound: false,
    });
    if (!second.ok) throw new Error(second.message);
    const spare = second.profiles.profiles.find((p) => p.name === 'Spare')?.id ?? '';
    const streams = standIn.streams.size;
    expect(await m.youtube.useBroadcast(spare, studio.id)).toMatchObject({ ok: true });
    expect(standIn.streams.size).toBe(streams);
    expect(m.keys.get(spare)).toBe(key);
  });

  it('while on air, the profile in use keeps its address and key: refused before Google is asked', async () => {
    const m = make();
    await signedIn(m);
    const profile = activeOf(m);
    m.stream.setKey(profile, 'test-made-up-key-0000-hand-typed');
    m.onAir(true);
    const calls = standIn.calls.length;
    expect(await m.youtube.schedule(schedule(profile))).toEqual({ ok: false, message: YOUTUBE_WORDS.inUse });
    const studio = standIn.addBroadcast({ title: 'Placeholder from Studio' });
    expect(await m.youtube.useBroadcast(profile, studio.id)).toEqual({
      ok: false,
      message: YOUTUBE_WORDS.inUse,
    });
    expect(standIn.calls.length).toBe(calls);
    expect(m.keys.get(profile)).toBe('test-made-up-key-0000-hand-typed');
    // Scheduling for later, without the profile in use, still works on air.
    expect(await m.youtube.schedule(schedule(null))).toMatchObject({ ok: true });
    expect(m.keys.get(profile)).toBe('test-made-up-key-0000-hand-typed');
  });

  it('a key typed by hand, or the address changed by hand, ends the link', async () => {
    const m = make();
    await signedIn(m);
    const profile = activeOf(m);
    await m.youtube.schedule(schedule(profile));
    expect(m.youtube.status().links[profile]).toBeDefined();
    m.stream.setKey(profile, 'test-made-up-key-0000-hand-typed');
    m.youtube.keyChangedByHand(profile);
    expect(m.youtube.status().links[profile]).toBeUndefined();
    await m.youtube.schedule(schedule(profile, 'Placeholder second'));
    expect(m.youtube.status().links[profile]?.title).toBe('Placeholder second');
    const p = m.stream.profilesView().profiles.find((x) => x.id === profile);
    if (!p) throw new Error('no profile');
    const { id: _id, hasKey: _hasKey, more: _more, ...input } = p;
    expect(m.stream.saveProfile(profile, { ...input, url: 'rtmp://127.0.0.1:1936/live2' })).toMatchObject({
      ok: true,
    });
    expect(m.youtube.status().links[profile]).toBeUndefined();
  });
});

describe('Google’s failures: a sentence, and the saved key still goes live', () => {
  it('no internet, the day’s quota, live streaming not on', async () => {
    const m = make();
    await signedIn(m);
    const profile = activeOf(m);
    m.stream.setKey(profile, 'test-made-up-key-0000-hand-typed');
    standIn.mode = 'offline';
    expect(await m.youtube.schedule(schedule(profile))).toEqual({
      ok: false,
      message: `${YOUTUBE_WORDS.offline} ${YOUTUBE_KEY_STILL_GOES}`,
    });
    standIn.mode = 'quota';
    const quota = await m.youtube.upcoming();
    expect(quota.ok).toBe(false);
    if (!quota.ok) {
      expect(quota.message).toMatch(
        /^YouTube’s daily allowance for your Google project is used up\. It starts again at /u,
      );
      expect(quota.message.endsWith(YOUTUBE_KEY_STILL_GOES)).toBe(true);
    }
    standIn.mode = 'not-enabled';
    expect(await m.youtube.schedule(schedule(profile))).toEqual({
      ok: false,
      message: YOUTUBE_WORDS.notEnabled,
    });
    // Nothing changed: the profile keeps its own key and address, and stays signed in.
    expect(m.keys.get(profile)).toBe('test-made-up-key-0000-hand-typed');
    expect(m.youtube.status().signedIn).toEqual({ channel: STANDIN_CHANNEL });
  });
});

describe('on air, and the end', () => {
  it('asks YouTube how the broadcast stands while on air, shows it, and stops asking off air', async () => {
    const m = make();
    await signedIn(m);
    const profile = activeOf(m);
    await m.youtube.schedule(schedule(profile));
    const status = (state: 'off' | 'live') =>
      ({ live: { state } }) as Parameters<YouTubeService['streamChanged']>[0];
    m.youtube.streamChanged(status('live'));
    expect(m.timers.map((t) => t.ms)).toEqual([STATE_FIRST_MS]);
    m.timers[0]?.run();
    await vi.waitFor(() => expect(m.timers.map((t) => t.ms)).toEqual([STATE_UNTIL_LIVE_MS]));
    expect(m.youtube.status().linkedState).toBe('upcoming');
    // YouTube hears the stream and starts the broadcast by itself.
    standIn.streamArrived(m.keys.get(profile) ?? '');
    m.timers[0]?.run();
    await vi.waitFor(() => expect(m.youtube.status().linkedState).toBe('live'));
    expect(m.timers.map((t) => t.ms)).toEqual([STATE_LIVE_MS]);
    m.youtube.streamChanged(status('off'));
    expect(m.timers).toEqual([]);
  });

  it('End the stream ends the broadcast on YouTube; offline, it says YouTube may still show it live', async () => {
    const m = make();
    await signedIn(m);
    const profile = activeOf(m);
    await m.youtube.schedule(schedule(profile));
    const broadcast = [...standIn.broadcasts.values()][0];
    standIn.streamArrived(m.keys.get(profile) ?? '');
    standIn.mode = 'offline';
    const failed = await m.youtube.endBroadcast(profile);
    expect(failed).toEqual({
      ok: false,
      message: `YouTube may still show “Placeholder sabha” as live. ${YOUTUBE_WORDS.offline} ${YOUTUBE_KEY_STILL_GOES}`,
    });
    expect(m.youtube.status().linkedState).toBe('live');
    standIn.mode = 'answer';
    m.youtube.streamEnded(profile);
    await vi.waitFor(() => expect(broadcast?.lifeCycleStatus).toBe('complete'));
    await vi.waitFor(() => expect(m.youtube.status()).toMatchObject({ linkedState: 'ended', message: null }));
  });

  it('a broadcast that never went live has nothing to end there', async () => {
    const m = make();
    await signedIn(m);
    const profile = activeOf(m);
    await m.youtube.schedule(schedule(profile));
    expect(await m.youtube.endBroadcast(profile)).toMatchObject({
      ok: true,
      status: { message: 'YouTube had not started “Placeholder sabha”, so there was nothing to end there.' },
    });
  });
});
