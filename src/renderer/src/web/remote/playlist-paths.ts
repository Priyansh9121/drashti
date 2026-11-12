import { FOLDER_SEPARATOR } from '../../../../shared/playlist-folders';
import type { PlaylistNode } from '../../../../shared/playlists';

/** Label nested playlists and folders with their path, including when two names match. */
export function playlistPaths(nodes: readonly PlaylistNode[]): ReadonlyMap<string, string> {
  const folders = new Map(nodes.filter((node) => node.isFolder).map((node) => [node.id, node]));
  return new Map(
    nodes.map((node) => {
      const names = [node.name];
      const seen = new Set([node.id]);
      let parentId = node.parentId;
      while (parentId !== null && !seen.has(parentId)) {
        const parent = folders.get(parentId);
        if (!parent) break;
        names.push(parent.name);
        seen.add(parent.id);
        parentId = parent.parentId;
      }
      return [node.id, names.reverse().join(FOLDER_SEPARATOR)];
    }),
  );
}
