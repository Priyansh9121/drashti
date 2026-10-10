/*
 * What an error means to the person reading it, in words, and what to do next (Session 25): never
 * its code or the system's own text, which go to the log only.
 */

/**
 * What Drashti was doing with the file: reading one it was given (an import, a backup to restore),
 * writing to a place the person chose (a backup), or writing in its own folder (media, still frames).
 */
export type FileUse = 'read' | 'write' | 'own';

const TRY_AGAIN = 'Try again; if it happens again, choose Help, then Save Diagnostics…, and tell the admin.';

/** A file or folder problem, said plainly with what to do, from its Node error code. */
export function fileProblem(error: unknown, use: FileUse = 'write'): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
  switch (code) {
    case 'ENOSPC':
      if (use === 'read') return TRY_AGAIN;
      return use === 'own'
        ? 'This computer’s drive is full: free some space on it, then try again.'
        : 'The drive is full: free some space, or choose another drive.';
    case 'EACCES':
    case 'EPERM':
      if (use === 'read')
        return 'This computer does not let Drashti open it: copy it to the Desktop, then try again from there.';
      return use === 'own'
        ? 'Drashti may not write in its own folder: ask the admin.'
        : 'Drashti may not write there: choose another folder, or ask the admin.';
    case 'ENOENT':
      return use === 'own'
        ? 'A file went away while Drashti was copying it (was a drive taken out?): check it, then try again.'
        : 'It is no longer there (was a drive taken out?): check the drive, then try again.';
    case 'EROFS':
      if (use === 'read') return TRY_AGAIN;
      return use === 'own'
        ? 'This computer’s drive can only be read: ask the admin.'
        : 'That drive can only be read: choose another drive.';
    case 'EBUSY':
      return 'Another program is using the file: close it, then try again.';
    default:
      return TRY_AGAIN;
  }
}
