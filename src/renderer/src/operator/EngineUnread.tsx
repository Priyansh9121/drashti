import { readEngineAgain, useEngine } from '../engine/engine-store';
import { Button } from '../ui/Button';
import { RotateCcw } from '../ui/icons';
import { Notice } from '../ui/Notice';

/*
 * The show's state could not be read (Session 39), after the window asked again by itself after 1, 2 and
 * 5 s: said in the flow under the header, in both modes, with Try again. Next, Back and the clears wait for
 * it, so the operator is told why they do nothing; the screens keep their picture. It goes when the state
 * comes.
 */
export function EngineUnread() {
  const unread = useEngine((s) => s.unread);
  if (!unread) return null;
  return (
    <div className="shrink-0 px-3 pt-2" data-testid="engine-unread">
      <Notice
        tone="danger"
        title="Drashti couldn’t read what the screens are showing"
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={RotateCcw}
            data-testid="engine-try-again"
            onClick={readEngineAgain}
          >
            Try again
          </Button>
        }
      >
        Next, Back and the clears wait until it can, and the screens keep showing what they show now. If Try
        again doesn’t work, tell the admin.
      </Notice>
    </div>
  );
}
