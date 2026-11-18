import type { ComponentProps } from 'react';
import { Scene } from '../render/Scene';

/*
 * The picture on one of the hall's screens (an output: the audience's, or a key and fill pair's half): the show's Scene
 * as a hall screen draws it (Session 59, X19). A slide is drawn there only once its pictures can be drawn, as on the
 * stream's page (Session 58, Q57-35; the owner's decision Q58-52): the slide it first draws, and a slide cut in, keep
 * what is on screen until then (render/SlideLayerView.tsx, 3 s at most). What Next shows is loaded ahead by the output's
 * Preloader, so a cut to it waits for nothing; a transition already waited for its slide's pictures on every screen.
 */

/** What a hall screen tells its Scene: the rest is the hall's. */
type HallSceneProps = Omit<ComponentProps<typeof Scene>, 'place' | 'picturesFirst' | 'annotate'>;

export function HallScene(props: HallSceneProps) {
  return <Scene {...props} picturesFirst />;
}
