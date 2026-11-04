import { searchWords } from './search';
import { hasIndic, transliterate } from './translit';
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const previous = rows[i - 1];
      const row = rows[i];
      if (!previous || !row) return 3;
      row[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        row[j] = Math.min(row[j] ?? 3, (rows[i - 2]?.[j - 2] ?? 0) + 1);
    }
  return rows[a.length]?.[b.length] ?? 3;
}
/** Existing spelling folds and Roman-letter rules, with bounded adjacent-letter typo matching. */
export function spellingScore(query: string, source: string): number {
  const wanted = searchWords(query)
    .filter((word) => word.length <= 64)
    .slice(0, 12);
  if (!wanted.length) return 0;
  const target = [...new Set(searchWords(source + (hasIndic(source) ? '\n' + transliterate(source) : '')))];
  let total = 0;
  for (const word of wanted) {
    let best = 0;
    for (const other of target) {
      if (other.startsWith(word)) {
        best = 1;
        break;
      }
      if (word.length < 4 || other.length > 64 || Math.abs(other.length - word.length) > 2) continue;
      const d = distance(word, other);
      const allowed = word.length >= 8 ? 2 : 1;
      if (d <= allowed) best = Math.max(best, 1 - d / Math.max(word.length, other.length) - 0.05);
    }
    if (best === 0) return 0;
    total += best;
  }
  return total / wanted.length;
}
