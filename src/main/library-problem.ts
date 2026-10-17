/*
 * Why Drashti could not open its library at start, and what to do, in words (Sessions 31–36, AI-3): never
 * SQLite's own text or code, which go to the log. The library is the file drashti.sqlite in the data folder;
 * the admin's guide (section 5, "When the library cannot be opened") says how to put a backup back without
 * the library.
 */

const GUIDE = 'the admin’s guide, section 5, “When the library cannot be opened”';

/** What a library that will not open means, and what to do next. */
export function libraryProblem(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
  const text = error instanceof Error ? error.message : '';
  if (text.includes('written by a newer Drashti'))
    return 'This library was saved by a newer version of Drashti, which this one cannot read: install the newer version again (the admin’s guide, section 2).';
  switch (code) {
    case 'SQLITE_CORRUPT':
    case 'SQLITE_NOTADB':
      return `The library file is damaged: ask the admin to put back the last backup (${GUIDE}).`;
    case 'SQLITE_FULL':
    case 'ENOSPC':
      return 'This computer’s drive is full: free some space on it, then start Drashti again.';
    case 'SQLITE_BUSY':
    case 'SQLITE_LOCKED':
    case 'EBUSY':
      return 'Another program is using the library file: restart the computer, then start Drashti again.';
    case 'SQLITE_READONLY':
    case 'SQLITE_PERM':
    case 'SQLITE_CANTOPEN':
    case 'SQLITE_AUTH':
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return 'This computer does not let Drashti open its own library file: ask the admin.';
    default:
      return `Start Drashti again. If this shows again, ask the admin to put back the last backup (${GUIDE}).`;
  }
}
