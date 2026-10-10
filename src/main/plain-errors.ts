/*
 * What an error means to the person reading it, in words, and what to do next (Session 25): never
 * its code or the system's own text, which go to the log only.
 */

/** A file or folder problem, said plainly with what to do, from its Node error code. */
export function fileProblem(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
  switch (code) {
    case 'ENOSPC':
      return 'The drive is full: free some space, or choose another drive.';
    case 'EACCES':
    case 'EPERM':
      return 'Drashti may not write there: choose another folder, or ask the admin.';
    case 'ENOENT':
      return 'The file or folder is no longer there (was a drive taken out?): check it, then try again.';
    case 'EROFS':
      return 'That drive can only be read: choose another drive.';
    case 'EBUSY':
      return 'Another program is using the file: close it, then try again.';
    default:
      return 'Try again; if it happens again, choose Help, then Save Diagnostics…, and tell the admin.';
  }
}
