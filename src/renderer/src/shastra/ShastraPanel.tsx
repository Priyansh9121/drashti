import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import type { ShastraHit, ShastraItemRow, ShastraSectionNode } from '../../../shared/shastra';
import { useLibrary } from '../library/library-store';
import { AddToPlaylistButton, rowMenu } from '../playlists/AddToPlaylist';
import { startDrag } from '../playlists/drag';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/Field';
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight, Search } from '../ui/icons';
import { rowClass } from '../ui/ListRow';
import { EmptyState } from '../ui/States';
import { plural } from '../ui/text';
import { TextsDialog } from './TextsDialog';
import {
  browse,
  loadTexts,
  openReference,
  openTexts,
  setQuery,
  setReference,
  showPassage,
  useShastra,
  watchShastra,
} from './shastra-store';

/*
 * The Shastra tab of the left column (Session 12): type a reference ("SD 14",
 * "Vach G.Pr. 1", "SD 14-16"), search the texts' words in any language, or
 * browse a text by its sections. A passage found any way is shown in the
 * slide grid, ready to go up; dragged onto a playlist, it becomes an item.
 */

/** A passage dragged onto a playlist becomes an item there (or fills a slot it is dropped on). */
function dragPassage(e: DragEvent, passageId: string): void {
  startDrag(e, 'passages', [passageId]);
}

/** A passage, as a playlist item (Add to playlist, or its row's menu). */
const pickPassage = (passageId: string) => () => [{ kind: 'shastra' as const, passageId }];

function HitRow({ hit, selected }: { hit: ShastraHit; selected: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        draggable
        data-testid="shastra-hit"
        aria-current={selected ? 'true' : undefined}
        className={`${rowClass({ selected })} min-w-0 flex-1 px-2.5 py-1.5`}
        onDragStart={(e) => {
          dragPassage(e, hit.passageId);
        }}
        onClick={() => {
          void showPassage(hit.passageId);
        }}
        {...rowMenu(hit.reference, pickPassage(hit.passageId))}
      >
        <span className="block truncate text-sm font-medium">{hit.reference}</span>
        <span className="block truncate text-xs text-muted" data-testid="shastra-hit-line">
          {hit.snippet}
        </span>
      </button>
      {selected && <AddToPlaylistButton pick={pickPassage(hit.passageId)} />}
    </div>
  );
}

function ItemRow({ item, selected }: { item: ShastraItemRow; selected: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        draggable
        data-testid="shastra-item"
        aria-current={selected ? 'true' : undefined}
        className={`${rowClass({ selected })} flex min-w-0 flex-1 items-baseline gap-2 px-2.5 py-1`}
        onDragStart={(e) => {
          dragPassage(e, item.passageId);
        }}
        onClick={() => {
          void showPassage(item.passageId);
        }}
        {...rowMenu(`${item.number} ${item.title}`, pickPassage(item.passageId))}
      >
        <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">{item.number}</span>
        <span className="min-w-0 truncate text-xs text-muted">{item.title}</span>
      </button>
      {selected && <AddToPlaylistButton pick={pickPassage(item.passageId)} />}
    </div>
  );
}

function SectionRows({
  node,
  selectedId,
  depth,
}: {
  node: ShastraSectionNode;
  selectedId: string | null;
  depth: number;
}) {
  const [open, setOpen] = useState(depth === 0 && node.items.length > 0 && node.items.length <= 40);
  const count = node.items.length + node.sections.length;
  return (
    <li style={{ paddingLeft: depth * 12 }}>
      <button
        type="button"
        aria-expanded={open}
        data-testid="shastra-section"
        className={`${rowClass({})} flex items-center gap-1.5 px-2 py-1.5`}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{node.label}</span>
        {node.abbreviation && <span className="text-xs text-muted">{node.abbreviation}</span>}
        <span className="text-2xs text-faint">{count}</span>
      </button>
      {open && (
        <ul className="mt-0.5 space-y-0.5">
          {node.sections.map((s) => (
            <SectionRows key={s.id} node={s} selectedId={selectedId} depth={depth + 1} />
          ))}
          {node.items.map((it) => (
            <li key={it.id} style={{ paddingLeft: 12 }}>
              <ItemRow item={it} selected={it.passageId === selectedId} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ShastraPanel() {
  const texts = useShastra((s) => s.texts);
  const loaded = useShastra((s) => s.loaded);
  const reference = useShastra((s) => s.reference);
  const problem = useShastra((s) => s.problem);
  const query = useShastra((s) => s.query);
  const hits = useShastra((s) => s.hits);
  const browsing = useShastra((s) => s.browsing);
  const selectedId = useLibrary((s) => s.selectedId);

  useEffect(() => {
    watchShastra();
    void loadTexts();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="shastra-panel">
      <form
        className="flex gap-1.5 px-3 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          void openReference();
        }}
      >
        <TextInput
          aria-label="Reference"
          aria-describedby={problem ? 'shastra-problem' : undefined}
          aria-invalid={problem ? true : undefined}
          placeholder="SD 14, Vach G.Pr. 1…"
          data-testid="shastra-reference"
          spellCheck={false}
          className="min-w-0 flex-1"
          value={reference}
          onChange={(e) => {
            setReference(e.target.value);
          }}
        />
        <Button type="submit" size="md" data-testid="shastra-show">
          Show
        </Button>
      </form>
      {problem && (
        <p
          id="shastra-problem"
          role="status"
          data-testid="shastra-problem"
          className="px-3 pb-2 text-xs text-warning-fg"
        >
          {problem}
        </p>
      )}
      <div className="px-3 pb-2">
        <span className="relative flex items-center">
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2 text-faint" />
          <TextInput
            type="search"
            aria-label="Search the texts' words"
            placeholder="Search the words…"
            data-testid="shastra-search"
            spellCheck={false}
            className="w-full pl-7"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setQuery('');
              }
            }}
          />
        </span>
      </div>
      {/* What a search found, said once: the list itself is not read out (nor its Add to playlist). */}
      <p className="sr-only" role="status" data-testid="shastra-found">
        {query.trim() === '' || hits === null
          ? ''
          : hits.length === 0
            ? 'No passage found'
            : `${plural(hits.length, 'passage')} found`}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {query.trim() !== '' ? (
          hits === null ? null : hits.length === 0 ? (
            <EmptyState icon={Search} title="Nothing found" compact>
              Try fewer letters, or a word in another language.
            </EmptyState>
          ) : (
            <ul className="space-y-1" data-testid="shastra-hits">
              {hits.map((h) => (
                <li key={h.passageId}>
                  <HitRow hit={h} selected={h.passageId === selectedId} />
                </li>
              ))}
            </ul>
          )
        ) : browsing ? (
          <div data-testid="shastra-tree">
            <button
              type="button"
              className="mb-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:text-fg"
              onClick={() => void browse(null)}
            >
              <ArrowLeft size={14} aria-hidden="true" /> All texts
            </button>
            <h3 className="px-1.5 pb-1 text-sm font-semibold">
              {browsing.text.name}{' '}
              <span className="font-normal text-muted">{browsing.text.abbreviation}</span>
            </h3>
            <ul className="space-y-0.5">
              {browsing.sections.map((s) => (
                <SectionRows key={s.id} node={s} selectedId={selectedId} depth={0} />
              ))}
              {browsing.items.map((it) => (
                <li key={it.id}>
                  <ItemRow item={it} selected={it.passageId === selectedId} />
                </li>
              ))}
            </ul>
          </div>
        ) : loaded && texts.length === 0 ? (
          <EmptyState icon={BookOpen} title="No texts loaded" compact className="flex-1">
            An admin loads the texts the mandir may show: drag a Shastra text file here, or use Texts….
          </EmptyState>
        ) : (
          <ul className="space-y-1" data-testid="shastra-texts-list">
            {texts.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  data-testid="shastra-text"
                  className={`${rowClass({})} px-2.5 py-1.5`}
                  onClick={() => void browse(t.id)}
                >
                  <span className="block truncate text-sm font-medium">
                    {t.name} <span className="font-normal text-muted">{t.abbreviation}</span>
                  </span>
                  <span className="block text-xs text-muted">
                    {plural(t.itemCount, 'item')}
                    {t.sectionCount > 0 ? ` in ${plural(t.sectionCount, 'section')}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 justify-end border-t border-line px-3 py-2">
        <Button size="sm" data-testid="open-shastra-texts" onClick={() => openTexts(true)}>
          Texts…
        </Button>
      </div>
      <TextsDialog />
    </div>
  );
}
