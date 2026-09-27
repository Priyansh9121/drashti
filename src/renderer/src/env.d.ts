/// <reference types="vite/client" />
import { type DrashtiBridge } from '../../shared/bridge';

declare global {
  interface Window {
    /** Exposed by the preload script; the renderer's only way to reach the main process. */
    readonly drashti: DrashtiBridge;
  }
}
