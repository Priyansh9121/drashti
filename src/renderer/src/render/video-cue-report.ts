import type { DrashtiBridge } from '../../../shared/bridge';

export function reportVideoCue(cueId: string | undefined, kind: 'picture' | 'sound', ready: boolean): void {
  const bridge = (globalThis as { drashti?: Partial<DrashtiBridge> }).drashti;
  if (cueId && bridge?.engine?.videoCueReady) void bridge.engine.videoCueReady(cueId, kind, ready).catch(() => undefined);
}
