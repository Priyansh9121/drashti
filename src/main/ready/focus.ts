import { posix } from 'node:path';

/*
 * Whether notifications are silenced, for Ready? (Session 55, Part 8): Focus or Do Not Disturb on a Mac, Focus assist
 * (Do not disturb on Windows 11) on Windows. Only ever read when Ready? is pressed, never at start, and never on the
 * main thread's time: a file read (a Mac) or a PowerShell (Windows), both asynchronous. Neither asks anything of the
 * person (no prompt, no keychain): where the computer keeps it private, the answer is null, "can't tell", and Ready?
 * says so, with how to turn it on by hand.
 */

/** macOS 12 and later: the Focus held now, one record each (the file is private on newer macOS: then null). */
export const MAC_ASSERTIONS = ['Library', 'DoNotDisturb', 'DB', 'Assertions.json'];

/** On (a Focus is held), off (none), or null when the text is not what macOS writes there. */
export function focusFromAssertions(text: string): boolean | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const data = (parsed as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  return data.some((entry: unknown) => {
    const records = (entry as { storeAssertionRecords?: unknown } | null)?.storeAssertionRecords;
    return Array.isArray(records) && records.length > 0;
  });
}

/**
 * Windows' Focus assist, as the shell keeps it (its WNF state WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED): 0 off,
 * 1 priority only, 2 alarms only. Read with ntdll's NtQueryWnfStateData, which needs no rights; prints the number, or
 * "error".
 */
export const FOCUS_ASSIST_SCRIPT = `$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DrashtiQuietHours {
  [DllImport("ntdll.dll")]
  public static extern int NtQueryWnfStateData(ref ulong stateName, IntPtr typeId, IntPtr explicitScope, out uint changeStamp, byte[] buffer, ref uint bufferSize);
}
'@
  $name = [UInt64]0x0D83063EA3BF1C75
  $stamp = [UInt32]0
  $buffer = New-Object byte[] 4
  $size = [UInt32]4
  $result = [DrashtiQuietHours]::NtQueryWnfStateData([ref]$name, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$stamp, $buffer, [ref]$size)
  if ($result -ne 0) { 'error' } else { [BitConverter]::ToInt32($buffer, 0) }
} catch { 'error' }
`;

/** Focus assist's number: 1 or 2 is on, 0 off; anything else (an error, no answer) null. */
export function focusFromWnf(out: string | null): boolean | null {
  const said = out?.trim();
  if (said === '0') return false;
  if (said === '1' || said === '2') return true;
  return null;
}

export interface FocusDeps {
  /** The person's home folder. */
  home: string;
  /** An asynchronous file read (fs.promises.readFile as UTF-8). */
  readFile(path: string): Promise<string>;
  /** Windows' PowerShell, asynchronously: what it printed, or null (system/powershell.ts runPowerShell). */
  powershell(script: string): Promise<string | null>;
}

/** Whether notifications are silenced now: true, false, or null when this computer does not say. */
export async function readFocus(platform: string, deps: FocusDeps): Promise<boolean | null> {
  try {
    // A Mac's path, written as a Mac writes it (the tests run on Windows too).
    if (platform === 'darwin')
      return focusFromAssertions(await deps.readFile(posix.join(deps.home, ...MAC_ASSERTIONS)));
    if (platform === 'win32') return focusFromWnf(await deps.powershell(FOCUS_ASSIST_SCRIPT));
  } catch {
    // Private (EPERM on newer macOS), missing, or PowerShell would not start: can't tell.
  }
  return null;
}
