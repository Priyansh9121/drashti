import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { OPENING_HOLD_MS, type OpeningEnd, type OpeningPlan } from '../../../shared/opening';
import { motionOff } from '../ui/motion';
import { OpeningPlayer } from './OpeningPlayer';

/*
 * The opening as Drashti starts (Session 55, shared/opening.ts): asked for once as the operator window opens (the main
 * process decides whether it plays), over the whole window while the window finishes starting underneath it, in Pro
 * and Simple Mode alike. Any key ends it at once: the main process keeps that key from the show and says so here. A
 * click or a tap ends it at once too, and lands on nothing beneath: the opening stays, unseen, until the button or the
 * finger is up and its click has come. It never moves while the hall's screens are still getting ready (their warm-up
 * waits for frames on time): it holds, black, until the main process says they have all drawn, and plays still if that
 * takes longer than OPENING_HOLD_MS.
 */

/** Asked once a page (StrictMode's second effect, or a window loaded again, is told no by the main process anyway). */
let asked: Promise<OpeningPlan | null> | null = null;

export function OpeningAtStart({ children }: { children: ReactNode }) {
  const [appStarted, setAppStarted] = useState(false);
  const startApp = useCallback(() => startTransition(() => setAppStarted(true)), []);
  const [plan, setPlan] = useState<OpeningPlan | null>(null);
  const [state, setState] = useState<'playing' | 'shield' | 'over'>('playing');
  /** Waiting for the hall's screens to draw (the plan's hold). */
  const [held, setHeld] = useState(false);
  const screensUp = useRef(false);
  const playing = useRef(false);
  const dismissed = useRef(false);
  const end = useRef<(how: OpeningEnd) => void>(() => undefined);
  useEffect(() => {
    let live = true;
    // Listened for before it is asked, so a word that comes with the answer is never missed.
    const off = window.drashti.opening.onScreens(() => {
      screensUp.current = true;
      setHeld(false);
    });
    asked ??= window.drashti.opening.atStart().catch(() => null);
    void asked.then((p) => {
      if (!live) return;
      asked = Promise.resolve(null);
      if (!p) {
        setState('over');
        return;
      }
      playing.current = true;
      if (dismissed.current) {
        end.current('key');
        return;
      }
      setHeld(p.hold === true && !screensUp.current);
      setPlan(p);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  useEffect(() => {
    end.current = (how) => {
      if (!playing.current) return;
      playing.current = false;
      void window.drashti.opening.ended(how);
      setState(how === 'click' ? 'shield' : 'over');
    };
  });
  // A key, from the main process (which kept it from the show).
  useEffect(
    () =>
      window.drashti.opening.onEnd(() => {
        if (playing.current) end.current('key');
        else dismissed.current = true;
      }),
    [],
  );
  // And here, should one reach the page all the same: taken before the window's own keys (they listen as it rises),
  // with its repeats and its release, so the show never hears it.
  useEffect(() => {
    if (!plan) return;
    let held: string | null = null;
    const keep = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const down = (e: KeyboardEvent) => {
      if (playing.current) {
        held = e.code;
        keep(e);
        end.current('key');
      } else if (held !== null && e.code === held) {
        // Its repeats are kept; pressed again, it is the show's.
        if (e.repeat) keep(e);
        else held = null;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (held === null || e.code !== held) return;
      held = null;
      keep(e);
    };
    window.addEventListener('keydown', down, { capture: true });
    window.addEventListener('keyup', up, { capture: true });
    return () => {
      window.removeEventListener('keydown', down, { capture: true });
      window.removeEventListener('keyup', up, { capture: true });
    };
  }, [plan]);
  // Gone while playing (the window locked, say): said ended, so the keys are the show's again.
  useEffect(
    () => () => {
      end.current('itself');
    },
    [],
  );
  // Still with reduced motion or Interface motion Off, as it starts, or as soon as either comes on while it plays.
  const [still, setStill] = useState(motionOff);
  // The screens not drawn within OPENING_HOLD_MS: it plays still, so it never moves beside their warm-up.
  useEffect(() => {
    if (!held) return;
    const wait = setTimeout(() => {
      setStill(true);
      setHeld(false);
    }, OPENING_HOLD_MS);
    return () => {
      clearTimeout(wait);
    };
  }, [held]);
  useEffect(() => {
    if (!plan) return;
    const check = () => {
      if (motionOff()) setStill(true);
    };
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    media.addEventListener('change', check);
    const chosen = new MutationObserver(check);
    chosen.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-interface-motion'],
    });
    return () => {
      media.removeEventListener('change', check);
      chosen.disconnect();
    };
  }, [plan]);
  // During the intentional black hold, App can start as soon as the hold has covered the window.
  useEffect(() => {
    if (!held) return;
    const frame = requestAnimationFrame(startApp);
    return () => cancelAnimationFrame(frame);
  }, [held, startApp]);

  const mountApp = appStarted || state !== 'playing';
  if (!plan || state === 'over') return <>{mountApp && children}</>;
  const cover = createPortal(
    <div
      data-testid="opening-start"
      data-state={state}
      className="fixed inset-0 z-[1000]"
      onPointerDown={(e) => {
        e.preventDefault();
        end.current('click');
      }}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
      // The click that ended it stops here; a tap's click may come late or not at all.
      onClick={() => {
        setState('over');
      }}
      onPointerUp={() => {
        setTimeout(() => {
          setState('over');
        }, 400);
      }}
      onPointerCancel={() => {
        setState('over');
      }}
    >
      {state === 'playing' && (
        <OpeningPlayer
          plan={plan}
          still={still}
          held={held}
          className="absolute inset-0"
          onFirstFrame={startApp}
          coverWhilePreparing={appStarted}
          onDone={() => {
            end.current('itself');
          }}
        />
      )}
    </div>,
    document.body,
  );
  return (
    <>
      {mountApp && children}
      {cover}
    </>
  );
}
