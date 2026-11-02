/** Resolve converted originals inside optional design/master JSON, preserving every byte when nothing changes. */
export function editorMediaWithCopies(
  text: string | null | undefined,
  copy: (id: string) => string,
): string | null {
  if (text == null) return null;
  try {
    const changed = new Set<string>();
    const walk = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(walk);
      if (typeof value !== 'object' || value === null) return value;
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          if (key === 'mediaId' && typeof item === 'string') {
            const next = copy(item);
            if (next !== item) changed.add(item);
            return [key, next];
          }
          return [key, walk(item)];
        }),
      );
    };
    const result = walk(JSON.parse(text));
    return changed.size > 0 ? JSON.stringify(result) : text;
  } catch {
    return text;
  }
}
