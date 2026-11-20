/** Snapshot (alpha.20, the time bar's ⋯): the picture made in Media (its id and name), or why not, in words. */
export type SnapshotResult = { ok: true; mediaId: string; name: string } | { ok: false; message: string };
