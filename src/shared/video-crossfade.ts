/** Stored only for normal playlists, alongside their existing settings. */
export function storedCrossfadeMs(settings: string | null): number {
  try {
    const value: unknown = JSON.parse(settings ?? 'null');
    if (!value || typeof value !== 'object' || !('crossfadeMs' in value)) return 0;
    const ms = value.crossfadeMs;
    return typeof ms === 'number' && Number.isInteger(ms) && ms >= 0 && ms <= 10_000 ? ms : 0;
  } catch {
    return 0;
  }
}

export function keepCrossfadeMs(settings: string | null, crossfadeMs: number): string {
  let before: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(settings ?? 'null');
    if (value && typeof value === 'object' && !Array.isArray(value))
      before = value as Record<string, unknown>;
  } catch {
    /* An unreadable optional setting carries no choices. */
  }
  return JSON.stringify({ ...before, crossfadeMs });
}

/** Consecutive overlaps share two decoders; their sum cannot consume an intervening video. */
export function videoOverlapMs(requested: number, firstMs: number, secondMs: number): number {
  if (![requested, firstMs, secondMs].every(Number.isFinite)) return 0;
  return Math.max(0, Math.min(requested, firstMs / 2, secondMs / 2));
}
