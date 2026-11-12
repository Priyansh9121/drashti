import { execFile } from 'node:child_process';
import { runPowerShell } from '../system/powershell';

const MAC_FAMILIES = [
  "ObjC.import('AppKit');",
  'JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies));',
].join('\n');

const WINDOWS_FAMILIES = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing
$fonts = [System.Drawing.Text.InstalledFontCollection]::new()
try {
  $names = @($fonts.Families | ForEach-Object { $_.Name })
  ConvertTo-Json -InputObject $names -Compress
} finally {
  $fonts.Dispose()
}
`;

function queryFontFamilies(platform: NodeJS.Platform): Promise<string | null> {
  if (platform === 'win32') return runPowerShell(WINDOWS_FAMILIES);
  if (platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', MAC_FAMILIES],
      { timeout: 10_000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });
}

function familyNames(output: string | null): string[] {
  if (output === null) return [];
  const parsed: unknown = JSON.parse(output.trim());
  if (!Array.isArray(parsed)) return [];
  const values: unknown[] = parsed;
  const names = new Map<string, string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const family = value.trim().normalize('NFC');
    if (!family || family.length > 200 || /(?:[/\\\p{Cc}]|^[a-z]:)/iu.test(family)) continue;
    const key = family.toLowerCase();
    if (!names.has(key)) names.set(key, family);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/** One lazy query for all editor windows in this app session. */
export function createSystemFontFamilies(
  platform: NodeJS.Platform = process.platform,
): () => Promise<readonly string[]> {
  let cached: Promise<readonly string[]> | undefined;
  return () =>
    (cached ??= queryFontFamilies(platform)
      .then(familyNames)
      .catch(() => []));
}

export const systemFontFamilies = createSystemFontFamilies();
