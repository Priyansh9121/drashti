import { useEngine } from '../../engine/engine-store';
import { Button } from '../../ui/Button';
import { Play, Square } from '../../ui/icons';
import { api } from '../device';
import { tap } from '../taps';
import { startGoingRound } from './repeat';

/*
 * A Repeat Slides playlist chosen on the phone (Session 54, D5 review): Start going round, or Stop going round while
 * it does (its step stays on the screens), as Simple Mode has them over its items and the window on its row.
 */

export function RepeatStart({ playlistId }: { playlistId: string }) {
  const going = useEngine((s) => s.state?.repeat?.playlistId === playlistId);
  return going ? (
    <Button
      size="lg"
      className="min-h-12 w-full"
      instant
      icon={Square}
      data-testid="remote-going-round-stop"
      onClick={() => void tap(() => api<{ rev?: number }>('/api/v1/repeat/stop', { method: 'POST' }))}
    >
      Stop going round
    </Button>
  ) : (
    <Button
      size="lg"
      className="min-h-12 w-full"
      instant
      icon={Play}
      data-testid="remote-going-round"
      onClick={() => void tap(() => startGoingRound(playlistId))}
    >
      Start going round
    </Button>
  );
}
