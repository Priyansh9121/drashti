import type { BackgroundLayer, PipLayer } from '../../../shared/engine/state';

/*
 * What only this computer's screens show, for the screens dashboard: another app's window (Session 48) and a
 * video input (Session 50) are on this computer, and the nodes are other computers; the same in the
 * picture-in-picture box (Session 50), where a box of media or the slides shows on the nodes too.
 */

const REST =
  'shows on this computer’s screens only: the nodes’ screens show the rest of the show without it.';

export function thisComputerOnly(
  background: BackgroundLayer | null | undefined,
): { kind: 'window' | 'input'; text: string } | null {
  if (background?.kind === 'window')
    return { kind: 'window', text: `The window “${background.name}” ${REST}` };
  if (background?.kind === 'input')
    return { kind: 'input', text: `The video input “${background.name}” ${REST}` };
  return null;
}

/** The same for what the picture-in-picture box holds. */
export function boxThisComputerOnly(
  box: PipLayer | null | undefined,
): { kind: 'window' | 'input'; text: string } | null {
  const source = box?.source;
  if (source?.kind === 'window')
    return { kind: 'window', text: `The window “${source.name}” in the picture-in-picture box ${REST}` };
  if (source?.kind === 'input')
    return { kind: 'input', text: `The video input “${source.name}” in the picture-in-picture box ${REST}` };
  return null;
}
