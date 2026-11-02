import { utilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { PdfPrintPage } from '../../shared/pdf-copy';

const LIMIT = 64 * 1024 * 1024;
interface GeometryRequest {
  id: string;
  data: Uint8Array;
  pages: (PdfPrintPage & { target: { width: number; height: number } })[];
}
export interface GeometryChild {
  post(message: GeometryRequest): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
}
const responseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      id: z.uuid(),
      ok: z.literal(true),
      data: z.instanceof(Uint8Array).refine((bytes) => bytes.length > 8 && bytes.length <= LIMIT),
    })
    .strict(),
  z.object({ id: z.uuid(), ok: z.literal(false) }).strict(),
]);
function spawnGeometryWorker(): GeometryChild {
  const child = utilityProcess.fork(join(__dirname, 'pdf-geometry-worker.js'), [], {
    serviceName: 'Drashti PDF geometry',
    stdio: 'pipe',
  });
  let ready = false;
  let pending: GeometryRequest | undefined;
  child.once('spawn', () => {
    ready = true;
    if (pending) child.postMessage(pending);
    pending = undefined;
  });
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  return {
    post: (request) => {
      if (ready) child.postMessage(request);
      else pending = request;
    },
    onMessage: (listener) => {
      child.on('message', listener);
    },
    onExit: (listener) => {
      child.on('exit', listener);
    },
    kill: () => {
      pending = undefined;
      child.kill();
    },
  };
}

/** ONLY the private copy session supplies a just-completed Main print, never imported source bytes. */
export class PdfPrintGeometry {
  private active: { stop(): void; done: Promise<void> } | null = null;
  private stopped = false;
  private quarantined = false;

  constructor(
    private readonly spawn: () => GeometryChild = spawnGeometryWorker,
    private readonly options: { timeoutMs?: number; exitGraceMs?: number } = {},
  ) {}

  normalize = (
    data: Uint8Array,
    pages: PdfPrintPage[],
    target: { width: number; height: number },
    signal: AbortSignal,
  ): Promise<Uint8Array> => {
    if (
      this.stopped ||
      this.quarantined ||
      this.active ||
      signal.aborted ||
      data.length > LIMIT ||
      pages.length !== 1
    )
      return Promise.reject(new Error('The private PDF geometry worker is unavailable.'));
    let child: GeometryChild;
    try {
      child = this.spawn();
    } catch {
      return Promise.reject(new Error('The PDF geometry worker could not start.'));
    }
    const id = randomUUID();
    return new Promise<Uint8Array>((resolve, reject) => {
      let ended = false;
      let exited = false;
      let received = false;
      let closing = false;
      let result: Uint8Array | null = null;
      let failure = 'The printed PDF could not retain its exact geometry.';
      let grace: ReturnType<typeof setTimeout> | undefined;
      let drained: () => void = () => undefined;
      const done = new Promise<void>((finish) => {
        drained = finish;
      });
      const finish = () => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        if (grace) clearTimeout(grace);
        signal.removeEventListener('abort', cancel);
        if (this.active === active) this.active = null;
        drained();
        if (result && exited && !signal.aborted) resolve(result);
        else reject(new Error(failure));
      };
      const terminate = () => {
        if (ended) return;
        closing = true;
        try {
          child.kill();
        } catch {
          /* The confirmation deadline still applies. */
        }
        if (exited) {
          finish();
          return;
        }
        grace ??= setTimeout(() => {
          this.quarantined = true;
          result = null;
          failure = 'The PDF process did not confirm exit. Restart Drashti before exporting again.';
          finish();
        }, this.options.exitGraceMs ?? 1500);
      };
      const cancel = () => {
        result = null;
        failure = 'Saving the PDF copy was cancelled.';
        terminate();
      };
      const timer = setTimeout(() => {
        result = null;
        failure = 'PDF geometry took too long.';
        terminate();
      }, this.options.timeoutMs ?? 30_000);
      const active = { stop: cancel, done };
      this.active = active;
      child.onExit(() => {
        exited = true;
        finish();
      });
      child.onMessage((message) => {
        if (ended) return;
        if (closing) {
          result = null;
          return;
        }
        const parsed = responseSchema.safeParse(message);
        if (!parsed.success || parsed.data.id !== id || received || signal.aborted) {
          result = null;
          terminate();
          return;
        }
        received = true;
        if (parsed.data.ok) result = parsed.data.data;
        terminate();
      });
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      try {
        child.post({
          id,
          data: data.slice(),
          pages: pages.map((page) => ({ ...page, target: { ...target } })),
        });
      } catch {
        result = null;
        terminate();
      }
    });
  };

  get exitConfirmed(): boolean {
    return !this.quarantined && this.active === null;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const active = this.active;
    if (active) {
      active.stop();
      await active.done;
    }
  }
}
