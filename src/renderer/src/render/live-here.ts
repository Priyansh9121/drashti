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

/**
 * The Stage preview's page (alpha.23; lead 2's QA23-STAGE8-1): it draws this computer's video inputs live, as a
 * stage screen does, but never captures another app's window (it names it, as a tablet does) and never says how an
 * input stands (it is no screen). Its OutputContext says so (`preview`).
 */
export const StagePreviewPage = createContext(false);

export function useStagePreview(): boolean {
  return useContext(StagePreviewPage);
}
