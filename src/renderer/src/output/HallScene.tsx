import type { ComponentProps } from 'react';
import { Scene } from '../render/Scene';

/*
 * The picture on one of the hall's screens (an output: the audience's, or a key and fill pair's half): the show's Scene
 * as a hall screen draws it (Session 59, X19).
 */

/** What a hall screen tells its Scene: the rest is the hall's. */
type HallSceneProps = Omit<ComponentProps<typeof Scene>, 'place' | 'picturesFirst' | 'annotate'>;

export function HallScene(props: HallSceneProps) {
  return <Scene {...props} />;
}
