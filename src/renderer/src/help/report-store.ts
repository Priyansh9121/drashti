import { create } from 'zustand';
import {
  draftProblem,
  type ReportDraft,
  type ReportOpened,
  type ReportPrepared,
  type ReportRow,
  type ReportStateView,
} from '../../../shared/report';
import { guessFeatures, reportFeatures, type ReportFeature } from '../../../shared/report-features';
import { type LogPeriod, periodChoices } from '../../../shared/log-period';

/*
 * Help › Report a Problem…'s window (x49, the owner's Q60-38 and his "Yes, all A" to Q60-42), in either mode: what the
 * person chose and wrote, the page shown (write, review, sending, done, their reports), and what the main process
 * answered. Nothing is sent but by Send; the words stay in this window until then.
 */

export type ReportPage = 'write' | 'review' | 'sending' | 'done' | 'reports';

export interface ChosenFeature {
  feature: ReportFeature;
  what: string;
  expected: string;
}

interface ReportUi {
  open: boolean;
  page: ReportPage;
  /** What the main process said as it opened (the Gmail, the computer, the crash files, the picture). */
  opened: Extract<ReportOpened, { ok: true }> | null;
  features: ReportFeature[];
  query: string;
  chosen: ChosenFeature[];
  /** The notice's words (Report this…), until taken out. */
  notice: string | null;
  diagnostics: boolean;
  /** The diagnostics' log of (alpha.21, logs (c)): Today, Yesterday, the last 7 days or one day kept. */
  period: LogPeriod;
  /** The periods offered, worked out as the window opened (the days the log keeps, by that day). */
  periods: { period: LogPeriod; label: string }[];
  crashFiles: boolean;
  picture: boolean;
  /** Made for Review (exactly what goes), or why not. */
  prepared: Extract<ReportPrepared, { ok: true }> | null;
  busy: boolean;
  error: string | null;
  result: ReportStateView | null;
  rows: ReportRow[];
}

const CLEAR = {
  page: 'write' as ReportPage,
  query: '',
  chosen: [] as ChosenFeature[],
  notice: null as string | null,
  diagnostics: false,
  period: 'today' as LogPeriod,
  periods: [] as { period: LogPeriod; label: string }[],
  crashFiles: false,
  picture: false,
  prepared: null,
  busy: false,
  error: null as string | null,
  result: null as ReportStateView | null,
};

export const useReport = create<ReportUi>(() => ({
  open: false,
  opened: null,
  features: [],
  rows: [],
  ...CLEAR,
}));

/** The Manual's features, read once (the same catalogue as the Manual's). */
async function features(): Promise<ReportFeature[]> {
  const known = useReport.getState().features;
  if (known.length > 0) return known;
  const read = await window.drashti.manual.read();
  if (!read.ok) return [];
  const list = reportFeatures(read.chapters);
  useReport.setState({ features: list });
  return list;
}

/**
 * Open Report a Problem: the main process takes the window's picture first (before this window draws), then the
 * window opens. From a notice (Report this…), its words go in and the feature they name is ticked.
 */
export async function showReport(from: { notice?: string; featureId?: string } = {}): Promise<void> {
  if (useReport.getState().open) return;
  const [opened, list] = await Promise.all([window.drashti.report.open(), features()]);
  const chosen: ChosenFeature[] = [];
  const pick = from.featureId
    ? list.find((f) => f.id === from.featureId)
    : from.notice
      ? guessFeatures(list, from.notice).best
      : null;
  if (pick) chosen.push({ feature: pick, what: '', expected: '' });
  useReport.setState({
    ...CLEAR,
    open: true,
    opened: opened.ok ? opened : null,
    periods: periodChoices(opened.ok ? opened.logDays : [], Date.now()),
    error: opened.ok ? null : opened.message,
    notice: from.notice ?? null,
    chosen,
  });
}

export function closeReport(): void {
  useReport.setState({ open: false, ...CLEAR });
  void window.drashti.report.close();
}

export function setQuery(query: string): void {
  useReport.setState({ query });
}

export function toggleFeature(feature: ReportFeature): void {
  useReport.setState((s) =>
    s.chosen.some((c) => c.feature.id === feature.id)
      ? { chosen: s.chosen.filter((c) => c.feature.id !== feature.id) }
      : { chosen: [...s.chosen, { feature, what: '', expected: '' }] },
  );
}

export function setWords(id: string, part: 'what' | 'expected', words: string): void {
  useReport.setState((s) => ({
    chosen: s.chosen.map((c) => (c.feature.id === id ? { ...c, [part]: words } : c)),
  }));
}

export function setTick(tick: 'diagnostics' | 'crashFiles' | 'picture', on: boolean): void {
  useReport.setState({ [tick]: on } as Pick<ReportUi, typeof tick>);
}

/** The diagnostics' log of this period (alpha.21, logs (c)). */
export function setPeriod(period: LogPeriod): void {
  useReport.setState({ period });
}

export function leaveNoticeOut(): void {
  useReport.setState({ notice: null });
}

/** The draft as the main process takes it. */
export function draftOf(s: ReportUi): ReportDraft {
  return {
    features: s.chosen.map((c) => ({
      id: c.feature.id,
      chapter: c.feature.chapter,
      name: c.feature.name,
      what: c.what,
      expected: c.expected,
    })),
    notice: s.notice,
    diagnostics: s.diagnostics,
    crashFiles: s.crashFiles && Boolean(s.opened?.crash),
    picture: s.picture && Boolean(s.opened?.picture),
    period: s.period,
  };
}

/** Why Review… cannot be pressed yet, or null. */
export function writeProblem(s: ReportUi): string | null {
  return draftProblem({
    features: s.chosen.map((c) => ({ name: c.feature.name, what: c.what, expected: c.expected })),
  });
}

/** Review…: the files made, and exactly what will be sent. */
export async function review(): Promise<void> {
  const s = useReport.getState();
  if (s.busy || writeProblem(s)) return;
  useReport.setState({ busy: true, error: null });
  const prepared = await window.drashti.report.prepare(draftOf(s));
  useReport.setState(
    prepared.ok ? { busy: false, prepared, page: 'review' } : { busy: false, error: prepared.message },
  );
}

/** Back from Review: what was made for it cleared; the words stay. */
export function backToWrite(): void {
  const id = useReport.getState().prepared?.id;
  if (id) void window.drashti.report.discard(id);
  useReport.setState({ page: 'write', prepared: null });
}

/** Send: into the outbox, tried at once if it can be. */
export async function send(): Promise<void> {
  const prepared = useReport.getState().prepared;
  if (!prepared) return;
  useReport.setState({ page: 'sending', busy: true });
  const result = await window.drashti.report.send(prepared.id);
  // The window may have been closed meanwhile: the report goes on by itself.
  if (!useReport.getState().open) return;
  useReport.setState({
    busy: false,
    page: 'done',
    result: result ?? { kind: 'refused', why: 'bad-request', reference: prepared.reference },
  });
}

export async function showReports(): Promise<void> {
  const rows = await window.drashti.report.list();
  useReport.setState({ rows, page: 'reports' });
}

export async function refreshReports(): Promise<void> {
  if (useReport.getState().page !== 'reports') return;
  useReport.setState({ rows: await window.drashti.report.list() });
}
