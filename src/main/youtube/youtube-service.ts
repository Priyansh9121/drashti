import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { formatClock, type ClockStyle } from '../../shared/format';
import { parsePlain } from '../../shared/plain-parse';
import type { StreamProfiles, StreamProfilesResult, StreamStatus } from '../../shared/stream';
import {
  pacificMidnightAfter,
  quotaWords,
  refusedWords,
  YOUTUBE_KEY_STILL_GOES,
  YOUTUBE_PRIVACIES,
  YOUTUBE_PRIVACY_WORDS,
  YOUTUBE_SCHEDULE_AHEAD_MS,
  YOUTUBE_SCHEDULE_MAX_AHEAD_MS,
  YOUTUBE_WORDS,
  type YouTubeBroadcast,
  type YouTubeBroadcastState,
  type YouTubeLink,
  type YouTubeListResult,
  type YouTubeResult,
  type YouTubeStatus,
} from '../../shared/youtube';
import {
  googleClientIdSchema,
  googleClientSecretSchema,
  youtubeScheduleSchema,
} from '../../shared/youtube-schema';
import type { StreamKeyStore } from '../stream/key-store';
import {
  exchangeCode,
  listenForBrowser,
  makePkce,
  newState,
  refreshAccess,
  signInAddress,
  type BrowserListener,
  type RandomBytes,
  type TokenProblem,
} from './google-sign-in';
import { onThisComputer, type CallOptions, type GoogleEndpoints } from './google-transport';
import { broadcastOf, ingestOf, YouTubeApi, type ApiAnswer, type ApiProblem } from './youtube-api';

/*
 * Scheduling a YouTube stream from Drashti (x31), as the main process keeps it.
 *
 * - The admin's own Google project signs in: its Client ID and Client secret are typed into Drashti, and kept with the
 *   refresh token in the system's secure storage, a file of their own (youtube-sign-in.json) by the stream keys' own
 *   StreamKeyStore: never the library, a backup, the log or diagnostics, and never sent to a window. The access token
 *   lives in memory only. Without secure storage no sign-in is kept.
 * - A broadcast's stream key goes from Google straight into the stream key store under its profile's id, and the
 *   profile's address becomes the broadcast's own (the stream service's own saveProfile and setKey, with their
 *   checks). Its link (the broadcast's id, title, start and privacy; no secret) is kept in the library's settings.
 * - Show safety first: going live never calls Google (the broadcast starts by itself when the stream arrives); the
 *   profile in use keeps its address and key while on air or recording; every call is in the background with a time
 *   limit; a failure is a sentence, and the saved key still goes live. A refused sign-in (invalid_grant: revoked,
 *   unused for 6 months, a Testing project's 7 days) is "Sign in to YouTube again", in any kind of Google project,
 *   once: never a loop, never a stop.
 */

const CLIENT_ID = 'client-id';
const CLIENT_SECRET = 'client-secret';
const REFRESH_TOKEN = 'refresh-token';
const CHANNEL_SETTING = 'youtube.channel';
const LINKS_SETTING = 'youtube.links';

/** An access token is renewed this long before Google says it runs out. */
const RENEW_BEFORE_MS = 60_000;
/** While on air, YouTube's state of the broadcast is asked this often until it is live, then every minute. */
export const STATE_FIRST_MS = 15_000;
export const STATE_UNTIL_LIVE_MS = 20_000;
export const STATE_LIVE_MS = 60_000;

/** The parts of the stream service this uses (stream/stream-service.ts), with that service's own checks. */
export interface YouTubeStreamSide {
  profilesView(): StreamProfiles;
  inUse(): boolean;
  saveProfile(id: unknown, input: unknown): StreamProfilesResult;
  setKey(id: unknown, key: unknown): StreamProfilesResult;
}

export interface YouTubeServiceDeps {
  /** The sign-in's secrets: a key store of their own, kept as the stream keys are. */
  secrets: StreamKeyStore;
  settings: { get(name: string): unknown; set(name: string, value: unknown): void };
  stream: YouTubeStreamSide;
  call: CallOptions;
  endpoints: GoogleEndpoints;
  /** The computer's own browser (shell.openExternal): the person signs in there. */
  openBrowser(url: string): Promise<void>;
  /** The listener for the browser's way back (unit tests give their own). */
  listen?(state: string): Promise<BrowserListener>;
  changed(status: YouTubeStatus): void;
  log(level: 'info' | 'warn', message: string): void;
  now(): number;
  clockStyle?(): ClockStyle;
  random?: RandomBytes;
  /** Timers (unit tests give their own clock). */
  setTimer?: (run: () => void, ms: number) => () => void;
}

const linkSchema = z.object({
  broadcastId: z.string().min(1).max(200),
  title: z.string().max(1000),
  startsAt: z.number(),
  privacy: z.enum(YOUTUBE_PRIVACIES),
  address: z.string().max(2000),
});
const linksSchema = z.record(z.string().max(100), linkSchema);

type Got<T> = { ok: true; value: T } | { ok: false; message: string; problem?: ApiProblem };

const defaultTimer = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  timer.unref();
  return () => {
    clearTimeout(timer);
  };
};

export class YouTubeService {
  private readonly api: YouTubeApi;
  private access: { token: string; expiresAt: number } | null = null;
  private renewing: Promise<Got<string>> | null = null;
  private signing: BrowserListener | null = null;
  private message: string | null = null;
  /** What YouTube last said of the in-use profile's broadcast while on air (or just after), by its id. */
  private known: { broadcastId: string; state: YouTubeBroadcastState } | null = null;
  private watching: { broadcastId: string; stop: () => void } | null = null;
  private onAir = false;

  constructor(private readonly deps: YouTubeServiceDeps) {
    this.api = new YouTubeApi(deps.endpoints, deps.call);
  }

  // ---- what a window is told -------------------------------------------------------------

  status(): YouTubeStatus {
    const { secrets } = this.deps;
    const channel = this.deps.settings.get(CHANNEL_SETTING);
    const active = this.deps.stream.profilesView().activeId;
    const links = this.links();
    const link = active === null ? undefined : links[active];
    return {
      client: secrets.has(CLIENT_ID) && secrets.has(CLIENT_SECRET),
      signedIn: secrets.has(REFRESH_TOKEN)
        ? { channel: typeof channel === 'string' && channel !== '' ? channel : 'YouTube' }
        : null,
      signingIn: this.signing !== null,
      storage: secrets.known(),
      message: this.message,
      links,
      linkedState: link && this.known?.broadcastId === link.broadcastId ? this.known.state : null,
    };
  }

  private changed(): void {
    this.deps.changed(this.status());
  }

  private say(message: string | null): void {
    this.message = message;
    this.changed();
  }

  /** Each profile's broadcast, while the profile still streams to it (its address, and a key saved). */
  links(): Record<string, YouTubeLink> {
    const parsed = linksSchema.safeParse(this.deps.settings.get(LINKS_SETTING) ?? {});
    if (!parsed.success) return {};
    const out: Record<string, YouTubeLink> = {};
    const profiles = this.deps.stream.profilesView().profiles;
    for (const [profileId, link] of Object.entries(parsed.data)) {
      const profile = profiles.find((p) => p.id === profileId);
      if (profile?.hasKey && profile.url === link.address) out[profileId] = link;
    }
    return out;
  }

  private setLink(profileId: string, link: YouTubeLink | null): void {
    const { [profileId]: _was, ...others } = this.links();
    this.deps.settings.set(LINKS_SETTING, link ? { ...others, [profileId]: link } : others);
  }

  /** A key typed or removed by hand: the profile no longer streams to its broadcast as far as Drashti knows. */
  keyChangedByHand(profileId: string): void {
    if (!(profileId in this.links())) return;
    this.setLink(profileId, null);
    this.changed();
  }

  // ---- the sign-in client ------------------------------------------------------------------

  setClient(rawId: unknown, rawSecret: unknown): YouTubeResult {
    const id = parsePlain(googleClientIdSchema, rawId, 'Type the Client ID from your Google project.');
    if (!id.success) return { ok: false, message: id.message };
    const secret = parsePlain(
      googleClientSecretSchema,
      rawSecret,
      'Type the Client secret from your Google project.',
    );
    if (!secret.success) return { ok: false, message: secret.message };
    // Another client's sign-in does not work with this one: it goes.
    this.forgetSignIn();
    const keptId = this.deps.secrets.set(CLIENT_ID, id.data);
    if (!keptId.ok) return { ok: false, message: YOUTUBE_WORDS.noStorage };
    const keptSecret = this.deps.secrets.set(CLIENT_SECRET, secret.data);
    if (!keptSecret.ok) {
      this.deps.secrets.remove(CLIENT_ID);
      return { ok: false, message: YOUTUBE_WORDS.noStorage };
    }
    this.deps.log('info', 'YouTube: a sign-in client was saved');
    this.message = null;
    this.changed();
    return { ok: true, status: this.status() };
  }

  removeClient(): YouTubeResult {
    this.forgetSignIn();
    this.deps.secrets.remove(CLIENT_ID);
    this.deps.secrets.remove(CLIENT_SECRET);
    this.deps.log('info', 'YouTube: the sign-in client was removed');
    this.message = null;
    this.changed();
    return { ok: true, status: this.status() };
  }

  // ---- signing in and out ------------------------------------------------------------------

  /**
   * Open Google's sign-in page in the computer's own browser; the answer comes back by itself (changed()). Answers at
   * once: signing in, or why not.
   */
  async signIn(): Promise<YouTubeResult> {
    if (this.signing) return { ok: true, status: this.status() };
    const { secrets } = this.deps;
    if (!secrets.has(CLIENT_ID) || !secrets.has(CLIENT_SECRET))
      return { ok: false, message: YOUTUBE_WORDS.noClient };
    const clientId = secrets.get(CLIENT_ID);
    const clientSecret = secrets.get(CLIENT_SECRET);
    if (!clientId || !clientSecret) return { ok: false, message: this.unreadable() };
    const random = this.deps.random ?? randomBytes;
    const pkce = makePkce(random);
    const state = newState(random);
    let listener: BrowserListener;
    try {
      listener = await (this.deps.listen ?? listenForBrowser)(state);
    } catch {
      return { ok: false, message: 'Drashti could not wait for the browser on this computer. Try again.' };
    }
    const address = signInAddress(this.deps.endpoints, {
      clientId,
      redirectUri: listener.redirectUri,
      challenge: pkce.challenge,
      state,
    });
    if (this.deps.call.onlyThisComputer && !onThisComputer(address)) {
      listener.cancel();
      this.deps.log('warn', 'TEST GUARD: opening Google’s sign-in page was refused: not 127.0.0.1');
      return { ok: false, message: YOUTUBE_WORDS.testGuard };
    }
    this.signing = listener;
    this.message = null;
    this.changed();
    void listener.answer.then((answer) =>
      this.answered(listener, answer, { clientId, clientSecret, verifier: pkce.verifier }),
    );
    try {
      await this.deps.openBrowser(address);
    } catch {
      listener.cancel();
      return {
        ok: false,
        message: 'Drashti could not open this computer’s browser for Google’s sign-in page.',
      };
    }
    this.deps.log('info', 'YouTube: Google’s sign-in page was opened in the browser');
    return { ok: true, status: this.status() };
  }

  cancelSignIn(): YouTubeResult {
    this.signing?.cancel();
    return { ok: true, status: this.status() };
  }

  private async answered(
    listener: BrowserListener,
    answer: Awaited<BrowserListener['answer']>,
    client: { clientId: string; clientSecret: string; verifier: string },
  ): Promise<void> {
    if (this.signing !== listener) return;
    if (!answer.ok) {
      this.signing = null;
      this.deps.log('info', `YouTube: not signed in (${answer.reason})`);
      this.say(
        answer.reason === 'denied'
          ? YOUTUBE_WORDS.denied
          : answer.reason === 'timeout'
            ? YOUTUBE_WORDS.timedOut
            : answer.reason === 'cancelled'
              ? null
              : 'Signing in to YouTube did not finish. Try again.',
      );
      return;
    }
    const tokens = await exchangeCode(
      this.deps.endpoints,
      this.deps.call,
      { code: answer.code, redirectUri: listener.redirectUri, ...client },
      this.deps.now(),
    );
    if (this.signing !== listener) return;
    this.signing = null;
    if (!tokens.ok) {
      this.deps.log('warn', `YouTube: signing in failed (${tokens.problem})`);
      this.say(this.tokenWords(tokens.problem, tokens.detail));
      return;
    }
    if (tokens.refreshToken === null) {
      this.say('Google gave no lasting sign-in. Try signing in again.');
      return;
    }
    const kept = this.deps.secrets.set(REFRESH_TOKEN, tokens.refreshToken);
    if (!kept.ok) {
      this.say(YOUTUBE_WORDS.noStorage);
      return;
    }
    this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
    const channel = await this.api.channel(tokens.accessToken);
    if (!channel.ok && channel.problem === 'no-channel') {
      this.forgetSignIn();
      this.say(
        'This Google account has no YouTube channel. Sign in with the account that manages the mandir’s channel.',
      );
      return;
    }
    this.deps.settings.set(CHANNEL_SETTING, channel.ok ? channel.value : '');
    this.deps.log('info', 'YouTube: signed in');
    this.say(null);
  }

  signOut(): YouTubeResult {
    this.signing?.cancel();
    this.forgetSignIn();
    this.deps.log('info', 'YouTube: signed out');
    this.message = null;
    this.changed();
    return { ok: true, status: this.status() };
  }

  /**
   * Forget this computer's sign-in. Google is not asked to revoke it: "Revocation removes all OAuth 2.0 scopes
   * previously granted to a project", so it would sign out every computer signed in with that Google account too.
   * The token is gone from this computer's secure storage; the account's owner can remove Drashti's access from
   * every computer at once in the Google account (Security › Third-party access).
   */
  private forgetSignIn(): void {
    const { secrets } = this.deps;
    secrets.remove(REFRESH_TOKEN);
    this.access = null;
    this.deps.settings.set(CHANNEL_SETTING, '');
  }

  private unreadable(): string {
    const storage = this.deps.secrets.status();
    return storage.available
      ? 'The YouTube sign-in saved here cannot be read any more (this computer’s secure storage changed). Set it up again.'
      : YOUTUBE_WORDS.noStorage;
  }

  // ---- an access token, renewed when it runs out ---------------------------------------------

  private accessToken(): Promise<Got<string>> {
    const now = this.deps.now();
    if (this.access && this.access.expiresAt - RENEW_BEFORE_MS > now)
      return Promise.resolve({ ok: true, value: this.access.token });
    // One renewal at a time, shared by every call waiting for it.
    this.renewing ??= this.renew().finally(() => {
      this.renewing = null;
    });
    return this.renewing;
  }

  private async renew(): Promise<Got<string>> {
    const { secrets } = this.deps;
    if (!secrets.has(REFRESH_TOKEN)) return { ok: false, message: YOUTUBE_WORDS.notSignedIn };
    const refreshToken = secrets.get(REFRESH_TOKEN);
    const clientId = secrets.get(CLIENT_ID);
    const clientSecret = secrets.get(CLIENT_SECRET);
    if (!refreshToken || !clientId || !clientSecret) return { ok: false, message: this.unreadable() };
    const tokens = await refreshAccess(
      this.deps.endpoints,
      this.deps.call,
      { clientId, clientSecret, refreshToken },
      this.deps.now(),
    );
    if (!tokens.ok) {
      if (
        tokens.problem === 'signed-out' ||
        tokens.problem === 'bad-client' ||
        tokens.problem === 'no-scope'
      ) {
        // Google no longer takes it: forgotten here, once, and the person is asked to sign in again.
        this.forgetSignIn();
        this.deps.log('warn', `YouTube: the sign-in was refused (${tokens.problem}): sign in again`);
      }
      return { ok: false, message: this.tokenWords(tokens.problem, tokens.detail) };
    }
    this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
    return { ok: true, value: tokens.accessToken };
  }

  /** A call with the access token; a refused token is renewed once and the call made once more, never more. */
  private async withToken<T>(call: (token: string) => Promise<ApiAnswer<T>>): Promise<Got<T>> {
    const token = await this.accessToken();
    if (!token.ok) return token;
    let answer = await call(token.value);
    if (!answer.ok && answer.problem === 'unauthorized') {
      this.access = null;
      const again = await this.accessToken();
      if (!again.ok) return again;
      answer = await call(again.value);
      if (!answer.ok && answer.problem === 'unauthorized') {
        this.forgetSignIn();
        this.deps.log('warn', 'YouTube: the sign-in was refused twice: sign in again');
        return { ok: false, message: YOUTUBE_WORDS.signedOut };
      }
    }
    return answer.ok
      ? answer
      : { ok: false, message: this.apiWords(answer.problem, answer.detail), problem: answer.problem };
  }

  // ---- words for each failure ------------------------------------------------------------------

  private tokenWords(problem: TokenProblem, detail: string | null): string {
    switch (problem) {
      case 'offline':
        return `${YOUTUBE_WORDS.offline} ${YOUTUBE_KEY_STILL_GOES}`;
      case 'guard':
        return YOUTUBE_WORDS.testGuard;
      case 'signed-out':
        return YOUTUBE_WORDS.signedOut;
      case 'sign-in-failed':
        return 'Google did not take this sign-in. Try signing in again.';
      case 'bad-client':
        return YOUTUBE_WORDS.badClient;
      case 'no-scope':
        return 'Drashti was not allowed to manage YouTube on Google’s page. Sign in again and allow it.';
      case 'unavailable':
        return `Google did not answer properly just now. Try again in a minute. ${YOUTUBE_KEY_STILL_GOES}`;
      case 'refused':
        return refusedWords(detail);
    }
  }

  private apiWords(problem: ApiProblem, detail: string | null): string {
    const still = ` ${YOUTUBE_KEY_STILL_GOES}`;
    switch (problem) {
      case 'offline':
        return YOUTUBE_WORDS.offline + still;
      case 'guard':
        return YOUTUBE_WORDS.testGuard;
      case 'unauthorized':
        return YOUTUBE_WORDS.signedOut;
      case 'quota': {
        const back = pacificMidnightAfter(this.deps.now());
        return quotaWords(formatClock(back, this.deps.clockStyle?.() ?? null)) + still;
      }
      case 'not-enabled':
        return YOUTUBE_WORDS.notEnabled;
      case 'too-fast':
        return YOUTUBE_WORDS.tooFast + still;
      case 'too-many':
        return YOUTUBE_WORDS.tooMany;
      case 'bad-time':
        return YOUTUBE_WORDS.badTime;
      case 'not-found':
      case 'transition':
        return YOUTUBE_WORDS.noBroadcast;
      case 'no-channel':
        return 'This Google account has no YouTube channel.';
      case 'odd-answer':
        return 'YouTube’s answer was not one Drashti can use, so nothing changed.';
      case 'unavailable':
        return `YouTube did not answer properly just now. Try again in a minute.${still}`;
      case 'refused':
        return refusedWords(detail);
    }
  }

  // ---- the channel's broadcasts --------------------------------------------------------------

  /** The channel's coming broadcasts (scheduled here or in YouTube Studio), soonest first. */
  async upcoming(): Promise<YouTubeListResult> {
    const got = await this.withToken((token) => this.api.upcoming(token));
    if (!got.ok) {
      this.say(got.message);
      return { ok: false, message: got.message };
    }
    const broadcasts: YouTubeBroadcast[] = got.value
      .map(broadcastOf)
      .filter((b) => b.state === 'upcoming')
      .sort((a, b) => a.startsAt - b.startsAt)
      .map(({ boundStreamId: _bound, ...b }) => b);
    this.message = null;
    this.changed();
    return { ok: true, broadcasts, status: this.status() };
  }

  /** Schedule a broadcast (with its own stream and key) and, when asked, stream to it from a profile. */
  async schedule(raw: unknown): Promise<YouTubeResult> {
    const input = parsePlain(
      youtubeScheduleSchema,
      raw,
      'Check the broadcast’s details, then schedule it again.',
    );
    if (!input.success) return { ok: false, message: input.message };
    const now = this.deps.now();
    if (
      input.data.startsAt < now + YOUTUBE_SCHEDULE_AHEAD_MS ||
      input.data.startsAt > now + YOUTUBE_SCHEDULE_MAX_AHEAD_MS
    )
      return { ok: false, message: YOUTUBE_WORDS.badTime };
    const { profileId } = input.data;
    if (profileId !== null) {
      const refused = this.cannotChange(profileId);
      if (refused) return { ok: false, message: refused };
    }
    const made = await this.withToken((token) => this.api.insertBroadcast(token, input.data));
    if (!made.ok) return this.failed(made.message);
    const broadcast = broadcastOf(made.value);
    this.deps.log(
      'info',
      `YouTube: a broadcast was scheduled (${YOUTUBE_PRIVACY_WORDS[broadcast.privacy]}, ${new Date(broadcast.startsAt).toISOString()})`,
    );
    const ingest = await this.newStream(broadcast.id, broadcast.title);
    if (!ingest.ok)
      return this.failed(
        `It was scheduled on YouTube, but its stream key could not be made: ${ingest.message} Choose Stream to this one under Coming up on YouTube to try again.`,
      );
    if (profileId !== null) {
      const used = this.giveProfile(profileId, broadcast, ingest.value);
      if (!used.ok) return this.failed(used.message);
    }
    this.say(null);
    return { ok: true, status: this.status() };
  }

  /** Stream to a coming broadcast from a profile: its key (its stream's, or a new one's) saved there. */
  async useBroadcast(rawProfileId: unknown, rawBroadcastId: unknown): Promise<YouTubeResult> {
    const profileId = z.string().min(1).max(100).safeParse(rawProfileId);
    const broadcastId = z.string().min(1).max(200).safeParse(rawBroadcastId);
    if (!profileId.success) return { ok: false, message: YOUTUBE_WORDS.noProfile };
    if (!broadcastId.success) return { ok: false, message: YOUTUBE_WORDS.noBroadcast };
    const refused = this.cannotChange(profileId.data);
    if (refused) return { ok: false, message: refused };
    const found = await this.withToken((token) => this.api.broadcast(token, broadcastId.data));
    if (!found.ok) return this.failed(found.message);
    const raw = found.value;
    if (!raw) return this.failed(YOUTUBE_WORDS.noBroadcast);
    const broadcast = broadcastOf(raw);
    if (broadcast.state !== 'upcoming') return this.failed(YOUTUBE_WORDS.noBroadcast);
    let ingest: Got<{ key: string; address: string }> | null = null;
    if (broadcast.boundStreamId !== null) {
      const boundId = broadcast.boundStreamId;
      const stream = await this.withToken((token) => this.api.stream(token, boundId));
      if (!stream.ok) return this.failed(stream.message);
      if (stream.value) {
        const its = ingestOf(stream.value, this.deps.call.onlyThisComputer);
        if (!its) return this.failed('YouTube’s answer was not one Drashti can use, so nothing changed.');
        ingest = { ok: true, value: its };
      }
    }
    ingest ??= await this.newStream(broadcast.id, broadcast.title);
    if (!ingest.ok) return this.failed(ingest.message);
    const used = this.giveProfile(profileId.data, broadcast, ingest.value);
    if (!used.ok) return this.failed(used.message);
    this.say(null);
    return { ok: true, status: this.status() };
  }

  /** A new one-use stream bound to the broadcast: its key and address. */
  private async newStream(
    broadcastId: string,
    title: string,
  ): Promise<Got<{ key: string; address: string }>> {
    const stream = await this.withToken((token) => this.api.insertStream(token, title));
    if (!stream.ok) return stream;
    const ingest = ingestOf(stream.value, this.deps.call.onlyThisComputer);
    if (!ingest)
      return { ok: false, message: 'YouTube’s answer was not one Drashti can use, so nothing changed.' };
    const bound = await this.withToken((token) => this.api.bind(token, broadcastId, stream.value.id));
    if (!bound.ok) return bound;
    return { ok: true, value: ingest };
  }

  /** Why this profile cannot be given a broadcast now, or null. */
  private cannotChange(profileId: string): string | null {
    const view = this.deps.stream.profilesView();
    if (!view.profiles.some((p) => p.id === profileId)) return YOUTUBE_WORDS.noProfile;
    if (this.deps.stream.inUse() && view.activeId === profileId) return YOUTUBE_WORDS.inUse;
    return null;
  }

  /** The broadcast's address and key into the profile (the stream service's own checks), and the link kept. */
  private giveProfile(
    profileId: string,
    broadcast: YouTubeBroadcast,
    ingest: { key: string; address: string },
  ): { ok: true } | { ok: false; message: string } {
    // Checked again: on air could have begun while Google answered.
    const refused = this.cannotChange(profileId);
    if (refused) return { ok: false, message: refused };
    const profile = this.deps.stream.profilesView().profiles.find((p) => p.id === profileId);
    if (!profile) return { ok: false, message: YOUTUBE_WORDS.noProfile };
    if (profile.url !== ingest.address) {
      const saved = this.deps.stream.saveProfile(profileId, {
        name: profile.name,
        url: ingest.address,
        preset: profile.preset,
        camera: profile.camera,
        sound: profile.sound,
        soundDelayMs: profile.soundDelayMs,
        mixOwnSound: profile.mixOwnSound,
      });
      if (!saved.ok) return saved;
    }
    const kept = this.deps.stream.setKey(profileId, ingest.key);
    if (!kept.ok) return kept;
    this.setLink(profileId, {
      broadcastId: broadcast.id,
      title: broadcast.title,
      startsAt: broadcast.startsAt,
      privacy: broadcast.privacy,
      address: ingest.address,
    });
    this.known = { broadcastId: broadcast.id, state: broadcast.state };
    this.deps.log('info', 'YouTube: a broadcast’s stream key was saved for a stream profile');
    return { ok: true };
  }

  private failed(message: string): YouTubeResult {
    this.say(message);
    return { ok: false, message };
  }

  // ---- on air: YouTube's state, and ending the broadcast -------------------------------------------

  /** The stream changed (statusChanged): while on air, YouTube's state of the in-use profile's broadcast is asked. */
  streamChanged(status: StreamStatus): void {
    const onAir = status.live.state !== 'off';
    if (onAir === this.onAir) return;
    this.onAir = onAir;
    if (!onAir) {
      this.stopWatching();
      return;
    }
    const active = this.deps.stream.profilesView().activeId;
    const link = active === null ? undefined : this.links()[active];
    if (!link) return;
    this.watch(link.broadcastId, STATE_FIRST_MS);
  }

  private watch(broadcastId: string, inMs: number): void {
    this.stopWatching();
    const timer = this.deps.setTimer ?? defaultTimer;
    const stop = timer(() => {
      void this.lookAt(broadcastId);
    }, inMs);
    this.watching = { broadcastId, stop };
  }

  private stopWatching(): void {
    this.watching?.stop();
    this.watching = null;
  }

  /** Ask YouTube how the broadcast stands; nothing is said when it cannot be asked (the stream goes on as it is). */
  private async lookAt(broadcastId: string): Promise<void> {
    const watching = this.watching;
    if (watching?.broadcastId !== broadcastId) return;
    const got = await this.withToken((token) => this.api.broadcast(token, broadcastId));
    // Stopped (off air, or ended) while YouTube answered: nothing more.
    if (this.watching !== watching) return;
    if (got.ok && got.value) {
      const state = broadcastOf(got.value).state;
      if (this.known?.broadcastId !== broadcastId || this.known.state !== state) {
        this.known = { broadcastId, state };
        this.deps.log('info', `YouTube: the broadcast is ${state}`);
        this.changed();
      }
      if (state === 'ended' || state === 'removed') {
        this.stopWatching();
        return;
      }
    }
    this.watch(broadcastId, this.known?.state === 'live' ? STATE_LIVE_MS : STATE_UNTIL_LIVE_MS);
  }

  /**
   * The operator ended the stream (End the stream…): its profile's broadcast is ended on YouTube too, in the
   * background, after the encoder was told to stop. Never retried by itself: if Google cannot be reached, the
   * operator is told, with End it on YouTube.
   */
  streamEnded(profileId: string): void {
    if (!(profileId in this.links())) return;
    void this.endBroadcast(profileId);
  }

  /** End a profile's broadcast on YouTube (after the stream, or End it on YouTube). */
  async endBroadcast(rawProfileId: unknown): Promise<YouTubeResult> {
    const profileId = z.string().min(1).max(100).safeParse(rawProfileId);
    const link = profileId.success ? this.links()[profileId.data] : undefined;
    if (!link) return { ok: false, message: 'This profile streams to no YouTube broadcast.' };
    const ended = await this.withToken((token) => this.api.complete(token, link.broadcastId));
    if (!ended.ok && (ended.problem === 'transition' || ended.problem === 'not-found')) {
      // It never went live there (or it is gone): there is nothing to end on YouTube.
      this.stopWatching();
      this.known = { broadcastId: link.broadcastId, state: 'upcoming' };
      this.say(`YouTube had not started “${link.title}”, so there was nothing to end there.`);
      return { ok: true, status: this.status() };
    }
    if (!ended.ok) {
      // As far as Drashti knows it may still be live there: End it on YouTube is offered.
      this.known = { broadcastId: link.broadcastId, state: 'live' };
      return this.failed(`YouTube may still show “${link.title}” as live. ${ended.message}`);
    }
    this.stopWatching();
    this.known = { broadcastId: link.broadcastId, state: 'ended' };
    this.deps.log('info', 'YouTube: the broadcast was ended');
    this.say(null);
    return { ok: true, status: this.status() };
  }
}
