import type { AppInfo } from './app-info';

/**
 * The API the preload script exposes to every renderer as `window.drashti`.
 * Renderers talk to the main process only through this object.
 */
export interface DrashtiBridge {
  app: {
    getInfo(): Promise<AppInfo>;
  };
}
