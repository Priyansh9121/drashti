import type { SabhaFlow, SabhaFlowLang, SabhaFlowStatus } from '../../../shared/sabha-flow';
import type { FlowLine } from '../../../shared/sabha-flow-lines';
import {
  flowLine,
  LAST_ITEM,
  NEXT_LABEL,
  NOT_STARTED,
  NOTHING_NEXT,
  NOW_LABEL,
  nowNext,
  textLang,
} from '../../../shared/sabha-flow-lines';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { ChevronLeft, ChevronRight, Film } from '../ui/icons';
import { Notice } from '../ui/Notice';

/*
 * The Sabha flow panel's views (alpha.23, QA23-FLOW-1 and QA23-FLOW-2), drawn from the flow alone so a test can draw
 * them: the read list (each numbered item as "1 · Program · Details · Duration · Presenter", a merged cell on each row
 * it covers, the total at the bottom, in the PDF's own language), Now and Next up with Back and Next, and the plain
 * words for a PDF Drashti could not read (then only its page is shown). Operator window only: nothing here reaches a
 * screen or the stream. Shown as text, never spoken.
 */

export type FlowView = 'list' | 'page';

/** The views a flow has: its read list and page, or only its page when nothing could be read from it. */
export const flowViews = (status: SabhaFlowStatus): FlowView[] =>
  status === 'read' ? ['list', 'page'] : ['page'];

/** Why there is no read list, in plain words; null when it was read. */
export function statusWords(status: SabhaFlowStatus): string | null {
  switch (status) {
    case 'no-text':
      return 'This PDF has no words Drashti can read: it may be a scan, or pictures of pages. Its page is shown instead.';
    case 'unreadable':
      return 'Drashti couldn’t read this PDF’s words: its fonts don’t say which letters they draw, so they come out wrong. Its page is shown instead.';
    case 'no-items':
      return 'Drashti read this PDF but found no numbered items in it. Its page is shown instead.';
    case 'read':
      return null;
  }
}

export function FlowStatusNotice({ status }: { status: SabhaFlowStatus }) {
  const words = statusWords(status);
  if (words === null) return null;
  return (
    <Notice tone="info" compact data-testid="flow-status">
      {words}
    </Notice>
  );
}

/**
 * A line's number and parts, with a middle dot between them that a screen reader skips, reading a comma instead.
 * `langOf` gives each part's lang attribute (none: the surrounding one).
 */
function LineWords({ line, langOf }: { line: FlowLine; langOf: (text: string) => string | undefined }) {
  return (
    <>
      <span lang={langOf(line.no)}>{line.no}</span>
      {line.parts.map((part, i) => (
        <span key={i}>
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, </span>
          <span lang={langOf(part)}>{part}</span>
        </span>
      ))}
    </>
  );
}

/** Each part's own lang, always (inside Drashti's English words). */
const ownLang = (lang: SabhaFlowLang) => (text: string) => textLang(text, lang);

/** The read list: the title and subtitle, each item as a row (a click marks it Now), and the total at the bottom. */
export function FlowReadList({
  flow,
  now,
  onPick,
}: {
  flow: SabhaFlow;
  now: number | null;
  onPick: (index: number) => void;
}) {
  const mixed = flow.lang === 'mixed';
  // The PDF's language on the whole list; in a mixed one, on each part.
  const langOf = mixed ? ownLang(flow.lang) : () => undefined;
  return (
    <div
      lang={mixed ? undefined : flow.lang}
      className="flex flex-col gap-2 px-2 py-2"
      data-testid="flow-read-list"
    >
      {(flow.title !== undefined || flow.subtitle !== undefined) && (
        <div className="px-1">
          {flow.title !== undefined && (
            <p className="text-sm font-bold break-words" lang={langOf(flow.title)}>
              {flow.title}
            </p>
          )}
          {flow.subtitle !== undefined && (
            <p className="text-xs break-words text-muted" lang={langOf(flow.subtitle)}>
              {flow.subtitle}
            </p>
          )}
        </div>
      )}
      <ol aria-label="Sabha flow items" className="flex flex-col gap-0.5">
        {flow.items.map((item, i) => {
          const line = flowLine(flow, i, 'full');
          if (!line) return null;
          const isNow = i === now;
          return (
            <li key={`${String(i)}-${item.no}`}>
              <button
                type="button"
                data-testid="flow-row"
                aria-current={isNow ? 'step' : undefined}
                onClick={() => {
                  onPick(i);
                }}
                className={cx(
                  'flex w-full min-w-0 items-start gap-1.5 rounded-sm border px-2 py-1 text-left text-sm break-words',
                  isNow
                    ? 'border-accent bg-accent/15 font-bold text-fg'
                    : 'border-transparent text-fg hover:bg-panel-2',
                )}
              >
                {line.video && <Film size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />}
                <span className="min-w-0 flex-1">
                  <LineWords line={line} langOf={langOf} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {flow.total !== undefined && (
        <p
          data-testid="flow-total"
          className="border-t border-line px-1 pt-2 text-sm font-bold break-words"
          lang={langOf(flow.total)}
        >
          {flow.total}
        </p>
      )}
    </div>
  );
}

/**
 * Now and, larger, Next up (QA23-FLOW-2), with Back and Next to move Now by one item. Before anything is Now, Next up
 * is the first item and Back is off; on the last item Next up says "Last item" and Next is off. A change is said to a
 * screen reader.
 */
export function FlowNowNext({
  flow,
  now,
  onBack,
  onNext,
}: {
  flow: SabhaFlow;
  now: number | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const nn = nowNext(flow, now);
  const langOf = ownLang(flow.lang);
  return (
    <div className="flex flex-col gap-2 border-b border-line px-3 py-2" data-testid="flow-now-next">
      <div aria-live="polite" aria-atomic="true" className="min-w-0">
        <p data-testid="flow-now" className="text-xs break-words text-muted">
          {NOW_LABEL}: {nn.now ? <LineWords line={nn.now} langOf={langOf} /> : NOT_STARTED}
        </p>
        <p
          data-testid="flow-next"
          className="mt-0.5 flex items-start gap-1.5 text-base font-bold break-words text-fg"
          data-video={nn.next?.video === true ? 'true' : undefined}
        >
          {nn.next?.video === true && <Film size={16} aria-hidden="true" className="mt-1 shrink-0" />}
          <span className="min-w-0 flex-1">
            {nn.last ? (
              LAST_ITEM
            ) : (
              <>
                {NEXT_LABEL}: {nn.next ? <LineWords line={nn.next} langOf={langOf} /> : NOTHING_NEXT}
              </>
            )}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          icon={ChevronLeft}
          aria-label="Back one item"
          data-testid="flow-back-button"
          disabled={nn.now === null}
          onClick={onBack}
        >
          Back
        </Button>
        <Button
          size="sm"
          iconEnd={ChevronRight}
          aria-label="Next item"
          data-testid="flow-next-button"
          disabled={nn.next === null}
          onClick={onNext}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
