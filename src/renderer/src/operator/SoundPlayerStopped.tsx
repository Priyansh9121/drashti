import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { connectSound, useSound } from '../screens/sound-store';

/*
 * Drashti's sound has stopped (x53; the owner's Q60-31 bug hunt, x52's D6c; his Q60-50 (2) A): the sound player, the
 * hidden window that plays every sound, kept failing with nothing to blame (no video up it could be taken off for), so
 * Drashti gave up on it for now, as the watchdog does for a hall screen, and nothing is heard. Until then nobody was
 * told. This notice says so in the window's flow, under the header, in Pro Mode and Simple Mode alike (never over the
 * show controls), with Try again as its one primary; it goes once the player is tried again, by Try again or by itself
 * a few minutes on, and comes back if it is given up on again.
 */

export function SoundPlayerStopped() {
  const stopped = useSound((s) => s.status?.playerStopped === true);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    connectSound();
  }, []);
  if (!stopped) return null;
  return (
    <div className="shrink-0 px-3 pt-2" data-testid="sound-player-stopped">
      <Notice
        tone="danger"
        title="Drashti’s sound has stopped"
        data-testid="sound-player-stopped-notice"
        actions={
          <Button
            variant="primary"
            size="sm"
            data-testid="sound-player-try-again"
            onClick={() => {
              void window.drashti.audio.tryAgain().then((r) => {
                setFailed(r.ok ? null : r.message);
              });
            }}
          >
            Try again
          </Button>
        }
      >
        Its sound player kept failing, so nothing is heard for now. Drashti tries it again by itself every few
        minutes.
        {failed && <span className="block">{failed}</span>}
      </Notice>
    </div>
  );
}
