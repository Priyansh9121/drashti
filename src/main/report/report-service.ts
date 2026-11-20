import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AccessComputer, AccessGrant } from '../../shared/access-protocol';
import { fileStamp } from '../../shared/format';
import type { CapturedPicture } from '../../shared/pdf-copy';
import {
  draftProblem,
  REPORT_LIMITS,
  REPORT_RECEIVED_LATER,
  REPORT_TO,
  reportCleanLines,
  reportComputerLine,
  reportMailText,
  reportReference,
  reportSubject,
  reportWhen,
  type ReportCallReport,
  type ReportDraft,
  type ReportFrom,
  type ReportOpened,
  type ReportPrepared,
  type ReportRow,
  type ReportStateView,
} from '../../shared/report';
import { cutText } from '../../shared/text';
import type { AccessClient } from '../access/client';
import type { CrashFile } from '../crash-files';
import { REPORTS_KEPT_WAITING, ReportOutbox, type ReportState, type StoredReport } from './outbox';
import type { ReportDiagnosticsInput, ReportFilesJob, ReportFilesMade } from './report-files';

/*
 * Help › Report a Problem… in the main process (x49, the owner's Q60-38 and his "Yes, all A" to Q60-42): the window's
 * requests (open, Review, Send, the list, Forget, Save a Copy…) and the outbox (outbox.ts) that sends each report by
 * itself through the access list (client.ts's report call, signed with this computer's way in). The files are made by
 * the report worker, off Main's thread (report-files.ts); the picture of the window is taken as Report a Problem opens,
 * kept in memory only, and goes only when ticked. Nothing here touches the show.
 */

export interface ReportServiceDeps {
  /** The reports' folder, in the data folder (never in the library's backups). */
  dir: string;
  /** The library's file: the worker reads its counts and names (read only) for the diagnostics. */
  dbFile: string;
  /** The lock's own client and way in (one client for every call to the list). */
  client(): Promise<AccessClient | null>;
  grant(): AccessGrant | null;
  letIn(): boolean;
  gmail(): string | null;
  owner(): boolean;
  /** Where a report is written: Pro Mode or Simple Mode. */
  from(): ReportFrom;
  onAir(): boolean;
  /** The crash files kept on this computer, newest first. */
  crashFiles(): CrashFile[];
  /** Save Diagnostics' input (without the library, which the worker opens), crash files said as ticked or not. */
  diagnostics(crashIncluded: boolean): Promise<ReportDiagnosticsInput>;
  /** The report worker: the files made in the report's folder. */
  makeFiles(job: ReportFilesJob): Promise<ReportFilesMade>;
  now(): number;
  setTimer(ms: number, run: () => void): () => void;
  /** A line in the operator window's notice. */
  notice(text: string): void;
  /** The window's list of reports changed. */
  changed(): void;
  log(line: string): void;
  /** Tests only: the waits after no answer, and before the first try after a start. */
  retryMs?: readonly number[];
  startDelayMs?: number;
}

/** The window as it was when Report a Problem opened: its pixels, and a small copy to show beside the tick. */
export interface HeldPicture {
  picture: CapturedPicture;
  thumb: string;
}

const view = (r: StoredReport): ReportStateView => {
  const s: ReportState = r.state;
  switch (s.kind) {
    case 'sent':
      return { kind: 'sent', reference: r.reference };
    case 'waiting':
      return { kind: 'waiting', why: s.why, reference: r.reference };
    case 'refused':
      return { kind: 'refused', why: s.why, reference: r.reference };
    default:
      return { kind: 'sending', reference: r.reference };
  }
};

export class ReportService {
  readonly outbox: ReportOutbox;
  private held: HeldPicture | null = null;
  /** The report made for Review and not sent yet (Back, or the window closed, clears it). */
  private preparedId: string | null = null;

  constructor(private readonly d: ReportServiceDeps) {
    mkdirSync(d.dir, { recursive: true });
    this.outbox = new ReportOutbox({
      dir: d.dir,
      send: async (r, data, stop) => {
        const client = await d.client();
        const grant = d.grant();
        if (!client || !grant) return { ok: false, kind: 'no-answer', stopped: false };
        const result = await client.report(grant, r.call, data, stop);
        if (result.ok) return { ok: true, reference: result.value.reference, again: result.value.again };
        if (result.kind === 'refused') return { ok: false, kind: 'refused', error: result.error };
        return { ok: false, kind: 'no-answer', stopped: stop.aborted };
      },
      canSend: () => d.letIn(),
      onAir: () => d.onAir(),
      now: () => d.now(),
      setTimer: (ms, run) => d.setTimer(ms, run),
      ...(d.retryMs ? { retryMs: d.retryMs } : {}),
      ...(d.startDelayMs === undefined ? {} : { startDelayMs: d.startDelayMs }),
      changed: () => {
        d.changed();
      },
      reached: (r) => {
        d.notice(`Your report ${r.reference} reached the admin.`);
      },
      log: (line) => {
        d.log(line);
      },
    });
  }

  /** The reports kept from before go a while after the start. */
  start(): void {
    this.outbox.start();
  }

  /** The network back, or this computer let in again: what waits is tried now. */
  wake(): void {
    this.outbox.wake();
  }

  /** Report a Problem opens, with the window as it was (taken just before, by Main): what it shows. */
  async opened(picture: HeldPicture | null): Promise<ReportOpened> {
    if (!this.d.letIn())
      return { ok: false, message: 'Report a Problem works once this computer is let in.' };
    this.discardPrepared();
    this.held = picture;
    const crash = this.d.crashFiles();
    const client = await this.d.client();
    const gmail = this.d.gmail() ?? '';
    return {
      ok: true,
      gmail,
      owner: this.d.owner(),
      computer: client?.computer().name ?? 'This computer',
      crash: crash.length > 0 ? { count: crash.length, bytes: crash.reduce((n, f) => n + f.bytes, 0) } : null,
      picture: picture
        ? { thumb: picture.thumb, width: picture.picture.width, height: picture.picture.height }
        : null,
      waiting: this.outbox.waiting(),
      sentToday: this.outbox.sentToday(),
      full: this.outbox.waiting() >= REPORTS_KEPT_WAITING,
    };
  }

  /** The window closed: the picture forgotten, a report made for Review and not sent cleared. */
  closed(): void {
    this.held = null;
    this.discardPrepared();
  }

  /** Review…: the files made (by the worker), and exactly what will be sent; kept, not sent. */
  async prepare(draft: ReportDraft): Promise<ReportPrepared> {
    if (!this.d.letIn())
      return { ok: false, message: 'Report a Problem works once this computer is let in.' };
    const problem = draftProblem(draft);
    if (problem) return { ok: false, message: problem };
    if (this.outbox.waiting() >= REPORTS_KEPT_WAITING)
      return {
        ok: false,
        message: `${String(REPORTS_KEPT_WAITING)} reports wait to go already: forget some in Your reports first.`,
      };
    this.discardPrepared();
    const client = await this.d.client();
    if (!client) return { ok: false, message: 'Report a Problem works once this computer is let in.' };
    const now = this.d.now();
    const id = randomBytes(16).toString('hex');
    const reference = reportReference(id);
    const dir = join(this.d.dir, id);
    const from = this.d.from();
    let made: ReportFilesMade;
    try {
      made = await this.d.makeFiles({
        dir,
        stamp: fileStamp(new Date(now)),
        diagnostics: draft.diagnostics
          ? { input: await this.d.diagnostics(draft.crashFiles), dbFile: this.d.dbFile }
          : null,
        picture: draft.picture ? (this.held?.picture ?? null) : null,
        crash: draft.crashFiles
          ? this.d.crashFiles().map((f) => ({ path: f.path, name: f.name, bytes: f.bytes }))
          : [],
      });
    } catch (error) {
      made = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    if (!made.ok) {
      rmSync(dir, { recursive: true, force: true });
      this.d.log(`Report: its files could not be made (${made.message})`);
      return {
        ok: false,
        message: 'The report’s files could not be made: try again, or send it without them.',
      };
    }
    const features = draft.features.map((f) => {
      const expected = reportCleanLines(f.expected);
      return {
        chapter: f.chapter,
        name: f.name,
        what: reportCleanLines(f.what),
        ...(expected ? { expected } : {}),
      };
    });
    const notice = draft.notice
      ? cutText(reportCleanLines(draft.notice).replace(/\n+/gu, ' '), REPORT_LIMITS.noticeLetters)
      : '';
    const call: ReportCallReport = {
      id,
      written: now,
      from,
      features,
      ...(notice ? { notice } : {}),
      ...(made.errors.length > 0 ? { errors: made.errors } : {}),
      files: made.files,
      ...(made.kept.length > 0 ? { kept: made.kept } : {}),
    };
    const computer: AccessComputer = client.computer();
    const owner = this.d.owner();
    const subject = reportSubject(
      features.map((f) => f.name),
      reference,
    );
    const text = reportMailText({
      reference,
      gmail: this.d.gmail() ?? '',
      computer: reportComputerLine(computer, from, null),
      written: reportWhen(now),
      received: REPORT_RECEIVED_LATER,
      features,
      ...(notice ? { notice } : {}),
      errors: made.errors,
      files: made.files,
      kept: made.kept,
      owner,
    });
    this.outbox.prepared({ id, reference, prepared: now, subject, text, call });
    this.preparedId = id;
    const picture = made.files.find((f) => f.kind === 'picture');
    return {
      ok: true,
      id,
      reference,
      to: REPORT_TO,
      subject,
      text,
      files: made.files.map((f) => ({ kind: f.kind, name: f.name, bytes: f.bytes })),
      kept: made.kept,
      picture: picture
        ? `data:image/png;base64,${readFileSync(join(dir, 'files', picture.name)).toString('base64')}`
        : null,
    };
  }

  /** Back from Review: the report made for it cleared. */
  discard(id: string): void {
    if (this.preparedId === id) this.discardPrepared();
  }

  /** Send: into the outbox, tried at once if it can be; where it stands after that first try. */
  async send(id: string): Promise<ReportStateView | null> {
    if (this.preparedId !== id) return null;
    this.preparedId = null;
    this.held = null;
    await this.outbox.send(id);
    const r = this.outbox.get(id);
    this.d.changed();
    return r ? view(r) : null;
  }

  /** Your reports: each one sent, waiting or not taken, newest first. */
  list(): ReportRow[] {
    return this.outbox
      .list()
      .filter((r) => r.state.kind !== 'prepared')
      .map((r) => ({
        id: r.id,
        reference: r.reference,
        when: r.sentAt ?? r.prepared,
        features: r.call.features.map((f) => f.name),
        state: view(r),
      }));
  }

  /** Forget a report on this computer (one waiting is then never sent). */
  forget(id: string): boolean {
    return this.outbox.remove(id);
  }

  /** Save a Copy…: its folder in `into`; the folder's path. */
  copy(id: string, into: string): string | null {
    return this.outbox.saveCopy(id, into);
  }

  /** A file of a report (Show… in Review): its path, or null. */
  filePath(id: string, name: string): string | null {
    const r = this.outbox.get(id);
    if (!r?.call.files.some((f) => f.name === name)) return null;
    return join(this.d.dir, id, 'files', name);
  }

  dispose(): void {
    this.outbox.dispose();
  }

  private discardPrepared(): void {
    const id = this.preparedId;
    this.preparedId = null;
    if (id && this.outbox.get(id)?.state.kind === 'prepared') this.outbox.remove(id);
  }
}
