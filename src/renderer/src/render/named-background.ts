import type { BackgroundLayer, EngineState } from '../../../shared/engine/state';
import { type LiveGroupLook, shows } from '../../../shared/looks';
import { pipName, pipShownFor } from './pip';

/*
 * A live background a page names instead of drawing (Session 48: another app's window; Session 50: a video input;
 * alpha.20, slice 8: a stream link):
 * it is on Main's computer only. A phone's remote names it, with Clear (web/remote), and can never choose one. A
 * stage layout's audience picture box names it in the same words where it cannot be drawn (Session 51: a tablet's
 * stage display, a node's stage screen), with the picture-in-picture box's, so the performers are not left with
 * black and no word.
 */

export interface NamedBackground {
  kind: 'window' | 'input' | 'link';
  /** The words before its name ("Video input:"). */
  label: string;
  name: string;
}

export function namedBackground(background: BackgroundLayer | null | undefined): NamedBackground | null {
  if (background?.kind === 'window') return { kind: 'window', label: 'A window:', name: background.name };
  if (background?.kind === 'input') return { kind: 'input', label: 'Video input:', name: background.name };
  if (background?.kind === 'link') return { kind: 'link', label: 'A stream link:', name: background.name };
  return null;
}

/**
 * What the hall's picture holds that this page cannot draw (Session 51), one line each, as the phone remote says
 * them: the background's video input or window ("Video input: Input 1"), then the picture-in-picture box's
 * ("Picture in picture: Input 1"); only those the hall's group shows, and none under black-out or the Wallpaper.
 * None at all on a page that draws them (`live`: this computer's own). `windows`: whether this page draws a window
 * too (alpha.23: the Stage preview draws a video input live, and names a window).
 */
export function unseenLive(
  state: Pick<EngineState, 'layers' | 'blackout' | 'wallpaper'>,
  look: LiveGroupLook,
  live: boolean,
  windows = live,
): string[] {
  if ((live && windows) || state.blackout || state.wallpaper) return [];
  const unseen = (kind: 'input' | 'window' | 'link'): boolean => (kind === 'window' ? !windows : !live);
  const lines: string[] = [];
  const named = shows(look, 'background') ? namedBackground(state.layers.background) : null;
  if (named && unseen(named.kind)) lines.push(`${named.label} ${named.name}`);
  const box = state.layers.pip;
  if (
    box &&
    pipShownFor(look) &&
    (box.source.kind === 'input' || box.source.kind === 'window') &&
    unseen(box.source.kind)
  )
    lines.push(`Picture in picture: ${pipName(box.source)}`);
  return lines;
}
