import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { EngineMessage, EngineSnapshotMessage } from '../../shared/engine/protocol';
import type { EngineState } from '../../shared/engine/state';
import type { EngineTransport } from '../../shared/engine/transport';
import {
  DEFAULT_NODE_PORT,
  type MediaWant,
  NODE_PAIRING_TTL_MS,
  type NodeHealth,
  type NodeInfo,
  type NodeOutputStatus,
  type NodeScreen,
  type NodesResult,
  type NodesStatus,
  type ScreenThumb,
} from '../../shared/nodes';
import { nodeNameSchema } from '../../shared/nodes-schema';
import { idSchema } from '../../shared/model-schema';
import type { NodeDisplays, ScreenStatus } from '../../shared/screens';
import type { NodeRepo, NodeRow } from '../db/nodes';
import type { ScreenRepo } from '../db/screens';
import type { LinkWorker } from './link-worker';
import type { LinkOptions, LinkStats } from './link-server';
import type { FromLinkWorker } from './worker/protocol';
import { hashToken, newToken } from '../network/tokens';

/*
 * Output nodes, as Main runs them (Session 13). It keeps the code on offer
 * for pairing, starts the node link worker while any node is paired or
 * being paired, hands it each engine message, tells each node which screens
 * it shows and which media to copy, and keeps each node's state (online
 * since when, its health, its pictures) for the screens dashboard. Every
 * change here is Pro Mode only (src/main/simple-mode.ts). The log names
 * nodes, never a token or a code.
 */

export interface NodeServiceDeps {
  nodes: NodeRepo;
  /** How bookkeeping reaches the library: when it is free, never waiting (Session 15). Left out: at once. */
  write?: (key: string, run: () => void) => void;
  screens: ScreenRepo;
  settings: { get(name: string): unknown };
  spawn(): LinkWorker;
  /**
   * Main's certificate and id, made the first time a node is paired; or, when the kept one could
   * not be read (Session 23, ./identity.ts), why there is none.
   */
  identity():
    { cert: string; key: string; fingerprint: string; id: string; name: string } | { problem: string };
  /** An admin's choice: a new identity in place of one that could not be read. */
  newIdentity(): void;
  version: string;
  /** Where nodes can reach Main: numbers, then its local name. */
  addresses(): string[];
  /** Listen on every interface, or on this computer only (tests). */
  bind: string;
  engine: { snapshot(): EngineSnapshotMessage; state(): EngineState; rev(): number; session: string };
  /** What a node should copy, in order. */
  wanted(state: EngineState, everything: boolean): MediaWant[];
  /** A media file for a node: where it is, its hash, size and extension. */
  mediaFile(mediaId: string): { path: string; sha256: string; bytes: number; ext: string } | null;
  /** The stream is on air or recording: copies go slower. */
  onAir(): boolean;
  /** The nodes' state changed (the dashboard and the status bar). */
  changed(status: NodesStatus): void;
  /** Screens on nodes changed state (Screens shows them). */
  screensChanged(): void;
  thumbs(thumbs: ScreenThumb[]): void;
  /** How Main's own outputs draw, for the dashboard. */
  localOutputs(): NodeOutputStatus[];
  log(level: 'info' | 'warn', message: string): void;
  now(): number;
  /** Tests: listen on this port instead of the setting's. */
  portOverride?: number | null;
  /** Tests: copies at this rate (bytes a second), on air or not. */
  copyRateOverride?: number | null;
}

const PORT_SETTING = 'nodes.port';
/** Copies go at most this fast, and slower while Main is on air or recording. */
export const COPY_RATE = 30 * 1024 * 1024;
export const COPY_RATE_ON_AIR = 5 * 1024 * 1024;
/** How often nodes send pictures while the dashboard is open. */
export const THUMB_EVERY_MS = 3000;
/** Changes the windows hear of within this, together. */
const CHANGE_COALESCE_MS = 250;
/** A report is behind only when it misses what the show was this long ago. */
const REPORT_SLACK_MS = 1500;
/** Last-seen times are written now and then, never on every message. */
const SEEN_WRITE_MS = 5 * 60 * 1000;

const portSchema = z.number().int().min(1024).max(65535);

interface Live {
  online: boolean;
  since: string | null;
  address: string | null;
  version: string | null;
  health: NodeHealth | null;
  refused: string | null;
  /** Since when its reports have been behind the show (ms), or null while it keeps up. */
  behindSince: number | null;
}

export class NodeService implements EngineTransport {
  private worker: LinkWorker | null = null;
  private state: NodesStatus['state'] = 'off';
  private message: string | null = null;
  /** Main's identity could not be read (Session 23): kept until an admin makes a new one, nodes or not. */
  private identityProblem: string | null = null;
  private boundPort: number | null = null;
  private offer: { code: string; expiresAt: number } | null = null;
  private offerTimer: NodeJS.Timeout | null = null;
  private readonly live = new Map<string, Live>();
  private readonly sentWanted = new Map<string, string>();
  private wantedTimer: NodeJS.Timeout | null = null;
  private watching = false;
  private seenWriter: NodeJS.Timeout | null = null;
  private seenSaves = 0;
  private readonly unsaved = new Map<
    string,
    { at: string; address: string | null; version: string | null }
  >();
  private onAirWas = false;
  private statsWaiters: ((stats: LinkStats) => void)[] = [];
  private stopping: Promise<void> | null = null;
  /** Closing for good (Drashti is quitting): the link is never started again. */
  private closing = false;
  private changeTimer: NodeJS.Timeout | null = null;
  /** Each node's displays as last kept (JSON), so a report that changes nothing writes nothing. */
  private readonly knownDisplays = new Map<string, string>();
  /** The engine's revisions over the last few seconds, and when each came. */
  private readonly revs: { at: number; rev: number }[] = [];

  constructor(private readonly deps: NodeServiceDeps) {}

  get port(): number {
    if (this.deps.portOverride) return this.deps.portOverride;
    const parsed = portSchema.safeParse(this.deps.settings.get(PORT_SETTING));
    return parsed.success ? parsed.data : DEFAULT_NODE_PORT;
  }

  /** At start: listen again if nodes are paired. */
  resume(): void {
    this.updateWorker();
  }

  private needed(): boolean {
    return (
      this.deps.nodes.list().length > 0 || (this.offer !== null && this.offer.expiresAt > this.deps.now())
    );
  }

  private updateWorker(): void {
    if (this.closing) return;
    if (this.needed()) this.startWorker();
    else void this.stopWorker();
  }

  // ---- the worker -------------------------------------------------------------------------

  private startWorker(): void {
    if (this.worker) return;
    const identity = this.deps.identity();
    if ('problem' in identity) {
      // No identity to give the link: nothing listens, and the operator is told (status).
      this.identityProblem = identity.problem;
      if (this.state !== 'failed' || this.message !== identity.problem) {
        this.state = 'failed';
        this.message = identity.problem;
        this.changed();
      }
      return;
    }
    this.state = 'starting';
    this.message = null;
    const worker = this.deps.spawn();
    this.worker = worker;
    worker.onMessage((m) => {
      if (this.worker === worker) this.fromWorker(worker, m);
    });
    worker.onExit(() => {
      // Stopped on purpose, or Drashti is quitting: never started again.
      if (this.worker !== worker || this.closing) return;
      this.worker = null;
      this.boundPort = null;
      for (const l of this.live.values()) l.online = false;
      this.state = 'failed';
      this.message = 'The link to the nodes stopped unexpectedly; starting it again.';
      this.deps.log('warn', 'Nodes: the link worker stopped; starting it again');
      setTimeout(() => {
        if (!this.worker && this.needed()) this.startWorker();
      }, 1000);
      this.changed();
    });
    // The nodes and the show first, so a node that reconnects the moment the link listens is known.
    this.pushNodes();
    worker.send({ type: 'engine', message: this.deps.engine.snapshot() });
    worker.send({ type: 'offer', offer: this.offer });
    for (const n of this.deps.nodes.list()) this.pushScreens(n.id);
    this.pushWanted(true);
    const options: LinkOptions = {
      port: this.port,
      bind: this.deps.bind,
      cert: identity.cert,
      key: identity.key,
      fingerprint: identity.fingerprint,
      main: { id: identity.id, name: identity.name, version: this.deps.version },
      addresses: this.deps.addresses(),
      session: this.deps.engine.session,
      bytesPerSecond: this.copyRate(),
    };
    worker.send({ type: 'start', options });
    this.seenWriter ??= setInterval(() => {
      this.saveSeen();
    }, SEEN_WRITE_MS);
    this.changed();
  }

  private stopWorker(): Promise<void> {
    const worker = this.worker;
    if (!worker) return this.stopping ?? Promise.resolve();
    this.worker = null;
    this.saveSeen();
    this.stopping = new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        worker.kill();
        resolve();
      };
      const timer = setTimeout(done, 2000);
      worker.onMessage((m) => {
        if (m.type === 'stopped') done();
      });
      worker.send({ type: 'stop' });
    }).finally(() => {
      this.stopping = null;
    });
    this.state = 'off';
    this.boundPort = null;
    for (const l of this.live.values()) l.online = false;
    this.changed();
    return this.stopping;
  }

  private fromWorker(worker: LinkWorker, m: FromLinkWorker): void {
    switch (m.type) {
      case 'started':
        if (m.result.ok) {
          this.state = 'listening';
          this.boundPort = m.result.port;
          this.message = null;
          this.pushNodes();
          worker.send({ type: 'engine', message: this.deps.engine.snapshot() });
          this.deps.log('info', `Nodes: listening on port ${m.result.port}`);
        } else {
          this.state = 'failed';
          this.message = m.result.message;
          this.deps.log('warn', `Nodes: could not listen (${m.result.message})`);
          this.worker = null;
          worker.kill();
        }
        this.changed();
        return;
      case 'ask':
        if (m.question.kind === 'paired') {
          const node = this.paired(m.question.node);
          worker.send({ type: 'answer', id: m.id, answer: node });
        } else {
          worker.send({ type: 'answer', id: m.id, answer: this.deps.mediaFile(m.question.mediaId) });
        }
        return;
      case 'online': {
        const l = this.liveOf(m.nodeId);
        const at = new Date(this.deps.now()).toISOString();
        if (!l.online) l.since = at;
        l.online = true;
        l.address = m.address;
        l.version = m.version;
        l.refused = null;
        this.unsaved.set(m.nodeId, { at, address: m.address, version: m.version });
        this.deps.log('info', `Nodes: ${this.label(m.nodeId)} connected`);
        this.pushWanted(true);
        this.changed();
        this.deps.screensChanged();
        return;
      }
      case 'offline': {
        const l = this.liveOf(m.nodeId);
        if (l.online) {
          l.online = false;
          l.since = new Date(this.deps.now()).toISOString();
          this.unsaved.set(m.nodeId, { at: l.since, address: l.address, version: l.version });
          this.deps.log('warn', `Nodes: ${this.label(m.nodeId)} disconnected`);
          this.changed();
          this.deps.screensChanged();
        }
        return;
      }
      case 'health': {
        const l = this.liveOf(m.nodeId);
        const before = JSON.stringify(l.health?.outputs ?? null);
        l.health = m.health;
        // Caught up with the show as it was a moment ago (a report is on its way while the show goes on),
        // or behind it since when.
        if (m.health.rev >= this.revBefore(this.deps.now() - REPORT_SLACK_MS)) l.behindSince = null;
        else l.behindSince ??= this.deps.now();
        // The displays are kept in the library only when they change (never a write on every report).
        const displays = JSON.stringify(m.health.displays);
        let changedDisplays = false;
        if (this.knownDisplays.get(m.nodeId) !== displays) {
          this.knownDisplays.set(m.nodeId, displays);
          changedDisplays = this.deps.nodes.setDisplays(m.nodeId, m.health.displays);
        }
        if (changedDisplays || before !== JSON.stringify(m.health.outputs)) this.deps.screensChanged();
        this.changed();
        return;
      }
      case 'thumb':
        this.deps.thumbs([
          {
            screenId: m.screenId,
            nodeId: m.nodeId,
            url: `data:image/jpeg;base64,${m.jpeg}`,
            at: this.deps.now(),
          },
        ]);
        return;
      case 'refused':
        this.liveOf(m.nodeId).refused = m.version;
        this.changed();
        return;
      case 'offer-dropped':
        this.setOffer(null);
        return;
      case 'resync':
        worker.send({ type: 'engine', message: this.deps.engine.snapshot() });
        return;
      case 'stats': {
        const waiters = this.statsWaiters;
        this.statsWaiters = [];
        for (const w of waiters) w(m.stats);
        return;
      }
      case 'log':
        if (m.level === 'warn') this.deps.log('warn', `Nodes: ${m.message}`);
        else this.deps.log('info', `Nodes: ${m.message}`);
        return;
      case 'stopped':
        return;
    }
  }

  /** The engine's revision as it was at this time. */
  private revBefore(at: number): number {
    let rev = -1;
    for (const r of this.revs) if (r.at <= at) rev = r.rev;
    return rev === -1 ? (this.revs[0]?.rev ?? this.deps.engine.rev()) - 1 : rev;
  }

  private liveOf(nodeId: string): Live {
    let l = this.live.get(nodeId);
    if (!l) {
      l = {
        online: false,
        since: null,
        address: null,
        version: null,
        health: null,
        refused: null,
        behindSince: null,
      };
      this.live.set(nodeId, l);
    }
    return l;
  }

  private label(nodeId: string): string {
    const n = this.deps.nodes.get(nodeId);
    return n ? `“${n.name}”` : 'a removed node';
  }

  private pushNodes(): void {
    this.worker?.send({
      type: 'nodes',
      nodes: this.deps.nodes.list().map((n) => ({ id: n.id, name: n.name, tokenHash: n.tokenHash })),
    });
  }

  /** The screens a node shows, as it needs them. */
  nodeScreens(nodeId: string): NodeScreen[] {
    const groups = new Map(this.deps.screens.groups().map((g) => [g.id, g]));
    return this.deps.screens.nodeScreens(nodeId).flatMap((s) => {
      const g = groups.get(s.groupId);
      return g && s.displayKey
        ? [
            {
              screenId: s.id,
              name: s.name,
              groupId: g.id,
              groupName: g.name,
              role: g.role,
              feed: s.feed,
              canvasWidth: s.canvasWidth,
              canvasHeight: s.canvasHeight,
              scaling: s.scaling,
              enabled: s.enabled,
              displayKey: s.displayKey,
            },
          ]
        : [];
    });
  }

  private pushScreens(nodeId: string): void {
    this.worker?.send({ type: 'screens', nodeId, screens: this.nodeScreens(nodeId) });
  }

  /** Screens or groups changed: every node gets its screens again. */
  screensChanged(): void {
    for (const n of this.deps.nodes.list()) this.pushScreens(n.id);
  }

  /** Each node's media list, sent when it changed (now, or a moment after the show changes). */
  private pushWanted(now = false): void {
    if (!this.worker) return;
    if (!now) {
      this.wantedTimer ??= setTimeout(() => {
        this.wantedTimer = null;
        this.pushWanted(true);
      }, 500);
      return;
    }
    const state = this.deps.engine.state();
    for (const n of this.deps.nodes.list()) {
      const wanted = this.deps.wanted(state, n.everything);
      const key = JSON.stringify(wanted);
      if (this.sentWanted.get(n.id) === key) continue;
      this.sentWanted.set(n.id, key);
      this.worker.send({ type: 'media', nodeId: n.id, wanted });
    }
  }

  /** The library changed (media, playlists, presentations, props): each node's list again. */
  libraryChanged(): void {
    this.pushWanted();
  }

  // ---- engine messages ----------------------------------------------------------------------

  broadcast(message: EngineMessage): void {
    const at = this.deps.now();
    this.revs.push({ at, rev: message.rev });
    while (this.revs.length > 2 && (this.revs[1]?.at ?? at) < at - 10_000) this.revs.shift();
    if (!this.worker) return;
    this.worker.send({ type: 'engine', message });
    this.pushWanted();
    const onAir = this.deps.onAir();
    if (onAir !== this.onAirWas) this.rateChanged();
  }

  /** The stream went on or off air: copies go slower or faster. */
  rateChanged(): void {
    this.onAirWas = this.deps.onAir();
    this.worker?.send({ type: 'rate', bytesPerSecond: this.copyRate() });
  }

  private copyRate(): number {
    return this.deps.copyRateOverride ?? (this.deps.onAir() ? COPY_RATE_ON_AIR : COPY_RATE);
  }

  // ---- pairing ------------------------------------------------------------------------------

  private setOffer(offer: { code: string; expiresAt: number } | null): void {
    this.offer = offer;
    if (this.offerTimer) clearTimeout(this.offerTimer);
    this.offerTimer = null;
    if (offer)
      this.offerTimer = setTimeout(
        () => {
          this.offerTimer = null;
          this.offer = null;
          this.worker?.send({ type: 'offer', offer: null });
          this.updateWorker();
          this.changed();
        },
        offer.expiresAt - this.deps.now() + 50,
      );
    this.worker?.send({ type: 'offer', offer });
    this.updateWorker();
    this.changed();
  }

  startPairing(): NodesResult {
    const identity = this.deps.identity();
    if ('problem' in identity) {
      // Screens shows the problem, with Make a new identity…, from now on, even with no node paired.
      this.identityProblem = identity.problem;
      this.changed();
      return { ok: false, message: identity.problem };
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.setOffer({ code, expiresAt: this.deps.now() + NODE_PAIRING_TTL_MS });
    this.deps.log('info', 'Nodes: offering a code to pair a node');
    return { ok: true, status: this.status() };
  }

  /** An admin's choice (Session 23): a new identity, then the link starts; each node must be paired again. */
  newIdentity(): NodesResult {
    const identity = this.deps.identity();
    if (!('problem' in identity))
      return { ok: false, message: 'This computer’s identity for its nodes is fine: nothing to replace.' };
    try {
      this.deps.newIdentity();
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    this.deps.log(
      'info',
      'Nodes: a new identity was made, as an admin asked; each node must be paired again',
    );
    this.identityProblem = null;
    this.state = 'off';
    this.message = null;
    this.updateWorker();
    this.changed();
    return { ok: true, status: this.status() };
  }

  cancelPairing(): NodesResult {
    this.setOffer(null);
    return { ok: true, status: this.status() };
  }

  private paired(node: { name: string; tokenHash: string; address: string; version: string }): {
    id: string;
    name: string;
  } | null {
    try {
      const names = new Set(this.deps.nodes.list().map((n) => n.name));
      let name = node.name;
      for (let n = 2; names.has(name); n++) name = `${node.name} ${n}`;
      const row = this.deps.nodes.add({ ...node, name });
      this.deps.log('info', `Nodes: paired “${row.name}” from ${node.address}`);
      this.offer = null;
      if (this.offerTimer) clearTimeout(this.offerTimer);
      this.offerTimer = null;
      const l = this.liveOf(row.id);
      l.address = node.address;
      l.version = node.version;
      this.pushNodes();
      this.pushScreens(row.id);
      this.sentWanted.delete(row.id);
      this.pushWanted(true);
      this.changed();
      this.deps.screensChanged();
      return { id: row.id, name: row.name };
    } catch (error) {
      this.deps.log('warn', `Nodes: could not keep a new node (${(error as Error).message})`);
      return null;
    }
  }

  // ---- what the operator does ----------------------------------------------------------------

  rename(rawId: unknown, rawName: unknown): NodesResult {
    const id = idSchema.safeParse(rawId);
    const name = nodeNameSchema.safeParse(rawName);
    if (!name.success) return { ok: false, message: 'A node’s name needs 1 to 60 characters.' };
    if (!id.success || !this.deps.nodes.rename(id.data, name.data))
      return { ok: false, message: 'That node is no longer paired.' };
    this.pushNodes();
    this.changed();
    this.deps.screensChanged();
    return { ok: true, status: this.status() };
  }

  /** Remove a node: its token stops working, its connection is cut at once, and its screens go. */
  remove(rawId: unknown): NodesResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success) return { ok: false, message: 'That node is no longer paired.' };
    const label = this.label(id.data);
    if (!this.deps.nodes.remove(id.data)) return { ok: false, message: 'That node is no longer paired.' };
    this.live.delete(id.data);
    this.sentWanted.delete(id.data);
    this.unsaved.delete(id.data);
    this.deps.log('info', `Nodes: removed ${label}`);
    this.pushNodes();
    this.updateWorker();
    this.changed();
    this.deps.screensChanged();
    return { ok: true, status: this.status() };
  }

  setEverything(rawId: unknown, rawOn: unknown): NodesResult {
    const id = idSchema.safeParse(rawId);
    if (typeof rawOn !== 'boolean') return { ok: false, message: 'On or off?' };
    if (!id.success || !this.deps.nodes.setEverything(id.data, rawOn))
      return { ok: false, message: 'That node is no longer paired.' };
    this.deps.log(
      'info',
      `Nodes: ${this.label(id.data)} copies ${rawOn ? 'everything' : 'the week’s media'}`,
    );
    this.pushWanted(true);
    this.changed();
    return { ok: true, status: this.status() };
  }

  /** Show a display's number and name on it (null: on every display of the node). */
  identify(nodeId: string, displayId: number | null): void {
    const health = this.live.get(nodeId)?.health;
    const display = health?.displays.find((d) => d.id === displayId);
    const index = display && health ? health.displays.indexOf(display) + 1 : 0;
    this.worker?.send({
      type: 'to-node',
      nodeId,
      message: {
        type: 'identify',
        displayId,
        label: display ? `${index}: ${display.label || `Display ${index}`}` : '',
      },
    });
  }

  reload(nodeId: string, screenId: string): NodesResult {
    if (!this.live.get(nodeId)?.online) return { ok: false, message: 'That node is not connected.' };
    this.worker?.send({ type: 'to-node', nodeId, message: { type: 'reload', screenId } });
    this.deps.log('info', `Nodes: reloading a screen on ${this.label(nodeId)}`);
    return { ok: true, status: this.status() };
  }

  /** The dashboard is open (or closed): nodes send pictures of their screens while it is. */
  watch(on: boolean): void {
    if (on === this.watching) return;
    this.watching = on;
    this.worker?.send({ type: 'thumbs', everyMs: on ? THUMB_EVERY_MS : null });
  }

  get watched(): boolean {
    return this.watching;
  }

  // ---- what the windows read ------------------------------------------------------------------

  private info(n: NodeRow): NodeInfo {
    const l = this.live.get(n.id);
    return {
      id: n.id,
      name: n.name,
      pairedAt: n.pairedAt,
      online: l?.online ?? false,
      since: l?.since ?? null,
      lastSeenAt: l?.online
        ? new Date(this.deps.now()).toISOString()
        : (this.unsaved.get(n.id)?.at ?? n.lastSeenAt),
      address: l?.address ?? n.address,
      health: l?.health ?? null,
      latencyMs: l?.health?.clock ? Math.round(l.health.clock.rttMs * 10) / 10 : null,
      versionRefused: l?.refused ?? null,
      everything: n.everything,
      behindSince: l?.online && l.behindSince !== null ? new Date(l.behindSince).toISOString() : null,
    };
  }

  status(): NodesStatus {
    const known = this.worker || this.deps.nodes.list().length > 0 ? this.deps.identity() : null;
    const identity = known && !('problem' in known) ? known : null;
    return {
      state: this.state,
      port: this.boundPort ?? this.port,
      message: this.message,
      mainName: identity?.name ?? '',
      fingerprint: identity?.fingerprint ?? null,
      identityProblem: known && 'problem' in known ? known.problem : this.identityProblem,
      nodes: this.deps.nodes.list().map((n) => this.info(n)),
      main: { version: this.deps.version, outputs: this.deps.localOutputs() },
      pairing:
        this.offer && this.offer.expiresAt > this.deps.now()
          ? {
              code: this.offer.code,
              expiresAt: this.offer.expiresAt,
              addresses: this.deps.addresses(),
              port: this.boundPort ?? this.port,
            }
          : null,
    };
  }

  /** Each node with the displays it last reported, for Screens. */
  displays(): NodeDisplays[] {
    return this.deps.nodes.list().map((n) => ({
      id: n.id,
      name: n.name,
      online: this.live.get(n.id)?.online ?? false,
      displays: this.live.get(n.id)?.health?.displays ?? n.displays,
    }));
  }

  /** How the screens on nodes stand, for Screens. */
  screenStatus(): ScreenStatus[] {
    return this.deps.screens.allScreens().flatMap((s): ScreenStatus[] => {
      if (s.nodeId === null) return [];
      if (!s.enabled) return [{ screenId: s.id, state: 'disabled', displayId: null }];
      const l = this.live.get(s.nodeId);
      if (!l?.online) return [{ screenId: s.id, state: 'node-offline', displayId: null }];
      const out = l.health?.outputs.find((o) => o.screenId === s.id);
      return [
        out
          ? { screenId: s.id, state: out.state, displayId: out.displayId }
          : { screenId: s.id, state: 'missing-display', displayId: null },
      ];
    });
  }

  /**
   * The windows hear of it a moment later, once for everything in that
   * moment: with ten nodes reporting every two seconds, the operator window
   * would otherwise be told five times a second.
   */
  private changed(): void {
    // Quitting: nobody is told any more, and the status reads the library, which closes last (Session
    // 23: stopping the worker in close() set this timer again, and it read the closed library).
    if (this.closing) return;
    this.changeTimer ??= setTimeout(() => {
      this.changeTimer = null;
      this.deps.changed(this.status());
    }, CHANGE_COALESCE_MS);
  }

  private saveSeen(): void {
    if (this.unsaved.size === 0) return;
    const seen = new Map(this.unsaved);
    this.unsaved.clear();
    const write = this.deps.write ?? ((_key: string, run: () => void) => run());
    // Each batch on its own (a later one never replaces one still waiting).
    write(`nodes-seen:${String(++this.seenSaves)}`, () => {
      try {
        this.deps.nodes.touch(seen);
      } catch (error) {
        this.deps.log(
          'warn',
          `Nodes: could not keep when nodes were last seen (${(error as Error).message})`,
        );
      }
    });
  }

  /** The performance check: what the link has sent (and start counting again). */
  stats(reset: boolean): Promise<LinkStats | null> {
    const worker = this.worker;
    if (!worker) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.statsWaiters.push(resolve);
      worker.send({ type: 'stats', reset });
    });
  }

  /** The performance check: a paired node and its token, without the pairing dance. */
  pairForCheck(name: string): { id: string; token: string } {
    const token = newToken();
    const row = this.deps.nodes.add({
      name,
      tokenHash: hashToken(token),
      address: '127.0.0.1',
      version: this.deps.version,
    });
    this.pushNodes();
    this.updateWorker();
    return { id: row.id, token };
  }

  close(): Promise<void> {
    // Once (Session 17: at quit it could come again after the library had closed).
    if (this.closing) return this.stopping ?? Promise.resolve();
    this.closing = true;
    if (this.seenWriter) clearInterval(this.seenWriter);
    if (this.offerTimer) clearTimeout(this.offerTimer);
    if (this.wantedTimer) clearTimeout(this.wantedTimer);
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.saveSeen();
    return this.stopWorker();
  }
}
