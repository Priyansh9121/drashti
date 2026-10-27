import { formatDuration } from '../../../../shared/format';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import { plural } from '../../../../shared/text';

/*
 * A playlist item's second line on the phone (Session 54, D5): what it is and its slide count or length, as its
 * card in the operator window's open playlist says it (OpenPlaylist.tsx, Session 26a). A header has none.
 */

function kindWord(item: Exclude<PlaylistItemInfo, { kind: 'header' }>): string {
  switch (item.kind) {
    case 'presentation':
      return item.deck ? 'Deck' : 'Presentation';
    case 'media':
      return item.media === 'image' ? 'Picture' : item.media === 'video' ? 'Video' : 'Sound';
    case 'shastra':
      return 'Shastra passage';
    case 'placeholder':
      return item.hint === null ? 'Slot' : 'Not found';
    case 'input':
      return 'Video input';
  }
}

export function itemLine(item: PlaylistItemInfo): string | null {
  if (item.kind === 'header') return null;
  const size =
    item.kind === 'presentation' && item.slideCount !== undefined
      ? plural(item.slideCount, 'slide')
      : item.kind === 'media' && item.durationMs
        ? formatDuration(item.durationMs)
        : null;
  return size === null ? kindWord(item) : `${kindWord(item)} · ${size}`;
}
