import type { Authority } from '../network/outbound-policy';
import { join } from 'node:path';
import type { CommandResult } from '../../shared/engine/commands';
import type { EngineState } from '../../shared/engine/state';
import {
  checkStreamLink,
  STREAM_LINK_OFF,
  STREAM_LINK_WALLPAPER_MS,
  streamLinkName,
  type StreamLinkKind,
  type StreamLinkResult,
  type StreamLinkState,
  type StreamLinkStatus,
} from '../../shared/live-link';
import { guardAllows, requirePublicPlaylist, type PlaylistFetch } from './fetch-playlist';
import { chooseVariant, readPlaylist } from './hls-playlist';
import { relayArgs } from './relay-args';
import { youtubeLiveStream } from './youtube-live';

/*
 * Show a Stream Link…, the main process's side (alpha.20, the playback set's slice 8; the owner's Q60-39 P3 A). One
 * link up at a time (and one more connecting, which takes its place once its pictures come):
 *
 * - The link is checked as typed (shared/live-link.ts); a YouTube live link is looked at with Drashti's own yt-dlp for
 *   its stream (never while the stream is on air or recording: yt-dlp runs YouTube's own code as it looks, as From a
 *   Link…'s look does); the playlist is read first, so an ended stream is never received from its start, and a master
 *   playlist's variant is chosen (H.264, at most 1080 lines).
 * - Its FFmpeg (relay-args.ts, below normal priority) copies it into a short local stream in its own folder; once two of
 *   its segments are written, the engine puts it up as the background (`kind: 'link'`) and each screen plays it.
 * - If it drops (no new segment for a few seconds) LIVE says Reconnecting…, the screens holding its last picture; its
 *   FFmpeg is started again as it stops (sooner, then every 5 s), carrying the local playlist on. After 20 seconds the
 *   Wallpaper goes up (the engine's own change, which takes the link off as it takes a video off), and when its
 *   pictures come again it goes up again by itself, so long as nothing else went up meanwhile (the Wallpaper still on,
 *   black-out off, no background, the same slide and box as when the Wallpaper went up). A stream that has ended stops
 *   there.
 * - Taken off any way (Clear, another background, a cover, Clear all), it stops: its FFmpeg, and its folder removed. Put
 *   back (Put it back, Oops), the last link shown starts receiving again.
 *
 * The log names the link's host only, never the link (it can hold a token) or a YouTube title.
 */

/** The relay FFmpeg running: how it ended (its exit code; null when it was stopped or could not start), and its stop. */
export interface RelayRun {
  done: Promise<{ code: number | null }>;
  stop(): void;
}

/** How far a local stream has got: its newest segment's number (null: none yet), its segments' length, each listed. */
export interface LocalProgress {
  newest: number | null;
  targetSeconds: number | null;
  /** The segments its playlist lists now, in order, each with its length (seconds). */
  segments: { n: number; seconds: number }[];
}

export interface LiveLinkDeps {
  /** Start the relay FFmpeg with these arguments (below normal priority); null when Drashti's FFmpeg is missing. */
  startRelay(args: string[]): RelayRun | null;
  /** Ask for a playlist (fetch-playlist.ts). */
  fetchPlaylist(url: string, signal: AbortSignal): Promise<PlaylistFetch>;
  /** yt-dlp's look at a YouTube link: what it printed, or why it could not look (in plain words). */
  lookYoutube(
    url: string,
    signal: AbortSignal,
  ): Promise<{ ok: true; json: string } | { ok: false; message: string }>;
  /** The stream is on air or recording. */
  onAir(): boolean;
  /** Where each link's local stream is written, in a folder of its own. */
  root: string;
  progress(dir: string): Promise<LocalProgress>;
  /** A local stream's own playlist as it is now (null while it is not written). */
  readPlaylist(dir: string): Promise<string | null>;
  makeFolder(dir: string): void;
  /** Remove a link's folder, once its FFmpeg has gone. */
  removeFolder(dir: string): Promise<void>;
  /** The engine's own: put a link up (the operator's change), the Wallpaper up for a dropped one, a link off. */
  showLink(link: { linkId: string; name: string }): CommandResult;
  /** Every page joins it afresh (a new start for all at once), the link carrying on: bookkeeping, never the operator's. */
  restartLink(linkId: string): CommandResult;
  dropped(linkId: string): CommandResult;
  clearLink(linkId: string): CommandResult;
  state(): EngineState;
  /** The operator window is told how it stands, whenever that changes. */
  changed(status: StreamLinkStatus): void;
  log(level: 'info' | 'warn', message: string): void;
  now(): number;
  newId(): string;
  /** A test run: no address but this computer's own is ever asked (no test reaches the internet). */
  guard: boolean;
  /** How often the local stream is looked at (500 ms). */
  pollMs?: number;
  /** How long a new link may take to give its first pictures (20 s). */
  firstMs?: number;
}

/** How long without a new segment before LIVE says Reconnecting… (at least; longer for a stream of long segments). */
const STALL_MS = 6000;
/** A relay giving nothing for this long while it runs is started again. */
const STUCK_MS = 15_000;
/** Waits before each start again after a drop: sooner at first, then every 5 s. */
const RETRY_MS = [1000, 2000, 4000, 5000] as const;
/** Segments written before the screens are given it: three (numbered 0 to 2), so each page can start three from the end. */
const READY_AT = 2;
/**
 * How long after a showing's start its first frame is shown: time for every page to load it and hold it ready (CI's Mac
 * took over a second to have a page's first frame, x54-1120-195548-69004).
 */
const START_MS = 2000;
/** How long after its joined moment the initial playlist lists only three segments, so it starts at the first. */
const JOIN_WINDOW_MS = 2000;
/** A page joins at a segment whose moment is at least this far off: time to load it and have its first frame. */
const JOIN_LEAD_MS = 1500;

export const TEST_GUARD =
  'Test guard: a stream link was asked of somewhere other than 127.0.0.1, so it was stopped.';
const NO_FFMPEG =
  'Drashti’s copy of FFmpeg is missing, so it cannot receive a stream. Install Drashti again.';
const NO_PICTURE =
  'Drashti could not receive that stream: no pictures came from it. Check the link, then try again.';
const ON_AIR =
  'Drashti looks at a YouTube link only while the stream is off air and not recording (YouTube’s own code runs as it looks). Show it again once the stream is off, or paste the stream’s HLS link instead.';
const ENDED = 'The stream link has ended.';
const NOT_BACK =
  'The stream link came back, but something else had gone up meanwhile, so it was not put back. Show a Stream Link… shows it again.';

/** Why a playlist could not be had, in plain words (never a status number or the system's own words). */
function fetchProblem(got: Exclude<PlaylistFetch, { ok: true }>): string {
  if (got.reason === 'guard') return TEST_GUARD;
  if (got.reason === 'network')
    return 'Drashti could not reach that stream. Check the link and this computer’s internet connection, then try again.';
  if (got.reason === 'redirects') return 'That link kept sending Drashti on elsewhere. Check the link.';
  if (got.reason === 'status') {
    if (got.status === 404 || got.status === 410)
      return 'That stream is not at that link: it may have ended, or the link may be wrong.';
    if (got.status === 401 || got.status === 403)
      return 'That stream did not let Drashti receive it: it may need signing in, or be shown only in some places.';
    return 'That stream’s server did not give it. Try again in a moment.';
  }
  return 'That link does not give an HLS stream. Check the link.';
}

const NO_PROGRESS: LocalProgress = { newest: null, targetSeconds: null, segments: [] };

/**
 * A local playlist as a player joined at segment `from` is given it: its own header, then its segments from `from` up to
 * `until`, each with the lines before it (its length, a discontinuity), numbered from the first given.
 */
export function joinedPlaylist(text: string, from: number, until: number): string {
  const header: string[] = [];
  const kept: string[] = [];
  let pending: string[] = [];
  let first: number | null = null;
  let seenSegment = false;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line === '' || line === '#EXT-X-ENDLIST') continue;
    const seg = /^seg-(\d{6})\.ts$/u.exec(line);
    if (seg?.[1]) {
      seenSegment = true;
      const n = Number(seg[1]);
      if (n >= from && n <= until) {
        first ??= n;
        kept.push(...pending, line);
      }
      pending = [];
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:') || line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:'))
      continue;
    if (!seenSegment && !line.startsWith('#EXTINF') && line !== '#EXT-X-DISCONTINUITY') header.push(line);
    else pending.push(line);
  }
  return [...header, `#EXT-X-MEDIA-SEQUENCE:${String(first ?? from)}`, ...kept, ''].join('\n');
}

/** The slide up and the box up, by what they are and when they went up: what "nothing else went up" compares. */
const slideKey = (s: EngineState): string | null =>
  s.layers.slide ? `${s.layers.slide.slide.id}@${String(s.layers.slide.shownAt)}` : null;
const pipKey = (s: EngineState): string | null =>
  s.layers.pip ? `${s.layers.pip.source.kind}@${String(s.layers.pip.shownAt)}` : null;

interface Source {
  authority?: Authority;
  /** What FFmpeg receives: a media playlist, or a master playlist with its variant's program. */
  url: string;
  program: number | null;
}

interface Link {
  linkId: string;
  kind: StreamLinkKind;
  /** The link as checked: the HLS playlist's, or the YouTube video's page. */
  link: string;
  name: string;
  host: string;
  dir: string;
  source: Source | null;
  relay: RelayRun | null;
  /** When its relay last started. */
  relayAt: number;
  /** Its relay has written to its folder: a start again carries the local playlist on. */
  written: boolean;
  newest: number | null;
  targetSeconds: number | null;
  /** Each segment's start in the stream's own time (seconds from its first), and its length. */
  starts: Map<number, number>;
  lengths: Map<number, number>;
  /**
   * The showing's anchor: segment `segment`, which starts `start` seconds into the stream's own time, has its first
   * frame shown at `at` (the engine's time); null until it is up. Its start is kept here, as the segment's own entry
   * goes once it is gone from the disk (each page later joins by the stream's time from it).
   */
  anchor: { segment: number; start: number; at: number } | null;
  /** Each segment's initial playlist starts its window at the joined moment, or a later join request. */
  joins: Map<number, number>;
  lastProgress: number;
  state: StreamLinkState;
  since: number;
  note: string | null;
  /** What was up as its Wallpaper went up. */
  left: { slide: string | null; pip: string | null } | null;
  retry: NodeJS.Timeout | null;
  tries: number;
  /** The stream ended: it is never received again. */
  ended: boolean;
  abort: AbortController;
}

export class LiveLinkService {
  /** The link up (or waiting to come back). */
  private current: Link | null = null;
  /** A link connecting, not up yet. */
  private pending: Link | null = null;
  /** The last link that was up, kept so Put it back can start it again. */
  private last: Pick<Link, 'linkId' | 'kind' | 'link' | 'name' | 'host' | 'source'> | null = null;
  private status: StreamLinkStatus = STREAM_LINK_OFF;
  private ended: StreamLinkStatus | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private closed = false;

  constructor(private readonly deps: LiveLinkDeps) {}

  /** How it stands, for the operator window. */
  view(): StreamLinkStatus {
    return this.status;
  }

  /** Show a stream link the operator typed: up once its pictures come, or why not. */
  async show(raw: string): Promise<StreamLinkResult> {
    const check = checkStreamLink(raw);
    if (!check.ok) return check;
    if (this.deps.guard && !guardAllows(new URL(check.url)) && check.kind === 'hls')
      return { ok: false, message: TEST_GUARD };
    if (check.kind === 'youtube' && this.deps.onAir()) return { ok: false, message: ON_AIR };
    this.cancelPending();
    this.ended = null;
    const linkId = this.deps.newId();
    const now = this.deps.now();
    const link: Link = {
      linkId,
      kind: check.kind,
      link: check.url,
      name: streamLinkName(check),
      host: check.host,
      dir: join(this.deps.root, linkId),
      source: null,
      relay: null,
      relayAt: now,
      written: false,
      newest: null,
      targetSeconds: null,
      starts: new Map(),
      lengths: new Map(),
      anchor: null,
      joins: new Map(),
      lastProgress: now,
      state: 'connecting',
      since: now,
      note: null,
      left: null,
      retry: null,
      tries: 0,
      ended: false,
      abort: new AbortController(),
    };
    this.pending = link;
    this.say();
    this.deps.log('info', `Stream link: connecting to ${link.host}`);
    const made = await this.connect(link);
    if (this.pending !== link) return { ok: false, message: 'Stopped.' };
    if (!made.ok) {
      this.pending = null;
      await this.stopRelay(link);
      this.say();
      this.deps.log('warn', `Stream link: ${link.host} could not be received`);
      return made;
    }
    // It takes the place of the one up, if any (the engine's change stops that one: follow()).
    const before = this.current;
    this.pending = null;
    this.current = link;
    this.anchor(link);
    const put = this.deps.showLink({ linkId: link.linkId, name: link.name });
    if (!put.ok) {
      this.current = before;
      await this.stopRelay(link);
      this.say();
      return { ok: false, message: put.message };
    }
    if (before && before !== link) void this.finish(before, null);
    link.lastProgress = this.deps.now();
    this.set(link, 'playing', link.lastProgress, null);
    this.last = {
      linkId: link.linkId,
      kind: link.kind,
      link: link.link,
      name: link.name,
      host: link.host,
      source: link.source,
    };
    this.deps.log('info', `Stream link: ${link.host} went up as the background`);
    this.watch();
    return { ok: true };
  }

  /** The operator's Stop: a link connecting stops; the link up comes off (and stops). */
  stop(): void {
    if (this.pending) {
      this.cancelPending();
      this.say();
      return;
    }
    const link = this.current;
    if (!link) {
      this.ended = null;
      this.say();
      return;
    }
    const bg = this.deps.state().layers.background;
    if (bg?.kind === 'link' && bg.linkId === link.linkId) this.deps.clearLink(link.linkId);
    if (this.current === link) void this.finish(link, null);
  }

  /** The show changed: a link taken off stops; a link put back starts receiving again. */
  follow(): void {
    if (this.closed) return;
    const s = this.deps.state();
    const bg = s.layers.background;
    const link = this.current;
    if (link) {
      if (link.state === 'wallpaper') {
        // Waiting to come back: anything the operator does about the picture ends it.
        if (!s.wallpaper || s.blackout || bg !== null) void this.finish(link, null);
        return;
      }
      if (bg?.kind === 'link' && bg.linkId === link.linkId) return;
      void this.finish(link, null);
    }
    if (bg?.kind === 'link' && this.current === null && this.pending?.linkId !== bg.linkId)
      this.resume(bg.linkId);
  }

  /** Quitting: everything stops, and its folders go. */
  async close(): Promise<void> {
    this.closed = true;
    this.cancelPending();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const link = this.current;
    if (link) await this.finish(link, null);
  }

  // ---- connecting -------------------------------------------------------------------------------------------------

  /** Find its stream and start receiving it: ok once two segments are written. */
  private async connect(link: Link): Promise<StreamLinkResult> {
    const source = await this.resolve(link);
    if (!source.ok) return { ok: false, message: source.message };
    link.source = source.source;
    try {
      this.deps.makeFolder(link.dir);
    } catch {
      return {
        ok: false,
        message: 'Drashti could not make a folder for the stream. Check the disk, then try again.',
      };
    }
    if (!this.startRelay(link)) return { ok: false, message: NO_FFMPEG };
    const until = this.deps.now() + (this.deps.firstMs ?? 20_000);
    for (;;) {
      if (link.abort.signal.aborted) return { ok: false, message: 'Stopped.' };
      const got = await this.deps.progress(link.dir).catch((): LocalProgress => NO_PROGRESS);
      this.learn(link, got);
      if (got.newest !== null && got.newest >= READY_AT) {
        link.newest = got.newest;
        link.targetSeconds = got.targetSeconds;
        return { ok: true };
      }
      if (!link.relay || this.deps.now() >= until) return { ok: false, message: NO_PICTURE };
      await this.wait(this.deps.pollMs ?? 500, link.abort.signal);
    }
  }

  /** The stream to receive: the HLS playlist (its variant chosen), or what yt-dlp gives for a YouTube link. */
  private async resolve(
    link: Link,
    again = false,
  ): Promise<{ ok: true; source: Source } | { ok: false; message: string; ended?: boolean }> {
    let url = link.link;
    if (link.kind === 'youtube') {
      if (!this.deps.guard) requirePublicPlaylist(link.abort.signal);
      // Started again: the stream yt-dlp gave first, while it still answers.
      if (again && link.source) {
        const kept = await this.read(link.source.url, link);
        if (kept.ok || kept.ended || this.deps.onAir()) return kept;
      }
      if (this.deps.onAir()) return { ok: false, message: ON_AIR };
      const looked = await this.deps.lookYoutube(link.link, link.abort.signal);
      if (!looked.ok) return looked;
      const stream = youtubeLiveStream(looked.json);
      if (!stream.ok) return { ok: false, message: stream.message, ended: stream.problem === 'ended' };
      url = stream.url;
    }
    return this.read(url, link);
  }

  /** Read a playlist: a live media playlist as it is, a master's variant chosen, an ended one refused. */
  private async read(
    url: string,
    link: Link,
  ): Promise<{ ok: true; source: Source } | { ok: false; message: string; ended?: boolean }> {
    const got = await this.deps.fetchPlaylist(url, link.abort.signal);
    if (!got.ok) return { ok: false, message: fetchProblem(got) };
    const read = readPlaylist(got.text, got.url);
    if (read.kind === 'not-hls')
      return { ok: false, message: 'That link does not give an HLS stream. Check the link.' };
    if (read.kind === 'master') {
      const variant = chooseVariant(read.variants);
      if (!variant) return { ok: false, message: 'That stream has no picture Drashti can show.' };
      return {
        ok: true,
        source: {
          url: got.url,
          program: variant.index,
          ...(got.authority ? { authority: got.authority } : {}),
        },
      };
    }
    if (read.ended) return { ok: false, message: 'That stream has ended.', ended: true };
    return {
      ok: true,
      source: { url: got.url, program: null, ...(got.authority ? { authority: got.authority } : {}) },
    };
  }

  // ---- the relay ----------------------------------------------------------------------------------------------------

  private startRelay(link: Link): boolean {
    if (!link.source) return false;
    const run = this.deps.startRelay(
      relayArgs({
        url: link.source.url,
        program: link.source.program,
        dir: link.dir,
        again: link.written,
        authority: link.source.authority,
        guard: this.deps.guard,
      }),
    );
    if (!run) return false;
    link.relay = run;
    link.relayAt = this.deps.now();
    link.written = true;
    void run.done.then(() => {
      if (link.relay !== run) return;
      link.relay = null;
      if (this.current === link) this.again(link);
    });
    return true;
  }

  /** Its FFmpeg stopped while it is wanted: started again after a wait (sooner at first). */
  private again(link: Link): void {
    if (link.ended || link.retry || this.closed) return;
    const wait = RETRY_MS[Math.min(link.tries, RETRY_MS.length - 1)] ?? 5000;
    link.tries++;
    link.retry = setTimeout(() => {
      link.retry = null;
      void this.restart(link);
    }, wait);
  }

  private async restart(link: Link): Promise<void> {
    if (this.current !== link || link.relay) return;
    const source = await this.resolve(link, true);
    if (this.current !== link) return;
    if (!source.ok) {
      if (source.ended) {
        link.ended = true;
        this.set(link, link.state, link.since, ENDED);
        return;
      }
      // Why it is still waiting, while it is (never over pictures that play on).
      if (link.state !== 'playing') this.set(link, link.state, link.since, source.message);
      this.again(link);
      return;
    }
    link.source = source.source;
    if (!this.startRelay(link)) {
      this.set(link, link.state, link.since, NO_FFMPEG);
      this.again(link);
    }
  }

  private async stopRelay(link: Link): Promise<void> {
    if (link.retry) clearTimeout(link.retry);
    link.retry = null;
    const run = link.relay;
    link.relay = null;
    if (run) {
      run.stop();
      // Its files are let go only once it has gone (Windows keeps a running program's files).
      await run.done.catch(() => undefined);
    }
    await this.deps.removeFolder(link.dir).catch(() => undefined);
  }

  // ---- while it is up -----------------------------------------------------------------------------------------------

  private watch(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.deps.pollMs ?? 500);
  }

  private async tick(): Promise<void> {
    const link = this.current;
    if (!link) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (this.ticking) return;
    this.ticking = true;
    try {
      const got = await this.deps.progress(link.dir).catch((): LocalProgress => NO_PROGRESS);
      if (this.current !== link) return;
      this.learn(link, got);
      const now = this.deps.now();
      if (got.newest !== null && (link.newest === null || got.newest > link.newest)) {
        link.newest = got.newest;
        if (got.targetSeconds !== null) link.targetSeconds = got.targetSeconds;
        link.lastProgress = now;
        link.tries = 0;
        if (link.state === 'reconnecting') {
          this.set(link, 'playing', now, null);
          this.deps.log('info', `Stream link: ${link.host} came back`);
          // Every page starts again together at the newest pictures (each one's own player would carry on where it
          // stopped, apart from the others and behind the show).
          if (link.newest >= READY_AT) this.restart_(link, 'back after a drop');
        } else if (link.state === 'wallpaper') this.comeBack(link);
        else if (link.anchor === null && link.newest >= READY_AT) this.anchor(link);
        else this.keepAnchor(link, now);
        return;
      }
      const quiet = now - link.lastProgress;
      const stall = Math.max(STALL_MS, (link.targetSeconds ?? 0) * 2500);
      if (link.state === 'playing' && quiet >= stall) {
        this.set(link, 'reconnecting', link.lastProgress, link.ended ? ENDED : null);
        this.deps.log('info', `Stream link: ${link.host} dropped; reconnecting`);
      }
      if (link.state === 'reconnecting' && quiet >= STREAM_LINK_WALLPAPER_MS) this.wallpaper(link);
      // Running but giving nothing since it started or last gave (its source started again, say): started again.
      const idle = now - Math.max(link.lastProgress, link.relayAt);
      if (link.relay && idle >= Math.max(STUCK_MS, stall * 2)) link.relay.stop();
    } finally {
      this.ticking = false;
    }
  }

  /** Dropped 20 seconds ago: the Wallpaper up (the link off under it); it comes back by itself, if nothing else went up. */
  private wallpaper(link: Link): void {
    const s = this.deps.state();
    link.left = { slide: slideKey(s), pip: pipKey(s) };
    this.set(link, 'wallpaper', this.deps.now(), link.ended ? ENDED : null);
    const done = this.deps.dropped(link.linkId);
    this.deps.log('info', `Stream link: ${link.host} gone 20 s; the Wallpaper is up`);
    if (!done.ok || link.ended) void this.finish(link, link.ended ? ENDED : null);
  }

  /** Its pictures came again while its Wallpaper is up: up again, so long as nothing else went up meanwhile. */
  private comeBack(link: Link): void {
    const s = this.deps.state();
    const left = link.left;
    const nothingElse =
      left !== null &&
      s.wallpaper &&
      !s.blackout &&
      s.layers.background === null &&
      slideKey(s) === left.slide &&
      pipKey(s) === left.pip;
    if (!nothingElse) {
      void this.finish(link, NOT_BACK);
      return;
    }
    link.left = null;
    // Playing again before the engine's change, which follow() reads.
    this.set(link, 'playing', this.deps.now(), null);
    this.anchor(link);
    const put = this.deps.showLink({ linkId: link.linkId, name: link.name });
    if (!put.ok) {
      void this.finish(link, NOT_BACK);
      return;
    }
    this.deps.log('info', `Stream link: ${link.host} came back and went up again by itself`);
  }

  // ---- every page together --------------------------------------------------------------------------------------

  /** What a playlist says of its segments: each one's start in the stream's own time, carried on as segments come. */
  private learn(link: Link, got: LocalProgress): void {
    let previous: { n: number; seconds: number } | null = null;
    for (const seg of got.segments) {
      if (!link.starts.has(seg.n)) {
        const before = previous ?? null;
        const start =
          before !== null
            ? (link.starts.get(before.n) ?? 0) + before.seconds
            : link.starts.size === 0
              ? 0
              : null;
        if (start !== null) link.starts.set(seg.n, start);
      }
      link.lengths.set(seg.n, seg.seconds);
      previous = seg;
    }
    // Only the segments still on disk are kept.
    const oldest = got.segments[0]?.n;
    if (oldest !== undefined)
      for (const n of [...link.starts.keys()]) if (n < oldest - 4) link.starts.delete(n);
  }

  /** A new showing's anchor: three segments from the newest, its first frame shown a moment from now. */
  private anchor(link: Link): void {
    if (link.newest === null) return;
    const known = [...link.starts.keys()].filter((n) => n <= (link.newest ?? 0) - 2);
    if (known.length === 0) return;
    const segment = Math.max(...known);
    link.anchor = { segment, start: link.starts.get(segment) ?? 0, at: this.deps.now() + START_MS };
    link.joins.clear();
  }

  /** Every page starts again together (after a drop, or as the show's time has moved too far from the stream's). */
  private restart_(link: Link, why: string): void {
    this.anchor(link);
    this.deps.restartLink(link.linkId);
    this.deps.log('info', `Stream link: ${link.host}: every page starts again together (${why})`);
  }

  /**
   * The showing's time against the stream's: the pages play what the anchor says, so the stream must stay ahead of it
   * by about the segments listed. Too close (it came late) or too far (it ran fast): every page starts again.
   */
  private keepAnchor(link: Link, now: number): void {
    const a = link.anchor;
    const newest = link.newest;
    if (a === null || newest === null) return;
    const end = (link.starts.get(newest) ?? NaN) + (link.lengths.get(newest) ?? 0);
    if (!Number.isFinite(end)) return;
    const shown = a.start + (now - a.at) / 1000;
    const ahead = end - shown;
    const target = link.targetSeconds ?? 1;
    // About three segments and the start's moment ahead as it goes up; past seven, pages near the playlist's end.
    if (ahead < 0.5 || ahead > 7 * target)
      this.restart_(
        link,
        `the stream ${ahead.toFixed(1)} s ahead of the show, segments of ${String(target)} s`,
      );
  }

  /**
   * A page joins the link up: the segment its player starts at (three from the newest, never before the showing's
   * anchor) and when that segment's first frame is shown, by the showing's own time. Null when that link is not up,
   * and while it reconnects: each page keeps its last picture until every page starts again together as it comes back
   * (a player joining then would play the link's last seconds again, the hall's sound too: CI x54-1120-235843-34860).
   */
  join(linkId: string): { segment: number; startAt: number } | null {
    const link = this.current;
    const a = link?.anchor;
    if (link?.linkId !== linkId || !a || link.newest === null) return null;
    if (link.state === 'wallpaper' || link.state === 'reconnecting') return null;
    const now = this.deps.now();
    const moment = (n: number): number | null => {
      const at = link.starts.get(n);
      return at === undefined ? null : Math.round(a.at + (at - a.start) * 1000);
    };
    // Three from the newest, or the next if that one's moment has passed (a page joining late), never before the anchor.
    const choices = [link.newest - 2, link.newest - 1].filter((n) => n >= a.segment && moment(n) !== null);
    const segment = choices.find((n) => (moment(n) ?? 0) >= now + JOIN_LEAD_MS) ?? choices[0];
    if (segment === undefined) return null;
    // A recovering player may load at its moment rather than pause early. Keep its chosen first three until
    // after that moment too, so Chromium starts at the promised segment even for that later initial request.
    const startAt = moment(segment) ?? now;
    link.joins.set(segment, Math.max(now, startAt));
    return { segment, startAt };
  }

  /**
   * The playlist a player joined at `segment` is given: the local stream's own, from that segment on (only it and the
   * two after it for a moment, so Chromium's player, which starts three from a live playlist's end, starts there).
   */
  async playlistFor(linkId: string, segment: number): Promise<string | null> {
    const link = [this.current, this.pending].find((l) => l?.linkId === linkId);
    if (!link) return null;
    const text = await this.deps.readPlaylist(link.dir);
    if (text === null) return null;
    const joined = link.joins.get(segment);
    const until = joined !== undefined && this.deps.now() - joined < JOIN_WINDOW_MS ? segment + 2 : Infinity;
    return joinedPlaylist(text, segment, until);
  }

  /** A link put back (Put it back, Oops) that is not being received: the last one up starts again; another comes off. */
  private resume(linkId: string): void {
    const last = this.last;
    if (last?.linkId !== linkId) {
      this.deps.log('warn', 'Stream link: one put back that Drashti no longer receives was taken off');
      this.deps.clearLink(linkId);
      return;
    }
    const now = this.deps.now();
    const link: Link = {
      ...last,
      dir: join(this.deps.root, linkId),
      relay: null,
      relayAt: now,
      written: false,
      newest: null,
      targetSeconds: null,
      starts: new Map(),
      lengths: new Map(),
      anchor: null,
      joins: new Map(),
      lastProgress: now,
      state: 'reconnecting',
      since: now,
      note: null,
      left: null,
      retry: null,
      tries: 0,
      ended: false,
      abort: new AbortController(),
    };
    this.current = link;
    this.ended = null;
    this.say();
    try {
      this.deps.makeFolder(link.dir);
    } catch {
      // Started again below, as after a drop.
    }
    if (!this.startRelay(link)) this.again(link);
    this.deps.log('info', `Stream link: ${link.host} put back; receiving again`);
    this.watch();
  }

  /** It stops: its FFmpeg, its folder; the operator told (`note`: why, when there is something to say). */
  private async finish(link: Link, note: string | null): Promise<void> {
    if (this.current === link) this.current = null;
    link.abort.abort();
    if (note !== null) this.ended = { state: 'ended', name: link.name, since: this.deps.now(), note };
    this.say();
    this.deps.log('info', `Stream link: ${link.host} stopped`);
    await this.stopRelay(link);
  }

  private cancelPending(): void {
    const link = this.pending;
    if (!link) return;
    this.pending = null;
    link.abort.abort();
    void this.stopRelay(link);
  }

  // ---- the operator's notice ---------------------------------------------------------------------------------------

  private set(link: Link, state: StreamLinkState, since: number, note: string | null): void {
    link.state = state;
    link.since = since;
    link.note = note;
    this.say();
  }

  /** Tell the operator window how it stands, when that changed. */
  private say(): void {
    const link = this.pending ?? this.current;
    const next: StreamLinkStatus = link
      ? { state: link.state, name: link.name, since: link.since, note: link.note }
      : (this.ended ?? STREAM_LINK_OFF);
    if (
      next.state === this.status.state &&
      next.name === this.status.name &&
      next.since === this.status.since &&
      next.note === this.status.note
    )
      return;
    this.status = next;
    this.deps.changed(next);
  }

  /** The folder a link's local stream is in, while it is the one connecting or up; null for any other. */
  folderOf(linkId: string): string | null {
    const link = [this.current, this.pending].find((l) => l?.linkId === linkId);
    return link ? link.dir : null;
  }

  private wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }
}
