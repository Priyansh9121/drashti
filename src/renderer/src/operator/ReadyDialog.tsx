import { READY_CANNOT_CHECK, type ReadyLine } from '../../../shared/ready';
import { relinkMedia } from '../library/import-store';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { AlertTriangle, CircleCheck } from '../ui/icons';
import { cx } from '../ui/cx';
import { checkReady, closeReady, useReady } from './ready-store';

/*
 * Ready? (Session 55, Part 8, H): each line green (nothing to do) or amber, with what to do; Test sound on the sound
 * line (the Setup wizard's test tone, to the chosen output) and Find missing media… on the files line; what it cannot
 * check, under them.
 */

async function testSound(): Promise<void> {
  try {
    const status = await window.drashti.audio.getOutput();
    await window.drashti.setup.testTone(status.chosen);
  } catch {
    // Nothing to say: the line itself says where sound goes.
  }
}

function Line({ line, missing }: { line: ReadyLine; missing: string[] }) {
  const Icon = line.ok ? CircleCheck : AlertTriangle;
  return (
    <li
      className={cx(
        'flex gap-3 rounded-md border border-l-4 px-3 py-2',
        line.ok
          ? 'border-success/50 border-l-success bg-success-bg text-success-fg'
          : 'border-warning/60 border-l-warning bg-warning-bg text-warning-fg',
      )}
      data-testid={`ready-${line.id}`}
      data-ready={line.ok ? 'green' : 'amber'}
      data-unknown={line.unknown === true ? 'true' : undefined}
    >
      <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-bold">{line.title}</span>
          <span className="sr-only">{line.ok ? ': ready. ' : ': look at this. '}</span>
          <span aria-hidden="true">{' · '}</span>
          <span data-testid={`ready-${line.id}-said`}>{line.said}</span>
        </p>
        {line.todo !== null && (
          <p className="mt-0.5 text-sm font-medium" data-testid={`ready-${line.id}-todo`}>
            {line.todo}
          </p>
        )}
      </div>
      {line.id === 'sound' && (
        <Button size="sm" variant="secondary" onClick={() => void testSound()} data-testid="ready-test-sound">
          Test sound
        </Button>
      )}
      {line.id === 'files' && !line.ok && missing.length > 0 && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            closeReady();
            void relinkMedia(missing);
          }}
          data-testid="ready-find-missing"
        >
          Find missing media…
        </Button>
      )}
    </li>
  );
}

export function ReadyDialog() {
  const open = useReady((s) => s.open);
  const busy = useReady((s) => s.busy);
  const report = useReady((s) => s.report);
  const failed = useReady((s) => s.failed);
  if (!open) return null;
  const amber = report?.lines.filter((l) => !l.ok).length ?? 0;
  return (
    <Dialog
      title="Ready?"
      subtitle={
        report === null
          ? busy
            ? 'Checking…'
            : null
          : amber === 0
            ? 'Everything Drashti can check is ready.'
            : `${String(amber)} ${amber === 1 ? 'thing' : 'things'} to look at before the sabha.`
      }
      onClose={closeReady}
      size="md"
      bodyFocusable
      testId="ready-dialog"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => void checkReady()}
            disabled={busy}
            data-testid="ready-again"
          >
            {busy ? 'Checking…' : 'Check again'}
          </Button>
          <Button variant="primary" onClick={closeReady}>
            Close
          </Button>
        </>
      }
    >
      <div aria-live="polite" aria-busy={busy}>
        {failed && (
          <p className="text-sm text-danger-fg" data-testid="ready-failed">
            Drashti could not check just now. Press Check again.
          </p>
        )}
        {report !== null && (
          <ul className="flex flex-col gap-1.5" data-testid="ready-lines">
            {report.lines.map((line) => (
              <Line key={line.id} line={line} missing={report.missingMediaIds} />
            ))}
          </ul>
        )}
      </div>
      <div className="mt-3 text-sm text-muted" data-testid="ready-cannot-check">
        <p className="font-medium text-fg">What Ready? can’t check</p>
        <ul className="mt-1 list-disc pl-5">
          {READY_CANNOT_CHECK.map((words) => (
            <li key={words}>{words}</li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
