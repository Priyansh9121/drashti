import { execFile } from 'node:child_process';
import { readFile, realpath, statfs } from 'node:fs/promises';
import { runPowerShell } from '../system/powershell';

/*
 * The recording's drive, looked at as a recording starts (Session 31, MED-2): a FAT32 drive (a USB stick
 * as it comes) cannot hold a file over 4 GB, and a disk nearly full stops a recording part-way. Drashti
 * records in parts of 3.5 GB anyway (worker/pipeline.ts), so FAT32 loses nothing, but the operator is told
 * plainly, as is a disk with less than an hour's room. Each system is asked its own way (macOS's mount
 * list, Linux's mounts, Windows' DriveInfo), and when it cannot tell, Drashti says nothing.
 */

/** FAT as each system names it (macOS "msdos", Linux "vfat", Windows "FAT32" or "FAT"); exFAT is not FAT. */
export function isFat(fileSystem: string): boolean {
  return /^(msdos|vfat|fat|fat12|fat16|fat32)$/iu.test(fileSystem.trim());
}

/**
 * The file system holding `folder`, from macOS's `mount` list or Linux's /proc/mounts: the deepest mount
 * that holds it. null when the list says nothing that can be read.
 */
export function fileSystemFromMounts(text: string, folder: string, platform: NodeJS.Platform): string | null {
  const mounts: { at: string; fs: string }[] = [];
  for (const line of text.split('\n')) {
    if (platform === 'darwin') {
      // "/dev/disk4s1 on /Volumes/NO NAME (msdos, local, nodev, ...)": the last "(" starts the options.
      const open = line.lastIndexOf(' (');
      const on = line.indexOf(' on /');
      if (open < 0 || on < 0 || on > open) continue;
      const fs =
        line
          .slice(open + 2)
          .split(/[,)]/u)[0]
          ?.trim() ?? '';
      if (fs) mounts.push({ at: line.slice(on + 4, open), fs });
    } else {
      // "/dev/sdb1 /media/user/NO\040NAME vfat rw,... 0 0", with spaces as \040.
      const parts = line.trim().split(/\s+/u);
      if (parts.length < 3 || !parts[1]?.startsWith('/')) continue;
      const at = parts[1].replace(/\\(\d{3})/gu, (_, octal: string) =>
        String.fromCharCode(parseInt(octal, 8)),
      );
      mounts.push({ at, fs: parts[2] ?? '' });
    }
  }
  let best: { at: string; fs: string } | null = null;
  for (const m of mounts) {
    const holds = m.at === '/' || folder === m.at || folder.startsWith(`${m.at}/`);
    if (holds && (!best || m.at.length > best.at.length)) best = m;
  }
  return best ? best.fs : null;
}

/** A Windows folder's drive ("D:\"), or null for a network share or anything else. */
export function windowsDriveOf(folder: string): string | null {
  const match = /^([a-z]):[\\/]/iu.exec(folder);
  return match?.[1] ? `${match[1].toUpperCase()}:\\` : null;
}

const run = (file: string, args: string[]) =>
  new Promise<string | null>((resolve) => {
    execFile(file, args, { timeout: 5000, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : stdout);
    });
  });

/** Whether the folder is on a FAT drive: null when it cannot be told (each system its own way). */
export async function onFat(
  folder: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean | null> {
  try {
    const real = await realpath(folder);
    if (platform === 'win32') {
      const drive = windowsDriveOf(real);
      if (!drive) return null;
      const said = await runPowerShell(
        '([System.IO.DriveInfo]$env:DRASHTI_DRIVE).DriveFormat',
        { DRASHTI_DRIVE: drive },
        5000,
      );
      return said?.trim() ? isFat(said) : null;
    }
    const list =
      platform === 'darwin' ? await run('/sbin/mount', []) : await readFile('/proc/mounts', 'utf8');
    const fs = list ? fileSystemFromMounts(list, real, platform) : null;
    return fs === null ? null : isFat(fs);
  } catch {
    return null;
  }
}

/** Free bytes on the folder's disk, or null. */
export async function freeBytesOf(folder: string): Promise<number | null> {
  try {
    const s = await statfs(folder);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

/**
 * What to tell the operator as a recording starts, or null: the drive is FAT32, and/or the disk has
 * room for less than an hour before the space Drashti keeps free.
 */
export function recordingWarning(p: {
  fat: boolean | null;
  freeBytes: number | null;
  bytesPerHour: number;
  keepFree: number;
}): string | null {
  const said: string[] = [];
  if (p.fat)
    said.push(
      'The recording folder is on a FAT32 drive, which cannot hold a file over 4 GB: Drashti records in parts of 3.5 GB, so nothing is lost, but a drive formatted as exFAT keeps a recording whole.',
    );
  if (p.freeBytes !== null && p.bytesPerHour > 0) {
    const minutes = Math.floor(((p.freeBytes - p.keepFree) / p.bytesPerHour) * 60);
    if (minutes < 60)
      said.push(
        `That disk has room for about ${String(Math.max(0, minutes))} minutes of recording before Drashti stops it (it keeps 2 GB free). Free some space, or record onto another disk.`,
      );
  }
  return said.length > 0 ? said.join(' ') : null;
}

/** Bytes an hour of recording takes at a preset's bitrates. */
export const bytesPerHourAt = (preset: { videoKbps: number; audioKbps: number }) =>
  ((preset.videoKbps + preset.audioKbps) * 1000 * 3600) / 8;
