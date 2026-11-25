import type { PicturesResult } from '../../shared/pictures';
import type { SabhaFlowChoice, SabhaFlowNowResult, SabhaFlowSnapshot } from '../../shared/sabha-flow';

/*
 * Sabha flow (alpha.23): Main's store. Stub.
 */

export interface SabhaFlowStoreDeps {
  dir: string;
  draw(pdf: string, outDir: string, signal?: AbortSignal): Promise<PicturesResult>;
  changed(snapshot: SabhaFlowSnapshot): void;
  log(message: string): void;
  newId?: () => string;
}

export class SabhaFlowStore {
  constructor(private readonly deps: SabhaFlowStoreDeps) {}

  load(): Promise<void> {
    return Promise.resolve();
  }

  snapshot(): SabhaFlowSnapshot {
    return { flow: null, state: null };
  }

  choose(file: unknown): Promise<SabhaFlowChoice> {
    void file;
    return Promise.resolve({ ok: false, message: 'Not built.' });
  }

  remove(): Promise<null> {
    return Promise.resolve(null);
  }

  setNow(flowId: unknown, now: unknown): Promise<SabhaFlowNowResult> {
    void flowId;
    void now;
    return Promise.resolve({ ok: false, message: 'Not built.' });
  }

  page(flowId: unknown, page: unknown): Promise<Uint8Array | null> {
    void flowId;
    void page;
    return Promise.resolve(null);
  }

  /** The PNG file of a page of the current flow (for the phone's route), or null. */
  pageFile(flowId: unknown, page: unknown): string | null {
    void flowId;
    void page;
    void this.deps;
    return null;
  }
}
