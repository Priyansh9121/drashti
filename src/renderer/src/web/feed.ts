import { create } from 'zustand';
import type { EngineMessage } from '../../../shared/engine/protocol';
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
import { current, forgetPairing } from './device';

/*
 * The state feed, as a phone, tablet or browser follows it: the whole engine
 * state, then each change, over one WebSocket that says who this device is
 * first. It reconnects by itself (sooner when the phone wakes or its Wi-Fi
 * comes back), and keeps this device's clock in step with the engine's: the
 * shortest of several round trips says the most.
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

/** Follow the feed: this page's copy of the engine state, and the engine's clock. */
export function startFeed(): void {
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
