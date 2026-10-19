import type { AppearanceNow } from './appearances';

/*
 * Drawing a page in its appearance (Sessions 39–40): its custom properties on <html>, which app.css's tokens and
 * shadows read, and the attributes the styles follow (data-base: light or dark native parts; data-appearance;
 * data-interface-motion, Session 40). The preload does it for Drashti's own windows only, before the page draws.
 */

/** The parts of <html> this sets (no DOM types: the preload and the tests both use it). */
export interface AppearanceRoot {
  style: { setProperty(name: string, value: string): void };
  dataset: Record<string, string | undefined>;
}

export function drawAppearance(root: AppearanceRoot, now: AppearanceNow): void {
  for (const [name, value] of Object.entries(now.vars)) root.style.setProperty(name, value);
  root.dataset['appearance'] = now.id;
  root.dataset['base'] = now.base;
  root.dataset['interfaceMotion'] = now.motion;
}
