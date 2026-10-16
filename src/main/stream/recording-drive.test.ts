import { describe, expect, it } from 'vitest';
import { fileSystemFromMounts, isFat, recordingWarning, windowsDriveOf } from './recording-drive';

/*
 * The recording's drive (MED-2, Session 31): FAT32 told plainly, as each system says it, and silence
 * whenever it cannot be told; a disk nearly full told before it fills.
 */

const MAC_MOUNT = `/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
devfs on /dev (devfs, local, nobrowse)
/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect, root data)
map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)
/dev/disk4s1 on /Volumes/NO NAME (msdos, local, nodev, nosuid, noowners, noatime, fskit)
/dev/disk5s1 on /Volumes/BIG STICK (exfat, local, nodev, nosuid, noowners, noatime, fskit)
/dev/disk6s2 on /Volumes/Recordings (on desk) (apfs, local, nodev, nosuid, journaled, noowners)`;

const LINUX_MOUNTS = `sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0
/dev/sda1 / ext4 rw,relatime 0 0
/dev/sdb1 /media/user/NO\\040NAME vfat rw,nosuid,nodev,relatime,uid=1000 0 0
/dev/sdc1 /media/user/BIG exfat rw,nosuid,nodev,relatime 0 0`;

describe('the recording drive', () => {
  it('finds the file system holding a folder from macOS’s mount list: the deepest mount that holds it', () => {
    expect(fileSystemFromMounts(MAC_MOUNT, '/Volumes/NO NAME/Sabha', 'darwin')).toBe('msdos');
    expect(fileSystemFromMounts(MAC_MOUNT, '/Volumes/NO NAME', 'darwin')).toBe('msdos');
    expect(fileSystemFromMounts(MAC_MOUNT, '/Volumes/BIG STICK/x', 'darwin')).toBe('exfat');
    expect(fileSystemFromMounts(MAC_MOUNT, '/Volumes/Recordings (on desk)/2026', 'darwin')).toBe('apfs');
    expect(fileSystemFromMounts(MAC_MOUNT, '/System/Volumes/Data/Users/me/Movies', 'darwin')).toBe('apfs');
    // A folder whose name only starts like a mount's is not on it.
    expect(fileSystemFromMounts(MAC_MOUNT, '/Volumes/NO NAMES/x', 'darwin')).toBe('apfs');
  });

  it('finds it from Linux’s mounts, with their escaped spaces', () => {
    expect(fileSystemFromMounts(LINUX_MOUNTS, '/media/user/NO NAME/rec', 'linux')).toBe('vfat');
    expect(fileSystemFromMounts(LINUX_MOUNTS, '/media/user/BIG', 'linux')).toBe('exfat');
    expect(fileSystemFromMounts(LINUX_MOUNTS, '/home/user', 'linux')).toBe('ext4');
  });

  it('says nothing when the list holds nothing it can read', () => {
    expect(fileSystemFromMounts('', '/Volumes/X', 'darwin')).toBeNull();
    expect(fileSystemFromMounts('garbage\nmore garbage', '/x', 'linux')).toBeNull();
  });

  it('calls FAT only FAT, as each system names it; exFAT has no 4 GB limit', () => {
    for (const name of ['msdos', 'vfat', 'fat', 'FAT32', 'FAT', 'fat32']) expect(isFat(name)).toBe(true);
    for (const name of ['exfat', 'exFAT', 'NTFS', 'apfs', 'hfs', 'ext4', 'ReFS', ''])
      expect(isFat(name)).toBe(false);
  });

  it('takes the drive of a Windows folder, and none from a network share', () => {
    expect(windowsDriveOf('D:\\Recordings\\Sabha')).toBe('D:\\');
    expect(windowsDriveOf('c:\\Users\\me\\Videos')).toBe('C:\\');
    expect(windowsDriveOf('\\\\server\\share\\rec')).toBeNull();
    expect(windowsDriveOf('relative\\path')).toBeNull();
  });

  it('warns of FAT32 and of a disk nearly full in plain words, and of nothing otherwise', () => {
    const hour = 3 * 1024 ** 3;
    expect(
      recordingWarning({
        fat: false,
        freeBytes: 100 * 1024 ** 3,
        bytesPerHour: hour,
        keepFree: 2 * 1024 ** 3,
      }),
    ).toBeNull();
    expect(
      recordingWarning({ fat: null, freeBytes: null, bytesPerHour: hour, keepFree: 2 * 1024 ** 3 }),
    ).toBeNull();
    const fat = recordingWarning({
      fat: true,
      freeBytes: 100 * 1024 ** 3,
      bytesPerHour: hour,
      keepFree: 2 * 1024 ** 3,
    });
    expect(fat).toContain('FAT32');
    expect(fat).toContain('parts');
    // Half an hour of room before the 2 GB kept free.
    const full = recordingWarning({
      fat: false,
      freeBytes: 2 * 1024 ** 3 + hour / 2,
      bytesPerHour: hour,
      keepFree: 2 * 1024 ** 3,
    });
    expect(full).toContain('about 30 minutes');
    expect(full).not.toContain('FAT32');
    const both = recordingWarning({
      fat: true,
      freeBytes: 2 * 1024 ** 3 + hour / 4,
      bytesPerHour: hour,
      keepFree: 2 * 1024 ** 3,
    });
    expect(both).toContain('FAT32');
    expect(both).toContain('about 15 minutes');
  });
});
