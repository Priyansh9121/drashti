import { useEffect, useRef } from 'react';
import type { RemoteSimple } from '../../../../shared/network-phone';
import type { SabhaFlow, SabhaFlowLang } from '../../../../shared/sabha-flow';
import {
  flowLine,
  NEXT_LABEL,
  NOW_LABEL,
  nowNext,
  statusWords,
  textLang,
} from '../../../../shared/sabha-flow-lines';
import { FlowLineWords, FlowNowNext } from '../../sabha-flow/FlowNowNext';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Film,
  ListOrdered,
  Maximize2,
  Minus,
  Plus,
} from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import {
  closeFlow,
  FAILED,
  type FlowView,
  flowViews,
  loadFlowPage,
  openFlow,
  pictureKey,
  showFlowView,
  shownPages,
  startFlow,
  turnPage,
  useFlow,
  ZOOM_MAX,
  zoomBy,
  zoomFit,
} from './flow-store';
import { useFeed } from '../feed';
import { PhoneSheet } from './PhoneSheet';
import { useSimple } from './simple';

/*
 * Sabha flow on a phone (alpha.23, QA23-FLOW-1 and QA23-FLOW-2): in More, under The Drashti computer, the running
 * order the operator chose on the computer, read only: Now and, larger, Next up (a Video row as the video, "Last item"
 * after the last), the operator window's panel's own (sabha-flow/FlowNowNext.tsx), and Open Sabha flow…, a sheet
 * with the read list (each item as "1 · Program · Details · Duration · Presenter", in the PDF's own language, a merged
 * cell on each row it covers, Now and Next up marked, the total at the bottom) and the PDF page, zoomed from the
 * screen's width. Both follow the computer: another PDF chosen, it removed, Now marked. Plain words when there is no
 * flow, or its words could not be read (its page only, then). Never on a screen; shown as text, never spoken. Simple
 * Mode on the computer: shown only while Sabha flow is chosen in Simple Mode Features (flowOnPhone).
 */

/** The phone's words. */
export const FLOW_PHONE_WORDS = {
  title: 'Sabha flow',
  none: 'There is no Sabha flow yet. The operator chooses its PDF on the Drashti computer, in its Sabha flow panel.',
  reading: 'Reading the Sabha flow…',
  open: 'Open Sabha flow…',
  list: 'Read list',
  page: 'PDF page',
  drawing: 'Getting the page…',
  noPage: 'This page could not be shown. The read list still follows the computer.',
  /** A PDF with more pages than Drashti drew (20 at most). */
  firstPages: (n: number) =>
    n === 1
      ? 'Only the first page of this PDF is shown.'
      : `Only the first ${String(n)} pages of this PDF are shown.`,
} as const;

/** A part's lang: the PDF's own, each part's by its script in a mixed one. */
const langOf = (lang: SabhaFlowLang) => (text: string) => textLang(text, lang);

/**
 * Whether the phone shows the Sabha flow: in Pro Mode, and in Simple Mode only while Sabha flow is chosen in Simple
 * Mode Features, as the window shows it (QA23-FLOWP-1, answered by lead, owner away).
 */
export const flowOnPhone = (simple: RemoteSimple | null): boolean =>
  simple === null || simple.features?.includes('sabha-flow') === true;

/** What the phone has of the flow, as its store keeps it (flow-store.ts). */
export type FlowShown = Pick<
  ReturnType<typeof useFlow.getState>,
  'snapshot' | 'problem' | 'view' | 'page' | 'zoom' | 'pictures'
>;

/** In More: the flow, read from the phone's store; in Simple Mode only while it is one of Simple Mode's tools. */
export function FlowSection() {
  const snapshot = useFlow((s) => s.snapshot);
  const problem = useFlow((s) => s.problem);
  const sheetOpen = useFlow((s) => s.open);
  const shown = flowOnPhone(useSimple());
  return shown ? <FlowSectionView snapshot={snapshot} problem={problem} sheetOpen={sheetOpen} /> : null;
}

/** Why the flow could not be read again, beside the flow last read. */
function ReadAgain({ problem }: { problem: string | null }) {
  return problem ? (
    <p className="text-base text-muted" role="status" data-testid="remote-flow-problem">
      {problem}
    </p>
  ) : null;
}

/** In More: the flow's file, Now and Next up, and the sheet's button; or plain words. */
export function FlowSectionView({
  snapshot,
  problem,
  sheetOpen = false,
}: Pick<FlowShown, 'snapshot' | 'problem'> & {
  /** The Sabha flow's sheet is over More: its Now and Next up is said to a screen reader, not this one. */
  sheetOpen?: boolean;
}) {
  const flow = snapshot?.flow ?? null;
  const said = flow ? statusWords(flow.status) : null;
  return (
    <section className="space-y-2" aria-labelledby="remote-flow-title" data-testid="remote-flow">
      <h2 id="remote-flow-title" className="text-base font-bold tracking-wider text-muted uppercase">
        {FLOW_PHONE_WORDS.title}
      </h2>
      {snapshot === null ? (
        problem ? (
          <p className="text-base text-muted" data-testid="remote-flow-problem">
            {problem}
          </p>
        ) : (
          <p role="status" className="text-base text-muted">
            {FLOW_PHONE_WORDS.reading}
          </p>
        )
      ) : flow === null ? (
        <p className="text-base text-muted" data-testid="remote-flow-none">
          {FLOW_PHONE_WORDS.none}
        </p>
      ) : (
        <>
          <p
            className="text-base [overflow-wrap:anywhere] text-fg"
            translate="no"
            data-testid="remote-flow-file"
          >
            {flow.fileName}
          </p>
          <ReadAgain problem={problem} />
          {said === null ? (
            <FlowNowNext flow={flow} now={snapshot.state?.now ?? null} size="phone" live={!sheetOpen} />
          ) : (
            <p className="text-base text-muted" data-testid="remote-flow-said">
              {said}
            </p>
          )}
          <Button
            size="lg"
            className="min-h-12 w-full"
            icon={ListOrdered}
            data-testid="remote-open-flow"
            onClick={openFlow}
          >
            {FLOW_PHONE_WORDS.open}
          </Button>
        </>
      )}
    </section>
  );
}

const VIEW_ICON = { list: ListOrdered, page: FileText } as const;

function ViewSwitch({ views, view }: { views: FlowView[]; view: FlowView }) {
  return (
    <div role="tablist" aria-label="What the Sabha flow shows" className="grid grid-cols-2 gap-2">
      {views.map((v) => {
        const ViewIcon = VIEW_ICON[v];
        const on = v === view;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={on}
            data-testid={`remote-flow-view-${v}`}
            onClick={() => {
              showFlowView(v);
            }}
            className={cx(
              'flex min-h-12 items-center justify-center gap-2 rounded-lg border px-3 text-base',
              on ? 'border-line-strong bg-panel-3 font-bold text-fg' : 'border-line bg-panel-2 text-muted',
            )}
          >
            <ViewIcon size={18} aria-hidden="true" />
            {FLOW_PHONE_WORDS[v]}
          </button>
        );
      })}
    </div>
  );
}

/** The read list: the title and subtitle, each item (Now and Next up marked), and the total at the bottom. */
function ReadList({ flow, now }: { flow: SabhaFlow; now: number | null }) {
  const nn = nowNext(flow, now);
  const at = nn.now?.index ?? null;
  const next = nn.next?.index ?? null;
  const of = langOf(flow.lang);
  const nowRow = useRef<HTMLLIElement>(null);
  // Now in view as the list opens and as Now moves on the computer.
  useEffect(() => {
    nowRow.current?.scrollIntoView({ block: 'nearest' });
  }, [at]);
  return (
    <div className="space-y-3" translate="no" data-testid="remote-flow-list">
      {(flow.title !== undefined || flow.subtitle !== undefined) && (
        <div className="space-y-1">
          {flow.title !== undefined && (
            <p className="text-lg font-bold break-words text-fg" lang={of(flow.title)}>
              {flow.title}
            </p>
          )}
          {flow.subtitle !== undefined && (
            <p className="text-base break-words text-muted" lang={of(flow.subtitle)}>
              {flow.subtitle}
            </p>
          )}
        </div>
      )}
      <ol aria-label="Sabha flow items" className="space-y-2">
        {flow.items.map((item, i) => {
          const line = flowLine(flow, i, 'full');
          if (!line) return null;
          const isNow = i === at;
          const isNext = i === next;
          return (
            <li
              key={`${String(i)}-${item.no}`}
              ref={isNow ? nowRow : undefined}
              data-testid="remote-flow-row"
              aria-current={isNow ? 'step' : undefined}
              data-next={isNext ? 'true' : undefined}
              className={cx(
                'flex items-start gap-2 rounded-lg border px-3 py-2 text-base break-words',
                isNow
                  ? 'border-live bg-panel-3 font-bold text-fg'
                  : isNext
                    ? 'border-line-strong bg-panel-2 text-fg'
                    : 'border-line bg-panel-2 text-fg',
              )}
            >
              {line.video && <Film size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />}
              <span className="min-w-0 flex-1">
                {(isNow || isNext) && (
                  <span className="block text-base font-bold text-muted" lang="en" translate="yes">
                    {isNow ? NOW_LABEL : NEXT_LABEL}
                  </span>
                )}
                <FlowLineWords line={line} lang={flow.lang} />
              </span>
            </li>
          );
        })}
      </ol>
      {flow.total !== undefined && (
        <p
          className="border-t border-line pt-3 text-base font-bold break-words text-fg"
          lang={of(flow.total)}
          data-testid="remote-flow-total"
        >
          {flow.total}
        </p>
      )}
    </div>
  );
}

/** The PDF page, as the computer drew it: from the screen's width, zoomed up to four times, a page at a time. */
function PageView({
  flow,
  page,
  zoom,
  picture,
}: {
  flow: SabhaFlow;
  page: number;
  zoom: number;
  /** A blob URL, FAILED, or undefined while it is fetched. */
  picture: string | undefined;
}) {
  // Asked again once the phone is back on Drashti's network (a page not reached is not marked as failed).
  const online = useFeed((s) => s.state === 'online');
  useEffect(() => {
    if (online) void loadFlowPage(flow.id, page);
  }, [flow.id, page, online]);
  // The pages drawn (at most 20), never the PDF's own count.
  const count = shownPages(flow);
  const shown = `Page ${String(page + 1)} of ${String(count)}`;
  return (
    <div className="space-y-3" data-testid="remote-flow-page">
      {flow.pageCount > count && (
        <p className="text-base text-muted" data-testid="remote-flow-first-pages">
          {FLOW_PHONE_WORDS.firstPages(count)}
        </p>
      )}
      {count > 1 && (
        <div className="flex items-center gap-2">
          <Button
            size="lg"
            className="min-h-12"
            icon={ChevronLeft}
            aria-label="Previous page"
            data-testid="remote-flow-previous-page"
            disabled={page === 0}
            onClick={() => {
              turnPage(-1);
            }}
          >
            Page
          </Button>
          <p
            className="min-w-0 flex-1 text-center text-base text-muted"
            data-testid="remote-flow-page-number"
          >
            {shown}
          </p>
          <Button
            size="lg"
            className="min-h-12"
            iconEnd={ChevronRight}
            aria-label="Next page"
            data-testid="remote-flow-next-page"
            disabled={page >= count - 1}
            onClick={() => {
              turnPage(1);
            }}
          >
            Page
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="lg"
          className="min-h-12"
          icon={Minus}
          data-testid="remote-flow-zoom-out"
          disabled={zoom <= 1}
          onClick={() => {
            zoomBy(-1);
          }}
        >
          Smaller
        </Button>
        <Button
          size="lg"
          className="min-h-12"
          icon={Plus}
          data-testid="remote-flow-zoom-in"
          disabled={zoom >= ZOOM_MAX}
          onClick={() => {
            zoomBy(1);
          }}
        >
          Larger
        </Button>
        <Button
          size="lg"
          className="min-h-12"
          icon={Maximize2}
          data-testid="remote-flow-zoom-fit"
          disabled={zoom === 1}
          onClick={zoomFit}
        >
          Fit
        </Button>
      </div>
      <div
        className="max-h-[70dvh] overflow-auto rounded-lg border border-line bg-panel-2"
        data-testid="remote-flow-page-box"
        data-zoom={zoom}
      >
        {picture === undefined ? (
          <p role="status" className="p-4 text-base text-muted">
            {FLOW_PHONE_WORDS.drawing}
          </p>
        ) : picture === FAILED ? (
          <p className="p-4 text-base text-muted" data-testid="remote-flow-no-page">
            {FLOW_PHONE_WORDS.noPage}
          </p>
        ) : (
          <img
            src={picture}
            alt={`${shown} of the Sabha flow`}
            data-testid="remote-flow-picture"
            data-a11y-picture
            className="block h-auto max-w-none bg-white"
            style={{ width: `${String(zoom * 100)}%` }}
          />
        )}
      </div>
    </div>
  );
}

/** The sheet: the flow's file, Now and Next up, and its read list or its PDF page; or plain words. */
export function FlowSheetView({ snapshot, problem, view, page, zoom, pictures }: FlowShown) {
  const flow = snapshot?.flow ?? null;
  const views = flowViews(flow);
  const said = flow ? statusWords(flow.status) : null;
  return (
    <PhoneSheet title={FLOW_PHONE_WORDS.title} onClose={closeFlow} testId="remote-flow-sheet">
      {flow === null ? (
        <p className="text-base text-muted" data-testid="remote-flow-sheet-none">
          {snapshot === null ? (problem ?? FLOW_PHONE_WORDS.reading) : FLOW_PHONE_WORDS.none}
        </p>
      ) : (
        <>
          <p
            className="text-base [overflow-wrap:anywhere] text-muted"
            translate="no"
            data-testid="remote-flow-sheet-file"
          >
            {flow.fileName}
          </p>
          <ReadAgain problem={problem} />
          {said === null ? (
            <FlowNowNext flow={flow} now={snapshot?.state?.now ?? null} size="phone" />
          ) : (
            <Notice tone="info" data-testid="remote-flow-status">
              {said}
            </Notice>
          )}
          {views.length > 1 && <ViewSwitch views={views} view={view} />}
          {view === 'list' && views.includes('list') ? (
            <ReadList flow={flow} now={snapshot?.state?.now ?? null} />
          ) : (
            <PageView
              key={flow.id}
              flow={flow}
              page={page}
              zoom={zoom}
              picture={pictures[pictureKey(flow.id, page)]}
            />
          )}
        </>
      )}
    </PhoneSheet>
  );
}

/** Over the remote: the Sabha flow's sheet while it is open; and the phone follows the flow. Mounted once. */
export function FlowLayer() {
  const open = useFlow((s) => s.open);
  // In Simple Mode only while it is one of Simple Mode's tools, as in More.
  const shown = flowOnPhone(useSimple());
  useEffect(() => {
    startFlow();
  }, []);
  return open && shown ? <FlowSheet /> : null;
}

function FlowSheet() {
  const snapshot = useFlow((s) => s.snapshot);
  const problem = useFlow((s) => s.problem);
  const view = useFlow((s) => s.view);
  const page = useFlow((s) => s.page);
  const zoom = useFlow((s) => s.zoom);
  const pictures = useFlow((s) => s.pictures);
  return (
    <FlowSheetView
      snapshot={snapshot}
      problem={problem}
      view={view}
      page={page}
      zoom={zoom}
      pictures={pictures}
    />
  );
}
