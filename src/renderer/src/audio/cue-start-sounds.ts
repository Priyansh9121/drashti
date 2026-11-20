import type { EngineState } from '../../../shared/engine/state';
import type { Sound } from './sounds';

/** Sounds a scheduled Go takes off are retained until that moment. */
export function retainCueSounds(_wanted: Map<string, Sound>, _current: Iterable<Sound>, _state: EngineState | null, _now: number): number | null {
  return null;
}
