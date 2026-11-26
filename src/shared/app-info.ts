/** A long task's progress, for the operator (a backup copying the media). */
export interface TaskProgress {
  label: string;
  /** From 0 to 1. */
  fraction: number;
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
}

/** The whole line, e.g. "Drashti 1.0.0 · Electron 44.4.5 · macOS arm64": the status bar's tooltip, the locked screen. */
export function describeAppInfo(info: AppInfo): string {
  const os = info.platform === 'darwin' ? 'macOS' : info.platform === 'win32' ? 'Windows' : info.platform;
  return `${info.name} ${info.version} · Electron ${info.electron} · ${os} ${info.arch}`;
}

/**
 * The status bar's words (alpha.23, lead 2's QA23-STAGE8-4): the name and version shown ("Drashti 1.0.0"), and the
 * rest of the whole line (" · Electron 44.4.5 · macOS arm64") in its tooltip and for screen readers, so nothing is
 * hidden and the row fits CI's 1024 × 645 in Pro Mode with Audience and Stage both off.
 */
export function appInfoParts(info: AppInfo): { short: string; rest: string } {
  const short = `${info.name} ${info.version}`;
  return { short, rest: describeAppInfo(info).slice(short.length) };
}
