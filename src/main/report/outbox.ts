import type { AccessErrorCode } from '../../shared/access-protocol';
import type { ReportCallReport } from '../../shared/report';

/*
 * Help › Report a Problem…'s outbox (x49): each report in a folder of its own in Drashti's data folder, sent by itself
 * when it can be, once. (Not yet.)
 */

/** Why a report waits. */
export type ReportWait = 'unreachable' | 'on-air' | 'tomorrow' | 'list';

export type ReportState =
  | { kind: 'prepared' }
  | { kind: 'sending' }
  | { kind: 'waiting'; why: ReportWait; next: number | null }
  | { kind: 'sent'; reference: string; at: number }
  | { kind: 'refused'; why: AccessErrorCode };

/** A report as its folder keeps it (report.json): what was reviewed, the call's report, and where it stands. */
export interface StoredReport {
  v: 1;
  id: string;
  reference: string;
  /** When its Review was made, and when Send was pressed (null before). */
  prepared: number;
  sentAt: number | null;
  subject: string;
  /** The email's text as the person reviewed it. */
  text: string;
  call: ReportCallReport;
  state: ReportState;
  tries: number;
}

/** How one try went. */
export type SendOutcome =
  | { ok: true; reference: string; again: boolean }
  | { ok: false; kind: 'refused'; error: AccessErrorCode }
  | { ok: false; kind: 'no-answer'; stopped: boolean };

export interface OutboxDeps {
  /** The reports' folder (in the data folder). */
  dir: string;
  /** One try: the report and its files' data (data.json) to the list, signed; given up when `stop` aborts. */
  send(report: StoredReport, data: Buffer, stop: AbortSignal): Promise<SendOutcome>;
  /** This computer is let in (a report is signed with its way in). */
  canSend(): boolean;
  /** The stream or a recording is on (or starting, or ending): reports wait (the owner's Q60-42, 3). */
  onAir(): boolean;
  now(): number;
  setTimer(ms: number, run: () => void): () => void;
  /** After no answer, the waits before the next tries (the last repeats). */
  retryMs?: readonly number[];
  /** After a start, the wait before the first try of the reports kept from before. */
  startDelayMs?: number;
  /** How often the stream's state is looked at while a report waits for it, or goes. */
  pollMs?: number;
  /** The reports changed (the window's list). */
  changed(): void;
  /** A report kept before has reached the admin (the operator window says so). */
  reached(report: StoredReport): void;
  log(line: string): void;
  /** A report's data.json, read (tests: at once). */
  readData?: (file: string) => Promise<Buffer>;
}

export class ReportOutbox {
  constructor(readonly deps: OutboxDeps) {}

  prepared(_report: Omit<StoredReport, 'state' | 'tries' | 'sentAt' | 'v'>): void {
    // Not yet.
  }

  send(_id: string): Promise<ReportState> {
    return Promise.resolve({ kind: 'prepared' });
  }

  start(): void {
    // Not yet.
  }

  list(): StoredReport[] {
    return [];
  }

  remove(_id: string): boolean {
    return false;
  }

  saveCopy(_id: string, _into: string): string | null {
    return null;
  }

  wake(): void {
    // Not yet.
  }

  sentToday(): number {
    return 0;
  }

  dispose(): void {
    // Not yet.
  }
}
