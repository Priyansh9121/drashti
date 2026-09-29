/** A byte count for people: "512 bytes", "3.4 MB", "1.2 GB". */
export function formatBytes(n: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${v} bytes` : `${v.toFixed(1)} ${units[i] ?? ''}`;
}

/**
 * A date and time for names people see (backup folders, the diagnostics
 * file), in the computer's own time zone: "2026-09-29 18-30". No colons,
 * which Windows file names cannot hold.
 */
export function fileStamp(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}-${two(date.getMinutes())}`;
}
