import type { OperatorAction } from '../../../shared/keymap';
import { shortcutText } from '../../../shared/keymap';
import { useLibrary } from '../library/library-store';
import { usePractice, useShowState } from '../practice/practice-store';
import { useWhatIsThis } from '../help/WhatIsThis';
import { Button } from '../ui/Button';
import { ChevronLeft, ChevronRight, Undo2 } from '../ui/icons';
import { NextPicture, useNextCaption } from './NextPreview';

/*
 * Next and Back under LIVE (Session 26g): in a show, Next is the one primary on the screen, the
 * next thing to do, with its key; Back beside it. Each does exactly what its key does, at once
 * (show controls never fade). Priyansh took the big picture of what comes next away on 14 Oct 2026; since Session 55
 * (Part 4, his idea O) a small one sits beside Next, so a glance says what Next puts up. Under them, Oops (his idea B):
 * what was on the screens before the last change comes back, one step a press. In the practice show they work the
 * practice.
 */

/**
 * Back's and Next's keys, only where both have room for them beside their words (alpha.22, the owner's report on
 * alpha.21, 24 Nov 2026: "UI Front end issue."). Next needs the most, about 131 px with its key (its bold words,
 * chevron, key and padding): two of them, the next picture's 56 px and the row's two 8 px gaps make about 21rem of the
 * row, a live column of about 360 px. Narrower, Back and Next show their words alone. The key's own inline-flex (Kbd)
 * comes after a plain `hidden` in the CSS, so alpha.21's `hidden @[19.5rem]/nextback:inline-flex` never hid it and
 * the keys ran past both buttons' padding below about 355 px; a width query's `hidden` comes after it, and holds.
 */
const KEY_WHEN_ROOM = '@max-[21rem]/nextback:hidden';

export function NextBack({
  platform,
  run,
  oops = true,
  canStart = false,
  caption: captionLine = false,
}: {
  platform: string;
  run: (action: OperatorAction) => void;
  /** Oops's button under Back (Simple Mode has none since Session 55, Part 18: its key, F9, still acts). */
  oops?: boolean;
  /** Next can start something with nothing live (Simple Mode: its one playlist has a row that plays). */
  canStart?: boolean;
  /** What Next puts up, in words, in a line under them (Simple Mode, as its Next said it since Session 54). */
  caption?: boolean;
}) {
  const state = useShowState();
  const practising = usePractice((s) => s.on);
  // What the middle shows: Next starts it when nothing is live yet (actions.ts).
  const shown = useLibrary((s) => s.doc !== null || s.item !== null);
  const live = state ? state.layers.slide !== null || state.layers.background !== null : false;
  // In a show Next stays the primary, even at the end (it does what → does there: nothing more), so it
  // is never redrawn as slides change; with nothing shown or live it waits.
  const canNext = state
    ? live || state.next !== null || state.cue !== null || practising || shown || canStart
    : false;
  const next = state?.next ?? null;
  const caption = useNextCaption(next);
  const canOops = !practising && state?.canOops === true;
  // What is this? (Sessions 31–36): its ? beside them, its words under them (none in Simple Mode).
  const help = useWhatIsThis('nextback');
  return (
    <>
      <div
        // Their keys only where they fit (alpha.21: in the owner's live column at its least, Next ran into the picture).
        className="@container/nextback grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 px-3 pt-2"
        role="group"
        aria-label="Next and Back"
      >
        <Button
          size="lg"
          instant
          icon={ChevronLeft}
          kbd={shortcutText('previous', platform)}
          kbdClassName={KEY_WHEN_ROOM}
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
          kbdClassName={KEY_WHEN_ROOM}
          disabled={!canNext}
          data-testid="show-next"
          onClick={() => {
            run('next');
          }}
        >
          Next
        </Button>
        {/* Next up (Session 55): a small picture of what Next puts up; black when nothing follows. */}
        <span
          className="relative block aspect-video w-14 shrink-0 overflow-hidden rounded-sm border border-line-strong bg-black"
          data-testid="next-up"
          data-kind={next?.kind ?? 'none'}
          data-a11y-picture
          role="img"
          aria-label={`Next up: ${caption}`}
          title={`Next up: ${caption}`}
        >
          <NextPicture next={next} />
        </span>
      </div>
      {captionLine && (
        <p className="px-3 pt-1.5 text-sm break-words text-fg" data-testid="next-caption">
          {caption}
        </p>
      )}
      {/* Oops under Back, and the ? at the end of its line (beside Next, the small picture has its place). */}
      {oops && (
        <div className="flex items-center justify-between gap-2 px-3 pt-1.5">
          <Button
            size="sm"
            instant
            icon={Undo2}
            kbd={shortcutText('oops', platform)}
            disabled={!canOops}
            data-testid="show-oops"
            title="Put back what was on the screens before the last change"
            onClick={() => {
              run('oops');
            }}
          >
            Oops
          </Button>
          {help.button}
        </div>
      )}
      {help.card && <div className="pt-2">{help.card}</div>}
    </>
  );
}
