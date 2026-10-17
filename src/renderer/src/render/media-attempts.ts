import { create } from 'zustand';
import type { DrashtiBridge } from '../../../shared/bridge';

/*
 * On a node (Session 13), a screen can ask for a picture or video before
 * its copy has arrived, and be told it is not there (Main could not be
 * reached, say). When the copy lands later, the node says so: each file's
 * count goes up, and whatever draws it loads it again. In Main's windows and
 * on phones nothing ever arrives late, and the count stays 0.
 */

const useAttempts = create<Record<string, number>>(() => ({}));

let watching = false;

/** Follow the node's word that copies have landed (once per page; output windows only). */
export function watchMediaReady(): void {
  if (watching) return;
  watching = true;
  const bridge = (globalThis as { drashti?: DrashtiBridge }).drashti;
  bridge?.output.onMediaReady((mediaId) => {
    useAttempts.setState((s) => ({ [mediaId]: (s[mediaId] ?? 0) + 1 }));
  });
}

/** How many times this file's copy has landed since the page opened (a key that changes when it does). */
export function useMediaAttempt(mediaId: string): number {
  return useAttempts((s) => s[mediaId] ?? 0);
}

/*
 * A GPU process that stops (Sessions 31–36, ROB-5) takes with it the decoders of the videos playing: macOS
 * and Windows decode H.264 there, and each such video fails ("video decode error"). Chromium starts another
 * GPU process by itself, and Main says so: each video that failed loads again (a new address, as Chromium
 * keeps a failed one in mind for a while) and plays from the engine's time, as it would have.
 */

const useGpu = create<{ restarts: number }>(() => ({ restarts: 0 }));

let watchingGpu = false;

/** Follow Main's word that the GPU process started again (once per page). */
export function watchGpuRestarts(): void {
  if (watchingGpu) return;
  watchingGpu = true;
  const bridge = (globalThis as { drashti?: DrashtiBridge }).drashti;
  bridge?.output.onGpuRestarted(() => {
    useGpu.setState((s) => ({ restarts: s.restarts + 1 }));
  });
}

/** How many times the GPU process has started again since the page opened. */
export function useGpuRestarts(): number {
  return useGpu((s) => s.restarts);
}
