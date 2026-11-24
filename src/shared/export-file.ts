/** Export… of a finished video in Media (alpha.22, main/convert/export-file.ts): where it went (null: the dialog was closed), or why not. */
export type ExportFileResult = { ok: true; path: string | null } | { ok: false; message: string };

/** The notice once exported: the file's name and its folder. */
export function exportedNotice(path: string): string {
  const parts = path.split(/[\\/]/u);
  const name = parts.at(-1) ?? path;
  const folder = parts.at(-2);
  return folder ? `Exported “${name}” to ${folder}.` : `Exported “${name}”.`;
}
