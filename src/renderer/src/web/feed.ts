import { create } from 'zustand';
import type { EngineMessage } from '../../../shared/engine/protocol';
import { ENGINE_STATE_VERSION } from '../../../shared/engine/state';
import {
  type ByeReason,
  clockOffset,
  type DeviceKind,
  FEED_PATH,
  type FromDevice,
  type NetworkChange,
  type ToDevice,
} from '../../../shared/network';
import { connectEngineSource } from '../engine/engine-store';
import { setClockOffset } from '../render/clock';
import { current, forgetPairing, paired } from './device';
import { shouldReload } from './new-version';

/*
 * The state feed, as a phone, tablet or browser follows it: the whole engine
 * state, then each change, over one WebSocket that says who this device is
 * first. It reconnects by itself (sooner when the phone wakes or its Wi-Fi
 * comes back), and keeps this device's clock in step with the engine's: the
 * shortest of several round trips says the most. After Drashti is updated to
 * a version whose state this page cannot read, the page loads itself again
 * (Session 53, new-version.ts).
 */

export type FeedState = 'connecting' | 'online' | 'offline';

interface FeedView {
  state: FeedState;
  /** Why it is not connected, in words. */
  reason: string | null;
  device: { name: string; kind: DeviceKind } | null;
  /** When it tries again (ms since the epoch), while offline. */
  retryAt: number | null;
}

export const useFeed = create<FeedView>(() => ({
  state: 'connecting',
  reason: null,
  device: null,
  retryAt: null,
}));

const WAITS_MS = [1000, 2000, 4000, 8000];
const CLOCK_EVERY_MS = 30_000;

const changeListeners = new Set<(what: NetworkChange) => void>();

/** Lists this page shows changed in Drashti (playlists, templates...): read them again. */
export function onListsChanged(listener: (what: NetworkChange) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** Called each time the feed is (back) online, so a page can read its lists again. */
const onlineListeners = new Set<() => void>();
export function onOnline(listener: () => void): () => void {
  onlineListeners.add(listener);
  return () => onlineListeners.delete(listener);
}

let socket: WebSocket | null = null;
let engine: ((message: EngineMessage) => void) | null = null;
let attempt = 0;
let retry: ReturnType<typeof setTimeout> | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
let bye: ByeReason | null = null;
let samples: { t0: number; t1: number; server: number }[] = [];

function send(message: FromDevice): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

/** Pairing is gone (removed in Drashti, or never was): pair again. */
function unpaired(reason: ByeReason): void {
  forgetPairing();
  location.replace(`/pair?why=${reason}`);
}

function ping(): void {
  send({ type: 'clock', t0: Date.now() });
}

/** When this tab last loaded its page again for a new version (Session 53). */
const RELOADED_KEY = 'drashti.reloadedForVersion';
/** The same, where the browser keeps nothing for the tab: then at most once on this page load. */
let reloadedAt: number | null = null;

function lastReload(): number | null {
  try {
    const kept = sessionStorage.getItem(RELOADED_KEY);
    const at = kept === null ? NaN : Number(kept);
    return Number.isFinite(at) ? at : reloadedAt;
  } catch {
    return reloadedAt;
  }
}

/**
 * The feed's engine state is of a version this page's code cannot read: Drashti was updated while it was open
 * (Session 53). The page loads itself again, the new version's, at most once a minute (new-version.ts says why).
 */
function reloadForNewVersion(version: unknown): void {
  const now = Date.now();
  if (!shouldReload({ version, pairingKept: paired() !== null, now, last: lastReload() })) return;
  reloadedAt = now;
  try {
    sessionStorage.setItem(RELOADED_KEY, String(now));
  } catch {
    // Not kept: at most once on this page load.
  }
  location.reload();
}

function startClock(): void {
  samples = [];
  for (let i = 0; i < 5; i++) setTimeout(ping, i * 150);
  if (clock) clearInterval(clock);
  clock = setInterval(ping, CLOCK_EVERY_MS);
}

function receive(message: ToDevice): void {
  switch (message.type) {
    case 'welcome':
      attempt = 0;
      useFeed.setState({ state: 'online', reason: null, device: message.device, retryAt: null });
      startClock();
      for (const l of onlineListeners) l();
      return;
    case 'engine':
      // One this page cannot read means Drashti was updated: its copy would stay the old picture for good.
      if (message.message.version !== ENGINE_STATE_VERSION) reloadForNewVersion(message.message.version);
      engine?.(message.message);
      return;
    case 'clock': {
      samples.push({ t0: message.t0, t1: Date.now(), server: message.server });
      if (samples.length > 8) samples.shift();
      const offset = clockOffset(samples);
      if (offset !== null) setClockOffset(offset);
      return;
    }
    case 'changed':
      for (const l of changeListeners) l(message.what);
      return;
    case 'bye':
      bye = message.reason;
      return;
  }
}

function scheduleReconnect(reason: string): void {
  const wait = WAITS_MS[Math.min(attempt, WAITS_MS.length - 1)] ?? 8000;
  attempt++;
  useFeed.setState({ state: 'offline', reason, retryAt: Date.now() + wait });
  if (retry) clearTimeout(retry);
  retry = setTimeout(open, wait);
}

function open(): void {
  retry = null;
  const device = current();
  if (!device) {
    unpaired('unauthorized');
    return;
  }
  bye = null;
  if (useFeed.getState().state !== 'online') useFeed.setState({ state: 'connecting', retryAt: null });
  const ws = new WebSocket(`ws://${location.host}${FEED_PATH}`);
  socket = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'hello', token: device.token } satisfies FromDevice));
  };
  ws.onmessage = (event) => {
    try {
      receive(JSON.parse(String(event.data)) as ToDevice);
    } catch {
      // Not ours: ignored.
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    if (clock) clearInterval(clock);
    clock = null;
    if (bye === 'revoked' || bye === 'unauthorized' || bye === 'not-allowed') {
      unpaired(bye);
      return;
    }
    scheduleReconnect(
      bye === 'network-off'
        ? 'Drashti’s network was turned off.'
        : bye === 'too-slow'
          ? 'The connection was too slow to keep up.'
          : 'Not connected to Drashti.',
    );
  };
}

/** Try now (the phone woke up, or its Wi-Fi came back). */
function reconnectNow(): void {
  if (socket || useFeed.getState().state === 'online') return;
  if (retry) clearTimeout(retry);
  open();
}

let following = false;

/** Follow the feed: this page's copy of the engine state, and the engine's clock. Once per page. */
export function startFeed(): void {
  if (following) return;
  following = true;
  connectEngineSource({
    onMessage: (listener) => {
      engine = listener;
    },
    resync: () => {
      send({ type: 'resync' });
    },
  });
  open();
  window.addEventListener('online', reconnectNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconnectNow();
  });
}
