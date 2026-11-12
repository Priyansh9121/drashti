/**
 * Clean a name given to Rename, preserving word boundaries and script joiners.
 */
export function normalizeRenameName(name: string): string {
  return name
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029]+/gu, ' ')
    .replace(/[\p{Cc}\p{Bidi_Control}]/gu, '')
    .trim();
}
