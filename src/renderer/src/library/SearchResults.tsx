import { Fragment } from 'react';
import type { SearchHit } from '../../../shared/search';
import { KIRTAN_FIELD_NAMES as FIELD_NAMES, searchWords } from '../../../shared/search';
import { hideLegacy, openHit, showLegacy, useLibrary, useSearch } from './library-store';
import { clickPresentation } from './library-store';
import { Button } from '../ui/Button';
import { Search } from '../ui/icons';
import { rowClass } from '../ui/ListRow';
import { Notice } from '../ui/Notice';
import { EmptyState } from '../ui/States';
import { plural } from '../ui/text';

/** A line with the words the operator typed marked, as it is written (accents and all). */
function Marked({ line, query }: { line: string; query: string }) {
  const wanted = searchWords(query);
  // Split into words and what is between them, keeping every character.
  const parts = line.split(/([\p{L}\p{M}\p{N}]+)/u);
  return (
    <>
      {parts.map((part, i) => {
        const [word] = searchWords(part);
        const hit = i % 2 === 1 && word !== undefined && wanted.some((w) => word.startsWith(w));
        return hit ? (
          <mark key={i} className="rounded-sm bg-accent-strong/60 text-fg">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </>
  );
}

function HitRow({ hit, query, selected }: { hit: SearchHit; query: string; selected: boolean }) {
  return (
    <button
      type="button"
      data-testid="search-hit"
      aria-current={selected ? 'true' : undefined}
      onClick={() => {
        openHit(hit);
      }}
      className={`${rowClass({ selected })} px-2.5 py-1.5`}
    >
      <span className="block truncate text-sm font-medium">
        {hit.match.kind === 'title' ? <Marked line={hit.name} query={query} /> : hit.name}
      </span>
      {hit.match.kind === 'text' && (
        <span className="block truncate text-xs text-muted" data-testid="search-line">
          <Marked line={hit.match.line} query={query} />
        </span>
      )}
      {hit.match.kind === 'detail' && (
        <span className="block truncate text-xs text-muted" data-testid="search-detail">
          {FIELD_NAMES[hit.match.field]}: <Marked line={hit.match.value} query={query} />
        </span>
      )}
      <span className="block text-xs text-muted">{hit.libraryName}</span>
    </button>
  );
}

/** Presentations found by title or slide text, and a word on what search cannot read yet. */
export function SearchResults() {
  const query = useSearch((s) => s.query);
  const result = useSearch((s) => s.result);
  const legacy = useSearch((s) => s.legacy);
  const selectedId = useLibrary((s) => s.selectedId);
  const hits = result?.hits ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-testid="search-results" aria-live="polite">
      {result && hits.length === 0 && (
        <EmptyState icon={Search} title="Nothing found" compact>
          Try fewer letters, or another word from the kirtan.
        </EmptyState>
      )}
      <ul className="space-y-1">
        {hits.map((hit) => (
          <li key={hit.presentationId}>
            <HitRow hit={hit} query={query} selected={hit.presentationId === selectedId} />
          </li>
        ))}
      </ul>
      {result?.more && (
        <p className="px-2 py-2 text-xs text-muted">More presentations match: type more to narrow it down.</p>
      )}
      {result && result.legacyCount > 0 && (
        <Notice
          tone="warning"
          compact
          role="none"
          className="mt-2"
          data-testid="search-legacy"
          actions={
            <Button
              size="sm"
              onClick={() => {
                if (legacy) hideLegacy();
                else void showLegacy();
              }}
            >
              {legacy ? 'Hide them' : 'Show them'}
            </Button>
          }
        >
          <p>
            {plural(result.legacyCount, 'presentation')} {result.legacyCount === 1 ? 'has' : 'have'} slide
            text in a legacy Gujarati or Hindi font, which search cannot read yet. Their titles are searched.
          </p>
          {legacy && (
            <ul className="mt-1 space-y-0.5">
              {legacy.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full truncate rounded-sm text-left underline-offset-2 hover:underline"
                    onClick={() => {
                      clickPresentation(p.id, { toggle: false, range: false });
                    }}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Notice>
      )}
    </div>
  );
}
