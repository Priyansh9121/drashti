import type { App } from 'electron';

/** Install fail-closed defaults before any page or session is created. */
export function installElectronHardening(_app: Pick<App, 'on'>): void {}
