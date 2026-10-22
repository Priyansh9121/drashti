import { useEffect, useSyncExternalStore } from 'react';

/*
 * A video input in the picture-in-picture box (Session 50), as a page opens it: found by the device's name as
 * this computer gives it (its label), video only, never sound; once per page however many pictures of the show
 * it draws (an output draws one; the operator window draws LIVE and Screens' cards), and let go a moment after
 * its last picture goes. Unplugged, or not there yet, it is tried again when the computer's devices change.
 * Session 50: section 1's video input background opens its inputs the same way; at merge the two become one.
 */

export type InputState = 'opening' | 'live' | 'missing' | 'refused' | 'ended';

export interface InputCapture {
  stream: MediaStream | null;
  state: InputState;
}

interface Entry {
  device: string;
  /** How it stands now: a new object at each change, for React. */
  view: InputCapture;
  users: number;
  /** Let go a moment after its last picture goes, so a picture drawn again at once keeps the input open. */
  release: ReturnType<typeof setTimeout> | null;
}

const OPENING: InputCapture = { stream: null, state: 'opening' };
const RELEASE_MS = 2000;
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function set(entry: Entry, view: InputCapture): void {
  entry.view = view;
  for (const listener of listeners) listener();
}

const stop = (stream: MediaStream | null) => {
  for (const track of stream?.getTracks() ?? []) track.stop();
};

async function open(entry: Entry): Promise<void> {
  const media = (navigator as Partial<Navigator>).mediaDevices;
  if (!media) {
    set(entry, { stream: null, state: 'refused' });
    return;
  }
  const devices = await media.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  const id = devices.find((d) => d.kind === 'videoinput' && d.label === entry.device)?.deviceId;
  if (entries.get(entry.device) !== entry) return;
  if (!id) {
    set(entry, { stream: null, state: 'missing' });
    return;
  }
  let stream: MediaStream;
  try {
    stream = await media.getUserMedia({
      video: {
        deviceId: { exact: id },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (entries.get(entry.device) === entry)
      set(entry, {
        stream: null,
        state: name === 'NotAllowedError' || name === 'SecurityError' ? 'refused' : 'missing',
      });
    return;
  }
  // Gone while it opened: let it go at once.
  if (entries.get(entry.device) !== entry) {
    stop(stream);
    return;
  }
  const opened = stream;
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (entries.get(entry.device) !== entry || entry.view.stream !== opened) return;
    stop(opened);
    set(entry, { stream: null, state: 'ended' });
  });
  set(entry, { stream: opened, state: 'live' });
}

let watching = false;

/** An input unplugged or not found is tried again when the computer's cameras and capture inputs change. */
function watchDevices(): void {
  const media = (navigator as Partial<Navigator>).mediaDevices;
  if (watching || !media) return;
  watching = true;
  media.addEventListener('devicechange', () => {
    for (const entry of entries.values())
      if (entry.view.state === 'missing' || entry.view.state === 'ended') {
        set(entry, OPENING);
        void open(entry);
      }
  });
}

function hold(device: string): () => void {
  let entry = entries.get(device);
  if (!entry) {
    entry = { device, view: OPENING, users: 0, release: null };
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
    // eslint-disable-next-line no-restricted-syntax -- an input let go a moment after its last picture, never a frame of the show
    held.release = setTimeout(() => {
      if (held.users > 0 || entries.get(device) !== held) return;
      entries.delete(device);
      stop(held.view.stream);
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

/** The video input named `device` (its label on this computer) while a picture of the show draws it. */
export function useInputStream(device: string): InputCapture {
  useEffect(() => hold(device), [device]);
  return useSyncExternalStore(subscribe, () => entries.get(device)?.view ?? OPENING);
}
