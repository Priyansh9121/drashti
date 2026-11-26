export type SourceQuitResult =
  { confirmed: true } | { confirmed: false; reason: 'timeout' | 'failed' | 'quarantined' };

// Internal classification, never operator-facing message text.
const FAILED_STOP = 'failed';

interface SourceQuitDeps {
  cancel(): void;
  /** True only after owned work stopped; retainOutput/quarantine must return false, or be counted by givenUp. */
  stop(): Promise<boolean>;
  /**
   * How many owned readers have been given up on so far (O1): each one's job ended unconfirmed, its output kept and
   * nothing admitted since. One given up on in a drain holds that drain; one given up on before it began never holds it.
   */
  givenUp?(): number;
  timeoutMs?: number;
}

/** A source-specific barrier before Main enters its existing synchronous stop list. */
export class SourceQuitGate {
  private flight: Promise<SourceQuitResult> | null = null;
  private drained = false;
  /** The last drain ended unconfirmed: the next quit or exit drains again (O1). */
  private refused = false;
  private resumeScheduled = false;
  constructor(private readonly deps: SourceQuitDeps) {}

  get closing(): boolean {
    return this.flight !== null;
  }
  get confirmed(): boolean {
    return this.drained;
  }

  drain(): Promise<SourceQuitResult> {
    if (this.flight) return this.flight;
    let complete: (result: SourceQuitResult) => void = () => undefined;
    this.flight = new Promise<SourceQuitResult>((resolve) => {
      complete = resolve;
    });
    let settled = false;
    const finish = (result: SourceQuitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.drained = result.confirmed;
      this.refused = !result.confirmed;
      complete(result);
    };
    // Readers given up on before this drain (its cancel included) never hold it (O1).
    const givenUpBefore = this.deps.givenUp?.() ?? 0;
    const timer = setTimeout(
      () => finish({ confirmed: false, reason: 'timeout' }),
      this.deps.timeoutMs ?? 5_000,
    );
    let cancelFailed = false;
    try {
      this.deps.cancel();
    } catch {
      cancelFailed = true;
    }
    void Promise.resolve()
      .then(() => this.deps.stop())
      .then(
        (confirmed) =>
          finish(
            cancelFailed
              ? { confirmed: false, reason: FAILED_STOP }
              : confirmed && (this.deps.givenUp?.() ?? 0) === givenUpBefore
                ? { confirmed: true }
                : { confirmed: false, reason: 'quarantined' },
          ),
        () => finish({ confirmed: false, reason: FAILED_STOP }),
      );
    return this.flight;
  }

  /**
   * The drain a quit or an exit waits for (O1): the one in flight, or the confirmed one, or after a refusal a fresh
   * bounded one. Before, the first refusal was kept for good, so Drashti never quit normally again (an operator told
   * "Restart Drashti before editing more imported slides" could only force it). No new source work is admitted once
   * any drain has begun (closing), refused or not.
   */
  drainForQuit(): Promise<SourceQuitResult> {
    if (this.refused) {
      this.refused = false;
      this.flight = null;
    }
    return this.drain();
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
      void this.drainForQuit().then((result) => {
        if (result.confirmed) resume();
        else {
          this.resumeScheduled = false;
          refused(result);
        }
      });
    }
    return false;
  }
}
