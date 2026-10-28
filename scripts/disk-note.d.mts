/** The bytes in a folder and everything in it (links not followed). */
export function folderBytes(path: string): number;
/** One line: the free space on `dir`'s disk, and the size of `folders` (each test run's own, by default). Never throws. */
export function diskNote(when: string, dir?: string, folders?: string[] | null): string;
