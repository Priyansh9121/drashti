/** The one silent graph of this page that a cued picture's sound is pulled by (made on first use). */
export interface SilentGraph {
  readonly context: AudioContext;
  /** Where each routed picture's sound goes: a gain of nothing into a sink with no device. */
  readonly sink: AudioNode;
}

/** Not yet (the red): no graph. */
export function createSilentGraph(_make: (options: AudioContextOptions) => AudioContext): SilentGraph | null {
  return null;
}

/** A cued picture's clock (S5, QA21-S5-1). Not yet: the picture stays muted, on its sound renderer's own clock. */
export function cueClock(_v: HTMLMediaElement, _graph: () => SilentGraph | null = () => null): () => void {
  return () => undefined;
}
