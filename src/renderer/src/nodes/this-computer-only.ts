import type { BackgroundLayer } from '../../../shared/engine/state';

/*
 * What only this computer's screens show, for the screens dashboard: another app's window (Session 48) and a
 * video input (Session 50) are on this computer, and the nodes are other computers.
 */

export function thisComputerOnly(
  background: BackgroundLayer | null | undefined,
): { kind: 'window' | 'input'; text: string } | null {
  const rest =
    'shows on this computer’s screens only: the nodes’ screens show the rest of the show without it.';
  if (background?.kind === 'window')
    return { kind: 'window', text: `The window “${background.name}” ${rest}` };
  if (background?.kind === 'input')
    return { kind: 'input', text: `The video input “${background.name}” ${rest}` };
  return null;
}
