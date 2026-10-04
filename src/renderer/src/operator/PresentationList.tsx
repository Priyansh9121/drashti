import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import type { PresentationSummary } from '../../../shared/library';
import { actionFor, LIBRARY_KEYMAP } from '../../../shared/keymap';
import { LANGS } from '../../../shared/model';
import { LANG_SHORT } from '../../../shared/themes';
import { useEngine } from '../engine/engine-store';
import { importPaths, importWithDialog, requestRemoval } from '../library/import-store';
import {
  clearSearch,
  clickPresentation,
  openHit,
  setLibraryTab,
  setSearch,
  useLibrary,
  useLibraryTab,
  useSearch,
} from '../library/library-store';
import { ShastraPanel } from '../shastra/ShastraPanel';
import { SearchResults } from '../library/SearchResults';
import { applyFilters, filtering, KirtanFilters, toggleFilters, useFilters } from '../library/KirtanFilters';
import { newFromWords } from '../library/words-store';
import { MediaList } from '../library/MediaList';
import { startDrag } from '../playlists/drag';
import { Badge, LiveBadge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { TextInput } from '../ui/Field';
import {
  BookOpen,
  FileText,
  FolderOpen,
  Image,
  Import,
  ListFilter,
  Plus,
  Presentation,
  Search,
  Upload,
} from '../ui/icons';
import { MenuButton } from '../ui/Menu';
import { Notice } from '../ui/Notice';
import { rowClass } from '../ui/ListRow';
import { EmptyState } from '../ui/States';
import { TabPanel, Tabs } from '../ui/Tabs';
import { Truncate } from '../ui/Truncate';
import { layoutRows, scrollToShow, visibleRows } from '../ui/virtual';

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
      draggable
      aria-current={selected ? 'true' : undefined}
      data-marked={marked ? 'true' : undefined}
      onClick={(e) => {
        clickPresentation(p.id, {
          toggle: platform === 'darwin' ? e.metaKey : e.ctrlKey,
          range: e.shiftKey,
        });
      }}
      onDragStart={(e) => {
        // Drags the marked presentations when this is one of them, else just this one.
        const { marked: now, presentations } = useLibrary.getState();
        const ids = now.includes(p.id)
          ? presentations.filter((x) => now.includes(x.id)).map((x) => x.id)
          : [p.id];
        startDrag(e, 'presentations', ids);
      }}
      className={`${rowClass({ selected, marked })} flex h-full items-center gap-2 px-2.5`}
    >
      <span className="min-w-0 flex-1">
        <Truncate text={p.name} className="text-sm font-medium" />
        <span className="flex items-center gap-1 text-xs text-muted">
          {p.slideCount} {p.slideCount === 1 ? 'slide' : 'slides'}
          {p.kirtanTracks &&
            LANGS.filter((l) => p.kirtanTracks?.includes(l)).map((l) => (
              <Badge key={l}>{LANG_SHORT[l]}</Badge>
            ))}
        </span>
      </span>
      {live && <LiveBadge />}
    </button>
  );
});

function ImportMenu() {
  return (
    <MenuButton
      label="Import"
      icon={Import}
      variant="secondary"
      entries={[
        { label: 'Files…', icon: FileText, onSelect: () => void importWithDialog('files') },
        { label: 'A folder…', icon: FolderOpen, onSelect: () => void importWithDialog('folder') },
      ]}
    >
      Import…
    </MenuButton>
  );
}

/** Search titles and slide text; Esc empties the box, Enter opens the first result. */
function SearchBox() {
  const query = useSearch((s) => s.query);
  const filtersOn = useFilters((s) => s.open || filtering(s.f));
  return (
    <div className="flex gap-1.5 px-3 pb-2">
      <span className="relative flex min-w-0 flex-1 items-center">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2 text-faint" />
        <TextInput
          type="search"
          id="library-search"
          data-testid="library-search"
          aria-label="Search presentations"
          placeholder="Search…"
          value={query}
          spellCheck={false}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              clearSearch();
            } else if (e.key === 'Enter') {
              const first = useSearch.getState().result?.hits[0];
              if (first) openHit(first);
            }
          }}
          className="w-full pl-7"
        />
      </span>
      <IconButton
        icon={ListFilter}
        label="Filter the kirtans by their details"
        variant={filtersOn ? 'secondary' : 'ghost'}
        aria-pressed={filtersOn}
        data-testid="filter-button"
        onClick={toggleFilters}
      />
      <Button size="md" icon={Plus} title="A new presentation from pasted words" onClick={newFromWords}>
        New…
      </Button>
    </div>
  );
}

export function PresentationList({ platform }: { platform: string }) {
  const all = useLibrary((s) => s.presentations);
  const filters = useFilters((s) => s.f);
  // While the kirtan filters are set, only the kirtans with those details.
  const presentations = useMemo(() => applyFilters(all, filters), [all, filters]);
  const selectedId = useLibrary((s) => s.selectedId);
  const marked = useLibrary((s) => s.marked);
  // On the screens now: its slide is up (not just the place it was, after a clear).
  const liveId = useEngine((s) => s.state?.layers.slide?.presentationId ?? null);
  const [dropping, setDropping] = useState(false);
  const [dropProblem, setDropProblem] = useState<string | null>(null);
  const depth = useRef(0);
  const markedSet = new Set(marked);
  const listRef = useRef<HTMLUListElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });
  const tab = useLibraryTab((s) => s.tab);
  const setTab = setLibraryTab;
  const searching = useSearch((s) => s.query.trim() !== '');

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
  }, [tab, searching]);

  // Bring a newly selected presentation into view (for example one opened from the import report).
  const latest = useRef({ rows, layout, heights });
  useEffect(() => {
    latest.current = { rows, layout, heights };
  });
  useEffect(() => {
    const ul = listRef.current;
    if (!ul || !selectedId || tab !== 'presentations' || searching) return;
    const { rows: now, layout: at, heights: sizes } = latest.current;
    const index = now.findIndex((r) => r.kind === 'item' && r.p.id === selectedId);
    const to = scrollToShow(at, sizes, index, ul.scrollTop, ul.clientHeight);
    if (to !== null) ul.scrollTop = to;
  }, [selectedId, tab, searching]);

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
      aria-label="Library"
      className="relative flex min-h-0 flex-1 flex-col border-t border-line"
      data-testid="library-drop"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Tabs
          group="library"
          label="Library"
          size="sm"
          className="flex-1"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'presentations', label: 'Presentations', icon: Presentation },
            { id: 'media', label: 'Media', icon: Image },
            { id: 'shastra', label: 'Shastra', icon: BookOpen },
          ]}
        />
        <ImportMenu />
      </div>
      {tab !== 'shastra' && <SearchBox />}
      {tab === 'presentations' && <KirtanFilters />}
      <TabPanel group="library" id={tab} className="flex min-h-0 flex-1 flex-col">
        {tab === 'shastra' ? (
          <ShastraPanel />
        ) : searching ? (
          <SearchResults />
        ) : tab === 'media' ? (
          <MediaList platform={platform} />
        ) : presentations.length === 0 && filtering(filters) ? (
          <EmptyState icon={ListFilter} title="No kirtan has these details" compact className="flex-1">
            Choose Any for one of the filters above, or Clear filters.
          </EmptyState>
        ) : presentations.length === 0 ? (
          <EmptyState icon={Upload} title="The library is empty" compact className="flex-1">
            Drag lyrics, presentations or media here, or use Import….
          </EmptyState>
        ) : (
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
                      className="px-1 pt-3 pb-1 text-2xs font-bold tracking-wider text-muted uppercase"
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
            <li
              aria-hidden="true"
              style={{ position: 'absolute', top: layout.total, height: 12, width: 1 }}
            />
          </ul>
        )}
      </TabPanel>
      {dropProblem && (
        <Notice tone="warning" compact className="mx-3 mb-2" onDismiss={() => setDropProblem(null)}>
          {dropProblem}
        </Notice>
      )}
      {dropping && (
        <div
          data-testid="drop-overlay"
          className="pointer-events-none absolute inset-2 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-accent bg-ink/90 p-4 text-center text-sm font-medium"
        >
          <Upload size={28} aria-hidden="true" className="text-accent" />
          Drop lyrics, presentations or media to import them
        </div>
      )}
    </nav>
  );
}
