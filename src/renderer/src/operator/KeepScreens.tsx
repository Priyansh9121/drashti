import { useEffect, useId, useState } from 'react';
import type { PendingScreens } from '../../../shared/keep-screens';
import { shortcutText } from '../../../shared/keymap';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Kbd } from '../ui/Kbd';
import { plural } from '../ui/text';
import { answerKeepScreens, secondsLeft, useKeepScreens } from './keep-screens-store';

/*
 * Keep these screens? (Session 50): after a change that put an output on a display, Keep (the focused primary,
 * so Enter keeps) and Go back (Esc too), with the seconds left in words. Nothing pressed, the main process goes
 * back by itself. It is the window's innermost dialog, in either mode, over Set Up Screens… when that made the
 * change. When an output now covers these controls, that output asks the same, large, in its middle; the keys
 * reach this window under it (an output never takes the keyboard), and the uncover key works as ever.
 */

/**
 * The seconds left, in words, read from the clock four times a second (so it never drifts). Made again for each
 * new deadline (a second change starts the countdown again), so it never shows the last one's clock.
 */
function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const seconds = secondsLeft(deadline, now);
  return (
    <p
      role="timer"
      className="font-medium text-fg"
      data-testid="keep-screens-countdown"
      data-seconds={seconds}
    >
      {seconds > 0 ? `Going back by itself in ${plural(seconds, 'second')}.` : 'Going back now…'}
    </p>
  );
}

function Question({ pending, platform }: { pending: PendingScreens; platform: string }) {
  const textId = useId();
  return (
    <Dialog
      title="Keep these screens?"
      role="alertdialog"
      size="sm"
      onClose={() => void answerKeepScreens(false)}
      closeButton={false}
      describedBy={textId}
      testId="keep-screens"
      footer={
        <>
          <Button data-testid="keep-screens-go-back" onClick={() => void answerKeepScreens(false)}>
            Go back
          </Button>
          <Button
            variant="primary"
            data-autofocus
            data-testid="keep-screens-keep"
            onClick={() => void answerKeepScreens(true)}
          >
            Keep
          </Button>
        </>
      }
    >
      <div id={textId} className="space-y-2 text-sm text-muted">
        <p>The screens have changed. Keep them as they are now, or go back to how they were.</p>
        <Countdown key={pending.deadline} deadline={pending.deadline} />
        {pending.coversControls && (
          <p data-testid="keep-screens-covered">
            An output covers these controls now and asks the same in its middle: Enter keeps, Esc goes back,
            and <Kbd className="text-fg">{shortcutText('uncoverControls', platform)}</Kbd> (Uncover the
            controls) turns it off.
          </p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * The question while a change waits, nothing otherwise. Made again for each new change (a new deadline), so it
 * opens last: over any dialog opened meanwhile (View, Set Up Screens…), with the keyboard.
 */
export function KeepScreensQuestion({ platform }: { platform: string }) {
  const pending = useKeepScreens((s) => s.pending);
  return pending ? <Question key={pending.deadline} pending={pending} platform={platform} /> : null;
}
