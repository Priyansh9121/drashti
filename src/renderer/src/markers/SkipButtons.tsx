import { dispatch } from '../operator/actions';
import { Button, IconButton } from '../ui/Button';
import { ArrowRightToLine, type Icon, RotateCcw, RotateCw } from '../ui/icons';
import type { SkipsShown } from './skips';

/*
 * Back 15 s, Forward 15 s and Last 10 s (Session 50, as on the mandir's audio controls), in Pro Mode: for
 * the background video and a single sound under the live picture, and for an audio playlist's track in the
 * row with its Play and Pause (Session 51). Each is a jump, as to a marker, in step on every screen, the nodes
 * and the stream (the engine's skip, which keeps to the file's start and end points). Dimmed until Drashti
 * knows how long the file is, a moment after it starts. Simple Mode, the phone remote and the keys have none
 * (not asked).
 */

const SKIPS: { jump: 'back' | 'forward' | 'last'; label: string; icon: Icon }[] = [
  { jump: 'back', label: 'Back 15 s', icon: RotateCcw },
  { jump: 'forward', label: 'Forward 15 s', icon: RotateCw },
  { jump: 'last', label: 'Last 10 s', icon: ArrowRightToLine },
];

/**
 * The three buttons for the background video or the sound playing; a refusal shows as the notice. `compact`
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
            data-testid={`skip-${s.jump}`}
            onClick={() => void dispatch({ type: 'skip', layer, jump: s.jump })}
          />
        ) : (
          <Button
            key={s.jump}
            size="sm"
            icon={s.icon}
            disabled={shown !== 'ready'}
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
