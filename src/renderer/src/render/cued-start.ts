import type { EngineState } from '../../../shared/engine/state';

/** Retain the drawn scene locally, without sending its layers twice through the engine. */
export class CuedStartKeeper {
  at(state: EngineState | null, _now: number): EngineState | null {
    return state;
  }
}
