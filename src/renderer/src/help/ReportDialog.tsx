import { useEffect, useMemo } from 'react';
import { formatBytes } from '../../../shared/format';
import type { LogPeriod } from '../../../shared/log-period';
import { REPORT_LIMITS, reportStateWords, reportWhen, type ReportStateView } from '../../../shared/report';
import { featureGroups } from '../../../shared/report-features';
import { useMode } from '../operator/mode-store';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select, Textarea, TextInput } from '../ui/Field';
import { Checkbox } from '../ui/Toggle';
import {
  backToWrite,
  closeReport,
  leaveNoticeOut,
  refreshReports,
  review,
  send,
  setPeriod,
  setQuery,
  setTick,
  setWords,
  showReports,
  toggleFeature,
  useReport,
  writeProblem,
} from './report-store';

/*
 * Help › Report a Problem… (x49, the owner's words of 20 Nov 2026, Q60-38: "Any issue any user faces he can log it in, i
 * receive a mail that this is the issue, with the inbuild drashti feature of asking where the issue is, selecting the
 * feature from search or a list (both), and explaining that this feature has this issue"; his "also if multiple bugs,
 * they get to select multiple features", and his "Yes, all A" to Q60-42). In either mode, as a window over the
 * operator window like the Manual: where the problem is (the Manual's features, by search or by chapter, several
 * allowed), each one's own words, what may go with it (all unticked at first), then Review, exactly what goes, and
 * Send. Nothing goes but by Send; the main process sends it by itself through the access list, never while on air.
 */

/** A report's state in a word or two, for Your reports. */
function stateShort(s: ReportStateView): string {
  switch (s.kind) {
    case 'sent':
      return 'Sent';
    case 'sending':
      return 'Sending';
    case 'refused':
      return 'Not sent: too large';
    default:
      return s.why === 'on-air'
        ? 'Waiting for the stream to end'
        : s.why === 'tomorrow'
          ? 'Going tomorrow'
          : 'Waiting';
  }
}

function WritePage() {
  const s = useReport();
  const mode = useMode((m) => m.mode) ?? 'pro';
  const groups = useMemo(
    () => featureGroups(s.features, { mode, query: s.query }),
    [s.features, mode, s.query],
  );
  const chosen = new Set(s.chosen.map((c) => c.feature.id));
  const opened = s.opened;
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <section aria-labelledby="report-where" className="flex flex-col gap-2">
        <h3 id="report-where" className="text-sm font-semibold text-fg">
          Where is the problem?
        </h3>
        <p className="text-xs text-muted">
          Tick each feature it is in, from the Manual’s chapters, or find one by its name. Several may be
          ticked.
        </p>
        <TextInput
          type="search"
          aria-label="Find a feature"
          placeholder="Find a feature"
          value={s.query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
        {s.chosen.length > 0 && (
          <ul aria-label="Features ticked" className="flex flex-wrap gap-1">
            {s.chosen.map((c) => (
              <li key={c.feature.id}>
                <Button
                  size="sm"
                  aria-label={`Untick ${c.feature.name}`}
                  onClick={() => {
                    toggleFeature(c.feature);
                  }}
                >
                  {c.feature.name} ×
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div
          className="max-h-48 overflow-y-auto rounded-md border border-line p-2"
          tabIndex={0}
          aria-label="Features, by chapter"
          data-testid="report-features"
        >
          {groups.map((g) => (
            <fieldset key={g.id} className="mb-2 flex flex-col gap-1">
              <legend className="text-xs font-semibold text-muted">{g.title}</legend>
              {g.features.map((f) => (
                <Checkbox
                  key={f.id}
                  label={f.name}
                  title={f.about}
                  checked={chosen.has(f.id)}
                  onChange={() => {
                    toggleFeature(f);
                  }}
                />
              ))}
            </fieldset>
          ))}
        </div>
      </section>
      {s.chosen.length > 0 && (
        <section aria-labelledby="report-what" className="flex flex-col gap-3">
          <h3 id="report-what" className="text-sm font-semibold text-fg">
            What happened?
          </h3>
          {s.chosen.map((c) => (
            <div key={c.feature.id} className="flex flex-col gap-2">
              <Field label={`What went wrong with ${c.feature.name}?`}>
                <Textarea
                  rows={3}
                  value={c.what}
                  maxLength={REPORT_LIMITS.whatLetters * 2}
                  onChange={(e) => {
                    setWords(c.feature.id, 'what', e.target.value);
                  }}
                />
              </Field>
              <Field label={`What did you expect from ${c.feature.name}? (optional)`}>
                <Textarea
                  rows={2}
                  value={c.expected}
                  maxLength={REPORT_LIMITS.expectedLetters * 2}
                  onChange={(e) => {
                    setWords(c.feature.id, 'expected', e.target.value);
                  }}
                />
              </Field>
            </div>
          ))}
        </section>
      )}
      {s.notice !== null && (
        <div className="flex items-start gap-2 text-xs text-muted">
          <p data-testid="report-notice" className="min-w-0 flex-1">
            The notice Drashti showed: “{s.notice}”
          </p>
          <Button size="sm" onClick={leaveNoticeOut}>
            Leave it out
          </Button>
        </div>
      )}
      <section aria-labelledby="report-with" className="flex flex-col gap-2">
        <h3 id="report-with" className="text-sm font-semibold text-fg">
          Send with it
        </h3>
        <Checkbox
          label="Diagnostics: the versions, the setup, the graphics, counts and the log, never words from the library."
          checked={s.diagnostics}
          onChange={(e) => {
            setTick('diagnostics', e.target.checked);
          }}
        />
        {s.diagnostics && (
          // The log of a chosen period (alpha.21, logs for 100+ installs (c)): the days this computer keeps.
          <Field label="Its log of" layout="inline" className="pl-6">
            <Select
              data-testid="report-log-period"
              value={s.period}
              onChange={(e) => {
                setPeriod(e.target.value as LogPeriod);
              }}
            >
              {s.periods.map((c) => (
                <option key={c.period} value={c.period}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {opened?.crash && (
          <Checkbox
            label={`Crash files: ${String(opened.crash.count)} (${formatBytes(opened.crash.bytes)}). Each holds what a part of Drashti had in memory when it crashed, which can include words from slides.`}
            checked={s.crashFiles}
            onChange={(e) => {
              setTick('crashFiles', e.target.checked);
            }}
          />
        )}
        {opened?.picture && (
          <div className="flex items-start gap-3">
            <Checkbox
              className="flex-1"
              label="A picture of this window, as it was when Report a Problem opened. It shows what was on it: slide words and the names in its lists."
              checked={s.picture}
              onChange={(e) => {
                setTick('picture', e.target.checked);
              }}
            />
            <img src={opened.picture.thumb} alt="" className="w-32 shrink-0 rounded-sm border border-line" />
          </div>
        )}
      </section>
      {opened?.via != null && (
        <p className="text-xs text-muted">
          It goes to the admin through Main (“{opened.via}”), with Main’s Gmail and this node’s name (
          {opened.computer}), so the admin can answer.
        </p>
      )}
      {opened?.via === null && (
        <p className="text-xs text-muted">
          Your Gmail ({opened.gmail}) and this computer’s name ({opened.computer}) go with it, so the admin
          can answer you.
        </p>
      )}
    </div>
  );
}

function ReviewPage() {
  const p = useReport((s) => s.prepared);
  if (!p) return null;
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <p className="text-xs text-muted">This is exactly what goes. Nothing is sent until you press Send.</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">To</dt>
        <dd data-testid="report-review-to">{p.to}</dd>
        <dt className="text-muted">Subject</dt>
        <dd data-testid="report-review-subject">{p.subject}</dd>
      </dl>
      <pre
        data-testid="report-review-text"
        tabIndex={0}
        aria-label="The email’s text"
        className="max-h-64 overflow-y-auto rounded-md border border-line bg-panel-2 p-3 text-xs whitespace-pre-wrap text-fg"
      >
        {p.text}
      </pre>
      {p.files.length > 0 && (
        <ul aria-label="Files that go with it" className="flex flex-col gap-1 text-sm">
          {p.files.map((f) => (
            <li key={f.name} data-testid="report-review-file" className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                {f.name} ({formatBytes(f.bytes)})
              </span>
              {f.kind === 'diagnostics' && (
                <Button
                  size="sm"
                  onClick={() => {
                    void window.drashti.report.showFile(p.id, f.name);
                  }}
                >
                  Show…
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {p.picture && (
        <img
          src={p.picture}
          alt="The picture of the window that goes with the report"
          className="max-h-48 self-start rounded-sm border border-line"
        />
      )}
      {p.kept.length > 0 && (
        <p className="text-xs text-muted">
          Kept on this computer, too large to send with the rest:{' '}
          {p.kept.map((k) => `${k.name} (${formatBytes(k.bytes)})`).join('; ')}.
        </p>
      )}
    </div>
  );
}

function DonePage() {
  const result = useReport((s) => s.result);
  const opened = useReport((s) => s.opened);
  if (!result) return null;
  // On a node (x49, Q60-42 2), sent means handed to Main, which sends it on.
  const via = opened?.via ?? null;
  const words =
    via !== null && result.kind === 'sent'
      ? `Handed to Main (“${via}”): it goes to the admin from there, by itself.`
      : via !== null && result.kind === 'waiting' && result.why === 'unreachable'
        ? 'Kept on this node: it goes to Main by itself once Main can be reached.'
        : reportStateWords(result);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        {words} Its reference: <strong>{result.reference}</strong>.
      </p>
      {result.kind === 'sent' && opened && !opened.owner && via === null && (
        <p className="text-muted">A short email to {opened.gmail} says it arrived.</p>
      )}
      <p className="text-xs text-muted">A copy stays on this computer: Your reports.</p>
    </div>
  );
}

function ReportsPage() {
  const rows = useReport((s) => s.rows);
  if (rows.length === 0) return <p className="text-sm text-muted">No reports on this computer.</p>;
  return (
    <ul aria-label="Your reports" className="flex flex-col gap-2">
      {rows.map((r) => (
        <li
          key={r.id}
          data-testid="report-row"
          className="flex flex-col gap-1 rounded-md border border-line p-2 text-sm"
        >
          <div className="flex flex-wrap items-baseline gap-x-2">
            <strong>{r.reference}</strong>
            <span className="text-muted">{reportWhen(r.when)}</span>
            <span>{stateShort(r.state)}</span>
          </div>
          <p className="text-xs text-muted">{r.features.join(', ')}</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                void window.drashti.report.copy(r.id);
              }}
            >
              Save a Copy…
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void window.drashti.report.forget(r.id).then(() => refreshReports());
              }}
            >
              Forget
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReportDialog() {
  const s = useReport();
  useEffect(
    () =>
      window.drashti.report.onChanged(() => {
        void refreshReports();
      }),
    [],
  );
  if (!s.open) return null;
  const problem = writeProblem(s);
  const cannot =
    s.opened === null ? (s.error ?? 'Report a Problem works once this computer is let in.') : null;
  const footer =
    s.page === 'write' ? (
      <>
        <Button onClick={() => void showReports()}>Your reports</Button>
        <span className="flex-1" />
        <Button onClick={closeReport}>Cancel</Button>
        <Button
          variant="primary"
          disabled={Boolean(problem) || s.busy || cannot !== null || s.opened?.full === true}
          title={problem ?? undefined}
          onClick={() => void review()}
        >
          Review…
        </Button>
      </>
    ) : s.page === 'review' ? (
      <>
        <span className="flex-1" />
        <Button onClick={backToWrite}>Back</Button>
        <Button variant="primary" onClick={() => void send()}>
          Send
        </Button>
      </>
    ) : (
      <>
        {s.page !== 'reports' && <Button onClick={() => void showReports()}>Your reports</Button>}
        <span className="flex-1" />
        <Button variant="primary" onClick={closeReport}>
          Done
        </Button>
      </>
    );
  return (
    <Dialog
      title="Report a Problem"
      subtitle="Tell the admin where the problem is and what it is."
      size="lg"
      onClose={closeReport}
      closeLabel="Close Report a Problem"
      testId="report-problem"
      className="h-[min(46rem,100%)]"
      bodyClassName="flex min-h-0 flex-col gap-3 overflow-y-auto"
      footer={footer}
    >
      {cannot && (
        <p role="alert" className="text-sm text-danger-fg">
          {cannot}
        </p>
      )}
      {s.opened && s.error && (
        <p role="alert" className="text-sm text-danger-fg">
          {s.error}
        </p>
      )}
      {s.opened?.full && s.page === 'write' && (
        <p role="alert" className="text-sm text-warning-fg">
          Twenty reports wait to go already: forget some in Your reports first.
        </p>
      )}
      {s.page === 'write' && <WritePage />}
      {s.page === 'review' && <ReviewPage />}
      {s.page === 'sending' && (
        <p className="text-sm">{reportStateWords({ kind: 'sending', reference: '' })}</p>
      )}
      {s.page === 'done' && <DonePage />}
      {s.page === 'reports' && <ReportsPage />}
    </Dialog>
  );
}
