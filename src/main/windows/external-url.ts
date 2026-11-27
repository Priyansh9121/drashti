import { shell } from 'electron';

export interface ExternalUrlRules {
  /** Nonpackaged OAuth tests only, at this exact HTTP loopback origin. */
  loopbackOrigin?: string | undefined;
}

export async function openSafeExternal(url: string, _rules: ExternalUrlRules = {}): Promise<void> {
  await shell.openExternal(url);
}
