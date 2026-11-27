import { dispatch } from '../operator/actions';
import { Button, IconButton } from '../ui/Button';
import { type Icon, RotateCcw, RotateCw } from '../ui/icons';
import type { SkipsShown } from './skips';

/*
 * Back 15 s and Forward 15 s (Session 50, as on the mandir's audio controls; Last 10 s went in alpha.21, the owner's
 * "remove last 10s whole concept"), in Pro Mode: for
 * the background video and a single sound under the live picture, and for an audio playlist's track in the
 * row with its Play and Pause (Session 51). Each is a jump, as to a marker, in step on every screen, the nodes
 * and the stream (the engine's skip, which keeps to the file's start and end points). Dimmed until Drashti
 * knows how long the file is, a moment after it starts. Simple Mode has the track's, in its Audio (Session 56), and
 * none under its live picture; the keys have none (not asked); the phone remote has them under its live picture
 * since Session 54 (D5: web/remote/Playing.tsx).
 */

const SKIPS: { jump: 'back' | 'forward'; label: string; icon: Icon }[] = [
  { jump: 'back', label: 'Back 15 s', icon: RotateCcw },
  { jump: 'forward', label: 'Forward 15 s', icon: RotateCw },
];

/**
 * The two buttons for the background video or the sound playing; a refusal shows as the notice. `compact`
 * (the Music panel's row, Session 51): their icons alone, each named by its tooltip, as Previous and Next are
 * there, so they fit beside Play and Pause in the live column at 1024 wide; with their words they do not.
 */
export function SkipButtons({
  layer,
  shown,
  compact = false,
}: {
  layer: 'background' | 'audio';
  shown: SkipsShown;
  compact?: boolean;
}) {
  return (
    <>
      {SKIPS.map((s) =>
        compact ? (
          <IconButton
            key={s.jump}
            size="sm"
            icon={s.icon}
            label={s.label}
            disabled={shown !== 'ready'}
            // A show control (alpha.24, QA24-UIMOTION-SKIP): what the hall hears moves at once; it never moves.
            instant
            data-testid={`skip-${s.jump}`}
            onClick={() => void dispatch({ type: 'skip', layer, jump: s.jump })}
          />
        ) : (
          <Button
            key={s.jump}
            size="sm"
            icon={s.icon}
            disabled={shown !== 'ready'}
            // A show control (alpha.24, QA24-UIMOTION-SKIP): what the hall hears moves at once; it never moves.
            instant
            data-testid={`skip-${s.jump}`}
            onClick={() => void dispatch({ type: 'skip', layer, jump: s.jump })}
          >
            {s.label}
          </Button>
        ),
      )}
    </>
  );
}
