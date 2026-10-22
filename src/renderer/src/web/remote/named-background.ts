import type { BackgroundLayer } from '../../../../shared/engine/state';

/*
 * A live background a phone names instead of drawing, with Clear (Session 48: another app's window; Session 50:
 * a video input): it is on Main's computer only, and a phone can never choose one.
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
