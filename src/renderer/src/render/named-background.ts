import type { BackgroundLayer, EngineState } from '../../../shared/engine/state';
import { type LiveGroupLook, shows } from '../../../shared/looks';
import { pipName, pipShownFor } from './pip';

/*
 * A live background a page names instead of drawing (Session 48: another app's window; Session 50: a video input):
 * it is on Main's computer only. A phone's remote names it, with Clear (web/remote), and can never choose one. A
 * stage layout's audience picture box names it in the same words where it cannot be drawn (Session 51: a tablet's
 * stage display, a node's stage screen), with the picture-in-picture box's, so the performers are not left with
 * black and no word.
 */

export interface NamedBackground {
  kind: 'window' | 'input';
  /** The words before its name ("Video input:"). */
  label: string;
  name: string;
}

export function namedBackground(background: BackgroundLayer | null | undefined): NamedBackground | null {
  if (background?.kind === 'window') return { kind: 'window', label: 'A window:', name: background.name };
  if (background?.kind === 'input') return { kind: 'input', label: 'Video input:', name: background.name };
  return null;
}

/**
 * What the hall's picture holds that this page cannot draw (Session 51), one line each, as the phone remote says
 * them: the background's video input or window ("Video input: Input 1"), then the picture-in-picture box's
 * ("Picture in picture: Input 1"); only those the hall's group shows in the live Look, and none under black-out or
 * the logo. None at all on a page that draws them (`live`: this computer's own).
 */
export function unseenLive(
  state: Pick<EngineState, 'layers' | 'blackout' | 'logo'>,
  look: LiveGroupLook,
  live: boolean,
): string[] {
  if (live || state.blackout || state.logo !== null) return [];
  const lines: string[] = [];
  const named = shows(look, 'background') ? namedBackground(state.layers.background) : null;
  if (named) lines.push(`${named.label} ${named.name}`);
  const box = state.layers.pip;
  if (box && pipShownFor(look) && (box.source.kind === 'input' || box.source.kind === 'window'))
    lines.push(`Picture in picture: ${pipName(box.source)}`);
  return lines;
}
