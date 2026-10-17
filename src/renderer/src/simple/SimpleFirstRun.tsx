import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { shortcutText, SIMPLE_KEYMAP } from '../../../shared/keymap';
import { useEngine } from '../engine/engine-store';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';

/*
 * Simple Mode's first steps (Sessions 31–36): three short steps for a volunteer the first time Simple Mode
 * opens on this library, never while a slide is live. They sit in the window's own flow, under the header,
 * so they never cover the big buttons, and they take no keys: the show's keys work all along. Skip ends
 * them, and so do Done and a slide going up (the volunteer has begun); then they never come again. The
 * main process keeps "seen" in the library's settings, through a channel Simple Mode allows.
 */

interface Step {
  title: string;
  text: (key: (action: 'next' | 'previous' | 'toggleBlackout' | 'clearAll') => string) => ReactNode;
}

const STEPS: readonly Step[] = [
  {
    title: 'Choose tonight’s playlist',
    text: () => (
      <>
        Under <b className="text-fg">Playlist</b> on the left, choose tonight’s. Its items show under it: a
        click on one puts it on the screens.
      </>
    ),
  },
  {
    title: 'Next and Back',
    text: (key) => (
      <>
        <b className="text-fg">Next</b> (<Kbd>{key('next')}</Kbd>) puts up the next slide, and the first one
        when nothing is up. <b className="text-fg">Back</b> (<Kbd>{key('previous')}</Kbd>) goes back one.
      </>
    ),
  },
  {
    title: 'When something is wrong',
    text: (key) => (
      <>
        <b className="text-fg">Black-out</b> (<Kbd>{key('toggleBlackout')}</Kbd>) darkens every screen at
        once. <b className="text-fg">Clear all</b> (<Kbd>{key('clearAll')}</Kbd>) takes everything off, and{' '}
        <b className="text-fg">Put it back</b> brings it back. <b className="text-fg">Help</b>, then{' '}
        <b className="text-fg">Guides…</b> has the rest.
      </>
    ),
  },
];

export function SimpleFirstRun({ platform }: { platform: string }) {
  const [step, setStep] = useState<number | null>(null);
  const titleId = useId();
  // Whether a slide is up: null until the show's state has come.
  const live = useEngine((s) => (s.state === null ? null : s.state.layers.slide !== null));
  const asked = useRef(false);
  // Shown now (mirrors step !== null for the store's listener below).
  const showing = useRef(false);
  useEffect(() => {
    if (asked.current || live === null) return;
    asked.current = true;
    // Never while a slide is live: then not this time (they come when Simple Mode next opens with none up).
    if (live) return;
    void window.drashti.app.simpleFirstRun().then((show) => {
      if (!show || useEngine.getState().state?.layers.slide != null) return;
      showing.current = true;
      setStep(0);
    });
  }, [live]);
  const end = () => {
    showing.current = false;
    setStep(null);
    void window.drashti.app.simpleFirstRunSeen();
  };
  // A slide going up ends them: the volunteer has begun.
  useEffect(
    () =>
      useEngine.subscribe((s) => {
        if (s.state?.layers.slide == null || !showing.current) return;
        showing.current = false;
        setStep(null);
        void window.drashti.app.simpleFirstRunSeen();
      }),
    [],
  );
  if (step === null) return null;
  const at = STEPS[step];
  if (!at) return null;
  const key = (action: 'next' | 'previous' | 'toggleBlackout' | 'clearAll') =>
    shortcutText(action, platform, SIMPLE_KEYMAP);
  const last = step === STEPS.length - 1;
  return (
    <section
      aria-labelledby={titleId}
      data-testid="simple-first-run"
      data-step={step + 1}
      data-motion="pop"
      className="mx-3 mt-3 flex shrink-0 items-center gap-4 rounded-lg border border-line-strong bg-panel-2 px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="text-base font-bold">
          <span className="mr-2 text-sm font-medium text-muted">
            First steps, {String(step + 1)} of {String(STEPS.length)}:
          </span>{' '}
          {at.title}
        </h2>
        <p className="mt-1 text-base text-muted">{at.text(key)}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="lg" variant="ghost" data-testid="simple-first-run-skip" onClick={end}>
          Skip
        </Button>
        <Button
          size="lg"
          data-testid="simple-first-run-next"
          onClick={() => {
            if (last) end();
            else setStep(step + 1);
          }}
        >
          {last ? 'Done' : 'Next step'}
        </Button>
      </div>
    </section>
  );
}
