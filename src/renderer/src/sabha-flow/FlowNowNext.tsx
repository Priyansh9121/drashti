import type { SabhaFlow, SabhaFlowLang } from '../../../shared/sabha-flow';
import type { FlowLine } from '../../../shared/sabha-flow-lines';
import {
  LAST_ITEM,
  NEXT_LABEL,
  NOT_STARTED,
  NOTHING_NEXT,
  NOW_LABEL,
  nowNext,
  textLang,
} from '../../../shared/sabha-flow-lines';
import { Button } from '../ui/Button';
import { ChevronLeft, ChevronRight, Film } from '../ui/icons';

/*
 * Now and Next up (alpha.23, QA23-FLOW-2; the owner: "if we are on 1, it should say next up this program, video which
 * is also seen on phone paired"): ONE for the operator window's Sabha flow panel and a paired phone's Sabha flow, so
 * both say the same. "Now: 1 · Program · Details" and, larger and bold, "Next up: 2 · Program · Details · Duration ·
 * Presenter" (a Video row shows as the video), and "Last item" once Now is the last. The words of an item keep the
 * PDF's own language (each part's lang) inside Drashti's English labels. Shown as text, never spoken; never on a
 * screen or the stream.
 *
 * The panel's has Back and Next under it, moving Now by one item (the operator marks where the sabha is; Main keeps it):
 * a button that cannot move (Back before anything is Now, Next on the last item) stays a Tab stop, dimmed, and does
 * nothing, so pressing Next from the keyboard up to the last item never drops the focus out of the panel. The phone's
 * is read only and larger. A change is said to a screen reader once, Now and Next up together (not the buttons); where
 * another copy is said instead (a phone's More under its open Sabha flow sheet) `live` is false.
 */

/**
 * A line's number and parts, with a middle dot between them that a screen reader skips, reading a comma instead.
 * `lang`: the PDF's, giving each part its own lang attribute (by its script in a mixed PDF); none: the lang around it.
 * The PDF's own words, never offered for a browser's translation.
 */
export function FlowLineWords({ line, lang }: { line: FlowLine; lang?: SabhaFlowLang }) {
  const of = (text: string) => (lang === undefined ? undefined : textLang(text, lang));
  return (
    <span translate="no">
      <span lang={of(line.no)}>{line.no}</span>
      {line.parts.map((part, i) => (
        <span key={i}>
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, </span>
          <span lang={of(part)}>{part}</span>
        </span>
      ))}
    </span>
  );
}

/** Each place's look and test ids: the operator panel's, in its narrow column, and a phone's, a thumb's size. */
const LOOK = {
  panel: {
    id: 'flow',
    box: 'flex flex-col gap-2 border-b border-line px-3 py-2',
    lines: 'min-w-0',
    now: 'text-xs break-words text-muted',
    next: 'mt-0.5 flex items-start gap-1.5 text-base font-bold break-words text-fg',
    film: 16,
    filmAt: 'mt-1',
  },
  phone: {
    id: 'remote-flow',
    box: 'rounded-lg border border-line bg-panel-2 px-3 py-2',
    lines: 'min-w-0 space-y-1',
    now: 'text-base break-words text-muted',
    next: 'flex items-start gap-2 text-lg leading-snug font-bold break-words text-fg',
    film: 20,
    filmAt: 'mt-0.5',
  },
} as const;

/** Dimmed while it cannot move, as a disabled button is, yet still a Tab stop. */
const CANNOT_MOVE = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-40';

export interface FlowNowNextProps {
  flow: SabhaFlow;
  /** Now: an index into the flow's items (null: not started). */
  now: number | null;
  /** The operator window's panel, or a paired phone. */
  size: 'panel' | 'phone';
  /** Back and Next, moving Now by one item (the panel's). Without them it is read only (a phone's). */
  onBack?: () => void;
  onNext?: () => void;
  /** Said to a screen reader as it changes (the default); false where another copy of it is said instead. */
  live?: boolean;
}

export function FlowNowNext({ flow, now, size, onBack, onNext, live = true }: FlowNowNextProps) {
  const look = LOOK[size];
  const nn = nowNext(flow, now);
  const canBack = nn.now !== null;
  const canNext = nn.next !== null;
  return (
    <div className={look.box} data-testid={`${look.id}-now-next`}>
      <div
        aria-live={live ? 'polite' : undefined}
        aria-atomic={live ? 'true' : undefined}
        className={look.lines}
      >
        <p data-testid={`${look.id}-now`} className={look.now}>
          {NOW_LABEL}: {nn.now ? <FlowLineWords line={nn.now} lang={flow.lang} /> : NOT_STARTED}
        </p>
        <p
          data-testid={`${look.id}-next`}
          data-video={nn.next?.video === true ? 'true' : undefined}
          className={look.next}
        >
          {nn.next?.video === true && (
            <Film size={look.film} aria-hidden="true" className={`${look.filmAt} shrink-0`} />
          )}
          <span className="min-w-0 flex-1">
            {nn.last ? (
              LAST_ITEM
            ) : (
              <>
                {NEXT_LABEL}: {nn.next ? <FlowLineWords line={nn.next} lang={flow.lang} /> : NOTHING_NEXT}
              </>
            )}
          </span>
        </p>
      </div>
      {onBack && onNext && (
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            icon={ChevronLeft}
            aria-label="Back one item"
            aria-disabled={canBack ? undefined : true}
            className={CANNOT_MOVE}
            data-testid="flow-back-button"
            onClick={() => {
              if (canBack) onBack();
            }}
          >
            Back
          </Button>
          <Button
            size="sm"
            iconEnd={ChevronRight}
            aria-label="Next item"
            aria-disabled={canNext ? undefined : true}
            className={CANNOT_MOVE}
            data-testid="flow-next-button"
            onClick={() => {
              if (canNext) onNext();
            }}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
