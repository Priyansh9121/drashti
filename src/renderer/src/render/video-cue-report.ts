import type { DrashtiBridge } from '../../../shared/bridge';

export function reportVideoCue(cueId: string | undefined, kind: 'picture' | 'sound', ready: boolean): void {
  const bridge = (globalThis as { drashti?: Partial<DrashtiBridge> }).drashti;
  if (cueId && bridge?.engine?.videoCueReady)
    void bridge.engine.videoCueReady(cueId, kind, ready).catch(() => undefined);
}

/** A display returning without a page reload still has this decoded paused frame. */
export function reportLoadedVideoCue(
  cueId: string | undefined,
  kind: 'picture' | 'sound',
  media: HTMLMediaElement,
): void {
  if (
    !cueId ||
    media.error ||
    media.seeking ||
    !media.paused ||
    media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
  )
    return;
  if (kind === 'picture' && 'videoWidth' in media && media.videoWidth === 0) return;
  reportVideoCue(cueId, kind, true);
}
