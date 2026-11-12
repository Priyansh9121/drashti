import type { DeckNativeTransition } from '../../../shared/deck-transition';
import type { XmlNode } from '../xml';

const DIRECTIONS: Readonly<Record<string, DeckNativeTransition['direction']>> = {
  l: 'left',
  r: 'right',
  u: 'up',
  d: 'down',
};

export interface NativePptxTransition {
  transition: DeckNativeTransition;
  approximate: boolean;
}

/**
 * Map the incoming PowerPoint slide's own motion, with a dissolve available after an unsupported effect is edited.
 * Exact: Drashti draws it as PowerPoint's own movie does (Push, Wipe, Cover and Uncover measured against it frame by
 * frame, 13 Nov 2026: render/transition-frame.ts). Approximate: only the closest Drashti can, so a slide using it keeps
 * PowerPoint's video wherever one can be made.
 */
export function nativePptxTransition(
  effect: XmlNode | undefined,
  durationMs: number,
): NativePptxTransition | undefined {
  if (!effect || !Number.isSafeInteger(durationMs) || durationMs <= 0 || effect.name === 'p:cut')
    return undefined;
  const direction = DIRECTIONS[effect.attrs['dir'] ?? 'l'];
  switch (effect.name) {
    case 'p:fade': {
      const kind = ['1', 'true'].includes(effect.attrs['thruBlk'] ?? '') ? 'fade-black' : 'dissolve';
      return { transition: { kind, deckEffect: kind, durationMs }, approximate: false };
    }
    case 'p:push':
    case 'p:cover':
    case 'p:pull': {
      const deckEffect = effect.name === 'p:push' ? 'push' : effect.name === 'p:cover' ? 'cover' : 'uncover';
      if (direction)
        return { transition: { kind: 'slide', deckEffect, durationMs, direction }, approximate: false };
      break;
    }
    case 'p:wipe':
      if (direction)
        return {
          transition: { kind: 'wipe', deckEffect: 'wipe', durationMs, direction },
          approximate: false,
        };
      break;
    case 'p:zoom':
    case 'p14:zoom':
      if (effect.attrs['dir'] === undefined || effect.attrs['dir'] === 'in')
        return { transition: { kind: 'zoom-dissolve', deckEffect: 'zoom', durationMs }, approximate: false };
      break;
  }
  return {
    transition: { kind: 'dissolve', deckEffect: 'dissolve', durationMs },
    approximate: true,
  };
}
