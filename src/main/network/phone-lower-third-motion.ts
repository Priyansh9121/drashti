import type { EngineMessage } from '../../shared/engine/protocol';
import type { EngineState, LowerThirdLayer } from '../../shared/engine/state';
import { NEAREST_ALPHA17_MOTION } from '../../shared/lower-third-styles';

function compatibleLayer(layer: LowerThirdLayer): LowerThirdLayer {
  const original = layer.look.motion;
  const motion = original === undefined ? undefined : NEAREST_ALPHA17_MOTION[original];
  return motion === undefined ? layer : { ...layer, look: { ...layer.look, motion } };
}

function compatibleExit(exit: EngineState['lowerThirdOff']): EngineState['lowerThirdOff'] {
  if (exit === null) return null;
  const layer = compatibleLayer(exit.layer);
  return layer === exit.layer ? exit : { ...exit, layer };
}

/** Project the live and leaving lower thirds for a phone or tablet page still running alpha.17 code. */
export function engineForAlpha17Phone(message: EngineMessage, state: EngineState): EngineMessage {
  const { lowerThird } = state.layers;
  if (message.kind === 'snapshot') {
    const live = lowerThird && compatibleLayer(lowerThird);
    const leaving = compatibleExit(state.lowerThirdOff);
    if (live === lowerThird && leaving === state.lowerThirdOff) return message;
    return {
      ...message,
      state: { ...state, layers: { ...state.layers, lowerThird: live }, lowerThirdOff: leaving },
    };
  }

  // engineDescend sends each changed layer whole. Keep all other ops and the original revision.
  let ops: typeof message.ops | undefined;
  for (const [i, op] of message.ops.entries()) {
    const [field, layer] = op.path;
    if (op.path.length === 2 && field === 'layers' && layer === 'lowerThird' && lowerThird) {
      const value = compatibleLayer(lowerThird);
      if (value !== lowerThird) (ops ??= message.ops.slice())[i] = { ...op, value };
    }
    if (op.path.length === 1 && field === 'lowerThirdOff') {
      const value = compatibleExit(state.lowerThirdOff);
      if (value !== state.lowerThirdOff) (ops ??= message.ops.slice())[i] = { ...op, value };
    }
  }
  return ops ? { ...message, ops } : message;
}
