export type SourceQuitResult =
  | { confirmed: true }
  | { confirmed: false; reason: 'timeout' | 'failed' | 'quarantined' };

interface SourceQuitDeps {
  cancel(): void;
  /** True only after owned work stopped; retainOutput/quarantine must return false. */
  stop(): Promise<boolean>;
  timeoutMs?: number;
}

/** A source-specific barrier before Main enters its existing synchronous stop list. */
export class SourceQuitGate {
  private flight: Promise<SourceQuitResult> | null = null;
  private drained = false;
  private resumeScheduled = false;
  constructor(private readonly deps: SourceQuitDeps) {}

  get closing(): boolean { return this.flight !== null; }
  get confirmed(): boolean { return this.drained; }

  drain(): Promise<SourceQuitResult> {
    if (this.flight) return this.flight;
    let complete: (result: SourceQuitResult) => void = () => undefined;
    this.flight = new Promise<SourceQuitResult>((resolve) => { complete = resolve; });
    let settled = false;
    const finish = (result: SourceQuitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.drained = result.confirmed;
      complete(result);
    };
    const timer = setTimeout(() => finish({ confirmed: false, reason: 'timeout' }), this.deps.timeoutMs ?? 5_000);
    let cancelFailed = false;
    try { this.deps.cancel(); } catch { cancelFailed = true; }
    void Promise.resolve().then(() => this.deps.stop()).then(
      (confirmed) => finish(cancelFailed ? { confirmed: false, reason: 'failed' } : confirmed ? { confirmed: true } : { confirmed: false, reason: 'quarantined' }),
      () => finish({ confirmed: false, reason: 'failed' }),
    );
    return this.flight;
  }

  /** Called only after the existing quit confirmation succeeds. False means this quit was held. */
  request(
    event: { preventDefault(): void },
    resume: () => void,
    refused: (result: Extract<SourceQuitResult, { confirmed: false }>) => void,
  ): boolean {
    if (this.confirmed) return true;
    event.preventDefault();
    if (!this.resumeScheduled) {
      this.resumeScheduled = true;
      void this.drain().then((result) => {
        if (result.confirmed) resume();
        else { this.resumeScheduled = false; refused(result); }
      });
    }
    return false;
  }
}

