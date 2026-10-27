import { type EngineState, isLayerEmpty } from '../../../../shared/engine/state';
import { KEYMAP, type OperatorAction, shortcutText, withoutSingleKeys } from '../../../../shared/keymap';
import type { RemoteKeys } from '../../../../shared/network-mirror';
import { type ClearedLayer, LAYER_CLEARS } from '../../operator/layer-clears';

/*
 * The phone's clears (Session 54, D5): the operator window's bottom bar (LayerBar.tsx), in its order, left to
 * right: Clear all F1 (Put it back in its place while it is offered), the layers' clears F2 to F8
 * (layer-clears.ts), then the Logo and Black-out. Each names the key the window answers now, as its buttons do
 * (useKeymapNow): with the single-letter keys off, Black-out has none and the Logo keeps F12. The phone has no keys
 * of its own: the names are the desktop's, so the operator and whoever holds the phone speak of the same buttons.
 */

export interface RemoteClear {
  action: OperatorAction | 'putBack';
  /** The layer it clears, for one layer's clear. */
  layer?: ClearedLayer;
  /** Its words on the phone, as the desktop's button has them. */
  words: string;
  /** Its key as the window writes it, or '' for none. */
  key: string;
  /** A layer's clear: its layer has something up; Clear all: anything is up; the Logo and Black-out: on. */
  lit: boolean;
}

/** The keys the window answers before the phone has asked: every key, as a window starts. */
const START: RemoteKeys = { platform: 'darwin', singleKeys: true };

export function remoteClears(state: EngineState | null, keys: RemoteKeys | null): RemoteClear[] {
  const { platform, singleKeys } = keys ?? START;
  const keymap = singleKeys ? KEYMAP : withoutSingleKeys(KEYMAP);
  const key = (action: OperatorAction) => shortcutText(action, platform, keymap);
  const layers = state?.layers;
  // A lower third up counts too, and the picture-in-picture box: Clear all takes them off with the rest.
  const anything = layers
    ? LAYER_CLEARS.some((c) => !isLayerEmpty(layers, c.layer)) ||
      layers.lowerThird !== null ||
      layers.pip !== null
    : false;
  const logoOn = state?.logo != null;
  const blackout = state?.blackout ?? false;
  return [
    state?.canPutBack
      ? { action: 'putBack', words: 'Put it back', key: '', lit: true }
      : { action: 'clearAll', words: 'Clear all', key: key('clearAll'), lit: anything },
    ...LAYER_CLEARS.map((c) => ({
      action: c.action,
      layer: c.layer,
      words: c.label,
      key: key(c.action),
      lit: layers ? !isLayerEmpty(layers, c.layer) : false,
    })),
    { action: 'toggleLogo', words: logoOn ? 'Logo is on' : 'Logo', key: key('toggleLogo'), lit: logoOn },
    {
      action: 'toggleBlackout',
      words: blackout ? 'Black-out is on' : 'Black-out',
      key: key('toggleBlackout'),
      lit: blackout,
    },
  ];
}
