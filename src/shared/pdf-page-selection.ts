/** One-based page numbers in the operator's words; null means no valid choice. */
export function pdfPageSelection(text: string, count: number): number[] | null {
  if (!Number.isInteger(count) || count < 1 || count > 400 || text.length > 2000) return null;
  const selected = new Set<number>();
  for (const part of text.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/u.exec(part);
    if (!match) return null;
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (first < 1 || last < first || last > count) return null;
    for (let n = first; n <= last; n++) selected.add(n - 1);
  }
  return selected.size ? [...selected].sort((a, b) => a - b) : null;
}

/** Validate untrusted zero-based selections from an editor request. */
export function pdfPageIndices(value: unknown, count: number): number[] | null {
  if (!Array.isArray(value)) return null;
  const items: unknown[] = value;
  const pages = items.filter((n): n is number => typeof n === 'number');
  if (
    !pages.length ||
    pages.length !== items.length ||
    pages.length > 400 ||
    pages.some((n, i) => !Number.isInteger(n) || n < 0 || n >= count || (i > 0 && n <= (pages[i - 1] ?? n)))
  )
    return null;
  return pages;
}
