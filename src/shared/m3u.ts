/** A playlist-file report, with every entry not taken listed in order. Paths here come from the operator’s own file. */
export interface M3uNotTaken {
  entry: string;
  reason: string;
}
export type M3uResult =
  { ok: true; id: string | null; notTaken: M3uNotTaken[] } | { ok: false; message: string };
