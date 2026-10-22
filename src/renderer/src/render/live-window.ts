import { useEffect, useSyncExternalStore } from 'react';
import type { DrashtiBridge } from '../../../shared/bridge';
import type { WindowBackground } from '../../../shared/engine/state';

/*
 * Another app's window as the background (Session 48), as a screen's page captures it: once per page,
 * however many pictures of the show the page draws (an output draws one; the operator window draws LIVE,
 * Screens' cards and the mask editor), shared by every one of them. The page never names what it captures:
 * it asks the main process for the window up now, and its next request for a screen's picture is given that
 * window (src/main/live-window/). A page whose main process cannot give it (a node's screens: the window is
 * on Main's computer) draws nothing for it.
 */

export type LiveWindowState = 'asking' | 'live' | 'ended' | 'refused';

interface Capture {
  stream: MediaStream | null;
  state: LiveWindowState;
}

interface Entry {
  sourceId: string;
  /** How it stands now: a new object at each change, for React. */
  view: Capture;
  users: number;
  /** Let go a moment after its last picture goes, so a picture drawn again at once keeps the capture. */
  release: ReturnType<typeof setTimeout> | null;
}

/** How big and how often this page captures it: a hall screen's full picture, the operator window's small ones. */
export interface CaptureSize {
  width: number;
  height: number;
  frameRate: number;
}

let size: CaptureSize = { width: 1920, height: 1080, frameRate: 30 };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const ASKING: Capture = { stream: null, state: 'asking' };
const RELEASE_MS = 2000;

/** This page's size of capture (the operator window's are small; the stream's page asks for the stream's). */
export function setLiveWindowSize(next: CaptureSize): void {
  size = next;
}

let turn: Promise<unknown> = Promise.resolve();

/**
 * A page's requests for a screen's picture, one after another: the stream's page also captures its own
 * picture, and the main process gives each request what the page asked for last (src/main/live-window/).
 */
export function inTurn<T>(request: () => Promise<T>): Promise<T> {
  const next = turn.then(request, request);
  turn = next.catch(() => undefined);
  return next;
}

const keyOf = (layer: Pick<WindowBackground, 'sourceId' | 'startedAt'>): string =>
  `${layer.sourceId}@${String(layer.startedAt)}`;

function set(entry: Entry, view: Capture): void {
  entry.view = view;
  for (const listener of listeners) listener();
}

/** The bridge's own group, where this page has it (a phone's page has no bridge at all). */
function liveWindowBridge(): Partial<DrashtiBridge>['liveWindow'] {
  const bridge = (globalThis as { drashti?: DrashtiBridge }).drashti;
  return bridge?.liveWindow;
}

async function begin(key: string, entry: Entry): Promise<void> {
  const ask = liveWindowBridge();
  let stream: MediaStream | null;
  try {
    stream = ask
      ? await inTurn(async () => {
          if (!(await ask.ask(entry.sourceId))) return null;
          return navigator.mediaDevices.getDisplayMedia({
            video: {
              width: { max: size.width },
              height: { max: size.height },
              frameRate: { max: size.frameRate },
            },
            audio: false,
          });
        })
      : null;
  } catch {
    stream = null;
  }
  // Gone while it was asked for: let it go at once.
  if (entries.get(key) !== entry) {
    for (const track of stream?.getTracks() ?? []) track.stop();
    return;
  }
  const track = stream?.getVideoTracks()[0];
  if (!stream || !track) {
    set(entry, { stream: null, state: 'refused' });
    return;
  }
  const live = stream;
  track.addEventListener('ended', () => {
    if (entries.get(key) !== entry) return;
    set(entry, { stream: live, state: 'ended' });
    void ask?.ended(entry.sourceId).catch(() => null);
  });
  set(entry, { stream: live, state: track.readyState === 'ended' ? 'ended' : 'live' });
}

function hold(layer: Pick<WindowBackground, 'sourceId' | 'startedAt'>): () => void {
  const key = keyOf(layer);
  let entry = entries.get(key);
  if (!entry) {
    entry = { sourceId: layer.sourceId, view: ASKING, users: 0, release: null };
    entries.set(key, entry);
    void begin(key, entry);
  }
  const held = entry;
  held.users++;
  if (held.release) clearTimeout(held.release);
  held.release = null;
  return () => {
    held.users--;
    if (held.users > 0) return;
    // eslint-disable-next-line no-restricted-syntax -- a capture let go a moment after its last picture, never a frame of the show
    held.release = setTimeout(() => {
      if (held.users > 0 || entries.get(key) !== held) return;
      entries.delete(key);
      for (const track of held.view.stream?.getTracks() ?? []) track.stop();
      for (const listener of listeners) listener();
    }, RELEASE_MS);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The window's capture for a picture of the show while it is drawn: its stream, and how it stands. */
export function useLiveWindow(layer: Pick<WindowBackground, 'sourceId' | 'startedAt'>): Capture {
  const key = keyOf(layer);
  const { sourceId, startedAt } = layer;
  useEffect(() => hold({ sourceId, startedAt }), [sourceId, startedAt]);
  return useSyncExternalStore(subscribe, () => entries.get(key)?.view ?? ASKING);
}
