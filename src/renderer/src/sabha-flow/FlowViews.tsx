import { useEffect, useRef } from 'react';
import type { SabhaFlow, SabhaFlowStatus } from '../../../shared/sabha-flow';
import { flowLine, statusWords, textLang } from '../../../shared/sabha-flow-lines';
import { cx } from '../ui/cx';
import { Film } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { FlowLineWords, flowLineName } from './FlowNowNext';
import { keepInSight } from './keep-in-sight';

/*
 * The Sabha flow panel's views (alpha.23, QA23-FLOW-1 and QA23-FLOW-2), drawn from the flow alone so a test can draw
 * them: the read list (each numbered item as "1 · Program · Details · Duration · Presenter", a merged cell on each row
 * it covers, the total at the bottom, in the PDF's own language) and the plain words for a PDF Drashti could not read
 * (then only its page is shown); Now and Next up, with Back and Next, are FlowNowNext.tsx's. Operator window only:
 * nothing here reaches a screen or the stream. Shown as text, never spoken.
 */

export type { FlowView } from '../../../shared/sabha-flow-lines';
export { flowViews, statusWords } from '../../../shared/sabha-flow-lines';

export function FlowStatusNotice({
  status,
  tooMuchText,
}: {
  status: SabhaFlowStatus;
  tooMuchText?: boolean;
}) {
  const words = statusWords(status, tooMuchText === true);
  if (words === null) return null;
  return (
    <Notice tone="info" compact data-testid="flow-status">
      {words}
    </Notice>
  );
}

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
  const partsLang = mixed ? flow.lang : undefined;
  const langOf = (text: string) => (mixed ? textLang(text, flow.lang) : undefined);
  // Now kept in sight as Back and Next move it, by the list's own scrolling box alone (keep-in-sight.ts): the nearest
  // way, never a jump, and never the panel around it.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = box.current?.querySelector<HTMLElement>('[aria-current="step"]');
    const scroller = box.current?.parentElement;
    if (row && scroller) keepInSight(scroller, row);
  }, [now]);
  return (
    <div
      ref={box}
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
                aria-label={flowLineName(line)}
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
                  <FlowLineWords line={line} lang={partsLang} />
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
