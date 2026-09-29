import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import type { PresentationSummary } from '../../../shared/library';
import { actionFor, LIBRARY_KEYMAP, shortcutText } from '../../../shared/keymap';
import { LANGS } from '../../../shared/model';
import { useEngine } from '../engine/engine-store';
import {
  cancelImport,
  dismissFinished,
  importPaths,
  importWithDialog,
  openReport,
  requestRemoval,
  undoRemoval,
  useImports,
} from '../library/import-store';
import { clickPresentation, useLibrary } from '../library/library-store';
import { Button } from '../ui/Button';
import { plural } from '../ui/text';
import { layoutRows, scrollToShow, visibleRows } from '../ui/virtual';

const trackLabel = { en: 'EN', gu: 'GU', hi: 'HI', translit: 'TR' } as const;

/** Rows in the list: a presentation, or a heading where a library starts. Fixed heights, so only rows in view are drawn. */
type Row = { kind: 'heading'; library: string } | { kind: 'item'; p: PresentationSummary; index: number };
const ITEM_HEIGHT = 60;
const HEADING_HEIGHT = 30;
/** Drawn beyond the visible part of the list, so scrolling never shows a gap. */
const MARGIN = 600;

const PresentationRow = memo(function PresentationRow({
  p,
  selected,
  marked,
  live,
  platform,
}: {
  p: PresentationSummary;
  selected: boolean;
  marked: boolean;
  live: boolean;
  platform: string;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      data-marked={marked ? 'true' : undefined}
      onClick={(e) => {
        clickPresentation(p.id, {
          toggle: platform === 'darwin' ? e.metaKey : e.ctrlKey,
          range: e.shiftKey,
        });
      }}
      className={`h-full w-full rounded-md px-3 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-accent ${
        selected
          ? 'bg-panel-2 ring-1 ring-accent'
          : marked
            ? 'bg-panel-2 ring-1 ring-line'
            : 'hover:bg-panel-2'
      }`}
    >
      <span className="flex items-center gap-2">
        {live && <span className="h-2 w-2 shrink-0 rounded-full bg-live" aria-label="Live" />}
        <span className="truncate text-sm font-medium">{p.name}</span>
      </span>
      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
        {p.slideCount} {p.slideCount === 1 ? 'slide' : 'slides'}
        {p.kirtanTracks &&
          LANGS.filter((l) => p.kirtanTracks?.includes(l)).map((l) => (
            <span key={l} className="rounded border border-line px-1 text-[10px]">
              {trackLabel[l]}
            </span>
          ))}
      </span>
    </button>
  );
});

function ImportMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const choose = (kind: 'files' | 'folder') => {
    setOpen(false);
    void importWithDialog(kind);
  };
  const item =
    'block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-line focus-visible:outline-2 focus-visible:outline-accent';
  return (
    <div className="relative" ref={ref}>
      <Button
        tone="ghost"
        className="px-2 py-1 text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        Import…
      </Button>
      {open && (
        <div
          role="menu"
          aria-label="Import"
          className="absolute right-0 z-30 mt-1 w-44 rounded-md border border-line bg-panel-2 p-1 shadow-xl"
        >
          <button type="button" role="menuitem" className={item} onClick={() => choose('files')}>
            Files…
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => choose('folder')}>
            A folder…
          </button>
        </div>
      )}
    </div>
  );
}

/** Progress while importing, what happened afterwards, and Undo after a removal. */
function ImportStatus({ platform }: { platform: string }) {
  const runs = useImports((s) => s.runs);
  const finished = useImports((s) => s.finished);
  const error = useImports((s) => s.error);
  const undoStack = useImports((s) => s.undoStack);
  const list = Object.values(runs);
  const active = list.find((r) => r.phase !== 'queued') ?? list[0];
  const waiting = list.length - (active ? 1 : 0);
  const lastRemoval = undoStack.at(-1);

  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-2 border-t border-line px-3 py-2 text-xs empty:hidden"
    >
      {active && (
        <div data-testid="import-progress" className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">
              {active.phase === 'queued'
                ? 'Waiting to import…'
                : active.phase === 'scanning'
                  ? 'Looking for files…'
                  : `Importing ${active.done.toLocaleString('en')} of ${active.total.toLocaleString('en')}${active.current ? ` · ${active.current}` : ''}`}
            </span>
            <Button
              tone="ghost"
              className="px-2 py-0.5 text-xs"
              onClick={() => void cancelImport(active.runId)}
            >
              Cancel
            </Button>
          </div>
          <div className="h-1 overflow-hidden rounded bg-line">
            <div
              className="h-full bg-accent transition-[width]"
              style={{ width: `${active.total > 0 ? Math.round((active.done / active.total) * 100) : 0}%` }}
            />
          </div>
          {waiting > 0 && <div className="text-muted">{plural(waiting, 'more import')} waiting</div>}
        </div>
      )}
      {!active && error && (
        <div className="flex items-start gap-2 text-amber-200">
          <span className="flex-1">{error}</span>
          <Button tone="ghost" className="px-2 py-0.5 text-xs" onClick={dismissFinished} aria-label="Dismiss">
            ×
          </Button>
        </div>
      )}
      {!active && !error && finished && (
        <div data-testid="import-result" className="space-y-1">
          <p>{describeRun(finished)}</p>
          <div className="flex gap-1">
            <Button className="px-2 py-0.5 text-xs" onClick={() => void openReport(finished.id)}>
              Report
            </Button>
            <Button tone="ghost" className="px-2 py-0.5 text-xs" onClick={dismissFinished}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
      {lastRemoval && (
        <div data-testid="undo-removal" className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">
            Removed{' '}
            {lastRemoval.names.length === 1
              ? `“${lastRemoval.names[0] ?? ''}”`
              : plural(lastRemoval.ids.length, 'presentation')}
          </span>
          <Button className="px-2 py-0.5 text-xs" onClick={() => void undoRemoval()}>
            Undo <kbd className="ml-1 text-muted">{shortcutText('undo', platform)}</kbd>
          </Button>
        </div>
      )}
    </div>
  );
}

export function describeRun(run: {
  status: string;
  totals: {
    presentations: number;
    media: number;
    skipped: number;
    conflicts: number;
    failed: number;
    unsupported: number;
  };
}): string {
  const t = run.totals;
  const parts: string[] = [];
  if (t.presentations > 0) parts.push(`Imported ${plural(t.presentations, 'presentation')}`);
  if (t.media > 0) parts.push(plural(t.media, 'media file'));
  if (t.skipped > 0) parts.push(`${t.skipped.toLocaleString('en')} already in the library`);
  if (t.conflicts > 0) parts.push(`${plural(t.conflicts, 'file')} changed: choose what to do`);
  if (t.failed > 0) parts.push(plural(t.failed, 'problem'));
  if (t.unsupported > 0) parts.push(`${plural(t.unsupported, 'item')} not imported`);
  if (run.status === 'cancelled') parts.push('cancelled');
  return parts.length > 0 ? parts.join(' · ') : 'Nothing to import';
}

export function PresentationList({ platform }: { platform: string }) {
  const presentations = useLibrary((s) => s.presentations);
  const selectedId = useLibrary((s) => s.selectedId);
  const marked = useLibrary((s) => s.marked);
  const liveId = useEngine((s) => s.state?.live.presentationId ?? null);
  const [dropping, setDropping] = useState(false);
  const [dropProblem, setDropProblem] = useState<string | null>(null);
  const depth = useRef(0);
  const markedSet = new Set(marked);
  const listRef = useRef<HTMLUListElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });

  // A heading where a library starts, when there is more than one (templates stay apart).
  const rows = useMemo(() => {
    const out: Row[] = [];
    const many = new Set(presentations.map((p) => p.libraryName)).size > 1;
    presentations.forEach((p, index) => {
      if (many && p.libraryName !== presentations[index - 1]?.libraryName) {
        out.push({ kind: 'heading', library: p.libraryName });
      }
      out.push({ kind: 'item', p, index });
    });
    return out;
  }, [presentations]);
  const heights = useMemo(
    () => rows.map((r) => (r.kind === 'heading' ? HEADING_HEIGHT : ITEM_HEIGHT)),
    [rows],
  );
  const layout = useMemo(() => layoutRows(heights), [heights]);
  const { start, end } = visibleRows(layout, view.top, view.height, MARGIN);

  useEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    const observer = new ResizeObserver(() => {
      setView({ top: ul.scrollTop, height: ul.clientHeight });
    });
    observer.observe(ul);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Bring a newly selected presentation into view (for example one opened from the import report).
  const latest = useRef({ rows, layout, heights });
  useEffect(() => {
    latest.current = { rows, layout, heights };
  });
  useEffect(() => {
    const ul = listRef.current;
    if (!ul || !selectedId) return;
    const { rows: now, layout: at, heights: sizes } = latest.current;
    const index = now.findIndex((r) => r.kind === 'item' && r.p.id === selectedId);
    const to = scrollToShow(at, sizes, index, ul.scrollTop, ul.clientHeight);
    if (to !== null) ul.scrollTop = to;
  }, [selectedId]);

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current++;
    setDropping(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDropping(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDropping(false);
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.drashti.files.pathFor(f))
      .filter((p) => p !== '');
    setDropProblem(paths.length === 0 ? 'Drop files or folders from the desktop or a USB drive.' : null);
    void importPaths(paths);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.repeat) return;
    if (actionFor(e.nativeEvent, platform, LIBRARY_KEYMAP) === 'removeSelected') {
      e.preventDefault();
      requestRemoval();
    }
  };

  return (
    <nav
      aria-label="Presentations"
      className="relative flex min-h-0 flex-col border-r border-line bg-panel"
      data-testid="library-drop"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted">Presentations</h2>
        <ImportMenu />
      </div>
      <ul
        ref={listRef}
        className="relative min-h-0 flex-1 overflow-y-auto"
        data-testid="presentation-list"
        data-count={presentations.length}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight });
        }}
      >
        {rows.slice(start, end).map((row, k) => {
          const i = start + k;
          const place = {
            position: 'absolute',
            top: layout.offsets[i],
            left: 8,
            right: 8,
            height: heights[i],
          } as const;
          if (row.kind === 'heading') {
            return (
              <li key={`library:${row.library}`} style={place}>
                <h3
                  data-testid="library-heading"
                  className="px-1 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted"
                >
                  {row.library}
                </h3>
              </li>
            );
          }
          const { p } = row;
          return (
            <li
              key={p.id}
              style={{ ...place, paddingBottom: 4 }}
              aria-setsize={presentations.length}
              aria-posinset={row.index + 1}
            >
              <PresentationRow
                p={p}
                selected={p.id === selectedId}
                marked={markedSet.has(p.id)}
                live={p.id === liveId}
                platform={platform}
              />
            </li>
          );
        })}
        {/* Gives the list its full height (and some room at the end), so it scrolls. */}
        <li aria-hidden="true" style={{ position: 'absolute', top: layout.total, height: 12, width: 1 }} />
      </ul>
      {dropProblem && <p className="px-3 pb-2 text-xs text-amber-200">{dropProblem}</p>}
      <ImportStatus platform={platform} />
      {dropping && (
        <div
          data-testid="drop-overlay"
          className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-black/70 p-4 text-center text-sm font-medium"
        >
          Drop lyrics, presentations or media to import them
        </div>
      )}
    </nav>
  );
}
