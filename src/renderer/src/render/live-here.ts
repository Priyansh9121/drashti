import { createContext, useContext } from 'react';
import { usePreviewsOnly } from './previews';

/*
 * Whether this page draws this computer's live pictures (Session 50): a video input and another app's window are
 * on Main's computer, so only its own pages draw them (its screens, LIVE, Screens' cards and the stream's page),
 * never a node's screens (they are on another computer) nor a phone or tablet (previews only). A node's output
 * page says so (output/main.tsx); everything else is Main's.
 */

export const LiveHere = createContext(true);

/** True where a video input or a window in the picture-in-picture box can be drawn. */
export function useLiveHere(): boolean {
  const here = useContext(LiveHere);
  const previews = usePreviewsOnly();
  return here && !previews;
}
