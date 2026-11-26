import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
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
import { Loading } from '../ui/States';
import { watchReserve, windowReserveDeps, type ReserveBy } from './steady-reserve';
import { ChevronLeft, ChevronRight, Film } from '../ui/icons';

/*
 * Now and Next up (alpha.23, QA23-FLOW-2; the owner: "if we are on 1, it should say next up this program, video which
 * is also seen on phone paired"): ONE for the operator window's Sabha flow panel and a paired phone's Sabha flow, so
 * both say the same. "Now: 1 · Program · Details" and, larger and bold, "Next up: 2 · Program · Details · Duration ·
 * Presenter" (a Video row shows as the video), and "Last item" once Now is the last. The words of an item keep the
 * PDF's own language (each part's lang) inside Drashti's English labels. Shown as text, never spoken; never on a
 * screen or the stream.
 *
 * The panel's has Back and Next first, above Now and Next up (so a long Next up never pushes them out of reach),
 * moving Now by one item (the operator marks where the sabha is; Main keeps it). A button that cannot move (Back before
 * anything is Now, Next on the last item) stays a Tab stop, dimmed, so pressing Next from the keyboard up to the last
 * item never drops the focus out of the panel. A press always goes to the store, which steps from the Now last asked
 * of Main (a press while an ask is on its way counts) and does nothing past either end (flow-store.ts). They show Back
 * and Next, and are named "Sabha flow: Back" and "Sabha flow: Next", so a screen reader, a keyboard user or a test
 * never takes them for the show's own Next or Next item. The phone's is read only and larger. A change is said to a
 * screen reader once, Now and Next up together (not the buttons); where another copy is said instead (a phone's More
 * under its open Sabha flow sheet) `live` is false.
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
    box: 'relative flex flex-col gap-2 border-b border-line px-3 py-2',
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
  /** The panel's: whether its steady room is set (Now and Next shown and usable); false until it is. */
  onMeasured?: (measured: boolean) => void;
}

type Look = (typeof LOOK)[keyof typeof LOOK];

/** Now's line: its number and program, or not started. `testId` on the line shown; `measure` on an unseen copy. */
function NowLine({
  flow,
  nn,
  look,
  testId,
  measure,
}: {
  flow: SabhaFlow;
  nn: ReturnType<typeof nowNext>;
  look: Look;
  testId?: string;
  measure?: 'now';
}) {
  return (
    <p data-testid={testId} data-measure={measure} className={look.now}>
      {NOW_LABEL}: {nn.now ? <FlowLineWords line={nn.now} lang={flow.lang} /> : NOT_STARTED}
    </p>
  );
}

/** Next up's line: the whole of the item after Now (a video's row marked), or Last item. */
function NextLine({
  flow,
  nn,
  look,
  testId,
  measure,
}: {
  flow: SabhaFlow;
  nn: ReturnType<typeof nowNext>;
  look: Look;
  testId?: string;
  measure?: 'next';
}) {
  return (
    <p
      data-testid={testId}
      data-measure={measure}
      // Marked on the line shown only (an unseen copy is no video row).
      data-video={testId !== undefined && nn.next?.video === true ? 'true' : undefined}
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
  );
}

/** Said while Now and Next up wait for their room (review S18). */
const GETTING_READY = 'Getting Now and Next up ready…';

/**
 * Now's and Next up's lines, said to a screen reader as they change (`live`). `steady` (the panel): the lines keep the
 * height of the flow's tallest Now and Next up of all its items, measured once per flow and on every change of the
 * panel's width from unseen copies (review S16): Next and Back never move the read list, the splitter or the playlists
 * under the operator's pointer mid-sabha. A phone's sheet scrolls as a whole.
 */
function NowNextLines({
  flow,
  nn,
  look,
  live,
  steady,
  onMeasured,
  children,
}: {
  flow: SabhaFlow;
  nn: ReturnType<typeof nowNext>;
  look: Look;
  live: boolean;
  steady: boolean;
  onMeasured?: (measured: boolean) => void;
  /** Back and Next (the panel's): shown with the lines, once the room is set. */
  children?: ReactNode;
}) {
  const [measure, setMeasure] = useState<HTMLDivElement | null>(null);
  // The flow as first met, kept while its id stays (each Now marked brings a new copy of the same flow): the copies and
  // the room are this one's, never measured again for a Now.
  const [kept, setKept] = useState(flow);
  if (kept.id !== flow.id) setKept(flow);
  const current = kept.id === flow.id ? kept : flow;
  // The room, set once for this flow: after its faces have loaded and the layout has taken them (or by the bound, once
  // its own faces are in), before Now and Next can be used; again only on a new panel width (steady-reserve.ts).
  const [reserve, setReserve] = useState<{ id: string; px: number; by: ReserveBy } | null>(null);
  useLayoutEffect(
    () =>
      measure
        ? watchReserve(
            measure,
            (px, by) => {
              setReserve({ id: current.id, px, by });
            },
            windowReserveDeps(),
          )
        : undefined,
    [measure, current],
  );
  const measured = !steady || reserve?.id === current.id;
  useEffect(() => {
    onMeasured?.(measured);
  }, [measured, onMeasured]);
  // The unseen copies, made once per flow (and look).
  const copies = useMemo(
    () =>
      steady &&
      [null, ...current.items.map((_, i) => i)].map((k) => {
        const each = nowNext(current, k);
        return (
          <div key={k ?? 'none'} className={look.lines}>
            <NowLine flow={current} nn={each} look={look} measure="now" />
            <NextLine flow={current} nn={each} look={look} measure="next" />
          </div>
        );
      }),
    [current, look, steady],
  );
  // Until the room is set (a moment, the faces loading; FACES_BOUND_MS at most), Back, Next, Now and Next up are laid
  // out unseen: nothing can be pressed, and nothing moves after it can.
  const unseen = measured ? undefined : 'invisible';
  return (
    <>
      {children !== undefined && children !== false && <div className={unseen}>{children}</div>}
      <div
        aria-live={live ? 'polite' : undefined}
        aria-atomic={live ? 'true' : undefined}
        className={unseen ? `${look.lines} ${unseen}` : look.lines}
        data-measured={steady ? String(measured) : undefined}
        data-reserve={steady && measured && reserve ? String(reserve.px) : undefined}
        data-reserve-by={steady && measured && reserve ? reserve.by : undefined}
        style={steady && measured && reserve ? { minHeight: reserve.px } : undefined}
      >
        <NowLine flow={flow} nn={nn} look={look} testId={`${look.id}-now`} />
        <NextLine flow={flow} nn={nn} look={look} testId={`${look.id}-next`} />
      </div>
      {steady && (
        // Every item's Now and Next up, unseen: what the lines must have room for. Laid out at the lines' width with the
        // panel body's scrollbar shown, shown or not (a scrollbar's room of their own, reaching over the body's while it
        // shows: steady-reserve.ts), so a scrollbar coming or going never changes the room (review S18, CI's Mac).
        <div
          ref={setMeasure}
          aria-hidden="true"
          className="pointer-events-none invisible absolute inset-x-3 top-0 h-0 overflow-hidden [scrollbar-gutter:stable]"
        >
          {copies}
        </div>
      )}
      {steady && !measured && (
        // Said only after half a second (most waits are shorter), over the unseen Back and Next: it takes no room, so
        // nothing moves when it goes.
        <div
          className="pointer-events-none absolute inset-x-3 top-2 flex"
          data-testid={`${look.id}-getting-ready`}
        >
          <Loading label={GETTING_READY} className="px-0 py-0" />
        </div>
      )}
    </>
  );
}

export function FlowNowNext({ flow, now, size, onBack, onNext, onMeasured, live = true }: FlowNowNextProps) {
  const look = LOOK[size];
  const nn = nowNext(flow, now);
  const canBack = nn.now !== null;
  const canNext = nn.next !== null;

  return (
    <div className={look.box} data-testid={`${look.id}-now-next`}>
      <NowNextLines
        flow={flow}
        nn={nn}
        look={look}
        live={live}
        steady={size === 'panel'}
        onMeasured={onMeasured}
      >
        {onBack && onNext && (
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              icon={ChevronLeft}
              aria-label="Sabha flow: Back"
              aria-disabled={canBack ? undefined : true}
              className={CANNOT_MOVE}
              data-testid="flow-back-button"
              onClick={onBack}
            >
              Back
            </Button>
            <Button
              size="sm"
              iconEnd={ChevronRight}
              aria-label="Sabha flow: Next"
              aria-disabled={canNext ? undefined : true}
              className={CANNOT_MOVE}
              data-testid="flow-next-button"
              onClick={onNext}
            >
              Next
            </Button>
          </div>
        )}
      </NowNextLines>
    </div>
  );
}
