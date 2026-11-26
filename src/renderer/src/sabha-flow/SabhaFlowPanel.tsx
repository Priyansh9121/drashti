import { useEffect, useId, useLayoutEffect, useState } from 'react';
import { droppedPaths, hasFiles } from '../playlists/drag';
import { NO_FLOW } from '../../../shared/sabha-flow-lines';
import { useWhatIsThis } from '../help/WhatIsThis';
import { useOperateOnly } from '../simple/simple-features-store';
import { Button, IconButton } from '../ui/Button';
import { ConfirmDialog } from '../ui/Dialog';
import { ChevronDown, ChevronRight, FileText, ListOrdered, RefreshCw, Trash2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { EmptyState, Loading } from '../ui/States';
import { TabPanel, Tabs } from '../ui/Tabs';
import { FlowNowNext } from './FlowNowNext';
import type { FlowView } from './FlowViews';
import { FlowReadList, FlowStatusNotice, flowViews } from './FlowViews';
import { FlowPage } from './FlowPage';
import {
  chooseFlow,
  dropFlowFiles,
  cancelDroppedFlow,
  confirmDroppedFlow,
  connectFlow,
  flowBack,
  flowNext,
  removeFlow,
  setFlowNow,
  setFlowPanelOpen,
  useFlow,
  useFlowPanel,
  setFlowNeed,
} from './flow-store';

/*
 * The "Sabha flow" panel (alpha.23, QA23-FLOW-1 and QA23-FLOW-2; the owner: "a different window on left side with
 * toggle button saying sabha flow"): at the top of the operator window's left column, under the Library button. Its
 * heading is the toggle, folding it as the other sections fold, and whether it is open is remembered on this computer.
 * Open, it holds the PDF chosen with Choose PDF… (Replace… and Remove beside its name), Now and Next up with Back and
 * Next, and two views: the read list (each numbered item as a row; a click marks it Now) and the PDF page (zoomable).
 * A PDF Drashti could not read says so, and shows its page only. Never on an audience or stage screen. In Simple Mode
 * (when chosen in Simple Mode Features…) it leaves out Choose PDF…, Replace… and Remove: the PDF is chosen in Pro Mode.
 */

const TABS: { id: FlowView; label: string }[] = [
  { id: 'list', label: 'Read list' },
  { id: 'page', label: 'PDF page' },
];

export function SabhaFlowPanel() {
  const open = useFlowPanel((s) => s.open);
  const setup = !useOperateOnly();
  const [dragging, setDragging] = useState(false);
  const dropped = useFlow((s) => s.dropped);
  const flow = useFlow((s) => s.flow);
  const titleId = useId();
  const bodyId = useId();
  const help = useWhatIsThis('sabhaflow', { compact: true });
  useEffect(() => {
    connectFlow();
  }, []);
  // What the panel needs to show Now and Next up whole (its heading, the body's pinned part and the read list's own
  // room): the left column gives it that much of its height when it may (operator/flow-area.ts), never cutting words.
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const headerHeight = useHeightOf(header);
  const [bodyNeed, setBodyNeed] = useState(0);
  useEffect(() => {
    // The area's border under it (1 px) is in its height.
    setFlowNeed(open && bodyNeed > 0 ? Math.ceil(headerHeight + bodyNeed + 1) : 0);
  }, [open, headerHeight, bodyNeed]);
  useEffect(
    () => () => {
      setFlowNeed(0);
    },
    [],
  );
  return (
    <section
      aria-labelledby={titleId}
      className="relative flex min-h-0 flex-1 flex-col"
      data-testid="sabha-flow"
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setDragging(true);
      }}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        setFlowPanelOpen(true);
        dropFlowFiles(droppedPaths(e), setup);
      }}
    >
      {dragging && (
        <div
          data-testid="flow-drop-overlay"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-heading bg-panel p-3 text-center text-sm text-fg"
        >
          {setup ? 'Drop the PDF to use it as the running order' : 'The running order is chosen in Pro Mode'}
        </div>
      )}
      {dropped && (
        <ConfirmDialog
          title="Replace the running order?"
          confirmLabel="Replace"
          testId="flow-replace-confirm"
          onCancel={cancelDroppedFlow}
          onConfirm={confirmDroppedFlow}
        >
          <p>
            Use “{dropped.name}” instead of “{flow?.fileName}”? Now will start again.
          </p>
        </ConfirmDialog>
      )}
      <header
        ref={setHeader}
        className="flex min-h-9 shrink-0 items-center gap-1 py-1 pr-3 pl-3"
        data-strip=""
      >
        <h2 id={titleId} className="min-w-0 flex-1 text-2xs font-bold tracking-wider text-heading uppercase">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            data-testid="sabha-flow-toggle"
            onClick={() => {
              setFlowPanelOpen(!open);
            }}
            // 24 px tall at least (WCAG 2.5.8): What is this? sits beside it.
            className="-ml-1 flex min-h-6 max-w-full min-w-0 items-center gap-0.5 rounded-sm px-1 py-0.5 tracking-wider uppercase hover:text-fg"
          >
            {open ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )}
            <span className="flex min-w-0 items-center gap-1.5">
              <ListOrdered size={14} aria-hidden="true" className="shrink-0 text-heading" />
              <span className="truncate">Sabha flow</span>
            </span>
          </button>
        </h2>
        {help.button}
      </header>
      {help.card}
      {open && (
        <div
          id={bodyId}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          data-testid="sabha-flow-body"
        >
          <FlowBody onNeed={setBodyNeed} />
        </div>
      )}
    </section>
  );
}

/**
 * An element's height (its border box, px), kept current from when it is there: 0 while there is none. A
 * ResizeObserver says the size as soon as it starts observing, and on every change after.
 */
function useHeightOf(el: HTMLElement | null): number {
  const [measured, setMeasured] = useState<{ el: HTMLElement; height: number } | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setMeasured({ el, height: el.getBoundingClientRect().height });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [el]);
  return el !== null && measured?.el === el ? measured.height : 0;
}

/** The read list's own least room under the pinned part (its min-h-24), the page view's (min-h-48). */
const LIST_ROOM = 96;
const PAGE_ROOM = 192;

function FlowBody({ onNeed }: { onNeed: (px: number) => void }) {
  const flow = useFlow((s) => s.flow);
  const now = useFlow((s) => s.now);
  const loaded = useFlow((s) => s.loaded);
  const choosing = useFlow((s) => s.choosing);
  const problem = useFlow((s) => s.problem);
  const note = useFlow((s) => s.note);
  // Choose PDF…, Replace… and Remove set the flow up: Pro Mode's (Simple Mode shows it, and marks Now).
  const setup = !useOperateOnly();
  // The view chosen, for the flow it was chosen for: a new PDF opens on its read list (or its page, when nothing could
  // be read from it).
  const [chosen, setChosen] = useState<{ flowId: string; view: FlowView } | null>(null);
  const [removing, setRemoving] = useState(false);
  const views = flow ? flowViews(flow.status) : [];
  const view: FlowView = chosen !== null && chosen.flowId === flow?.id ? chosen.view : 'list';
  const shown: FlowView = views.includes(view) ? view : 'page';
  const setView = (next: FlowView) => {
    if (flow) setChosen({ flowId: flow.id, view: next });
  };

  const problemNotice = problem !== null && (
    <Notice
      tone="warning"
      compact
      className="mx-3 mt-2"
      data-testid="flow-problem"
      onDismiss={() => {
        useFlow.setState({ problem: null });
      }}
    >
      {problem}
    </Notice>
  );

  // Now and Next up whole: the pinned part's height and the room under it, for a flow that was read (none to keep whole
  // otherwise: the panel keeps its share).
  // Measured from when the part is there (it comes only once the flow is read; useElementSize binds at mount).
  const [pinned, setPinned] = useState<HTMLDivElement | null>(null);
  const pinnedHeight = useHeightOf(pinned);
  // Only once Now and Next up's room is set (their faces loaded): until then the panel keeps its share, so the area
  // changes once, before Now and Next can be used, and never after while this flow is current.
  const [measured, setMeasured] = useState(false);
  const keepWhole = flow?.status === 'read' && pinnedHeight > 0 && measured;
  const need = keepWhole ? pinnedHeight + (shown === 'list' ? LIST_ROOM : PAGE_ROOM) : 0;
  useEffect(() => {
    onNeed(need);
  }, [need, onNeed]);

  if (!loaded) return <Loading label="Reading the Sabha flow…" />;
  if (flow === null)
    return (
      <>
        {problemNotice}
        <EmptyState
          icon={ListOrdered}
          title={NO_FLOW}
          compact
          data-testid="flow-empty"
          action={
            setup ? (
              <Button
                size="sm"
                icon={FileText}
                data-testid="flow-choose"
                disabled={choosing}
                onClick={() => void chooseFlow()}
              >
                Choose PDF…
              </Button>
            ) : undefined
          }
        >
          {setup
            ? 'Choose the sabha’s running order as a PDF: Drashti reads its numbered items and shows them here, with Now and Next up. Only this window and a paired phone show it, never the screens.'
            : 'The sabha’s running order is chosen in Pro Mode, with Choose PDF… in its Sabha flow.'}
        </EmptyState>
        {choosing && <Loading label="Reading the PDF…" immediate />}
      </>
    );

  return (
    <>
      {/* The pinned part: the file, Now and Next up and the view's tabs; only the read list (or the page) scrolls. */}
      <div ref={setPinned} className="flex shrink-0 flex-col">
        <div className="flex shrink-0 items-center gap-1 px-3 pt-1">
          <FileText size={14} aria-hidden="true" className="shrink-0 text-muted" />
          <span
            className="min-w-0 flex-1 truncate text-xs text-muted"
            title={flow.fileName}
            data-testid="flow-file"
          >
            {flow.fileName}
          </span>
          {setup && (
            <>
              <IconButton
                icon={RefreshCw}
                size="sm"
                label="Replace… (choose another PDF)"
                data-testid="flow-replace"
                disabled={choosing}
                onClick={() => void chooseFlow()}
              />
              <IconButton
                icon={Trash2}
                size="sm"
                label="Remove the Sabha flow"
                data-testid="flow-remove"
                disabled={choosing}
                onClick={() => {
                  setRemoving(true);
                }}
              />
            </>
          )}
        </div>
        {flow.status !== 'read' && (
          <div className="shrink-0 px-3 pt-2">
            <FlowStatusNotice status={flow.status} tooMuchText={flow.tooMuchText === true} />
          </div>
        )}
        {flow.status === 'read' && (
          <FlowNowNext
            flow={flow}
            now={now}
            size="panel"
            onBack={flowBack}
            onNext={flowNext}
            onMeasured={setMeasured}
          />
        )}
        {views.length > 1 && (
          <Tabs
            group="sabha-flow"
            label="Sabha flow view"
            size="sm"
            items={TABS}
            value={shown}
            onChange={setView}
            className="shrink-0 px-3 pt-1"
          />
        )}
      </div>
      {/* A choice still being read and a problem to say come under the pinned part, in the list's room: they come and go
          without moving Now and Next up, the splitter or the playlists (lead 2, CI 8967). */}
      {choosing && <Loading label="Reading the PDF…" immediate className="shrink-0 py-1" />}
      {problemNotice}
      {note && (
        <Notice compact className="mx-3 mt-2" data-testid="flow-note">
          {note}
        </Notice>
      )}
      {views.length > 1 ? (
        // The read list scrolls on its own, Now and Next up staying in view above it; the page view has its own.
        <TabPanel
          group="sabha-flow"
          id={shown}
          className={shown === 'list' ? 'min-h-24 flex-1 overflow-y-auto' : 'flex min-h-48 flex-1 flex-col'}
        >
          {shown === 'list' ? (
            <FlowReadList flow={flow} now={now} onPick={(i) => void setFlowNow(i)} />
          ) : (
            <FlowPage key={flow.id} flow={flow} />
          )}
        </TabPanel>
      ) : (
        <div className="flex min-h-48 flex-1 flex-col pt-1">
          <FlowPage key={flow.id} flow={flow} />
        </div>
      )}
      {removing && (
        <ConfirmDialog
          title="Remove the Sabha flow?"
          confirmLabel="Remove"
          testId="flow-remove-confirm"
          onCancel={() => {
            setRemoving(false);
          }}
          onConfirm={() => {
            setRemoving(false);
            void removeFlow();
          }}
        >
          <p>
            Drashti’s copy of “{flow.fileName}” and what it read from it go, with Now. The PDF you chose stays
            where it is.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
