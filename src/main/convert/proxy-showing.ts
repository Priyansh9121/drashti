import type { EngineState } from '../../shared/engine/state';
export interface ProxyShowingResult {
  state?: EngineState;
  message?: string;
}
/** Called after saved edit resolution; proxy time is identical to its full-quality rendition. */
export function prepareVideoProxies(
  _previous: EngineState,
  next: EngineState,
  _ready: (id: string) => { mediaId: string | null; message: string | null },
  _restoring = false,
): ProxyShowingResult {
  return { state: next };
}
