import { useId, useMemo } from 'react';
import { create } from 'zustand';
import type { PresentationSummary } from '../../../shared/library';
import { Button } from '../ui/Button';
import { Select } from '../ui/Field';
import { plural } from '../ui/text';
import { useLibrary } from './library-store';

/*
 * Filtering the library by kirtan details: category, kavi, raag and
 * occasion. While any is set, the list shows only the kirtans that have
 * every one of them.
 */

export interface LibraryFilters {
  category: string | null;
  kavi: string | null;
  raag: string | null;
  occasion: string | null;
}

const NONE: LibraryFilters = { category: null, kavi: null, raag: null, occasion: null };

export const useFilters = create<{ open: boolean; f: LibraryFilters }>(() => ({ open: false, f: NONE }));

export const filtering = (f: LibraryFilters): boolean => Object.values(f).some((v) => v !== null);

export function toggleFilters(): void {
  useFilters.setState((s) => ({ open: !s.open || filtering(s.f) }));
}

export function clearFilters(): void {
  useFilters.setState({ f: NONE });
}

/** The presentations these filters let through (all of them when none is set). */
export function applyFilters(list: readonly PresentationSummary[], f: LibraryFilters): PresentationSummary[] {
  if (!filtering(f)) return [...list];
  return list.filter((p) => {
    const k = p.kirtan;
    if (!k) return false;
    return (
      (f.category === null || k.category === f.category) &&
      (f.kavi === null || k.kavi === f.kavi) &&
      (f.raag === null || k.raag === f.raag) &&
      (f.occasion === null || k.occasions.includes(f.occasion))
    );
  });
}

const FIELDS = [
  ['category', 'Category'],
  ['kavi', 'Kavi'],
  ['raag', 'Raag'],
  ['occasion', 'Occasion'],
] as const;

/** The filters, each with the values the library's kirtans have. */
export function KirtanFilters() {
  const open = useFilters((s) => s.open);
  const f = useFilters((s) => s.f);
  const presentations = useLibrary((s) => s.presentations);
  const id = useId();
  const values = useMemo(() => {
    const sets = {
      category: new Set<string>(),
      kavi: new Set<string>(),
      raag: new Set<string>(),
      occasion: new Set<string>(),
    };
    for (const p of presentations) {
      const k = p.kirtan;
      if (!k) continue;
      if (k.category) sets.category.add(k.category);
      if (k.kavi) sets.kavi.add(k.kavi);
      if (k.raag) sets.raag.add(k.raag);
      for (const o of k.occasions) sets.occasion.add(o);
    }
    const sorted = (s: Set<string>) =>
      [...s].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    return {
      category: sorted(sets.category),
      kavi: sorted(sets.kavi),
      raag: sorted(sets.raag),
      occasion: sorted(sets.occasion),
    };
  }, [presentations]);
  const count = useMemo(() => applyFilters(presentations, f).length, [presentations, f]);
  if (!open && !filtering(f)) return null;
  return (
    <div
      className="space-y-1.5 px-3 pb-2"
      data-testid="kirtan-filters"
      role="group"
      aria-label="Filter the kirtans"
    >
      <div className="grid grid-cols-2 gap-1.5">
        {FIELDS.map(([key, label]) => (
          <label
            key={key}
            className="flex min-w-0 flex-col gap-0.5 text-2xs font-medium text-muted"
            htmlFor={`${id}-${key}`}
          >
            {label}
            <Select
              id={`${id}-${key}`}
              data-testid={`filter-${key}`}
              className="h-7 min-w-0 text-xs"
              value={f[key] ?? ''}
              onChange={(e) => {
                const v = e.target.value === '' ? null : e.target.value;
                useFilters.setState((s) => ({ f: { ...s.f, [key]: v } }));
              }}
            >
              <option value="">Any</option>
              {values[key].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>
      {filtering(f) && (
        <p className="flex items-center gap-2 text-xs text-muted" role="status" data-testid="filter-count">
          <span className="flex-1">{plural(count, 'kirtan')} with these details</span>
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        </p>
      )}
    </div>
  );
}
