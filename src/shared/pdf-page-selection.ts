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
