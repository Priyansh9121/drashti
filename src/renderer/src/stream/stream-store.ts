import { create } from 'zustand';
import type { StreamProfiles, StreamStatus } from '../../../shared/stream';

/*
 * The stream as the operator window sees it: its status (on air, recording,
 * health, inputs), the profiles, and the Program's preview.
 */

interface StreamStore {
  status: StreamStatus | null;
  profiles: StreamProfiles | null;
  /** The Stream panel and the settings. */
  panelOpen: boolean;
  settingsOpen: boolean;
  /** A message after something the operator asked for did not happen. */
  error: string | null;
}

export const useStream = create<StreamStore>(() => ({
  status: null,
  profiles: null,
  panelOpen: false,
  settingsOpen: false,
  error: null,
}));

let connected = false;

/** Follow the stream's status (once per window). */
export function connectStream(): void {
  if (connected) return;
  connected = true;
  window.drashti.stream.onChanged((status) => {
    const before = useStream.getState().status?.profilesVersion;
    useStream.setState({ status });
    // A profile or a key changed (here or elsewhere): read the profiles again.
    if (before !== undefined && before !== status.profilesVersion) void loadProfiles();
  });
  void window.drashti.stream.status().then((status) => {
    useStream.setState({ status });
  });
}

export async function loadProfiles(): Promise<void> {
  useStream.setState({ profiles: await window.drashti.stream.profiles() });
}

/** Run a stream request; a refusal is shown as the panel's error. */
export async function streamAction<T extends { ok: true } | { ok: false; message: string }>(
  run: () => Promise<T>,
): Promise<T> {
  const result = await run();
  useStream.setState({ error: result.ok ? null : result.message });
  if (result.ok && 'profiles' in result) useStream.setState({ profiles: result.profiles as StreamProfiles });
  if (result.ok && 'status' in result) useStream.setState({ status: result.status as StreamStatus });
  return result;
}

export function openStreamPanel(): void {
  useStream.setState({ panelOpen: true, error: null });
}

export function closeStreamPanel(): void {
  useStream.setState({ panelOpen: false, error: null });
}

let watching = 0;

/**
 * Keep the Program running while something here needs it (the preview, the
 * device lists in the settings). Returns a function that lets go. Each call
 * also asks for a fresh preview port (the main process hands one over each
 * time), for the preview that has just started listening.
 */
export function watchProgram(): () => void {
  watching++;
  void window.drashti.stream.watchPreview(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    watching--;
    if (watching === 0) void window.drashti.stream.watchPreview(false);
  };
}
