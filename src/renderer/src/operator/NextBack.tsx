import type { OperatorAction } from '../../../shared/keymap';
import { shortcutText } from '../../../shared/keymap';
import { useLibrary } from '../library/library-store';
import { usePractice, useShowState } from '../practice/practice-store';
import { Button } from '../ui/Button';
import { ChevronLeft, ChevronRight } from '../ui/icons';

/*
 * Next and Back under LIVE (Session 26g): in a show, Next is the one primary on the screen, the
 * next thing to do, with its key; Back beside it. Each does exactly what its key does, at once
 * (show controls never fade). There is no picture of what comes next: Priyansh took it away on
 * 14 Oct 2026. In the practice show they work the practice.
 */
export function NextBack({ platform, run }: { platform: string; run: (action: OperatorAction) => void }) {
  const state = useShowState();
  const practising = usePractice((s) => s.on);
  // What the grid shows: Next starts it when nothing is live yet (actions.ts).
  const shown = useLibrary((s) => s.doc !== null || s.item !== null);
  const live = state ? state.layers.slide !== null || state.layers.background !== null : false;
  const canNext = state
    ? state.next !== null || state.cue !== null || (!live && (practising || shown))
    : false;
  return (
    <div className="grid grid-cols-[1fr_2fr] gap-2 px-3 pt-2" role="group" aria-label="Next and Back">
      <Button
        size="lg"
        instant
        icon={ChevronLeft}
        kbd={shortcutText('previous', platform)}
        disabled={!live}
        data-testid="show-back"
        onClick={() => {
          run('previous');
        }}
      >
        Back
      </Button>
      <Button
        variant="primary"
        size="lg"
        instant
        iconEnd={ChevronRight}
        kbd={shortcutText('next', platform)}
        disabled={!canNext}
        data-testid="show-next"
        onClick={() => {
          run('next');
        }}
      >
        Next
      </Button>
    </div>
  );
}
