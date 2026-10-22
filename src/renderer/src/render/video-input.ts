import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DrashtiBridge } from '../../../shared/bridge';
import type { InputBackground } from '../../../shared/engine/state';
import {
  findInputDevice,
  type InputCaptureState,
  reportOf,
  retryAfterMs,
  type StopReason,
  stopReasonOf,
} from './video-input-state';

/*
 * A video input (Session 50) as a page opens it: once per page per input, however many pictures the page draws
 * of it (an output draws one; the operator window draws LIVE, Screens' cards and Media's small pictures), shared
 * by all of them, and closed a moment after the last one goes. Video only: never a microphone. The input is
 * found by its name among this computer's cameras and capture inputs (render/video-input-state.ts). When it stops
 * (unplugged, or taken by another app) the screens keep its last picture and the page says so; it is opened
 * again by itself as the computer's devices change, or a little later. A page whose computer does not have the
 * input up now (a node's screens: it is on Main's computer) never opens a camera, and draws nothing for it.
 */

export interface InputCapture {
  /** Its picture: live, or the one that stopped (whose last frame the screens keep). */
  stream: MediaStream | null;
  state: InputCaptureState;
  /** Why it has no live picture, while stopped. */
  reason: StopReason | null;
}

/** How big and how often this page opens it: a hall screen's full picture, the operator window's small ones. */
export interface InputSize {
  width: number;
  height: number;
  frameRate: number;
}

interface Entry {
  /** The input's name as this computer gives it (its label). */
  device: string;
  /** How it stands now: a new object at each change, for React. */
  view: InputCapture;
  users: number;
  /** Let go a moment after its last picture goes, so a picture drawn again at once keeps the capture. */
  release: ReturnType<typeof setTimeout> | null;
  /** Tried again by itself after it stopped. */
  retry: ReturnType<typeof setTimeout> | null;
  opening: boolean;
}

let size: InputSize = { width: 1920, height: 1080, frameRate: 30 };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const OPENING: InputCapture = { stream: null, state: 'opening', reason: null };
const ABSENT: InputCapture = { stream: null, state: 'absent', reason: null };
const RELEASE_MS = 2000;

const wanted = (): MediaTrackConstraints => ({
  width: { ideal: size.width },
  height: { ideal: size.height },
  frameRate: { ideal: size.frameRate },
});

/** This page's size of capture (the operator window's pictures are small; the stream's page asks for the stream's). */
export function setVideoInputSize(next: InputSize): void {
  if (next.width === size.width && next.height === size.height && next.frameRate === size.frameRate) return;
  size = next;
  for (const entry of entries.values())
    for (const track of entry.view.stream?.getVideoTracks() ?? [])
      if (track.readyState === 'live') void track.applyConstraints(wanted()).catch(() => undefined);
}

function changed(): void {
  for (const listener of listeners) listener();
}

function set(entry: Entry, view: InputCapture): void {
  entry.view = view;
  changed();
}

const current = (entry: Entry): boolean => entries.get(entry.device) === entry;

function stopTracks(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function holdBack(entry: Entry): void {
  if (entry.retry) clearTimeout(entry.retry);
  entry.retry = null;
}

/** It has no live picture: the one it had stays (`stream`), and it is tried again by itself in a little while. */
function stopped(entry: Entry, stream: MediaStream | null, reason: StopReason): void {
  set(entry, { stream, state: 'stopped', reason });
  holdBack(entry);
  const ms = retryAfterMs(reason);
  if (ms === null) return;
  // eslint-disable-next-line no-restricted-syntax -- a stopped input tried again a little later: never a frame of the show
  entry.retry = setTimeout(() => {
    entry.retry = null;
    void open(entry);
  }, ms);
}

async function open(entry: Entry): Promise<void> {
  if (entry.opening || !current(entry)) return;
  entry.opening = true;
  holdBack(entry);
  let stream: MediaStream | null = null;
  let reason: StopReason = 'busy';
  try {
    const id = findInputDevice(await navigator.mediaDevices.enumerateDevices(), entry.device);
    if (id === null) reason = 'missing';
    else
      stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: id }, ...wanted() },
        audio: false,
      });
  } catch (error) {
    reason = stopReasonOf(error);
  }
  entry.opening = false;
  // Let go while it opened: closed at once.
  if (!current(entry)) {
    stopTracks(stream);
    return;
  }
  const track = stream?.getVideoTracks()[0];
  if (!stream || track?.readyState !== 'live') {
    stopTracks(stream);
    stopped(entry, entry.view.stream, reason);
    return;
  }
  const live = stream;
  // What it had before (stopped) goes: the new picture takes its place.
  if (entry.view.stream !== live) stopTracks(entry.view.stream);
  const mine = () => current(entry) && entry.view.stream === live;
  track.addEventListener('ended', () => {
    if (mine()) stopped(entry, live, 'ended');
  });
  // Its frames paused (another app took it, a capture card lost its signal): kept as it was until they come back.
  track.addEventListener('mute', () => {
    if (mine() && entry.view.state === 'live') stopped(entry, live, 'muted');
  });
  track.addEventListener('unmute', () => {
    if (mine() && entry.view.reason === 'muted') set(entry, { stream: live, state: 'live', reason: null });
  });
  if (track.muted) stopped(entry, live, 'muted');
  else set(entry, { stream: live, state: 'live', reason: null });
}

let watching = false;

/** Plugged in again: a stopped input is opened again at once. */
function watchDevices(): void {
  if (watching) return;
  watching = true;
  navigator.mediaDevices.addEventListener('devicechange', () => {
    for (const entry of entries.values())
      if (entry.view.state === 'stopped' && entry.view.reason !== 'muted') void open(entry);
  });
}

function hold(device: string): () => void {
  let entry = entries.get(device);
  if (!entry) {
    entry = { device, view: OPENING, users: 0, release: null, retry: null, opening: false };
    entries.set(device, entry);
    watchDevices();
    void open(entry);
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
      if (held.users > 0 || !current(held)) return;
      entries.delete(device);
      holdBack(held);
      stopTracks(held.view.stream);
      changed();
    }, RELEASE_MS);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * One of this computer's inputs, by its name, while a picture of it is drawn (Media's small pictures, Add a
 * Video Input…, and the input up now): its picture, and how it stands. Null opens nothing.
 */
export function useInputCapture(device: string | null): InputCapture {
  useEffect(() => (device === null ? undefined : hold(device)), [device]);
  return useSyncExternalStore(subscribe, () =>
    device === null ? ABSENT : (entries.get(device)?.view ?? OPENING),
  );
}

/** The bridge's own group, where this page has it (a phone's page has no bridge at all). */
function videoInputsBridge(): Partial<DrashtiBridge>['videoInputs'] {
  const bridge = (globalThis as { drashti?: DrashtiBridge }).drashti;
  return bridge?.videoInputs;
}

const here = new Map<string, Promise<boolean>>();

/** Whether this computer's list has the input (a node's has none of Main's): asked once per page per input. */
function onThisComputer(inputId: string): Promise<boolean> {
  const known = here.get(inputId);
  if (known) return known;
  const inputs = videoInputsBridge();
  const asked = inputs
    ? inputs.list().then(
        (view) => view.inputs.some((i) => i.id === inputId),
        () => {
          // Not answered: asked again by the next picture of it.
          here.delete(inputId);
          return false;
        },
      )
    : Promise.resolve(false);
  here.set(inputId, asked);
  return asked;
}

/**
 * The video input up now, for a picture of the show: its capture on this page, or absent where this computer
 * does not have it (a node's screens), which opens nothing.
 */
export function useVideoInput(input: Pick<InputBackground, 'inputId' | 'device'>): InputCapture {
  const { inputId, device } = input;
  const [answer, setAnswer] = useState<{ inputId: string; here: boolean } | null>(null);
  useEffect(() => {
    let on = true;
    void onThisComputer(inputId).then((yes) => {
      if (on) setAnswer({ inputId, here: yes });
    });
    return () => {
      on = false;
    };
  }, [inputId]);
  const known = answer?.inputId === inputId ? answer.here : null;
  const capture = useInputCapture(known === true ? device : null);
  if (known === null) return OPENING;
  return known ? capture : ABSENT;
}

/** What this page last said of each input up now, and how many of its pictures draw it. */
const said = new Map<string, 'playing' | 'stopped'>();
const saying = new Map<string, number>();

/**
 * Say how the input up now stands on this page (it plays, or it stopped): once for each change, however many
 * pictures of it the page draws. A picture going away (dissolving out) says nothing.
 */
export function useInputReport(inputId: string, state: InputCaptureState, on: boolean): void {
  const report = on ? reportOf(state) : null;
  useEffect(() => {
    if (report === null) return;
    saying.set(inputId, (saying.get(inputId) ?? 0) + 1);
    if (said.get(inputId) !== report) {
      said.set(inputId, report);
      void videoInputsBridge()
        ?.report({ inputId, state: report })
        .catch(() => null);
    }
    return () => {
      const left = (saying.get(inputId) ?? 1) - 1;
      if (left > 0) {
        saying.set(inputId, left);
        return;
      }
      saying.delete(inputId);
      said.delete(inputId);
    };
  }, [inputId, report]);
}
