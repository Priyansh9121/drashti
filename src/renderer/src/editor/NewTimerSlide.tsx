import { useEffect, useMemo, useState } from 'react';
import type { RenderSlide } from '../../../shared/model';
import type { EditSlide, EditSlidesResult, SlideLook } from '../../../shared/slide-edit';
import {
  TIMER_LAYOUT_NAMES,
  TIMER_LAYOUTS,
  TIMER_WORDS,
  type TimerLayout,
  timerLayoutElements,
} from '../../../shared/timer-slides';
import { TIMER_KIND_NAMES, type TimerState } from '../../../shared/timers';
import { useEngine } from '../engine/engine-store';
import { selectPresentation, useLibrary } from '../library/library-store';
import { pushRemoval } from '../library/undo';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { Field, Select, TextInput } from '../ui/Field';
import { Timer } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { EmptyState, Loading } from '../ui/States';
import { addSlideAfter, newTimerSlide } from './ops';

/*
 * New Timer Slide… (Session 50): a slide that shows one of the timers, live, in one of Drashti's two ready
 * layouts (Timer only, or Timer with words: "Starting in" until the operator writes their own), in the
 * presentation's theme. Offered in a presentation's slide menu (the slide grid's right-click) and beside the
 * slide editor's New slide; the slide goes after the slide it was asked from. Placeholder words only.
 */

const NO_TIMERS: TimerState[] = [];

/** A layout to choose, with how its slide would look in this theme. */
function LayoutChoice({
  layout,
  chosen,
  index,
  choose,
  preview,
}: {
  layout: TimerLayout;
  chosen: boolean;
  index: number;
  choose: (layout: TimerLayout) => void;
  preview: RenderSlide | null;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      tabIndex={radioTabIndex(chosen, index, true)}
      data-testid="timer-layout"
      data-layout={layout}
      onClick={() => {
        choose(layout);
      }}
      className={cx(
        'flex min-w-0 flex-col gap-1.5 rounded-lg border p-1.5 text-left text-sm',
        chosen ? 'border-accent bg-panel-3 font-bold text-fg' : 'border-line bg-panel-2 text-muted',
      )}
    >
      <span
        className="relative block aspect-video w-full overflow-hidden rounded-md bg-black"
        data-a11y-picture
      >
        {preview && (
          <PlacedInParent content={preview} mode="fit" className="absolute inset-0">
            <SlideView slide={preview} media="still" />
          </PlacedInParent>
        )}
      </span>
      <span className="px-0.5">{TIMER_LAYOUT_NAMES[layout]}</span>
    </button>
  );
}

/**
 * Choose the timer, the layout and its words; `onAdd` puts the slide in (and says what went wrong, if
 * anything). `look`: the presentation's theme (null while it is read); `size`: its slides' size.
 */
export function NewTimerSlideDialog({
  where,
  look,
  size,
  onAdd,
  onClose,
}: {
  /** Where the slide goes, for the subtitle ("after slide 3"). */
  where: string;
  look: SlideLook | null;
  size: { width: number; height: number } | null;
  onAdd: (slide: EditSlide) => Promise<string | null> | string | null;
  onClose: () => void;
}) {
  const timers = useEngine((s) => s.state?.timers) ?? NO_TIMERS;
  const [chosen, setChosen] = useState<string | null>(null);
  const [layout, setLayout] = useState<TimerLayout>('alone');
  const [words, setWords] = useState(TIMER_WORDS);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The one chosen while it is there, else the first: running ones first, as the Timers panel lists them.
  const listed = useMemo(
    () => [...timers.filter((t) => t.startedAt !== null), ...timers.filter((t) => t.startedAt === null)],
    [timers],
  );
  const timer = listed.find((t) => t.id === chosen) ?? listed[0];
  const timerId = timer?.id ?? null;
  // How each layout's slide would look: the slide that is added, its time live.
  const previews = useMemo((): Record<TimerLayout, RenderSlide> | null => {
    if (timerId === null || !size || !look) return null;
    // Laid out as newTimerSlide lays it out, with ids of its own (it is only looked at).
    const preview = (l: TimerLayout): RenderSlide => {
      let n = 0;
      return {
        id: `preview-${l}`,
        ...size,
        background: look.background,
        ...(look.darken ? { darken: look.darken } : {}),
        elements: timerLayoutElements(
          l,
          timerId,
          look.style,
          size,
          () => `preview-${l}-${String(++n)}`,
          words,
        ),
      };
    };
    return { alone: preview('alone'), words: preview('words') };
  }, [timerId, look, size, words]);
  const add = async () => {
    if (timerId === null || !look || !size || adding) return;
    setAdding(true);
    setProblem(null);
    const wrong = await onAdd(newTimerSlide(layout, timerId, look, size, words));
    setAdding(false);
    if (wrong === null) onClose();
    else setProblem(wrong);
  };
  return (
    <Dialog
      title="New Timer Slide"
      subtitle={`A slide ${where} that shows one of the timers, live, in this presentation’s theme.`}
      onClose={onClose}
      closeLabel="Close New Timer Slide"
      size="md"
      testId="new-timer-slide"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={Timer}
            data-testid="new-timer-slide-add"
            disabled={timerId === null || !look || adding}
            onClick={() => void add()}
          >
            Add the slide
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {problem && (
          <Notice tone="danger" compact>
            {problem}
          </Notice>
        )}
        {!look || !size ? (
          <Loading label="Reading the presentation’s theme…" />
        ) : listed.length === 0 ? (
          <EmptyState icon={Timer} title="No timers yet" compact>
            Make one in Timers (New timer), then add its slide.
          </EmptyState>
        ) : (
          <>
            <Field label="Timer">
              <Select
                data-testid="new-timer-slide-timer"
                value={timerId ?? ''}
                onChange={(e) => {
                  setChosen(e.target.value);
                }}
              >
                {listed.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({TIMER_KIND_NAMES[t.kind]})
                  </option>
                ))}
              </Select>
            </Field>
            <div
              role="radiogroup"
              aria-label="Layout"
              className="grid grid-cols-2 gap-3"
              onKeyDown={radioKeys(TIMER_LAYOUTS, layout, setLayout)}
            >
              {TIMER_LAYOUTS.map((l, i) => (
                <LayoutChoice
                  key={l}
                  layout={l}
                  chosen={l === layout}
                  index={i}
                  choose={setLayout}
                  preview={previews?.[l] ?? null}
                />
              ))}
            </div>
            {layout === 'words' && (
              <Field label="Words above the timer">
                <TextInput
                  data-testid="new-timer-slide-words"
                  value={words}
                  maxLength={200}
                  onChange={(e) => {
                    setWords(e.target.value);
                  }}
                />
              </Field>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * New Timer Slide… from a presentation's slide menu (the slide grid): the presentation as it is now, the slide
 * added after `afterSlideId` and saved as one change, which the operator's Undo takes back.
 */
export function NewTimerSlideInLibrary({
  presentationId,
  name,
  afterSlideId,
  position,
  onClose,
}: {
  presentationId: string;
  name: string;
  afterSlideId: string;
  /** The slide's place in the grid's order, for the subtitle (0 for the first). */
  position: number;
  onClose: () => void;
}) {
  const [read, setRead] = useState<EditSlidesResult | null>(null);
  useEffect(() => {
    let live = true;
    void window.drashti.library.slidesForEdit(presentationId).then((result) => {
      if (live) setRead(result);
    });
    return () => {
      live = false;
    };
  }, [presentationId]);
  const doc = read?.ok ? read.doc : null;
  const size = useMemo(() => (doc ? { width: doc.width, height: doc.height } : null), [doc]);
  const add = async (slide: EditSlide): Promise<string | null> => {
    // What the presentation is now, so nothing changed meanwhile is lost.
    const now = await window.drashti.library.slidesForEdit(presentationId);
    if (!now.ok) return now.message;
    const saved = await window.drashti.library.saveSlides(
      presentationId,
      addSlideAfter(now.doc, afterSlideId, slide),
      now.stamp,
      false,
    );
    if (!saved.ok) return saved.message;
    const shown = () => useLibrary.getState().selectedId === presentationId;
    pushRemoval({
      text: `Added a timer slide to “${name}”`,
      restore: async () => {
        await window.drashti.library.restoreRevision(saved.revisionId);
        if (shown()) await selectPresentation(presentationId);
      },
    });
    if (shown()) await selectPresentation(presentationId);
    return null;
  };
  if (read && !read.ok)
    return (
      <Dialog title="New Timer Slide" onClose={onClose} closeLabel="Close New Timer Slide" size="sm">
        <Notice tone="danger" compact>
          {read.message}
        </Notice>
      </Dialog>
    );
  return (
    <NewTimerSlideDialog
      where={`after slide ${String(position + 1)} of “${name}”`}
      look={read?.ok ? read.look : null}
      size={size}
      onAdd={add}
      onClose={onClose}
    />
  );
}
