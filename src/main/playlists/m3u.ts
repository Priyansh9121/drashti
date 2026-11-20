export interface M3uEntry {
  path: string;
  title: string | null;
  durationMs: number | null;
}
export interface M3uRead {
  entries: M3uEntry[];
  notTaken: { entry: string; reason: string }[];
}
export interface M3uExportRow {
  path?: string;
  label: string;
  durationMs?: number | null;
}

/** Reads local entries only; web addresses are never fetched. */
export function parseM3u(text: string, file: string): M3uRead {
  void text;
  void file;
  return { entries: [], notTaken: [] };
}

/** UTF-8 extended M3U, written as .m3u8 by Main. */
export function writeM3u(rows: readonly M3uExportRow[]): string {
  void rows;
  return '';
}
