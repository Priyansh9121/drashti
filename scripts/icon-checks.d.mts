export interface IconFiles {
  icns: Buffer;
  ico: Buffer;
  electronIcns: string;
  electronExe: string;
}
export function iconFiles(appDir: string): IconFiles;
export function macAppIcon(app: string, icons: IconFiles): { ok: boolean; why: string };
export function windowsProgramIcon(
  program: string,
  what: string,
  icons: IconFiles,
): { ok: boolean; why: string };
