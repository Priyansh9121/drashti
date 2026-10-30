import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { shortcutText, SIMPLE_KEYMAP } from '../../../shared/keymap';
import { useKeymapNow } from '../operator/single-keys-store';
import { useEngine } from '../engine/engine-store';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';

/*
 * Simple Mode's first steps (Sessions 31–36): three short steps for a volunteer the first time Simple Mode
 * opens on this library, never while a slide is live. They sit in the window's own flow, under the header,
 * so they never cover the show's controls, and they take no keys: the show's keys work all along. Skip ends
 * them, and so do Done and a slide going up (the volunteer has begun); then they never come again. The
 * main process keeps "seen" in the library's settings, through a channel Simple Mode allows. Since Session 55
 * (Part 18) they say what Simple Mode is now: Pro Mode's window with only what a sabha with one projector needs.
 */

interface Step {
  title: string;
  text: (key: (action: 'next' | 'previous' | 'toggleBlackout' | 'clearAll') => string) => ReactNode;
}

const STEPS: readonly Step[] = [
  {
    title: 'This is Simple Mode',
    text: () => (
      <>
        Only what a sabha with one projector needs: <b className="text-fg">the playlist</b> in the middle, the{' '}
        <b className="text-fg">wallpapers</b> on the left, and what is on the screens on the right.{' '}
        <b className="text-fg">Add files…</b> and <b className="text-fg">From a Link…</b> above the playlist
        bring things into it, and so do files dropped on the window.
      </>
    ),
  },
  {
    title: 'Rows, Next and Back',
    text: (key) => (
      <>
        A click on a row puts it on the screens. <b className="text-fg">Next</b> (<Kbd>{key('next')}</Kbd>)
        puts up the next, and the first when nothing is up; <b className="text-fg">Back</b> (
        <Kbd>{key('previous')}</Kbd>) goes back one. Drag a row to move it; right-click it to rename or delete
        it.
      </>
    ),
  },
  {
    title: 'When something is wrong',
    text: (key) => (
      <>
        <b className="text-fg">Black-out</b>
        {key('toggleBlackout') && (
          <>
            {' '}
            (<Kbd>{key('toggleBlackout')}</Kbd>)
          </>
        )}{' '}
        darkens every screen at once. <b className="text-fg">Clear all</b> (<Kbd>{key('clearAll')}</Kbd>)
        takes everything off, and <b className="text-fg">Put it back</b> brings it back; with nothing up, the
        screens show the wallpaper chosen on the left. <b className="text-fg">Help</b>, then{' '}
        <b className="text-fg">Guides…</b> has the rest.
      </>
    ),
  },
];

export function SimpleFirstRun({ platform }: { platform: string }) {
  const [step, setStep] = useState<number | null>(null);
  const titleId = useId();
  // Only keys that act: no key for Black-out while B and . are turned off (Session 37).
  const keymap = useKeymapNow(SIMPLE_KEYMAP);
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
    shortcutText(action, platform, keymap);
  const last = step === STEPS.length - 1;
  return (
    <section
      aria-labelledby={titleId}
      data-testid="simple-first-run"
      data-step={step + 1}
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
