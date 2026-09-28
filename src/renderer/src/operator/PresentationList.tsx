import { useEffect, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
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

const trackLabel = { en: 'EN', gu: 'GU', hi: 'HI', translit: 'TR' } as const;

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
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3"
        data-testid="presentation-list"
        onKeyDown={onKeyDown}
      >
        {presentations.map((p) => {
          const selected = p.id === selectedId;
          const isMarked = markedSet.has(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                data-marked={isMarked ? 'true' : undefined}
                onClick={(e) => {
                  clickPresentation(p.id, {
                    toggle: platform === 'darwin' ? e.metaKey : e.ctrlKey,
                    range: e.shiftKey,
                  });
                }}
                className={`w-full rounded-md px-3 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-accent ${
                  selected
                    ? 'bg-panel-2 ring-1 ring-accent'
                    : isMarked
                      ? 'bg-panel-2 ring-1 ring-line'
                      : 'hover:bg-panel-2'
                }`}
              >
                <span className="flex items-center gap-2">
                  {p.id === liveId && (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-live" aria-label="Live" />
                  )}
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
            </li>
          );
        })}
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
