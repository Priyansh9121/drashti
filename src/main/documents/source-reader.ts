import type { PreparedSource } from '../../shared/editable-source';

export interface SourceRead {
  ext: 'pdf' | 'pptx';
  file: string;
  outDir: string;
  sourcePages: number[];
  signal: AbortSignal;
  /** Main's monotonic deadline, including time waiting for a turn. */
  deadlineAt?: number;
  /** Authoritative Main guard + asynchronous CPU give-way; false cancels this generation. */
  checkpoint(): Promise<boolean>;
}
export type SourceReader = (request: SourceRead) => Promise<PreparedSource>;

/** Instantiate once in Main; no renderer/test environment switch chooses an implementation. */
export function sourceReader(pdf: SourceReader, pptx: SourceReader): SourceReader {
  return (request) => (request.ext === 'pdf' ? pdf(request) : pptx(request));
}

// Deliberately not a default Node fallback. Unit native-source tests explicitly inject their real adapter.
export const unavailableSourceReader: SourceReader = () =>
  Promise.resolve({
    ok: false,
    message: 'Drashti can’t read the original’s words and shapes now. The slides still show as before.',
  });

/** Authority checks cannot strand a cancelled source generation, even if their yield is still pending. */
export function sourceCheckpoint(request: SourceRead): Promise<boolean> {
  if (request.signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (allowed: boolean) => {
      if (settled) return;
      settled = true;
      request.signal.removeEventListener('abort', abort);
      resolve(allowed && !request.signal.aborted);
    };
    const abort = () => finish(false);
    request.signal.addEventListener('abort', abort, { once: true });
    void Promise.resolve()
      .then(() => request.checkpoint())
      .then(finish, () => finish(false));
    if (request.signal.aborted) abort();
  });
}

export function sourceTimeLeft(request: SourceRead): number {
  return Math.max(
    1,
    Math.min(180_000, (request.deadlineAt ?? performance.now() + 180_000) - performance.now()),
  );
}
