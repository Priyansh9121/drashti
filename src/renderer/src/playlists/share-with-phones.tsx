import type { PlaylistNode } from '../../../shared/playlists';
import { useNetwork } from '../network/network-store';
import { Share2, X } from '../ui/icons';
import type { MenuEntry } from '../ui/Menu';
import { usePlaylists } from './playlist-store';

/*
 * A playlist shared with phones and tablets (Session 54, D3): its right-click menu offers Share with Phones and
 * Tablets while a phone or tablet that can view it is paired (a Remote device), and Stop Sharing once it is
 * shared, paired or not. A playlist made from a folder is shared whole, its folders as its headers. Remote devices
 * list it under "Shared from Drashti", every file to view and play on the device itself, read-only.
 */

/** A Remote device is paired (the announcements poster is not one). */
export const remotePaired = (): boolean =>
  useNetwork.getState().status?.devices.some((d) => d.kind === 'remote' && !d.poster) ?? false;

async function share(playlistId: string, on: boolean): Promise<void> {
  const result = await window.drashti.playlists.share(playlistId, on);
  usePlaylists.setState({ problem: result.ok ? null : result.message });
}

/** The menu's entries for a playlist's sharing; none for a folder of playlists or a template. */
export function shareEntries(node: PlaylistNode): MenuEntry[] {
  if (node.isFolder || node.template) return [];
  if (node.shared)
    return [
      {
        label: 'Stop Sharing',
        icon: X,
        onSelect: () => void share(node.id, false),
      },
    ];
  if (!remotePaired()) return [];
  return [
    {
      label: 'Share with Phones and Tablets',
      icon: Share2,
      onSelect: () => void share(node.id, true),
    },
  ];
}

/** On a shared playlist's row: the mark, with its words for a screen reader and a tooltip for the mouse. */
export function SharedMark() {
  return (
    <span
      className="flex shrink-0 items-center text-muted"
      title="Shared with phones and tablets"
      data-testid="playlist-shared"
    >
      <Share2 size={13} aria-hidden="true" />
      <span className="sr-only">, shared with phones and tablets</span>
    </span>
  );
}
