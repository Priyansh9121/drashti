/*
 * The reads a window needs as it opens, and says it could not do (Session 39): the playlists, an open
 * playlist's items, the presentation the slide grid opens, and the show's state. Each fails as it would, so
 * the window can say in plain words what it could not read, with Try again (it never shows "No playlists"
 * when there are some). The log names a failure once, then again only if the read worked in between
 * (readOrDefault's rule, Session 38).
 *
 * Tests only (a packaged Drashti never honours it, switches.ts): DRASHTI_TEST_UNREADABLE lists reads that
 * fail ("playlists,engine"), each until the test makes it readable again (`readable`, which index.ts gives
 * tests as globalThis.drashtiTestReadable).
 */

export const STARTUP_READS = ['playlists', 'playlist-items', 'presentation', 'engine'] as const;
export type StartupRead = (typeof STARTUP_READS)[number];

/** What each read is, in the log's words. */
const WHAT: Record<StartupRead, string> = {
  playlists: 'the playlists',
  'playlist-items': 'a playlist’s items',
  presentation: 'a presentation',
  engine: 'the show’s state',
};

const isStartupRead = (name: string): name is StartupRead =>
  (STARTUP_READS as readonly string[]).includes(name);

export interface StartupReads {
  /** Read, or fail as the read failed, saying so in the log once. */
  read<T>(what: StartupRead, read: () => T): T;
  /** A test's read that failed answers again. */
  readable(what: string): void;
}

export function startupReads(unreadable: string | undefined, say: (line: string) => void): StartupReads {
  const failing = new Set(
    (unreadable ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(isStartupRead),
  );
  const said = new Set<StartupRead>();
  return {
    read(what, read) {
      try {
        if (failing.has(what)) throw new Error('A test made this read fail');
        const value = read();
        said.delete(what);
        return value;
      } catch (error) {
        if (!said.has(what))
          say(
            `Start-up: Drashti could not read ${WHAT[what]} for a window, which says so (${String(error)})`,
          );
        said.add(what);
        throw error;
      }
    },
    readable(what) {
      if (isStartupRead(what)) failing.delete(what);
    },
  };
}
