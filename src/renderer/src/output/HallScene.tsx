import type { ComponentProps } from 'react';
import { Scene } from '../render/Scene';
import { useTestFailsWhileUp } from './test-throw-while';

/*
 * The picture on one of the hall's screens (an output: the audience's, or a key and fill pair's half): the show's Scene
 * as a hall screen draws it (Session 59, X19). On an audience screen a slide is drawn only once its pictures can be
 * drawn, as on the stream's page (Session 58, Q57-35; the owner's decision Q58-52): the slide it first draws, and a slide
 * cut in, keep what is on screen until then (render/SlideLayerView.tsx, 3 s at most). What Next shows is loaded ahead by
 * the output's Preloader, so a cut to it waits for nothing; a transition already waited for its slide's pictures on
 * every screen. A key and fill pair's halves cut together as before (Q59-5): each waiting on its own pictures, the two
 * windows could cut a frame apart, a glitch on the keyer.
 */

/** What a hall screen tells its Scene: the rest is the hall's. */
type HallSceneProps = Omit<ComponentProps<typeof Scene>, 'place' | 'picturesFirst' | 'annotate'>;

export function HallScene(props: HallSceneProps) {
  // Tests only (x53): the scene fails each time it draws while a file a test named is up; never in a packaged Drashti.
  if (useTestFailsWhileUp(props.state))
    throw new Error('A test asked this screen to fail as it drew while that file is up');
  return <Scene {...props} picturesFirst={(props.matte ?? null) === null} />;
}
