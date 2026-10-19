import { useState } from 'react';
import { Button } from '../ui/Button';
import { RotateCcw } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { readPlaylistsAgain } from './playlist-store';

/*
 * What the window could not read of the playlists (Session 39), in both modes: the playlists themselves, or
 * the open playlist's items. A volunteer is never told "No playlists" or "This playlist is empty" when the
 * read failed; Try again reads both again, and the message goes when it works. The main process's log says
 * why.
 */
export function PlaylistsUnread({
  what,
  size = 'sm',
  className,
}: {
  what: 'playlists' | 'items';
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const [trying, setTrying] = useState(false);
  const title =
    what === 'playlists' ? 'Drashti couldn’t read the playlists' : 'Drashti couldn’t read this playlist';
  return (
    <Notice
      tone="danger"
      compact={size === 'sm'}
      title={title}
      className={className}
      data-testid={what === 'playlists' ? 'playlists-unread' : 'playlist-items-unread'}
      actions={
        <Button
          variant="primary"
          size={size === 'sm' ? 'sm' : 'lg'}
          icon={RotateCcw}
          disabled={trying}
          data-testid={what === 'playlists' ? 'playlists-try-again' : 'playlist-items-try-again'}
          onClick={() => {
            setTrying(true);
            void readPlaylistsAgain().finally(() => {
              setTrying(false);
            });
          }}
        >
          Try again
        </Button>
      }
    >
      If Try again doesn’t bring {what === 'playlists' ? 'them' : 'its items'} back, tell the admin.
    </Notice>
  );
}
