import type { LibraryKind } from './mirror-store';

/*
 * The library's choices on a phone (Session 54): Presentations and Media (D5), and Shared from Drashti (D3) while a
 * playlist is shared with phones. A choice no longer there shows Presentations, and the remote goes back to it.
 */

/** The choices there are now. */
export const libraryKinds = (anyShared: boolean): LibraryKind[] =>
  anyShared ? ['presentations', 'media', 'shared'] : ['presentations', 'media'];

/** The choice shown: the one chosen while it is there, Presentations otherwise. */
export const shownKind = (chosen: LibraryKind, anyShared: boolean): LibraryKind =>
  libraryKinds(anyShared).includes(chosen) ? chosen : 'presentations';
