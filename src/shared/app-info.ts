export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
}

/** One line for the status bar, e.g. "Drashti 1.0.0 · Electron 44.4.5 · macOS". */
export function describeAppInfo(info: AppInfo): string {
  const os = info.platform === 'darwin' ? 'macOS' : info.platform === 'win32' ? 'Windows' : info.platform;
  return `${info.name} ${info.version} · Electron ${info.electron} · ${os} ${info.arch}`;
}
