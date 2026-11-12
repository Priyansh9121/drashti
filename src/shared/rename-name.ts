/**
 * Clean a name given to Rename. The joiners used by scripts such as Gujarati and Hindi are kept.
 */
export function normalizeRenameName(name: string): string {
  return name.replace(/[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '').trim();
}
