import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { chooseNothing } from '../library/library-store';
import { startPractice } from '../practice/practice-store';
import { Button } from '../ui/Button';
import { useFocusTrap } from '../ui/Dialog';
import { Monitor, Play } from '../ui/icons';
import { LitLamp } from '../ui/Mark';
import { useLeaving } from '../ui/motion';
import { openSetup } from './setup-store';
import { ShowOnButton, useDisplayOffer } from '../screens/ShowOn';

/*
 * The first start (Session 26g): once per library, the lamp lights (over --dur-light; with reduced
 * motion it is simply lit), then a welcome with three choices. Set Up Screens… opens the setup
 * wizard, as before, at its Screens step; Try a practice show first puts placeholder slides on this
 * screen only, and leaving it comes back here; Skip for now leaves the empty places to lead, step
 * 1's Import… the one primary. Once set up or skipped, it never comes again for this library.
 */

export const useWelcome = create<{ open: boolean }>(() => ({ open: false }));

export function openWelcome(): void {
  useWelcome.setState({ open: true });
}

/** The welcome closes without being answered (the wizard opened from the menu meanwhile). */
export function closeWelcome(): void {
  useWelcome.setState({ open: false });
}

function answer(): void {
  useWelcome.setState({ open: false });
  void window.drashti.setup.welcomeSeen();
}

export function setUpTheScreens(): void {
  answer();
  void openSetup(1);
}

export function skipForNow(): void {
  answer();
  // The middle's empty place leads, with its three steps (step 1's Import… the one primary).
  chooseNothing();
}

export function tryPractice(): void {
  useWelcome.setState({ open: false });
  startPractice();
}

export function Welcome() {
  const open = useWelcome((s) => s.open);
  return open ? <WelcomeDialog /> : null;
}

function WelcomeDialog() {
  const titleId = useId();
  const offered = useDisplayOffer();
  const panel = useRef<HTMLDivElement>(null);
  // Esc is Skip for now: the window behind is ready, with its empty places leading.
  useFocusTrap(panel, skipForNow);
  const backdrop = useLeaving<HTMLDivElement>('dialog');
  return createPortal(
    <div
      ref={backdrop}
      data-motion="scrim"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-text`}
        tabIndex={-1}
        data-testid="welcome"
        data-motion="dialog"
        className="flex bg-panel max-h-full w-[min(44rem,100%)] flex-col items-center gap-3 overflow-y-auto rounded-xl border border-line-strong px-8 pt-8 pb-7 text-center text-fg shadow-overlay focus:outline-none"
      >
        <div data-lighting="">
          <LitLamp size={72} />
        </div>
        <h2 id={titleId} data-motion="words" style={{ ['--i' as string]: 0 }} className="text-3xl font-bold">
          Welcome to Drashti
        </h2>
        <p
          id={`${titleId}-text`}
          data-motion="words"
          style={{ ['--i' as string]: 1 }}
          className="max-w-lg text-base"
        >
          Let’s find your screens first. It takes about a minute, and nothing reaches the hall’s screens until
          you press Finish.
        </p>
        <div
          data-motion="words"
          style={{ ['--i' as string]: 2 }}
          className="mt-2 flex flex-wrap items-center justify-center gap-2"
        >
          {/* Session 44: with a display free for the hall, showing on it is the one obvious step. */}
          {offered ? (
            <>
              <ShowOnButton display={offered} size="lg" first onShown={answer} />
              <Button size="lg" icon={Monitor} onClick={setUpTheScreens}>
                Set Up Screens…
              </Button>
            </>
          ) : (
            <Button variant="primary" size="lg" icon={Monitor} data-autofocus onClick={setUpTheScreens}>
              Set Up Screens…
            </Button>
          )}
          <Button size="lg" icon={Play} onClick={tryPractice} data-testid="welcome-practice">
            Try a practice show first
          </Button>
          <Button variant="ghost" size="lg" onClick={skipForNow} data-testid="welcome-skip">
            Skip for now
          </Button>
        </div>
        <p data-motion="words" style={{ ['--i' as string]: 3 }} className="max-w-lg text-sm text-muted">
          A practice show uses placeholder slides on this screen only. Later,{' '}
          <b className="text-fg">Set Up Screens…</b> (in <b className="text-fg">View</b>) or{' '}
          <b className="text-fg">Screens</b> sets the screens up.
        </p>
      </div>
    </div>,
    document.body,
  );
}
