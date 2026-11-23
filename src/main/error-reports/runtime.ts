import type { ErrorEvent, ErrorIdentity, Incident } from './protocol';

export interface ErrorRuntimeDeps {
  identity(): ErrorIdentity | null;
  capture(make: () => Incident | null): boolean;
  now(): number;
}
/** Thin seam for alpha.21 diagnostics: only these typed fields cross into automatic reporting. */
export class ErrorReportRuntime {
  private readonly events: ErrorEvent[] = [];
  private streamState = 'off';
  private streamProblem = false;
  constructor(private readonly d: ErrorRuntimeDeps) {
    this.event('app-started');
  }
  event(code: ErrorEvent['code'], count = 1): void {
    this.events.push({ at: this.d.now(), code, count });
    if (this.events.length > 30) this.events.splice(0, this.events.length - 30);
  }
  /** Existing notices have text only. Classify fixed failure vocabulary locally; never keep or send that text. */
  operatorNotice(text: string): void {
    if (
      /\b(?:could not|couldn’t|cannot|failed|has stopped|not saved|not imported|not restored)\b/iu.test(text)
    )
      this.capture('operator-error', 'operation-failed');
  }
  crash(): void {
    this.capture('crash', 'process-crashed');
  }
  stream(state: string, message: string | null): void {
    const problem = state === 'reconnecting' || (state === 'off' && message !== null);
    if (problem && !this.streamProblem) this.capture('failed-stream', 'stream-failed');
    if (state === 'live' && this.streamState !== 'live') this.event('stream-started');
    if (state === 'off' && this.streamState !== 'off') this.event('stream-stopped');
    this.streamState = state;
    this.streamProblem = problem;
  }
  private capture(trigger: Incident['trigger'], code: Incident['code']): void {
    this.d.capture(() => {
      const identity = this.d.identity();
      if (!identity) return null;
      this.event(code);
      return { ...identity, trigger, code, events: [...this.events] };
    });
  }
}
