import { useMemo, useRef, useState } from 'react';
import { IconButton } from '../ui/Button';
import { TextInput } from '../ui/Field';
import { Search, X } from '../ui/icons';

export interface FindRow {
  key: string;
  words: string;
}

/** Find owns only its highlight and scroll position, never the library’s choice or the show. */
export function useRowFind<T extends FindRow>(rows: readonly T[]) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState(0);
  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? rows.filter((r) => r.words.toLocaleLowerCase().includes(q)) : [];
  }, [query, rows]);
  const index = matches.length ? position % matches.length : 0;
  return {
    open,
    query,
    count: matches.length,
    index,
    found: open ? (matches[index] ?? null) : null,
    show: () => {
      setOpen(true);
    },
    close: () => {
      setOpen(false);
      setQuery('');
      setPosition(0);
    },
    change: (value: string) => {
      setQuery(value);
      setPosition(0);
    },
    move: (delta: 1 | -1) => {
      setPosition(matches.length ? (index + delta + matches.length) % matches.length : 0);
    },
  };
}

export function PlaylistFind({
  label,
  countTestId,
  find,
}: {
  label: string;
  countTestId: string;
  find: ReturnType<typeof useRowFind>;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    find.close();
    button.current?.focus();
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1" role="search" aria-label={label}>
      <IconButton
        ref={button}
        icon={Search}
        label={label}
        size="sm"
        aria-expanded={find.open}
        onClick={find.open ? close : find.show}
      />
      {find.open && (
        <>
          <TextInput
            autoFocus
            aria-label={label}
            placeholder="Find"
            value={find.query}
            className="w-32 flex-1"
            onChange={(e) => {
              find.change(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                find.move(e.shiftKey ? -1 : 1);
              }
            }}
          />
          <span
            role="status"
            className="text-xs whitespace-nowrap text-muted tabular-nums"
            data-testid={countTestId}
          >
            {find.count ? `${String(find.index + 1)} of ${String(find.count)}` : '0 of 0'}
          </span>
          <IconButton icon={X} label={`Close ${label.toLocaleLowerCase()}`} size="sm" onClick={close} />
        </>
      )}
    </div>
  );
}
